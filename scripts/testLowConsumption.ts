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
assert.equal(calls.length,4);
assert(calls.every(c=>c.query.includes('owner_id=eq.owner-A')));
assert(!calls.some(c=>c.table==='foreman_activity_log'),'activity is never queried');
const versionQuery=calls.find(c=>c.table==='foreman_document_versions')!.query;
assert(!versionQuery.includes('select=*'));
assert(versionQuery.includes('document_type:snapshot->>document_type'));
assert(versionQuery.includes('legacy_work_date:snapshot->>workDate'));
calls.length=0;
const unchanged=await loader.load(true);
assert.equal(calls.length,4);
assert(calls.every(c=>c.query.startsWith('select=id,')));
assert.equal(unchanged[0],first[0]);
calls.length=0;
records.foreman_mandatory_documents=[{id:'new',updated_at:'2',signatures:{worker:'data:image/png;base64,new'}}];
const changed=await loader.load(true);
assert.equal(calls.length,5,'one changed collection, only one payload reload');
assert.equal(changed[2][0].signatures.worker,'data:image/png;base64,new');
assert.equal(changed[0],first[0]);
records.foreman_mandatory_documents=[];
assert.equal((await loader.load(true))[2].length,0,'external deletions removed from cache');
calls.length=0;
await loader.load(false);
assert.equal(calls.length,4,'manual/after-save refresh bypasses revisions');

let deltaRows=Array.from({length:200},(_,i)=>({id:String(i),updated_at:'1',signatures:{worker:`signature-${i}`}}));
const deltaCalls:{table:string;query:string;count:number}[]=[];
const deltaLoader=new ForemanDashboardLoader(async(table,{query})=>{
  const params=new URLSearchParams(query);
  let rows=table==='foreman_documents'?deltaRows:[];
  const filter=params.get('id');
  if(filter){
    const ids=new Set(JSON.parse(`[${filter.slice(4,-1)}]`));
    rows=rows.filter(row=>ids.has(row.id));
  }
  deltaCalls.push({table,query,count:rows.length});
  return params.get('select')==='id,updated_at'
    ? rows.map(({id,updated_at})=>({id,updated_at})) : structuredClone(rows);
},'owner-A');
const deltaInitial=await deltaLoader.load();deltaCalls.length=0;
deltaRows=deltaRows.map(row=>row.id==='99'?{...row,updated_at:'2',signatures:{worker:'new-signature'}}:row);
const deltaChanged=await deltaLoader.load(true);
assert.equal(deltaCalls.find(call=>call.query.includes('&id=in.'))?.count,1,'one changed signature downloads one row from 200 documents');
assert.equal(deltaChanged[0][99].signatures.worker,'new-signature');
assert.equal(deltaChanged[0][98],deltaInitial[0][98],'unchanged rows reuse their original payload');
deltaCalls.length=0;deltaRows=deltaRows.filter(row=>row.id!=='99');
const deltaDeleted=await deltaLoader.load(true);
assert.equal(deltaDeleted[0].length,199);
assert(!deltaCalls.some(call=>call.query.includes('&id=in.')),'deletion requires no document payload download');

let fail=true;
const recovery=new ForemanDashboardLoader(async()=>{if(fail)throw new Error('network');return [];},'owner-B');
await assert.rejects(recovery.load());fail=false;
assert.equal((await recovery.load()).length,4,'transient failure remains recoverable');
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
assert.equal(revisionReads,4);finishRead();await Promise.all([background,afterSave]);
assert.equal(revisionReads,8,'post-save refresh runs after the pending read, never lost');
console.log('Low-consumption regressions passed: revision checks, changes, deletion, signature preservation, isolation, deduplication and quota stop.');

// Madrid windows follow daylight-saving time and survive screen remounts.
const {morningRefreshSlot,claimMorningRefresh}=await import('../src/services/foremanMorningRefresh');
const stored=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>stored.get(k)??null,setItem:(k:string,v:string)=>stored.set(k,v)}});
assert.equal(morningRefreshSlot(new Date('2026-10-08T05:59:00Z')),null);
assert.equal(morningRefreshSlot(new Date('2026-10-08T06:00:00Z')),'2026-10-08:0');
assert.equal(morningRefreshSlot(new Date('2026-10-08T12:00:00Z')),null);
assert.equal(morningRefreshSlot(new Date('2026-12-08T07:00:00Z')),'2026-12-08:0');
for(let h=6;h<12;h++){
  const at=new Date(`2026-10-08T${String(h).padStart(2,'0')}:00:00Z`);
  assert.equal(claimMorningRefresh('owner','documents',at),h%2===0);
  assert.equal(claimMorningRefresh('owner','documents',at),false);
}
assert(claimMorningRefresh('other','documents',new Date('2026-10-08T06:00:00Z')));
assert(claimMorningRefresh('owner','mail',new Date('2026-10-08T06:00:00Z')));
assert(claimMorningRefresh('owner','documents',new Date('2026-10-09T06:00:00Z')));
console.log('Morning schedule passed: three windows, Madrid DST, per-owner and channel limits, next-day reset.');
