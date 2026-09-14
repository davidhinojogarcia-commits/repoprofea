-- Strict tenant isolation and owner-controlled worker sharing.
-- Supervisors only see their own business rows or records explicitly shared with them.
-- Administrative account-management privileges do not grant automatic access to business data.

create or replace function private.has_explicit_resource_permission(
  p_resource_type text,
  p_resource_id text,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.data_permissions dp
    join public.profiles p on p.id = dp.user_id
    where dp.resource_type = p_resource_type
      and dp.resource_id = p_resource_id
      and dp.user_id = (select auth.uid())
      and p.active = true
      and case p_action
        when 'read' then dp.can_read
        when 'update' then dp.can_update
        when 'delete' then dp.can_delete
        else false
      end
  );
$$;

create or replace function private.can_access_isolated_business_row(
  p_module text,
  p_resource_type text,
  p_resource_id text,
  p_owner_id uuid,
  p_trabajador_id bigint,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_module_permission(p_module, p_action)
    and (
      p_owner_id = (select auth.uid())
      or private.has_explicit_resource_permission(p_resource_type, p_resource_id, p_action)
      or (
        p_trabajador_id is not null
        and private.has_explicit_resource_permission('trabajadores', p_trabajador_id::text, p_action)
      )
    );
$$;

revoke all on function private.has_explicit_resource_permission(text,text,text) from public;
revoke all on function private.can_access_isolated_business_row(text,text,text,uuid,bigint,text) from public;
grant execute on function private.has_explicit_resource_permission(text,text,text) to authenticated;
grant execute on function private.can_access_isolated_business_row(text,text,text,uuid,bigint,text) to authenticated;

drop policy if exists trabajadores_select on public.trabajadores;
create policy trabajadores_select on public.trabajadores
for select to authenticated
using (
  private.has_module_permission('trabajadores','read')
  and (
    owner_id = (select auth.uid())
    or private.has_explicit_resource_permission('trabajadores', id::text, 'read')
  )
);

drop policy if exists trabajadores_insert on public.trabajadores;
create policy trabajadores_insert on public.trabajadores
for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and private.has_module_permission('trabajadores','create')
);

drop policy if exists trabajadores_update on public.trabajadores;
create policy trabajadores_update on public.trabajadores
for update to authenticated
using (
  private.has_module_permission('trabajadores','update')
  and (
    owner_id = (select auth.uid())
    or private.has_explicit_resource_permission('trabajadores', id::text, 'update')
  )
)
with check (
  private.has_module_permission('trabajadores','update')
  and updated_by = (select auth.uid())
  and (
    owner_id = (select auth.uid())
    or private.has_explicit_resource_permission('trabajadores', id::text, 'update')
  )
);

drop policy if exists trabajadores_delete on public.trabajadores;
create policy trabajadores_delete on public.trabajadores
for delete to authenticated
using (
  private.has_module_permission('trabajadores','delete')
  and (
    owner_id = (select auth.uid())
    or private.has_explicit_resource_permission('trabajadores', id::text, 'delete')
  )
);

drop policy if exists trash_select on public.trash;
create policy trash_select on public.trash
for select to authenticated
using (
  private.has_module_permission('trabajadores','read')
  and (
    owner_id = (select auth.uid())
    or private.has_explicit_resource_permission('trabajadores', id::text, 'read')
  )
);
drop policy if exists trash_insert on public.trash;
create policy trash_insert on public.trash
for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and private.has_module_permission('trabajadores','create')
);
drop policy if exists trash_update on public.trash;
create policy trash_update on public.trash
for update to authenticated
using (
  private.has_module_permission('trabajadores','update')
  and (
    owner_id = (select auth.uid())
    or private.has_explicit_resource_permission('trabajadores', id::text, 'update')
  )
)
with check (
  private.has_module_permission('trabajadores','update')
  and updated_by = (select auth.uid())
  and (
    owner_id = (select auth.uid())
    or private.has_explicit_resource_permission('trabajadores', id::text, 'update')
  )
);
drop policy if exists trash_delete on public.trash;
create policy trash_delete on public.trash
for delete to authenticated
using (
  private.has_module_permission('trabajadores','delete')
  and (
    owner_id = (select auth.uid())
    or private.has_explicit_resource_permission('trabajadores', id::text, 'delete')
  )
);

