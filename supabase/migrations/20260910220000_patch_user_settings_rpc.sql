create or replace function public.patch_user_settings(p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_settings jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  insert into public.user_settings (user_id, settings, updated_by, updated_at)
  values (v_uid, coalesce(p_patch, '{}'::jsonb), v_uid, now())
  on conflict (user_id) do update
    set settings = coalesce(public.user_settings.settings, '{}'::jsonb) || coalesce(excluded.settings, '{}'::jsonb),
        updated_by = v_uid,
        updated_at = now()
  returning settings into v_settings;

  return v_settings;
end;
$$;

grant execute on function public.patch_user_settings(jsonb) to authenticated;
