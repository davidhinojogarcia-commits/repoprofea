import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {visitTestServer} from './visitMinutesTestServer.mjs';
import {id,content,person} from './visitMinutesFixture.mjs';
const mode=process.argv[2]||'after',results=[];if(mode==='before'&&!process.env.VISIT_MAIL_BASE_REF)throw Error('Set VISIT_MAIL_BASE_REF to the baseline commit.');
for(const n of [1,4]){
 const env=await visitTestServer(mode==='before'?{sourceRef:process.env.VISIT_MAIL_BASE_REF}:{});let functions=0,restoreConsole;
 const call=async(body)=>{functions++;const r=await env.invoke(body);if(r.status!==200)throw Error(r.data.code+': '+r.data.message);return r.data;};
 try{
 let r=(await call({action:'create',id:id(90),operation:randomUUID(),content,participants:Array.from({length:n},(_,i)=>person(20+i))})).record;
 const start=env.calls.length,begin=performance.now();functions=0;let consoleLines=0,consoleBytes=0;const savedConsole={log:console.log,warn:console.warn,error:console.error};restoreConsole=()=>Object.assign(console,savedConsole);for(const key of Object.keys(savedConsole))console[key]=(...args)=>{consoleLines++;consoleBytes+=Buffer.byteLength(args.map(String).join(' ')+'\n');};
 await call({action:'preview-mail',id:r.id,kind:'review'});
 if(mode==='before'){
 r=(await call({action:'command',id:r.id,revision:r.revision,operation:randomUUID(),command:{type:'review'}})).record;
 const jobs=(await call({action:'get',id:r.id})).jobs;
 for(const j of jobs)await call({action:'send-job',id:r.id,jobId:j.id});
 await call({action:'get',id:r.id});await call({action:'list'});
 }else{
 const operation=randomUUID();let next=true;while(next){const x=await call({action:'send-mail',id:r.id,kind:'review',revision:r.revision,version:r.version,operation});if(x.record)r=x.record;next=x.hasMore;}
 }
 Object.assign(console,savedConsole);const calls=env.calls.slice(start),db=calls.filter(c=>c.url.includes('/rest/v1/'));
 await env.db.exec('reset role');const events=(await env.db.query("select count(*)::int n from visit_minutes_events where event like 'mail-%'")).rows[0].n;
 results.push({recipients:n,dbRequests:db.length,dbWriteRequests:db.filter(c=>c.method!=='GET'&&!/rpc\/(visit_minutes_owner_can_write|visit_minutes_can_create_work|visit_order_work_users)/.test(c.url)).length,stateWriteRequests:db.filter(c=>/rpc\/visit_minutes_(commit|claim_mail|finish_mail)/.test(c.url)).length,functionInvocations:functions,oauthRefreshes:calls.filter(c=>c.url.includes('oauth2.googleapis.com/token')).length,gmailRequests:calls.filter(c=>c.url.includes('/messages/send')).length,auditEvents:events,applicationConsoleLines:consoleLines,applicationConsoleBytes:consoleBytes,simulatedDurationMs:Math.round(performance.now()-begin),storedPdfs:(await env.db.query('select count(*)::int n from visit_minutes_files')).rows[0].n,storedPdfBytes:Number((await env.db.query('select coalesce(sum(octet_length(base64)),0) n from visit_minutes_files')).rows[0].n)});
 }finally{restoreConsole?.();await env.cleanup();}
}
await fs.mkdir(new URL('../tmp/',import.meta.url),{recursive:true});await fs.writeFile(new URL('../tmp/mail-metrics-'+mode+'.json',import.meta.url),JSON.stringify(results,null,2));console.log(JSON.stringify({mode,results}));
