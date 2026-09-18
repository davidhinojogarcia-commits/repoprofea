-- Compatibilidad temporal con clientes anteriores al flujo de invitaciones.
-- El RPC antiguo mantiene su firma/retorno, pero ya NO añade miembros directamente:
-- crea una invitación pendiente que requiere aceptación expresa.

create or replace function public.inventory_add_member_by_email(p_park_id uuid,p_email text)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para compartir este parque';
  end if;

  v_result := public.inventory_create_invitation(p_park_id,p_email);

  return coalesce(
    nullif(v_result->>'displayName',''),
    lower(trim(p_email))
  );
end;
$$;

revoke execute on function public.inventory_add_member_by_email(uuid,text) from public, anon;
grant execute on function public.inventory_add_member_by_email(uuid,text) to authenticated;
