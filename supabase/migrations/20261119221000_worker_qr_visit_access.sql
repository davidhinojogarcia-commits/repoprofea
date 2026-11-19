create table private.worker_qr_visits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  worksite text not null,
  worksite_id uuid,
  recipient text not null,
  invitation_digest bytea unique not null,
  session_digest bytea unique,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  redeemed_at timestamptz,
  revoked_at timestamptz
);
create index worker_qr_visits_owner on private.worker_qr_visits(owner_id, expires_at);

create table private.worker_qr_visit_reads (
  visit_id uuid not null references private.worker_qr_visits(id) on delete cascade,
  card_token uuid not null,
  expires_at timestamptz not null,
  primary key (visit_id, card_token)
);

create table private.worker_qr_restrictions (
  owner_id uuid not null,
  worker_id bigint not null,
  restriction_text text not null check (length(restriction_text) between 1 and 600),
  source_signature bytea not null,
  primary key (owner_id, worker_id),
  foreign key (owner_id, worker_id) references public.trabajadores(owner_id, id) on delete cascade
);

alter table private.worker_qr_visits enable row level security;
alter table private.worker_qr_visit_reads enable row level security;
alter table private.worker_qr_restrictions enable row level security;
revoke all on private.worker_qr_visits, private.worker_qr_visit_reads, private.worker_qr_restrictions from public, anon, authenticated;

create function private.worker_qr_restriction_signature(p_worker public.trabajadores)
returns bytea language sql immutable set search_path = ''
as $$
  select extensions.digest(jsonb_build_array(
    p_worker.aptitud_medica, p_worker.reconocimiento_estado, p_worker.reconocimiento_fecha,
    p_worker.reconocimiento_validez, p_worker.limitaciones_aptitud, p_worker.reconocimiento_limitaciones
  )::text, 'sha256');
$$;
revoke all on function private.worker_qr_restriction_signature(public.trabajadores) from public, anon, authenticated;

create function public.issue_worker_qr_visit(p_worker_id bigint, p_recipient text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_worker public.trabajadores%rowtype;
  v_code uuid := gen_random_uuid();
  v_id uuid;
  v_limit timestamptz;
begin
  if v_owner is null or not private.has_module_permission('trabajadores', 'read')
    or not private.has_module_permission('trabajadores', 'update') then return null; end if;
  if length(btrim(coalesce(p_recipient, ''))) not between 8 and 150 then return null; end if;
  select * into v_worker from public.trabajadores
  where owner_id = v_owner and id = p_worker_id;
  if not found or btrim(coalesce(v_worker.obra, '')) = '' then return null; end if;
  insert into private.worker_qr_visits(owner_id, worksite, worksite_id, recipient, invitation_digest)
  values (v_owner, btrim(v_worker.obra), v_worker.obra_id, btrim(p_recipient), extensions.digest(v_code::text, 'sha256'))
  returning id, expires_at into v_id, v_limit;
  return jsonb_build_object('id', v_id, 'code', v_code, 'expiresAt', v_limit);
end;
$$;

create function public.list_worker_qr_visits(p_worker_id bigint)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'recipient', v.recipient, 'expiresAt', v.expires_at, 'redeemed', v.redeemed_at is not null
  ) order by v.expires_at desc), '[]'::jsonb)
  from private.worker_qr_visits v
  join public.trabajadores t on t.id = p_worker_id and t.owner_id = v.owner_id
  where v.owner_id = (select auth.uid()) and private.has_module_permission('trabajadores', 'read')
    and private.has_module_permission('trabajadores', 'update')
    and v.worksite_id is not distinct from t.obra_id
    and (v.worksite_id is not null or lower(v.worksite) = lower(btrim(t.obra)))
    and v.revoked_at is null and v.expires_at > now();
$$;

create function public.revoke_worker_qr_visit(p_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update private.worker_qr_visits set revoked_at = now()
  where id = p_id and owner_id = (select auth.uid()) and revoked_at is null
    and private.has_module_permission('trabajadores', 'read') and private.has_module_permission('trabajadores', 'update');
  return found;
end;
$$;

create function public.save_worker_qr_restrictions(p_worker_id bigint, p_text text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_worker public.trabajadores%rowtype;
begin
  if (select auth.uid()) is null or not private.has_module_permission('trabajadores', 'read')
    or not private.has_module_permission('trabajadores', 'update') or length(btrim(coalesce(p_text, ''))) > 600 then
    return false;
  end if;
  select * into v_worker from public.trabajadores where id = p_worker_id and owner_id = (select auth.uid());
  if not found then return false; end if;
  if btrim(coalesce(p_text, '')) = '' then
    delete from private.worker_qr_restrictions where owner_id = v_worker.owner_id and worker_id = v_worker.id;
  else
    insert into private.worker_qr_restrictions(owner_id, worker_id, restriction_text, source_signature)
    values (v_worker.owner_id, v_worker.id, btrim(p_text), private.worker_qr_restriction_signature(v_worker))
    on conflict (owner_id, worker_id) do update
    set restriction_text = excluded.restriction_text, source_signature = excluded.source_signature;
  end if;
  return true;
end;
$$;

create function public.get_worker_qr_restrictions(p_worker_id bigint)
returns text language sql stable security definer set search_path = ''
as $$
  select r.restriction_text from private.worker_qr_restrictions r
  join public.trabajadores t on t.id = r.worker_id and t.owner_id = r.owner_id
  where r.worker_id = p_worker_id and r.owner_id = (select auth.uid())
    and private.has_module_permission('trabajadores', 'read')
    and private.has_module_permission('trabajadores', 'update')
    and r.source_signature = private.worker_qr_restriction_signature(t);
$$;

create function public.redeem_worker_qr_visit(p_code uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_session uuid := gen_random_uuid();
  v_expiry timestamptz;
begin
  update private.worker_qr_visits set session_digest = extensions.digest(v_session::text, 'sha256'), redeemed_at = now()
  where invitation_digest = extensions.digest(p_code::text, 'sha256') and redeemed_at is null
    and revoked_at is null and expires_at > now()
  returning expires_at into v_expiry;
  if not found then return null; end if;
  return jsonb_build_object('token', v_session, 'expiresAt', v_expiry);
end;
$$;

create function public.close_worker_qr_visit(p_session uuid)
returns void language sql security definer set search_path = ''
as $$
  update private.worker_qr_visits set revoked_at = now()
  where session_digest = extensions.digest(p_session::text, 'sha256') and revoked_at is null;
$$;

create function public.read_worker_qr_visit(p_session uuid, p_card uuid)
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
  values (v_visit.id, p_card, least(v_visit.expires_at, now() + interval '2 minutes'))
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

revoke all on function public.issue_worker_qr_visit(bigint,text), public.list_worker_qr_visits(bigint),
  public.revoke_worker_qr_visit(uuid), public.save_worker_qr_restrictions(bigint,text), public.get_worker_qr_restrictions(bigint),
  public.redeem_worker_qr_visit(uuid), public.read_worker_qr_visit(uuid,uuid), public.close_worker_qr_visit(uuid) from public, anon, authenticated;
grant execute on function public.issue_worker_qr_visit(bigint,text), public.list_worker_qr_visits(bigint),
  public.revoke_worker_qr_visit(uuid), public.save_worker_qr_restrictions(bigint,text), public.get_worker_qr_restrictions(bigint) to authenticated;
grant execute on function public.redeem_worker_qr_visit(uuid), public.read_worker_qr_visit(uuid,uuid), public.close_worker_qr_visit(uuid) to anon, authenticated;
