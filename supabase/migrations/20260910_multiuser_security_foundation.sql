-- Multi-user security foundation. Applied to production on 2026-09-10.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  nombre text not null default '',
  apellidos text not null default '',
  role public.app_role not null default 'user',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  last_access_at timestamptz null,
  updated_at timestamptz not null default now()
);

insert into public.profiles (id,email,nombre,apellidos,role,active,created_at,created_by,last_access_at,updated_at)
select id,email,nombre,apellidos,role,active,created_at,created_by,last_access_at,updated_at from public.users
on conflict (id) do update set email=excluded.email,nombre=excluded.nombre,apellidos=excluded.apellidos,role=excluded.role,active=excluded.active,created_by=excluded.created_by,last_access_at=excluded.last_access_at,updated_at=excluded.updated_at;

alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id=(select auth.uid()) or (select private.is_admin()));
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check ((select private.is_admin()));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated using ((select private.is_admin()) and id<>(select auth.uid()));

create or replace function public.sync_users_to_profiles() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,nombre,apellidos,role,active,created_at,created_by,last_access_at,updated_at)
  values(new.id,new.email,new.nombre,new.apellidos,new.role,new.active,new.created_at,new.created_by,new.last_access_at,new.updated_at)
  on conflict(id) do update set email=excluded.email,nombre=excluded.nombre,apellidos=excluded.apellidos,role=excluded.role,active=excluded.active,created_by=excluded.created_by,last_access_at=excluded.last_access_at,updated_at=excluded.updated_at;
  return new;
end; $$;

drop trigger if exists trg_sync_users_to_profiles on public.users;
create trigger trg_sync_users_to_profiles after insert or update on public.users for each row execute function public.sync_users_to_profiles();

-- New Auth users are never promoted automatically. The initial admin is provisioned explicitly.
create or replace function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.users(id,email,nombre,apellidos,role,active,created_at)
  values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'nombre',''),coalesce(new.raw_user_meta_data->>'apellidos',''),'user'::public.app_role,true,coalesce(new.created_at,now()))
  on conflict(id) do update set email=excluded.email;
  insert into public.user_permissions(user_id) values(new.id) on conflict(user_id) do nothing;
  return new;
end; $$;

create or replace function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true and p.role='admin');
$$;

create or replace function private.has_module_permission(p_module text,p_action text) returns boolean language sql stable security definer set search_path='' as $$
  select private.is_admin() or exists(
    select 1 from public.user_permissions up join public.profiles p on p.id=up.user_id
    where up.user_id=(select auth.uid()) and p.active=true and coalesce((up.modules->p_module->>p_action)::boolean,false)
  );
$$;

create or replace function private.has_resource_permission(p_resource_type text,p_resource_id text,p_action text) returns boolean language sql stable security definer set search_path='' as $$
  select private.is_admin() or exists(
    select 1 from public.data_permissions dp join public.profiles p on p.id=dp.user_id
    where dp.resource_type=p_resource_type and dp.resource_id=p_resource_id and dp.user_id=(select auth.uid()) and p.active=true
      and case p_action when 'read' then dp.can_read when 'update' then dp.can_update when 'delete' then dp.can_delete else false end
  );
$$;

alter table public.data_permissions add column if not exists created_by uuid null references auth.users(id);
create unique index if not exists data_permissions_unique_resource_user on public.data_permissions(resource_type,resource_id,owner_id,user_id);
create index if not exists data_permissions_user_idx on public.data_permissions(user_id);
create index if not exists data_permissions_owner_idx on public.data_permissions(owner_id);
create index if not exists data_permissions_resource_idx on public.data_permissions(resource_type,resource_id);

create or replace function public.set_permission_creator() returns trigger language plpgsql security invoker set search_path=public as $$
begin if auth.uid() is not null then new.created_by:=auth.uid(); end if; return new; end; $$;
drop trigger if exists trg_data_permissions_creator on public.data_permissions;
create trigger trg_data_permissions_creator before insert on public.data_permissions for each row execute function public.set_permission_creator();

