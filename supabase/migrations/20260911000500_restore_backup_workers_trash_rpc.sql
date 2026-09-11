create or replace function public.restore_workers_trash_backup(
  p_workers jsonb,
  p_trash jsonb,
  p_replace boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_id bigint;
  v_workers_count integer := 0;
  v_trash_count integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  if jsonb_typeof(coalesce(p_workers, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_trash, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid backup payload';
  end if;

  if p_replace then
    delete from public.trash where owner_id = v_uid;
    delete from public.workers where owner_id = v_uid;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_workers, '[]'::jsonb))
  loop
    begin
      v_id := nullif(v_item->>'id', '')::bigint;
    exception when others then
      raise exception 'invalid worker id in backup';
    end;
    if v_id is null then raise exception 'missing worker id in backup'; end if;

    insert into public.workers(owner_id,id,data,created_by,updated_by)
    values(v_uid,v_id,v_item,v_uid,v_uid)
    on conflict (owner_id,id) do update
      set data=excluded.data, updated_by=v_uid, updated_at=now();
    v_workers_count := v_workers_count + 1;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_trash, '[]'::jsonb))
  loop
    begin
      v_id := nullif(coalesce(v_item->'person'->>'id', v_item->>'id'), '')::bigint;
    exception when others then
      raise exception 'invalid trash id in backup';
    end;
    if v_id is null then raise exception 'missing trash id in backup'; end if;

    insert into public.trash(owner_id,id,data,created_by,updated_by)
    values(v_uid,v_id,v_item,v_uid,v_uid)
    on conflict (owner_id,id) do update
      set data=excluded.data, updated_by=v_uid, updated_at=now();
    v_trash_count := v_trash_count + 1;
  end loop;

  return jsonb_build_object(
    'workers', v_workers_count,
    'trash', v_trash_count,
    'mode', case when p_replace then 'replace' else 'merge' end
  );
end;
$$;

revoke all on function public.restore_workers_trash_backup(jsonb,jsonb,boolean) from public;
grant execute on function public.restore_workers_trash_backup(jsonb,jsonb,boolean) to authenticated;
