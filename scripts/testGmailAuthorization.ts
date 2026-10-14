import assert from 'node:assert/strict';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service';
process.env.GOOGLE_GMAIL_CLIENT_ID = 'test-client';
process.env.GOOGLE_GMAIL_CLIENT_SECRET = 'test-secret';
process.env.GMAIL_TOKEN_ENCRYPTION_KEY = 'test-encryption';
const oauth = await import('../src/server/gmailOAuth');
const {default: handler} = await import('../api/gmail');
const {default: callback} = await import('../api/gmail-oauth-callback');
const nativeFetch = globalThis.fetch;
let googleStatus = 200, googleData: any = {access_token:'access'}, writes: any[] = [], reads = 0;
const row = {user_id:'owner',email:'supervisor@example.com',refresh_token_encrypted:oauth.encryptToken('refresh'),scope:'https://www.googleapis.com/auth/gmail.readonly'};
globalThis.fetch = (async (url: any, options: any = {}) => {
 const target = String(url);
 if(target.includes('/auth/v1/user')) return Response.json({id:'owner',email:row.email});
 if(target.includes('/rest/v1/gmail_connections')) {
  if(options.method === 'POST') { writes.push(JSON.parse(options.body)); return new Response(null,{status:204}); }
  assert(!options.method || options.method === 'GET', 'recovery must not delete a stored connection');
  return Response.json([row]);
 }
 if(target.includes('oauth2.googleapis.com/token')) {
  const body = new URLSearchParams(options.body);
  if(body.get('grant_type') === 'authorization_code') return Response.json({access_token:'new-access',scope:'gmail.send gmail.readonly'});
  return Response.json(googleData,{status:googleStatus});
 }
 if(target.includes('openidconnect.googleapis.com')) return Response.json({email:row.email});
 if(target.includes('gmail.googleapis.com')) { reads++; return Response.json({messages:[]}); }
 throw new Error('Unexpected endpoint: '+target);
}) as typeof fetch;
const response = () => ({statusCode:200,headers:{} as any,body:null as any,setHeader(k:string,v:string){this.headers[k]=v;},status(n:number){this.statusCode=n;return this;},json(data:any){this.body=data;return this;},end(){}});
async function request(action:string, method='GET', body:any={}) {
 const res=response(); await handler({method,query:{action},headers:{authorization:'Bearer session',host:'gestionprofea.vercel.app'},body},res);return res;
}
try {
 assert.equal((await request('status')).body.connected,true);
 googleStatus=400;googleData={error:'invalid_grant',error_description:'Token has been expired or revoked.'};
 const status=await request('status');assert.equal(status.body.connected,false);assert.equal(status.body.reconnectRequired,true);assert.equal(status.body.email,row.email);
 assert(!JSON.stringify(status.body).includes(row.refresh_token_encrypted));
 const scan=await request('scan-administrative','POST',{administrativeEmail:'admin@example.com'});
 assert.equal(scan.statusCode,401);assert.equal(scan.body.code,'GMAIL_RECONNECT_REQUIRED');assert.equal(reads,0);
 const start=await request('start','POST',{email:row.email});const url=new URL(start.body.authorizationUrl);
 assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('prompt'),'consent');assert(url.searchParams.get('scope')?.includes('gmail.readonly'));
 let result=response();await callback({method:'GET',query:{code:'code',state:url.searchParams.get('state')},headers:{host:'gestionprofea.vercel.app'}},result);
 assert(new URL(result.headers.Location,'https://local').searchParams.get('gmail')==='error','omitted new refresh token cannot falsely confirm an expired one');assert.equal(writes.length,0);
 googleStatus=200;googleData={access_token:'renewed-access'};
 result=response();await callback({method:'GET',query:{code:'code',state:url.searchParams.get('state')},headers:{host:'gestionprofea.vercel.app'}},result);
 assert.equal(new URL(result.headers.Location,'https://local').searchParams.get('gmail'),'connected');assert.equal(writes[0].scope,'gmail.send gmail.readonly');assert.equal(writes[0].refresh_token_encrypted,row.refresh_token_encrypted);
 googleStatus=503;googleData={error:'temporarily_unavailable'};
 await assert.rejects(oauth.refreshGoogleAccessToken('refresh'),(e:any)=>e.status===503&&e.code==='GMAIL_TEMPORARILY_UNAVAILABLE');
 googleStatus=401;googleData={error:'invalid_client'};
 await assert.rejects(oauth.refreshGoogleAccessToken('refresh'),(e:any)=>e.status===503&&e.code==='GMAIL_OAUTH_CONFIG_ERROR');
 console.log('PASS Gmail: real renewal, expired status, safe reconnect, no false callback success, updated scopes, separate temporary/config errors.');
} finally {globalThis.fetch=nativeFetch;}