drop policy if exists obras_select on public.obras;
create policy obras_select on public.obras
for select to authenticated
using (
  private.has_module_permission('obras','read')
  and (
    owner_id = (select auth.uid())
    or private.has_explicit_resource_permission('obra', id::text, 'read')
  )
);

drop policy if exists obras_insert on public.obras;
create policy obras_insert on public.obras
for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and private.has_module_permission('obras','create')
);

drop policy if exists obras_update on public.obras;
create policy obras_update on public.obras
for update to authenticated
using (
  private.has_module_permission('obras','update')
  and (
    owner_id = (select auth.uid())
    or private.has_explicit_resource_permission('obra', id::text, 'update')
  )
)
with check (
  private.has_module_permission('obras','update')
  and updated_by = (select auth.uid())
  and (
    owner_id = (select auth.uid())
    or private.has_explicit_resource_permission('obra', id::text, 'update')
  )
);

drop policy if exists obras_delete on public.obras;
create policy obras_delete on public.obras
for delete to authenticated
using (
  private.has_module_permission('obras','delete')
  and (
    owner_id = (select auth.uid())
    or private.has_explicit_resource_permission('obra', id::text, 'delete')
  )
);

drop policy if exists contrataciones_select on public.contrataciones;
create policy contrataciones_select on public.contrataciones for select to authenticated
using (private.can_access_isolated_business_row('contratacion','contrataciones',id,owner_id,trabajador_id,'read'));
drop policy if exists contrataciones_insert on public.contrataciones;
create policy contrataciones_insert on public.contrataciones for insert to authenticated
with check (owner_id=(select auth.uid()) and private.has_module_permission('contratacion','create'));
drop policy if exists contrataciones_update on public.contrataciones;
create policy contrataciones_update on public.contrataciones for update to authenticated
using (private.can_access_isolated_business_row('contratacion','contrataciones',id,owner_id,trabajador_id,'update'))
with check (private.can_access_isolated_business_row('contratacion','contrataciones',id,owner_id,trabajador_id,'update'));
drop policy if exists contrataciones_delete on public.contrataciones;
create policy contrataciones_delete on public.contrataciones for delete to authenticated
using (private.can_access_isolated_business_row('contratacion','contrataciones',id,owner_id,trabajador_id,'delete'));

drop policy if exists reconocimientos_select on public.reconocimientos;
create policy reconocimientos_select on public.reconocimientos for select to authenticated
using (private.can_access_isolated_business_row('reconocimientos','reconocimientos',id,owner_id,trabajador_id,'read'));
drop policy if exists reconocimientos_insert on public.reconocimientos;
create policy reconocimientos_insert on public.reconocimientos for insert to authenticated
with check (owner_id=(select auth.uid()) and private.has_module_permission('reconocimientos','create'));
drop policy if exists reconocimientos_update on public.reconocimientos;
create policy reconocimientos_update on public.reconocimientos for update to authenticated
using (private.can_access_isolated_business_row('reconocimientos','reconocimientos',id,owner_id,trabajador_id,'update'))
with check (private.can_access_isolated_business_row('reconocimientos','reconocimientos',id,owner_id,trabajador_id,'update'));
drop policy if exists reconocimientos_delete on public.reconocimientos;
create policy reconocimientos_delete on public.reconocimientos for delete to authenticated
using (private.can_access_isolated_business_row('reconocimientos','reconocimientos',id,owner_id,trabajador_id,'delete'));

drop policy if exists citas_select on public.citas;
create policy citas_select on public.citas for select to authenticated
using (private.can_access_isolated_business_row('citas','citas',id,owner_id,trabajador_id,'read'));
drop policy if exists citas_insert on public.citas;
create policy citas_insert on public.citas for insert to authenticated
with check (owner_id=(select auth.uid()) and private.has_module_permission('citas','create'));
drop policy if exists citas_update on public.citas;
create policy citas_update on public.citas for update to authenticated
using (private.can_access_isolated_business_row('citas','citas',id,owner_id,trabajador_id,'update'))
with check (private.can_access_isolated_business_row('citas','citas',id,owner_id,trabajador_id,'update'));
drop policy if exists citas_delete on public.citas;
create policy citas_delete on public.citas for delete to authenticated
using (private.can_access_isolated_business_row('citas','citas',id,owner_id,trabajador_id,'delete'));

