-- Business conflicts are final responses, not PostgreSQL serialization failures.
-- PostgREST 14 retries custom SQLSTATE 40001 indefinitely (Supabase KB).
-- Preserve the installed function bodies, ownership, ACLs and SECURITY DEFINER
-- checks; change only the explicitly raised application conflict code.
do $migration$
declare target record; definition text;
begin
  for target in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.prokind='f' and (
      (n.nspname='public' and p.proname in (
        'sae_finalize_report_version','sae_sync_fortnight_codes',
        'sae_apply_monthly_2500','sae_set_report_period'))
      or (n.nspname='sae_private' and p.proname='candidate_changed'))
  loop
    definition := pg_get_functiondef(target.oid);
    if definition ~* $pattern$errcode\s*=\s*'40001'$pattern$ then
      execute regexp_replace(definition,
        $pattern$errcode\s*=\s*'40001'$pattern$,
        'errcode=''PT409''', 'gi');
    end if;
  end loop;
end $migration$;
notify pgrst, 'reload schema';