create table if not exists public.obras (
  id uuid primary key default gen_random_uuid(), codigo text null, nombre text not null, municipio text null, descripcion text null,
  owner_id uuid not null references public.users(id), created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create index if not exists obras_owner_idx on public.obras(owner_id);
create unique index if not exists obras_codigo_unique on public.obras(codigo) where codigo is not null and codigo<>'';

create table if not exists public.user_obras (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  obra_id uuid not null references public.obras(id) on delete cascade,
  can_read boolean not null default true, can_create boolean not null default true, can_update boolean not null default true, can_delete boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid not null references auth.users(id), unique(user_id,obra_id)
);
create index if not exists user_obras_user_idx on public.user_obras(user_id);
create index if not exists user_obras_obra_idx on public.user_obras(obra_id);
alter table public.obras enable row level security;
alter table public.user_obras enable row level security;

create or replace function private.has_obra_permission(p_obra_id uuid,p_action text) returns boolean language sql stable security definer set search_path='' as $$
  select private.is_admin() or exists(
    select 1 from public.user_obras uo join public.profiles p on p.id=uo.user_id
    where uo.obra_id=p_obra_id and uo.user_id=(select auth.uid()) and p.active=true
      and case p_action when 'read' then uo.can_read when 'create' then uo.can_create when 'update' then uo.can_update when 'delete' then uo.can_delete else false end
  );
$$;

drop policy if exists user_obras_select on public.user_obras;
create policy user_obras_select on public.user_obras for select to authenticated using(user_id=(select auth.uid()) or (select private.is_admin()));
drop policy if exists user_obras_insert on public.user_obras;
create policy user_obras_insert on public.user_obras for insert to authenticated with check((select private.is_admin()) and created_by=(select auth.uid()));
drop policy if exists user_obras_update on public.user_obras;
create policy user_obras_update on public.user_obras for update to authenticated using((select private.is_admin())) with check((select private.is_admin()));
drop policy if exists user_obras_delete on public.user_obras;
create policy user_obras_delete on public.user_obras for delete to authenticated using((select private.is_admin()));

drop policy if exists obras_select on public.obras;
create policy obras_select on public.obras for select to authenticated using((select private.has_module_permission('obras','read')) and (owner_id=(select auth.uid()) or (select private.has_obra_permission(obras.id,'read')) or (select private.has_resource_permission('obra',obras.id::text,'read'))));
drop policy if exists obras_insert on public.obras;
create policy obras_insert on public.obras for insert to authenticated with check(owner_id=(select auth.uid()) and created_by=(select auth.uid()) and updated_by=(select auth.uid()) and (select private.has_module_permission('obras','create')));
drop policy if exists obras_update on public.obras;
create policy obras_update on public.obras for update to authenticated using((select private.has_module_permission('obras','update')) and (owner_id=(select auth.uid()) or (select private.has_obra_permission(obras.id,'update')) or (select private.has_resource_permission('obra',obras.id::text,'update')))) with check((select private.has_module_permission('obras','update')) and (owner_id=(select auth.uid()) or (select private.has_obra_permission(obras.id,'update')) or (select private.has_resource_permission('obra',obras.id::text,'update'))) and updated_by=(select auth.uid()));
drop policy if exists obras_delete on public.obras;
create policy obras_delete on public.obras for delete to authenticated using((select private.has_module_permission('obras','delete')) and (owner_id=(select auth.uid()) or (select private.has_obra_permission(obras.id,'delete')) or (select private.has_resource_permission('obra',obras.id::text,'delete'))));

-- Module permission is mandatory for worker owner and shared access.
drop policy if exists workers_select on public.workers;
create policy workers_select on public.workers for select to authenticated using((select private.has_module_permission('trabajadores','read')) and (owner_id=(select auth.uid()) or (select private.has_resource_permission('trabajadores',workers.id::text,'read'))));
drop policy if exists workers_insert on public.workers;
create policy workers_insert on public.workers for insert to authenticated with check(owner_id=(select auth.uid()) and created_by=(select auth.uid()) and updated_by=(select auth.uid()) and (select private.has_module_permission('trabajadores','create')));
drop policy if exists workers_update on public.workers;
create policy workers_update on public.workers for update to authenticated using((select private.has_module_permission('trabajadores','update')) and (owner_id=(select auth.uid()) or (select private.has_resource_permission('trabajadores',workers.id::text,'update')))) with check((select private.has_module_permission('trabajadores','update')) and (owner_id=(select auth.uid()) or (select private.has_resource_permission('trabajadores',workers.id::text,'update'))) and updated_by=(select auth.uid()));
drop policy if exists workers_delete on public.workers;
create policy workers_delete on public.workers for delete to authenticated using((select private.has_module_permission('trabajadores','delete')) and (owner_id=(select auth.uid()) or (select private.has_resource_permission('trabajadores',workers.id::text,'delete'))));

create or replace function public.secure_business_metadata() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if auth.uid() is not null then
    if tg_op='INSERT' then new.owner_id:=auth.uid(); new.created_by:=auth.uid(); end if;
    new.updated_by:=auth.uid();
  end if;
  new.updated_at:=now(); return new;
end; $$;

drop trigger if exists trg_workers_metadata on public.workers;
create trigger trg_workers_metadata before insert or update on public.workers for each row execute function public.secure_business_metadata();
drop trigger if exists trg_trash_metadata on public.trash;
create trigger trg_trash_metadata before insert or update on public.trash for each row execute function public.secure_business_metadata();
drop trigger if exists trg_obras_metadata on public.obras;
create trigger trg_obras_metadata before insert or update on public.obras for each row execute function public.secure_business_metadata();

create or replace function public.audit_business_change() returns trigger language plpgsql security definer set search_path=public as $$
declare v_user_id uuid:=auth.uid(); v_email text:=''; v_resource_id text; v_details jsonb;
begin
  if v_user_id is not null then select coalesce(email,'') into v_email from public.profiles where id=v_user_id; end if;
  if tg_op='DELETE' then v_resource_id:=old.id::text; v_details:=jsonb_build_object('owner_id',old.owner_id); else v_resource_id:=new.id::text; v_details:=jsonb_build_object('owner_id',new.owner_id); end if;
  insert into public.audit_logs(user_id,user_email,action,resource_type,resource_id,details) values(v_user_id,v_email,tg_op,tg_table_name,v_resource_id,v_details);
  return coalesce(new,old);
end; $$;

drop trigger if exists trg_workers_audit on public.workers;
create trigger trg_workers_audit after insert or update or delete on public.workers for each row execute function public.audit_business_change();
drop trigger if exists trg_trash_audit on public.trash;
create trigger trg_trash_audit after insert or update or delete on public.trash for each row execute function public.audit_business_change();
drop trigger if exists trg_obras_audit on public.obras;
create trigger trg_obras_audit after insert or update or delete on public.obras for each row execute function public.audit_business_change();
