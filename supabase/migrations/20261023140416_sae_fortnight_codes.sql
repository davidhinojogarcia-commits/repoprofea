-- No backfill: only new confirmations/imports activate assignments. Historical
-- finalized/issued reports are never rewritten, even when reopened for review.
create schema if not exists sae_private;
revoke all on schema sae_private from public, anon, authenticated;

create table sae_private.code_activation (enabled_at timestamptz not null default now());
insert into sae_private.code_activation default values;
create table sae_private.code_state (
  candidate_id uuid primary key references public.sae_candidates(id) on delete cascade,
  owner_id uuid not null, automatic_code text, source_id uuid, source_code text,
  signature text, decided_signature text, pending_code text,
  manual boolean not null default false, issue text,
  confirmed_at timestamptz, updated_at timestamptz not null default now()
);
create table sae_private.code_audit (
  id bigint generated always as identity primary key,
  candidate_id uuid not null, owner_id uuid not null, actor_id uuid,
  source_id uuid, source_report_id uuid, target_report_id uuid,
  previous_code text, new_code text, action text not null,
  signature text, changed_at timestamptz not null default clock_timestamp()
);
alter table sae_private.code_activation enable row level security;
alter table sae_private.code_state enable row level security;
alter table sae_private.code_audit enable row level security;
revoke all on all tables in schema sae_private from public, anon, authenticated;

create function sae_private.name_key(value text) returns text
language sql immutable set search_path = '' as $$
  select lower(trim(regexp_replace(regexp_replace(normalize(coalesce(value,''), NFKD),
    '[̀-ͯ]', '', 'g'), '[[:space:]]+', ' ', 'g')))
$$;
create function sae_private.work_key(code text, label text) returns text
language sql immutable set search_path = '' as $$
  select case when nullif(trim(code),'') is not null then 'code:' || sae_private.name_key(code)
    else 'name:' || sae_private.name_key(label) end
$$;
create function sae_private.report_locked(report_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.sae_reports r where r.id=report_id and
    (r.processing_status in ('finalized','confirmed') or r.detected_legend->>'__workflow_state'='finalized'
     or jsonb_array_length(coalesce(r.detected_legend->'__finalized_versions','[]'::jsonb))>0))
    or exists(select 1 from public.sae_generated_documents d where d.source_report_id=report_id)
    or exists(select 1 from public.sae_reports r join public.sae_needs n on n.id=r.need_id where r.id=report_id and n.status='finalizada')
$$;

create function sae_private.reconcile(owner uuid, need uuid) returns void
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
      elsif src.status<>'contratado' or src.existing_worker_id is null or src.existing_worker_owner_id is distinct from owner then
        if st.automatic_code is not null then problem := 'La primera contratación está anulada o sin confirmar. Revise el código actual.'; end if;
      elsif not (dest.created_at>=active_at or exists(select 1 from sae_private.code_state s
        where s.candidate_id=src.id and s.confirmed_at>=active_at)) then
        -- Existing historical pairs are not activated by simply opening the screen.
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
        sig := md5(concat_ws('|',src.id,src.result_code,src.status,src.existing_worker_id,
          (select s.confirmed_at from sae_private.code_state s where s.candidate_id=src.id),dest.id,dest.need_id,proposal));
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

-- A statement trigger obtains the owner lock before PostgreSQL locks any row.
-- It also covers writes from stale clients that do not call the new RPC.
create function sae_private.lock_candidate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,6291)); end if;
  return null;
end $$;
create trigger sae_code_lock before insert or update or delete on public.sae_candidates
  for each statement execute function sae_private.lock_candidate();
create trigger sae_code_report_lock before insert or update or delete on public.sae_reports
  for each statement execute function sae_private.lock_candidate();
create trigger sae_code_need_lock before insert or update or delete on public.sae_needs
  for each statement execute function sae_private.lock_candidate();
create trigger sae_code_document_lock before insert or update or delete on public.sae_generated_documents
  for each statement execute function sae_private.lock_candidate();

create function sae_private.candidate_changed() returns trigger
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
  if tg_op='UPDATE' then
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
create trigger sae_code_candidate_changed after insert or update or delete on public.sae_candidates
  for each row execute function sae_private.candidate_changed();

