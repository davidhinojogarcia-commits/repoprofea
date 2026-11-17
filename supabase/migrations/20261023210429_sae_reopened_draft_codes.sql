-- An explicitly reopened report is an editable draft. Its finalized snapshots
-- remain immutable and are still used to download the archived versions.
create or replace function sae_private.report_locked(report_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.sae_reports r where r.id=report_id and
    (r.processing_status in ('finalized','confirmed') or r.detected_legend->>'__workflow_state'='finalized'
     or (jsonb_array_length(coalesce(r.detected_legend->'__finalized_versions','[]'::jsonb))>0
       and r.detected_legend->>'__workflow_state' is distinct from 'review')))
    or exists(select 1 from public.sae_generated_documents d where d.source_report_id=report_id)
    or exists(select 1 from public.sae_reports r join public.sae_needs n on n.id=r.need_id where r.id=report_id and n.status='finalizada')
$$;
revoke all on function sae_private.report_locked(uuid) from public,anon,authenticated;

-- Preserve the current server history under the same lock used by finalization
-- and reconciliation; never send a possibly stale history back from the client.
create function public.sae_reopen_report(p_report_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid(); report public.sae_reports;
begin
  if owner is null or not public.sae_has_permission('update') then
    raise exception 'No tiene permiso para reabrir el informe SAE.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text,6291));
  select * into report from public.sae_reports where id=p_report_id and owner_id=owner for update;
  if report.id is null or not exists(select 1 from public.sae_needs where id=report.need_id and owner_id=owner) then
    raise exception 'Informe SAE no accesible.' using errcode='42501';
  end if;
  update public.sae_reports set detected_legend=jsonb_set(coalesce(detected_legend,'{}'::jsonb),
    '{__workflow_state}','"review"'::jsonb,true),updated_by=owner where id=report.id;
  perform sae_private.reconcile(owner,report.need_id);
end $$;
revoke all on function public.sae_reopen_report(uuid) from public,anon;
grant execute on function public.sae_reopen_report(uuid) to authenticated;
notify pgrst, 'reload schema';
