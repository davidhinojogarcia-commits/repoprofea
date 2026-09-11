drop policy if exists obras_select on public.obras;
create policy obras_select on public.obras for select to authenticated using (
  private.is_admin() or (
    private.has_module_permission('obras','read') and (
      owner_id = auth.uid() or private.has_obra_permission(id,'read') or private.has_resource_permission('obra',id::text,'read')
    )
  )
);

drop policy if exists obras_update on public.obras;
create policy obras_update on public.obras for update to authenticated using (
  private.is_admin() or (
    private.has_module_permission('obras','update') and (
      owner_id = auth.uid() or private.has_obra_permission(id,'update') or private.has_resource_permission('obra',id::text,'update')
    )
  )
) with check (
  private.is_admin() or (
    private.has_module_permission('obras','update') and updated_by = auth.uid() and (
      owner_id = auth.uid() or private.has_obra_permission(id,'update') or private.has_resource_permission('obra',id::text,'update')
    )
  )
);

drop policy if exists obras_delete on public.obras;
create policy obras_delete on public.obras for delete to authenticated using (
  private.is_admin() or (
    private.has_module_permission('obras','delete') and (
      owner_id = auth.uid() or private.has_obra_permission(id,'delete') or private.has_resource_permission('obra',id::text,'delete')
    )
  )
);

drop policy if exists trabajadores_select on public.trabajadores;
create policy trabajadores_select on public.trabajadores for select to authenticated using (
  private.is_admin() or (
    private.has_module_permission('trabajadores','read') and (
      owner_id = auth.uid() or private.has_resource_permission('trabajadores',id::text,'read') or (obra_id is not null and private.has_obra_permission(obra_id,'read'))
    )
  )
);

drop policy if exists trabajadores_update on public.trabajadores;
create policy trabajadores_update on public.trabajadores for update to authenticated using (
  private.is_admin() or (
    private.has_module_permission('trabajadores','update') and (
      owner_id = auth.uid() or private.has_resource_permission('trabajadores',id::text,'update') or (obra_id is not null and private.has_obra_permission(obra_id,'update'))
    )
  )
) with check (
  private.is_admin() or (
    private.has_module_permission('trabajadores','update') and updated_by = auth.uid() and (
      owner_id = auth.uid() or private.has_resource_permission('trabajadores',id::text,'update') or (obra_id is not null and private.has_obra_permission(obra_id,'update'))
    )
  )
);

drop policy if exists trabajadores_delete on public.trabajadores;
create policy trabajadores_delete on public.trabajadores for delete to authenticated using (
  private.is_admin() or (
    private.has_module_permission('trabajadores','delete') and (
      owner_id = auth.uid() or private.has_resource_permission('trabajadores',id::text,'delete') or (obra_id is not null and private.has_obra_permission(obra_id,'delete'))
    )
  )
);

drop policy if exists trash_select on public.trash;
create policy trash_select on public.trash for select to authenticated using (
  private.is_admin() or (
    private.has_module_permission('trabajadores','read') and (
      owner_id = auth.uid() or private.has_resource_permission('trabajadores',id::text,'read')
    )
  )
);

drop policy if exists trash_update on public.trash;
create policy trash_update on public.trash for update to authenticated using (
  private.is_admin() or (
    private.has_module_permission('trabajadores','update') and (
      owner_id = auth.uid() or private.has_resource_permission('trabajadores',id::text,'update')
    )
  )
) with check (
  private.is_admin() or (
    private.has_module_permission('trabajadores','update') and updated_by = auth.uid() and (
      owner_id = auth.uid() or private.has_resource_permission('trabajadores',id::text,'update')
    )
  )
);

drop policy if exists trash_delete on public.trash;
create policy trash_delete on public.trash for delete to authenticated using (
  private.is_admin() or (
    private.has_module_permission('trabajadores','delete') and (
      owner_id = auth.uid() or private.has_resource_permission('trabajadores',id::text,'delete')
    )
  )
);
