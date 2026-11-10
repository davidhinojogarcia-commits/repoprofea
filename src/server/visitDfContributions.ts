import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { VisitRecord } from '../lib/visitMinutes.js';

type Db = (path:string, body?:any, authorization?:string, method?:string)=>Promise<any>;
type Dependencies = {
  database:Db;
  digest:(text:string)=>string;
  sendCode:(ownerId:string,email:string,subject:string,body:string)=>Promise<void>;
  ownerRecord:(id:string,userId:string,auth:string,write?:boolean)=>Promise<VisitRecord>;
};
const invalid = (message:string,status=400) => Object.assign(new Error(message),{status});
const tokenPattern=/^[a-zA-Z0-9_-]{43}$/;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const q=(fields:Record<string,string>)=>new URLSearchParams(fields).toString();
const fresh=()=>randomBytes(32).toString('base64url');
const isDf=(role:unknown)=>/arquitect|direcci[oó]n facultativa|director(?:a)? de (?:obra|ejecuci[oó]n)|t[eé]cnic[oa] facultativ/i.test(String(role||''));
const sessionValid=(invite:any,session:unknown,digest:Dependencies['digest'])=>
  typeof session==='string'&&tokenPattern.test(session)&&invite.session_hash===digest(session)&&new Date(invite.session_expires_at||0).getTime()>Date.now();

async function guest(token:unknown,db:Db,digest:Dependencies['digest']) {
  if(typeof token!=='string'||!tokenPattern.test(token))throw invalid('Enlace no válido.',403);
  const [invite]=await db('visit_df_invitations?'+q({select:'*',token_hash:'eq.'+digest(token),limit:'1'}));
  if(!invite||invite.revoked||Date.parse(invite.expires_at)<=Date.now())throw invalid('Invitación caducada o revocada.',403);
  const [record]=await db('visit_minutes?'+q({select:'*',id:'eq.'+invite.record_id,limit:'1'}));
  if(!record||record.status!=='draft'||record.version!==invite.version)throw invalid('El acta ya no admite aportaciones.',403);
  const person=(record.state.participants||[]).find((p:any)=>p.id===invite.person_id);
  if(!person||!isDf(person.role)||person.email?.trim().toLowerCase()!==invite.email.toLowerCase())throw invalid('La invitación ya no está autorizada.',403);
  if(!await db('rpc/visit_minutes_owner_can_write',{p_owner:record.owner_id,p_work:record.obra_id}))throw invalid('Obra no disponible.',403);
  return {invite,record,person};
}

export async function handleDfGuest(body:any,res:any,deps:Dependencies) {
  const {database:db,digest}=deps;
  const action=String(body.action||'');
  const {invite,record}=await guest(body.token,db,digest);
  if(action==='df-challenge'){
    if(invite.requests>=10||Date.parse(invite.otp_requested_at||0)>Date.now()-60000)throw invalid('Espera un minuto antes de pedir otro código. El enlace admite un máximo de diez solicitudes.',429);
    const code=String(randomInt(0,1_000_000)).padStart(6,'0');
    const confirmed=await db('rpc/visit_df_challenge',{p_id:invite.id,p_hash:digest(invite.id+':'+code)});
    if(confirmed!==true)throw invalid('El acceso está limitado temporalmente. Solicita una nueva invitación si fuera necesario.',429);
    await deps.sendCode(record.owner_id,invite.email,'Código de redacción de acta · '+record.number,
      'Tu código de acceso es: '+code+'\n\nCaduca en 10 minutos. Introduce este código en la página de colaboración de Dirección Facultativa. No lo compartas.');
    return res.json({ok:true,message:'Código enviado al correo de la Dirección Facultativa.'});
  }
  if(action==='df-verify'){
    if(!/^\d{6}$/.test(String(body.code||'')))throw invalid('Introduce un código de seis dígitos.');
    const session=fresh();
    const success=await db('rpc/visit_df_verify',{p_id:invite.id,p_hash:digest(invite.id+':'+body.code),p_session_hash:digest(session)});
    if(success!==true)throw invalid('Código incorrecto, utilizado o caducado.',403);
    return res.json({ok:true,session,record:{number:record.number,worksite:record.worksite,date:record.visit_date}});
  }
  if(!sessionValid(invite,body.session,digest))throw invalid('Verifica tu correo para redactar los puntos.',401);
  if(action==='df-portal-get'){
    const contributions=await db('visit_df_contributions?'+q({
      select:'id,title,description,status,created_at',invitation_id:'eq.'+invite.id,order:'created_at.asc',limit:'100'
    }));
    return res.json({ok:true,record:{number:record.number,worksite:record.worksite,date:record.visit_date},contributions});
  }
  if(action==='df-submit'){
    const title=String(body.title||'').trim();
    const description=String(body.description||'').trim();
    if(title.length>200||description.length<1||description.length>20000)throw invalid('Redacta un punto válido de hasta 20.000 caracteres.');
    const id=await db('rpc/visit_df_submit',{
      p_id:invite.id,p_session_hash:digest(body.session),p_title:title,p_description:description
    });
    if(!uuidPattern.test(String(id||'')))throw invalid('No se pudo confirmar el envío del punto.',503);
    return res.json({ok:true,id,message:'Punto recibido. Queda pendiente de revisión por el supervisor.'});
  }
  throw invalid('Acción no autorizada.',403);
}

