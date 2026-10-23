-- Saving a first-fortnight result now activates reconciliation without creating
-- or linking a worker. Preserve owner locks, manual decisions and issued reports.
alter table sae_private.code_state add column code_applied_at timestamptz;

-- Recover only explicit result edits already audited since the feature launch.
-- This does not rewrite any candidate/report or activate untouched historical data.
update sae_private.code_state s set code_applied_at=edits.applied_at
from (
  select c.id,max(a.changed_at) as applied_at
  from public.sae_candidates c
  join sae_private.code_audit a on a.candidate_id=c.id and a.owner_id=c.owner_id
  cross join sae_private.code_activation activation
  where c.fortnight=1 and nullif(c.result_code,'') is not null
    and a.action='manual' and a.actor_id=c.owner_id
    and a.changed_at>=activation.enabled_at and a.new_code=c.result_code
  group by c.id
) edits where s.candidate_id=edits.id;

create or replace function sae_private.reconcile(owner uuid, need uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n public.sae_needs; dest record; src public.sae_candidates; st sae_private.code_state;
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
    where c.owner_id=owner and dn.owner_id=owner and c.fortnight=2
      and c.hiring_month=dn.hiring_month and dn.hiring_year=n.hiring_year
      and dn.hiring_month=n.hiring_month
      and sae_private.work_key(dn.work_code,dn.work_name)=sae_private.work_key(n.work_code,n.work_name)
      and sae_private.work_key(c.work_code,c.work_name)=sae_private.work_key(dn.work_code,dn.work_name)
      and exists(select 1 from public.sae_reports dr where dr.id=c.source_report_id and dr.need_id=c.need_id and dr.owner_id=owner)
    order by c.id for update of c
  loop
    select * into st from sae_private.code_state where candidate_id=dest.id;
    old_state := to_jsonb(st);
    problem := null; proposal := null; sig := null;
    select count(*) into source_count
      from public.sae_candidates c join public.sae_needs sn on sn.id=c.need_id
      where c.owner_id=owner and sn.owner_id=owner and c.fortnight=1
        and c.hiring_month=sn.hiring_month and sn.hiring_month=n.hiring_month and sn.hiring_year=n.hiring_year
        and sae_private.work_key(sn.work_code,sn.work_name)=sae_private.work_key(n.work_code,n.work_name)
        and sae_private.work_key(c.work_code,c.work_name)=sae_private.work_key(sn.work_code,sn.work_name)
        and exists(select 1 from public.sae_reports sr where sr.id=c.source_report_id and sr.need_id=c.need_id and sr.owner_id=owner)
        and sae_private.name_key(c.normalized_full_name)=sae_private.name_key(dest.normalized_full_name);
    if source_count=0 then
      if st.automatic_code is not null then problem := 'La primera contratación ya no está disponible. Revise el código actual.'; end if;
    elsif source_count>1 then
      problem := 'Coincidencia ambigua: hay varios candidatos con el mismo nombre. Compruebe su identidad.';
    else
      select c.* into src from public.sae_candidates c join public.sae_needs sn on sn.id=c.need_id
        where c.owner_id=owner and sn.owner_id=owner and c.fortnight=1
          and c.hiring_month=sn.hiring_month and sn.hiring_month=n.hiring_month and sn.hiring_year=n.hiring_year
          and sae_private.work_key(sn.work_code,sn.work_name)=sae_private.work_key(n.work_code,n.work_name)
          and sae_private.work_key(c.work_code,c.work_name)=sae_private.work_key(sn.work_code,sn.work_name)
          and exists(select 1 from public.sae_reports sr where sr.id=c.source_report_id and sr.need_id=c.need_id and sr.owner_id=owner)
          and sae_private.name_key(c.normalized_full_name)=sae_private.name_key(dest.normalized_full_name);
      select count(*) into target_count from public.sae_candidates c join public.sae_needs dn on dn.id=c.need_id
        where c.owner_id=owner and dn.owner_id=owner and c.fortnight=2
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
        if st.automatic_code is not null then problem := 'El código de la primera quincena se ha retirado. Revise el código actual.'; end if;
      elsif not (dest.created_at>=active_at or exists(select 1 from sae_private.code_state s
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
          problem := 'La segunda contratación o el informe ya está confirmado o emitido. Requiere rectificación.';
          proposal := null;
        end if;
      end if;
    end if;

    if problem is null and proposal is not null and dest.result_code is distinct from proposal then
      if coalesce(st.manual, nullif(dest.result_code,'') is not null) then
        -- A decision applies only to this exact source version and proposal.
        if st.decided_signature is distinct from sig then problem := 'manual_confirmation'; end if;
      else
        insert into sae_private.code_state(candidate_id,owner_id,automatic_code,source_id,source_code,signature,manual)
          values(dest.id,owner,proposal,src.id,src.result_code,sig,false)
          on conflict(candidate_id) do update set automatic_code=excluded.automatic_code,
            source_id=excluded.source_id,source_code=excluded.source_code,signature=excluded.signature,manual=false;
        update public.sae_candidates set result_code=proposal,result_label='no_contratado',updated_by=auth.uid() where id=dest.id;
        insert into sae_private.code_audit(candidate_id,owner_id,actor_id,source_id,source_report_id,target_report_id,previous_code,new_code,action,signature)
          values(dest.id,owner,auth.uid(),src.id,src.source_report_id,dest.source_report_id,dest.result_code,proposal,'automatic',sig);
      end if;
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

create or replace function sae_private.candidate_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare st sae_private.code_state; current_owner uuid; current_need uuid;
begin
  if tg_op='UPDATE' and old.status='contratado' and new.status='contratado'
    and old.existing_worker_id is distinct from new.existing_worker_id then
    raise exception 'La contratación ya fue confirmada en otro dispositivo. Actualice el informe.' using errcode='40001';
  end if;
  if pg_trigger_depth()>1 then return null; end if;
  current_owner := case when tg_op='DELETE' then old.owner_id else new.owner_id end;
  current_need := case when tg_op='DELETE' then old.need_id else new.need_id end;
  if current_owner is distinct from auth.uid() or not public.sae_has_permission('update') then return null; end if;
  if tg_op='UPDATE' and
    (new.result_code,new.status,new.existing_worker_id,new.normalized_full_name,new.fortnight,new.need_id,new.hiring_month,new.work_code,new.work_name,new.dni_nie)
    is not distinct from
    (old.result_code,old.status,old.existing_worker_id,old.normalized_full_name,old.fortnight,old.need_id,old.hiring_month,old.work_code,old.work_name,old.dni_nie) then return null; end if;
  if tg_op='INSERT' and new.fortnight=1 and nullif(new.result_code,'') is not null then
    insert into sae_private.code_state(candidate_id,owner_id,code_applied_at)
      values(new.id,new.owner_id,clock_timestamp())
      on conflict(candidate_id) do update set code_applied_at=excluded.code_applied_at;
  end if;
  if tg_op='UPDATE' then
    if new.fortnight=1 and nullif(new.result_code,'') is not null
      and new.result_code is distinct from old.result_code then
      insert into sae_private.code_state(candidate_id,owner_id,code_applied_at)
        values(new.id,new.owner_id,clock_timestamp())
        on conflict(candidate_id) do update set code_applied_at=excluded.code_applied_at;
    end if;
    select * into st from sae_private.code_state where candidate_id=new.id;
    if new.result_code is distinct from old.result_code and
      not (not coalesce(st.manual,true) and st.automatic_code is not distinct from new.result_code) then
      insert into sae_private.code_state(candidate_id,owner_id,manual) values(new.id,new.owner_id,true)
        on conflict(candidate_id) do update set manual=true,decided_signature=null;
      insert into sae_private.code_audit(candidate_id,owner_id,actor_id,target_report_id,previous_code,new_code,action)
        values(new.id,new.owner_id,auth.uid(),new.source_report_id,old.result_code,new.result_code,'manual');
    end if;
    if new.status='contratado' and new.existing_worker_id is not null and
      (new.status,new.existing_worker_id,new.result_code) is distinct from (old.status,old.existing_worker_id,old.result_code) then
      insert into sae_private.code_state(candidate_id,owner_id,confirmed_at) values(new.id,new.owner_id,clock_timestamp())
        on conflict(candidate_id) do update set confirmed_at=excluded.confirmed_at;
    end if;
  end if;
  return null;
end $$;

revoke all on function sae_private.reconcile(uuid,uuid) from public,anon,authenticated;
revoke all on function sae_private.candidate_changed() from public,anon,authenticated;
notify pgrst, 'reload schema';
