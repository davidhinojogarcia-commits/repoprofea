-- Strict row access: admins see everything; normal users only their own rows
-- or rows explicitly shared through public.data_permissions.

create or replace function private.can_access_business_row(
  p_module text,
  p_resource_type text,
  p_resource_id text,
  p_owner_id uuid,
  p_obra_id uuid,
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
      p_owner_id = (select auth.uid())
      and private.has_module_permission(p_module, p_action)
    )
    or (
      private.has_module_permission(p_module, p_action)
      and private.has_resource_permission(p_resource_type, p_resource_id, p_action)
    );
$$;

-- trabajadores: ownership or explicit record share only.
drop policy if exists trabajadores_select on public.trabajadores;
create policy trabajadores_select on public.trabajadores
for select to authenticated
using (
  private.is_admin()
  or (
    private.has_module_permission('trabajadores','read')
    and (
      owner_id = (select auth.uid())
      or private.has_resource_permission('trabajadores', id::text, 'read')
    )
  )
);

drop policy if exists trabajadores_insert on public.trabajadores;
create policy trabajadores_insert on public.trabajadores
for insert to authenticated
with check (
  private.is_admin()
  or (
    owner_id = (select auth.uid())
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
    and private.has_module_permission('trabajadores','create')
  )
);

drop policy if exists trabajadores_update on public.trabajadores;
create policy trabajadores_update on public.trabajadores
for update to authenticated
using (
  private.is_admin()
  or (
    private.has_module_permission('trabajadores','update')
    and (
      owner_id = (select auth.uid())
      or private.has_resource_permission('trabajadores', id::text, 'update')
    )
  )
)
with check (
  private.is_admin()
  or (
    private.has_module_permission('trabajadores','update')
    and updated_by = (select auth.uid())
    and (
      owner_id = (select auth.uid())
      or private.has_resource_permission('trabajadores', id::text, 'update')
    )
  )
);

drop policy if exists trabajadores_delete on public.trabajadores;
create policy trabajadores_delete on public.trabajadores
for delete to authenticated
using (
  private.is_admin()
  or (
    private.has_module_permission('trabajadores','delete')
    and (
      owner_id = (select auth.uid())
      or private.has_resource_permission('trabajadores', id::text, 'delete')
    )
  )
);

-- trash follows the same ownership/share model.
drop policy if exists trash_select on public.trash;
create policy trash_select on public.trash
for select to authenticated
using (
  private.is_admin()
  or (
    private.has_module_permission('trabajadores','read')
    and (
      owner_id = (select auth.uid())
      or private.has_resource_permission('trabajadores', id::text, 'read')
    )
  )
);

drop policy if exists trash_insert on public.trash;
create policy trash_insert on public.trash
for insert to authenticated
with check (
  private.is_admin()
  or (
    owner_id = (select auth.uid())
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
    and private.has_module_permission('trabajadores','create')
  )
);

drop policy if exists trash_update on public.trash;
create policy trash_update on public.trash
for update to authenticated
using (
  private.is_admin()
  or (
    private.has_module_permission('trabajadores','update')
    and (
      owner_id = (select auth.uid())
      or private.has_resource_permission('trabajadores', id::text, 'update')
    )
  )
)
with check (
  private.is_admin()
  or (
    private.has_module_permission('trabajadores','update')
    and updated_by = (select auth.uid())
    and (
      owner_id = (select auth.uid())
      or private.has_resource_permission('trabajadores', id::text, 'update')
    )
  )
);

drop policy if exists trash_delete on public.trash;
create policy trash_delete on public.trash
for delete to authenticated
using (
  private.is_admin()
  or (
    private.has_module_permission('trabajadores','delete')
    and (
      owner_id = (select auth.uid())
      or private.has_resource_permission('trabajadores', id::text, 'delete')
    )
  )
);

-- obras themselves can be owned/shared, but an obra grant no longer exposes child records.
drop policy if exists obras_select on public.obras;
create policy obras_select on public.obras
for select to authenticated
using (
  private.is_admin()
  or (
    private.has_module_permission('obras','read')
    and (
      owner_id = (select auth.uid())
      or private.has_resource_permission('obra', id::text, 'read')
    )
  )
);

drop policy if exists obras_insert on public.obras;
create policy obras_insert on public.obras
for insert to authenticated
with check (
  private.is_admin()
  or (
    owner_id = (select auth.uid())
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
    and private.has_module_permission('obras','create')
  )
);

drop policy if exists obras_update on public.obras;
create policy obras_update on public.obras
for update to authenticated
using (
  private.is_admin()
  or (
    private.has_module_permission('obras','update')
    and (
      owner_id = (select auth.uid())
      or private.has_resource_permission('obra', id::text, 'update')
    )
  )
)
with check (
  private.is_admin()
  or (
    private.has_module_permission('obras','update')
    and updated_by = (select auth.uid())
    and (
      owner_id = (select auth.uid())
      or private.has_resource_permission('obra', id::text, 'update')
    )
  )
);

drop policy if exists obras_delete on public.obras;
create policy obras_delete on public.obras
for delete to authenticated
using (
  private.is_admin()
  or (
    private.has_module_permission('obras','delete')
    and (
      owner_id = (select auth.uid())
      or private.has_resource_permission('obra', id::text, 'delete')
    )
  )
);

