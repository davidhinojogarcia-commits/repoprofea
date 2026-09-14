-- Keep every supervisor's operational data isolated by owner. Cross-user access is
-- possible only when the concrete record has been explicitly shared.

create or replace function private.can_access_related_row(
  p_module text,
  p_resource_type text,
  p_resource_id text,
  p_owner_id uuid,
  p_obra_id uuid,
  p_obra_key text,
  p_trabajador_id bigint,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
    or (
      private.has_module_permission(p_module, p_action)
      and (
        p_owner_id = (select auth.uid())
        or private.has_resource_permission(p_resource_type, p_resource_id, p_action)
      )
    );
$$;

-- Validate that a user attempting to manage a share actually owns the target row.
-- Administrators retain global share-management capability.
create or replace function private.can_manage_resource_share(
  p_resource_type text,
  p_resource_id text,
  p_owner_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
    or (
      (select auth.uid()) is not null
      and p_owner_id = (select auth.uid())
      and case p_resource_type
        when 'trabajadores' then exists (
          select 1 from public.trabajadores r
          where r.id::text = p_resource_id and r.owner_id = (select auth.uid())
        )
        when 'obra' then exists (
          select 1 from public.obras r
          where r.id::text = p_resource_id and r.owner_id = (select auth.uid())
        )
        when 'obras' then exists (
          select 1 from public.obras r
          where r.id::text = p_resource_id and r.owner_id = (select auth.uid())
        )
        when 'contrataciones' then exists (
          select 1 from public.contrataciones r
          where r.id::text = p_resource_id and r.owner_id = (select auth.uid())
        )
        when 'reconocimientos' then exists (
          select 1 from public.reconocimientos r
          where r.id::text = p_resource_id and r.owner_id = (select auth.uid())
        )
        when 'citas' then exists (
          select 1 from public.citas r
          where r.id::text = p_resource_id and r.owner_id = (select auth.uid())
        )
        when 'subcontratas' then exists (
          select 1 from public.subcontratas r
          where r.id::text = p_resource_id and r.owner_id = (select auth.uid())
        )
        else false
      end
    );
$$;

-- Owners may explicitly share their own records. They cannot manufacture a share
-- for another user's row because the helper validates the real row owner.
drop policy if exists data_permissions_insert on public.data_permissions;
create policy data_permissions_insert on public.data_permissions
for insert to authenticated
with check (
  private.can_manage_resource_share(resource_type, resource_id, owner_id)
);

drop policy if exists data_permissions_update on public.data_permissions;
create policy data_permissions_update on public.data_permissions
for update to authenticated
using (
  private.can_manage_resource_share(resource_type, resource_id, owner_id)
)
with check (
  private.can_manage_resource_share(resource_type, resource_id, owner_id)
);

drop policy if exists data_permissions_delete on public.data_permissions;
create policy data_permissions_delete on public.data_permissions
for delete to authenticated
using (
  private.can_manage_resource_share(resource_type, resource_id, owner_id)
);

-- Expose only the minimal profile directory needed by the sharing dialog.
create or replace function public.list_shareable_profiles()
returns table (
  id uuid,
  email text,
  nombre text,
  apellidos text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.email, p.nombre, p.apellidos
  from public.profiles p
  where p.active = true
    and p.id <> (select auth.uid())
  order by p.nombre asc nulls last, p.apellidos asc nulls last, p.email asc;
$$;

revoke all on function public.list_shareable_profiles() from public;
revoke all on function public.list_shareable_profiles() from anon;
grant execute on function public.list_shareable_profiles() to authenticated;
