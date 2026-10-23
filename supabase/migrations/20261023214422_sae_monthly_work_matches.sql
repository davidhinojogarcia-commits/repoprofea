-- Name-only monthly availability: read warnings across the owner's works;
-- changing a result to 2500 always requires an explicit, current decision.
alter table sae_private.code_audit add column source_worker_id bigint, add column source_context jsonb;
-- Directory registrations and date corrections share the same owner lock as
-- candidate decisions, preventing a second device from changing the evidence
-- between its verification and the saved result.
create trigger sae_monthly_worker_lock before insert or update or delete on public.trabajadores
  for each statement execute function sae_private.lock_candidate();
create function sae_private.iso_date(value text) returns date
language plpgsql immutable set search_path='' as $$
begin
  if value is null or value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  return value::date;
exception when datetime_field_overflow or invalid_datetime_format then return null;
end $$;

create function sae_private.planned_period(owner uuid, year_number int, month_number int, fortnight_number int)
returns jsonb language sql stable security definer set search_path='' as $$
  with periods as (
    select m.value as month
    from public.user_settings us
    cross join lateral jsonb_array_elements(case when jsonb_typeof(us.settings->'annualHiringPeriods')='array'
      then us.settings->'annualHiringPeriods' else '[]'::jsonb end) y
    cross join lateral jsonb_array_elements(case when jsonb_typeof(y.value->'months')='array'
      then y.value->'months' when jsonb_typeof(y.value->'periods')='array'
      then y.value->'periods' else '[]'::jsonb end) m
    where us.user_id=owner and y.value->>'year'=year_number::text and m.value->>'month'=month_number::text
  ), resolved as (
    select case when fortnight_number=2 then month->>'period2Start'
      when fortnight_number=1 then coalesce(nullif(month->>'period1Start',''),month->>'startDate')
      else coalesce(nullif(month->>'period1Start',''),nullif(month->>'period2Start',''),month->>'startDate') end as starts,
      case when fortnight_number=1 then coalesce(nullif(month->>'period1End',''),month->>'endDate')
      when fortnight_number=2 then month->>'period2End'
      else coalesce(nullif(month->>'period2End',''),nullif(month->>'period1End',''),month->>'endDate') end as ends
    from periods where (select count(*) from periods)=1
  ) select coalesce((select jsonb_build_object('start',sae_private.iso_date(starts),'end',sae_private.iso_date(ends))
    from resolved),'{}'::jsonb)
$$;

