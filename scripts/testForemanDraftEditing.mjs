import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {transform} from 'esbuild';

const migration=await fs.readFile('supabase/migrations/20261117210100_foreman_draft_edit_delete.sql','utf8');
const service=await fs.readFile('src/services/foremanPortalService.ts','utf8');
const portal=await fs.readFile('components/ForemanMobilePortal.tsx','utf8');
const workforce=await fs.readFile('components/WorkforceDocumentsPanel.tsx','utf8');
const parts=await fs.readFile('components/PartsPanel.tsx','utf8');
// Detect JSX syntax regressions early, before costly browser suites.
await transform(portal,{loader:'tsx',sourcefile:'ForemanMobilePortal.tsx'});
const operations=[
 'update_foreman_operational_draft','delete_foreman_operational_draft',
 'save_foreman_additional_draft','submit_foreman_additional_draft',
 'delete_foreman_additional_draft','delete_foreman_attendance_draft',
];
for(const operation of operations){
  assert.match(migration,new RegExp('create or replace function public\\.'+operation+'\\('));
  assert.match(migration,new RegExp('revoke all on function public\\.'+operation+'\\('));
  assert.match(migration,new RegExp('grant execute on function public\\.'+operation+'\\('));
  assert.match(service,new RegExp("supabase\\.rpc\\('"+operation+"'"));
}
assert.match(migration,/foreman_portal_draft_audit_owner_select/);
assert.match(migration,/owner_id=\(select auth\.uid\(\)\)/);
assert.match(migration,/token_hash=encode\(digest\(trim\(coalesce\(p_token,''\)\),'sha256'\),'hex'\)/);
assert.match(migration,/lower\(obra\)=lower\(v_access\.obra\)/);
assert.match(migration,/coalesce\(v_doc\.period_key,''\) not like 'encargado:%'/);
assert.match(migration,/v_doc\.source_gmail_message_id is not null/);
assert.match(migration,/v_doc\.status not in \('pending','in_progress'\)/);
assert.match(migration,/v_doc\.status<>'draft'/);
assert.match(migration,/p_reset_signatures/);
assert.match(migration,/delete from public\.worker_document_evidence/);
assert.match(migration,/for update/g);
assert.match(portal,/Editar documento/);
assert.match(portal,/Eliminar documento/);
assert.match(portal,/Retirar firmas y guardar/);
assert.match(portal,/Guardar borrador/);
assert.match(portal,/Eliminar borrador de control horario/);
assert.match(portal,/submitForemanAdditionalDraft/);
assert.match(workforce,/Anular con trazabilidad/);
assert.match(parts,/Anular con motivo/);
console.log('PASS: six guarded RPCs; token, owner, worksite, document lifecycle, auditing, signed-data invalidation and foreman edit/delete controls.');
