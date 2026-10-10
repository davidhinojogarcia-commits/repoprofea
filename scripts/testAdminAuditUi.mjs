import {build} from 'esbuild';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import React,{act} from 'react';import {createRoot} from 'react-dom/client';import fs from 'node:fs/promises';
globalThis.BroadcastChannel=undefined;const version='pr';const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
for(const k of ['window','document','localStorage','HTMLElement','Event'])globalThis[k]=dom.window[k];Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let clock=Date.now();const realNow=Date.now;Date.now=()=>clock;
let timers=new Map(),tid=0;window.setTimeout=(fn,ms)=>{const id=++tid;timers.set(id,{fn,ms});return id};window.clearTimeout=id=>timers.delete(id);let intervals=0;window.setInterval=()=>{intervals++;return 1};
let deferred=false;let fetchFailure=false;const pending=[];let calls=[];globalThis.__offlineCached=null;
let logs=Array.from({length:120},(_,i)=>({id:String(i),user_id:'U',user_email:'test@example.test',action:i%2?'UPDATE':'LOGIN',resource_type:'auth',resource_id:'U',timestamp:new Date(1800000000000-i*86400000).toISOString(),details:{text:'fixture'}}));
globalThis.__sdk={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'A'},access_token:'synthetic'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})};
globalThis.fetch=async url=>{if(fetchFailure)throw new TypeError('Network unavailable');const u=new URL(url);const table=u.pathname.split('/').at(-1);calls.push({table,query:u.search,bytes:0});const call=calls.at(-1);let rows=table==='profiles'?[{id:'U',nombre:'Prueba',email:'test@example.test',role:'user',active:true}]:[];
if(table==='audit_logs'){rows=logs.filter(x=>['action','resource_type','user_id'].every(k=>!u.searchParams.get(k)||x[k]===u.searchParams.get(k).slice(3))).slice(0,Number(u.searchParams.get('limit')||1000));if(deferred)await new Promise((resolve,reject)=>pending.push({query:u.search,resolve,reject}));}
const body=JSON.stringify(rows);call.bytes=Buffer.byteLength(body);return new Response(body,{status:200});};
const entry=version==='base'?'components/AdminPanelBase.tsx':'components/AdminPanel.tsx';const out='scripts/.admin-audit-ui.mjs';
await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',packages:'external',outfile:out,define:{'import.meta.env':'{}'},plugins:[{name:'isolated',setup(b){
b.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:'sdk',namespace:'stub'}));
b.onResolve({filter:/\.\/offlineStore$/},()=>({path:'offline',namespace:'stub'}));
b.onResolve({filter:/appDialog|appToast|\/functions$|AdminShareManager|ModalPortal|\/ui\/PageHeader$/},a=>({path:a.path,namespace:'stub'}));
b.onLoad({filter:/.*/,namespace:'stub'},({path})=>({contents:path==='sdk'?'export const {createClient}=globalThis.__sdk;':path==='offline'?'export const offlineCacheKey=(...x)=>JSON.stringify(x);export const readOfflineCache=async()=>globalThis.__offlineCached;export const writeOfflineCache=async()=>{};export const applyRestMutationToCachedReads=async()=>{};export const enqueueOfflineOperation=async()=>{};export const listOfflineOperations=async()=>[];export const removeOfflineOperation=async()=>{};export const setOfflineSyncActivity=async()=>{};export const updateOfflineOperationFailure=async()=>{};':path.includes('functions')?'export const createManagedUser=()=>{},deleteManagedUser=()=>{},sendManagedPasswordReset=()=>{},setManagedUserActive=()=>{},setManagedUserRole=()=>{},updateManagedPermissions=()=>{},updateManagedUserProfile=()=>{};':path.includes('appDialog')?'export const appConfirm=async()=>false;':path.includes('appToast')?'export const showAppToast=()=>{};':path.includes('AdminShareManager')?'export const AdminShareManager=()=>null;':path.includes('PageHeader')?'export const PageHeader=()=>null;':'export default ()=>null;'}));}}]});
const {AdminPanel}=await import('./.admin-audit-ui.mjs');const root=createRoot(document.getElementById('root'));
const flush=async()=>{await act(async()=>{const list=[...timers.values()];timers.clear();for(const t of list)t.fn();await new Promise(r=>setTimeout(r,0));});};
const click=async b=>act(async()=>{b.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await new Promise(r=>setTimeout(r,0));});
const select=async(index,value)=>act(async()=>{const s=document.querySelectorAll('select')[index];s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,0));});
await act(async()=>root.render(React.createElement(AdminPanel,{onClose(){}})));calls=[];
await click([...document.querySelectorAll('button')].find(x=>x.textContent==='Auditoría'));await flush();
const initial=calls.filter(x=>x.table==='audit_logs');const initialRows=document.querySelectorAll('article').length;assert.equal(initialRows,version==='pr'?100:120);
const coldBytes=initial.reduce((a,x)=>a+x.bytes,0);const idleStart=calls.length;clock+=600000;await flush();const idleCalls=calls.length-idleStart;assert.equal(idleCalls,0);assert.equal(intervals,0);
calls=[];await select(1,'LOGIN');await select(2,'auth');await select(0,'U');await flush();const rapidCalls=calls.filter(x=>x.table==='audit_logs').length;assert.equal(rapidCalls,version==='pr'?1:3);
assert.equal(document.querySelectorAll('article').length,60);const oldVisible=document.body.textContent.includes(logs.at(-2).timestamp);
const refresh=document.querySelector('[aria-label="Actualizar auditoría"]');
assert(refresh);logs.unshift({id:'NEW',user_id:'U',user_email:'test@example.test',action:'LOGIN',resource_type:'auth',resource_id:'NEW-EVENT',timestamp:new Date().toISOString(),details:{}});calls=[];await click(refresh);const refreshNetwork=calls.filter(x=>x.table==='audit_logs').length;const immediateFresh=document.body.textContent.includes('NEW-EVENT');assert.equal(refreshNetwork,1);assert.equal(immediateFresh,true);
clock+=31000;await click(refresh);assert(document.body.textContent.includes('NEW-EVENT'));
// Make a request under LOGIN, then UPDATE, resolve latest first, stale last.
clock+=31000;deferred=true;await click(refresh);await flush();await select(1,'UPDATE');await flush();assert(pending.length>=2);const latest=pending.find(x=>x.query.includes('action=eq.UPDATE'));const stale=pending.find(x=>x.query.includes('action=eq.LOGIN'));
await act(async()=>{latest.resolve();await new Promise(r=>setTimeout(r,0));});const beforeStale=[...document.querySelectorAll('article strong')].map(x=>x.textContent);assert(beforeStale.every(x=>x==='UPDATE'));
await act(async()=>{stale.resolve();await new Promise(r=>setTimeout(r,0));});const afterStale=[...document.querySelectorAll('article strong')].map(x=>x.textContent);const raceSafe=afterStale.every(x=>x==='UPDATE');assert.equal(raceSafe,true);
// Current network error must surface instead of returning an offline copy.
deferred=false;fetchFailure=true;globalThis.__offlineCached=logs;
await click(refresh);assert(document.querySelector('[role="alert"]'));assert.equal(document.querySelectorAll('article').length,0);assert(!document.body.textContent.includes('NEW-EVENT'));
fetchFailure=false;globalThis.__offlineCached=null;await click(refresh);assert.equal(document.querySelector('[role="alert"]'),null);
// Old failure must not replace a newer successful result.
clock+=31000;deferred=true;const pendingStart=pending.length;await click(refresh);await select(1,'LOGIN');await flush();
const old=pending[pendingStart],newer=pending[pendingStart+1];assert(old&&newer);
await act(async()=>{newer.resolve();await new Promise(r=>setTimeout(r,0));});
await act(async()=>{old.reject(new Error('obsolete failure'));await new Promise(r=>setTimeout(r,0));});
assert.equal(document.querySelector('[role="alert"]'),null);assert([...document.querySelectorAll('article strong')].every(x=>x.textContent==='LOGIN'));
// Filter invalidates an issued request before the next debounce fires.
clock+=31000;const oldIndex=pending.length;await click(refresh);await select(1,'UPDATE');
await act(async()=>{pending[oldIndex].resolve();await new Promise(r=>setTimeout(r,0));});
assert.equal(document.querySelectorAll('article').length,0);assert(document.querySelector('[role="status"]'));
await flush();await act(async()=>{pending.at(-1).resolve();await new Promise(r=>setTimeout(r,0));});
assert([...document.querySelectorAll('article strong')].every(x=>x.textContent==='UPDATE'));
// Unmount cancels the debounced request.
await select(1,'LOGIN');const beforeUnmount=calls.length;await act(async()=>root.unmount());await flush();assert.equal(calls.length,beforeUnmount);

console.log(JSON.stringify({result:'PASS',version,fixtureRows:120,coldRows:initialRows,coldBytes,coldAuditRequests:initial.length,idle10minRequests:idleCalls,rapidFilterRequests:rapidCalls,immediateRefreshRequests:refreshNetwork,immediateRefreshFresh:immediateFresh,outOfOrderSafe:raceSafe,notes:'actual React AdminPanel and REST/cache/limiter code; synthetic fetch, accelerated idle clock; no backend logs'},null,2));
await fs.rm(out);Date.now=realNow;dom.window.close();


