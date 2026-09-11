-- Retira dependencias relacionales de public.users y consolida profiles como perfil de aplicación.

alter table public.user_permissions drop constraint if exists user_permissions_user_id_fkey;
alter table public.user_permissions add constraint user_permissions_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.workers drop constraint if exists workers_owner_id_fkey;
alter table public.workers add constraint workers_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade;

alter table public.trash drop constraint if exists trash_owner_id_fkey;
alter table public.trash add constraint trash_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade;

alter table public.user_settings drop constraint if exists user_settings_user_id_fkey;
alter table public.user_settings add constraint user_settings_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.data_permissions drop constraint if exists data_permissions_owner_id_fkey;
alter table public.data_permissions add constraint data_permissions_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade;
alter table public.data_permissions drop constraint if exists data_permissions_user_id_fkey;
alter table public.data_permissions add constraint data_permissions_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.obras drop constraint if exists obras_owner_id_fkey;
alter table public.obras add constraint obras_owner_id_fkey foreign key (owner_id) references public.profiles(id);

alter table public.user_obras drop constraint if exists user_obras_user_id_fkey;
alter table public.user_obras add constraint user_obras_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade;

create or replace function private.has_resource_permission(p_resource_type text, p_resource_id text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin() or exists (
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
