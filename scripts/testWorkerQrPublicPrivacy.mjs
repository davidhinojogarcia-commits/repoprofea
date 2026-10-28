import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated;
    create table public.worker_qr_shares (token uuid primary key, owner_id uuid not null, worker_dni text not null, revoked_at timestamptz);
    create table public.trabajadores (id bigint, owner_id uuid, dni text, apellidos_nombre text, obra text, formacion text, aptitud_medica text);
    insert into public.worker_qr_shares values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','12345678Z',null),
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','12345678Z',now()),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','UNMATCHED',null);
    insert into public.trabajadores values (1,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','12345678-Z','PRIVATE_NAME','PRIVATE_WORK','PRIVATE_TRAINING','PRIVATE_HEALTH');`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261027165247_restrict_public_worker_qr.sql', import.meta.url), 'utf8'));
  await db.exec('set role anon');
  const query = async token => (await db.query('select public.resolve_worker_qr_share($1::uuid) as result', [token])).rows[0].result;
  assert.deepEqual(await query('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), { valid: true, history: [{}] });
  for (const token of ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'])
    assert.deepEqual(await query(token), { valid: false, history: [] });
  console.log('PASS: anonymous PostgreSQL RPC returns status only; revoked, missing and unlinked tokens are invalid.');
} finally { await db.close(); }
