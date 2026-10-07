-- App audit retention, separate from Supabase's managed Logs Ingest.
-- Daily server-side maintenance; never touches documents, signatures or versions.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.prune_app_audit_logs()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_login bigint;
  v_other bigint;
  v_runs bigint;
begin
  -- Bound each execution so a backlog cannot hold long-lived write locks.
  with expired as (
    select id from public.audit_logs
    where (action = 'LOGIN' and "timestamp" < now() - interval '30 days')
       or (action is distinct from 'LOGIN' and "timestamp" < now() - interval '180 days')
    order by "timestamp", id
    limit 10000
  ), removed as (
    delete from public.audit_logs a using expired e where a.id = e.id
    returning a.action
  )
  select count(*) filter (where action = 'LOGIN'),
         count(*) filter (where action is distinct from 'LOGIN')
    into v_login, v_other from removed;

  -- Cron records every execution; its own history also needs retention.
  -- Only prune this app's job; do not change history for unrelated jobs.
  delete from cron.job_run_details
  where jobid in (select jobid from cron.job where jobname = 'gestionprofea-audit-retention')
    and end_time < now() - interval '7 days';
  get diagnostics v_runs = row_count;

  return jsonb_build_object('login_deleted', v_login, 'audit_deleted', v_other,
                           'maintenance_runs_deleted', v_runs);
end;
$$;

-- Private maintenance entry point: unavailable to client and API roles.
revoke all on function private.prune_app_audit_logs() from public, anon, authenticated, service_role;
comment on function private.prune_app_audit_logs() is
  'Internal daily maintenance: LOGIN 30d, other app audit 180d, own Cron history 7d; at most 10000 audit rows/run. Does not reset Logs Ingest.';

-- Reusing this name updates the schedule rather than creating duplicate jobs.
-- Cron uses UTC: 03:20 UTC = 05:20 Madrid in summer, 04:20 in winter.
select cron.schedule(
  'gestionprofea-audit-retention',
  '20 3 * * *',
  $$set statement_timeout = '60s'; select private.prune_app_audit_logs();$$
);
