import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { workerTokenFromQr } from '../src/lib/workerQrScan.ts';
const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
assert.equal(workerTokenFromQr(`https://app.example/?worker-qr=${token}`, 'https://app.example'), token);
for (const value of [`https://evil.example/?worker-qr=${token}`, `https://app.example/?worker-qr=${token}&worker-qr=${token}`, 'https://app.example/?worker-qr=invalid', 'not a url']) assert.equal(workerTokenFromQr(value, 'https://app.example'), null);
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create table public.worker_qr_shares (token uuid,owner_id uuid,worker_dni text,revoked_at timestamptz);
    create table public.trabajadores (id bigint,owner_id uuid,dni text,periodo_inicio text,fecha_registro text);
    insert into public.worker_qr_shares values ('${token}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','12345678Z',null), ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','12345678Z',now());
    insert into public.trabajadores values (1,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','12345678-Z','2025-01-01','2025-01-01'), (2,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','12345678Z','2026-01-01','2026-01-01'), (3,'dddddddd-dddd-4ddd-8ddd-dddddddddddd','12345678Z','2027-01-01','2027-01-01');`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261027170836_resolve_worker_card_owner.sql', import.meta.url),'utf8'));
  await db.exec("set role authenticated; select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false)");
  const lookup = async t => (await db.query('select public.resolve_worker_card_owner($1::uuid) as id',[t])).rows[0].id;
  assert.equal(Number(await lookup(token)),2);
  assert.equal(await lookup('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),null);
  await db.exec("select set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false)");
  assert.equal(await lookup(token),null);
  await db.exec("reset role; set role anon");
  await assert.rejects(() => lookup(token), /permission denied/);
  console.log('PASS: URL validation and PostgreSQL owner isolation, revoked QR and anonymous denial.');
} finally { await db.close(); }
