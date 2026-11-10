import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner='11111111-1111-4111-8111-111111111111';
const outsider='22222222-2222-4222-8222-222222222222';
const inspector='33333333-3333-4333-8333-333333333333';
const other='44444444-4444-4444-8444-444444444444';
const db=new PGlite();
const execute = async(sql,params)=>db.query(sql,params);
const identity = async(id)=>{await execute('set role authenticated');await execute("select set_config('request.jwt.claim.sub', $1, false)",[id]);};
try {
 await db.exec(`
   create role anon; create role authenticated;
   create schema auth;
   create function auth.uid() returns uuid language sql stable as
     $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema auth to authenticated, anon;
   grant execute on function auth.uid() to authenticated;
   create table auth.users(id uuid primary key,email text not null,email_confirmed_at timestamptz);
   insert into auth.users values
     ('${owner}','supervisor@example.org',now()),
     ('${inspector}','inspector@example.org',now()),
     ('${outsider}','outsider@example.org',now()),
     ('${other}','otro@example.org',null);
   create table public.trabajadores(
     id bigint primary key,owner_id uuid,apellidos_nombre text,categoria text,obra text,
     periodo_inicio text,periodo_fin text,formacion text,aptitud_medica text,
     reconocimiento_estado text
   );
   insert into public.trabajadores values
     (10,'${owner}','PERSONA PRUEBA','Peón','Obra de prueba',
      '2026-01-01','2026-01-15','Sí','Apto',null),
     (11,'${outsider}','DATO DE OTRO SUPERVISOR','Oficial','Otra obra',
      null,null,'No','DIAGNÓSTICO SENSIBLE',null);
 `);
 await db.exec(await readFile(new URL('../supabase/migrations/20261110070000_inspection_access_scoped.sql',import.meta.url),'utf8'));
 await identity(owner);
 await assert.rejects(()=>execute(
   "select public.issue_inspection_access(11,'inspector@example.org','inspector',array['identity'],30,'Verificación profesional presencial realizada')"
 ),/Trabajador no disponible/);
 await assert.rejects(()=>execute(
   "select public.issue_inspection_access(10,'inspector@example.org','direccion_facultativa',array['identity','medical_conclusion'],30,'Verificación profesional presencial realizada')"
 ),/Apartados no autorizados/);
 const result=await execute(
   "select public.issue_inspection_access(10,'inspector@example.org','inspector',array['identity','employment','medical_conclusion'],30,'Credencial profesional contrastada presencialmente') as id"
 );
 const id=result.rows[0].id;
 assert.match(id,/^[0-9a-f-]{36}$/);
 await identity(outsider);
 await assert.rejects(()=>execute('select public.read_inspection_access($1::uuid)',[id]),/Acceso no autorizado/);
 await identity(other);
 await assert.rejects(()=>execute('select public.read_inspection_access($1::uuid)',[id]),/Correo no verificado/);
 await identity(inspector);
 const access=(await execute('select public.read_inspection_access($1::uuid) as data',[id])).rows[0].data;
 assert.equal(access.worker.name,'PERSONA PRUEBA');
 assert.equal(access.worker.category,'Peón');
 assert.equal(access.worker.periodStart,'2026-01-01');
 assert.equal(access.worker.aptitudeConclusion,'Apto');
 assert.equal(access.worker.worksite,undefined);
 assert.equal(JSON.stringify(access).includes('DIAGNÓSTICO SENSIBLE'),false);
 assert.equal(JSON.stringify(access).includes('DATO DE OTRO SUPERVISOR'),false);
 await assert.rejects(()=>execute('select * from public.inspection_access_grants'),/permission denied/i);
 await identity(owner);
 const list=(await execute('select public.list_inspection_access(10) as grants')).rows[0].grants;
 assert.equal(list.length,1);
 assert.equal((await execute('select public.revoke_inspection_access($1::uuid) as revoked',[id])).rows[0].revoked,true);
 await identity(inspector);
 await assert.rejects(()=>execute('select public.read_inspection_access($1::uuid)',[id]),/Acceso no autorizado/);
 await execute('reset role');
 const audit=await execute('select event_type from public.inspection_access_audit order by id');
 assert.deepEqual(audit.rows.map(x=>x.event_type),['issued','consulted','revoked']);
 await execute('set role anon');
 await assert.rejects(()=>execute('select public.read_inspection_access($1::uuid)',[id]),/permission denied/i);
 console.log('PASS: RLS tables closed; identity verification, role scopes, per-owner isolation, verified email, short grant, audit, revocation and anonymous denial.');
} finally {await db.close();}
