-- profiles queda como única tabla de perfiles de aplicación.
-- public.users se conserva solo como vista de compatibilidad temporal para UI legacy.

drop table public.users;

create view public.users
with (security_invoker = true)
as
select id,email,nombre,apellidos,role,active,created_at,created_by,last_access_at,updated_at
from public.profiles;

grant select, insert, update, delete on public.users to authenticated;
