-- Corrección y eliminación auditada de movimientos de inventario.
-- Mantiene trazabilidad interna aunque el usuario corrija errores de captura.

create table if not exists public.inventory_movement_audit (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null,
  park_id uuid not null references public.inventory_parks(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  action text not null check (action in ('update','delete')),
  snapshot jsonb not null,
  changed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists inventory_movement_audit_item_idx
  on public.inventory_movement_audit(item_id, created_at desc);

alter table public.inventory_movement_audit enable row level security;

drop policy if exists inventory_movement_audit_select on public.inventory_movement_audit;
create policy inventory_movement_audit_select on public.inventory_movement_audit
for select to authenticated
using (private.inventory_is_member(park_id,false));

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
  select * into v_move from public.inventory_movements where id = p_movement_id for update;
  if v_move.id is null then raise exception 'Movimiento no encontrado'; end if;
  if not private.inventory_is_member(v_move.park_id,true) then raise exception 'Sin permisos para corregir este movimiento'; end if;

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

  select * into v_latest from public.inventory_movements where item_id = v_move.item_id order by created_at desc limit 1;
  if v_latest.id is not null then
    update public.inventory_items
       set ubicacion_actual = v_latest.destino,
           estado = coalesce(v_latest.estado_nuevo, estado),
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
  select * into v_move from public.inventory_movements where id = p_movement_id for update;
  if v_move.id is null then raise exception 'Movimiento no encontrado'; end if;
  if not private.inventory_is_member(v_move.park_id,true) then raise exception 'Sin permisos para eliminar este movimiento'; end if;

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

  select * into v_latest from public.inventory_movements where item_id = v_move.item_id order by created_at desc limit 1;
  if v_latest.id is not null then
    update public.inventory_items
       set ubicacion_actual = v_latest.destino,
           estado = coalesce(v_latest.estado_nuevo, estado),
           updated_by = (select auth.uid())
     where id = v_move.item_id;
  else
    select * into v_park from public.inventory_parks where id = v_move.park_id;
    update public.inventory_items
       set ubicacion_actual = concat(v_park.nombre,' (',v_park.zona,')'),
           estado = 'Disponible',
           updated_by = (select auth.uid())
     where id = v_move.item_id;
  end if;

  return jsonb_build_object('ok',true,'movement_id',p_movement_id);
end;
$$;

grant execute on function public.inventory_update_movement(uuid,text,text,text,text,numeric,numeric,jsonb) to authenticated;
grant execute on function public.inventory_delete_movement(uuid) to authenticated;
