import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema private; grant usage on schema private to anon,authenticated,service_role;
    create table public.audit_logs(id bigint primary key,action text,"timestamp" timestamptz);
    alter table public.audit_logs enable row level security;
    create table public.foreman_document_versions(id bigint,snapshot jsonb);
    insert into public.foreman_document_versions values (1,'{"signature":"preserve"}');
    create schema cron;
    create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text);
    create table cron.job_run_details(runid bigint,jobid bigint,end_time timestamptz);
    create function cron.schedule(text,text,text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command) values ($1,$2,$3)
      on conflict (jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid;
    $$;
  `);
  const sql=(await fs.readFile(new URL('../supabase/migrations/20261007094440_app_audit_log_retention.sql',import.meta.url),'utf8'))
    .replace('create extension if not exists pg_cron with schema pg_catalog;','');
  await db.exec(sql);
  await db.exec(sql);
  assert.equal((await db.query('select count(*)::int as n from cron.job')).rows[0].n,1,'reapplication does not duplicate jobs');
  const job=(await db.query('select * from cron.job')).rows[0];
  assert.equal(job.schedule,'20 3 * * *');
  assert(job.command.includes("statement_timeout = '60s'"));
  await db.exec(`begin;
    insert into public.audit_logs values
      (1,'LOGIN',now()-interval '31 days'),(2,'LOGIN',now()-interval '30 days'),
      (3,'UPDATE',now()-interval '181 days'),(4,'DELETE',now()-interval '180 days'),
      (5,'CREATE_USER',now()-interval '40 days'),(6,null,now()-interval '181 days'),
      (7,'LOGIN',null),(8,'UPDATE',now());
    insert into cron.job_run_details values
      (1,${job.jobid},now()-interval '8 days'),(2,${job.jobid},now()-interval '7 days'),
      (3,999,now()-interval '8 days'),(4,${job.jobid},null);
  `);
  const counts=(await db.query('select private.prune_app_audit_logs() as result')).rows[0].result;
  assert.deepEqual(counts,{login_deleted:1,audit_deleted:2,maintenance_runs_deleted:1});
  assert.deepEqual((await db.query('select id from public.audit_logs order by id')).rows.map(x=>x.id),[2,4,5,7,8]);
  assert.deepEqual((await db.query('select runid from cron.job_run_details order by runid')).rows.map(x=>x.runid),[2,3,4]);
  await db.exec('commit');
  for (const role of ['anon','authenticated','service_role']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select private.prune_app_audit_logs()'),/permission denied/);
    await db.exec('reset role');
  }
  await db.exec('delete from public.audit_logs');
  await db.exec(`insert into public.audit_logs select 100+x,'LOGIN',now()-interval '40 days' from generate_series(1,10001) as x;`);
  assert.equal((await db.query('select private.prune_app_audit_logs() as result')).rows[0].result.login_deleted,10000);
  assert.equal((await db.query('select private.prune_app_audit_logs() as result')).rows[0].result.login_deleted,1);
  assert.deepEqual((await db.query('select snapshot from public.foreman_document_versions')).rows[0].snapshot,{signature:'preserve'});
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.audit_logs'::regclass")).rows[0].relrowsecurity,true);
  console.log('Audit retention SQL passed: cutoffs, bounded backlog, scoped Cron history, idempotence, denied API execution, RLS and document preservation. Scheduler mocked locally; verify real Cron in Supabase.');
} finally {await db.close();}
