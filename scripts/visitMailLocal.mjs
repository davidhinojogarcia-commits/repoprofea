import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {visitTestServer} from './visitMinutesTestServer.mjs';
import {id,content,person} from './visitMinutesFixture.mjs';

const required=['VISIT_TEST_SENDER','VISIT_TEST_RECIPIENT','GOOGLE_GMAIL_CLIENT_ID','GOOGLE_GMAIL_CLIENT_SECRET','VISIT_TEST_GMAIL_REFRESH_TOKEN'];
export function configuration(env,{authorize=false}={}){
 const missing=required.filter(k=>(!authorize||k!=='VISIT_TEST_GMAIL_REFRESH_TOKEN')&&!env[k]?.trim());
 if(missing.length)throw Error('Falta configuración local: '+missing.join(', '));
 const email=s=>String(s).trim().toLowerCase();
 const sender=email(env.VISIT_TEST_SENDER),recipient=email(env.VISIT_TEST_RECIPIENT);
 if(![sender,recipient].every(s=>/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(s)))throw Error('Dirección de prueba inválida.');
 return {email:sender,recipient,clientId:env.GOOGLE_GMAIL_CLIENT_ID,clientSecret:env.GOOGLE_GMAIL_CLIENT_SECRET,refreshToken:env.VISIT_TEST_GMAIL_REFRESH_TOKEN};
}

// Only these two Google operations may leave this process. Database/auth requests
// are handled exclusively by the local PostgreSQL fixture, never by Supabase.
export function googleBoundary({nativeFetch,localFetch,config,ledger,context=()=>({}),onAccepted=()=>{}}){
 let verified=false;
 return async(url,init={})=>{
  const target=String(url);
  if(target==='https://oauth2.googleapis.com/token'){
   verified=false;
   const response=await nativeFetch(url,init);
   const token=await response.clone().json().catch(()=>({}));
   if(response.ok&&typeof token.access_token==='string'&&token.access_token){
    const profile=await nativeFetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});
    const account=await profile.json().catch(()=>({}));
    verified=profile.ok&&account.email_verified===true&&String(account.email||'').toLowerCase()===config.email;
    if(!verified)return new Response(JSON.stringify({error:'invalid_grant'}),{status:401});
   }
   return response;
  }
  if(target==='https://openidconnect.googleapis.com/v1/userinfo'&&verified)return nativeFetch(url,init);
  if(target==='https://gmail.googleapis.com/gmail/v1/users/me/messages/send'){
   if(!verified)throw Error('La cuenta Gmail no está verificada.');
   const raw=Buffer.from(JSON.parse(init.body).raw,'base64url').toString('utf8');
   const headers=raw.split('\r\n\r\n')[0];
   if((headers.match(/^To:/gmi)||[]).length!==1||(headers.match(/^From:/gmi)||[]).length!==1||headers.match(/^To: (.+)$/m)?.[1].trim()!==config.recipient||headers.match(/^From: (.+)$/m)?.[1].trim()!==config.email||/^(Cc|Bcc):/mi.test(headers))throw Error('Envío fuera de las direcciones autorizadas.');
   // The file survives process restart. Never remove it automatically or retry an
   // uncertain attempt: an accepted message must not be sent twice.
   const handle=await fs.open(ledger,'wx',0o600).catch(()=>{throw Error('Ya existe un intento registrado. Revisa su resultado antes de otra prueba.');});
   const event={...context(),operation:'visit-review-real-test',at:new Date().toISOString(),status:'sending'};
   await handle.writeFile(JSON.stringify(event));await handle.sync();
   try{
    const response=await nativeFetch(url,init);
    const result=await response.clone().json().catch(()=>({}));
    event.status=response.ok&&typeof result.id==='string'&&result.id.trim()?'accepted':response.status>=400&&response.status<500?'rejected':'uncertain';
    if(event.status==='accepted'){event.messageId=result.id;onAccepted();}
    if(!response.ok)event.errorCode='HTTP_'+response.status;
    await handle.truncate(0);await handle.write(JSON.stringify(event),0,'utf8');await handle.sync();
    return response;
   }catch{
    event.status='uncertain';event.errorCode='NETWORK_OR_ACKNOWLEDGEMENT';
    await handle.truncate(0);await handle.write(JSON.stringify(event),0,'utf8');await handle.sync();
    throw Error('Resultado incierto. No se repetirá el envío automáticamente.');
   }finally{await handle.close();}
  }
  if(target.startsWith('https://gmail.googleapis.com/')||target.startsWith('https://oauth2.googleapis.com/')||target.startsWith('https://openidconnect.googleapis.com/'))throw Error('Operación Google no habilitada en esta prueba.');
  return localFetch(url,init);
 };
}

