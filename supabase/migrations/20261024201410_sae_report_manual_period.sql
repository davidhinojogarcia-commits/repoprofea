-- A manual report period is authoritative, including for empty reports.
-- Use the existing owner lock so period edits serialize with registrations,
-- finalization and automatic SAE code reconciliation.
create function public.sae_set_report_period(p_report_id uuid, p_period text, p_expected_revision text)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  report public.sae_reports;
  need public.sae_needs;
  target_fortnight smallint;
  revision text;
begin
  if actor is null or not public.sae_has_permission('update') then
    raise exception 'No tiene permiso para modificar el periodo SAE.' using errcode='42501';
  end if;
  if p_period is null or p_period not in ('1ª Quincena','2ª Quincena','Mensual') then
    raise exception 'Seleccione un periodo válido.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,6291));
  select * into report from public.sae_reports where id=p_report_id and owner_id=actor for update;
  if not found then raise exception 'Informe SAE no accesible.' using errcode='42501'; end if;
  select * into need from public.sae_needs where id=report.need_id and owner_id=actor;
  if not found then raise exception 'Solicitud SAE no accesible.' using errcode='42501'; end if;
  if need.status='finalizada' then
    raise exception 'La solicitud está finalizada. Reábrala antes de modificar el periodo.' using errcode='55000';
  end if;
  if report.processing_status='finalized' or report.detected_legend->>'__workflow_state'='finalized' then
    raise exception 'Reabra el informe antes de modificar su periodo.' using errcode='55000';
  end if;
  revision := coalesce(report.detected_legend->'__manual_period'->>'revision','');
  if p_expected_revision is distinct from revision then
    raise exception 'El periodo cambió en otra sesión. Actualice el informe antes de guardarlo.' using errcode='40001';
  end if;
  if need.hiring_month is null or need.hiring_month not between 1 and 12 or need.hiring_year is null then
    raise exception 'Complete el mes y año de la solicitud de mano de obra.' using errcode='22023';
  end if;
  target_fortnight := case p_period when '1ª Quincena' then 1 when '2ª Quincena' then 2 else null end;
  -- Existing contracts are independent records. Require explicit reversal first,
  -- rather than silently moving a worker to another hiring period.
  if exists(select 1 from public.sae_candidates c where c.source_report_id=report.id
      and c.owner_id=actor and (c.status='contratado' or c.existing_worker_id is not null)
      and (c.hiring_month is distinct from need.hiring_month or c.fortnight is distinct from target_fortnight)) then
    raise exception 'Revierta primero las contrataciones de este informe para cambiar su periodo.' using errcode='55000';
  end if;
  update public.sae_reports set detected_legend=coalesce(detected_legend,'{}'::jsonb) ||
    jsonb_build_object('__manual_period',jsonb_build_object('label',p_period,'month',need.hiring_month,
      'year',need.hiring_year,'revision',gen_random_uuid()::text,'updatedAt',clock_timestamp(),'updatedBy',actor)),
    updated_by=actor where id=report.id;
  -- One statement: report metadata and every candidate either commit together
  -- or all roll back. The existing statement trigger reconciles SAE codes.
  update public.sae_candidates set fortnight=target_fortnight,hiring_month=need.hiring_month,
    status=case when status in ('primera_quincena','segunda_quincena') then
      case target_fortnight when 1 then 'primera_quincena' when 2 then 'segunda_quincena' else 'sin_asignar' end
      else status end,
    updated_by=actor
    where source_report_id=report.id and need_id=report.need_id and owner_id=actor;
end $$;
revoke all on function public.sae_set_report_period(uuid,text,text) from public,anon;
grant execute on function public.sae_set_report_period(uuid,text,text) to authenticated;

-- A stale tab or older client must not undo the saved report period through
-- an individual candidate edit. RLS still governs access to both records.
create function sae_private.keep_report_period() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare manual_period jsonb;
begin
  select detected_legend->'__manual_period' into manual_period from public.sae_reports
    where id=new.source_report_id and need_id=new.need_id and owner_id=new.owner_id;
  if manual_period->>'label' in ('1ª Quincena','2ª Quincena','Mensual') then
    new.fortnight := case manual_period->>'label' when '1ª Quincena' then 1 when '2ª Quincena' then 2 else null end;
    new.hiring_month := (manual_period->>'month')::smallint;
    if new.status in ('primera_quincena','segunda_quincena') then
      new.status := case new.fortnight when 1 then 'primera_quincena' when 2 then 'segunda_quincena' else 'sin_asignar' end;
    end if;
  end if;
  return new;
end $$;
revoke all on function sae_private.keep_report_period() from public,anon,authenticated;
create trigger sae_keep_report_period before insert or update of hiring_month,fortnight,status,source_report_id,need_id
  on public.sae_candidates for each row execute function sae_private.keep_report_period();
notify pgrst, 'reload schema';
