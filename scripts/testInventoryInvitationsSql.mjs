import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const owner=id(1), guest=id(2), stranger=id(3), park=id(10);
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const rpc=async(name,args=[]) => (await query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;
const asUser=async(user) => {await db.exec('reset role');await query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);await db.exec(user?'set role authenticated':'set role anon');};
try {
  await db.exec(`create role authenticated; create role anon; create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key);
    create table profiles(id uuid primary key,email text,nombre text,apellidos text,active boolean default true);
    create table inventory_parks(id uuid primary key,nombre text,zona text,created_by uuid,created_at timestamptz default now());
    create table inventory_park_members(park_id uuid,user_id uuid,role text,active boolean default true,created_by uuid,created_at timestamptz default now(),unique(park_id,user_id));
    create function inventory_add_member_by_email(uuid,text) returns text language sql as $$select ''::text$$;
    grant usage on schema auth,private to authenticated,anon;
  `);
  const base=fs.readFileSync(new URL('../supabase/migrations/20260915153000_shared_inventory_zone6.sql',import.meta.url),'utf8');
  const start=base.indexOf('create or replace function private.inventory_is_member');
  await db.exec(base.slice(start,base.indexOf('-- Parks:',start)));
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260918233500_inventory_share_invitations.sql',import.meta.url),'utf8'));
  for(const [user,email] of [[owner,'owner@example.com'],[guest,'guest@example.com'],[stranger,'stranger@example.com']]) {
    await query('insert into auth.users values ($1)',[user]);
    await query('insert into profiles(id,email,nombre) values ($1,$2,$2)',[user,email]);
  }
  await query("insert into inventory_parks(id,nombre,zona,created_by) values ($1,'Parque prueba','Zona 6',$2)",[park,owner]);
  await asUser(owner);
  const invitation=await rpc('inventory_create_invitation',[park,'guest@example.com']);
  assert.equal((await rpc('inventory_create_invitation',[park,'guest@example.com'])).invitationId,invitation.invitationId,'retries reuse pending invitation');
  await asUser(guest);
  const pending=await query('select * from inventory_list_invitations()');
  assert.equal(pending[0].invitation_id,invitation.invitationId,'invitation visible without email delivery');
  assert.equal((await query('select private.inventory_is_member($1,false) allowed',[park]))[0].allowed,false,'no access before accepting');
  await asUser(stranger);
  assert.equal((await query('select * from inventory_list_invitations()')).length,0);
  await assert.rejects(()=>rpc('inventory_respond_invitation',[invitation.invitationId,true]),/no te pertenece/);
  await assert.rejects(()=>rpc('inventory_create_invitation',[park,'guest@example.com']),/Sin permisos/);
  await asUser(null);
  await assert.rejects(()=>rpc('inventory_list_invitations'),/permission denied/);
  await assert.rejects(()=>rpc('inventory_respond_invitation',[invitation.invitationId,true]),/permission denied/);
  await asUser(guest);
  assert.equal((await rpc('inventory_respond_invitation',[invitation.invitationId,true])).accepted,true);
  await assert.rejects(()=>rpc('inventory_respond_invitation',[invitation.invitationId,true]),/ya fue respondida/);
  await asUser(guest); // Fresh session retains membership.
  assert.equal((await query('select private.inventory_is_member($1,false) allowed',[park]))[0].allowed,true);
  assert.equal((await query('select * from inventory_list_invitations()')).length,0);
  await asUser(owner);await rpc('inventory_revoke_member',[park,guest]);
  await asUser(guest);
  assert.equal((await query('select private.inventory_is_member($1,false) allowed',[park]))[0].allowed,false);
  await asUser(owner);const rejected=await rpc('inventory_create_invitation',[park,'guest@example.com']);
  await asUser(guest);assert.equal((await rpc('inventory_respond_invitation',[rejected.invitationId,false])).accepted,false);
  assert.equal((await query('select private.inventory_is_member($1,false) allowed',[park]))[0].allowed,false);
  console.log('PASS inventory SQL: pending reuse, discovery without mail, recipient isolation, anon denial, acceptance, duplicate rejection, persistence, revoke, reject.');
} finally {await db.close();}
