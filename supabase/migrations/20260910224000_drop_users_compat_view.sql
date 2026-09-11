-- La UI y las funciones administrativas usan public.profiles directamente.
-- Se elimina la vista temporal public.users para dejar profiles como única entidad de perfil.
drop view if exists public.users;
