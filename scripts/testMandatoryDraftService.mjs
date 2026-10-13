import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'esbuild';
const output=new URL('./.mandatory-draft-service.mjs',import.meta.url);
let calls=[],badRead=false,badCoordinates=false,deleted=false;
const document={id:'doc',updated_at:'2026-10-09T21:00:00Z',details:{draftSaveHash:'hash'}};
let storedWorkers=[{id:'worker',legacy_worker_id:1,printed_name:'Persona Uno',page:1,row_index:0,detection_status:'CONFIRMED',position_status:'RESOLVED',position_source:'MANUAL',name_box:{x:60,y:500,width:100,height:10},signature_box:{x:350,y:500,width:70,height:14}}];
globalThis.__draftApi={
 async query(table,options){assert.equal(options.networkOnly,true);if(table==='mandatory_document_workers_v2')return [{id:'worker',detection_status:deleted&&!badRead?'REJECTED':'CONFIRMED'}];assert(options.query.includes('documentWorkers:mandatory_document_workers_v2('),'canonical geometry is fetched with the document');const nested=structuredClone(storedWorkers);if(badCoordinates&&nested[0].signature_box)nested[0].signature_box.x++;return [{...document,details:{draftSaveHash:badRead?'wrong':'hash',workerAnchors:[{workerId:1,signatureX:999}]},documentWorkers:nested}];},
 async rpc(name,args){calls.push({name,args});if(name==='save_mandatory_positions_draft_v2'){storedWorkers=args.p_workers.map(w=>({id:w.documentWorkerId,legacy_worker_id:1,printed_name:w.printedName,page:w.page,row_index:w.rowIndex,detection_status:'CONFIRMED',position_status:w.resolved&&w.signatureBox?'RESOLVED':'PENDING',position_source:'MANUAL',name_box:w.nameBox,signature_box:w.signatureBox}));return structuredClone(document);}if(name==='review_mandatory_document_worker_v2'){deleted=true;return {ok:true};}throw Error(name);}
};
try{
 await build({stdin:{contents:"export {saveSupervisorMandatoryDraft,removeSupervisorMandatoryWorker,loadSupervisorMandatoryEditorDocument} from './src/services/foremanPortalService';",resolveDir:new URL('../',import.meta.url).pathname},outfile:output.pathname,bundle:true,format:'esm',platform:'node',plugins:[{name:'api-boundary',setup(b){b.onResolve({filter:/\/lib\/supabase$/},()=>({path:'api',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase=globalThis.__draftApi;'}));}}]});
 const {saveSupervisorMandatoryDraft,removeSupervisorMandatoryWorker,loadSupervisorMandatoryEditorDocument}=await import(output.href);
 const recovered=await loadSupervisorMandatoryEditorDocument('doc');
 assert.equal(recovered.details.workerAnchors[0].documentWorkerId,'worker','legacy snapshots recover the stored documentary UUID');
 assert.equal(recovered.details.workerAnchors[0].signatureX,350,'canonical coordinates override stale document snapshots');
 storedWorkers.push({...storedWorkers[0],id:'rejected',legacy_worker_id:2,detection_status:'REJECTED'});
 assert.equal((await loadSupervisorMandatoryEditorDocument('doc')).details.workerAnchors.length,1,'rejected workers never return to the editor');
 storedWorkers.push({...storedWorkers[0],id:'pending',legacy_worker_id:3,printed_name:'Persona pendiente',detection_status:'DETECTED',position_status:'PENDING',signature_box:null,name_box:null});
 const visible=await loadSupervisorMandatoryEditorDocument('doc');
 assert.equal(visible.details.workerAnchors.length,2,'unconfirmed imported people must not be hidden from positioning');
 assert.equal(visible.details.workerAnchors.find(a=>a.documentWorkerId==='pending').resolved,false,'pending identity is explicit');
 assert.equal(visible.details.workerAnchors.find(a=>a.documentWorkerId==='worker').signatureX,350,'showing pending people preserves saved geometry');
 storedWorkers=storedWorkers.filter(row=>row.id!=='pending');
 const adjusted={...recovered.details.workerAnchors[0],signatureX:365};
 await saveSupervisorMandatoryDraft('doc',[adjusted],'revision');
 assert.equal((await loadSupervisorMandatoryEditorDocument('doc')).details.workerAnchors[0].signatureX,365,'saved geometry survives reopening');
 badCoordinates=true;await assert.rejects(saveSupervisorMandatoryDraft('doc',[adjusted],'revision'),/posición guardada/,'matching hashes cannot mask different persisted coordinates');badCoordinates=false;
 calls=[];
 const anchors=[{workerId:1,documentWorkerId:'worker',workerName:'Persona Uno',page:1,resolved:false,signatureX:null,nameX:60,nameY:500,nameRightX:160,rowHeight:10}];
 await saveSupervisorMandatoryDraft('doc',anchors,'revision');assert.equal(calls.length,1,'draft saved by one RPC');
 assert.equal(calls[0].args.p_expected_updated_at,'revision');assert.deepEqual(calls[0].args.p_workers[0].nameBox,{x:60,y:500,width:100,height:10});assert.equal(calls[0].args.p_workers[0].signatureBox,null);
 badRead=true;await assert.rejects(saveSupervisorMandatoryDraft('doc',anchors,'revision'),/verificar/,'server mismatch never reports success');
 badRead=false;await removeSupervisorMandatoryWorker('doc',1);assert.equal(calls.at(-1).args.p_document_worker_id,'worker');
 badRead=true;await assert.rejects(removeSupervisorMandatoryWorker('doc',1),/verificar/,'deletion requires persisted rejection');
 console.log('PASS: single draft RPC, revision forwarding, geometry preservation, live save and deletion verification.');
}finally{await fs.rm(output,{force:true});}


