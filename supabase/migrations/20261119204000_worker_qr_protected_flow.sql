-- QR scans use the same scope as the worker directory. A card is a locator.
create or replace function public.resolve_worker_card_reference(p_token uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with source as (
    select s.owner_id, s.worker_dni, t.id
    from public.worker_qr_shares s
    join public.trabajadores t on t.owner_id = s.owner_id
      and upper(regexp_replace(t.dni, '[[:space:]-]', '', 'g')) = s.worker_dni
    where s.token = p_token and s.revoked_at is null and (select auth.uid()) is not null
      and (select private.has_module_permission('trabajadores', 'read'))
      and (s.owner_id = (select auth.uid())
        or private.has_explicit_resource_permission('trabajadores', t.id::text, t.owner_id, 'read'))
    order by (nullif(t.periodo_inicio, '') <= to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD')
      and coalesce(t.periodo_fin, '') >= to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD')) desc nulls last,
      coalesce(nullif(t.periodo_inicio, ''), nullif(t.fecha_registro, '')) desc nulls last, t.id desc
    limit 1
  )
  select jsonb_build_object('id', coalesce(current_worker.id, source.id),
    'ownerId', case when current_worker.id is not null then (select auth.uid()) else source.owner_id end)
  from source
  left join lateral (
    select t.id from public.trabajadores t
    where t.owner_id = (select auth.uid())
      and upper(regexp_replace(t.dni, '[[:space:]-]', '', 'g')) = source.worker_dni
    order by (nullif(t.periodo_inicio, '') <= to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD')
      and coalesce(t.periodo_fin, '') >= to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD')) desc nulls last,
      coalesce(nullif(t.periodo_inicio, ''), nullif(t.fecha_registro, '')) desc nulls last, t.id desc
    limit 1
  ) current_worker on source.owner_id <> (select auth.uid())
  where source.owner_id = (select auth.uid()) or current_worker.id is not null
    or (select private.has_module_permission('trabajadores', 'create'));
$$;

-- Preserve compatibility for clients requesting only their own worker id.
create or replace function public.resolve_worker_card_owner(p_token uuid)
returns bigint language sql stable security definer set search_path = ''
as $$
  select (r.ref->>'id')::bigint
  from (select public.resolve_worker_card_reference(p_token) as ref) r
  where r.ref->>'ownerId' = (select auth.uid())::text;
$$;

-- Revoke the unused legacy endpoint which returned free-text medical details.
revoke execute on function public.resolve_worker_qr_occupational(uuid) from public, anon, authenticated;

-- Browser lookup. For a professional recipient, reuse the existing verified
-- email, expiry, row scope and audited read before returning projected fields.
create or replace function public.read_worker_qr_details(p_token uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_share public.worker_qr_shares%rowtype;
  v_worker public.trabajadores%rowtype;
  v_grant uuid;
  v_details jsonb;
  v_sections text[];
  v_expires_at timestamptz;
  v_today text := to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD');
  v_start text;
  v_end text;
begin
  if v_user is null then return null; end if;
  select * into v_share from public.worker_qr_shares
    where token = p_token and revoked_at is null;
  if not found then return null; end if;

  if v_share.owner_id = v_user and private.has_module_permission('trabajadores', 'read') then
    select t.* into v_worker from public.trabajadores t
      where t.owner_id = v_user
        and upper(regexp_replace(t.dni, '[[:space:]-]', '', 'g')) = v_share.worker_dni
      order by (nullif(t.periodo_inicio, '') <= v_today and coalesce(t.periodo_fin, '') >= v_today) desc nulls last,
        coalesce(nullif(t.periodo_inicio, ''), nullif(t.fecha_registro, '')) desc nulls last, t.id desc
      limit 1;
    v_sections := array['identity','employment','worksite','prevention','medical_conclusion'];
  else
    select g.id into v_grant
    from public.inspection_access_grants g
    join auth.users u on u.id = v_user and u.email_confirmed_at is not null and lower(u.email) = g.recipient_email
    join public.trabajadores t on t.owner_id = g.owner_id and t.id = g.worker_id
    where g.owner_id = v_share.owner_id and g.revoked_at is null and g.expires_at > now()
      and upper(regexp_replace(t.dni, '[[:space:]-]', '', 'g')) = v_share.worker_dni
    order by g.created_at desc, g.id desc limit 1;
    if not found then return null; end if;
    select t.* into v_worker from public.inspection_access_grants g
      join public.trabajadores t on t.owner_id = g.owner_id and t.id = g.worker_id
      where g.id = v_grant
        and upper(regexp_replace(t.dni, '[[:space:]-]', '', 'g')) = v_share.worker_dni;
    if not found then return null; end if;
    v_details := public.read_inspection_access(v_grant);
    v_sections := array(select jsonb_array_elements_text(v_details->'sections'));
    v_expires_at := (v_details->>'expiresAt')::timestamptz;
  end if;
  if v_worker.id is null then return null; end if;

  if 'employment' = any(v_sections) then
    v_start := nullif(trim(v_worker.periodo_inicio), '');
    v_end := nullif(trim(v_worker.periodo_fin), '');
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'expiresAt', v_expires_at,
    'maskedDni', case when 'identity' = any(v_sections) then
      case when v_share.worker_dni ~ '^([0-9]{8}|[XYZ][0-9]{7})[A-Z]$'
        then '*****' || substr(v_share.worker_dni, 6, 3) || '*' else '*********' end end,
    'worksite', case when 'worksite' = any(v_sections) then coalesce(nullif(trim(v_worker.obra), ''), 'Sin obra registrada') end,
    'periodStart', v_start,
    'periodEnd', v_end,
    'contractStatus', case when 'employment' = any(v_sections) then case
      when v_start is null or v_end is null or v_start !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or v_end !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or not pg_input_is_valid(v_start, 'date') or not pg_input_is_valid(v_end, 'date')
        or v_start > v_end then 'Periodo sin confirmar'
      when v_today < v_start then 'Previsto'
      when v_today > v_end then 'Finalizado'
      else 'En periodo registrado' end end,
    'trainingRecord', case when 'prevention' = any(v_sections) then case lower(trim(v_worker.formacion))
      when 'sí' then 'Consta en ficha' when 'si' then 'Consta en ficha'
      when 'no' then 'No consta en ficha' when 'sin formación' then 'No consta en ficha'
      else 'Pendiente de verificar' end end,
    'aptitudeConclusion', case when 'medical_conclusion' = any(v_sections) then
      case lower(coalesce(nullif(trim(v_worker.aptitud_medica), ''), trim(v_worker.reconocimiento_estado)))
        when 'apto' then 'Apto' when 'no apto' then 'No apto'
        when 'apto con limitación' then 'Apto con limitaciones'
        when 'apto con limitaciones' then 'Apto con limitaciones'
        else 'Sin conclusión verificada' end end
  ));
end;
$$;

revoke all on function public.resolve_worker_card_reference(uuid), public.read_worker_qr_details(uuid) from public, anon;
grant execute on function public.resolve_worker_card_reference(uuid), public.read_worker_qr_details(uuid) to authenticated;

-- QR imports use a dedicated insert that preserves RLS and serializes retrying
-- the same worker and period from multiple tabs. Historical periods remain valid.
create or replace function public.register_worker_from_card(p_worker jsonb)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_row public.trabajadores%rowtype;
  v_dni text;
begin
  if v_owner is null or not (select private.has_module_permission('trabajadores', 'read'))
    or not (select private.has_module_permission('trabajadores', 'create')) then
    raise exception 'Permiso de alta de trabajadores requerido';
  end if;
  v_row := jsonb_populate_record(null::public.trabajadores, p_worker);
  v_dni := upper(regexp_replace(coalesce(v_row.dni, ''), '[[:space:]-]', '', 'g'));
  if v_dni = '' or nullif(v_row.periodo_inicio, '') is null or nullif(v_row.periodo_fin, '') is null then
    raise exception 'DNI/NIE y periodo requeridos';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text || ':' || v_dni, 0));
  if exists (
    select 1 from public.trabajadores t
    where t.owner_id = v_owner and upper(regexp_replace(t.dni, '[[:space:]-]', '', 'g')) = v_dni
      and t.periodo_inicio = v_row.periodo_inicio and t.periodo_fin = v_row.periodo_fin
  ) then
    raise unique_violation using message = 'Ya existe un registro de este DNI/NIE para el mismo periodo';
  end if;
  insert into public.trabajadores (
    owner_id, id, obra_id, supervisor_responsable, num_oferta, obra, categoria, quincena,
    apellidos_nombre, dni, fecha_nacimiento, periodo_inicio, periodo_fin, telefono,
    numero_seguridad_social, iban, calzado, formacion, lugar_formacion, cita_dia, cita_hora,
    sitio_reconocimiento, documentacion_completa, observaciones, fecha_registro,
    necesita_reconocimiento, data, created_by, updated_by
  ) values (
    v_owner, v_row.id, v_row.obra_id, v_row.supervisor_responsable, v_row.num_oferta, v_row.obra, v_row.categoria, v_row.quincena,
    v_row.apellidos_nombre, v_dni, v_row.fecha_nacimiento, v_row.periodo_inicio, v_row.periodo_fin, v_row.telefono,
    v_row.numero_seguridad_social, v_row.iban, v_row.calzado, v_row.formacion, v_row.lugar_formacion, v_row.cita_dia, v_row.cita_hora,
    v_row.sitio_reconocimiento, v_row.documentacion_completa, v_row.observaciones, v_row.fecha_registro,
    v_row.necesita_reconocimiento, v_row.data, v_owner, v_owner
  );
