-- Preserve the recorder separately from the supervisor actually using the equipment.
-- Historical movements are intentionally not backfilled.
alter table public.inventory_movements add column if not exists responsable_id uuid references public.profiles(id);

create or replace function public.inventory_register_usage_movement(
  p_item_id uuid,p_tipo text,p_destino text,p_estado_nuevo text,p_obra_id uuid,
  p_observaciones text,p_latitud numeric,p_longitud numeric,p_foto_paths jsonb,
  p_responsable_id uuid,p_movement_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_item public.inventory_items%rowtype;
  v_existing public.inventory_movements%rowtype;
  v_responsible uuid;
  v_name text;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  select * into v_item from public.inventory_items where id=p_item_id for update;
  if v_item.id is null then raise exception 'Equipo no encontrado'; end if;
  if not private.inventory_is_member(v_item.park_id,true) then raise exception 'Sin permisos para registrar movimientos'; end if;
  if not v_item.activo then raise exception 'El equipo está dado de baja'; end if;
  if nullif(trim(p_tipo),'') is null or nullif(trim(p_destino),'') is null or p_estado_nuevo not in ('Disponible','Asignada a obra','En traslado','En uso','Averiada','En reparación','Pendiente de revisión','Fuera de servicio','Baja') or p_estado_nuevo is null then
    raise exception 'Indica un destino y estado válidos';
  end if;
  if p_estado_nuevo in ('Asignada a obra','En traslado','En uso') then
    v_responsible := p_responsable_id;
    if v_responsible is null then raise exception 'Selecciona quién está usando el equipo'; end if;
    if not exists (
      select 1 from profiles pr where pr.id=v_responsible and pr.active=true and (
        pr.id=(select created_by from inventory_parks where id=v_item.park_id)
        or exists(select 1 from inventory_park_members m where m.park_id=v_item.park_id and m.user_id=pr.id and m.active=true)
      )
    ) then raise exception 'El responsable no tiene acceso aceptado a este parque'; end if;
  end if;
  if p_movement_id is null then raise exception 'Falta el identificador del movimiento'; end if;
  select * into v_existing from inventory_movements where id=p_movement_id;
  if v_existing.id is not null then
    if v_existing.item_id=p_item_id and v_existing.created_by=auth.uid()
      and v_existing.tipo=p_tipo and v_existing.destino=p_destino and v_existing.estado_nuevo=p_estado_nuevo
      and v_existing.responsable_id is not distinct from v_responsible
      and v_existing.obra_id is not distinct from p_obra_id
      and v_existing.observaciones is not distinct from p_observaciones
      and v_existing.latitud is not distinct from p_latitud and v_existing.longitud is not distinct from p_longitud
      and v_existing.foto_paths=coalesce(p_foto_paths,'[]'::jsonb)
    then return v_existing.id; end if;
    raise exception 'El movimiento ya fue guardado con otros datos. Actualiza el parque antes de continuar';
  end if;
  select trim(concat_ws(' ',nombre,apellidos)) into v_name from profiles where id=auth.uid();
  insert into inventory_movements(id,park_id,item_id,tipo,origen,destino,obra_id,estado_anterior,estado_nuevo,observaciones,latitud,longitud,foto_paths,created_by,created_by_name,responsable_id,created_at)
  values(p_movement_id,v_item.park_id,v_item.id,p_tipo,v_item.ubicacion_actual,p_destino,p_obra_id,v_item.estado,p_estado_nuevo,p_observaciones,p_latitud,p_longitud,coalesce(p_foto_paths,'[]'::jsonb),auth.uid(),coalesce(v_name,''),v_responsible,clock_timestamp());
  update inventory_items set ubicacion_actual=p_destino,obra_actual_id=p_obra_id,estado=p_estado_nuevo,
    responsable_actual=v_responsible,updated_by=auth.uid(),updated_at=now() where id=v_item.id;
  return p_movement_id;
end;
$$;
revoke all on function public.inventory_register_usage_movement(uuid,text,text,text,uuid,text,numeric,numeric,jsonb,uuid,uuid) from public,anon;
grant execute on function public.inventory_register_usage_movement(uuid,text,text,text,uuid,text,numeric,numeric,jsonb,uuid,uuid) to authenticated;

-- Existing clients/offline queues keep working; new clients explicitly choose the user.
create or replace function public.inventory_register_movement(
  p_item_id uuid,p_tipo text,p_destino text,p_estado_nuevo text,p_obra_id uuid default null,
  p_observaciones text default '',p_latitud numeric default null,p_longitud numeric default null,p_foto_paths jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
begin
  return public.inventory_register_usage_movement(p_item_id,p_tipo,p_destino,p_estado_nuevo,p_obra_id,p_observaciones,p_latitud,p_longitud,p_foto_paths,auth.uid(),gen_random_uuid());
end;
$$;
revoke all on function public.inventory_register_movement(uuid,text,text,text,uuid,text,numeric,numeric,jsonb) from public,anon;
grant execute on function public.inventory_register_movement(uuid,text,text,text,uuid,text,numeric,numeric,jsonb) to authenticated;

-- Corrections/deletions must restore the actual user, never the editor of the history.
create or replace function public.inventory_update_movement(
  p_movement_id uuid,
  p_tipo text,
  p_destino text,
  p_estado_nuevo text,
  p_observaciones text default '',
  p_latitud numeric default null,
  p_longitud numeric default null,
  p_foto_paths jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_move public.inventory_movements%rowtype;
  v_latest public.inventory_movements%rowtype;
  v_park public.inventory_parks%rowtype;
begin
  select * into v_move from public.inventory_movements where id = p_movement_id;
  if v_move.id is null then raise exception 'Movimiento no encontrado'; end if;
  if not private.inventory_is_member(v_move.park_id,true) then raise exception 'Sin permisos para corregir este movimiento'; end if;
  perform 1 from public.inventory_items where id=v_move.item_id for update;
  select * into v_move from public.inventory_movements where id=p_movement_id for update;
  if v_move.id is null then raise exception 'Movimiento no encontrado'; end if;

  insert into public.inventory_movement_audit(movement_id,park_id,item_id,action,snapshot,changed_by)
  values (v_move.id,v_move.park_id,v_move.item_id,'update',to_jsonb(v_move),(select auth.uid()));

  update public.inventory_movements
  set tipo = coalesce(nullif(trim(p_tipo),''), tipo),
      destino = coalesce(nullif(trim(p_destino),''), destino),
      estado_nuevo = coalesce(nullif(trim(p_estado_nuevo),''), estado_nuevo),
      observaciones = coalesce(p_observaciones,''),
      latitud = p_latitud,
      longitud = p_longitud,
      foto_paths = coalesce(p_foto_paths,'[]'::jsonb)
  where id = p_movement_id;

  -- El origen del movimiento inmediatamente posterior debe coincidir con el destino corregido.
  update public.inventory_movements m
     set origen = coalesce(nullif(trim(p_destino),''), v_move.destino)
   where m.id = (
     select id from public.inventory_movements
      where item_id = v_move.item_id and created_at > v_move.created_at
      order by created_at asc limit 1
   );

  select * into v_latest from public.inventory_movements where item_id = v_move.item_id order by created_at desc,id desc limit 1;
  if v_latest.id is not null then
    update public.inventory_items
       set ubicacion_actual = v_latest.destino,
           estado = coalesce(v_latest.estado_nuevo, estado),
           responsable_actual = case when v_latest.estado_nuevo in ('Asignada a obra','En traslado','En uso') and exists(select 1 from profiles pr where pr.id=v_latest.responsable_id and pr.active=true and (pr.id=(select created_by from inventory_parks where id=v_latest.park_id) or exists(select 1 from inventory_park_members m where m.park_id=v_latest.park_id and m.user_id=pr.id and m.active=true))) then v_latest.responsable_id else null end,
           updated_at = now(),
           updated_by = (select auth.uid())
     where id = v_move.item_id;
  end if;

  return jsonb_build_object('ok',true,'movement_id',p_movement_id);
end;
$$;

create or replace function public.inventory_delete_movement(p_movement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_move public.inventory_movements%rowtype;
  v_latest public.inventory_movements%rowtype;
  v_park public.inventory_parks%rowtype;
begin
  select * into v_move from public.inventory_movements where id = p_movement_id;
  if v_move.id is null then raise exception 'Movimiento no encontrado'; end if;
  if not private.inventory_is_member(v_move.park_id,true) then raise exception 'Sin permisos para eliminar este movimiento'; end if;
  perform 1 from public.inventory_items where id=v_move.item_id for update;
  select * into v_move from public.inventory_movements where id=p_movement_id for update;
  if v_move.id is null then raise exception 'Movimiento no encontrado'; end if;

  insert into public.inventory_movement_audit(movement_id,park_id,item_id,action,snapshot,changed_by)
  values (v_move.id,v_move.park_id,v_move.item_id,'delete',to_jsonb(v_move),(select auth.uid()));

  -- Si existe un movimiento posterior, hereda el origen real anterior al registro eliminado.
  update public.inventory_movements m
     set origen = v_move.origen
   where m.id = (
     select id from public.inventory_movements
      where item_id = v_move.item_id and created_at > v_move.created_at
      order by created_at asc limit 1
   );

  delete from public.inventory_movements where id = p_movement_id;

  select * into v_latest from public.inventory_movements where item_id = v_move.item_id order by created_at desc,id desc limit 1;
  if v_latest.id is not null then
    update public.inventory_items
       set ubicacion_actual = v_latest.destino,
           estado = coalesce(v_latest.estado_nuevo, estado),
           responsable_actual = case when v_latest.estado_nuevo in ('Asignada a obra','En traslado','En uso') and exists(select 1 from profiles pr where pr.id=v_latest.responsable_id and pr.active=true and (pr.id=(select created_by from inventory_parks where id=v_latest.park_id) or exists(select 1 from inventory_park_members m where m.park_id=v_latest.park_id and m.user_id=pr.id and m.active=true))) then v_latest.responsable_id else null end,
           updated_at = now(),
           updated_by = (select auth.uid())
     where id = v_move.item_id;
  else
    select * into v_park from public.inventory_parks where id = v_move.park_id;
    update public.inventory_items
       set ubicacion_actual = concat(v_park.nombre,' (',v_park.zona,')'),
           estado = 'Disponible',
           responsable_actual = null,
           updated_at = now(),
           updated_by = (select auth.uid())
     where id = v_move.item_id;
  end if;

  return jsonb_build_object('ok',true,'movement_id',p_movement_id);
end;
$$;


revoke all on function public.inventory_update_movement(uuid,text,text,text,text,numeric,numeric,jsonb) from public,anon;
grant execute on function public.inventory_update_movement(uuid,text,text,text,text,numeric,numeric,jsonb) to authenticated;
revoke all on function public.inventory_delete_movement(uuid) from public,anon;
grant execute on function public.inventory_delete_movement(uuid) to authenticated;

-- Apply the same invariant to direct edits/imports, which still use table RLS.
create or replace function private.inventory_guard_responsible()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.estado not in ('Asignada a obra','En traslado','En uso') then
    new.responsable_actual := null;
  elsif new.responsable_actual is not null and (tg_op='INSERT' or new.responsable_actual is distinct from old.responsable_actual or new.park_id is distinct from old.park_id) then
    if not exists(select 1 from profiles pr where pr.id=new.responsable_actual and pr.active=true and (
      pr.id=(select created_by from inventory_parks where id=new.park_id)
      or exists(select 1 from inventory_park_members m where m.park_id=new.park_id and m.user_id=pr.id and m.active=true)
    )) then raise exception 'El responsable no tiene acceso aceptado a este parque'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.inventory_guard_responsible() from public,anon,authenticated;
drop trigger if exists inventory_guard_responsible on public.inventory_items;
create trigger inventory_guard_responsible before insert or update of estado,responsable_actual,park_id
on public.inventory_items for each row execute function private.inventory_guard_responsible();

