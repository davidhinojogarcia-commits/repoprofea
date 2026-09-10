do $$
begin
  if to_regclass('public.workers') is not null then
    if exists (
      select 1 from public.workers w
      left join public.trabajadores t on t.owner_id=w.owner_id and t.id=w.id
      where t.owner_id is null
    ) then
      raise exception 'Cannot retire workers: unmigrated rows remain';
    end if;
    drop table public.workers;
  end if;
end $$;