end;
$$;
revoke all on function public.register_worker_from_card(jsonb) from public, anon;
grant execute on function public.register_worker_from_card(jsonb) to authenticated;

-- The desktop receives only a worker reference under its existing pairing RLS.
alter table public.worker_card_pair_results add column worker_owner_id uuid;
update public.worker_card_pair_results set worker_owner_id = owner_id;
alter table public.worker_card_pair_results alter column worker_owner_id set not null;
alter table public.worker_card_pair_results
  drop constraint worker_card_pair_results_owner_id_worker_id_fkey,
  add foreign key (worker_owner_id, worker_id) references public.trabajadores(owner_id, id);

-- Existing desktop clients ignore the source owner. Enable shared references
-- only when the desktop explicitly starts a session that understands them.
alter table public.worker_card_pair_sessions add column allow_shared boolean not null default false;
create or replace function public.worker_card_pair_create_v2(p_pair_hash text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := public.worker_card_pair_create(p_pair_hash);
  update public.worker_card_pair_sessions set allow_shared = true
    where id = (v_result->>'id')::uuid and owner_id = (select auth.uid());
  return v_result;
end;
$$;
revoke all on function public.worker_card_pair_create_v2(text) from public, anon;
grant execute on function public.worker_card_pair_create_v2(text) to authenticated;

create or replace function public.worker_card_pair_submit(p_mobile_token text, p_worker_token uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_session public.worker_card_pair_sessions%rowtype;
  v_ref jsonb;
begin
  if (select auth.uid()) is null or coalesce(p_mobile_token,'') !~ '^[A-Za-z0-9_-]{43}$' then return false; end if;
  select * into v_session from public.worker_card_pair_sessions s
    where s.mobile_hash=encode(extensions.digest(p_mobile_token,'sha256'),'hex') and s.owner_id=(select auth.uid())
    and s.mobile_session_id::text=(select auth.jwt()->>'session_id') and s.revoked_at is null and s.expires_at>now()
    for update;
  if v_session.id is null or v_session.scan_count>=60
    or (v_session.last_scan_at is not null and v_session.last_scan_at>now()-interval '1 second') then return false; end if;
  v_ref := public.resolve_worker_card_reference(p_worker_token);
  if v_ref is null or (not v_session.allow_shared and v_ref->>'ownerId' <> v_session.owner_id::text)
    then return false; end if;
  insert into public.worker_card_pair_results(session_id, owner_id, worker_owner_id, worker_id)
    values (v_session.id, v_session.owner_id, (v_ref->>'ownerId')::uuid, (v_ref->>'id')::bigint);
  update public.worker_card_pair_sessions set last_scan_at=now(),scan_count=scan_count+1 where id=v_session.id;
  return true;
end;
$$;
