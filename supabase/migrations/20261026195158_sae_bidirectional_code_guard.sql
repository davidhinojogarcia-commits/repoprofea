create or replace function sae_private.reconcile(owner uuid, need uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n public.sae_needs; dest public.sae_candidates; src public.sae_candidates; st sae_private.code_state;
  source_count integer; target_count integer; proposal text; problem text; sig text;
  old_state jsonb; active_at timestamptz;
begin
  if owner is distinct from auth.uid() or not public.sae_has_permission('update') then
    raise exception 'No tiene permiso para actualizar los códigos SAE.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text, 6291));
  select * into n from public.sae_needs where id=need and owner_id=owner;
  if not found then raise exception 'Solicitud SAE no accesible.' using errcode='42501'; end if;
  select enabled_at into active_at from sae_private.code_activation;
  for dest in
    select c.* from public.sae_candidates c join public.sae_needs dn on dn.id=c.need_id
    where c.owner_id=owner and dn.owner_id=owner and c.fortnight in (1,2)
      and c.hiring_month=dn.hiring_month and dn.hiring_year=n.hiring_year
      and dn.hiring_month=n.hiring_month
      and sae_private.work_key(dn.work_code,dn.work_name)=sae_private.work_key(n.work_code,n.work_name)
      and sae_private.work_key(c.work_code,c.work_name)=sae_private.work_key(dn.work_code,dn.work_name)
      and exists(select 1 from public.sae_reports dr where dr.id=c.source_report_id and dr.need_id=c.need_id and dr.owner_id=owner)
    order by c.id for update of c
  loop
    select * into st from sae_private.code_state where candidate_id=dest.id;
    old_state := to_jsonb(st);
    if dest.fortnight=1 and sae_private.name_key(to_jsonb(dest)->>'category') !~ '\mpeon(es)?\M' and not sae_private.code_conflicts(dest) then continue; end if;
    problem := null; proposal := null; sig := null;
    select count(*) into source_count
      from public.sae_candidates c join public.sae_needs sn on sn.id=c.need_id
      where c.owner_id=owner and sn.owner_id=owner and c.fortnight=3-dest.fortnight
        and not coalesce((select reverse_derived from sae_private.code_state where candidate_id=c.id),false)
        and (dest.fortnight=2 or (c.result_code='2001' and coalesce((select manual from sae_private.code_state where candidate_id=c.id),true) and sae_private.name_key(to_jsonb(c)->>'category') ~ '\mpeon(es)?\M'))
        and c.hiring_month=sn.hiring_month and sn.hiring_month=n.hiring_month and sn.hiring_year=n.hiring_year
        and sae_private.work_key(sn.work_code,sn.work_name)=sae_private.work_key(n.work_code,n.work_name)
        and sae_private.work_key(c.work_code,c.work_name)=sae_private.work_key(sn.work_code,sn.work_name)
        and exists(select 1 from public.sae_reports sr where sr.id=c.source_report_id and sr.need_id=c.need_id and sr.owner_id=owner)
        and sae_private.name_key(c.normalized_full_name)=sae_private.name_key(dest.normalized_full_name);
    if source_count=0 then
      if st.automatic_code is not null then problem := 'El resultado de origen ya no está disponible. Revise el código actual.'; end if;
    elsif source_count>1 then
      problem := 'Coincidencia ambigua: hay varios candidatos con el mismo nombre. Compruebe su identidad.';
    else
      select c.* into src from public.sae_candidates c join public.sae_needs sn on sn.id=c.need_id
        where c.owner_id=owner and sn.owner_id=owner and c.fortnight=3-dest.fortnight
        and not coalesce((select reverse_derived from sae_private.code_state where candidate_id=c.id),false)
        and (dest.fortnight=2 or (c.result_code='2001' and coalesce((select manual from sae_private.code_state where candidate_id=c.id),true) and sae_private.name_key(to_jsonb(c)->>'category') ~ '\mpeon(es)?\M'))
          and c.hiring_month=sn.hiring_month and sn.hiring_month=n.hiring_month and sn.hiring_year=n.hiring_year
          and sae_private.work_key(sn.work_code,sn.work_name)=sae_private.work_key(n.work_code,n.work_name)
          and sae_private.work_key(c.work_code,c.work_name)=sae_private.work_key(sn.work_code,sn.work_name)
          and exists(select 1 from public.sae_reports sr where sr.id=c.source_report_id and sr.need_id=c.need_id and sr.owner_id=owner)
          and sae_private.name_key(c.normalized_full_name)=sae_private.name_key(dest.normalized_full_name);
      select count(*) into target_count from public.sae_candidates c join public.sae_needs dn on dn.id=c.need_id
        where c.owner_id=owner and dn.owner_id=owner and c.fortnight=dest.fortnight
          and c.hiring_month=dn.hiring_month and dn.hiring_month=n.hiring_month and dn.hiring_year=n.hiring_year
          and sae_private.work_key(dn.work_code,dn.work_name)=sae_private.work_key(n.work_code,n.work_name)
          and sae_private.work_key(c.work_code,c.work_name)=sae_private.work_key(dn.work_code,dn.work_name)
          and exists(select 1 from public.sae_reports dr where dr.id=c.source_report_id and dr.need_id=c.need_id and dr.owner_id=owner)
          and sae_private.name_key(c.normalized_full_name)=sae_private.name_key(dest.normalized_full_name);
      if target_count<>1 or sae_private.name_key(dest.normalized_full_name)='' then
        problem := 'Coincidencia ambigua: compruebe los candidatos con el mismo nombre.';
      elsif nullif(src.dni_nie,'') is not null and nullif(dest.dni_nie,'') is not null
        and upper(regexp_replace(src.dni_nie,'[[:space:]-]','','g'))<>upper(regexp_replace(dest.dni_nie,'[[:space:]-]','','g')) then
        problem := 'El nombre coincide pero los documentos de identidad son distintos. Compruebe la identidad.';
      elsif nullif(src.result_code,'') is null then
        if st.automatic_code is not null then problem := 'El código de la quincena de origen se ha retirado. Revise el código actual.'; end if;
      elsif dest.fortnight=2 and not (dest.created_at>=active_at or exists(select 1 from sae_private.code_state s
        where s.candidate_id=src.id and (s.confirmed_at>=active_at or s.code_applied_at>=active_at))) then
        -- Only explicit post-launch result edits/imports/confirmations activate old drafts.
        continue;
      elsif src.result_code is null or src.result_code !~ '^[0-9]+$' or not exists(
        select 1 from public.sae_reports r where r.id=src.source_report_id and r.detected_legend ? src.result_code) then
        problem := 'Código de origen desconocido. Revise la contratación antes de asignar un resultado.';
      else
        if src.result_code='2001' then proposal := '2500';
        else
          -- The report catalog is the persisted SAE_RESULT_CODES catalog. Require
          -- one exact numeric mapping; do not guess when imported data disagrees.
          select case when count(*)=1 then min(e.key) end into proposal
            from public.sae_reports r cross join lateral jsonb_each_text(r.detected_legend) e
            where r.id=dest.source_report_id and e.key ~ '^[0-9]+$'
              and sae_private.name_key(e.value)='otros motivos';
          if proposal is null then problem := 'Configuración SAE: falta un código único para «Otros motivos».'; end if;
        end if;
        -- Registration is independent of the saved SAE result. Only a change
        -- in source/result/proposal invalidates a supervisor decision.
        sig := md5(concat_ws('|',src.id,src.result_code,
          (select coalesce(s.code_applied_at,s.confirmed_at) from sae_private.code_state s where s.candidate_id=src.id),
          dest.id,dest.need_id,proposal));
        if dest.status='contratado' or dest.existing_worker_id is not null or sae_private.report_locked(dest.source_report_id) then
          problem := 'La contratación de destino o el informe ya está confirmado o emitido. Requiere rectificación.';
          proposal := null;
        end if;
      end if;
    end if;

    if problem is null and proposal is not null and proposal=src.result_code then
      problem := 'Código incompatible: no puede repetir el mismo código en ambas quincenas. Corrija el resultado antes de finalizar.';
      proposal := null;
    end if;
    if problem is null and proposal is not null and dest.result_code is distinct from proposal then
      if coalesce(st.manual, nullif(dest.result_code,'') is not null) then
        -- A decision applies only to this exact source version and proposal.
        if st.decided_signature is distinct from sig then problem := 'manual_confirmation'; end if;
      else
        insert into sae_private.code_state(candidate_id,owner_id,automatic_code,source_id,source_code,signature,manual,reverse_derived)
          values(dest.id,owner,proposal,src.id,src.result_code,sig,false,dest.fortnight=1)
          on conflict(candidate_id) do update set automatic_code=excluded.automatic_code,
            source_id=excluded.source_id,source_code=excluded.source_code,signature=excluded.signature,manual=false,reverse_derived=excluded.reverse_derived;
        update public.sae_candidates set result_code=proposal,result_label='no_contratado',updated_by=auth.uid() where id=dest.id;
        insert into sae_private.code_audit(candidate_id,owner_id,actor_id,source_id,source_report_id,target_report_id,previous_code,new_code,action,signature)
          values(dest.id,owner,auth.uid(),src.id,src.source_report_id,dest.source_report_id,dest.result_code,proposal,'automatic',sig);
      end if;
    end if;
    if sae_private.code_conflicts(dest) then
      problem := 'Código incompatible: no puede repetir el mismo código en ambas quincenas. Corrija el resultado antes de finalizar.';
      proposal := null;
    end if;
    if problem is not null or st.candidate_id is not null or proposal is not null then
      insert into sae_private.code_state(candidate_id,owner_id,manual,issue,pending_code,signature,source_id,source_code)
        values(dest.id,owner,coalesce(st.manual,nullif(dest.result_code,'') is not null),problem,
          case when problem='manual_confirmation' then proposal end,sig,
          case when source_count=1 then src.id end,case when source_count=1 then src.result_code end)
        on conflict(candidate_id) do update set issue=excluded.issue,pending_code=excluded.pending_code,
          signature=excluded.signature,source_id=excluded.source_id,source_code=excluded.source_code
        where (code_state.issue,code_state.pending_code,code_state.signature,code_state.source_id,code_state.source_code)
          is distinct from (excluded.issue,excluded.pending_code,excluded.signature,excluded.source_id,excluded.source_code);
      if problem is not null and (old_state->>'issue',old_state->>'signature') is distinct from (problem,sig) then
        insert into sae_private.code_audit(candidate_id,owner_id,actor_id,source_id,target_report_id,previous_code,new_code,action,signature)
          values(dest.id,owner,auth.uid(),case when source_count=1 then src.id end,dest.source_report_id,dest.result_code,dest.result_code,problem,sig);
      end if;
    end if;
  end loop;
end $$;

-- Reuse the owner-wide statement lock already installed on candidates/reports/needs.
-- No historical data is rewritten. Conflict messages contain no names or identity documents.
create function sae_private.code_conflicts(candidate public.sae_candidates) returns boolean
language sql volatile security definer set search_path='' as $$
 select nullif(candidate.result_code,'') is not null and candidate.fortnight in (1,2)
 and sae_private.name_key(candidate.normalized_full_name)<>'' and exists (
 select 1 from public.sae_candidates c
 join public.sae_needs n on n.id=c.need_id and n.owner_id=c.owner_id
 join public.sae_needs target on target.id=candidate.need_id and target.owner_id=candidate.owner_id
 where c.owner_id=candidate.owner_id and c.id<>candidate.id and c.fortnight=3-candidate.fortnight
 and c.result_code=candidate.result_code
 and n.hiring_year=target.hiring_year and n.hiring_month=target.hiring_month
 and c.hiring_month=n.hiring_month and candidate.hiring_month=target.hiring_month
 and sae_private.work_key(n.work_code,n.work_name)=sae_private.work_key(target.work_code,target.work_name)
 and sae_private.work_key(c.work_code,c.work_name)=sae_private.work_key(n.work_code,n.work_name)
 and sae_private.work_key(candidate.work_code,candidate.work_name)=sae_private.work_key(target.work_code,target.work_name)
 and sae_private.name_key(c.normalized_full_name)=sae_private.name_key(candidate.normalized_full_name)
 and (nullif(c.dni_nie,'') is null or nullif(candidate.dni_nie,'') is null or
 upper(regexp_replace(c.dni_nie,'[[:space:]-]','','g'))=upper(regexp_replace(candidate.dni_nie,'[[:space:]-]','','g')))
 )
$$;
revoke all on function sae_private.code_conflicts(public.sae_candidates) from public,anon,authenticated;

create function sae_private.reject_duplicate_code() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.result_code,new.normalized_full_name,new.fortnight,new.need_id,new.hiring_month,new.work_code,new.work_name,new.dni_nie)
 is not distinct from (old.result_code,old.normalized_full_name,old.fortnight,old.need_id,old.hiring_month,old.work_code,old.work_name,old.dni_nie) then return new; end if;
 if sae_private.code_conflicts(new) then
 raise exception 'Código incompatible: esta persona ya tiene el mismo código en la otra quincena de esta obra y mes. Cambie uno de los resultados antes de finalizar.' using errcode='PT409';
 end if;
 return new;
