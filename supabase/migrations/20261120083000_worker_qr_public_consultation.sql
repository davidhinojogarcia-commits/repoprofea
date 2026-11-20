-- Enable only for cards whose public disclosure has been approved by the controller.
alter table public.worker_qr_shares
  add column public_consultation_enabled boolean not null default false;

create table private.worker_qr_public_consultations (
  card_token uuid references public.worker_qr_shares(token) on delete cascade,
  consultation uuid,
  expires_at timestamptz not null,
  primary key (card_token, consultation)
);
alter table private.worker_qr_public_consultations enable row level security;
revoke all on private.worker_qr_public_consultations from public, anon, authenticated;
create index on private.worker_qr_public_consultations (expires_at);

create function public.read_worker_qr_public_consultation(p_card uuid, p_consultation uuid, p_start boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_dni text;
  v_worker public.trabajadores%rowtype;
  v_expires timestamptz;
  v_day text := to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD');
begin
  if p_consultation is null then return jsonb_build_object('status', 'card_expired'); end if;
  select owner_id, worker_dni into v_owner, v_dni
  from public.worker_qr_shares
  where token = p_card and revoked_at is null and public_consultation_enabled;
  if not found then return jsonb_build_object('status', 'not_available'); end if;

  select t.* into v_worker from public.trabajadores t
  where t.owner_id = v_owner
    and upper(regexp_replace(t.dni, '[[:space:]-]', '', 'g')) = v_dni
    and t.periodo_inicio ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and t.periodo_fin ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and pg_input_is_valid(t.periodo_inicio, 'date') and pg_input_is_valid(t.periodo_fin, 'date')
  order by (v_day between t.periodo_inicio and t.periodo_fin) desc,
    (t.periodo_inicio <= v_day) desc,
    case when t.periodo_inicio <= v_day then t.periodo_inicio end desc,
    t.periodo_inicio asc, t.id desc limit 1;
  if not found then return jsonb_build_object('status', 'not_available'); end if;

  if p_start is true then
    delete from private.worker_qr_public_consultations where expires_at < now() - interval '1 day';
    insert into private.worker_qr_public_consultations values (p_card, p_consultation, now() + interval '10 minutes')
      on conflict do nothing;
  end if;
  select expires_at into v_expires from private.worker_qr_public_consultations
    where card_token = p_card and consultation = p_consultation;
  if v_expires is null or v_expires <= now() then return jsonb_build_object('status', 'card_expired'); end if;

  return jsonb_build_object(
    'status', 'ok', 'remainingMs', floor(extract(epoch from v_expires - now()) * 1000),
    'workerName', nullif(btrim(v_worker.apellidos_nombre), ''),
    'professionalCategory', nullif(btrim(v_worker.categoria), ''),
    'maskedDni', case when v_dni ~ '^([0-9]{8}|[XYZ][0-9]{7})[A-Z]$'
      then '*****' || substr(v_dni, 6, 3) || '*' else '*********' end,
    'worksite', coalesce(nullif(btrim(v_worker.obra), ''), 'No consta'),
    'periodStart', v_worker.periodo_inicio, 'periodEnd', v_worker.periodo_fin,
    'contractActive', v_day between v_worker.periodo_inicio and v_worker.periodo_fin,
    'trainingRecord', case lower(btrim(v_worker.formacion))
      when 'sí' then 'Consta en ficha' when 'si' then 'Consta en ficha'
      when 'no' then 'No consta' when 'sin formación' then 'No consta'
      else 'Pendiente de verificar' end
  );
end;
$$;
revoke all on function public.read_worker_qr_public_consultation(uuid, uuid, boolean) from public;
grant execute on function public.read_worker_qr_public_consultation(uuid, uuid, boolean) to anon, authenticated;
