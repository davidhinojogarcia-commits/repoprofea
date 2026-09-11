create or replace function public.restore_workers_trash_backup(
  p_workers jsonb,
  p_trash jsonb,
  p_replace boolean default false
)
returns jsonb
language plpgsql
set search_path to 'public','private','pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_id bigint;
  v_next_id bigint;
  v_payload_max bigint := 0;
  v_workers_count integer := 0;
  v_trash_count integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  if jsonb_typeof(coalesce(p_workers,'[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_trash,'[]'::jsonb)) <> 'array' then
    raise exception 'invalid backup payload';
  end if;

  select coalesce(max((value->>'id')::bigint), 0)
    into v_payload_max
  from jsonb_array_elements(coalesce(p_workers,'[]'::jsonb))
  where coalesce(value->>'id','') ~ '^[0-9]+$'
    and (value->>'id')::numeric > 0
    and (value->>'id')::numeric <= 9223372036854775807;

  select greatest(
    coalesce((select max(id) from public.trabajadores where owner_id = v_uid), 0),
    coalesce((select max(id) from public.trash where owner_id = v_uid), 0),
    v_payload_max
  ) + 1 into v_next_id;

  if p_replace then
    delete from public.trash where owner_id = v_uid;
    delete from public.trabajadores where owner_id = v_uid;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_workers,'[]'::jsonb)) loop
    v_id := null;
    begin
      v_id := nullif(v_item->>'id','')::bigint;
    exception when others then
      v_id := null;
    end;

    if v_id is null or v_id <= 0 then
      v_id := v_next_id;
      v_next_id := v_next_id + 1;
      v_item := jsonb_set(v_item, '{id}', to_jsonb(v_id), true);
    end if;

    perform public.import_workers_atomic(jsonb_build_array(v_item));
    v_workers_count := v_workers_count + 1;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_trash,'[]'::jsonb)) loop
    v_id := null;
    begin
      v_id := nullif(coalesce(v_item->'person'->>'id', v_item->>'id'),'')::bigint;
    exception when others then
      v_id := null;
    end;

    if v_id is null or v_id <= 0 then
      v_id := v_next_id;
      v_next_id := v_next_id + 1;
      if jsonb_typeof(v_item->'person') = 'object' then
        v_item := jsonb_set(v_item, '{person,id}', to_jsonb(v_id), true);
      else
        v_item := jsonb_set(v_item, '{id}', to_jsonb(v_id), true);
      end if;
    end if;

    insert into public.trash(owner_id,id,data,created_by,updated_by)
    values(v_uid,v_id,v_item,v_uid,v_uid)
    on conflict(owner_id,id) do update set
      data = excluded.data,
      updated_by = v_uid,
      updated_at = now();
    v_trash_count := v_trash_count + 1;
  end loop;

  return jsonb_build_object(
    'workers', v_workers_count,
    'trash', v_trash_count,
    'mode', case when p_replace then 'replace' else 'merge' end
  );
end;
$$;
