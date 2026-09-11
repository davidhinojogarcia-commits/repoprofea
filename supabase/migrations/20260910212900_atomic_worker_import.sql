create or replace function public.import_workers_atomic(p_workers jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_user uuid := auth.uid();
  v_item jsonb;
  v_id bigint;
  v_count integer := 0;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.has_module_permission(v_user, 'trabajadores', 'create') then raise exception 'Permission denied'; end if;
  if p_workers is null or jsonb_typeof(p_workers) <> 'array' then raise exception 'Workers payload must be an array'; end if;

  for v_item in select value from jsonb_array_elements(p_workers)
  loop
    begin v_id := (v_item->>'id')::bigint;
    exception when others then raise exception 'Invalid worker id';
    end;
    if v_id is null or v_id <= 0 then raise exception 'Invalid worker id'; end if;

    insert into public.workers(owner_id,id,data,created_by,created_at,updated_by,updated_at)
    values (v_user,v_id,v_item,v_user,coalesce(nullif(v_item->>'fechaRegistro','')::timestamptz,now()),v_user,now())
    on conflict (owner_id,id) do update
      set data=excluded.data, updated_by=v_user, updated_at=now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
grant execute on function public.import_workers_atomic(jsonb) to authenticated;