create function sae_private.monthly_matches(owner uuid, need uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare n public.sae_needs; target record; source record; matches jsonb; result jsonb := '[]';
  target_period jsonb; source_period jsonb; starts date; ends date; target_start date; target_end date;
  month_start date; month_end date;
  registered boolean; overlap boolean; ambiguous boolean; locked boolean; signature text;
begin
  if owner is distinct from auth.uid() or not public.sae_has_permission('read') then
    raise exception 'Solicitud SAE no accesible.' using errcode='42501';
  end if;
  select * into n from public.sae_needs where id=need and owner_id=owner;
  if not found then raise exception 'Solicitud SAE no accesible.' using errcode='42501'; end if;
  if n.hiring_year is null or n.hiring_year not between 1 and 9999
    or n.hiring_month is null or n.hiring_month not between 1 and 12 then return result; end if;
  month_start := make_date(n.hiring_year,n.hiring_month,1);
  month_end := (month_start+interval '1 month'-interval '1 day')::date;
  target_period := sae_private.planned_period(owner,n.hiring_year,n.hiring_month,null);
  target_start := sae_private.iso_date(target_period->>'start');
  target_end := sae_private.iso_date(target_period->>'end');
  for target in select c.* from public.sae_candidates c
    where c.need_id=need and c.owner_id=owner and c.fortnight is null
      and c.hiring_month=n.hiring_month and nullif(trim(c.category),'') is not null
      and sae_private.name_key(c.category) !~ '\mpeon(es)?\M'
      and sae_private.name_key(c.normalized_full_name)<>''
      and sae_private.work_key(c.work_code,c.work_name)=sae_private.work_key(n.work_code,n.work_name)
      and exists(select 1 from public.sae_reports r where r.id=c.source_report_id and r.need_id=need and r.owner_id=owner)
    order by c.id
  loop
    matches := '[]'::jsonb;
    for source in
      select c.*,sn.hiring_year,sn.work_code as canonical_code,sn.work_name as canonical_name,
        w.id as worker_id,w.periodo_inicio,w.periodo_fin,w.data as worker_data
      from public.sae_candidates c join public.sae_needs sn on sn.id=c.need_id and sn.owner_id=c.owner_id
      left join public.trabajadores w on w.owner_id=owner and w.id=c.existing_worker_id
        and c.existing_worker_owner_id=owner
      where c.owner_id=owner and c.id<>target.id
        and sn.hiring_month=n.hiring_month and sn.hiring_year=n.hiring_year and c.hiring_month=sn.hiring_month
        and sae_private.work_key(sn.work_code,sn.work_name)<>sae_private.work_key(n.work_code,n.work_name)
        and sae_private.work_key(c.work_code,c.work_name)=sae_private.work_key(sn.work_code,sn.work_name)
        and sae_private.name_key(c.normalized_full_name)=sae_private.name_key(target.normalized_full_name)
        and (c.result_code='2001' or (c.status='contratado' and w.id is not null))
        and exists(select 1 from public.sae_reports r where r.id=c.source_report_id and r.need_id=c.need_id and r.owner_id=owner)
      order by c.id
    loop
      registered := source.status='contratado' and source.worker_id is not null;
      if registered then
        starts := coalesce(sae_private.iso_date(source.periodo_inicio),sae_private.iso_date(source.worker_data->>'periodoInicio'));
        ends := coalesce(sae_private.iso_date(source.periodo_fin),sae_private.iso_date(source.worker_data->>'periodoFin'));
      else
        source_period := case when source.fortnight in (1,2) or (source.fortnight is null
          and nullif(trim(source.category),'') is not null and sae_private.name_key(source.category) !~ '\mpeon(es)?\M')
          then sae_private.planned_period(owner,n.hiring_year,n.hiring_month,source.fortnight) else '{}'::jsonb end;
        starts := sae_private.iso_date(source_period->>'start'); ends := sae_private.iso_date(source_period->>'end');
      end if;
      overlap := case when starts is null or ends is null or starts>ends
        or target_start is null or target_end is null or target_start>target_end then null
        else starts<=target_end and ends>=target_start end;
      matches := matches || jsonb_build_array(jsonb_build_object('id','sae:'||source.id,'origin','sae',
        'candidateId',source.id,'workerId',case when registered then source.worker_id end,'fullName',source.normalized_full_name,'needId',source.need_id,
        'reportId',source.source_report_id,'workCode',source.canonical_code,'workName',source.canonical_name,
        'category',source.category,'status',case when registered then 'registered' else 'planned' end,
        'start',starts,'end',ends,'overlap',overlap,'code',source.result_code,'updatedAt',source.updated_at));
    end loop;
    -- Also include contracts registered directly in the Directory, without an
    -- SAE candidate. A linked SAE contract is shown once, through its report.
    for source in select w.*,
      coalesce(nullif(w.obra,''),w.data->>'obra') as work,
      coalesce(nullif(w.categoria,''),w.data->>'categoria') as worker_category,
      coalesce(nullif(w.apellidos_nombre,''),w.data->>'apellidosNombre') as full_name
      from public.trabajadores w where w.owner_id=owner
        and sae_private.name_key(coalesce(nullif(w.apellidos_nombre,''),w.data->>'apellidosNombre'))=sae_private.name_key(target.normalized_full_name)
        and nullif(trim(coalesce(nullif(w.obra,''),w.data->>'obra')),'') is not null
        and sae_private.work_key(coalesce(nullif(w.obra,''),w.data->>'obra'),null)<>sae_private.work_key(n.work_code,n.work_name)
      order by w.id
    loop
      if exists(select 1 from jsonb_array_elements(matches) item where item->>'workerId'=source.id::text) then continue; end if;
      starts := coalesce(sae_private.iso_date(source.periodo_inicio),sae_private.iso_date(source.data->>'periodoInicio'));
      ends := coalesce(sae_private.iso_date(source.periodo_fin),sae_private.iso_date(source.data->>'periodoFin'));
      if starts is null or ends is null or starts>ends or starts>month_end or ends<month_start then continue; end if;
      overlap := case when target_start is null or target_end is null or target_start>target_end then null
        else starts<=target_end and ends>=target_start end;
      matches := matches || jsonb_build_array(jsonb_build_object('id','worker:'||source.id,'origin','directory',
        'candidateId',null,'workerId',source.id,'fullName',source.full_name,'needId',null,'reportId',null,
        'workCode',source.work,'workName',source.work,'category',source.worker_category,'status','registered',
        'start',starts,'end',ends,'overlap',overlap,'code',null));
    end loop;
    if jsonb_array_length(matches)=0 then continue; end if;
    ambiguous := jsonb_array_length(matches)>1 or (select count(*) from public.sae_candidates c
      where c.owner_id=owner and c.source_report_id=target.source_report_id
        and sae_private.name_key(c.normalized_full_name)=sae_private.name_key(target.normalized_full_name))>1;
    locked := target.status='contratado' or target.existing_worker_id is not null or sae_private.report_locked(target.source_report_id);
    signature := md5(concat_ws('|',target.id,target.updated_at,target_period::text,matches::text,ambiguous,locked));
    result := result || jsonb_build_array(jsonb_build_object('candidateId',target.id,'month',n.hiring_month,
      'year',n.hiring_year,'matches',matches,'ambiguous',ambiguous,'locked',locked,'signature',signature,
      'currentCode',target.result_code,'start',target_start,'end',target_end,
      'canApply',public.sae_has_permission('update') and not locked and not ambiguous
        and target.result_code is distinct from '2500' and (matches->0->>'overlap')::boolean is true));
  end loop;
  return result;
end $$;

create function public.list_sae_monthly_matches(p_need_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select sae_private.monthly_matches(auth.uid(),p_need_id)
$$;
revoke all on function public.list_sae_monthly_matches(uuid) from public,anon;
grant execute on function public.list_sae_monthly_matches(uuid) to authenticated;

create function public.sae_apply_monthly_2500(p_candidate_id uuid,p_signature text) returns void
language plpgsql security definer set search_path='' as $$
declare owner uuid := auth.uid(); target public.sae_candidates; proposal jsonb; source jsonb;
begin
  if owner is null or not public.sae_has_permission('update') then
    raise exception 'No tiene permiso para aplicar el resultado SAE.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text,6291));
  select * into target from public.sae_candidates where id=p_candidate_id and owner_id=owner for update;
  if target.id is null then raise exception 'Candidato SAE no accesible.' using errcode='42501'; end if;
  -- Keep actual contract dates stable until this decision commits.
  perform w.id from public.trabajadores w where w.owner_id=owner and (
    sae_private.name_key(coalesce(nullif(w.apellidos_nombre,''),w.data->>'apellidosNombre'))=sae_private.name_key(target.normalized_full_name)
    or exists(
    select 1 from public.sae_candidates c where c.owner_id=owner and c.existing_worker_owner_id=owner
      and c.existing_worker_id=w.id and sae_private.name_key(c.normalized_full_name)=sae_private.name_key(target.normalized_full_name)))
    order by w.id for share;
  select item into proposal from jsonb_array_elements(sae_private.monthly_matches(owner,target.need_id)) item
    where item->>'candidateId'=target.id::text;
  if proposal is null or p_signature is null or proposal->>'signature' is distinct from p_signature then
    raise exception 'La coincidencia mensual ha cambiado. Actualice el informe y vuelva a revisarla.' using errcode='40001';
  end if;
  if not coalesce((proposal->>'canApply')::boolean,false) then
    raise exception 'Revise la identidad, las fechas o el estado del informe antes de aplicar 2500.' using errcode='40001';
  end if;
  source := proposal->'matches'->0;
  update public.sae_candidates set result_code='2500',result_label='no_contratado',updated_by=owner where id=target.id;
  insert into sae_private.code_audit(candidate_id,owner_id,actor_id,source_id,source_report_id,target_report_id,
    previous_code,new_code,action,signature,source_worker_id,source_context)
    values(target.id,owner,owner,(source->>'candidateId')::uuid,(source->>'reportId')::uuid,target.source_report_id,
      target.result_code,'2500','monthly_accepted',p_signature,(source->>'workerId')::bigint,source);
end $$;
revoke all on function public.sae_apply_monthly_2500(uuid,text) from public,anon;
grant execute on function public.sae_apply_monthly_2500(uuid,text) to authenticated;
revoke all on function sae_private.iso_date(text) from public,anon,authenticated;
revoke all on function sae_private.planned_period(uuid,int,int,int) from public,anon,authenticated;
revoke all on function sae_private.monthly_matches(uuid,uuid) from public,anon,authenticated;
notify pgrst, 'reload schema';
