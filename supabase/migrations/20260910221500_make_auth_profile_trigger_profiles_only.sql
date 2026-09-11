-- El alta de usuarios de Auth crea únicamente el perfil de aplicación en profiles.
-- Se elimina el trigger duplicado heredado que mantenía public.users.

drop trigger if exists on_auth_user_created on auth.users;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  insert into public.profiles (id, email, nombre, apellidos, role, active, created_at, updated_at)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'nombre', ''),
    coalesce(new.raw_user_meta_data ->> 'apellidos', ''),
    'user'::public.app_role,
    true,
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    nombre = case when public.profiles.nombre = '' then excluded.nombre else public.profiles.nombre end,
    apellidos = case when public.profiles.apellidos = '' then excluded.apellidos else public.profiles.apellidos end,
    updated_at = now();

  insert into public.user_permissions(user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;
