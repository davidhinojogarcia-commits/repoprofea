import assert from 'node:assert/strict';
process.env.SUPABASE_SERVICE_ROLE_KEY='service-fixture';process.env.GOOGLE_GMAIL_CLIENT_ID='client';process.env.GOOGLE_GMAIL_CLIENT_SECRET='secret';process.env.GMAIL_TOKEN_ENCRYPTION_KEY='inventory-fixture-key';
const oauth=await import('../src/server/gmailOAuth');
const {default:handler}=await import('../api/gmail');
const owner='00000000-0000-0000-0000-000000000001',guest='00000000-0000-0000-0000-000000000002',movementId='00000000-0000-0000-0000-000000000010';
let state:any=null,sends:any[]=[],providerAccepted=false,auth=true,active=true,found=true,creator=owner,connected=true,scope='https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',configuredEmail='supervisor@example.test',recipient='mechanic@example.test',mode='ok',persistFailure=false;
const connection={user_id:owner,email:'supervisor@example.test',scope,refresh_token_encrypted:oauth.encryptToken('owner-refresh')};
const nativeFetch=globalThis.fetch;
globalThis.fetch=(async(input:any,options:any={})=>{
 const url=String(input),params=new URL(url).searchParams;
 if(url.includes('/auth/v1/user'))return Response.json(auth?{id:owner,email:'personal-login@example.test'}:{},{status:auth?200:401});
 if(url.includes('/rest/v1/inventory_movements?')){assert.equal(options.headers.Authorization,'Bearer fixture-session');assert.equal(params.get('created_by'),'eq.'+owner);return Response.json(found?[{id:movementId,park_id:'park',item_id:'item',tipo:'Avería',destino:'Obra A',observaciones:'No arranca',foto_paths:['photo'],created_by:creator,created_by_name:'Supervisor A',created_at:'2026-10-19T10:00:00Z'}]:[]);}
 if(url.includes('/rest/v1/inventory_parks?'))return Response.json([{id:'park',coordinator_email:recipient}]);
 if(url.includes('/rest/v1/inventory_items?'))return Response.json([{id:'item',nombre:'Martillo',codigo:'M1'}]);
 if(url.includes('/rest/v1/profiles?'))return Response.json([{id:owner,active}]);
 if(url.includes('/rest/v1/user_settings?')){assert.equal(params.get('user_id'),'eq.'+owner);return Response.json([{supervisor:{email:configuredEmail}}]);}
 if(url.includes('/rest/v1/gmail_connections')){if(options.method==='PATCH')return new Response(null,{status:204});assert.equal(params.get('user_id'),'eq.'+owner);return Response.json(connected?[{...connection,scope}]:[]);}
 if(url.includes('oauth2.googleapis.com/token'))return Response.json(mode==='expired'?{error:'invalid_grant'}:{access_token:'supervisor-token'},{status:mode==='expired'?400:200});
 if(url.includes('/rpc/inventory_claim_breakdown_mail')){const body=JSON.parse(options.body);assert.equal(body.p_actor,owner);if(!state||state.status==='failed'){state={status:'sending',messageId:null};return Response.json({claimed:true,...state});}return Response.json({claimed:false,...state});}
 if(url.includes('/rpc/inventory_finish_breakdown_mail')){const body=JSON.parse(options.body);if(persistFailure&&body.p_status==='sent'){persistFailure=false;return Response.json({message:'temporary persistence failure'},{status:500});}state={status:body.p_status,messageId:body.p_message};return Response.json(null);}
 if(url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')){assert(params.get('q')!.includes('rfc822msgid:inventory-breakdown-'+movementId));return Response.json({messages:providerAccepted?[{id:'gmail-message'}]:[]});}
 if(url.endsWith('/gmail/v1/users/me/messages/send')){
   assert.equal(options.headers.Authorization,'Bearer supervisor-token');sends.push(JSON.parse(options.body));
   if(mode==='quota')return Response.json({error:{}},{status:429});
   if(mode==='provider401')return Response.json({error:{}},{status:401});
   if(mode==='missing-id')return Response.json({});
   providerAccepted=true;if(mode==='lost-response')throw new TypeError('Failed to fetch');
   return Response.json({id:'gmail-message'});
 }
 throw new Error('Unexpected test endpoint '+url);
}) as typeof fetch;
const request=async(body:any={movementId})=>{const res:any={statusCode:200,body:null,setHeader(){},status(n:number){this.statusCode=n;return this;},json(data:any){this.body=data;return this;}};await handler({method:'POST',query:{action:'send-inventory-breakdown'},headers:{authorization:'Bearer fixture-session',host:'attacker.invalid'},body},res);return res;};
const reset=()=>{state=null;providerAccepted=false;mode='ok';};
try{
 let result=await request({movementId,to:'attacker@example.test',from:'personal@example.test',body:'forged'});assert.equal(result.statusCode,200);assert.equal(result.body.from,connection.email);assert.equal(state.status,'sent');
 const mime=Buffer.from(sends[0].raw,'base64url').toString('utf8');assert(mime.startsWith('From: supervisor@example.test\r\nTo: mechanic@example.test'));assert(!mime.includes('attacker'));const body=Buffer.from(mime.split('\r\n\r\n')[1].replace(/\r\n/g,''),'base64').toString('utf8');assert(body.includes('No arranca')&&body.includes('Supervisor A'));assert(!body.includes('forged'));
 const sent=sends.length;await request();assert.equal(sends.length,sent,'accepted send never repeats');
 for(const [change,restore,code] of [
   [()=>{auth=false;},()=>{auth=true;},undefined],
   [()=>{found=false;},()=>{found=true;},'INVENTORY_BREAKDOWN_FORBIDDEN'],
   [()=>{creator=guest;},()=>{creator=owner;},'INVENTORY_BREAKDOWN_FORBIDDEN'],
   [()=>{active=false;},()=>{active=true;},'INVENTORY_BREAKDOWN_FORBIDDEN'],
   [()=>{connected=false;},()=>{connected=true;},'GMAIL_NOT_CONNECTED'],
   [()=>{configuredEmail='other@example.test';},()=>{configuredEmail=connection.email;},'GMAIL_SENDER_MISMATCH'],
   [()=>{recipient='bad';},()=>{recipient='mechanic@example.test';},'INVENTORY_BREAKDOWN_RECIPIENT_INVALID'],
   [()=>{scope='gmail.readonly';},()=>{scope=connection.scope;},'GMAIL_SEND_PERMISSION_REQUIRED'],
   [()=>{mode='expired';},()=>{mode='ok';},'GMAIL_RECONNECT_REQUIRED'],
 ] as const){change();result=await request();assert(result.statusCode>=400);if(code)assert.equal(result.body.code,code);restore();}
 assert.equal(sends.length,sent,'authorization and recipient checks stop before Gmail');
 reset();await Promise.all([request(),request()]);assert.equal(sends.length,sent+1,'persistent claim stops concurrent duplicate');
 reset();mode='quota';result=await request();assert.equal(result.body.code,'GMAIL_RATE_LIMITED');assert.equal(state.status,'failed');mode='ok';await request();assert.equal(state.status,'sent');
 reset();mode='missing-id';await request();assert.equal(state.status,'uncertain');const beforeMissing=sends.length;await request();assert.equal(sends.length,beforeMissing,'2xx without ID does not trigger resend');
 reset();mode='lost-response';await request();assert.equal(state.status,'uncertain');const beforeLost=sends.length;result=await request();assert.equal(result.body.delivery,'sent');assert.equal(sends.length,beforeLost,'lost Gmail response reconciled, not resent');
 reset();persistFailure=true;await request();assert.equal(state.status,'sending');const beforePersist=sends.length;result=await request();assert.equal(result.body.delivery,'sent');assert.equal(sends.length,beforePersist,'lost database acknowledgement reconciled safely');
 console.log('PASS real Gmail handler: stored mechanic/supervisor sender, permissions, forged input, OAuth/scope/mismatch, provider acceptance, persistent concurrency, quota retry, missing ID and lost-response reconciliation. External transport simulated; no real emails.');
}finally{globalThis.fetch=nativeFetch;}
