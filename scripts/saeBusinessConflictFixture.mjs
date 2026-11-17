import assert from 'node:assert/strict';
import fs from 'node:fs';

// Applied to each real PostgreSQL fixture after its historical migrations.
export async function applyBusinessConflictFix(db) {
  const functions = async () => (await db.query(`select p.oid, p.proacl, p.proowner, p.prosecdef, p.proconfig,
    pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.prokind='f' and (n.nspname='public' and p.proname in
    ('sae_finalize_report_version','sae_sync_fortnight_codes','sae_apply_monthly_2500','sae_set_report_period')
    or n.nspname='sae_private' and p.proname='candidate_changed') order by p.oid`)).rows;
  const before = await functions();
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261025072447_sae_business_conflict_http409.sql', import.meta.url), 'utf8');
  await db.exec('reset role');
  await db.exec(sql);
  const after = await functions();
  assert.deepEqual(after, before.map(row => ({...row,
    definition: row.definition.replace(/errcode\s*=\s*'40001'/gi, "errcode='PT409'")
  })), 'only conflict SQLSTATE changes; locks, permissions, ownership and body remain identical');
  await db.exec(sql);
  assert.deepEqual(await functions(), after, 'migration is idempotent');
}
