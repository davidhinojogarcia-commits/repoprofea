-- Existing consultations keep their stored deadlines. New scans use ten minutes.
create or replace function public.read_worker_qr_visit(p_session uuid, p_card uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_visit private.worker_qr_visits%rowtype;
  v_share public.worker_qr_shares%rowtype;
  v_worker public.trabajadores%rowtype;
  v_end timestamptz;
  v_day text := to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD');
  v_aptitude text;
  v_restrictions text;
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

  v_aptitude := case lower(coalesce(nullif(btrim(v_worker.aptitud_medica), ''), btrim(v_worker.reconocimiento_estado)))
    when 'apto' then 'Apto'
    when 'no apto' then 'No apto'
    when 'apto con limitación' then 'Apto con limitación'
    when 'apto con limitaciones' then 'Apto con limitación'
  end;
  if v_aptitude = 'Apto con limitación' then
    select restriction_text into v_restrictions from private.worker_qr_restrictions
    where owner_id = v_worker.owner_id and worker_id = v_worker.id
      and source_signature = private.worker_qr_restriction_signature(v_worker);
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'status', 'ok', 'expiresAt', v_end, 'remainingMs', floor(extract(epoch from v_end - now()) * 1000),
    'maskedDni', case when v_share.worker_dni ~ '^([0-9]{8}|[XYZ][0-9]{7})[A-Z]$'
      then '*****' || substr(v_share.worker_dni, 6, 3) || '*' else '*********' end,
    'worksite', coalesce(nullif(btrim(v_worker.obra), ''), v_visit.worksite),
    'periodStart', v_worker.periodo_inicio, 'periodEnd', v_worker.periodo_fin,
    'trainingRecord', case lower(btrim(v_worker.formacion))
      when 'sí' then 'Consta en ficha' when 'si' then 'Consta en ficha'
      when 'no' then 'No consta' when 'sin formación' then 'No consta'
      else 'Pendiente de verificar' end,
    'aptitudeConclusion', v_aptitude, 'workRestrictions', v_restrictions
  ));
end;
$$;
