begin;

create schema if not exists prevention_private;
revoke all on schema prevention_private from public, anon, authenticated;

create table public.prevention_records (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  obra text not null check (length(btrim(obra)) between 1 and 300),
  kind text not null check (kind in ('incident','precheck')),
  work_date date not null,
  category text not null check (category in ('Calor e hidratación','Lluvia y tormentas','Viento','Excavaciones','Trabajo en altura','Maquinaria','Accesos y señalización','Otros')),
  severity text not null check (severity in ('low','medium','high')),
  title text not null check (length(btrim(title)) between 1 and 200),
  task text not null check (length(btrim(task)) between 1 and 300),
  description text not null default '' check (length(description)<=4000),
  measures text not null default '' check (length(measures)<=4000),
  responsible text not null default '' check (length(responsible)<=200),
  deadline date,
  checks jsonb not null default '{}' check (jsonb_typeof(checks)='object'),
  photo text check (photo is null or (length(photo)<=400000 and photo ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$')),
  status text not null check (status in ('pending','in_progress','closed')),
  actor text not null,
  request_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz
);
create index prevention_records_owner_date_idx on public.prevention_records(owner_id,created_at desc);
create index prevention_records_owner_obra_idx on public.prevention_records(owner_id,obra);

create table public.prevention_events (
  id bigint generated always as identity primary key,
  record_id uuid not null references public.prevention_records(id),
  owner_id uuid not null references public.profiles(id),
  actor text not null,
  action text not null check (action in ('created','follow_up')),
  snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index prevention_events_record_idx on public.prevention_events(record_id,created_at desc);
alter table public.prevention_records enable row level security;
alter table public.prevention_events enable row level security;
revoke all on public.prevention_records,public.prevention_events from public,anon,authenticated;
grant select on public.prevention_records,public.prevention_events to authenticated;
create policy prevention_owner_read on public.prevention_records for select to authenticated using (owner_id=(select auth.uid()));
create policy prevention_events_owner_read on public.prevention_events for select to authenticated using (owner_id=(select auth.uid()));

-- Token access is deliberately resolved from the existing revoked/active portal
-- capability. Caller-supplied owner IDs and work names never authorize access.
create function prevention_private.access_context(p_token text)
returns table(owner_id uuid,obra text,actor text,is_foreman boolean)
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if nullif(btrim(p_token),'') is not null then
    return query select a.owner_id,a.obra,coalesce(nullif(a.foreman_name,''),'Encargado'),true
      from public.foreman_portal_access a
      where a.active and a.token_hash=encode(sha256(convert_to(btrim(p_token),'UTF8')),'hex') limit 1;
    if not found then raise exception 'Acceso no válido o revocado'; end if;
  else
    if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
    return query select auth.uid(),null::text,'Supervisor'::text,false;
  end if;
end;
$$;
revoke all on function prevention_private.access_context(text) from public,anon,authenticated;

create function public.list_prevention_records(p_token text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_access record; v_records jsonb; v_total bigint;
begin
  select * into v_access from prevention_private.access_context(p_token);
  select count(*) into v_total from public.prevention_records r
    where r.owner_id=v_access.owner_id and (not v_access.is_foreman or r.obra=v_access.obra);
  select coalesce(jsonb_agg((to_jsonb(r)-'owner_id'-'request_hash'-'photo') || jsonb_build_object('has_photo',r.photo is not null) order by r.created_at desc,r.id),'[]'::jsonb)
    into v_records from (
      select * from public.prevention_records r
      where r.owner_id=v_access.owner_id and (not v_access.is_foreman or r.obra=v_access.obra)
      order by r.created_at desc,r.id limit 500
    ) r;
  return jsonb_build_object('records',v_records,'truncated',v_total>500);
end;
$$;

create function public.get_prevention_record_details(p_id uuid,p_token text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_access record; v_record public.prevention_records; v_events jsonb;
begin
  select * into v_access from prevention_private.access_context(p_token);
  select * into v_record from public.prevention_records r where r.id=p_id
    and r.owner_id=v_access.owner_id and (not v_access.is_foreman or r.obra=v_access.obra);
  if not found then raise exception 'Registro no disponible'; end if;
  select coalesce(jsonb_agg(to_jsonb(e)-'owner_id' order by e.created_at desc,e.id desc),'[]'::jsonb)
    into v_events from (select * from public.prevention_events where record_id=p_id order by created_at desc,id desc limit 100) e;
  return jsonb_build_object('photo',v_record.photo,'events',v_events);
end;
$$;

create function public.save_prevention_record(p_id uuid,p_data jsonb,p_token text default null,p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_access record; v_record public.prevention_records; v_work text;
  v_status text; v_checks jsonb; v_key text; v_hash text;
begin
  select * into v_access from prevention_private.access_context(p_token);
  if p_id is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Registro no válido'; end if;
  if octet_length(p_data::text)>450000 then raise exception 'Registro demasiado grande'; end if;
  v_hash:=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
  -- Serialize retries with the same UUID without serializing unrelated records.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into v_record from public.prevention_records where id=p_id for update;
  if found then
    if v_record.owner_id<>v_access.owner_id or (v_access.is_foreman and v_record.obra<>v_access.obra) then raise exception 'Registro no disponible'; end if;
    if p_expected_updated_at is null and v_record.request_hash=v_hash then
      return to_jsonb(v_record)-'owner_id'-'request_hash';
    end if;
    if v_access.is_foreman then raise exception 'El seguimiento corresponde al supervisor'; end if;
    if p_expected_updated_at is null or v_record.updated_at<>p_expected_updated_at then raise exception 'Otro usuario ha actualizado este registro. Actualiza la lista y revisa los cambios antes de guardar'; end if;
    v_status:=p_data->>'status';
    if v_status is null or v_status not in ('pending','in_progress','closed') then raise exception 'Estado no válido'; end if;
    if nullif(btrim(p_data->>'responsible'),'') is null then raise exception 'Indica el responsable del seguimiento'; end if;
    if v_status='closed' and nullif(btrim(p_data->>'measures'),'') is null then raise exception 'Registra las medidas adoptadas antes de cerrar'; end if;
    update public.prevention_records set status=v_status,
      measures=btrim(coalesce(p_data->>'measures','')), responsible=btrim(p_data->>'responsible'),
      deadline=nullif(p_data->>'deadline','')::date,
      updated_at=clock_timestamp(),
      resolved_at=case when v_status='closed' then coalesce(resolved_at,clock_timestamp()) else null end
      where id=p_id returning * into v_record;
    insert into public.prevention_events(record_id,owner_id,actor,action,snapshot)
      values(p_id,v_access.owner_id,v_access.actor,'follow_up',to_jsonb(v_record)-'photo'-'owner_id'-'request_hash');
  else
    if p_expected_updated_at is not null then raise exception 'Registro no disponible'; end if;
    v_work:=case when v_access.is_foreman then v_access.obra else btrim(p_data->>'obra') end;
    if v_access.is_foreman and p_data->>'obra' is distinct from v_access.obra then raise exception 'La obra no corresponde a este acceso'; end if;
    if not v_access.is_foreman and not exists (
      select 1 from public.user_settings u
      where u.user_id=v_access.owner_id and coalesce(u.settings #> '{app,savedObras}','[]'::jsonb) ? v_work
    ) then raise exception 'Selecciona una obra de tu configuración'; end if;
    if p_data->>'kind' is null or p_data->>'kind' not in ('incident','precheck') then raise exception 'Tipo de registro no válido'; end if;
    if (p_data->>'work_date')::date>(now() at time zone 'Europe/Madrid')::date then raise exception 'La fecha del registro no puede ser futura'; end if;
    v_checks:=case when p_data->>'kind'='precheck' then p_data->'checks' else '{}'::jsonb end;
    v_status:='pending';
    if p_data->>'kind'='incident' and nullif(btrim(p_data->>'description'),'') is null then raise exception 'Describe la incidencia'; end if;
    if p_data->>'kind'='precheck' then
      if jsonb_typeof(v_checks) is distinct from 'object' then raise exception 'Responde todas las comprobaciones'; end if;
      foreach v_key in array array['task','weather','water','access','equipment','specific'] loop
        if v_checks->>v_key is null or v_checks->>v_key not in ('yes','no','na') then raise exception 'Responde todas las comprobaciones'; end if;
      end loop;
      if (select count(*) from jsonb_object_keys(v_checks))<>6 then raise exception 'Comprobaciones no válidas'; end if;
      if exists(select 1 from jsonb_each_text(v_checks) where value='no') then
        if nullif(btrim(p_data->>'description'),'') is null or nullif(btrim(p_data->>'measures'),'') is null or nullif(btrim(p_data->>'responsible'),'') is null then raise exception 'Describe el riesgo, las medidas y el responsable'; end if;
      else v_status:='closed';
      end if;
    end if;
    insert into public.prevention_records(id,owner_id,obra,kind,work_date,category,severity,title,task,description,measures,responsible,deadline,checks,photo,status,actor,request_hash,resolved_at)
    values(p_id,v_access.owner_id,v_work,p_data->>'kind',(p_data->>'work_date')::date,p_data->>'category',p_data->>'severity',
      btrim(p_data->>'title'),btrim(p_data->>'task'),btrim(coalesce(p_data->>'description','')),btrim(coalesce(p_data->>'measures','')),
      btrim(coalesce(p_data->>'responsible','')),nullif(p_data->>'deadline','')::date,v_checks,nullif(p_data->>'photo',''),
      v_status,v_access.actor,v_hash,case when v_status='closed' then clock_timestamp() else null end)
    returning * into v_record;
    insert into public.prevention_events(record_id,owner_id,actor,action,snapshot)
      values(p_id,v_access.owner_id,v_access.actor,'created',to_jsonb(v_record)-'photo'-'owner_id'-'request_hash');
  end if;
  return to_jsonb(v_record)-'owner_id'-'request_hash';
end;
$$;

revoke all on function public.list_prevention_records(text),public.get_prevention_record_details(uuid,text),public.save_prevention_record(uuid,jsonb,text,timestamptz) from public,anon,authenticated;
-- Anonymous callers must present an active, scoped portal capability; no direct
-- anonymous table access is granted.
grant execute on function public.list_prevention_records(text),public.get_prevention_record_details(uuid,text),public.save_prevention_record(uuid,jsonb,text,timestamptz) to anon,authenticated;
notify pgrst,'reload schema';
commit;
