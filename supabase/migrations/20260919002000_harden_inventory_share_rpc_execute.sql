-- Endurece la ejecución de los RPC de inventario.
-- Solo las cuentas autenticadas pueden gestionar parques, movimientos e invitaciones.

revoke execute on function public.inventory_create_invitation(uuid,text) from public, anon;
grant execute on function public.inventory_create_invitation(uuid,text) to authenticated;

revoke execute on function public.inventory_respond_invitation(uuid,boolean) from public, anon;
grant execute on function public.inventory_respond_invitation(uuid,boolean) to authenticated;

revoke execute on function public.inventory_revoke_member(uuid,uuid) from public, anon;
grant execute on function public.inventory_revoke_member(uuid,uuid) to authenticated;

revoke execute on function public.inventory_list_invitations() from public, anon;
grant execute on function public.inventory_list_invitations() to authenticated;

revoke execute on function public.inventory_list_park_shares(uuid) from public, anon;
grant execute on function public.inventory_list_park_shares(uuid) to authenticated;

revoke execute on function public.inventory_register_movement(uuid,text,text,text,uuid,text,numeric,numeric,jsonb) from public, anon;
grant execute on function public.inventory_register_movement(uuid,text,text,text,uuid,text,numeric,numeric,jsonb) to authenticated;

revoke execute on function public.inventory_update_movement(uuid,text,text,text,text,numeric,numeric,jsonb) from public, anon;
grant execute on function public.inventory_update_movement(uuid,text,text,text,text,numeric,numeric,jsonb) to authenticated;

revoke execute on function public.inventory_delete_movement(uuid) from public, anon;
grant execute on function public.inventory_delete_movement(uuid) to authenticated;

revoke execute on function public.inventory_add_member_by_email(uuid,text) from public, anon, authenticated;
