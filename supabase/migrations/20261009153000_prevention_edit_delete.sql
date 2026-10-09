begin;

create function public.edit_prevention_record(
  p_id uuid,
  p_data jsonb,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_record public.prevention_records;
  v_obra text;
  v_status text;
  v_checks jsonb;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if p_id is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Registro no válido'; end if;

  select * into v_record
  from public.prevention_records
  where id=p_id and owner_id=auth.uid()
  for update;

  if not found then raise exception 'Registro no disponible'; end if;
  if p_expected_updated_at is null or v_record.updated_at<>p_expected_updated_at then
    raise exception 'Otro usuario ha actualizado este registro. Actualiza la lista antes de guardar';
  end if;

  v_obra:=btrim(coalesce(p_data->>'obra',v_record.obra));
  if not exists (
    select 1 from public.user_settings u
    where u.user_id=auth.uid()
      and coalesce(u.settings #> '{app,savedObras}','[]'::jsonb) ? v_obra
  ) then
    raise exception 'Selecciona una obra de tu configuración';
  end if;

  v_status:=coalesce(p_data->>'status',v_record.status);
  if v_status not in ('pending','in_progress','closed') then raise exception 'Estado no válido'; end if;

  v_checks:=case
    when v_record.kind='precheck' then coalesce(p_data->'checks',v_record.checks)
    else '{}'::jsonb
  end;

  if v_record.kind='precheck' then
    if jsonb_typeof(v_checks) is distinct from 'object' then raise exception 'Comprobaciones no válidas'; end if;
    if (select count(*) from jsonb_object_keys(v_checks))<>6 then raise exception 'Responde todas las comprobaciones'; end if;
    if exists(select 1 from jsonb_each_text(v_checks) where value not in ('yes','no','na')) then raise exception 'Comprobaciones no válidas'; end if;
  end if;

  if nullif(btrim(coalesce(p_data->>'title',v_record.title)),'') is null then raise exception 'Indica el título'; end if;
  if nullif(btrim(coalesce(p_data->>'task',v_record.task)),'') is null then raise exception 'Indica la tarea'; end if;
  if v_record.kind='incident' and nullif(btrim(coalesce(p_data->>'description',v_record.description)),'') is null then raise exception 'Describe la incidencia'; end if;
  if coalesce(p_data->>'category',v_record.category) not in ('Calor e hidratación','Lluvia y tormentas','Viento','Excavaciones','Trabajo en altura','Maquinaria','Accesos y señalización','Otros') then raise exception 'Categoría no válida'; end if;
  if coalesce(p_data->>'severity',v_record.severity) not in ('low','medium','high') then raise exception 'Prioridad no válida'; end if;
  if coalesce((p_data->>'work_date')::date,v_record.work_date)>(now() at time zone 'Europe/Madrid')::date then raise exception 'La fecha no puede ser futura'; end if;
  if v_status='closed' and nullif(btrim(coalesce(p_data->>'measures',v_record.measures)),'') is null then raise exception 'Registra las medidas adoptadas antes de cerrar'; end if;

  update public.prevention_records
  set obra=v_obra,
      work_date=coalesce((p_data->>'work_date')::date,work_date),
      category=coalesce(p_data->>'category',category),
      severity=coalesce(p_data->>'severity',severity),
      title=btrim(coalesce(p_data->>'title',title)),
      task=btrim(coalesce(p_data->>'task',task)),
      description=btrim(coalesce(p_data->>'description',description)),
      measures=btrim(coalesce(p_data->>'measures',measures)),
      responsible=btrim(coalesce(p_data->>'responsible',responsible)),
      deadline=case when p_data ? 'deadline' then nullif(p_data->>'deadline','')::date else deadline end,
      checks=v_checks,
      status=v_status,
      updated_at=clock_timestamp(),
      resolved_at=case when v_status='closed' then coalesce(resolved_at,clock_timestamp()) else null end
  where id=p_id
  returning * into v_record;

  insert into public.prevention_events(record_id,owner_id,actor,action,snapshot)
  values(p_id,auth.uid(),'Supervisor','follow_up',to_jsonb(v_record)-'photo'-'owner_id'-'request_hash');

  return to_jsonb(v_record)-'owner_id'-'request_hash';
end;
$$;

create function public.delete_prevention_record(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_record public.prevention_records;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;

  select * into v_record
  from public.prevention_records
  where id=p_id and owner_id=auth.uid()
  for update;

  if not found then raise exception 'Registro no disponible'; end if;

  delete from public.prevention_events where record_id=p_id and owner_id=auth.uid();
  delete from public.prevention_records where id=p_id and owner_id=auth.uid();

  return jsonb_build_object('id',p_id,'deleted',true);
end;
$$;

revoke all on function public.edit_prevention_record(uuid,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.delete_prevention_record(uuid) from public,anon,authenticated;
grant execute on function public.edit_prevention_record(uuid,jsonb,timestamptz) to authenticated;
grant execute on function public.delete_prevention_record(uuid) to authenticated;
notify pgrst,'reload schema';

commit;
