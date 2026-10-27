-- Return only an existing worker ID owned by the authenticated supervisor.
-- Possession of a QR alone is never an authorization to open the directory.
create or replace function public.resolve_worker_card_owner(p_token uuid)
returns bigint language sql stable security definer set search_path = ''
as $$
  select t.id
  from public.worker_qr_shares s
  join public.trabajadores t
    on t.owner_id = s.owner_id
   and upper(regexp_replace(coalesce(t.dni, ''), '[[:space:]-]', '', 'g')) = s.worker_dni
  where (select auth.uid()) is not null
    and s.owner_id = (select auth.uid())
    and s.token = p_token
    and s.revoked_at is null
  order by coalesce(nullif(t.periodo_inicio, ''), nullif(t.fecha_registro, '')) desc nulls last, t.id desc
  limit 1;
$$;
revoke all on function public.resolve_worker_card_owner(uuid) from public, anon;
grant execute on function public.resolve_worker_card_owner(uuid) to authenticated;

-- Worker IDs are unique only within their owner.
create or replace function public.ensure_worker_qr_share(p_worker_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_dni text;
  v_token uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  select t.owner_id,
         upper(regexp_replace(coalesce(t.dni, ''), '[[:space:]-]', '', 'g'))
    into v_owner, v_dni
  from public.trabajadores t
  where t.id = p_worker_id and t.owner_id = (select auth.uid())
  limit 1;

  if v_owner is null then
    raise exception 'worker not found';
  end if;
  if v_owner <> (select auth.uid()) then
    raise exception 'only the worker owner can create the QR share';
  end if;
  if coalesce(v_dni, '') = '' then
    raise exception 'worker DNI is required';
  end if;

  insert into public.worker_qr_shares(owner_id, worker_dni, revoked_at)
  values (v_owner, v_dni, null)
  on conflict (owner_id, worker_dni)
  do update set revoked_at = null, updated_at = now()
  returning token into v_token;

  return v_token;
end;
$$;
revoke all on function public.ensure_worker_qr_share(bigint) from public, anon;
grant execute on function public.ensure_worker_qr_share(bigint) to authenticated;