export async function authorizeLocalGmail(config,{nativeFetch,configFile,port=8765}){
 process.env.VITE_SUPABASE_URL='https://local-visit-test.invalid';
 const env=await visitTestServer({gmailConnection:config});
 const localFetch=globalThis.fetch;
 globalThis.fetch=googleBoundary({nativeFetch,localFetch,config,ledger:'UNUSED_IN_AUTHORIZATION'});
 const invoke=async(handler,req)=>{
  let status=200,headers={},data;
  const res={setHeader(k,v){headers[k]=v;},status(v){status=v;return this;},json(v){data=v;return this;},send(v){data=v;return this;},end(v){data=v;return this;}};
  await handler(req,res);return {status,headers,data};
 };
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  try{
   const url=new URL(req.url,'http://localhost:'+port);
   if(url.pathname==='/connect'){
    const response=await invoke(env.gmailHandler,{method:'POST',query:{action:'start'},headers:{authorization:'Bearer user-1',host:'localhost:'+port,'x-forwarded-proto':'http'},body:{email:config.email}});
    if(response.status!==200||!response.data?.authorizationUrl)throw Error('No se pudo iniciar OAuth local.');
    res.writeHead(302,{Location:response.data.authorizationUrl});return res.end();
   }
   if(url.pathname==='/api/gmail-oauth-callback'){
    const response=await invoke(env.callbackHandler,{method:'GET',query:Object.fromEntries(url.searchParams),headers:{host:'localhost:'+port,'x-forwarded-proto':'http'}});
    const location=new URL(response.headers.Location||'/','http://localhost:'+port);
    if(location.searchParams.get('gmail')!=='connected')throw Error('Google no completó la autorización local. Revisa el consentimiento y la URL de retorno.');
    await env.db.exec('reset role');
    const connection=(await env.db.query('select * from gmail_connections where user_id=$1',[id(1)])).rows[0];
    if(connection.email!==config.email)throw Error('La cuenta de Google no coincide.');
    const token=env.decryptToken(connection.refresh_token_encrypted);
    const previous=await fs.readFile(configFile,'utf8');
    const updated=previous.replace(/^VISIT_TEST_GMAIL_REFRESH_TOKEN=.*(?:\r?\n|$)/m,'');
    await fs.chmod(configFile,0o600);await fs.writeFile(configFile,updated.trimEnd()+'\nVISIT_TEST_GMAIL_REFRESH_TOKEN='+token+'\n',{mode:0o600});
    res.setHeader('Content-Type','text/plain; charset=utf-8');return res.end('Gmail autorizado y guardado solo en el archivo local protegido. No se ha enviado ningún correo. Puedes cerrar esta ventana y detener el servidor.');
   }
   res.setHeader('Content-Type','text/plain; charset=utf-8');res.end('Prueba OAuth local de GestionProfea. Abre /connect para autorizar Gmail. No se envían correos desde este servidor.');
  }catch{res.statusCode=400;res.end('No se pudo completar OAuth local. Comprueba cliente, consentimiento y URL de retorno en Google. No se han enviado correos.');}
 });
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}
 catch(e){globalThis.fetch=localFetch;await env.cleanup();throw e;}
 port=server.address().port;
 return {port:server.address().port,close:async()=>{await new Promise(resolve=>server.close(resolve));globalThis.fetch=localFetch;await env.cleanup();}};
}

