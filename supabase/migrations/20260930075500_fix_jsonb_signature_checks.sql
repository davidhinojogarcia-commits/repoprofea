do $$
declare
  v_sql text;
begin
  select pg_get_functiondef(
    'public.prepare_foreman_mandatory_from_email(text,bigint[],date,text,text,text,text,text,text,text,text,text)'::regprocedure
  ) into v_sql;

  v_sql := replace(
    v_sql,
    'jsonb_object_length(coalesce(v_existing.signatures,''{}''::jsonb))>0',
    'exists (select 1 from jsonb_object_keys(coalesce(v_existing.signatures,''{}''::jsonb)))'
  );

  execute v_sql;

  select pg_get_functiondef(
    'public.save_foreman_mandatory_original_pdf(uuid,text,text,text,jsonb,jsonb)'::regprocedure
  ) into v_sql;

  v_sql := replace(
    v_sql,
    'jsonb_object_length(coalesce(v_doc.signatures,''{}''::jsonb))>0',
    'exists (select 1 from jsonb_object_keys(coalesce(v_doc.signatures,''{}''::jsonb)))'
  );

  execute v_sql;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prokind='f'
      and p.proname in ('prepare_foreman_mandatory_from_email','save_foreman_mandatory_original_pdf')
      and p.prosrc ilike '%jsonb_object_length%'
  ) then
    raise exception 'Persisten referencias incompatibles a jsonb_object_length';
  end if;
end;
$$;
