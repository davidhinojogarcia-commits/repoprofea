begin;

create function public.get_prevention_acta_history(p_ids uuid[], p_token text default null)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_access record;
  v_events jsonb;
  v_count integer;
begin
  select * into v_access from prevention_private.access_context(p_token);
  v_count:=coalesce(array_length(p_ids,1),0);
  if v_count=0 then return '[]'::jsonb; end if;
  if v_count>200 then raise exception 'El acta no puede incluir más de 200 registros a la vez'; end if;

  select coalesce(
    jsonb_agg(
      (to_jsonb(e)-'owner_id')
      order by e.created_at asc,e.id asc
    ),
    '[]'::jsonb
  )
  into v_events
  from public.prevention_events e
  join public.prevention_records r on r.id=e.record_id
  where e.record_id=any(p_ids)
    and r.owner_id=v_access.owner_id
    and (not v_access.is_foreman or r.obra=v_access.obra);

  return v_events;
end;
$$;

revoke all on function public.get_prevention_acta_history(uuid[],text) from public,anon,authenticated;
grant execute on function public.get_prevention_acta_history(uuid[],text) to anon,authenticated;
notify pgrst,'reload schema';

commit;
