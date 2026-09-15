-- Explicitly restrict inventory SECURITY DEFINER RPCs to authenticated users only.
revoke execute on function public.inventory_register_movement(uuid,text,text,text,uuid,text,numeric,numeric,jsonb) from anon;
revoke execute on function public.inventory_add_member_by_email(uuid,text) from anon;
revoke all on function public.inventory_register_movement(uuid,text,text,text,uuid,text,numeric,numeric,jsonb) from public;
revoke all on function public.inventory_add_member_by_email(uuid,text) from public;
grant execute on function public.inventory_register_movement(uuid,text,text,text,uuid,text,numeric,numeric,jsonb) to authenticated;
grant execute on function public.inventory_add_member_by_email(uuid,text) to authenticated;
