-- Shared inventory and traceability for Herramientas y maquinaria.
-- This migration is intentionally kept in the working branch until the feature is approved for deployment.

create table if not exists public.inventory_parks (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  zona text not null,
  descripcion text null,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists inventory_parks_name_zone_unique on public.inventory_parks (lower(nombre), lower(zona));

create table if not exists public.inventory_park_members (
  id uuid primary key default gen_random_uuid(),
  park_id uuid not null references public.inventory_parks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'responsable' check (role in ('responsable','consulta')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  unique (park_id,user_id)
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  park_id uuid not null references public.inventory_parks(id) on delete cascade,
  codigo text not null default '',
  categoria text not null default 'OTROS',
  nombre text not null,
  marca text null,
  modelo text null,
  numero_serie text null,
  matricula text null,
  cantidad integer not null default 1 check (cantidad > 0),
  tipo_gestion text not null default 'individual' check (tipo_gestion in ('individual','lote')),
  estado text not null default 'Disponible',
  ubicacion_actual text not null default 'Nave logística Antonio Ramos (Zona 6)',
  obra_actual_id uuid null references public.obras(id) on delete set null,
  responsable_actual uuid null references public.profiles(id) on delete set null,
  detalles jsonb not null default '{}'::jsonb,
  observaciones text null,
  activo boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create unique index if not exists inventory_items_code_unique on public.inventory_items(park_id,codigo) where codigo <> '';
create index if not exists inventory_items_park_idx on public.inventory_items(park_id);
create index if not exists inventory_items_status_idx on public.inventory_items(park_id,estado);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  park_id uuid not null references public.inventory_parks(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  tipo text not null,
  origen text not null,
  destino text not null,
  obra_id uuid null references public.obras(id) on delete set null,
  estado_anterior text null,
  estado_nuevo text null,
  observaciones text null,
  latitud numeric null,
  longitud numeric null,
  foto_paths jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id),
  created_by_name text null,
  created_at timestamptz not null default now()
);
create index if not exists inventory_movements_item_idx on public.inventory_movements(item_id,created_at desc);
create index if not exists inventory_movements_park_idx on public.inventory_movements(park_id,created_at desc);

create table if not exists public.inventory_maintenance (
  id uuid primary key default gen_random_uuid(),
  park_id uuid not null references public.inventory_parks(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  tipo text not null,
  fecha date not null,
  proxima_revision date null,
  proveedor text null,
  coste numeric(12,2) null,
  observaciones text null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists inventory_maintenance_item_idx on public.inventory_maintenance(item_id,fecha desc);

alter table public.inventory_parks enable row level security;
alter table public.inventory_park_members enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_maintenance enable row level security;

create or replace function private.inventory_is_member(p_park_id uuid, p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.inventory_park_members m
    join public.profiles p on p.id=m.user_id
    where m.park_id=p_park_id and m.user_id=(select auth.uid()) and m.active=true and p.active=true
      and (not p_write or m.role='responsable')
  );
$$;
revoke all on function private.inventory_is_member(uuid,boolean) from public;
grant execute on function private.inventory_is_member(uuid,boolean) to authenticated;

-- Parks: creator can bootstrap membership; members can read.
drop policy if exists inventory_parks_select on public.inventory_parks;
create policy inventory_parks_select on public.inventory_parks for select to authenticated
using (created_by=(select auth.uid()) or private.inventory_is_member(id,false));
drop policy if exists inventory_parks_insert on public.inventory_parks;
create policy inventory_parks_insert on public.inventory_parks for insert to authenticated
with check (created_by=(select auth.uid()));
drop policy if exists inventory_parks_update on public.inventory_parks;
create policy inventory_parks_update on public.inventory_parks for update to authenticated
using (created_by=(select auth.uid()) or private.inventory_is_member(id,true))
with check (created_by=(select auth.uid()) or private.inventory_is_member(id,true));

-- Memberships.
drop policy if exists inventory_members_select on public.inventory_park_members;
create policy inventory_members_select on public.inventory_park_members for select to authenticated
using (user_id=(select auth.uid()) or private.inventory_is_member(park_id,false));
drop policy if exists inventory_members_insert on public.inventory_park_members;
create policy inventory_members_insert on public.inventory_park_members for insert to authenticated
with check (
  (user_id=(select auth.uid()) and exists(select 1 from public.inventory_parks p where p.id=park_id and p.created_by=(select auth.uid())))
  or private.inventory_is_member(park_id,true)
);
drop policy if exists inventory_members_update on public.inventory_park_members;
create policy inventory_members_update on public.inventory_park_members for update to authenticated
using (private.inventory_is_member(park_id,true)) with check (private.inventory_is_member(park_id,true));
drop policy if exists inventory_members_delete on public.inventory_park_members;
create policy inventory_members_delete on public.inventory_park_members for delete to authenticated
using (private.inventory_is_member(park_id,true));

-- Shared park records.
drop policy if exists inventory_items_select on public.inventory_items;
create policy inventory_items_select on public.inventory_items for select to authenticated using (private.inventory_is_member(park_id,false));
drop policy if exists inventory_items_insert on public.inventory_items;
create policy inventory_items_insert on public.inventory_items for insert to authenticated with check (private.inventory_is_member(park_id,true) and created_by=(select auth.uid()) and updated_by=(select auth.uid()));
drop policy if exists inventory_items_update on public.inventory_items;
create policy inventory_items_update on public.inventory_items for update to authenticated using (private.inventory_is_member(park_id,true)) with check (private.inventory_is_member(park_id,true) and updated_by=(select auth.uid()));
drop policy if exists inventory_items_delete on public.inventory_items;
create policy inventory_items_delete on public.inventory_items for delete to authenticated using (private.inventory_is_member(park_id,true));

drop policy if exists inventory_movements_select on public.inventory_movements;
create policy inventory_movements_select on public.inventory_movements for select to authenticated using (private.inventory_is_member(park_id,false));
drop policy if exists inventory_movements_insert on public.inventory_movements;
create policy inventory_movements_insert on public.inventory_movements for insert to authenticated with check (private.inventory_is_member(park_id,true) and created_by=(select auth.uid()));

drop policy if exists inventory_maintenance_select on public.inventory_maintenance;
create policy inventory_maintenance_select on public.inventory_maintenance for select to authenticated using (private.inventory_is_member(park_id,false));
drop policy if exists inventory_maintenance_insert on public.inventory_maintenance;
create policy inventory_maintenance_insert on public.inventory_maintenance for insert to authenticated with check (private.inventory_is_member(park_id,true) and created_by=(select auth.uid()));
drop policy if exists inventory_maintenance_update on public.inventory_maintenance;
create policy inventory_maintenance_update on public.inventory_maintenance for update to authenticated using (private.inventory_is_member(park_id,true)) with check (private.inventory_is_member(park_id,true));
drop policy if exists inventory_maintenance_delete on public.inventory_maintenance;
create policy inventory_maintenance_delete on public.inventory_maintenance for delete to authenticated using (private.inventory_is_member(park_id,true));

create or replace function public.inventory_register_movement(
  p_item_id uuid,
  p_tipo text,
  p_destino text,
  p_estado_nuevo text,
  p_obra_id uuid default null,
  p_observaciones text default '',
  p_latitud numeric default null,
  p_longitud numeric default null,
  p_foto_paths jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_item public.inventory_items%rowtype;
  v_movement_id uuid;
  v_name text;
begin
  select * into v_item from public.inventory_items where id=p_item_id;
  if v_item.id is null then raise exception 'Equipo no encontrado'; end if;
  if not private.inventory_is_member(v_item.park_id,true) then raise exception 'Sin permisos para registrar movimientos'; end if;
  select trim(concat_ws(' ',nombre,apellidos)) into v_name from public.profiles where id=auth.uid();
  insert into public.inventory_movements(
    park_id,item_id,tipo,origen,destino,obra_id,estado_anterior,estado_nuevo,observaciones,latitud,longitud,foto_paths,created_by,created_by_name
  ) values (
    v_item.park_id,v_item.id,p_tipo,v_item.ubicacion_actual,p_destino,p_obra_id,v_item.estado,p_estado_nuevo,p_observaciones,p_latitud,p_longitud,coalesce(p_foto_paths,'[]'::jsonb),auth.uid(),coalesce(v_name,'')
  ) returning id into v_movement_id;
  update public.inventory_items set
    ubicacion_actual=p_destino,
    obra_actual_id=p_obra_id,
    estado=p_estado_nuevo,
    responsable_actual=auth.uid(),
    updated_by=auth.uid(),
    updated_at=now()
  where id=v_item.id;
  return v_movement_id;
end;
$$;
revoke all on function public.inventory_register_movement(uuid,text,text,text,uuid,text,numeric,numeric,jsonb) from public;
grant execute on function public.inventory_register_movement(uuid,text,text,text,uuid,text,numeric,numeric,jsonb) to authenticated;

create or replace function public.inventory_add_member_by_email(p_park_id uuid,p_email text)
returns text language plpgsql security definer set search_path=public as $$
declare v_user_id uuid; v_name text;
begin
  if not private.inventory_is_member(p_park_id,true) and not exists(select 1 from public.inventory_parks p where p.id=p_park_id and p.created_by=auth.uid()) then
    raise exception 'Sin permisos para compartir este parque';
  end if;
  select id,trim(concat_ws(' ',nombre,apellidos)) into v_user_id,v_name from public.profiles where lower(email)=lower(trim(p_email)) and active=true limit 1;
  if v_user_id is null then raise exception 'No existe un usuario activo con ese correo'; end if;
  insert into public.inventory_park_members(park_id,user_id,role,active,created_by)
  values(p_park_id,v_user_id,'responsable',true,auth.uid())
  on conflict(park_id,user_id) do update set role='responsable',active=true;
  return coalesce(v_name,p_email);
end;
$$;
revoke all on function public.inventory_add_member_by_email(uuid,text) from public;
grant execute on function public.inventory_add_member_by_email(uuid,text) to authenticated;

-- Private evidence photographs. Paths are park_id/item_id/filename.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('inventory-photos','inventory-photos',false,8388608,array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists inventory_photos_select on storage.objects;
create policy inventory_photos_select on storage.objects for select to authenticated
using (bucket_id='inventory-photos' and private.inventory_is_member(((storage.foldername(name))[1])::uuid,false));
drop policy if exists inventory_photos_insert on storage.objects;
create policy inventory_photos_insert on storage.objects for insert to authenticated
with check (bucket_id='inventory-photos' and private.inventory_is_member(((storage.foldername(name))[1])::uuid,true));
drop policy if exists inventory_photos_delete on storage.objects;
create policy inventory_photos_delete on storage.objects for delete to authenticated
using (bucket_id='inventory-photos' and private.inventory_is_member(((storage.foldername(name))[1])::uuid,true));