export async function runLocalVisitMail(config,{nativeFetch,ledger}){
 if(await fs.stat(ledger).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('Ya existe un intento registrado. Revisa su resultado antes de otra prueba.');
 // Never use production DB credentials, even if the parent shell has them.
 process.env.VITE_SUPABASE_URL='https://local-visit-test.invalid';
 process.env.VISIT_APP_URL='https://local-visit-test.invalid/';
 const env=await visitTestServer({gmailConnection:config});
 const localFetch=globalThis.fetch;let sends=0,recordId;
 globalThis.fetch=googleBoundary({nativeFetch,localFetch,config,ledger,context:()=>({recordId,version:1,personId:person().id}),onAccepted:()=>sends++});
 try{
  const invoke=async b=>{const response=await env.invoke(b);if(response.status!==200)throw Error('La app rechazó la operación: '+(response.data?.code||'HTTP_'+response.status));return response.data;};
  const c={...content,author:'PRUEBA TÉCNICA — sin validez de acta',authorEmail:config.email,purpose:'PRUEBA AUTORIZADA de correo de revisión. Documento sintético, sin instrucciones de obra reales.'};
  const p={...person(),email:config.recipient};
  const created=await invoke({action:'create',id:randomUUID(),operation:randomUUID(),content:c,participants:[p]});
  recordId=created.record.id;
  const request={action:'send-mail',id:created.record.id,version:created.record.version,revision:created.record.revision,operation:randomUUID(),kind:'review'};
  const result=await invoke(request);
  if(result.summary.accepted!==1||sends!==1)throw Error('Gmail no confirmó la aceptación. Consulta el registro local, sin reintentar a ciegas.');
  const replay=await invoke(request);
  if(replay.summary.accepted!==1||sends!==1)throw Error('No se pudo validar el reintento idempotente.');
  const rows=(await env.db.query('select status,message_id from visit_minutes_mail_jobs where record_id=$1',[created.record.id])).rows;
  if(rows.length!==1||rows[0].status!=='sent'||!rows[0].message_id)throw Error('No se confirmó la persistencia local del resultado.');
  return {recordId:created.record.id,version:created.record.version,providerAccepted:true,messageId:rows[0].message_id,persistedLocally:true,replayWithoutDuplicate:true,physicalReceipt:'PENDING',reviewLink:'LOCAL_TEST_ONLY — no portal público',database:'PostgreSQL PGlite local; transporte Supabase y autenticación simulados'};
 }finally{globalThis.fetch=localFetch;await env.cleanup();}
}
async function main(){
 const authorize=process.argv.includes('--authorize');
 const config=configuration(process.env,{authorize});
 if(authorize){
  const file=path.resolve(process.env.VISIT_TEST_CONFIG_FILE||'.env.visit-mail.local');
  if(!(await fs.lstat(file)).isFile()||!file.endsWith('.local'))throw Error('Utiliza un archivo regular .local protegido para OAuth.');
  const server=await authorizeLocalGmail(config,{nativeFetch:globalThis.fetch,configFile:file});
  console.log('OAuth local: abre http://localhost:8765/connect en este mismo equipo. No se ha enviado correo. Detén con Ctrl+C.');
  let closing=false;const close=async()=>{if(closing)return;closing=true;await server.close();};process.once('SIGINT',close);process.once('SIGTERM',close);return;
 }
 if(!process.argv.includes('--send')){console.log('Configuración local presente. No se ha enviado correo. Usa --send únicamente para la prueba autorizada.');return;}
 const result=await runLocalVisitMail(config,{nativeFetch:globalThis.fetch,ledger:path.resolve(process.env.VISIT_TEST_LEDGER||'.visit-mail-attempt.local')});
 console.log(JSON.stringify(result));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