export async function handleDfOwner(body:any,res:any,deps:Dependencies,user:{id:string},auth:string){
  const {database:db,digest}=deps;
  const action=String(body.action||'');
  const r=await deps.ownerRecord(String(body.id||''),user.id,auth,true);
  if(r.status!=='draft')throw invalid('La colaboración solo está disponible en borradores.',409);
  if(action==='df-invite'){
    const person=r.state.participants.find(p=>p.id===body.personId);
    if(!person||!isDf(person.role)||!person.email?.trim())throw invalid('Selecciona una Dirección Facultativa identificada y con correo electrónico.',400);
    const email=person.email.trim().toLowerCase(),token=fresh();
    const old=await db('visit_df_invitations?'+q({select:'id',record_id:'eq.'+r.id,version:'eq.'+r.version,person_id:'eq.'+person.id,limit:'1'}));
    const data={email,token_hash:digest(token),expires_at:new Date(Date.now()+7*86400000).toISOString(),
      revoked:false,otp_hash:null,otp_expires_at:null,otp_requested_at:null,attempts:0,requests:0,session_hash:null,session_expires_at:null};
    if(old.length)await db('visit_df_invitations?'+q({id:'eq.'+old[0].id}),data,undefined,'PATCH');
    else await db('visit_df_invitations',{id:randomUUID(),record_id:r.id,version:r.version,person_id:person.id,...data});
    await db('visit_minutes_events',{record_id:r.id,version:r.version,actor:user.id,event:'df-invite-renewed',
      details:{personId:person.id}});
    const origin=new URL(process.env.VISIT_APP_URL||'https://gestionprofea.vercel.app/').origin;
    return res.json({ok:true,url:origin+'/#visit-df='+token,expiresAt:data.expires_at});
  }
  if(action==='df-revoke'){
    if(!uuidPattern.test(String(body.personId||'')))throw invalid('Participante no válido.');
    await db('visit_df_invitations?'+q({record_id:'eq.'+r.id,version:'eq.'+r.version,person_id:'eq.'+body.personId}),
      {revoked:true,otp_hash:null,session_hash:null},undefined,'PATCH');
    return res.json({ok:true});
  }
  if(action==='df-list'){
    const contributions=await db('visit_df_contributions?'+q({select:'id,person_id,title,description,status,created_at,reviewed_at',
      record_id:'eq.'+r.id,version:'eq.'+r.version,order:'created_at.asc',limit:'100'}));
    return res.json({ok:true,contributions});
  }
  if(action==='df-review'){
    if(!uuidPattern.test(String(body.contributionId||''))||typeof body.accept!=='boolean')
      throw invalid('Revisión no válida.');
    if(!Number.isInteger(body.revision)||body.revision!==r.revision)throw invalid('El borrador ha cambiado. Actualiza antes de incorporar.',409);
    const [c]=await db('visit_df_contributions?'+q({select:'id',id:'eq.'+body.contributionId,record_id:'eq.'+r.id,version:'eq.'+r.version,status:'eq.pending',limit:'1'}));
    if(!c)throw invalid('La aportación no está pendiente o no pertenece a esta acta.',409);
    const done=await db('rpc/visit_df_review',{p_id:c.id,p_owner:user.id,p_revision:r.revision,p_accept:body.accept});
    if(done!==true)throw invalid('No se pudo confirmar la revisión.',409);
    const updated=await deps.ownerRecord(r.id,user.id,auth,true);
    return res.json({ok:true,record:updated});
  }
  throw invalid('Acción no autorizada.',403);
}
