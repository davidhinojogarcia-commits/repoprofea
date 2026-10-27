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
