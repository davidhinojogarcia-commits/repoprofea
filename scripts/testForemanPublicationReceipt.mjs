import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'esbuild';
const output=new URL('./.publication-receipt.mjs',import.meta.url);
let mode='success',queries=[];
globalThis.__publicationApi={
  async rpc(){if(mode==='rpc-failure')throw Error('Sin conexión');return {ok:mode!=='ambiguous',lifecycleStatus:'ASSIGNED'};},
  async query(table,options){
    queries.push({table,options});assert.equal(options.networkOnly,true,'receipt never accepts cached/offline evidence');
    if(table==='foreman_mandatory_documents')return mode==='missing'?[]:[{id:'doc',owner_id:'owner',obra:'Obra A',period_key:'2026-07',lifecycle_status:mode==='unchanged'?'READY':'ASSIGNED',assigned_at:'2026-10-13T07:00:00Z'}];
    if(mode==='access-failure')throw Error('Acceso no disponible');
    return [{obra:mode==='wrong-work'?'Obra B':'obra a'}];
  },
};
try{
  await build({stdin:{contents:"export {assignMandatoryDocumentV2} from './src/services/mandatoryTraceabilityServiceV2';export {resolveForemanPortal} from './src/services/foremanPortalService';",resolveDir:new URL('../',import.meta.url).pathname},outfile:output.pathname,bundle:true,platform:'node',format:'esm',plugins:[{name:'api',setup(b){b.onResolve({filter:/\/lib\/supabase$/},()=>({path:'api',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase=globalThis.__publicationApi;'}));}}]});
  const {assignMandatoryDocumentV2,resolveForemanPortal}=await import(output.href);
  const receipt=await assignMandatoryDocumentV2('doc');
  assert.equal(receipt.activePortal,true);assert.equal(receipt.obra,'Obra A');assert.equal(receipt.periodKey,'2026-07');assert.equal(receipt.assignedAt,'2026-10-13T07:00:00Z');
  mode='wrong-work';assert.equal((await assignMandatoryDocumentV2('doc')).activePortal,false,'different worksite is not a valid destination');
  mode='access-failure';assert.equal((await assignMandatoryDocumentV2('doc')).activePortal,null,'access failure is reported separately from verified save');
  for(mode of ['ambiguous','missing','unchanged','rpc-failure'])await assert.rejects(assignMandatoryDocumentV2('doc'),'never report success on an unverified publication');
  globalThis.__publicationApi.rpc=async(name,body,options)=>{assert.equal(name,'resolve_foreman_portal');assert.equal(options.fresh,true);return {valid:true,mandatoryDocuments:[{id:'doc',lifecycleStatus:'ASSIGNED'}]};};
  assert.equal((await resolveForemanPortal('token')).mandatoryDocuments[0].lifecycleStatus,'ASSIGNED');
  console.log('PASS: persisted publication receipt, active worksite access, explicit warnings, ambiguous/failing saves and fresh portal RPC.');
}finally{await fs.rm(output,{force:true});}