drop policy if exists subcontratas_select on public.subcontratas;
create policy subcontratas_select on public.subcontratas for select to authenticated
using (private.can_access_isolated_business_row('subcontratas','subcontratas',id,owner_id,null,'read'));
drop policy if exists subcontratas_insert on public.subcontratas;
create policy subcontratas_insert on public.subcontratas for insert to authenticated
with check (owner_id=(select auth.uid()) and private.has_module_permission('subcontratas','create'));
drop policy if exists subcontratas_update on public.subcontratas;
create policy subcontratas_update on public.subcontratas for update to authenticated
using (private.can_access_isolated_business_row('subcontratas','subcontratas',id,owner_id,null,'update'))
with check (private.can_access_isolated_business_row('subcontratas','subcontratas',id,owner_id,null,'update'));
drop policy if exists subcontratas_delete on public.subcontratas;
create policy subcontratas_delete on public.subcontratas for delete to authenticated
using (private.can_access_isolated_business_row('subcontratas','subcontratas',id,owner_id,null,'delete'));

drop policy if exists subcontrata_documentos_select on public.subcontrata_documentos;
create policy subcontrata_documentos_select on public.subcontrata_documentos for select to authenticated
using (exists (
  select 1 from public.subcontratas s
  where s.id=subcontrata_documentos.subcontrata_id
    and private.can_access_isolated_business_row('subcontratas','subcontratas',s.id,s.owner_id,null,'read')
));
drop policy if exists subcontrata_documentos_insert on public.subcontrata_documentos;
create policy subcontrata_documentos_insert on public.subcontrata_documentos for insert to authenticated
with check (exists (
  select 1 from public.subcontratas s
  where s.id=subcontrata_documentos.subcontrata_id
    and private.can_access_isolated_business_row('subcontratas','subcontratas',s.id,s.owner_id,null,'update')
));
drop policy if exists subcontrata_documentos_update on public.subcontrata_documentos;
create policy subcontrata_documentos_update on public.subcontrata_documentos for update to authenticated
using (exists (
  select 1 from public.subcontratas s
  where s.id=subcontrata_documentos.subcontrata_id
    and private.can_access_isolated_business_row('subcontratas','subcontratas',s.id,s.owner_id,null,'update')
))
with check (exists (
  select 1 from public.subcontratas s
  where s.id=subcontrata_documentos.subcontrata_id
    and private.can_access_isolated_business_row('subcontratas','subcontratas',s.id,s.owner_id,null,'update')
));
drop policy if exists subcontrata_documentos_delete on public.subcontrata_documentos;
create policy subcontrata_documentos_delete on public.subcontrata_documentos for delete to authenticated
using (exists (
  select 1 from public.subcontratas s
  where s.id=subcontrata_documentos.subcontrata_id
    and private.can_access_isolated_business_row('subcontratas','subcontratas',s.id,s.owner_id,null,'update')
));

