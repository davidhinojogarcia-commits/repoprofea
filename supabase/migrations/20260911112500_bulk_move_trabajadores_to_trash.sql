create or replace function public.bulk_move_trabajadores_to_trash(p_ids bigint[])
returns integer
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  with candidates as (
    select t.id, t.data
    from public.trabajadores t
    where t.id = any(p_ids)
  ), inserted as (
    insert into public.trash(owner_id, id, data, created_by, updated_by)
    select
      v_uid,
      c.id,
      jsonb_build_object(
        'person', coalesce(c.data, '{}'::jsonb),
        'fechaEliminacion', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      v_uid,
      v_uid
    from candidates c
    on conflict (owner_id, id) do update
      set data = excluded.data,
          updated_by = v_uid,
          updated_at = now()
    returning id
  ), deleted as (
    delete from public.trabajadores t
    where t.id in (select id from inserted)
    returning t.id
  )
  select count(*) into v_count from deleted;

  return v_count;
end;
$$;

grant execute on function public.bulk_move_trabajadores_to_trash(bigint[]) to authenticated;
