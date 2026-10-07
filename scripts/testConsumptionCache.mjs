import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unlink } from 'node:fs/promises';
import { jsPDF } from 'jspdf';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

let user = { id: 'owner-A' };
let calls = [];
let revision = 1;
let authChanged;
let channelChanged;
globalThis.__cacheTest = {
  createClient: () => ({
    auth: { getSession: async () => ({data:{session:{user,access_token:'test'}}}),
      onAuthStateChange: callback => { authChanged = callback; } },
    channel: () => ({on(_event,_filter,callback){channelChanged=callback;return this;},subscribe(){return this;}}),
    removeChannel: async()=>{},
    rpc: async () => ({data:null,error:null}),
    functions: {invoke:async()=>({data:null,error:null})},
  }),
};
globalThis.fetch = async (url, options) => {
  calls.push({url,options});
  return new Response(JSON.stringify([{id:'1',name:`revision-${revision}`,data:{name:`revision-${revision}`},owner_id:user.id}]), {status:200});
};
const out = new URL('./.consumption-cache-test.mjs', import.meta.url);
try {
  await build({stdin:{contents:"export {supabase} from './src/lib/supabase'; export {ReadResponseCache} from './src/lib/readResponseCache'; export {getDocuments,subscribeToDocuments} from './src/services/databaseService';",resolveDir:process.cwd(),loader:'ts'},
    bundle:true,platform:'node',format:'esm',outfile:out.pathname,
    define:{'import.meta.env':'{}'},plugins:[{name:'isolated-transport',setup(b){
      b.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:'sdk',namespace:'test'}));
      b.onResolve({filter:/\.\/offlineStore$/},()=>({path:'offline',namespace:'test'}));
      b.onResolve({filter:/\.\/actionHistory$/},()=>({path:'history',namespace:'test'}));
      b.onLoad({filter:/.*/,namespace:'test'},({path})=>({contents:path==='sdk'
        ? 'export const {createClient}=globalThis.__cacheTest;'
        : path==='history' ? 'export const isReplayingActionHistory=()=>false; export const recordActionHistory=()=>{}; export const setActionHistoryExecutor=()=>{};'
        : 'export const offlineCacheKey=(...args)=>JSON.stringify(args); export const readOfflineCache=async()=>null; export const writeOfflineCache=async()=>{}; export const applyRestMutationToCachedReads=async()=>{}; export const enqueueOfflineOperation=async()=>{}; export const listOfflineOperations=async()=>[]; export const removeOfflineOperation=async()=>{}; export const setOfflineSyncActivity=async()=>{}; export const updateOfflineOperationFailure=async()=>{};'}));
    }}]});
  const {supabase,ReadResponseCache,getDocuments,subscribeToDocuments} = await import(out.href);
  const options = {query:'select=id,name'};
  const first = await supabase.query('trabajadores',options);
  first[0].name = 'edited locally';
  assert.equal((await supabase.query('trabajadores',options))[0].name,'revision-1');
  assert.equal(calls.length,1,'repeated list read uses memory without leaking mutable objects');
  user = {id:'owner-B'};
  await supabase.query('trabajadores',options);
  assert.equal(calls.length,2,'different users never reuse each other’s cache');
  revision++;
  await supabase.query('trabajadores',{method:'PATCH',query:'id=eq.1',body:{name:'changed'}});
  assert.equal((await supabase.query('trabajadores',options))[0].name,'revision-2');
  const before = calls.length;
  await supabase.query('trabajadores',{...options,fresh:true});
  assert.equal(calls.length,before+1,'explicit refresh bypasses cached response');
  await supabase.rpc('patch_user_settings',{p_patch:{}});
  const afterRpc = calls.length;
  await supabase.query('trabajadores',options);
  assert.equal(calls.length,afterRpc+1,'RPC invalidates ordinary lists');
  authChanged('SIGNED_OUT',null);
  await supabase.query('trabajadores',options);
  assert.equal(calls.length,afterRpc+2,'session changes clear cache');
  const liveBefore = calls.length;
  await supabase.query('foreman_mandatory_documents',options);
  await supabase.query('foreman_mandatory_documents',options);
  assert.equal(calls.length,liveBefore+2,'signature and document reads always remain live');
  calls = [];
  await supabase.query('trabajadores',{method:'POST',body:Array.from({length:205},(_,id)=>({id:String(id)}))});
  assert.equal(calls.filter(call=>call.options.method==='GET').length,3,'205 undo preimages require three bounded reads');
  assert(calls.filter(call=>call.options.method==='GET').every(call=>new URL(call.url).searchParams.get('id').startsWith('in.(')));

  // A remote Realtime change must bypass the short cache even within its TTL.
  const events = new EventTarget();
  globalThis.document = new EventTarget();
  document.visibilityState = 'visible';
  globalThis.window = {setTimeout,clearTimeout,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)};
  await getDocuments('trabajadores');
  const updates = [];
  const stop = subscribeToDocuments('trabajadores',items=>updates.push(items));
  await new Promise(resolve=>setTimeout(resolve,0));
  revision++;
  channelChanged();
  await new Promise(resolve=>setTimeout(resolve,350));
  stop();
  assert.equal(updates.at(-1)[0].name,`revision-${revision}`,'remote changes remain immediately visible with cache enabled');
  delete globalThis.window; delete globalThis.document;

  let time = 0, loads = 0;
  const cache = new ReadResponseCache(()=>time,100);
  const load = async()=>({count:++loads});
  await cache.read('a',load,10); await cache.read('a',load,10);
  assert.equal(loads,1); time = 11; await cache.read('a',load,10); assert.equal(loads,2);
  let resolve;
  const pending = cache.read('race',()=>new Promise(r=>resolve=r));
  cache.clear(); resolve({old:true}); await pending;
  assert.deepEqual(await cache.read('race',async()=>({old:false})),{old:false},'invalidation prevents stale in-flight results entering cache');
  let failures = 0;
  for(let i=0;i<2;i++) await assert.rejects(cache.read('error',async()=>{failures++;throw Error('network');}));
  assert.equal(failures,2,'errors are never cached');
  let largeLoads = 0;
  for(let i=0;i<2;i++) await cache.read('large',async()=>{largeLoads++;return 'x'.repeat(200);});
  assert.equal(largeLoads,2,'memory budget excludes oversized values');

  const makePdf = compress => {
    const doc = new jsPDF({compress});
    for(let i=0;i<80;i++) doc.text(`Control de presencia trabajador ${i}`,15,15+i*3);
    return new Uint8Array(doc.output('arraybuffer'));
  };
  const plain = makePdf(false), compressed = makePdf(true);
  assert(compressed.byteLength < plain.byteLength * 0.7,'lossless PDF compression materially reduces output');
  const readPdf = async data => {
    const task = getDocument({data,disableFontFace:true,standardFontDataUrl:new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url).pathname});
    const pdf = await task.promise;
    try {return (await (await pdf.getPage(1)).getTextContent()).items.map(item=>({text:item.str,position:item.transform}));}
    finally {await task.destroy();}
  };
  assert.deepEqual(await readPdf(compressed),await readPdf(plain),'compression preserves text and coordinates');
  console.log('PASS: scoped cache, freshness, invalidation, history batching, memory bounds and PDF fidelity');
} finally { await unlink(out.pathname).catch(()=>{}); }
