import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {configuration,googleBoundary,runLocalVisitMail,authorizeLocalGmail} from './visitMailLocal.mjs';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'visit-local-'));
const marker='SYNTHETIC_CREDENTIAL_NEVER_LOG';
const config=configuration({VISIT_TEST_SENDER:'sender@example.test',VISIT_TEST_RECIPIENT:'recipient@example.test',GOOGLE_GMAIL_CLIENT_ID:marker,GOOGLE_GMAIL_CLIENT_SECRET:marker,VISIT_TEST_GMAIL_REFRESH_TOKEN:marker});
const logs=[],savedError=console.error;console.error=(...x)=>logs.push(JSON.stringify(x));
try{
 assert.throws(()=>configuration({GOOGLE_GMAIL_CLIENT_SECRET:marker}),e=>!e.message.includes(marker)&&e.message.includes('Falta configuración'));
 assert.throws(()=>configuration({VISIT_TEST_SENDER:'x\r\nBcc: other@example.test',VISIT_TEST_RECIPIENT:'recipient@example.test',GOOGLE_GMAIL_CLIENT_ID:marker,GOOGLE_GMAIL_CLIENT_SECRET:marker,VISIT_TEST_GMAIL_REFRESH_TOKEN:marker}));
 const calls=[];
 const nativeFetch=async(url,init)=>{
  calls.push(String(url));
  if(String(url)==='https://oauth2.googleapis.com/token')return new Response(JSON.stringify({access_token:marker}),{status:200});
  if(String(url)==='https://openidconnect.googleapis.com/v1/userinfo')return new Response(JSON.stringify({email:config.email,email_verified:true}),{status:200});
  assert.equal(String(url),'https://gmail.googleapis.com/gmail/v1/users/me/messages/send','no Supabase or other external requests');
  const mime=Buffer.from(JSON.parse(init.body).raw,'base64url').toString();assert(mime.includes('To: '+config.recipient));
  return new Response(JSON.stringify({id:'synthetic-gmail-id'}),{status:200});
 };
 const ledger=path.join(dir,'attempt.local');
 const result=await runLocalVisitMail(config,{nativeFetch,ledger});
 assert.equal(result.providerAccepted,true);assert.equal(result.persistedLocally,true);assert.equal(result.replayWithoutDuplicate,true);
 assert.equal(calls.filter(u=>u.endsWith('/messages/send')).length,1);
 const beforeRestart=calls.length;await assert.rejects(()=>runLocalVisitMail(config,{nativeFetch,ledger}),/Ya existe un intento/);assert.equal(calls.length,beforeRestart,'restart performs no Google operations when an attempt exists');
 const event=JSON.parse(await fs.readFile(ledger));assert.equal(event.status,'accepted');assert.equal(event.recordId,result.recordId);assert.equal(event.version,1);assert(!JSON.stringify(event).includes(marker));assert.equal((await fs.stat(ledger)).mode&0o777,0o600);
 const boundary=googleBoundary({nativeFetch,localFetch:()=>{throw Error('LOCAL_ONLY');},config,ledger});
 await boundary('https://oauth2.googleapis.com/token');
 const body={raw:Buffer.from('From: '+config.email+'\r\nTo: '+config.recipient+'\r\n\r\nTest').toString('base64url')};
 await assert.rejects(()=>boundary('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{body:JSON.stringify(body)}),/Ya existe un intento/);
 const alien={raw:Buffer.from('From: '+config.email+'\r\nTo: other@example.test\r\n\r\nTest').toString('base64url')};
 await assert.rejects(()=>boundary('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{body:JSON.stringify(alien)}),/direcciones autorizadas/);
 const duplicate={raw:Buffer.from('From: '+config.email+'\r\nTo: '+config.recipient+'\r\nTo: other@example.test\r\n\r\nTest').toString('base64url')};
 await assert.rejects(()=>boundary('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{body:JSON.stringify(duplicate)}),/direcciones autorizadas/);
 const unknown=googleBoundary({nativeFetch:async()=>new Response(JSON.stringify({access_token:marker,email:'alien@example.test',email_verified:true}),{status:200}),localFetch:()=>{},config,ledger:path.join(dir,'unknown.local')});
 assert.equal((await unknown('https://oauth2.googleapis.com/token')).status,401);
 await assert.rejects(()=>unknown('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{body:JSON.stringify(body)}),/no está verificada/);
 let sends=0;
 const lost=googleBoundary({nativeFetch:async(url)=>{if(String(url).endsWith('/token'))return new Response(JSON.stringify({access_token:marker}));if(String(url).endsWith('/userinfo'))return new Response(JSON.stringify({email:config.email,email_verified:true}));sends++;throw Error(marker);},localFetch:()=>{},config,ledger:path.join(dir,'uncertain.local')});
 await lost('https://oauth2.googleapis.com/token');await assert.rejects(()=>lost('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{body:JSON.stringify(body)}),/Resultado incierto/);
 await assert.rejects(()=>lost('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{body:JSON.stringify(body)}),/Ya existe un intento/);assert.equal(sends,1);assert.equal(JSON.parse(await fs.readFile(path.join(dir,'uncertain.local'))).status,'uncertain');
 assert(!JSON.stringify(logs).includes(marker));
 const httpFetch=globalThis.fetch,configFile=path.join(dir,'oauth.local');
 await fs.writeFile(configFile,'VISIT_TEST_GMAIL_REFRESH_TOKEN=\n',{mode:0o600});let oauthSends=0;
 const oauth=await authorizeLocalGmail(config,{configFile,port:0,nativeFetch:async(url)=>{
  if(String(url)==='https://oauth2.googleapis.com/token')return new Response(JSON.stringify({access_token:marker,refresh_token:marker,scope:'openid email https://www.googleapis.com/auth/gmail.send'}));
  if(String(url)==='https://openidconnect.googleapis.com/v1/userinfo')return new Response(JSON.stringify({email:config.email,email_verified:true}));
  oauthSends++;throw Error('Forbidden in OAuth');
 }});
 try{
  const start=await httpFetch('http://127.0.0.1:'+oauth.port+'/connect',{redirect:'manual'});assert.equal(start.status,302);
  const authorization=new URL(start.headers.get('location'));assert.equal(authorization.hostname,'accounts.google.com');assert.equal(authorization.searchParams.get('redirect_uri'),'http://localhost:'+oauth.port+'/api/gmail-oauth-callback');
  const callback=await httpFetch('http://127.0.0.1:'+oauth.port+'/api/gmail-oauth-callback?code=synthetic-code&state='+encodeURIComponent(authorization.searchParams.get('state')));assert.equal(callback.status,200);assert(!(await callback.text()).includes(marker));
  assert((await fs.readFile(configFile,'utf8')).includes('VISIT_TEST_GMAIL_REFRESH_TOKEN='+marker));assert.equal((await fs.stat(configFile)).mode&0o777,0o600);assert.equal(oauthSends,0);
 }finally{await oauth.close();}
 console.log('PASS: local PostgreSQL → real app handler → controlled Google boundary, account/recipient allowlist, atomic durable one-send guard, restart/network protection and minimal audit. Google simulated; zero real emails.');
}finally{console.error=savedError;await fs.rm(dir,{recursive:true,force:true});}
