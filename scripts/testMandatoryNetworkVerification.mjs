import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';

const output=new URL('./.mandatory-network-test.mjs',import.meta.url);
let online=true,fail=false,requests=0,revision=1;
globalThis.__mandatoryNetworkTest={
  createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'owner'},access_token:'test'}}}),onAuthStateChange(){}},storage:{}}),
  readOfflineCache:async()=>[{id:'cached',revision:0}],
};
Object.defineProperty(globalThis,'navigator',{value:{get onLine(){return online;}},configurable:true});
globalThis.fetch=async()=>{
  requests++;
  if(fail)throw new TypeError('Failed to fetch');
  return new Response(JSON.stringify([{id:'server',revision}]),{status:200});
};
try{
  await build({stdin:{contents:"export {supabase} from './src/lib/supabase';",resolveDir:new URL('../',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',outfile:output.pathname,define:{'import.meta.env':'{}'},plugins:[{name:'transport-boundary',setup(builder){
    builder.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:'sdk',namespace:'test'}));
    builder.onResolve({filter:/\.\/offlineStore$/},()=>({path:'offline',namespace:'test'}));
    builder.onLoad({filter:/.*/,namespace:'test'},({path})=>({contents:path==='sdk'?'export const {createClient}=globalThis.__mandatoryNetworkTest;':
      'export const {readOfflineCache}=globalThis.__mandatoryNetworkTest; export const offlineCacheKey=(...a)=>JSON.stringify(a); export const writeOfflineCache=async()=>{}; export const applyRestMutationToCachedReads=async()=>{}; export const enqueueOfflineOperation=async()=>{}; export const listOfflineOperations=async()=>[]; export const removeOfflineOperation=async()=>{}; export const setOfflineSyncActivity=async()=>{}; export const updateOfflineOperationFailure=async()=>{};'}));
  }}]});
  const {supabase}=await import(output.href);
  const options={query:'select=id,revision'};
  await supabase.query('foreman_mandatory_documents',options);
  revision=2;
  assert.equal((await supabase.query('foreman_mandatory_documents',options))[0].revision,1,'normal reads retain low-consumption cache');
  assert.equal((await supabase.query('foreman_mandatory_documents',{...options,networkOnly:true}))[0].revision,2,'verification bypasses memory');
  online=false;
  assert.equal((await supabase.query('foreman_mandatory_documents',options))[0].id,'cached','ordinary offline browsing remains available');
  const before=requests;
  await assert.rejects(supabase.query('foreman_mandatory_documents',{...options,networkOnly:true}),/conexión/);
  assert.equal(requests,before);
  online=true;fail=true;
  await assert.rejects(supabase.query('foreman_mandatory_documents',{...options,networkOnly:true}),/Failed to fetch/,'failed verification cannot fall back to an offline snapshot');
  console.log('Network-only persistence verification rejects memory/offline fallback: OK');
}finally{await fs.rm(output,{force:true});delete globalThis.__mandatoryNetworkTest;}
