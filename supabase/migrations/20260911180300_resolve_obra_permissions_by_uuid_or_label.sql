create or replace function private.has_obra_permission(p_obra_id uuid, p_obra_key text, p_action text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select private.is_admin() or exists (
    select 1
    from public.data_permissions dp
    join public.profiles p on p.id = dp.user_id
    where dp.resource_type = 'obra'
      and dp.user_id = (select auth.uid())
      and p.active = true
      and (
        (p_obra_id is not null and dp.resource_id = p_obra_id::text)
        or (
          nullif(btrim(coalesce(p_obra_key, '')), '') is not null
          and lower(btrim(dp.resource_id)) = lower(btrim(p_obra_key))
        )
        or (
          nullif(btrim(coalesce(p_obra_key, '')), '') is not null
          and exists (
            select 1
            from public.obras o
            where o.id::text = dp.resource_id
              and (
                lower(btrim(coalesce(o.nombre,''))) = lower(btrim(p_obra_key))
                or lower(btrim(coalesce(o.codigo,''))) = lower(btrim(p_obra_key))
              )
          )
        )
      )
      and case p_action
        when 'read' then dp.can_read
        when 'update' then dp.can_update
        when 'delete' then dp.can_delete
        else false
      end
  );
$$;
revoke all on function private.has_obra_permission(uuid,text,text) from public;
grant execute on function private.has_obra_permission(uuid,text,text) to authenticated;