create or replace function public.list_shareable_profiles()
returns table(id uuid,email text,nombre text,apellidos text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,p.email,p.nombre,p.apellidos
  from public.profiles p
  where p.active=true
    and p.id<>(select auth.uid())
    and exists (
      select 1 from public.profiles me
      where me.id=(select auth.uid()) and me.active=true
    )
  order by p.nombre,p.apellidos,p.email;
$$;

create or replace function public.get_worker_shares(p_worker_id bigint)
returns table(id text,user_id uuid,can_read boolean,can_update boolean,can_delete boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_dni text;
begin
  select t.owner_id,upper(regexp_replace(coalesce(t.dni,''),'[[:space:]-]','','g'))
    into v_owner,v_dni
  from public.trabajadores t
  where t.id=p_worker_id;

  if v_owner is null or v_owner<>(select auth.uid()) then
    raise exception 'Solo el propietario puede consultar con quién se comparte el trabajador.';
  end if;

  return query
  select min(dp.id::text),dp.user_id,bool_or(dp.can_read),bool_or(dp.can_update),bool_or(dp.can_delete)
  from public.data_permissions dp
  join public.trabajadores t on dp.resource_type='trabajadores' and dp.resource_id=t.id::text
  where t.owner_id=v_owner
    and (
      (v_dni<>'' and upper(regexp_replace(coalesce(t.dni,''),'[[:space:]-]','','g'))=v_dni)
      or (v_dni='' and t.id=p_worker_id)
    )
  group by dp.user_id;
end;
$$;

create or replace function public.set_worker_share(
  p_worker_id bigint,
  p_user_id uuid,
  p_can_update boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_dni text;
begin
  select t.owner_id,upper(regexp_replace(coalesce(t.dni,''),'[[:space:]-]','','g'))
    into v_owner,v_dni
  from public.trabajadores t
  where t.id=p_worker_id;

  if v_owner is null or v_owner<>(select auth.uid()) then
    raise exception 'Solo el propietario puede compartir este trabajador.';
  end if;
  if p_user_id=v_owner or not exists(select 1 from public.profiles p where p.id=p_user_id and p.active=true) then
    raise exception 'El usuario destinatario no es válido.';
  end if;

  insert into public.data_permissions(resource_type,resource_id,owner_id,user_id,can_read,can_update,can_delete,created_by)
  select 'trabajadores',t.id::text,v_owner,p_user_id,true,p_can_update,false,(select auth.uid())
  from public.trabajadores t
  where t.owner_id=v_owner
    and (
      (v_dni<>'' and upper(regexp_replace(coalesce(t.dni,''),'[[:space:]-]','','g'))=v_dni)
      or (v_dni='' and t.id=p_worker_id)
    )
  on conflict do nothing;

  update public.data_permissions dp
  set can_read=true,can_update=p_can_update,can_delete=false
  where dp.resource_type='trabajadores'
    and dp.owner_id=v_owner
    and dp.user_id=p_user_id
    and exists (
      select 1 from public.trabajadores t
      where t.id::text=dp.resource_id
        and t.owner_id=v_owner
        and (
          (v_dni<>'' and upper(regexp_replace(coalesce(t.dni,''),'[[:space:]-]','','g'))=v_dni)
          or (v_dni='' and t.id=p_worker_id)
        )
    );
end;
$$;

create or replace function public.remove_worker_share(p_worker_id bigint,p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_dni text;
begin
  select t.owner_id,upper(regexp_replace(coalesce(t.dni,''),'[[:space:]-]','','g'))
    into v_owner,v_dni
  from public.trabajadores t
  where t.id=p_worker_id;

  if v_owner is null or v_owner<>(select auth.uid()) then
    raise exception 'Solo el propietario puede dejar de compartir este trabajador.';
  end if;

  delete from public.data_permissions dp
  where dp.resource_type='trabajadores'
    and dp.owner_id=v_owner
    and dp.user_id=p_user_id
    and exists (
      select 1 from public.trabajadores t
      where t.id::text=dp.resource_id
        and t.owner_id=v_owner
        and (
          (v_dni<>'' and upper(regexp_replace(coalesce(t.dni,''),'[[:space:]-]','','g'))=v_dni)
          or (v_dni='' and t.id=p_worker_id)
        )
    );
end;
$$;

create or replace function public.inherit_worker_identity_shares()
returns trigger
language plpgsql
security definer
set search_path = ''
as $
declare
  v_dni text:=upper(regexp_replace(coalesce(new.dni,''),'[[:space:]-]','','g'));
begin
  if v_dni='' then return new; end if;
  insert into public.data_permissions(resource_type,resource_id,owner_id,user_id,can_read,can_update,can_delete,created_by)
  select distinct 'trabajadores',new.id::text,new.owner_id,dp.user_id,dp.can_read,dp.can_update,false,new.owner_id
  from public.data_permissions dp
  join public.trabajadores previous_worker
    on dp.resource_type='trabajadores'
   and dp.resource_id=previous_worker.id::text
  where previous_worker.owner_id=new.owner_id
    and previous_worker.id<>new.id
    and upper(regexp_replace(coalesce(previous_worker.dni,''),'[[:space:]-]','','g'))=v_dni
  on conflict do nothing;
  return new;
end;
$;

drop trigger if exists trg_inherit_worker_identity_shares on public.trabajadores;
create trigger trg_inherit_worker_identity_shares
after insert on public.trabajadores
for each row execute function public.inherit_worker_identity_shares();

revoke all on function public.list_shareable_profiles() from public;
revoke all on function public.get_worker_shares(bigint) from public;
revoke all on function public.set_worker_share(bigint,uuid,boolean) from public;
revoke all on function public.remove_worker_share(bigint,uuid) from public;
grant execute on function public.list_shareable_profiles() to authenticated;
grant execute on function public.get_worker_shares(bigint) to authenticated;
grant execute on function public.set_worker_share(bigint,uuid,boolean) to authenticated;
grant execute on function public.remove_worker_share(bigint,uuid) to authenticated;
