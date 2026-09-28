-- Auditoría, versiones y control supervisor de la documentación del encargado.

alter table public.foreman_mandatory_documents
  add column if not exists correction_pending boolean not null default false,
  add column if not exists correction_reason text,
  add column if not exists correction_requested_at timestamptz;

alter table public.foreman_documents
  add column if not exists correction_pending boolean not null default false,
  add column if not exists correction_reason text,
  add column if not exists correction_requested_at timestamptz;

alter table public.foreman_attendance_days
  add column if not exists correction_pending boolean not null default false,
  add column if not exists correction_reason text,
  add column if not exists correction_requested_at timestamptz;

alter table public.foreman_mandatory_documents
  drop constraint if exists foreman_mandatory_documents_status_check;
alter table public.foreman_mandatory_documents
  add constraint foreman_mandatory_documents_status_check
  check (status in ('pending','in_progress','returned','completed','reviewed'));

create table if not exists public.foreman_activity_log (
  id bigserial primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  obra text not null default '',
  entity_type text not null,
  entity_id uuid,
  document_type text,
  action text not null,
  actor_type text not null check (actor_type in ('supervisor','encargado','sistema')),
  actor_name text not null default '',
  worker_id bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists foreman_activity_owner_created_idx
  on public.foreman_activity_log(owner_id, created_at desc);
create index if not exists foreman_activity_entity_idx
  on public.foreman_activity_log(owner_id, entity_type, entity_id, created_at desc);

alter table public.foreman_activity_log enable row level security;
drop policy if exists foreman_activity_owner_select on public.foreman_activity_log;
create policy foreman_activity_owner_select on public.foreman_activity_log
  for select to authenticated using (owner_id=auth.uid());
grant select on public.foreman_activity_log to authenticated;

create table if not exists public.foreman_document_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  obra text not null default '',
  entity_type text not null,
  entity_id uuid not null,
  version_no integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(owner_id, entity_type, entity_id, version_no)
);
create index if not exists foreman_versions_entity_idx
  on public.foreman_document_versions(owner_id, entity_type, entity_id, version_no desc);

alter table public.foreman_document_versions enable row level security;
drop policy if exists foreman_versions_owner_select on public.foreman_document_versions;
create policy foreman_versions_owner_select on public.foreman_document_versions
  for select to authenticated using (owner_id=auth.uid());
grant select on public.foreman_document_versions to authenticated;

create or replace function public.foreman_audit_row_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_new jsonb := case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_old jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_owner uuid;
  v_obra text;
  v_entity_id uuid;
  v_doc_type text;
  v_actor_type text;
  v_actor_name text := '';
  v_action text;
  v_worker bigint;
  v_metadata jsonb := '{}'::jsonb;
  v_old_status text;
  v_new_status text;
  v_next_version integer;
