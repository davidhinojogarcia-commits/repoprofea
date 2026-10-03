import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync(new URL('../supabase/migrations/20261003090000_mandatory_traceability_v2.sql', import.meta.url), 'utf8');
const additiveMigrationUrl = new URL('../supabase/migrations/20261003213000_manual_missing_mandatory_worker.sql', import.meta.url);
const additiveSql = fs.existsSync(additiveMigrationUrl) ? fs.readFileSync(additiveMigrationUrl, 'utf8') : '';
const allMandatorySql = sql + '\n' + additiveSql;
const must = (needle, msg=needle) => assert.ok(sql.includes(needle), msg);
const functionBody = (name) => {
  const marker = `create or replace function public.${name}(`;
  const start = sql.indexOf(marker);
  assert.ok(start >= 0, `Missing SQL function ${name}`);
  const bodyStart = sql.indexOf('as $$', start);
  const end = sql.indexOf('$$;', bodyStart);
  assert.ok(bodyStart >= 0 && end > bodyStart, `Cannot isolate SQL function ${name}`);
  return sql.slice(start, end + 3);
};

must('create table if not exists public.mandatory_document_workers_v2');
must('create table if not exists public.mandatory_document_signatures_v2');
must('create table if not exists public.mandatory_document_events_v2');
must('create table if not exists public.mandatory_document_versions_v2');
must("detection_status in ('DETECTED','CONFIRMED','REJECTED')");
must("position_status in ('PENDING','RESOLVED','REJECTED')");
must('create or replace function public.submit_mandatory_document_v2');
must('insert into public.mandatory_document_versions_v2');
must("lifecycle_status='SUBMITTED'");
must("if v_doc.lifecycle_status='RETURNED_FOR_CORRECTION' then raise exception 'El documento está devuelto para corrección; no existe un PDF final vigente'");
must('update public.foreman_mandatory_pdf_files set signed_pdf=null,signed_sha256=null,fidelity=null');
must('create or replace function public.get_supervisor_mandatory_signed_pdf_v2');
must("if not found or v_file.signed_pdf is null or coalesce(v_file.signed_sha256,'')='' then raise exception 'No existe un PDF firmado persistido'");
assert.ok(!/get_supervisor_mandatory_signed_pdf_v2[\s\S]{0,5000}original_pdf/.test(sql), 'Supervisor V2 must never fall back to original_pdf');

const submitStart = sql.indexOf('create or replace function public.submit_mandatory_document_v2');
const submitEnd = sql.indexOf('create or replace function public.get_supervisor_mandatory_signed_pdf_v2');
const submit = sql.slice(submitStart, submitEnd);
assert.ok(submit.indexOf('insert into public.mandatory_document_versions_v2') < submit.indexOf("lifecycle_status='SUBMITTED'"), 'Version must be stored before SUBMITTED state');
assert.ok(submit.includes("if v_signed=0 then raise exception 'Debe existir al menos una firma antes de enviar'"));
assert.ok(submit.includes("v_mode:=case when v_signed<v_total then 'partial' else 'complete' end"));
assert.ok(submit.includes("if v_doc.lifecycle_status in ('SUBMITTED','RECEIVED','REVIEWED') then"));
assert.ok(submit.includes("return jsonb_build_object('ok',true,'idempotent',true"));

const dollarTags = [...sql.matchAll(/\$\$/g)].length;
assert.equal(dollarTags % 2, 0, 'Unbalanced $$ delimiters');

let paren = 0;
let inSingle = false;
for (let i=0;i<sql.length;i++) {
  const ch=sql[i], next=sql[i+1];
  if (ch==="'" && inSingle && next==="'") { i++; continue; }
  if (ch==="'") { inSingle=!inSingle; continue; }
  if (!inSingle) {
    if (ch==='(') paren++;
    if (ch===')') paren--;
    assert.ok(paren>=0, 'Closing parenthesis before opening parenthesis');
  }
}
assert.equal(paren,0,'Unbalanced parentheses');
assert.equal(inSingle,false,'Unbalanced single quote');

assert.ok(sql.includes("'ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION','SUBMITTED','RECEIVED','REVIEWED'"), 'returned docs must remain identity-frozen');

