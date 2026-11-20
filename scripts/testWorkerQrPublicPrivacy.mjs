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
  await db.exec(`reset role; create schema private;
    alter table public.trabajadores add column categoria text,
      add column periodo_inicio text, add column periodo_fin text;
    update public.trabajadores set categoria = 'Oficial', formacion = 'Sí',
      periodo_inicio = '2000-01-01', periodo_fin = '2099-12-31';`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261120083000_worker_qr_public_consultation.sql', import.meta.url), 'utf8'));
  const card = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const nonce = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const read = async (token = card, session = nonce, start = false) =>
    (await db.query('select public.read_worker_qr_public_consultation($1, $2, $3) as result', [token, session, start])).rows[0].result;

  await db.exec('set role anon');
  assert.deepEqual(await read(card, nonce, true), { status: 'not_available' });
  await db.exec(`reset role; update public.worker_qr_shares set public_consultation_enabled = true; set role anon;`);
  assert.deepEqual(await read(), { status: 'card_expired' });
  const { remainingMs, ...data } = await read(card, nonce, true);
  assert.ok(remainingMs > 599000 && remainingMs <= 600000);
  assert.deepEqual(data, {
    status: 'ok', workerName: 'PRIVATE_NAME', professionalCategory: 'Oficial', maskedDni: '*****678*',
    worksite: 'PRIVATE_WORK', periodStart: '2000-01-01', periodEnd: '2099-12-31',
    contractActive: true, trainingRecord: 'Consta en ficha',
  });
  assert.deepEqual(await read('cccccccc-cccc-4ccc-8ccc-cccccccccccc', nonce, true), { status: 'not_available' });
  await assert.rejects(db.query('select * from private.worker_qr_public_consultations'), /permission denied/);
  await db.exec(`reset role; update private.worker_qr_public_consultations set expires_at = now() - interval '1 second'; set role anon;`);
  assert.deepEqual(await read(card, nonce, true), { status: 'card_expired' });
  assert.equal((await read(card, 'ffffffff-ffff-4fff-8fff-ffffffffffff', true)).status, 'ok');
  await db.exec(`reset role; update public.worker_qr_shares set revoked_at = now(); set role anon;`);
  assert.deepEqual(await read(), { status: 'not_available' });
  console.log('PASS: anonymous QR allowlist, masked DNI, expiry, rescan, revocation and excluded medical fields.');
} finally { await db.close(); }
