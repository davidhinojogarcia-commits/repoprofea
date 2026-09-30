do $$
declare
  v_sql text;
begin
  select pg_get_functiondef(
    'public.prepare_foreman_mandatory_from_email(text,bigint[],date,text,text,text,text,text,text,text,text,text)'::regprocedure
  ) into v_sql;

  v_sql := replace(
    v_sql,
    $$if coalesce(array_length(p_worker_ids,1),0)>0 then
    select t.obra
      into v_obra
    from unnest(p_worker_ids) with ordinality ids(id,ord)
    join public.trabajadores t
      on t.id=ids.id
     and t.owner_id=v_owner
    group by t.obra
    order by count(*) desc, min(ids.ord)
    limit 1;
  end if;

  if coalesce(trim(v_obra),'')='' and coalesce(trim(p_obra_hint),'')<>'' then
    select t.obra
      into v_obra
    from public.trabajadores t
    where t.owner_id=v_owner
      and lower(coalesce(t.obra,''))=lower(trim(p_obra_hint))
    limit 1;
  end if;$$,
    $$if coalesce(trim(p_obra_hint),'')<>'' then
    v_obra := trim(p_obra_hint);
  end if;

  if coalesce(trim(v_obra),'')='' and coalesce(array_length(p_worker_ids,1),0)>0 then
    select t.obra
      into v_obra
    from unnest(p_worker_ids) with ordinality ids(id,ord)
    join public.trabajadores t
      on t.id=ids.id
     and t.owner_id=v_owner
    group by t.obra
    order by count(*) desc, min(ids.ord)
    limit 1;
  end if;$$
  );

  execute v_sql;
end;
$$;

do $$
declare
  v_src text;
begin
  select p.prosrc
    into v_src
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='prepare_foreman_mandatory_from_email'
    and p.prokind='f'
  limit 1;

  if position('v_obra := trim(p_obra_hint)' in coalesce(v_src,''))=0 then
    raise exception 'La función no prioriza la obra seleccionada';
  end if;
end;
$$;
