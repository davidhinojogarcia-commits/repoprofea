-- Existing consultations keep their stored deadlines. New scans use ten minutes.
-- The QR shows positive fitness outcomes and the reviewed work restriction only.
create function private.worker_qr_visible_aptitude(p_worker public.trabajadores)
returns jsonb language sql stable set search_path = ''
as $$
  select case lower(coalesce(nullif(btrim(p_worker.aptitud_medica), ''), btrim(p_worker.reconocimiento_estado)))
    when 'apto' then jsonb_build_object('aptitudeConclusion', 'Apto')
    when 'apto con limitación' then limited.details
    when 'apto con limitaciones' then limited.details
    else '{}'::jsonb
  end
  from lateral (
    select jsonb_strip_nulls(jsonb_build_object(
      'aptitudeConclusion', 'Apto con limitación',
      'workRestrictions', (
        select r.restriction_text from private.worker_qr_restrictions r
        where r.owner_id = p_worker.owner_id and r.worker_id = p_worker.id
          and r.source_signature = private.worker_qr_restriction_signature(p_worker)
      )
    )) as details
  ) limited;
$$;
revoke all on function private.worker_qr_visible_aptitude(public.trabajadores) from public, anon, authenticated;

create or replace function public.read_worker_qr_visit(p_session uuid, p_card uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_visit private.worker_qr_visits%rowtype;
  v_share public.worker_qr_shares%rowtype;
  v_worker public.trabajadores%rowtype;
  v_end timestamptz;
  v_day text := to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD');
begin
  select * into v_visit from private.worker_qr_visits
  where session_digest = extensions.digest(p_session::text, 'sha256')
    and revoked_at is null and expires_at > now();
  if not found then return jsonb_build_object('status','visit_closed'); end if;
  select * into v_share from public.worker_qr_shares
  where token = p_card and owner_id = v_visit.owner_id and revoked_at is null;
  if not found then return jsonb_build_object('status','not_available'); end if;

  select t.* into v_worker from public.trabajadores t
  where t.owner_id = v_visit.owner_id
    and upper(regexp_replace(t.dni, '[[:space:]-]', '', 'g')) = v_share.worker_dni
    and t.obra_id is not distinct from v_visit.worksite_id
    and (v_visit.worksite_id is not null or lower(btrim(t.obra)) = lower(v_visit.worksite))
    and t.periodo_inicio ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and t.periodo_fin ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and pg_input_is_valid(t.periodo_inicio, 'date') and pg_input_is_valid(t.periodo_fin, 'date')
    and v_day between t.periodo_inicio and t.periodo_fin
  order by t.periodo_inicio desc, t.id desc limit 1;
  if not found then return jsonb_build_object('status','not_available'); end if;

  insert into private.worker_qr_visit_reads(visit_id, card_token, expires_at)
  values (v_visit.id, p_card, least(v_visit.expires_at, now() + interval '10 minutes'))
  on conflict do nothing;
  select expires_at into v_end from private.worker_qr_visit_reads where visit_id = v_visit.id and card_token = p_card;
  if v_end <= now() then return jsonb_build_object('status','card_expired'); end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'status', 'ok', 'expiresAt', v_end, 'remainingMs', floor(extract(epoch from v_end - now()) * 1000),
    'maskedDni', case when v_share.worker_dni ~ '^([0-9]{8}|[XYZ][0-9]{7})[A-Z]$'
      then '*****' || substr(v_share.worker_dni, 6, 3) || '*' else '*********' end,
    'worksite', coalesce(nullif(btrim(v_worker.obra), ''), v_visit.worksite),
    'periodStart', v_worker.periodo_inicio, 'periodEnd', v_worker.periodo_fin,
    'trainingRecord', case lower(btrim(v_worker.formacion))
      when 'sí' then 'Consta en ficha' when 'si' then 'Consta en ficha'
      when 'no' then 'No consta' when 'sin formación' then 'No consta'
      else 'Pendiente de verificar' end
  )) || private.worker_qr_visible_aptitude(v_worker);
end;
$$;

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
      else 'Pendiente de verificar' end end
  )) || case when 'medical_conclusion' = any(v_sections)
    then private.worker_qr_visible_aptitude(v_worker) else '{}'::jsonb end;
end;
$$;