-- Text-id business tables use the shared helper. Inserts are owner-only (or admin).
drop policy if exists contrataciones_select on public.contrataciones;
create policy contrataciones_select on public.contrataciones
for select to authenticated
using (private.can_access_business_row('contratacion','contrataciones',id,owner_id,obra_id,'read'));
drop policy if exists contrataciones_insert on public.contrataciones;
create policy contrataciones_insert on public.contrataciones
for insert to authenticated
with check (private.is_admin() or (owner_id=(select auth.uid()) and private.has_module_permission('contratacion','create')));
drop policy if exists contrataciones_update on public.contrataciones;
create policy contrataciones_update on public.contrataciones
for update to authenticated
using (private.can_access_business_row('contratacion','contrataciones',id,owner_id,obra_id,'update'))
with check (private.can_access_business_row('contratacion','contrataciones',id,owner_id,obra_id,'update'));
drop policy if exists contrataciones_delete on public.contrataciones;
create policy contrataciones_delete on public.contrataciones
for delete to authenticated
using (private.can_access_business_row('contratacion','contrataciones',id,owner_id,obra_id,'delete'));

drop policy if exists reconocimientos_select on public.reconocimientos;
create policy reconocimientos_select on public.reconocimientos
for select to authenticated
using (private.can_access_business_row('reconocimientos','reconocimientos',id,owner_id,obra_id,'read'));
drop policy if exists reconocimientos_insert on public.reconocimientos;
create policy reconocimientos_insert on public.reconocimientos
for insert to authenticated
with check (private.is_admin() or (owner_id=(select auth.uid()) and private.has_module_permission('reconocimientos','create')));
drop policy if exists reconocimientos_update on public.reconocimientos;
create policy reconocimientos_update on public.reconocimientos
for update to authenticated
using (private.can_access_business_row('reconocimientos','reconocimientos',id,owner_id,obra_id,'update'))
with check (private.can_access_business_row('reconocimientos','reconocimientos',id,owner_id,obra_id,'update'));
drop policy if exists reconocimientos_delete on public.reconocimientos;
create policy reconocimientos_delete on public.reconocimientos
for delete to authenticated
using (private.can_access_business_row('reconocimientos','reconocimientos',id,owner_id,obra_id,'delete'));

drop policy if exists citas_select on public.citas;
create policy citas_select on public.citas
for select to authenticated
using (private.can_access_business_row('citas','citas',id,owner_id,obra_id,'read'));
drop policy if exists citas_insert on public.citas;
create policy citas_insert on public.citas
for insert to authenticated
with check (private.is_admin() or (owner_id=(select auth.uid()) and private.has_module_permission('citas','create')));
drop policy if exists citas_update on public.citas;
create policy citas_update on public.citas
for update to authenticated
using (private.can_access_business_row('citas','citas',id,owner_id,obra_id,'update'))
with check (private.can_access_business_row('citas','citas',id,owner_id,obra_id,'update'));
drop policy if exists citas_delete on public.citas;
create policy citas_delete on public.citas
for delete to authenticated
using (private.can_access_business_row('citas','citas',id,owner_id,obra_id,'delete'));

drop policy if exists subcontratas_select on public.subcontratas;
create policy subcontratas_select on public.subcontratas
for select to authenticated
using (private.can_access_business_row('subcontratas','subcontratas',id,owner_id,obra_id,'read'));
drop policy if exists subcontratas_insert on public.subcontratas;
create policy subcontratas_insert on public.subcontratas
for insert to authenticated
with check (private.is_admin() or (owner_id=(select auth.uid()) and private.has_module_permission('subcontratas','create')));
drop policy if exists subcontratas_update on public.subcontratas;
create policy subcontratas_update on public.subcontratas
for update to authenticated
using (private.can_access_business_row('subcontratas','subcontratas',id,owner_id,obra_id,'update'))
with check (private.can_access_business_row('subcontratas','subcontratas',id,owner_id,obra_id,'update'));
drop policy if exists subcontratas_delete on public.subcontratas;
create policy subcontratas_delete on public.subcontratas
for delete to authenticated
using (private.can_access_business_row('subcontratas','subcontratas',id,owner_id,obra_id,'delete'));

-- Child documents inherit access only from the explicitly accessible parent subcontrata.
drop policy if exists subcontrata_documentos_select on public.subcontrata_documentos;
create policy subcontrata_documentos_select on public.subcontrata_documentos
for select to authenticated
using (exists (
  select 1 from public.subcontratas s
  where s.id=subcontrata_documentos.subcontrata_id
    and private.can_access_business_row('subcontratas','subcontratas',s.id,s.owner_id,s.obra_id,'read')
));
drop policy if exists subcontrata_documentos_insert on public.subcontrata_documentos;
create policy subcontrata_documentos_insert on public.subcontrata_documentos
for insert to authenticated
with check (exists (
  select 1 from public.subcontratas s
  where s.id=subcontrata_documentos.subcontrata_id
    and private.can_access_business_row('subcontratas','subcontratas',s.id,s.owner_id,s.obra_id,'update')
));
drop policy if exists subcontrata_documentos_update on public.subcontrata_documentos;
create policy subcontrata_documentos_update on public.subcontrata_documentos
for update to authenticated
using (exists (
  select 1 from public.subcontratas s
  where s.id=subcontrata_documentos.subcontrata_id
    and private.can_access_business_row('subcontratas','subcontratas',s.id,s.owner_id,s.obra_id,'update')
))
with check (exists (
  select 1 from public.subcontratas s
  where s.id=subcontrata_documentos.subcontrata_id
    and private.can_access_business_row('subcontratas','subcontratas',s.id,s.owner_id,s.obra_id,'update')
));
drop policy if exists subcontrata_documentos_delete on public.subcontrata_documentos;
create policy subcontrata_documentos_delete on public.subcontrata_documentos
for delete to authenticated
using (exists (
  select 1 from public.subcontratas s
  where s.id=subcontrata_documentos.subcontrata_id
    and private.can_access_business_row('subcontratas','subcontratas',s.id,s.owner_id,s.obra_id,'update')
));