end $$;
revoke all on function sae_private.reject_duplicate_code() from public,anon,authenticated;
create trigger sae_reject_duplicate_code after insert or update on public.sae_candidates
for each row execute function sae_private.reject_duplicate_code();

create function sae_private.reject_conflicting_closure() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='sae_reports' then
   if new.processing_status not in ('finalized','confirmed') and new.detected_legend->>'__workflow_state' is distinct from 'finalized' then return new; end if;
   if exists(select 1 from public.sae_candidates c where c.source_report_id=new.id and c.owner_id=new.owner_id and sae_private.code_conflicts(c)) then
     raise exception 'No se puede finalizar: hay códigos iguales para la misma persona en ambas quincenas. Corrija la incompatibilidad.' using errcode='PT409';
   end if;
 else
   if new.status<>'finalizada' then return new; end if;
   if exists(select 1 from public.sae_candidates c where c.need_id=new.id and c.owner_id=new.owner_id and sae_private.code_conflicts(c)) then
     raise exception 'No se puede finalizar: hay códigos iguales para la misma persona en ambas quincenas. Corrija la incompatibilidad.' using errcode='PT409';
   end if;
 end if;
 return new;
end $$;
revoke all on function sae_private.reject_conflicting_closure() from public,anon,authenticated;
create trigger sae_reject_conflicting_report before insert or update on public.sae_reports
for each row execute function sae_private.reject_conflicting_closure();
create trigger sae_reject_conflicting_need before insert or update on public.sae_needs
for each row execute function sae_private.reject_conflicting_closure();
notify pgrst,'reload schema';

-- Validate even an idempotent finalization RPC that would return without UPDATE.
do $upgrade$
declare body text;
begin
 select pg_get_functiondef('public.sae_finalize_report_version(uuid,jsonb)'::regprocedure) into body;
 if position('sae_private.code_conflicts(c)' in body)=0 then
   body:=replace(body, '  versions :=', $check$  if exists(select 1 from public.sae_candidates c where c.source_report_id=p_report_id and c.owner_id=owner and sae_private.code_conflicts(c)) then
    raise exception 'No se puede finalizar: hay códigos iguales para la misma persona en ambas quincenas. Corrija la incompatibilidad.' using errcode='PT409';
  end if;
  versions :=$check$);
   if position('sae_private.code_conflicts(c)' in body)=0 then raise exception 'Definición de finalización no reconocida'; end if;
   execute body;
 end if;
end $upgrade$;
