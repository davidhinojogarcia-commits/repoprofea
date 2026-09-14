revoke all on function private.can_manage_resource_share(text,text,uuid) from public;
revoke all on function private.can_manage_resource_share(text,text,uuid) from anon;
grant execute on function private.can_manage_resource_share(text,text,uuid) to authenticated;
