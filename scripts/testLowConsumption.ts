import assert from 'node:assert/strict';
import {ForemanDashboardLoader} from '../src/services/foremanDashboardLoader';
import {RequestLimiter} from '../src/lib/requestLimiter';

const records:Record<string,any[]>={};
const calls:{table:string;query:string}[]=[];
const query=async(table:string,{query}:{query:string})=>{
  calls.push({table,query});
  const rows=records[table]||[{id:table,updated_at:'1',created_at:'1',signatures:{worker:'data:image/png;base64,saved'}}];
  const select=new URLSearchParams(query).get('select')||'';
  return rows.map(row=>select.startsWith('id,updated_at')||select==='id,created_at'
    ? {id:row.id,updated_at:row.updated_at,created_at:row.created_at}
    : structuredClone(row));
};
const loader=new ForemanDashboardLoader(query,'owner-A');
const first=await loader.load();
assert.equal(calls.length,5);
assert(calls.every(c=>c.query.includes('owner_id=eq.owner-A')));
const versionQuery=calls.find(c=>c.table==='foreman_document_versions')!.query;
assert(!versionQuery.includes('select=*'));
assert(versionQuery.includes('document_type:snapshot->>document_type'));
assert(versionQuery.includes('legacy_work_date:snapshot->>workDate'));
calls.length=0;
const unchanged=await loader.load(true);
assert.equal(calls.length,5);
assert(calls.every(c=>c.query.startsWith('select=id,')));
assert.equal(unchanged[0],first[0]);
calls.length=0;
records.foreman_mandatory_documents=[{id:'new',updated_at:'2',signatures:{worker:'data:image/png;base64,new'}}];
const changed=await loader.load(true);
assert.equal(calls.length,6,'one changed collection, only one payload reload');
assert.equal(changed[2][0].signatures.worker,'data:image/png;base64,new');
assert.equal(changed[0],first[0]);
records.foreman_mandatory_documents=[];
assert.equal((await loader.load(true))[2].length,0,'external deletions removed from cache');
calls.length=0;
await loader.load(false);
assert.equal(calls.length,5,'manual/after-save refresh bypasses revisions');

let fail=true;
const recovery=new ForemanDashboardLoader(async()=>{if(fail)throw new Error('network');return [];},'owner-B');
await assert.rejects(recovery.load());fail=false;
assert.equal((await recovery.load()).length,5,'transient failure remains recoverable');
let attempts=0;
const blocked=new ForemanDashboardLoader(async()=>{attempts++;throw Object.assign(new Error('restricted'),{status:402});},'owner-B');
await assert.rejects(blocked.load());const before=attempts;
await assert.rejects(blocked.load(true));assert.equal(attempts,before,'no polling after restriction');

const limiter=new RequestLimiter();
let reads=0;
let release!:()=>void;
const held=new Promise<void>(resolve=>{release=resolve;});
const operation=async()=>{reads++;await held;return 'data';};
const a=limiter.run('user-A','same',true,operation);
const b=limiter.run('user-A','same',true,operation);
assert.equal(reads,1);release();assert.deepEqual(await Promise.all([a,b]),['data','data']);
await limiter.run('user-A','same',true,operation);assert.equal(reads,2,'dedup does not cache stale data');
await limiter.run('user-B','same',true,operation);assert.equal(reads,3,'users do not share a cache');
await Promise.all([limiter.run('user-A','write',false,operation),limiter.run('user-A','write',false,operation)]);
assert.equal(reads,5,'writes are never coalesced');
await assert.rejects(limiter.run('user-A','restricted',true,async()=>{throw Object.assign(new Error('quota'),{status:402});}));
await assert.rejects(limiter.run('user-A','other',false,operation));assert.equal(reads,5);
assert.equal(await limiter.run('user-B','other',true,async()=> 'allowed'),'allowed');
const originalNow=Date.now;let clock=1000;Date.now=()=>clock;
try{
  const throttled=new RequestLimiter();
  await assert.rejects(throttled.run('user','read',true,async()=>{throw Object.assign(new Error('rate limit'),{status:429});}));
  await assert.rejects(throttled.run('user','read',true,async()=> 'too early'));
  clock+=60_001;
  assert.equal(await throttled.run('user','read',true,async()=> 'resumed'),'resumed');
}finally{Date.now=originalNow;}
let finishRead!:()=>void;
const readHeld=new Promise<void>(resolve=>{finishRead=resolve;});let revisionReads=0;
const concurrent=new ForemanDashboardLoader(async()=>{revisionReads++;await readHeld;return [];},'owner');
const background=concurrent.load(true);
const afterSave=concurrent.load(false);
assert.equal(revisionReads,5);finishRead();await Promise.all([background,afterSave]);
assert.equal(revisionReads,10,'post-save refresh runs after the pending read, never lost');
console.log('Low-consumption regressions passed: revision checks, changes, deletion, signature preservation, isolation, deduplication and quota stop.');