assert.ok(sql.includes("'reviewed:'||v_version::text"), 'review events must be version-specific');

assert.ok(sql.includes("life:='PDF_VALIDATION_ERROR'"), 'historical completed docs without validated signed PDF must be flagged');

assert.ok(sql.includes('insert into public.mandatory_document_versions_v2(document_id,owner_id,version_no'), 'historical valid signed PDFs must be backfilled as versions');

assert.ok(sql.includes("coalesce((hist_file.fidelity->>'ok')::boolean,false)=true"), 'historical signed PDF backfill must require fidelity');

assert.ok(sql.includes('create or replace function public.reopen_mandatory_document_v2'), 'repair reopen RPC must exist');

assert.ok(sql.includes("'REOPENED_FOR_REPAIR'"), 'repair reopen must be traced');


// Regression: DETECTED candidates must participate in pre-assignment state calculation.
assert.match(sql, /count\(\*\) filter \(where detection_status='DETECTED'\)[\s\S]*from public\.mandatory_document_workers_v2[\s\S]*where document_id=p_document_id;/i);
assert.doesNotMatch(sql, /from public\.mandatory_document_workers_v2\s+where document_id=p_document_id and detection_status='CONFIRMED';\s*\n\s*if v_detected/i);
// Regression: worker review must persist the recomputed lifecycle state.
const reviewBody = functionBody('review_mandatory_document_worker_v2');
assert.match(reviewBody, /update public\.foreman_mandatory_documents[\s\S]*set lifecycle_status=v_status/i);