begin
  v_owner := coalesce((v_new->>'owner_id')::uuid,(v_old->>'owner_id')::uuid);
  v_obra := coalesce(v_new->>'obra',v_old->>'obra','');
  v_entity_id := coalesce(nullif(v_new->>'id','')::uuid,nullif(v_old->>'id','')::uuid);
  v_doc_type := coalesce(v_new->>'document_type',v_old->>'document_type');
  v_old_status := v_old->>'status';
  v_new_status := v_new->>'status';
  begin v_worker := nullif(coalesce(v_new->>'worker_id',v_old->>'worker_id'),'')::bigint; exception when others then v_worker := null; end;

  if auth.uid() is not null and auth.uid()=v_owner then
    v_actor_type := 'supervisor';
  else
    v_actor_type := 'encargado';
    select coalesce(a.foreman_name,'') into v_actor_name
      from public.foreman_portal_access a
     where a.owner_id=v_owner and lower(a.obra)=lower(v_obra)
     limit 1;
  end if;

  if tg_op='INSERT' then
    if tg_table_name='foreman_portal_access' then v_action := 'access_authorized';
    else v_action := case when v_new_status='completed' then 'created_and_finalized' else 'created' end; end if;
  elsif tg_op='DELETE' then
    v_action := 'deleted';
  elsif tg_table_name='foreman_portal_access' then
    if coalesce((v_old->>'active')::boolean,false) and not coalesce((v_new->>'active')::boolean,false) then
      v_action := 'access_revoked';
    elsif not coalesce((v_old->>'active')::boolean,false) and coalesce((v_new->>'active')::boolean,false) then
      v_action := 'access_authorized';
    elsif (v_old->>'token_hash') is distinct from (v_new->>'token_hash') then
      v_action := 'access_rotated';
    else
      v_action := 'access_updated';
    end if;
  elsif v_old_status is distinct from v_new_status then
    if v_new_status='completed' then v_action := 'finalized';
    elsif v_new_status='reviewed' then v_action := 'reviewed';
    elsif v_new_status='returned' or coalesce((v_new->>'correction_pending')::boolean,false) then v_action := 'returned_for_correction';
    else v_action := 'status_changed'; end if;
  elsif (v_old->'signatures') is distinct from (v_new->'signatures') then
    v_action := 'signature_updated';
  elsif (v_old->'rows') is distinct from (v_new->'rows') then
    v_action := 'attendance_updated';
  elsif (v_old->'answers') is distinct from (v_new->'answers') then
    v_action := 'answers_updated';
  else
    v_action := 'updated';
  end if;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'oldStatus',v_old_status,
    'newStatus',v_new_status,
    'correctionReason',v_new->>'correction_reason',
    'signedCount',case when jsonb_typeof(v_new->'signatures')='object' then jsonb_object_length(v_new->'signatures') else null end,
    'workerCount',case when jsonb_typeof(v_new->'workers')='array' then jsonb_array_length(v_new->'workers') else null end
  ));

  insert into public.foreman_activity_log(
    owner_id,obra,entity_type,entity_id,document_type,action,actor_type,actor_name,worker_id,metadata
  ) values(
    v_owner,v_obra,tg_table_name,v_entity_id,v_doc_type,v_action,v_actor_type,coalesce(v_actor_name,''),v_worker,v_metadata
  );

  if tg_op<>'DELETE'
     and tg_table_name in ('foreman_mandatory_documents','foreman_documents','foreman_attendance_days')
     and v_new_status='completed'
     and (tg_op='INSERT' or v_old_status is distinct from 'completed') then
    select coalesce(max(version_no),0)+1 into v_next_version
      from public.foreman_document_versions
     where owner_id=v_owner and entity_type=tg_table_name and entity_id=v_entity_id;
    insert into public.foreman_document_versions(owner_id,obra,entity_type,entity_id,version_no,snapshot)
    values(v_owner,v_obra,tg_table_name,v_entity_id,v_next_version,v_new);
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists foreman_audit_mandatory on public.foreman_mandatory_documents;
create trigger foreman_audit_mandatory
after insert or update or delete on public.foreman_mandatory_documents
for each row execute function public.foreman_audit_row_change();

drop trigger if exists foreman_audit_documents on public.foreman_documents;
create trigger foreman_audit_documents
after insert or update or delete on public.foreman_documents
for each row execute function public.foreman_audit_row_change();

drop trigger if exists foreman_audit_attendance on public.foreman_attendance_days;
create trigger foreman_audit_attendance
after insert or update or delete on public.foreman_attendance_days
for each row execute function public.foreman_audit_row_change();

drop trigger if exists foreman_audit_access on public.foreman_portal_access;
create trigger foreman_audit_access
after insert or update or delete on public.foreman_portal_access
for each row execute function public.foreman_audit_row_change();

