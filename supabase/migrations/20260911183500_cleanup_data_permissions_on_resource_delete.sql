create or replace function public.cleanup_data_permissions_on_resource_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.data_permissions
  where resource_type = tg_argv[0]
    and resource_id = old.id::text;
  return old;
end;
$$;

revoke all on function public.cleanup_data_permissions_on_resource_delete() from public;

do $$
begin
  if to_regclass('public.trabajadores') is not null then
    execute 'drop trigger if exists trg_cleanup_permissions_trabajadores on public.trabajadores';
    execute 'create trigger trg_cleanup_permissions_trabajadores after delete on public.trabajadores for each row execute function public.cleanup_data_permissions_on_resource_delete(''trabajadores'')';
  end if;
  if to_regclass('public.citas') is not null then
    execute 'drop trigger if exists trg_cleanup_permissions_citas on public.citas';
    execute 'create trigger trg_cleanup_permissions_citas after delete on public.citas for each row execute function public.cleanup_data_permissions_on_resource_delete(''citas'')';
  end if;
  if to_regclass('public.reconocimientos') is not null then
    execute 'drop trigger if exists trg_cleanup_permissions_reconocimientos on public.reconocimientos';
    execute 'create trigger trg_cleanup_permissions_reconocimientos after delete on public.reconocimientos for each row execute function public.cleanup_data_permissions_on_resource_delete(''reconocimientos'')';
  end if;
  if to_regclass('public.subcontratas') is not null then
    execute 'drop trigger if exists trg_cleanup_permissions_subcontratas on public.subcontratas';
    execute 'create trigger trg_cleanup_permissions_subcontratas after delete on public.subcontratas for each row execute function public.cleanup_data_permissions_on_resource_delete(''subcontratas'')';
  end if;
  if to_regclass('public.contrataciones') is not null then
    execute 'drop trigger if exists trg_cleanup_permissions_contrataciones on public.contrataciones';
    execute 'create trigger trg_cleanup_permissions_contrataciones after delete on public.contrataciones for each row execute function public.cleanup_data_permissions_on_resource_delete(''contrataciones'')';
  end if;
  if to_regclass('public.obras') is not null then
    execute 'drop trigger if exists trg_cleanup_permissions_obras on public.obras';
    execute 'create trigger trg_cleanup_permissions_obras after delete on public.obras for each row execute function public.cleanup_data_permissions_on_resource_delete(''obra'')';
  end if;
end $$;