const defined=new Set([...sql.matchAll(/create or replace function public\.(mandatory_v2_[a-z0-9_]+)/gi)].map(m=>m[1].toLowerCase()));
const referenced=new Set([...sql.matchAll(/public\.(mandatory_v2_[a-z0-9_]+)\s*\(/gi)].map(m=>m[1].toLowerCase()));
for(const fn of referenced){
  assert.ok(defined.has(fn),`undefined mandatory_v2 function reference: ${fn}`);
}

const service=fs.readFileSync(new URL('../src/services/mandatoryTraceabilityServiceV2.ts',import.meta.url),'utf8');
const serviceRpcs=new Set([...service.matchAll(/supabase\.rpc\('([^']+)'/g)].map(m=>m[1]));
const definedRpcs=new Set([...allMandatorySql.matchAll(/create or replace function public\.([a-z0-9_]+)\s*\(/gi)].map(m=>m[1]));
for(const rpc of serviceRpcs){
  assert.ok(definedRpcs.has(rpc),`service RPC missing from migration: ${rpc}`);
  assert.match(allMandatorySql,new RegExp(`grant execute on function public\\.${rpc.replace(/[.*+?^${}()|[\\]\\]/g,'\\  assert.match(sql,new RegExp(`grant execute on function public\\.${rpc.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}\\(`,'i'),`RPC missing execute grant: ${rpc}`);')}\\(`,'i'),`RPC missing execute grant: ${rpc}`);
}

assert.ok(!/mandatory_document_events_v2\([^)]*\bpayload\b/i.test(sql),'events V2 insert uses nonexistent payload column');
assert.ok(!/mandatory_document_events_v2\([^)]*\bidempotency_key\b/i.test(sql),'events V2 insert uses nonexistent idempotency_key column');

assert.match(sql,/select \* into v_doc from public\.foreman_mandatory_documents[^;]+for update;/is,'concurrent submit must lock document');
assert.match(sql,/if v_doc\.lifecycle_status in \('SUBMITTED','RECEIVED','REVIEWED'\)[\s\S]+signed_sha256[\s\S]+idempotent/is,'submitted retry must be SHA-idempotent');

assert.match(sql,/m\.v2_initialized_at is null or m\.lifecycle_status in \('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION','SUBMITTED','RECEIVED','REVIEWED'\)/i,'portal must hide unassigned V2 documents');

assert.ok(!/mandatory_document_(?:signatures|versions)_v2[^;\n]*detection_status/i.test(sql),'signature/version tables must not use detection_status');

assert.ok(!/review_mandatory_document_worker_v2[\s\S]{0,1800}lifecycle_status in \([^)]*RETURNED_FOR_CORRECTION/i.test(sql),'returned document must allow structural supervisor review');
assert.match(sql,/delete from public\.mandatory_document_signatures_v2 where document_worker_id=p_document_worker_id;[\s\S]{0,500}signatures=coalesce\(signatures,'\{\}'::jsonb\)-v_worker\.legacy_worker_id::text/i,'rejecting a returned false positive must clear V2 and legacy signature mirrors');


// Initialization must never allow a caller to force READY/ASSIGNED or later states.
const initBody = functionBody('initialize_mandatory_document_v2');
assert.doesNotMatch(initBody, /if\s+p_lifecycle_status\s+in/i, 'initial lifecycle must be backend-derived');
assert.doesNotMatch(initBody, /p_lifecycle_status in \([^)]*(?:READY|ASSIGNED|IN_SIGNATURE|SUBMITTED|RECEIVED|REVIEWED)/i, 'unsafe lifecycle override is forbidden');


// Signatures must be image data and counts must include only currently CONFIRMED document workers.
const signBody = functionBody('sign_mandatory_document_worker_v2');
assert.match(signBody, /data:image\/\(png\|jpeg\|jpg\|webp\);base64/i);
assert.match(signBody, /join public\.mandatory_document_workers_v2 w[\s\S]*w\.detection_status='CONFIRMED'/i);
const submitBody2 = functionBody('submit_mandatory_document_v2');
assert.match(submitBody2, /join public\.mandatory_document_workers_v2 w[\s\S]*w\.detection_status='CONFIRMED'/i);
// Structural edits after a return must unfreeze the edited worker so the next assignment freezes a fresh revision.
assert.match(reviewBody, /frozen_at=null/i);
// Supervisor confirmations use a content hash so a genuine later correction creates a new trace event.
assert.match(reviewBody, /worker-confirmed:[\s\S]*extensions\.digest/i);


// Manual supervisor placement is a supported regression: signature box is enough only when position_source=MANUAL.
const preStatusBody = functionBody('mandatory_v2_resolve_preassignment_status');
assert.match(preStatusBody, /position_source<>'MANUAL'[\s\S]*mandatory_v2_box_valid\(name_box\)/i);
assert.match(preStatusBody, /not public\.mandatory_v2_box_valid\(signature_box\)/i);
const geometryBody = functionBody('update_mandatory_document_worker_geometry_v2');
assert.match(geometryBody, /position_source=case when public\.mandatory_v2_box_valid\(p_name_box\) then 'AUTO' else 'MANUAL' end/i);
assert.match(sql, /Posición confirmada manualmente por el supervisor/i);


// Historical backfill must only treat real graphical data URLs as signatures.
assert.equal((sql.match(/~ '\^data:image\/\(png\|jpeg\|jpg\|webp\);base64,'/g)||[]).length >= 3, true);
const backfillSection = sql.slice(sql.indexOf('-- Backfill existing imported Inicio / Control documents'));
assert.match(backfillSection, /join public\.mandatory_document_workers_v2 w[\s\S]*hist_signed[\s\S]*detection_status='CONFIRMED'/i);


// Structural repair after a returned submission must start a fresh freeze/assignment cycle.
assert.match(reviewBody, /lifecycle_status='RETURNED_FOR_CORRECTION'[\s\S]*frozen_at=null[\s\S]*assigned_at=null/i);
assert.match(geometryBody, /lifecycle_status='RETURNED_FOR_CORRECTION'[\s\S]*frozen_at=null[\s\S]*assigned_at=null/i);
const assignBody = functionBody('assign_mandatory_document_v2');
assert.match(assignBody, /assigned_at=now\(\)/i);
assert.match(assignBody, /assigned:'\|\|v_next_version::text/i);
assert.match(assignBody, /not in \('ANALYZED','NEEDS_WORKSITE_REVIEW','NEEDS_WORKER_REVIEW','NEEDS_SIGNATURE_POSITION_REVIEW','READY','PDF_VALIDATION_ERROR'\)/i);


// Table-level integrity must reject impossible traceability records even if application logic regresses.
assert.match(sql, /detection_confidence numeric check \(detection_confidence is null or \(detection_confidence>=0 and detection_confidence<=1\)\)/i);
assert.match(sql, /signature text not null check \(signature ~ '\^data:image/i);
assert.match(sql, /signature_sha256 text not null check \(signature_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
assert.match(sql, /version_no integer not null check \(version_no>0\)/i);
assert.match(sql, /submission_mode='complete' and signed_count=required_count/i);
assert.match(sql, /submission_mode='partial' and signed_count>0 and signed_count<required_count/i);


// A legacy returned document may reach the foreman only if its structure is READY and frozen during backfill.
const backfill = sql.slice(sql.indexOf('-- Backfill existing imported Inicio / Control documents'));
assert.match(backfill, /elsif d\.status='returned'[\s\S]*pre_status:=public\.mandatory_v2_resolve_preassignment_status\(d\.id\)[\s\S]*if pre_status='READY'[\s\S]*frozen_at=coalesce\(frozen_at,d\.correction_requested_at,d\.updated_at,now\(\)\)[\s\S]*life:='RETURNED_FOR_CORRECTION'[\s\S]*else[\s\S]*life:=pre_status/i);


// Database-level state machine blocks accidental lifecycle jumps outside V2 RPCs.
const guardBody = functionBody('guard_mandatory_v2_lifecycle_transition');
assert.match(sql, /create trigger trg_guard_mandatory_v2_lifecycle_transition[\s\S]*before update of lifecycle_status,v2_initialized_at/i);
assert.match(guardBody, /old\.lifecycle_status='READY' and new\.lifecycle_status in \('NEEDS_WORKER_REVIEW','NEEDS_SIGNATURE_POSITION_REVIEW','READY','ASSIGNED'\)/i);
assert.match(guardBody, /old\.lifecycle_status='SUBMITTED' and new\.lifecycle_status in \('RECEIVED','REVIEWED','RETURNED_FOR_CORRECTION'\)/i);
assert.match(guardBody, /old\.lifecycle_status='RETURNED_FOR_CORRECTION' and new\.lifecycle_status in \('IN_SIGNATURE','SUBMITTED','NEEDS_WORKER_REVIEW','NEEDS_SIGNATURE_POSITION_REVIEW','READY'\)/i);
assert.match(guardBody, /raise exception 'Transición V2 no permitida/i);


// V2 portal resolver must preserve the latest optimized payload, not regress to an older definition.
const portalBody = functionBody('resolve_foreman_portal');
assert.match(portalBody, /'worksite',coalesce\(/i);
assert.match(portalBody, /'quincena',t\.quincena/i);
assert.match(portalBody, /'calzado',t\.calzado/i);
assert.match(portalBody, /r\.row - 'entrySignature' - 'exitSignature'/i);
assert.match(portalBody, /jsonb_object_agg\(k,'signed'\)/i);
assert.match(portalBody, /'lifecycleStatus',m\.lifecycle_status/i);
assert.match(portalBody, /m\.v2_initialized_at is null or m\.lifecycle_status in \('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION','SUBMITTED','RECEIVED','REVIEWED'\)/i);


// Historical migration must be explicit, not presented as reconstructed native events.
assert.match(sql, /'LEGACY_BACKFILLED','sistema'[\s\S]*'legacyStatus'[\s\S]*'signedVersionRecovered'/i);
assert.match(sql, /'legacy-backfill'/i);


// REVIEWED is allowed only after revalidating the exact persisted PDF against the latest version SHA.
const reviewedBody = functionBody('review_submitted_mandatory_document_v2');
assert.match(reviewedBody, /digest\(v_file\.signed_pdf,'sha256'\)/i);
assert.match(reviewedBody, /order by version_no desc limit 1/i);
assert.match(reviewedBody, /v_version_sha[\s\S]*v_file\.signed_sha256/i);
assert.ok(reviewedBody.indexOf("lifecycle_status='REVIEWED'") > reviewedBody.indexOf('v_version_sha'), 'Integrity must be checked before REVIEWED state');


// Reviewing a just-submitted document must record receipt first in the same transaction.
assert.match(reviewedBody, /if v_doc\.lifecycle_status='SUBMITTED'[\s\S]*lifecycle_status='RECEIVED'[\s\S]*'RECEIVED_BY_SUPERVISOR'[\s\S]*lifecycle_status='REVIEWED'/i);


// A re-sign in a later correction version must create a new event even if the image hash is identical.
assert.match(signBody, /max\(version_no\),0\)\+1 into v_target_version/i);
assert.match(signBody, /'targetVersion',v_target_version/i);
assert.match(signBody, /'signed:'\|\|p_document_worker_id::text\|\|':v'\|\|v_target_version::text/i);


// New documents must expose import and fidelity-validation milestones explicitly.
const initBody2 = functionBody('initialize_mandatory_document_v2');
assert.match(initBody2, /'IMPORTED','supervisor'[\s\S]*'originalSha256'/i);
assert.match(submitBody2, /'PDF_VALIDATED','sistema'[\s\S]*'visualMismatchRatio'/i);
assert.ok(submitBody2.indexOf("'PDF_VALIDATED'") < submitBody2.indexOf("lifecycle_status='SUBMITTED'"), 'PDF validation event must precede SUBMITTED state');

console.log('Mandatory traceability V2 SQL invariants passed.');

// Assignment must respect lifecycle guard: pending review -> READY -> ASSIGNED, never jump directly.
{
  const assign = sql.match(/create or replace function public\.assign_mandatory_document_v2[\s\S]*?\n\$\$;/i)?.[0] || '';
  assert.match(assign, /if v_current_status<>'READY' then[\s\S]*set lifecycle_status='READY'/i, 'assign must normalize resolved preassignment state to READY first');
  assert.match(assign, /set lifecycle_status='ASSIGNED'/i, 'assign must then transition READY to ASSIGNED');
  const guard = sql.match(/create or replace function public\.guard_mandatory_v2_lifecycle_transition[\s\S]*?\n\$\$;/i)?.[0] || '';
  assert.match(guard, /old\.lifecycle_status='READY'[\s\S]*'ASSIGNED'/i, 'guard must explicitly allow READY -> ASSIGNED');
}

// Initial lifecycle is backend-derived; client-provided p_lifecycle_status must never override it.
{
  const init = sql.match(/create or replace function public\.initialize_mandatory_document_v2[\s\S]*?\n\$\$;/i)?.[0] || '';
  assert.doesNotMatch(init, /if\s+p_lifecycle_status\s+in/i, 'client lifecycle override must not control initialization');
  assert.match(init, /mandatory_v2_resolve_preassignment_status\(p_document_id\)/i, 'backend must derive initial lifecycle');
}

// Portal V2 redefinition must preserve the latest legacy payload; only mandatory visibility is narrowed.
{
  const portal = sql.match(/create or replace function public\.resolve_foreman_portal\(p_token text\)[\s\S]*?\n\$\$;/i)?.[0] || '';
  for (const required of ["'worksite'", "'quincena'", "'calzado'", "'formacion'", "'lugarFormacion'", "'aptitudMedica'", "'reconocimientoLimitaciones'", "'documents'", "'attendance'", "'mandatoryDocuments'"]) {
    assert.ok(portal.includes(required), `resolve_foreman_portal must preserve ${required}`);
  }
  assert.match(portal, /v2_initialized_at is null or m\.lifecycle_status in \('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION','SUBMITTED','RECEIVED','REVIEWED'\)/i, 'only V2 mandatory visibility may be narrowed');
}

// Every document worker must have a document-local numeric bridge for legacy PDF overlay; it is never a Directory identity.
{
  const init = functionBody('initialize_mandatory_document_v2');
  assert.match(init, /coalesce\(nullif\(v_item->>'legacyWorkerId',''\)::bigint,\(-900000000000000::bigint-v_bridge_seq\)\)/i, 'new document-only workers need a negative bridge id');
  assert.match(sql, /if legacy_id is null then bridge_seq:=bridge_seq\+1; legacy_id:=-900000000000000::bigint-bridge_seq; end if;/i, 'historical null ids need a negative bridge id');
}
