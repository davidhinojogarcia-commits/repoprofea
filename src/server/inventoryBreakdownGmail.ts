import {PUBLIC_KEY,SERVICE_KEY,SUPABASE_URL,getConnection,decryptToken,refreshGoogleAccessToken,touchSent,type AuthenticatedUser} from './gmailOAuth.js';

const fail=(message:string,status:number,code:string)=>Object.assign(new Error(message),{status,code});
async function database(path:string,body?:unknown,authorization?:string) {
  const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{apikey:authorization?PUBLIC_KEY:SERVICE_KEY,Authorization:authorization||`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok)throw fail('No se pudo comprobar o guardar el aviso de avería.',503,'INVENTORY_BREAKDOWN_PERSISTENCE_FAILED');
  if(response.status===204)return null;
  return response.json();
}
export async function sendInventoryBreakdownGmail(user:AuthenticatedUser,authorization:string,movementId:string) {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(movementId))throw fail('Movimiento no válido.',400,'INVENTORY_BREAKDOWN_INVALID');
  // Caller RLS plus creator binding; input never supplies sender, recipient or body.
  const [movement]=await database('inventory_movements?'+new URLSearchParams({select:'id,park_id,item_id,tipo,destino,observaciones,foto_paths,created_by,created_by_name,created_at',id:'eq.'+movementId,created_by:'eq.'+user.id,limit:'1'}),undefined,authorization);
  if(!movement||movement.created_by!==user.id||movement.tipo!=='Avería')throw fail('Solo el supervisor que registró esta avería puede enviar su aviso.',403,'INVENTORY_BREAKDOWN_FORBIDDEN');
  const [[park],[item],[profile],[settings],connection]=await Promise.all([
    database('inventory_parks?'+new URLSearchParams({select:'id,coordinator_email',id:'eq.'+movement.park_id,limit:'1'}),undefined,authorization),
    database('inventory_items?'+new URLSearchParams({select:'id,codigo,nombre,marca,modelo,numero_serie,matricula',id:'eq.'+movement.item_id,park_id:'eq.'+movement.park_id,limit:'1'}),undefined,authorization),
    database('profiles?'+new URLSearchParams({select:'id,active',id:'eq.'+user.id,limit:'1'})),
    database('user_settings?'+new URLSearchParams({select:'supervisor:settings->app->supervisor',user_id:'eq.'+user.id,limit:'1'})),
    getConnection(user.id),
  ]);
  if(!park||!item||profile?.active!==true)throw fail('El supervisor o el equipo no están disponibles.',403,'INVENTORY_BREAKDOWN_FORBIDDEN');
  const to=String(park.coordinator_email||'').trim();
  if(!/^[^@\s,<>]+@[^@\s,<>]+\.[^@\s,<>]+$/.test(to))throw fail('Configura un correo de mantenimiento válido en el parque.',400,'INVENTORY_BREAKDOWN_RECIPIENT_INVALID');
  if(!connection?.refresh_token_encrypted)throw fail('Autoriza Gmail del supervisor en Configuración para enviar el aviso.',409,'GMAIL_NOT_CONNECTED');
  const expected=String(settings?.supervisor?.email||'').trim().toLowerCase();
  if(expected&&expected!==String(connection.email).toLowerCase())throw fail('El Gmail autorizado no coincide con el correo configurado del supervisor. Vuelve a autorizar la cuenta correcta.',409,'GMAIL_SENDER_MISMATCH');
  if(!String(connection.scope||'').split(/\s+/).some(s=>['gmail.send','https://www.googleapis.com/auth/gmail.send','https://mail.google.com/'].includes(s)))throw fail('Vuelve a autorizar Gmail con permiso de envío.',403,'GMAIL_SEND_PERMISSION_REQUIRED');
  const accessToken=await refreshGoogleAccessToken(decryptToken(connection.refresh_token_encrypted));
  const origin=new URL(process.env.INVENTORY_APP_URL||'https://gestionprofea.vercel.app/');
  if(origin.protocol!=='https:'||origin.username||origin.password)throw fail('Revisa la dirección de la aplicación.',503,'INVENTORY_BREAKDOWN_URL_INVALID');
  const link=new URL('/',origin.origin);link.searchParams.set('inventoryItem',item.id);
  const claim=await database('rpc/inventory_claim_breakdown_mail',{p_movement_id:movementId,p_actor:user.id});
  if(!claim.claimed){
    if(claim.status==='sent'&&claim.messageId)return {ok:true,delivery:'sent',messageId:claim.messageId,from:connection.email,provider:'gmail',alreadySent:true};
    if(['sending','uncertain'].includes(claim.status)&&String(connection.scope||'').includes('gmail.readonly')){
      const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?'+new URLSearchParams({q:`in:sent rfc822msgid:inventory-breakdown-${movementId}@gestionprofea.vercel.app`,maxResults:'2'}),{headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(15000)});
      const result=await response.json().catch(()=>({}));
      if(response.ok&&result.messages?.length===1&&typeof result.messages[0].id==='string'){
        const messageId=result.messages[0].id;
        await database('rpc/inventory_finish_breakdown_mail',{p_movement_id:movementId,p_actor:user.id,p_status:'sent',p_message:messageId,p_code:null});
        return {ok:true,delivery:'sent',messageId,from:connection.email,provider:'gmail',alreadySent:true};
      }
    }
    throw fail(claim.status==='failed'?'Se ha alcanzado el límite de reintentos. Revisa el aviso.':'El envío está en curso o su resultado es incierto. Comprueba Enviados antes de repetirlo.',409,'GMAIL_BREAKDOWN_UNCERTAIN');
  }
  const subject=`AVERÍA MAQUINARIA · ${item.codigo||'SIN CÓDIGO'} · ${item.nombre} · ${movement.destino}`;
  const body=['AVISO DE AVERÍA DE MAQUINARIA / HERRAMIENTA','',`Equipo: ${item.nombre}`,`Código: ${item.codigo||'-'}`,`Marca / modelo: ${item.marca||'-'} / ${item.modelo||'-'}`,`Matrícula / serie: ${item.matricula||'-'} / ${item.numero_serie||'-'}`,`Ubicación / obra: ${movement.destino}`,`Fecha: ${movement.created_at}`,`Supervisor: ${movement.created_by_name||connection.email}`,'','Descripción de la avería:',String(movement.observaciones||'').replace('[Aviso mantenimiento preparado]','').trim(),'',`Fotografías registradas: ${Array.isArray(movement.foto_paths)?movement.foto_paths.length:0}`,`Trazabilidad del equipo (requiere acceso): ${link}`].join('\n');
  const mime=[`From: ${String(connection.email).replace(/[\r\n]/g,'')}`,`To: ${to}`,`Message-ID: <inventory-breakdown-${movementId}@gestionprofea.vercel.app>`,`Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,'MIME-Version: 1.0','Content-Type: text/plain; charset="UTF-8"','Content-Transfer-Encoding: base64','',Buffer.from(body).toString('base64').replace(/(.{76})/g,'$1\r\n'),''].join('\r\n');
  let acceptedId:string|null=null;
  try{
    const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({raw:Buffer.from(mime).toString('base64url')}),signal:AbortSignal.timeout(20000)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok){
      const code=response.status===401?'GMAIL_RECONNECT_REQUIRED':response.status===403?'GMAIL_SEND_PERMISSION_REQUIRED':response.status===429?'GMAIL_RATE_LIMITED':'GMAIL_BREAKDOWN_UNCERTAIN';
      throw Object.assign(fail('Gmail no ha confirmado el aviso de avería. Revisa su estado antes de reintentar.',response.status>=500?502:response.status,code),{definite:response.status<500});
    }
    if(typeof result.id!=='string'||!result.id.trim())throw fail('Gmail no confirmó el envío. Comprueba Enviados.',502,'GMAIL_BREAKDOWN_UNCERTAIN');
    acceptedId=result.id;
    await database('rpc/inventory_finish_breakdown_mail',{p_movement_id:movementId,p_actor:user.id,p_status:'sent',p_message:acceptedId,p_code:null});
  }catch(error:any){
    if(acceptedId)throw fail('Gmail aceptó el aviso, pero no se pudo guardar la confirmación. Comprueba Enviados; no lo reenvíes.',503,'GMAIL_BREAKDOWN_UNCERTAIN');
    await database('rpc/inventory_finish_breakdown_mail',{p_movement_id:movementId,p_actor:user.id,p_status:error.definite?'failed':'uncertain',p_message:null,p_code:error.code||'GMAIL_BREAKDOWN_UNCERTAIN'});
    throw error.code?error:fail('No se pudo confirmar el aviso. Comprueba Enviados antes de repetirlo.',502,'GMAIL_BREAKDOWN_UNCERTAIN');
  }
  await touchSent(user.id);
  return {ok:true,delivery:'sent',messageId:acceptedId,from:connection.email,provider:'gmail'};
}
