import assert from 'node:assert/strict';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';process.env.GOOGLE_GMAIL_CLIENT_ID='test-client';process.env.GOOGLE_GMAIL_CLIENT_SECRET='test-secret';process.env.GMAIL_TOKEN_ENCRYPTION_KEY='test-encryption';
const oauth=await import('../src/server/gmailOAuth');const {default:handler}=await import('../api/gmail');
const id='00000000-0000-0000-0000-000000000010',owner='00000000-0000-0000-0000-000000000001',guest='00000000-0000-0000-0000-000000000002';
const invitation={id,park_id:'park',invited_by:owner,invited_user_id:guest,invited_email:'guest@example.com',status:'pending'};
const connection={user_id:owner,email:'supervisor@example.com',refresh_token_encrypted:oauth.encryptToken('refresh'),scope:'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly'};
let auth=true,found=true,member=true,sharesDenied=false,callerActive=true,recipientActive=true,recipientEmail=invitation.invited_email,connected=true,scope=connection.scope,googleError=false,providerStatus=200,providerBody:any={id:'message-1'},lookups=0,sends:any[]=[],touches=0,refreshes=0;
const nativeFetch=globalThis.fetch;
globalThis.fetch=(async(url:any,options:any={})=>{
 const target=String(url);
 if(target.includes('/auth/v1/user'))return Response.json(auth?{id:owner,email:connection.email}:{error:'Invalid'}, {status:auth?200:401});
 if(target.includes('/rest/v1/inventory_park_invitations')){lookups++;const params=new URL(target).searchParams;assert.equal(params.get('invited_by'),'eq.'+owner);assert.equal(params.get('status'),'eq.pending');assert.equal(params.get('id'),'eq.'+id);return Response.json(found?[invitation]:[]);}
 if(target.includes('/rest/v1/rpc/inventory_list_park_shares')){assert.equal(options.headers.Authorization,'Bearer test-session');assert.equal(JSON.parse(options.body).p_park_id,'park');if(sharesDenied)return Response.json({message:'Sin permisos'},{status:400});return Response.json(member?[{user_id:owner,status:'accepted',role:'responsable',is_owner:true}]:[]);}
 if(target.includes('/rest/v1/profiles'))return Response.json([{id:owner,active:callerActive,email:connection.email},{id:guest,active:recipientActive,email:recipientEmail}]);
 if(target.includes('/rest/v1/gmail_connections')){if(options.method==='PATCH'){touches++;return new Response(null,{status:204});}assert.equal(new URL(target).searchParams.get('user_id'),'eq.'+owner);return Response.json(connected?[{...connection,scope}]:[]);}
 if(target.includes('oauth2.googleapis.com/token')){refreshes++;return Response.json(googleError?{error:'invalid_grant'}:{access_token:'test-access'},{status:googleError?400:200});}
 if(target.includes('gmail.googleapis.com/gmail/v1/users/me/messages/send')){assert.equal(options.headers.Authorization,'Bearer test-access');sends.push(JSON.parse(options.body));return Response.json(providerBody,{status:providerStatus});}
 throw Error('Unexpected endpoint '+target);
}) as typeof fetch;
const response=()=>({statusCode:200,body:null as any,headers:{} as any,setHeader(k:string,v:string){this.headers[k]=v;},status(n:number){this.statusCode=n;return this;},json(body:any){this.body=body;return this;}});
const request=async(body:any={invitationId:id},action='send-inventory-invite')=>{const res=response();await handler({method:'POST',query:{action},headers:{authorization:'Bearer test-session',host:'attacker.invalid'},body},res);return res;};
try {
 let res=await request({invitationId:id,to:'attacker@example.com',url:'https://attacker.invalid/?token=secret'});assert.equal(res.statusCode,200);assert.equal(res.body.provider,'gmail');assert.equal(res.body.from,connection.email);assert.equal(touches,1);
 const mime=Buffer.from(sends[0].raw,'base64url').toString('utf8');assert(mime.startsWith('To: guest@example.com\r\n'));assert(!mime.includes('attacker'));const text=Buffer.from(mime.split('\r\n\r\n')[1].replace(/\r\n/g,''),'base64').toString('utf8');assert(text.includes('https://gestionprofea.vercel.app/?inventoryInvite='+id));assert(text.includes('Aceptar y compartir'));assert(!text.includes('attacker'));assert(!text.includes('test-access'));assert.equal(invitation.status,'pending','sending never grants access');
 const baseline=sends.length;
 auth=false;res=await request();assert.equal(res.statusCode,401);auth=true;
 res=await request({invitationId:'invalid'});assert.equal(res.statusCode,400);
 found=false;res=await request();assert.equal(res.statusCode,404);found=true;
 invitation.invited_by=guest;res=await request();assert.equal(res.statusCode,404);invitation.invited_by=owner;
 invitation.status='accepted';res=await request();assert.equal(res.statusCode,404);invitation.status='pending';
 member=false;res=await request();assert.equal(res.statusCode,403);member=true;
 sharesDenied=true;res=await request();assert.equal(res.body.code,'INVENTORY_INVITE_FORBIDDEN');sharesDenied=false;
 callerActive=false;res=await request();assert.equal(res.statusCode,403);callerActive=true;
 recipientActive=false;res=await request();assert.equal(res.statusCode,409);recipientActive=true;
 recipientEmail='changed@example.com';res=await request();assert.equal(res.statusCode,409);recipientEmail=invitation.invited_email;
 connected=false;res=await request();assert.equal(res.body.code,'GMAIL_NOT_CONNECTED');connected=true;
 scope='https://www.googleapis.com/auth/gmail.readonly';res=await request();assert.equal(res.body.code,'GMAIL_SEND_PERMISSION_REQUIRED');scope=connection.scope;
 googleError=true;res=await request();assert.equal(res.body.code,'GMAIL_RECONNECT_REQUIRED');googleError=false;
 assert.equal(sends.length,baseline,'all denied requests stop before sending');
 providerStatus=503;res=await request();assert.equal(res.statusCode,502);assert.equal(res.body.code,'GMAIL_INVITE_SEND_UNCONFIRMED');assert.equal(touches,1);
 providerStatus=200;providerBody={};res=await request();assert.equal(res.statusCode,502,'2xx without message ID never confirms sending');assert.equal(touches,1);
 providerStatus=401;res=await request();assert.equal(res.body.code,'GMAIL_RECONNECT_REQUIRED');
 providerStatus=403;providerBody={error:{errors:[{reason:'insufficientPermissions'}]}};res=await request();assert.equal(res.body.code,'GMAIL_SEND_PERMISSION_REQUIRED');
 providerStatus=429;res=await request();assert.equal(res.body.code,'GMAIL_RATE_LIMITED');
 providerStatus=200;
 providerBody={id:'pdf-message'};res=await request({to:'admin@example.com',subject:'PDF regression',body:'Documento',attachments:[{filename:'documento.pdf',mimeType:'application/pdf',dataBase64:'dGVzdA=='}]},'send');assert.equal(res.statusCode,200);assert(Buffer.from(sends.at(-1).raw,'base64url').toString('utf8').includes('filename="documento.pdf"'));
 console.log('PASS real Gmail API handler: stored recipient, trusted link, own sender, required acceptance, auth/owner/member/profile/state isolation, missing scope/connection/expired OAuth, provider failure/unconfirmed send and existing PDF send regression. External services mocked; no real emails sent.');
} finally {globalThis.fetch=nativeFetch;}
