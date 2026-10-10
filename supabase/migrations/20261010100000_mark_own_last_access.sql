-- Actualiza exclusivamente la fecha de acceso del usuario autenticado.
-- Evita conceder UPDATE general sobre perfiles a usuarios no administradores.
create or replace function public.mark_own_last_access()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set last_access_at = now()
   where id = (select auth.uid())
     and active is true;
end;
$$;
revoke all on function public.mark_own_last_access() from public;
revoke all on function public.mark_own_last_access() from anon;
grant execute on function public.mark_own_last_access() to authenticated;
