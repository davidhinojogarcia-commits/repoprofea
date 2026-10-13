import assert from 'node:assert/strict';
import {createForemanPushHandler,allowedPushEndpoint} from '../src/server/foremanPushHandler';
const documentId='00000000-0000-0000-0000-000000000020';
const env={FOREMAN_PUSH_VAPID_PUBLIC_KEY:'public',FOREMAN_PUSH_VAPID_PRIVATE_KEY:'NEVER_EXPOSE',FOREMAN_PUSH_VAPID_SUBJECT:'https://gestionprofea.vercel.app'};
let authenticated=true,claimError=false,status=201,finishError=false,endpoint='https://fcm.googleapis.com/device';let calls:any[]=[];
const handler=createForemanPushHandler({env,client:()=>({auth:{getUser:async()=>({data:{user:authenticated?{id:'owner'}:null}})},rpc:async(name:string,args:any)=>{
 calls.push({name,args});return name==='claim_foreman_document_push'?{data:{obra:'A',period:'2026-10-Q1',documentType:'inicio',assignedAt:'2026-10-13',total:1,accepted:0,inFlight:0,deliveries:[{id:'delivery',lease:'lease',endpoint,keys:{p256dh:'p',auth:'a'}}]},error:claimError?{}:null}:{error:finishError?{}:null};
}}),send:async(subscription:any,payload:any,options:any)=>{calls.push({subscription,payload:JSON.parse(payload),options});if(status===410)throw {statusCode:410};return {statusCode:status} as any;}});
async function run(method='POST',body:any={documentId},authorization='Bearer JWT'){
 let code=0,result:any;await handler({method,body,headers:{authorization}},{setHeader(){},status(n:number){code=n;return this;},json(v:any){result=v;}});return {code,result};
}
assert.equal((await run('GET')).result.publicKey,'public');assert.ok(!JSON.stringify((await run('GET')).result).includes(env.FOREMAN_PUSH_VAPID_PRIVATE_KEY));
assert.equal((await run('POST',{},'')).code,401);
assert.equal((await run('POST',{documentId:'bad'})).code,400);
authenticated=false;assert.equal((await run()).code,401);authenticated=true;
claimError=true;assert.equal((await run()).code,403);claimError=false;
let result=await run();assert.equal(result.result.accepted,1);assert.equal(result.result.status,'accepted');
let send=calls.find(c=>c.payload);assert.equal(send.payload.url,`/encargados?document=${documentId}`);assert.equal(send.options.TTL,86400);assert.ok(!JSON.stringify(send.payload).includes('JWT'));assert.ok(send.payload.body.includes('Incorporación'));
status=410;result=await run();assert.equal(result.result.failed,1);assert.equal(result.result.status,'partial');assert.equal(calls.at(-1).args.p_status_code,410);
status=201;finishError=true;assert.equal((await run()).result.accepted,0,'receipt persistence required');finishError=false;
endpoint='https://127.0.0.1/internal';calls=[];assert.equal((await run()).result.failed,1);assert.ok(!calls.some(c=>c.payload),'invalid endpoint never contacts network');
for(const bad of ['http://fcm.googleapis.com/x','https://fcm.googleapis.com.evil/x','https://user@fcm.googleapis.com/x','https://web.push.apple.com:444/x'])assert.equal(allowedPushEndpoint(bad),false);
console.log('PASS push handler: authentication, ownership denial, accepted receipt, failure/expiry handling, deep links, secret exclusion, bounded transport and SSRF denial.');
