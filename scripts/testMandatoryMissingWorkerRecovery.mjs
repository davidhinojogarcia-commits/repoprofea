import fs from 'node:fs';
import assert from 'node:assert/strict';

const editor=fs.readFileSync(new URL('../components/MandatoryPdfAnchorEditor.tsx',import.meta.url),'utf8');
const service=fs.readFileSync(new URL('../src/services/mandatoryTraceabilityServiceV2.ts',import.meta.url),'utf8');
const portal=fs.readFileSync(new URL('../src/services/foremanPortalService.ts',import.meta.url),'utf8');
const dashboard=fs.readFileSync(new URL('../components/ForemanDocumentsDashboard.tsx',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/migrations/20261003213000_manual_missing_mandatory_worker.sql',import.meta.url),'utf8');

assert.match(editor,/documentType\?: string/);
assert.match(dashboard,/documentType=\{positioningMandatory\.document_type\}/);
assert.match(editor,/documentType==='control_presencia'[\s\S]*setAvailableWorkers\(\[\]\)/);
assert.match(editor,/Nombre y apellidos exactamente como aparecen en el PDF/);
assert.match(editor,/Añadir trabajador del PDF/);
assert.match(editor,/workerId:temporaryId/);
assert.match(editor,/signatureX:null[\s\S]*resolved:false/);

assert.match(service,/add_missing_mandatory_document_worker_v2/);
assert.match(portal,/addMissingMandatoryDocumentWorkerV2/);
assert.match(portal,/if\(!row\)[\s\S]*printedName[\s\S]*signatureBox[\s\S]*addMissingMandatoryDocumentWorkerV2/);
assert.match(portal,/normalizedAnchors\[index\]=\{[\s\S]*workerId:stableLegacyId[\s\S]*documentWorkerId/);

assert.match(sql,/create or replace function public\.add_missing_mandatory_document_worker_v2/);
assert.match(sql,/v_doc\.document_type not in \('inicio','control_presencia'\)/);
assert.match(sql,/v_doc\.lifecycle_status in \('SUBMITTED','RECEIVED','REVIEWED'\)/);
assert.match(sql,/directory_worker_id[\s\S]*values\([\s\S]*v_name,null,p_page/i,'manual recovery must not bind to Directory');
assert.match(sql,/detection_status[\s\S]*'CONFIRMED'/);
assert.match(sql,/'RESOLVED','MANUAL'/);
assert.match(sql,/case when v_keep_active then now\(\) else null end/);
assert.match(sql,/'WORKER_ADDED_MANUALLY'/);
assert.match(sql,/'SIGNATURE_POSITION_RESOLVED'/);
assert.match(sql,/signed_pdf=null,signed_sha256=null,fidelity=null/);
assert.match(sql,/v_keep_active:=v_doc\.lifecycle_status in \('ASSIGNED','IN_SIGNATURE'\)/);
assert.match(sql,/'importedWorkerIds',v_ids/);
assert.match(sql,/'workerAnchors',v_anchors/);
assert.match(sql,/'documentWorkersV2',v_workers/);
assert.match(sql,/grant execute on function public\.add_missing_mandatory_document_worker_v2/);

console.log('Manual missing-worker recovery regression passed.');
