import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'esbuild';
const output=new URL('./.mandatory-draft-service.mjs',import.meta.url);
let calls=[],badRead=false,deleted=false;
const document={id:'doc',updated_at:'2026-10-09T21:00:00Z',details:{draftSaveHash:'hash'}};
globalThis.__draftApi={
 async query(table,options){assert.equal(options.networkOnly,true);if(table==='mandatory_document_workers_v2')return [{id:'worker',detection_status:deleted&&!badRead?'REJECTED':'CONFIRMED'}];return [{...document,details:{draftSaveHash:badRead?'wrong':'hash'}}];},
 async rpc(name,args){calls.push({name,args});if(name==='save_mandatory_positions_draft_v2')return structuredClone(document);if(name==='review_mandatory_document_worker_v2'){deleted=true;return {ok:true};}throw Error(name);}
};
try{
 await build({stdin:{contents:"export {saveSupervisorMandatoryDraft,removeSupervisorMandatoryWorker} from './src/services/foremanPortalService';",resolveDir:new URL('../',import.meta.url).pathname},outfile:output.pathname,bundle:true,format:'esm',platform:'node',plugins:[{name:'api-boundary',setup(b){b.onResolve({filter:/\/lib\/supabase$/},()=>({path:'api',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase=globalThis.__draftApi;'}));}}]});
 const {saveSupervisorMandatoryDraft,removeSupervisorMandatoryWorker}=await import(output.href);
 const anchors=[{workerId:1,documentWorkerId:'worker',workerName:'Persona Uno',page:1,resolved:false,signatureX:null,nameX:60,nameY:500,nameRightX:160,rowHeight:10}];
 await saveSupervisorMandatoryDraft('doc',anchors,'revision');assert.equal(calls.length,1,'draft saved by one RPC');
 assert.equal(calls[0].args.p_expected_updated_at,'revision');assert.deepEqual(calls[0].args.p_workers[0].nameBox,{x:60,y:500,width:100,height:10});assert.equal(calls[0].args.p_workers[0].signatureBox,null);
 badRead=true;await assert.rejects(saveSupervisorMandatoryDraft('doc',anchors,'revision'),/verificar/,'server mismatch never reports success');
 badRead=false;await removeSupervisorMandatoryWorker('doc',1);assert.equal(calls.at(-1).args.p_document_worker_id,'worker');
 badRead=true;await assert.rejects(removeSupervisorMandatoryWorker('doc',1),/verificar/,'deletion requires persisted rejection');
 console.log('PASS: single draft RPC, revision forwarding, geometry preservation, live save and deletion verification.');
}finally{await fs.rm(output,{force:true});}
