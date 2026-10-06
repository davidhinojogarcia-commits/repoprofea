import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import crypto from 'node:crypto';

export const owner = '00000000-0000-0000-0000-000000000001';
export const other = '00000000-0000-0000-0000-000000000002';
export const token = 'test-local-only-foreman-token';

export async function preventionSqlFixture() {
  const db = new PGlite();
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
await db.exec(`
  create role anon; create role authenticated; create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to anon,authenticated;
  create table public.profiles(id uuid primary key);
  create table public.user_settings(user_id uuid,settings jsonb);
  create table public.foreman_portal_access(owner_id uuid,obra text,foreman_name text,token_hash text,active boolean);
`);
await db.query('insert into profiles values ($1),($2)', [owner, other]);
await db.query('insert into user_settings values ($1,$2),($3,$2)', [owner, {app:{savedObras:['Obra A','Obra B']}}, other]);
await db.query('insert into foreman_portal_access values ($1,$2,$3,$4,true)', [owner, 'Obra A', 'Encargado A', tokenHash]);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261006074525_prevention_incidents_and_checks.sql',import.meta.url),'utf8'));

async function asUser(id,role='authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id || '']);
  await db.exec(`set role ${role}`);
}
return { db, asUser };
}
