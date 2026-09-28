-- Optimiza la lectura del Directorio sin modificar el modelo de permisos.
create index if not exists trabajadores_owner_updated_idx
  on public.trabajadores(owner_id, updated_at desc);

drop policy if exists trabajadores_select on public.trabajadores;
create policy trabajadores_select
on public.trabajadores
for select
to authenticated
using (
  (select private.has_module_permission('trabajadores','read'))
  and (
    owner_id = (select auth.uid())
    or private.has_explicit_resource_permission('trabajadores', id::text, owner_id, 'read')
  )
);
