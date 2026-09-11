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
      )
      and case p_action
        when 'read' then dp.can_read
        when 'update' then dp.can_update
        when 'delete' then dp.can_delete
        else false
      end
  );
$$;

create or replace function private.has_related_resource_permission(
  p_resource_type text,
  p_resource_id text,
  p_obra_id uuid,
  p_obra_key text,
  p_trabajador_id bigint,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select private.is_admin()
    or private.has_resource_permission(p_resource_type, p_resource_id, p_action)
    or private.has_obra_permission(p_obra_id, p_obra_key, p_action)
    or (
      p_trabajador_id is not null
      and private.has_resource_permission('trabajadores', p_trabajador_id::text, p_action)
    )
    or (
      p_trabajador_id is not null
      and exists (
        select 1
        from public.trabajadores t
        where t.id = p_trabajador_id
          and private.has_obra_permission(t.obra_id, t.obra, p_action)
      )
    );
$$;

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
set search_path to ''
as $$
  select private.is_admin()
    or (
      private.has_module_permission(p_module, p_action)
      and (
        p_owner_id = (select auth.uid())
        or private.has_related_resource_permission(
          p_resource_type,
          p_resource_id,
          p_obra_id,
          p_obra_key,
          p_trabajador_id,
          p_action
        )
      )
    );
$$;

revoke all on function private.has_obra_permission(uuid,text,text) from public;
revoke all on function private.has_related_resource_permission(text,text,uuid,text,bigint,text) from public;
revoke all on function private.can_access_related_row(text,text,text,uuid,uuid,text,bigint,text) from public;
grant execute on function private.has_obra_permission(uuid,text,text) to authenticated;
grant execute on function private.has_related_resource_permission(text,text,uuid,text,bigint,text) to authenticated;
grant execute on function private.can_access_related_row(text,text,text,uuid,uuid,text,bigint,text) to authenticated;

drop policy if exists trabajadores_select on public.trabajadores;
create policy trabajadores_select on public.trabajadores for select using (
  private.can_access_related_row('trabajadores','trabajadores',id::text,owner_id,obra_id,obra,id,'read')
);
drop policy if exists trabajadores_update on public.trabajadores;
create policy trabajadores_update on public.trabajadores for update using (
  private.can_access_related_row('trabajadores','trabajadores',id::text,owner_id,obra_id,obra,id,'update')
) with check (
  private.can_access_related_row('trabajadores','trabajadores',id::text,owner_id,obra_id,obra,id,'update')
);
drop policy if exists trabajadores_delete on public.trabajadores;
create policy trabajadores_delete on public.trabajadores for delete using (
  private.can_access_related_row('trabajadores','trabajadores',id::text,owner_id,obra_id,obra,id,'delete')
);

drop policy if exists obras_select on public.obras;
create policy obras_select on public.obras for select using (
  private.can_access_related_row('obras','obra',id::text,owner_id,id,coalesce(nullif(nombre,''),codigo),null,'read')
);
drop policy if exists obras_update on public.obras;
create policy obras_update on public.obras for update using (
  private.can_access_related_row('obras','obra',id::text,owner_id,id,coalesce(nullif(nombre,''),codigo),null,'update')
) with check (
  private.can_access_related_row('obras','obra',id::text,owner_id,id,coalesce(nullif(nombre,''),codigo),null,'update')
);
drop policy if exists obras_delete on public.obras;
create policy obras_delete on public.obras for delete using (
  private.can_access_related_row('obras','obra',id::text,owner_id,id,coalesce(nullif(nombre,''),codigo),null,'delete')
);

drop policy if exists citas_select on public.citas;
create policy citas_select on public.citas for select using (
  private.can_access_related_row('citas','citas',id,owner_id,obra_id,coalesce(data->>'obra',''),trabajador_id,'read')
);
drop policy if exists citas_update on public.citas;
create policy citas_update on public.citas for update using (
  private.can_access_related_row('citas','citas',id,owner_id,obra_id,coalesce(data->>'obra',''),trabajador_id,'update')
) with check (
  private.can_access_related_row('citas','citas',id,owner_id,obra_id,coalesce(data->>'obra',''),trabajador_id,'update')
);
drop policy if exists citas_delete on public.citas;
create policy citas_delete on public.citas for delete using (
  private.can_access_related_row('citas','citas',id,owner_id,obra_id,coalesce(data->>'obra',''),trabajador_id,'delete')
);

drop policy if exists reconocimientos_select on public.reconocimientos;
create policy reconocimientos_select on public.reconocimientos for select using (
  private.can_access_related_row('reconocimientos','reconocimientos',id,owner_id,obra_id,coalesce(data->>'obra',''),trabajador_id,'read')
);
drop policy if exists reconocimientos_update on public.reconocimientos;
create policy reconocimientos_update on public.reconocimientos for update using (
  private.can_access_related_row('reconocimientos','reconocimientos',id,owner_id,obra_id,coalesce(data->>'obra',''),trabajador_id,'update')
) with check (
  private.can_access_related_row('reconocimientos','reconocimientos',id,owner_id,obra_id,coalesce(data->>'obra',''),trabajador_id,'update')
);
drop policy if exists reconocimientos_delete on public.reconocimientos;
create policy reconocimientos_delete on public.reconocimientos for delete using (
  private.can_access_related_row('reconocimientos','reconocimientos',id,owner_id,obra_id,coalesce(data->>'obra',''),trabajador_id,'delete')
);

drop policy if exists subcontratas_select on public.subcontratas;
create policy subcontratas_select on public.subcontratas for select using (
  private.can_access_related_row('subcontratas','subcontratas',id,owner_id,obra_id,coalesce(data->>'obra',''),null,'read')
);
drop policy if exists subcontratas_update on public.subcontratas;
create policy subcontratas_update on public.subcontratas for update using (
  private.can_access_related_row('subcontratas','subcontratas',id,owner_id,obra_id,coalesce(data->>'obra',''),null,'update')
) with check (
  private.can_access_related_row('subcontratas','subcontratas',id,owner_id,obra_id,coalesce(data->>'obra',''),null,'update')
);
drop policy if exists subcontratas_delete on public.subcontratas;
create policy subcontratas_delete on public.subcontratas for delete using (
  private.can_access_related_row('subcontratas','subcontratas',id,owner_id,obra_id,coalesce(data->>'obra',''),null,'delete')
);

drop policy if exists contrataciones_select on public.contrataciones;
create policy contrataciones_select on public.contrataciones for select using (
  private.can_access_related_row('contratacion','contrataciones',id,owner_id,obra_id,coalesce(data->>'obra',''),trabajador_id,'read')
);
drop policy if exists contrataciones_update on public.contrataciones;
create policy contrataciones_update on public.contrataciones for update using (
  private.can_access_related_row('contratacion','contrataciones',id,owner_id,obra_id,coalesce(data->>'obra',''),trabajador_id,'update')
) with check (
  private.can_access_related_row('contratacion','contrataciones',id,owner_id,obra_id,coalesce(data->>'obra',''),trabajador_id,'update')
);
drop policy if exists contrataciones_delete on public.contrataciones;
create policy contrataciones_delete on public.contrataciones for delete using (
  private.can_access_related_row('contratacion','contrataciones',id,owner_id,obra_id,coalesce(data->>'obra',''),trabajador_id,'delete')
);

drop policy if exists subcontrata_documentos_select on public.subcontrata_documentos;
create policy subcontrata_documentos_select on public.subcontrata_documentos for select using (
  exists (
    select 1 from public.subcontratas s
    where s.id = subcontrata_documentos.subcontrata_id
      and private.can_access_related_row('subcontratas','subcontratas',s.id,s.owner_id,s.obra_id,coalesce(s.data->>'obra',''),null,'read')
  )
);
drop policy if exists subcontrata_documentos_insert on public.subcontrata_documentos;
create policy subcontrata_documentos_insert on public.subcontrata_documentos for insert with check (
  exists (
    select 1 from public.subcontratas s
    where s.id = subcontrata_documentos.subcontrata_id
      and private.can_access_related_row('subcontratas','subcontratas',s.id,s.owner_id,s.obra_id,coalesce(s.data->>'obra',''),null,'update')
  )
);
drop policy if exists subcontrata_documentos_update on public.subcontrata_documentos;
create policy subcontrata_documentos_update on public.subcontrata_documentos for update using (
  exists (
    select 1 from public.subcontratas s
    where s.id = subcontrata_documentos.subcontrata_id
      and private.can_access_related_row('subcontratas','subcontratas',s.id,s.owner_id,s.obra_id,coalesce(s.data->>'obra',''),null,'update')
  )
) with check (
  exists (
    select 1 from public.subcontratas s
    where s.id = subcontrata_documentos.subcontrata_id
      and private.can_access_related_row('subcontratas','subcontratas',s.id,s.owner_id,s.obra_id,coalesce(s.data->>'obra',''),null,'update')
  )
);
drop policy if exists subcontrata_documentos_delete on public.subcontrata_documentos;
create policy subcontrata_documentos_delete on public.subcontrata_documentos for delete using (
  exists (
    select 1 from public.subcontratas s
    where s.id = subcontrata_documentos.subcontrata_id
      and private.can_access_related_row('subcontratas','subcontratas',s.id,s.owner_id,s.obra_id,coalesce(s.data->>'obra',''),null,'update')
  )
);
