import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path:string)=>fs.readFileSync(path,'utf8');
const mobile=read('components/ForemanMobilePortal.tsx');
const dashboard=read('components/ForemanDocumentsDashboard.tsx');
const service=read('src/services/foremanPortalService.ts');
const intake=read('src/lib/mandatoryEmailIntake.ts');
const release=read('src/lib/appVersion.ts');

assert.ok(service.includes('initializeMandatoryTraceabilityV2'), 'Import must initialize V2 source of truth');
assert.ok(intake.includes('__PENDING_WORKSITE__'), 'Unresolved worksite PDFs must be preserved for supervisor review');

assert.ok(intake.includes("const knownWorksites = options?.obraCandidates?.length"), 'Import must classify only against known supervisor works');
assert.ok(intake.includes("files.length === 1 ? obraHint : ''"), 'Only a single manual PDF may use the selected worksite as fallback');
assert.ok(intake.includes("documento conservado pendiente de clasificar por obra"), 'Unknown worksite PDF must be preserved, not discarded or guessed');
assert.ok(!intake.includes("documentObra || String(listedWorkers.find(worker=>worker.obra)?.obra || '').trim()"), 'Worksite must not be inferred from Directory workers');
assert.ok(mobile.includes('submitMandatoryDocumentV2'), 'Foreman final send must be atomic V2 submit');
assert.ok(mobile.includes('documentWorkerId'), 'Foreman signing must use documentWorkerId');

const previewStart=mobile.indexOf('const buildExactSignedPreview=async');
const previewEnd=mobile.indexOf('const previewMandatoryPdf=async',previewStart);
const preview=mobile.slice(previewStart,previewEnd);
assert.ok(previewStart>=0&&previewEnd>previewStart);
assert.ok(!preview.includes('analyzeMandatoryOriginalPdf'), 'Assigned document must not recalculate OCR anchors');
assert.ok(!preview.includes('resolveMandatoryAnchorsWithOcrRows'), 'Assigned document must not rerun OCR');
assert.ok(!preview.includes('repairForemanMandatoryAnchors'), 'Foreman must not mutate frozen geometry');

const supervisorStart=dashboard.indexOf('const buildSupervisorSignedPdf=async');
const supervisorEnd=dashboard.indexOf('const downloadStoredMandatoryPdf=async',supervisorStart);
const supervisor=dashboard.slice(supervisorStart,supervisorEnd);
assert.ok(supervisor.includes('getSupervisorMandatorySignedPdfV2'));
assert.ok(!supervisor.includes('buildSignedMandatoryPdf'), 'Supervisor must never rebuild signed PDF');
assert.ok(!supervisor.includes("getSupervisorMandatoryPdf(item.id,'original')"), 'Supervisor signed download must not fall back to original');


assert.ok(dashboard.includes('reviewSubmittedMandatoryDocumentV2'), 'Supervisor review must use V2 lifecycle');
assert.ok(dashboard.includes('returnMandatoryDocumentV2'), 'Supervisor return must use V2 lifecycle');

assert.ok(dashboard.includes('reopenMandatoryDocumentV2'), 'Historical invalid PDFs must expose repair reopen action');

assert.ok(!release.includes('se reconstruye con las firmas actuales guardadas'), '1.19.0 notes must not advertise supervisor PDF reconstruction');
assert.ok(!release.includes('Eliminación disponible tanto para supervisor como para encargado'), '1.19.0 notes must not advertise foreman identity deletion');

assert.ok(service.includes("initialized?.lifecycleStatus==='READY'")&&service.includes('assignMandatoryDocumentV2(documentId)'), 'Fully resolved imports must auto-assign to foreman');


assert.ok(dashboard.includes("result?.lifecycleStatus==='READY'")&&dashboard.includes('assignMandatoryDocumentV2(worksiteReview.item.id)'), 'Resolving the worksite must auto-assign when the rest of the document is already READY');


assert.ok(intake.includes("resolveMandatoryWorksite({ text, candidates, fallback: '' })"), 'Automatic detection must not let an unknown printed label bypass the known-worksite check');
assert.ok(intake.includes("if (fallback) return fallback"), 'A single manual PDF may use the supervisor-selected worksite as an explicit fallback');

assert.match(dashboard, /id:hasLegacyId\?legacyIdRaw:'v2:'\+documentWorkerId/, 'supervisor editor must support document workers without legacy ids');
assert.match(dashboard, /worker\.legacyWorkerId!=null\?anchors\.find/, 'anchor lookup must be optional when no legacy id exists');
assert.match(dashboard, /worker\.legacyWorkerId==null \|\| Number\(worker\.legacyWorkerId\)<0/, 'document-only workers must remain visible as unmatched/documental');
assert.match(dashboard, /editWorkerFilter==='document'&&!worker\.documentWorkerId/, 'document filter must recognize documentWorkerId without legacy id');
assert.ok(!dashboard.includes('removeDetectedWorkerAsSupervisor(editingMandatory,worker)'), 'legacy supervisor delete button must be removed from V2 editor');

console.log('Mandatory traceability V2 integration contract passed.');
