-- Existing tokens and the response envelope remain compatible with issued cards.
-- No worker fields are returned to an anonymous caller. Publication of personal
-- fields requires a separately established legal basis and publication policy.
create or replace function public.resolve_worker_qr_share(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_exists boolean;
begin
  select exists (
    select 1
    from public.worker_qr_shares s
    where s.token = p_token and s.revoked_at is null
      and exists (
        select 1 from public.trabajadores t
        where t.owner_id = s.owner_id
          and upper(regexp_replace(coalesce(t.dni, ''), '[[:space:]-]', '', 'g')) = s.worker_dni
      )
  ) into v_exists;
  -- Keep one empty item for previously deployed clients expecting history[].
  return jsonb_build_object('valid', v_exists, 'history',
    case when v_exists then '[{}]'::jsonb else '[]'::jsonb end);
end;
$$;
revoke all on function public.resolve_worker_qr_share(uuid) from public;
grant execute on function public.resolve_worker_qr_share(uuid) to anon, authenticated;