-- Reconcile once per affected scope and statement, not once per imported worker.
-- The row trigger above records manual edits/confirmations before this runs.
create function sae_private.candidate_batch_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare scope record;
begin
  if pg_trigger_depth()>1 or auth.uid() is null or not public.sae_has_permission('update') then return null; end if;
  if tg_op='INSERT' then
    for scope in select distinct need_id,owner_id from changed_new where owner_id=auth.uid() loop
      perform sae_private.reconcile(scope.owner_id,scope.need_id);
    end loop;
  elsif tg_op='DELETE' then
    for scope in select distinct c.need_id,c.owner_id from changed_old c
      join public.sae_needs n on n.id=c.need_id and n.owner_id=c.owner_id where c.owner_id=auth.uid() loop
      perform sae_private.reconcile(scope.owner_id,scope.need_id);
    end loop;
  else
    for scope in
      with changed as (
        select n.id from changed_new n join changed_old o on o.id=n.id
        left join sae_private.code_state s on s.candidate_id=n.id
        where n.owner_id=auth.uid() and
          (n.result_code,n.status,n.existing_worker_id,n.normalized_full_name,n.fortnight,n.need_id,n.hiring_month,n.work_code,n.work_name,n.dni_nie)
          is distinct from
          (o.result_code,o.status,o.existing_worker_id,o.normalized_full_name,o.fortnight,o.need_id,o.hiring_month,o.work_code,o.work_name,o.dni_nie)
          and not (not coalesce(s.manual,true) and s.automatic_code is not distinct from n.result_code
            and (to_jsonb(n)-array['result_code','result_label','updated_at','updated_by'])=
                (to_jsonb(o)-array['result_code','result_label','updated_at','updated_by']))
      )
      select distinct c.need_id,c.owner_id from (
        select n.need_id,n.owner_id from changed_new n join changed x on x.id=n.id
        union select o.need_id,o.owner_id from changed_old o join changed x on x.id=o.id
      ) c join public.sae_needs need on need.id=c.need_id and need.owner_id=c.owner_id
    loop
      perform sae_private.reconcile(scope.owner_id,scope.need_id);
    end loop;
  end if;
  return null;
end $$;
create trigger sae_code_candidates_inserted after insert on public.sae_candidates
  referencing new table as changed_new for each statement execute function sae_private.candidate_batch_changed();
create trigger sae_code_candidates_updated after update on public.sae_candidates
  referencing old table as changed_old new table as changed_new for each statement execute function sae_private.candidate_batch_changed();
create trigger sae_code_candidates_deleted after delete on public.sae_candidates
  referencing old table as changed_old for each statement execute function sae_private.candidate_batch_changed();

create function public.sae_sync_fortnight_codes(p_need_id uuid, p_candidate_id uuid default null,
  p_signature text default null, p_apply boolean default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid(); st sae_private.code_state; c public.sae_candidates; result jsonb;
begin
  if owner is null or not public.sae_has_permission('read') or not exists(
    select 1 from public.sae_needs where id=p_need_id and owner_id=owner) then
    raise exception 'Solicitud SAE no accesible.' using errcode='42501';
  end if;
  if public.sae_has_permission('update') then perform sae_private.reconcile(owner,p_need_id); end if;
  if p_candidate_id is not null then
    if not public.sae_has_permission('update') then raise exception 'Operación no permitida.' using errcode='42501'; end if;
    select * into c from public.sae_candidates where id=p_candidate_id and need_id=p_need_id and owner_id=owner for update;
    select * into st from sae_private.code_state where candidate_id=c.id and owner_id=owner for update;
    if c.id is null or st.issue is distinct from 'manual_confirmation' or st.signature is distinct from p_signature
      or p_apply is null or st.pending_code is null then
      raise exception 'La propuesta ha cambiado. Actualice el informe y revise el código.' using errcode='40001';
    end if;
    if p_apply then
      update sae_private.code_state set manual=false,automatic_code=st.pending_code,decided_signature=st.signature,issue=null,pending_code=null where candidate_id=c.id;
      update public.sae_candidates set result_code=st.pending_code,result_label='no_contratado',updated_by=owner where id=c.id;
    else
      update sae_private.code_state set decided_signature=st.signature,issue=null,pending_code=null where candidate_id=c.id;
    end if;
    insert into sae_private.code_audit(candidate_id,owner_id,actor_id,source_id,source_report_id,target_report_id,previous_code,new_code,action,signature)
      values(c.id,owner,owner,st.source_id,(select source_report_id from public.sae_candidates where id=st.source_id),c.source_report_id,c.result_code,case when p_apply then st.pending_code else c.result_code end,
        case when p_apply then 'accepted' else 'kept' end,st.signature);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('candidateId',s.candidate_id,'automaticCode',s.automatic_code,
    'sourceCode',s.source_code,'sourceId',s.source_id,'signature',s.signature,'pendingCode',s.pending_code,
    'manual',s.manual,'issue',s.issue)),'[]'::jsonb) into result
    from sae_private.code_state s join public.sae_candidates target on target.id=s.candidate_id
    where s.owner_id=owner and target.owner_id=owner and target.need_id=p_need_id;
  return result;
end $$;

revoke all on all functions in schema sae_private from public, anon, authenticated;
revoke all on function public.sae_sync_fortnight_codes(uuid,uuid,text,boolean) from public,anon;
grant execute on function public.sae_sync_fortnight_codes(uuid,uuid,text,boolean) to authenticated;

create index if not exists sae_candidates_fortnight_scope on public.sae_candidates(owner_id,hiring_month,fortnight);
create index if not exists sae_needs_fortnight_scope on public.sae_needs(owner_id,hiring_year,hiring_month);
notify pgrst, 'reload schema';