create or replace function public.return_foreman_item_for_correction(
  p_entity_type text,
  p_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_owner uuid := auth.uid();
  v_reason text := trim(coalesce(p_reason,''));
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if v_reason='' then raise exception 'Indica el motivo de la devolución'; end if;

  if p_entity_type='mandatory' then
    update public.foreman_mandatory_documents
       set status='returned', correction_pending=true, correction_reason=v_reason,
           correction_requested_at=now(), reviewed_at=null, completed_at=null, updated_at=now()
     where id=p_id and owner_id=v_owner;
  elsif p_entity_type='attendance' then
    update public.foreman_attendance_days
       set status='draft', correction_pending=true, correction_reason=v_reason,
           correction_requested_at=now(), reviewed_at=null, completed_at=null, updated_at=now()
     where id=p_id and owner_id=v_owner;
  elsif p_entity_type='document' then
    update public.foreman_documents
       set status='draft', correction_pending=true, correction_reason=v_reason,
           correction_requested_at=now(), reviewed_at=null, completed_at=null, updated_at=now()
     where id=p_id and owner_id=v_owner;
  else
    raise exception 'Tipo de elemento no válido';
  end if;

  if not found then raise exception 'Documento no encontrado'; end if;
end;
$$;

create or replace function public.review_foreman_item(
  p_entity_type text,
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if p_entity_type='mandatory' then
    update public.foreman_mandatory_documents set status='reviewed',reviewed_at=now(),updated_at=now()
     where id=p_id and owner_id=v_owner and status='completed';
  elsif p_entity_type='attendance' then
    update public.foreman_attendance_days set status='reviewed',reviewed_at=now(),updated_at=now()
     where id=p_id and owner_id=v_owner and status='completed';
  elsif p_entity_type='document' then
    update public.foreman_documents set status='reviewed',reviewed_at=now(),updated_at=now()
     where id=p_id and owner_id=v_owner and status='completed';
  else
    raise exception 'Tipo de elemento no válido';
  end if;
  if not found then raise exception 'El documento no está disponible para revisión'; end if;
end;
$$;

create or replace function public.resubmit_foreman_document(
  p_token text,
  p_document_id uuid,
  p_answers jsonb,
  p_signatures jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_access public.foreman_portal_access%rowtype;
  v_hash text;
begin
  v_hash:=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
  select * into v_access from public.foreman_portal_access where token_hash=v_hash and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;

  update public.foreman_documents
     set answers=coalesce(p_answers,'{}'::jsonb),
         signatures=coalesce(p_signatures,'{}'::jsonb),
         status='completed',
         completed_at=now(),
         correction_pending=false,
         updated_at=now()
   where id=p_document_id
     and owner_id=v_access.owner_id
     and lower(obra)=lower(v_access.obra)
     and status='draft'
     and correction_pending=true;
  if not found then raise exception 'Documento no disponible para corrección'; end if;
  return p_document_id;
end;
$$;

create or replace function public.sign_foreman_mandatory_document(
  p_token text,
  p_document_id uuid,
  p_worker_id bigint,
  p_signature text
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_access public.foreman_portal_access%rowtype;
  v_doc public.foreman_mandatory_documents%rowtype;
  v_hash text;
  v_signatures jsonb;
  v_total integer;
  v_signed integer;
begin
  v_hash:=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
  select * into v_access from public.foreman_portal_access where token_hash=v_hash and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;

  select * into v_doc from public.foreman_mandatory_documents
   where id=p_document_id and owner_id=v_access.owner_id and lower(obra)=lower(v_access.obra) limit 1;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.status in ('completed','reviewed') then
    raise exception 'Documento bloqueado. El supervisor debe devolverlo para corrección antes de modificarlo';
  end if;
  if not exists(select 1 from jsonb_array_elements(v_doc.workers) w where (w->>'id')::bigint=p_worker_id) then
    raise exception 'Trabajador no incluido en el documento';
  end if;

  v_signatures:=coalesce(v_doc.signatures,'{}'::jsonb)||jsonb_build_object(
    p_worker_id::text,jsonb_build_object('signature',p_signature,'signedAt',now())
  );
  select count(*) into v_total from jsonb_array_elements(v_doc.workers);
  select count(*) into v_signed from jsonb_each(v_signatures);

  update public.foreman_mandatory_documents
     set signatures=v_signatures,status='in_progress',completed_at=null,updated_at=now()
   where id=v_doc.id;

  insert into public.worker_document_evidence(
    owner_id,worker_id,obra,document_id,document_type,work_date,category,signed_at,metadata
  ) values(
    v_access.owner_id,p_worker_id,v_doc.obra,v_doc.id,v_doc.document_type,v_doc.work_date,v_doc.category,now(),
    jsonb_build_object('source','portal_encargado','status','signed','correction',v_doc.correction_pending)
  )
  on conflict(owner_id,worker_id,document_id) do update
    set signed_at=excluded.signed_at,metadata=excluded.metadata;

  return jsonb_build_object('ok',true,'signed',v_signed,'total',v_total,'readyToFinalize',v_signed>=v_total and v_total>0);
end;
$$;

create or replace function public.finalize_foreman_mandatory_document(
  p_token text,
  p_document_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_access public.foreman_portal_access%rowtype;
  v_doc public.foreman_mandatory_documents%rowtype;
  v_hash text;
  v_total integer;
  v_signed integer;
begin
  v_hash:=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
  select * into v_access from public.foreman_portal_access where token_hash=v_hash and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;

  select * into v_doc from public.foreman_mandatory_documents
   where id=p_document_id and owner_id=v_access.owner_id and lower(obra)=lower(v_access.obra) limit 1;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.status in ('completed','reviewed') then raise exception 'El documento ya está bloqueado'; end if;

  select count(*) into v_total from jsonb_array_elements(coalesce(v_doc.workers,'[]'::jsonb));
  select count(*) into v_signed from jsonb_each(coalesce(v_doc.signatures,'{}'::jsonb));
  if v_total=0 or v_signed<v_total then raise exception 'Faltan firmas antes de finalizar el documento'; end if;

  update public.foreman_mandatory_documents
     set status='completed',completed_at=now(),correction_pending=false,updated_at=now()
   where id=v_doc.id;

  return jsonb_build_object('ok',true,'completed',true,'signed',v_signed,'total',v_total);
end;
$$;

create or replace function public.save_foreman_attendance(
  p_token text,
  p_work_date date,
  p_rows jsonb,
  p_status text default 'draft'
)
returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_access public.foreman_portal_access%rowtype;
  v_hash text;
  v_id uuid;
  v_status text;
  v_existing public.foreman_attendance_days%rowtype;
begin
  v_hash:=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
  select * into v_access from public.foreman_portal_access where token_hash=v_hash and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;
  v_status:=case when p_status in ('draft','completed') then p_status else 'draft' end;

  select * into v_existing from public.foreman_attendance_days
   where owner_id=v_access.owner_id and lower(obra)=lower(v_access.obra) and work_date=p_work_date limit 1;
  if found and v_existing.status='reviewed' and not v_existing.correction_pending then
    raise exception 'Jornada bloqueada tras revisión del supervisor';
  end if;
  if found and v_existing.status='completed' and not v_existing.correction_pending then
    raise exception 'Jornada finalizada. El supervisor debe devolverla para corrección';
  end if;

  insert into public.foreman_attendance_days(owner_id,obra,work_date,foreman_name,rows,status,completed_at,updated_at,correction_pending)
  values(v_access.owner_id,v_access.obra,p_work_date,v_access.foreman_name,coalesce(p_rows,'[]'::jsonb),v_status,
    case when v_status='completed' then now() else null end,now(),
    case when v_status='completed' then false else coalesce(v_existing.correction_pending,false) end)
  on conflict(owner_id,obra,work_date) do update
    set rows=excluded.rows,foreman_name=excluded.foreman_name,status=excluded.status,
        completed_at=case when excluded.status='completed' then now() else public.foreman_attendance_days.completed_at end,
        correction_pending=case when excluded.status='completed' then false else public.foreman_attendance_days.correction_pending end,
        updated_at=now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.resolve_foreman_portal(p_token text)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_access public.foreman_portal_access%rowtype;
  v_hash text;
  v_work_start text:='08:00';
  v_work_end text:='15:00';
begin
  v_hash:=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
  select * into v_access from public.foreman_portal_access where token_hash=v_hash and active=true limit 1;
  if not found then return jsonb_build_object('valid',false); end if;
  update public.foreman_portal_access set last_used_at=now() where id=v_access.id;

  select coalesce(nullif(settings #>> '{app,workStartHour}',''),'08:00'),
         coalesce(nullif(settings #>> '{app,workEndHour}',''),'15:00')
    into v_work_start,v_work_end
    from public.user_settings where user_id=v_access.owner_id limit 1;
  v_work_start:=coalesce(v_work_start,'08:00'); v_work_end:=coalesce(v_work_end,'15:00');

  return jsonb_build_object(
    'valid',true,'obra',v_access.obra,'foremanName',v_access.foreman_name,
    'defaultWorkStartHour',v_work_start,'defaultWorkEndHour',v_work_end,
    'workers',coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.id,'apellidosNombre',t.apellidos_nombre,'dni',t.dni,'categoria',t.categoria,'obra',t.obra,
      'numOferta',t.num_oferta,'periodoInicio',t.periodo_inicio,'periodoFin',t.periodo_fin,'telefono',t.telefono
    ) order by t.apellidos_nombre) from public.trabajadores t
      where t.owner_id=v_access.owner_id and lower(t.obra)=lower(v_access.obra)),'[]'::jsonb),
    'attendance',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'workDate',a.work_date,'rows',a.rows,'status',a.status,'completedAt',a.completed_at,'updatedAt',a.updated_at,
      'correctionPending',a.correction_pending,'correctionReason',a.correction_reason,'correctionRequestedAt',a.correction_requested_at
    ) order by a.work_date desc) from public.foreman_attendance_days a
      where a.owner_id=v_access.owner_id and lower(a.obra)=lower(v_access.obra) and a.work_date>=current_date-31),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'workDate',d.work_date,'documentType',d.document_type,'workerId',d.worker_id,'workerSnapshot',d.worker_snapshot,
      'answers',d.answers,'signatures',d.signatures,'status',d.status,'completedAt',d.completed_at,
      'correctionPending',d.correction_pending,'correctionReason',d.correction_reason,'correctionRequestedAt',d.correction_requested_at
    ) order by d.created_at desc) from public.foreman_documents d
      where d.owner_id=v_access.owner_id and lower(d.obra)=lower(v_access.obra) and d.created_at>=now()-interval '90 days'),'[]'::jsonb),
    'mandatoryDocuments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'workDate',m.work_date,'periodKey',m.period_key,'documentType',m.document_type,'category',m.category,
      'workers',m.workers,'signatures',m.signatures,'status',m.status,'completedAt',m.completed_at,'details',m.details,
      'correctionPending',m.correction_pending,'correctionReason',m.correction_reason,'correctionRequestedAt',m.correction_requested_at
    ) order by m.work_date desc,m.document_type,m.category) from public.foreman_mandatory_documents m
      where m.owner_id=v_access.owner_id and lower(m.obra)=lower(v_access.obra) and m.work_date>=current_date-62),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.return_foreman_item_for_correction(text,uuid,text) from public;
revoke all on function public.review_foreman_item(text,uuid) from public;
revoke all on function public.resubmit_foreman_document(text,uuid,jsonb,jsonb) from public;
grant execute on function public.return_foreman_item_for_correction(text,uuid,text) to authenticated;
grant execute on function public.review_foreman_item(text,uuid) to authenticated;
grant execute on function public.resubmit_foreman_document(text,uuid,jsonb,jsonb) to anon,authenticated;
