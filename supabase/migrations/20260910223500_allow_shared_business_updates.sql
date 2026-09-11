-- Permite que los usuarios con permiso explícito de actualización sobre un recurso
-- puedan modificarlo sin convertirse en propietarios. El owner_id permanece bloqueado
-- por los triggers de sellado y la autorización sigue exigiendo permisos de módulo.

drop policy if exists citas_update on public.citas;
create policy citas_update on public.citas for update to authenticated
using (private.can_access_business_row('citas','citas',id,owner_id,obra_id,'update'))
with check (private.can_access_business_row('citas','citas',id,owner_id,obra_id,'update'));

drop policy if exists reconocimientos_update on public.reconocimientos;
create policy reconocimientos_update on public.reconocimientos for update to authenticated
using (private.can_access_business_row('reconocimientos','reconocimientos',id,owner_id,obra_id,'update'))
with check (private.can_access_business_row('reconocimientos','reconocimientos',id,owner_id,obra_id,'update'));

drop policy if exists subcontratas_update on public.subcontratas;
create policy subcontratas_update on public.subcontratas for update to authenticated
using (private.can_access_business_row('subcontratas','subcontratas',id,owner_id,obra_id,'update'))
with check (private.can_access_business_row('subcontratas','subcontratas',id,owner_id,obra_id,'update'));

drop policy if exists contrataciones_update on public.contrataciones;
create policy contrataciones_update on public.contrataciones for update to authenticated
using (private.can_access_business_row('contratacion','contrataciones',id,owner_id,obra_id,'update'))
with check (private.can_access_business_row('contratacion','contrataciones',id,owner_id,obra_id,'update'));
