import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';

const output=new URL('./.mandatory-persistence-test.mjs',import.meta.url);
const box={x:100,y:200,width:110,height:32};
let workers,document,calls,dropGeometry=false,keepRejectedProjection=false,offline=false,failVerification=false;
const reset=()=>{
  workers=[{id:'w1',legacy_worker_id:1,printed_name:'Persona Uno',detection_status:'CONFIRMED',position_status:'RESOLVED',signature_box:box,page:1,row_index:0},
    {id:'w2',legacy_worker_id:2,printed_name:'Detección incorrecta',detection_status:'CONFIRMED',position_status:'RESOLVED',signature_box:box,page:1,row_index:1}];
  document={id:'doc',lifecycle_status:'ASSIGNED',details:{},signatures:{'1':'firma-conservada','2':'firma-descartada'},workers:[]};
  calls=[];dropGeometry=false;keepRejectedProjection=false;offline=false;failVerification=false;project();
};
function project(){
  const confirmed=workers.filter(row=>row.detection_status==='CONFIRMED');
  document.workers=confirmed.map(row=>({id:row.legacy_worker_id}));
  document.details.importedWorkerIds=confirmed.map(row=>row.legacy_worker_id);
  document.details.workerAnchors=confirmed.map(row=>({workerId:row.legacy_worker_id,documentWorkerId:row.id,page:row.page,order:row.row_index,
    signatureX:row.signature_box?.x,signatureY:row.signature_box?.y,signatureWidth:row.signature_box?.width,signatureHeight:row.signature_box?.height}));
}
const api={
  async query(table,options){
    assert.equal(options.networkOnly,true,'verification must require a live server response');
    if(offline)throw new Error('Se necesita conexión');
    if(failVerification&&calls.some(call=>call.name==='add_missing_mandatory_document_worker_v2')){failVerification=false;throw new Error('Conexión interrumpida');}
    assert(!options.method||options.method==='GET','editor must not overwrite server projections with REST PATCH');
    return structuredClone(table==='mandatory_document_workers_v2'?workers:[document]);
  },
  async rpc(name,args){
    calls.push({name,args});
    if(name==='assign_mandatory_document_v2')throw new Error('El documento ya está asignado o cerrado');
    if(name==='review_mandatory_document_worker_v2'){
      const row=workers.find(row=>row.id===args.p_document_worker_id);
      assert(row);
      if(args.p_action==='confirm'){
        if(document.lifecycle_status==='ASSIGNED')throw new Error('El documento ya está congelado');
        row.detection_status='CONFIRMED';row.position_status='RESOLVED';row.signature_box=args.p_signature_box;
      }else{
        row.detection_status='REJECTED';row.position_status='REJECTED';row.signature_box=null;
        delete document.signatures[String(row.legacy_worker_id)];
      }
      if(!keepRejectedProjection)project();
      return {ok:true};
    }
    if(name==='update_mandatory_document_worker_geometry_v2'){
      const row=workers.find(row=>row.id===args.p_document_worker_id);
      assert.equal(row.detection_status,'CONFIRMED');
      if(!dropGeometry){row.signature_box=args.p_signature_box;row.page=args.p_page;row.row_index=args.p_row_index;row.position_status='RESOLVED';project();}
      return {ok:true};
    }
    if(name==='add_missing_mandatory_document_worker_v2'){
      const row={id:'manual',legacy_worker_id:-900000000000001,printed_name:args.p_printed_name,detection_status:'CONFIRMED',position_status:'RESOLVED',signature_box:args.p_signature_box,page:args.p_page,row_index:args.p_row_index};
      workers.push(row);project();return {ok:true,documentWorkerId:row.id,legacyWorkerId:row.legacy_worker_id};
    }
    throw new Error(`Unexpected RPC ${name}`);
  },
};
globalThis.__mandatoryPersistenceApi=api;
try{
  await build({stdin:{contents:"export {saveMandatoryWorkerSelectionV2} from './src/services/mandatoryTraceabilityServiceV2'; export {updateSupervisorMandatoryAnchors} from './src/services/foremanPortalService';",resolveDir:new URL('../',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',outfile:output.pathname,
    plugins:[{name:'supabase-test-boundary',setup(builder){builder.onResolve({filter:/\/lib\/supabase$/},()=>({path:'supabase',namespace:'test-api'}));builder.onLoad({filter:/.*/,namespace:'test-api'},()=>({contents:'export const supabase=globalThis.__mandatoryPersistenceApi;'}));}}]});
  const {saveMandatoryWorkerSelectionV2,updateSupervisorMandatoryAnchors}=await import(output.href);
  const selection={documentId:'doc',workers:[{documentWorkerId:'w1',selected:true,printedName:'Persona Uno'},{documentWorkerId:'w2',selected:false,printedName:'Detección incorrecta'}]};
  reset();
  await saveMandatoryWorkerSelectionV2(selection);
  assert.deepEqual(calls.map(call=>[call.name,call.args.p_action]),[['review_mandatory_document_worker_v2','reject']],'assigned document only rejects changed worker');
  assert.equal(document.signatures['1'],'firma-conservada');
  assert.deepEqual(document.details.importedWorkerIds,[1]);
  const reopen=structuredClone(workers);assert.equal(reopen[1].detection_status,'REJECTED');
  calls=[];await saveMandatoryWorkerSelectionV2(selection);assert.equal(calls.length,0,'repeated save does not reconfirm frozen identities');
  reset();keepRejectedProjection=true;await assert.rejects(saveMandatoryWorkerSelectionV2(selection),/todavía aparece/);
  reset();offline=true;await assert.rejects(saveMandatoryWorkerSelectionV2(selection),/conexión/);assert.equal(calls.length,0);
  reset();document.lifecycle_status='READY';workers[0].detection_status='DETECTED';
  await saveMandatoryWorkerSelectionV2({...selection,workers:selection.workers.map(worker=>({...worker,signatureBox:box}))});
  assert.deepEqual(calls.map(call=>call.args.p_action),['reject','confirm'],'rejects precede new confirmations');

  const anchor={workerId:1,documentWorkerId:'w1',workerName:'Persona Uno',page:2,order:0,resolved:true,signatureX:123,signatureY:234,signatureWidth:105,signatureHeight:29};
  reset();await updateSupervisorMandatoryAnchors('doc',[anchor]);
  assert.deepEqual(workers[0].signature_box,{x:123,y:234,width:105,height:29});assert.equal(workers[0].page,2);
  assert.equal(document.details.workerAnchors[0].signatureX,123,'reopening uses server coordinates');
  reset();dropGeometry=true;await assert.rejects(updateSupervisorMandatoryAnchors('doc',[anchor]),/verificar la posición/);
  reset();document.lifecycle_status='READY';workers[0].detection_status='DETECTED';
  await updateSupervisorMandatoryAnchors('doc',[anchor]);
  assert.equal(workers[0].detection_status,'CONFIRMED','manual positioning also confirms pending detected worker');
  reset();const added={...anchor,workerId:-42,documentWorkerId:undefined,workerName:'Persona añadida manualmente',order:2};
  await updateSupervisorMandatoryAnchors('doc',[added]);
  assert.equal(workers.at(-1).legacy_worker_id,-900000000000001);
  assert(document.details.importedWorkerIds.includes(-900000000000001));
  assert.equal(document.details.workerAnchors.at(-1).signatureY,234);
  calls=[];await updateSupervisorMandatoryAnchors('doc',[added]);
  assert(!calls.some(call=>call.name==='add_missing_mandatory_document_worker_v2'),'retry reuses manually added documentary identity');
  reset();failVerification=true;await assert.rejects(updateSupervisorMandatoryAnchors('doc',[added]),/interrumpida/);
  await updateSupervisorMandatoryAnchors('doc',[added]);
  assert.equal(workers.filter(row=>row.printed_name===added.workerName).length,1,'lost response does not duplicate added worker on retry');
  reset();workers[1].detection_status='REJECTED';project();
  await updateSupervisorMandatoryAnchors('doc',[anchor,{...anchor,workerId:2,documentWorkerId:'w2',workerName:'Detección incorrecta'}]);
  assert(!document.details.importedWorkerIds.includes(2),'stale editor cannot resurrect a rejected worker');
  console.log('Mandatory selection, manual coordinates, added-worker persistence and retry regressions: OK');
}finally{await fs.rm(output,{force:true});delete globalThis.__mandatoryPersistenceApi;}
