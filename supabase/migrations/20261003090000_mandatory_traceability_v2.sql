-- GestionProfea 1.19.0 · Mandatory document traceability V2
-- Additive migration for imported Inicio / Control de presencia documents.
-- The legacy JSON fields remain as transitional mirrors for the current UI,
-- but the normalized V2 tables are the source of truth for identity, signatures,
-- submission versions and semantic traceability.

create extension if not exists pgcrypto;

alter table public.foreman_mandatory_documents
  add column if not exists lifecycle_status text,
  add column if not exists detected_obra text,
  add column if not exists v2_initialized_at timestamptz,
  add column if not exists assigned_at timestamptz,
  add column if not exists received_at timestamptz;

alter table public.foreman_mandatory_documents
  drop constraint if exists foreman_mandatory_documents_lifecycle_status_check;
alter table public.foreman_mandatory_documents
  add constraint foreman_mandatory_documents_lifecycle_status_check
  check (lifecycle_status is null or lifecycle_status in (
    'IMPORTED','ANALYZED','NEEDS_WORKSITE_REVIEW','NEEDS_WORKER_REVIEW',
    'NEEDS_SIGNATURE_POSITION_REVIEW','READY','ASSIGNED','IN_SIGNATURE',
    'SUBMITTED','RECEIVED','REVIEWED','RETURNED_FOR_CORRECTION',
    'PDF_VALIDATION_ERROR','ARCHIVED'
  ));

create table if not exists public.mandatory_document_workers_v2 (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.foreman_mandatory_documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_worker_id bigint,
  printed_name text not null,
  directory_worker_id bigint,
  page integer,
  row_index integer,
  detection_status text not null default 'DETECTED'
    check (detection_status in ('DETECTED','CONFIRMED','REJECTED')),
  detection_confidence numeric check (detection_confidence is null or (detection_confidence>=0 and detection_confidence<=1)),
  position_status text not null default 'PENDING'
    check (position_status in ('PENDING','RESOLVED','REJECTED')),
  position_source text not null default 'AUTO'
    check (position_source in ('AUTO','MANUAL')),
  name_box jsonb,
  signature_box jsonb,
  rejection_reason text,
  frozen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists mandatory_workers_v2_doc_legacy_idx
  on public.mandatory_document_workers_v2(document_id,legacy_worker_id)
  where legacy_worker_id is not null;
create index if not exists mandatory_workers_v2_doc_idx
  on public.mandatory_document_workers_v2(document_id, detection_status, row_index);

create table if not exists public.mandatory_document_signatures_v2 (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.foreman_mandatory_documents(id) on delete cascade,
  document_worker_id uuid not null references public.mandatory_document_workers_v2(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  signature text not null check (signature ~ '^data:image/(png|jpeg|jpg|webp);base64,'),
  signature_sha256 text not null check (signature_sha256 ~ '^[0-9a-f]{64}$'),
  signed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(document_worker_id)
);
create index if not exists mandatory_signatures_v2_doc_idx
  on public.mandatory_document_signatures_v2(document_id);

create table if not exists public.mandatory_document_events_v2 (
  id bigserial primary key,
  document_id uuid not null references public.foreman_mandatory_documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_worker_id uuid references public.mandatory_document_workers_v2(id) on delete set null,
  event_type text not null,
  actor_type text not null default 'sistema' check (actor_type in ('supervisor','encargado','sistema')),
  actor_name text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  dedup_key text,
  created_at timestamptz not null default now()
);
create unique index if not exists mandatory_events_v2_dedup_idx
  on public.mandatory_document_events_v2(document_id,dedup_key)
  where dedup_key is not null;
create index if not exists mandatory_events_v2_doc_created_idx
  on public.mandatory_document_events_v2(document_id,created_at,id);

create table if not exists public.mandatory_document_versions_v2 (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.foreman_mandatory_documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  version_no integer not null check (version_no>0),
  signed_pdf bytea not null,
  signed_sha256 text not null check (signed_sha256 ~ '^[0-9a-f]{64}$'),
  fidelity jsonb not null default '{}'::jsonb,
  signed_count integer not null default 0 check (signed_count>=0),
  required_count integer not null default 0 check (required_count>0),
  submission_mode text not null check (
    (submission_mode='complete' and signed_count=required_count and signed_count>0)
    or (submission_mode='partial' and signed_count>0 and signed_count<required_count)
  ),
  submitted_at timestamptz not null default now(),
  unique(document_id,version_no)
);
create index if not exists mandatory_versions_v2_doc_idx
  on public.mandatory_document_versions_v2(document_id,version_no desc);

alter table public.mandatory_document_workers_v2 enable row level security;
alter table public.mandatory_document_signatures_v2 enable row level security;
alter table public.mandatory_document_events_v2 enable row level security;
alter table public.mandatory_document_versions_v2 enable row level security;

do $$
declare
  table_name text;
begin
  for table_name in select unnest(array[
    'mandatory_document_workers_v2','mandatory_document_signatures_v2',
    'mandatory_document_events_v2','mandatory_document_versions_v2'
  ]) loop
    execute format('drop policy if exists %I on public.%I', table_name||'_owner_select', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id=auth.uid())', table_name||'_owner_select', table_name);
  end loop;
end;
$$;

grant select on public.mandatory_document_workers_v2 to authenticated;
grant select on public.mandatory_document_signatures_v2 to authenticated;
grant select on public.mandatory_document_events_v2 to authenticated;
grant select on public.mandatory_document_versions_v2 to authenticated;

create or replace function public.mandatory_v2_box_valid(p_box jsonb)
returns boolean
language sql
immutable
as $$
  select p_box is not null
    and jsonb_typeof(p_box)='object'
    and coalesce((p_box->>'x')::numeric,-1)>=0
    and coalesce((p_box->>'y')::numeric,-1)>=0
    and coalesce((p_box->>'width')::numeric,0)>0
    and coalesce((p_box->>'height')::numeric,0)>0;
$$;

create or replace function public.mandatory_v2_resolve_preassignment_status(p_document_id uuid)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  v_doc public.foreman_mandatory_documents%rowtype;
  v_detected integer;
  v_confirmed integer;
  v_bad_position integer;
begin
  select * into v_doc from public.foreman_mandatory_documents where id=p_document_id;
  if not found then raise exception 'Documento no encontrado'; end if;
  if coalesce(trim(v_doc.obra),'') in ('','__PENDING_WORKSITE__') then return 'NEEDS_WORKSITE_REVIEW'; end if;

  select
    count(*) filter (where detection_status='DETECTED'),
    count(*) filter (where detection_status='CONFIRMED'),
    count(*) filter (where detection_status='CONFIRMED' and (
      position_status<>'RESOLVED'
      or not public.mandatory_v2_box_valid(signature_box)
      or (position_source<>'MANUAL' and not public.mandatory_v2_box_valid(name_box))
    ))
  into v_detected,v_confirmed,v_bad_position
  from public.mandatory_document_workers_v2
  where document_id=p_document_id;

  if v_detected>0 or v_confirmed=0 then return 'NEEDS_WORKER_REVIEW'; end if;
  if v_bad_position>0 then return 'NEEDS_SIGNATURE_POSITION_REVIEW'; end if;
  return 'READY';
end;
$$;

create or replace function public.mandatory_v2_refresh_legacy_worker_snapshot(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_ids jsonb;
  v_anchors jsonb;
  v_status text;
begin
  select coalesce(jsonb_agg(legacy_worker_id order by row_index nulls last,created_at) filter (where legacy_worker_id is not null),'[]'::jsonb)
  into v_ids
  from public.mandatory_document_workers_v2
  where document_id=p_document_id and detection_status='CONFIRMED';

  select coalesce(jsonb_agg(jsonb_build_object(
      'workerId',coalesce(legacy_worker_id,0),
      'documentWorkerId',id,
      'workerName',printed_name,
      'page',page,
      'order',row_index,
      'resolved',position_status='RESOLVED',
      'confidence',case when position_source='MANUAL' then 1 else detection_confidence end,
      'reason',case when position_source='MANUAL' then 'Posición confirmada manualmente por el supervisor' else null end,
      'positionSource',position_source,
      'nameX',name_box->>'x','nameY',name_box->>'y','nameWidth',name_box->>'width','nameHeight',name_box->>'height',
      'signatureX',signature_box->>'x','signatureY',signature_box->>'y','signatureWidth',signature_box->>'width','signatureHeight',signature_box->>'height'
    ) order by row_index nulls last,created_at),'[]'::jsonb)
  into v_anchors
  from public.mandatory_document_workers_v2
  where document_id=p_document_id and detection_status='CONFIRMED';

  v_status:=public.mandatory_v2_resolve_preassignment_status(p_document_id);
  update public.foreman_mandatory_documents
  set details=coalesce(details,'{}'::jsonb)||jsonb_build_object(
      'importedWorkerIds',v_ids,
      'workerAnchors',v_anchors,
      'documentWorkersV2',(
        select coalesce(jsonb_agg(jsonb_build_object(
          'id',id,'legacyWorkerId',legacy_worker_id,'printedName',printed_name,
          'detectionStatus',detection_status,'positionStatus',position_status,'positionSource',position_source,
          'page',page,'rowIndex',row_index
        ) order by row_index nulls last,created_at),'[]'::jsonb)
        from public.mandatory_document_workers_v2 where document_id=p_document_id
      ),
      'lifecycleStatus',v_status
    ),
    lifecycle_status=v_status,
    updated_at=now()
  where id=p_document_id;
end;
$$;

create or replace function public.initialize_mandatory_document_v2(
  p_document_id uuid,
  p_workers jsonb,
  p_detected_worksite text default null,
  p_lifecycle_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_owner uuid:=auth.uid();
  v_doc public.foreman_mandatory_documents%rowtype;
  v_item jsonb;
  v_id uuid;
  v_status text;
  v_bridge_seq integer:=0;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  select * into v_doc from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_owner for update;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.document_type not in ('inicio','control_presencia') then raise exception 'Tipo de documento no compatible con V2'; end if;
  if v_doc.v2_initialized_at is not null then
    return jsonb_build_object('ok',true,'alreadyInitialized',true,'lifecycleStatus',v_doc.lifecycle_status);
  end if;
  if jsonb_typeof(coalesce(p_workers,'[]'::jsonb))<>'array' then raise exception 'Personas no válidas'; end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_workers,'[]'::jsonb)) loop
    v_bridge_seq:=v_bridge_seq+1;
    insert into public.mandatory_document_workers_v2(
      document_id,owner_id,legacy_worker_id,printed_name,directory_worker_id,page,row_index,
      detection_status,detection_confidence,position_status,position_source,name_box,signature_box,rejection_reason
    ) values(
      p_document_id,v_owner,coalesce(nullif(v_item->>'legacyWorkerId','')::bigint,(-900000000000000::bigint-v_bridge_seq)),
      trim(coalesce(v_item->>'printedName','')),
      nullif(v_item->>'directoryWorkerId','')::bigint,
      nullif(v_item->>'page','')::integer,nullif(v_item->>'rowIndex','')::integer,
      coalesce(nullif(v_item->>'detectionStatus',''),'DETECTED'),
      nullif(v_item->>'detectionConfidence','')::numeric,
      coalesce(nullif(v_item->>'positionStatus',''),'PENDING'),
      case when v_item->>'positionSource'='MANUAL' then 'MANUAL' else 'AUTO' end,
      v_item->'nameBox',v_item->'signatureBox',v_item->>'rejectionReason'
    ) returning id into v_id;

    insert into public.mandatory_document_events_v2(document_id,owner_id,document_worker_id,event_type,actor_type,metadata,dedup_key)
    values(p_document_id,v_owner,v_id,'WORKER_DETECTED','sistema',jsonb_build_object('printedName',v_item->>'printedName'),'worker-detected:'||v_id::text)
    on conflict do nothing;
    if coalesce(v_item->>'detectionStatus','')='CONFIRMED' then
      insert into public.mandatory_document_events_v2(document_id,owner_id,document_worker_id,event_type,actor_type,metadata,dedup_key)
      values(p_document_id,v_owner,v_id,'WORKER_CONFIRMED','sistema','{}'::jsonb,'worker-confirmed:'||v_id::text) on conflict do nothing;
    elsif coalesce(v_item->>'detectionStatus','')='REJECTED' then
      insert into public.mandatory_document_events_v2(document_id,owner_id,document_worker_id,event_type,actor_type,metadata,dedup_key)
      values(p_document_id,v_owner,v_id,'WORKER_REJECTED','sistema','{}'::jsonb,'worker-rejected:'||v_id::text) on conflict do nothing;
    end if;
  end loop;

  update public.foreman_mandatory_documents
  set detected_obra=nullif(trim(coalesce(p_detected_worksite,'')),''),
      v2_initialized_at=now(),
      lifecycle_status='ANALYZED',
      details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus','ANALYZED'),
      updated_at=now()
  where id=p_document_id;

  insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata,dedup_key)
  values(
    p_document_id,v_owner,'IMPORTED','supervisor',
    jsonb_build_object(
      'sourceFilename',coalesce(v_doc.source_attachment_name,v_doc.details->>'sourceFilename',''),
      'originalSha256',coalesce((select f.original_sha256 from public.foreman_mandatory_pdf_files f where f.document_id=p_document_id and f.owner_id=v_owner),'')
    ),
    'imported'
  ) on conflict do nothing;

  insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata,dedup_key)
  values(p_document_id,v_owner,'DOCUMENT_ANALYZED','sistema',jsonb_build_object('detectedWorksite',p_detected_worksite),'document-analyzed') on conflict do nothing;

  if coalesce(trim(v_doc.period_key),'')<>'' then
    insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata,dedup_key)
    values(p_document_id,v_owner,'PERIOD_DETECTED','sistema',jsonb_build_object('periodKey',v_doc.period_key),'period-detected') on conflict do nothing;
  end if;
  if coalesce(trim(p_detected_worksite),'')<>'' then
    insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata,dedup_key)
    values(p_document_id,v_owner,'WORKSITE_DETECTED','sistema',jsonb_build_object('obra',p_detected_worksite),'worksite-detected') on conflict do nothing;
  else
    insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata,dedup_key)
    values(p_document_id,v_owner,'WORKSITE_REVIEW_REQUIRED','sistema','{}'::jsonb,'worksite-review-required') on conflict do nothing;
  end if;

  perform public.mandatory_v2_refresh_legacy_worker_snapshot(p_document_id);
  v_status:=public.mandatory_v2_resolve_preassignment_status(p_document_id);
  -- El estado de entrada se conserva solo por compatibilidad de firma. La fuente de verdad es el cálculo del backend.
  update public.foreman_mandatory_documents set lifecycle_status=v_status,details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus',v_status) where id=p_document_id;
  return jsonb_build_object('ok',true,'lifecycleStatus',v_status);
end;
$$;

create or replace function public.review_mandatory_document_worker_v2(
  p_document_id uuid,
  p_document_worker_id uuid,
  p_action text,
  p_printed_name text default null,
  p_name_box jsonb default null,
  p_signature_box jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_owner uuid:=auth.uid();
  v_doc public.foreman_mandatory_documents%rowtype;
  v_worker public.mandatory_document_workers_v2%rowtype;
  v_status text;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if p_action not in ('confirm','reject') then raise exception 'Acción no válida'; end if;
  select * into v_doc from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_owner for update;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.lifecycle_status in ('ASSIGNED','IN_SIGNATURE','SUBMITTED','RECEIVED','REVIEWED') then raise exception 'El documento ya está congelado'; end if;
  if v_doc.lifecycle_status='RETURNED_FOR_CORRECTION' then
    update public.mandatory_document_workers_v2 set frozen_at=null,updated_at=now() where document_id=p_document_id and owner_id=v_owner and detection_status='CONFIRMED';
    update public.foreman_mandatory_documents set assigned_at=null,updated_at=now() where id=p_document_id and owner_id=v_owner;
  end if;
  select * into v_worker from public.mandatory_document_workers_v2 where id=p_document_worker_id and document_id=p_document_id and owner_id=v_owner for update;
  if not found then raise exception 'Persona no válida'; end if;

  if p_action='reject' then
    update public.mandatory_document_workers_v2
    set detection_status='REJECTED',position_status='REJECTED',name_box=null,signature_box=null,rejection_reason='false_positive',frozen_at=null,updated_at=now()
    where id=p_document_worker_id;
    delete from public.mandatory_document_signatures_v2 where document_worker_id=p_document_worker_id;
    if v_worker.legacy_worker_id is not null then
      update public.foreman_mandatory_documents
      set signatures=coalesce(signatures,'{}'::jsonb)-v_worker.legacy_worker_id::text,updated_at=now()
      where id=p_document_id and owner_id=v_owner;
    end if;
  else
    update public.mandatory_document_workers_v2
    set printed_name=coalesce(nullif(trim(p_printed_name),''),printed_name),
        detection_status='CONFIRMED',
        name_box=coalesce(p_name_box,name_box),
        signature_box=coalesce(p_signature_box,signature_box),
        position_source=case
          when public.mandatory_v2_box_valid(coalesce(p_signature_box,signature_box))
           and not public.mandatory_v2_box_valid(coalesce(p_name_box,name_box)) then 'MANUAL'
          else 'AUTO' end,
        position_status=case when public.mandatory_v2_box_valid(coalesce(p_signature_box,signature_box)) then 'RESOLVED' else 'PENDING' end,
        frozen_at=null,
        updated_at=now()
    where id=p_document_worker_id;
  end if;

  insert into public.mandatory_document_events_v2(document_id,owner_id,document_worker_id,event_type,actor_type,metadata,dedup_key)
  values(
    p_document_id,v_owner,p_document_worker_id,
    case when p_action='reject' then 'WORKER_REJECTED' else 'WORKER_CONFIRMED' end,
    'supervisor',
    jsonb_build_object('printedName',coalesce(p_printed_name,v_worker.printed_name),'nameBox',p_name_box,'signatureBox',p_signature_box),
    case when p_action='reject'
      then 'worker-rejected:'||p_document_worker_id::text
      else 'worker-confirmed:'||p_document_worker_id::text||':'||encode(extensions.digest(coalesce(p_printed_name,v_worker.printed_name,'')||coalesce(p_name_box::text,'')||coalesce(p_signature_box::text,''),'sha256'),'hex')
    end
  )
  on conflict do nothing;

  perform public.mandatory_v2_refresh_legacy_worker_snapshot(p_document_id);
  v_status:=public.mandatory_v2_resolve_preassignment_status(p_document_id);
  update public.foreman_mandatory_documents
  set lifecycle_status=v_status,
      details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus',v_status),
      updated_at=now()
  where id=p_document_id and owner_id=v_owner;
  return jsonb_build_object('ok',true,'lifecycleStatus',v_status);
end;
$$;

create or replace function public.confirm_mandatory_document_worksite_v2(p_document_id uuid,p_obra text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_owner uuid:=auth.uid();
  v_obra text:=trim(coalesce(p_obra,''));
  v_status text;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if v_obra='' then raise exception 'Selecciona una obra'; end if;
  if not exists(select 1 from public.obras where owner_id=v_owner and lower(nombre)=lower(v_obra)) then raise exception 'La obra no pertenece al supervisor'; end if;
  update public.foreman_mandatory_documents
  set obra=v_obra,detected_obra=v_obra,updated_at=now()
  where id=p_document_id and owner_id=v_owner and lifecycle_status='NEEDS_WORKSITE_REVIEW';
  if not found then raise exception 'El documento no está pendiente de clasificación'; end if;
  v_status:=public.mandatory_v2_resolve_preassignment_status(p_document_id);
  update public.foreman_mandatory_documents set lifecycle_status=v_status,details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus',v_status) where id=p_document_id;
  insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata,dedup_key)
  values(p_document_id,v_owner,'WORKSITE_CONFIRMED','supervisor',jsonb_build_object('obra',v_obra),'worksite-confirmed:'||lower(v_obra)) on conflict do nothing;
  return jsonb_build_object('ok',true,'obra',v_obra,'lifecycleStatus',v_status);
end;
$$;

create or replace function public.assign_mandatory_document_v2(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_owner uuid:=auth.uid();
  v_status text;
  v_current_status text;
  v_confirmed integer;
  v_next_version integer;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  select lifecycle_status into v_current_status from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_owner for update;
  if not found then raise exception 'Documento no válido'; end if;
  if coalesce(v_current_status,'') not in ('ANALYZED','NEEDS_WORKSITE_REVIEW','NEEDS_WORKER_REVIEW','NEEDS_SIGNATURE_POSITION_REVIEW','READY','PDF_VALIDATION_ERROR') then
    raise exception 'El documento ya está asignado o cerrado';
  end if;
  v_status:=public.mandatory_v2_resolve_preassignment_status(p_document_id);
  if v_status<>'READY' then raise exception 'El documento todavía necesita revisión antes de asignarse'; end if;
  if v_current_status<>'READY' then
    update public.foreman_mandatory_documents
    set lifecycle_status='READY',details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus','READY'),updated_at=now()
    where id=p_document_id;
  end if;
  select count(*) into v_confirmed from public.mandatory_document_workers_v2 where document_id=p_document_id and detection_status='CONFIRMED';
  if v_confirmed=0 then raise exception 'No hay personas confirmadas'; end if;
  update public.mandatory_document_workers_v2 set frozen_at=coalesce(frozen_at,now()),updated_at=now() where document_id=p_document_id and detection_status='CONFIRMED';
  update public.foreman_mandatory_documents
  set lifecycle_status='ASSIGNED',assigned_at=now(),status='pending',details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus','ASSIGNED'),updated_at=now()
  where id=p_document_id;
  select coalesce(max(version_no),0)+1 into v_next_version from public.mandatory_document_versions_v2 where document_id=p_document_id;
  insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata,dedup_key)
  values(p_document_id,v_owner,'ASSIGNED_TO_FOREMAN','supervisor',jsonb_build_object('confirmedWorkers',v_confirmed,'targetVersion',v_next_version),'assigned:'||v_next_version::text) on conflict do nothing;
  return jsonb_build_object('ok',true,'lifecycleStatus','ASSIGNED','confirmedWorkers',v_confirmed);
end;
$$;

create or replace function public.sign_mandatory_document_worker_v2(
  p_token text,p_document_id uuid,p_document_worker_id uuid,p_signature text
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_hash text;
  v_access public.foreman_portal_access%rowtype;
  v_doc public.foreman_mandatory_documents%rowtype;
  v_worker public.mandatory_document_workers_v2%rowtype;
  v_sig_hash text;
  v_signed integer;
  v_total integer;
  v_target_version integer;
  v_legacy_signatures jsonb;
begin
  if length(trim(coalesce(p_signature,'')))<20
     or p_signature !~ '^data:image/(png|jpeg|jpg|webp);base64,' then
    raise exception 'Firma no válida';
  end if;
  v_hash:=encode(extensions.digest(trim(coalesce(p_token,'')),'sha256'),'hex');
  select * into v_access from public.foreman_portal_access where token_hash=v_hash and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;
  select * into v_doc from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_access.owner_id and lower(obra)=lower(v_access.obra) for update;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.lifecycle_status not in ('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION') then raise exception 'Documento no disponible para firma'; end if;
  select * into v_worker from public.mandatory_document_workers_v2 where id=p_document_worker_id and document_id=p_document_id and owner_id=v_access.owner_id for update;
  if not found or v_worker.detection_status<>'CONFIRMED' or v_worker.frozen_at is null or v_worker.position_status<>'RESOLVED' or not public.mandatory_v2_box_valid(v_worker.signature_box) then raise exception 'Persona o posición de firma no válida'; end if;
  v_sig_hash:=encode(extensions.digest(p_signature,'sha256'),'hex');
  insert into public.mandatory_document_signatures_v2(document_id,document_worker_id,owner_id,signature,signature_sha256,signed_at,updated_at)
  values(p_document_id,p_document_worker_id,v_access.owner_id,p_signature,v_sig_hash,now(),now())
  on conflict(document_worker_id) do update set signature=excluded.signature,signature_sha256=excluded.signature_sha256,signed_at=excluded.signed_at,updated_at=now();

  v_legacy_signatures:=coalesce(v_doc.signatures,'{}'::jsonb);
  if v_worker.legacy_worker_id is not null then
    v_legacy_signatures:=v_legacy_signatures||jsonb_build_object(v_worker.legacy_worker_id::text,jsonb_build_object('signature',p_signature,'signedAt',now(),'documentWorkerId',p_document_worker_id));
  end if;
  update public.foreman_mandatory_documents set signatures=v_legacy_signatures,status='in_progress',lifecycle_status='IN_SIGNATURE',completed_at=null,details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus','IN_SIGNATURE'),updated_at=now() where id=p_document_id;

  select coalesce(max(version_no),0)+1 into v_target_version from public.mandatory_document_versions_v2 where document_id=p_document_id;
  insert into public.mandatory_document_events_v2(document_id,owner_id,document_worker_id,event_type,actor_type,actor_name,metadata,dedup_key)
  values(p_document_id,v_access.owner_id,p_document_worker_id,'WORKER_SIGNED','encargado',coalesce(v_access.foreman_name,''),jsonb_build_object('signatureSha256',v_sig_hash,'targetVersion',v_target_version),'signed:'||p_document_worker_id::text||':v'||v_target_version::text||':'||v_sig_hash)
  on conflict do nothing;
  select count(*) into v_total from public.mandatory_document_workers_v2 where document_id=p_document_id and detection_status='CONFIRMED';
  select count(*) into v_signed
  from public.mandatory_document_signatures_v2 s
  join public.mandatory_document_workers_v2 w on w.id=s.document_worker_id and w.document_id=s.document_id
  where s.document_id=p_document_id and w.detection_status='CONFIRMED';
  return jsonb_build_object('ok',true,'signed',v_signed,'total',v_total,'readyToFinalize',v_signed>0);
end;
$$;

create or replace function public.submit_mandatory_document_v2(
  p_token text,p_document_id uuid,p_pdf_base64 text,p_signed_sha256 text,p_fidelity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_hash text;
  v_access public.foreman_portal_access%rowtype;
  v_doc public.foreman_mandatory_documents%rowtype;
  v_file public.foreman_mandatory_pdf_files%rowtype;
  v_bytes bytea;
  v_sha text;
  v_total integer;
  v_signed integer;
  v_version integer;
  v_mode text;
begin
  v_hash:=encode(extensions.digest(trim(coalesce(p_token,'')),'sha256'),'hex');
  select * into v_access from public.foreman_portal_access where token_hash=v_hash and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;
  select * into v_doc from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_access.owner_id and lower(obra)=lower(v_access.obra) for update;
  if not found then raise exception 'Documento no válido'; end if;

  begin v_bytes:=decode(coalesce(p_pdf_base64,''),'base64'); exception when others then raise exception 'PDF firmado no válido'; end;
  if octet_length(v_bytes)=0 then raise exception 'PDF firmado vacío'; end if;
  v_sha:=encode(extensions.digest(v_bytes,'sha256'),'hex');
  if coalesce(trim(p_signed_sha256),'')<>'' and lower(trim(p_signed_sha256))<>lower(v_sha) then raise exception 'La huella SHA-256 del PDF firmado no coincide'; end if;
  if coalesce((p_fidelity->>'ok')::boolean,false)=false then raise exception 'La verificación de fidelidad no ha sido superada'; end if;

  if v_doc.lifecycle_status in ('SUBMITTED','RECEIVED','REVIEWED') then
    select * into v_file from public.foreman_mandatory_pdf_files where document_id=p_document_id and owner_id=v_access.owner_id;
    if found and lower(coalesce(v_file.signed_sha256,''))=lower(v_sha) then
      return jsonb_build_object('ok',true,'idempotent',true,'signedSha256',v_sha,'lifecycleStatus',v_doc.lifecycle_status);
    end if;
    raise exception 'El documento ya fue enviado con un PDF diferente';
  end if;
  if v_doc.lifecycle_status not in ('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION') then raise exception 'Documento no disponible para envío'; end if;

  select count(*) into v_total from public.mandatory_document_workers_v2 where document_id=p_document_id and detection_status='CONFIRMED';
  select count(*) into v_signed
  from public.mandatory_document_signatures_v2 s
  join public.mandatory_document_workers_v2 w on w.id=s.document_worker_id and w.document_id=s.document_id
  where s.document_id=p_document_id and w.detection_status='CONFIRMED';
  if v_total=0 then raise exception 'El documento no tiene personas confirmadas'; end if;
  if v_signed=0 then raise exception 'Debe existir al menos una firma antes de enviar'; end if;
  v_mode:=case when v_signed<v_total then 'partial' else 'complete' end;

  select * into v_file from public.foreman_mandatory_pdf_files where document_id=p_document_id and owner_id=v_access.owner_id for update;
  if not found or v_file.original_pdf is null then raise exception 'El PDF original no está almacenado'; end if;
  if lower(encode(extensions.digest(v_file.original_pdf,'sha256'),'hex'))<>lower(coalesce(v_file.original_sha256,'')) then
    raise exception 'La huella almacenada del PDF original no coincide con sus bytes';
  end if;
  if lower(coalesce(p_fidelity->>'originalSha256',''))<>lower(v_file.original_sha256) then
    raise exception 'El informe de fidelidad no corresponde al PDF original almacenado';
  end if;
  if coalesce((p_fidelity->>'pageCountMatches')::boolean,false)=false
     or coalesce((p_fidelity->>'dimensionsMatch')::boolean,false)=false
     or coalesce((p_fidelity->>'textMatches')::boolean,false)=false
     or coalesce((p_fidelity->>'visualMismatchRatio')::numeric,1)>0.0025 then
    raise exception 'El informe de fidelidad no supera las comprobaciones estructurales';
  end if;
  select coalesce(max(version_no),0)+1 into v_version from public.mandatory_document_versions_v2 where document_id=p_document_id;
  insert into public.mandatory_document_versions_v2(document_id,owner_id,version_no,signed_pdf,signed_sha256,fidelity,signed_count,required_count,submission_mode)
  values(p_document_id,v_access.owner_id,v_version,v_bytes,v_sha,coalesce(p_fidelity,'{}'::jsonb),v_signed,v_total,v_mode);
  update public.foreman_mandatory_pdf_files set signed_pdf=v_bytes,signed_sha256=v_sha,fidelity=coalesce(p_fidelity,'{}'::jsonb),updated_at=now() where document_id=p_document_id and owner_id=v_access.owner_id;
  insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,actor_name,metadata,dedup_key)
  values(p_document_id,v_access.owner_id,'PDF_VALIDATED','sistema','',jsonb_build_object('signedSha256',v_sha,'version',v_version,'visualMismatchRatio',p_fidelity->>'visualMismatchRatio'),'pdf-validated:'||v_version::text) on conflict do nothing;
  update public.foreman_mandatory_documents
  set status='completed',lifecycle_status='SUBMITTED',completed_at=now(),correction_pending=false,correction_reason=null,correction_requested_at=null,
      details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus','SUBMITTED','submissionMode',v_mode,'submittedSignedCount',v_signed,'submittedRequiredCount',v_total,'signedSha256',v_sha,'submissionVersion',v_version,'submittedAt',now()),updated_at=now()
  where id=p_document_id;
  insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,actor_name,metadata,dedup_key)
  values(p_document_id,v_access.owner_id,'SIGNED_PDF_GENERATED','encargado',coalesce(v_access.foreman_name,''),jsonb_build_object('signedSha256',v_sha,'version',v_version),'pdf-generated:'||v_version::text) on conflict do nothing;
  insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,actor_name,metadata,dedup_key)
  values(p_document_id,v_access.owner_id,'SUBMITTED_BY_FOREMAN','encargado',coalesce(v_access.foreman_name,''),jsonb_build_object('signedSha256',v_sha,'version',v_version,'mode',v_mode,'signed',v_signed,'total',v_total),'submitted:'||v_version::text) on conflict do nothing;
  return jsonb_build_object('ok',true,'signedSha256',v_sha,'version',v_version,'signed',v_signed,'total',v_total,'partial',v_mode='partial','lifecycleStatus','SUBMITTED');
end;
$$;

create or replace function public.get_supervisor_mandatory_signed_pdf_v2(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_owner uuid:=auth.uid();
  v_doc public.foreman_mandatory_documents%rowtype;
  v_file public.foreman_mandatory_pdf_files%rowtype;
  v_version_sha text;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  select * into v_doc from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_owner for update;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.lifecycle_status='RETURNED_FOR_CORRECTION' then raise exception 'El documento está devuelto para corrección; no existe un PDF final vigente'; end if;
  if v_doc.lifecycle_status not in ('SUBMITTED','RECEIVED','REVIEWED') then raise exception 'El documento todavía no ha sido enviado'; end if;
  select * into v_file from public.foreman_mandatory_pdf_files where document_id=p_document_id and owner_id=v_owner;
  if not found or v_file.signed_pdf is null or coalesce(v_file.signed_sha256,'')='' then raise exception 'No existe un PDF firmado persistido'; end if;
  if lower(encode(extensions.digest(v_file.signed_pdf,'sha256'),'hex'))<>lower(v_file.signed_sha256) then raise exception 'El PDF firmado persistido no coincide con su SHA-256'; end if;
  select signed_sha256 into v_version_sha from public.mandatory_document_versions_v2 where document_id=p_document_id order by version_no desc limit 1;
  if coalesce(v_version_sha,'')='' or lower(v_version_sha)<>lower(v_file.signed_sha256) then raise exception 'La versión vigente no coincide con el PDF firmado persistido'; end if;
  if v_doc.lifecycle_status='SUBMITTED' then
    update public.foreman_mandatory_documents set lifecycle_status='RECEIVED',received_at=coalesce(received_at,now()),details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus','RECEIVED'),updated_at=now() where id=p_document_id;
    insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata,dedup_key)
    values(p_document_id,v_owner,'RECEIVED_BY_SUPERVISOR','supervisor',jsonb_build_object('signedSha256',v_file.signed_sha256),'received:'||v_file.signed_sha256) on conflict do nothing;
  end if;
  return jsonb_build_object('base64',encode(v_file.signed_pdf,'base64'),'filename',v_file.original_filename,'sha256',v_file.signed_sha256,'variant','signed','fidelity',v_file.fidelity);
end;
$$;

create or replace function public.return_mandatory_document_v2(p_document_id uuid,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_owner uuid:=auth.uid();
  v_reason text:=trim(coalesce(p_reason,''));
  v_version integer;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if v_reason='' then raise exception 'Indica el motivo de la devolución'; end if;
  update public.foreman_mandatory_documents
  set lifecycle_status='RETURNED_FOR_CORRECTION',status='returned',correction_pending=true,correction_reason=v_reason,correction_requested_at=now(),completed_at=null,reviewed_at=null,
      details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus','RETURNED_FOR_CORRECTION'),updated_at=now()
  where id=p_document_id and owner_id=v_owner and lifecycle_status in ('SUBMITTED','RECEIVED','REVIEWED');
  if not found then raise exception 'Documento no disponible para devolución'; end if;
  select coalesce(max(version_no),0) into v_version from public.mandatory_document_versions_v2 where document_id=p_document_id;
  update public.foreman_mandatory_pdf_files set signed_pdf=null,signed_sha256=null,fidelity=null,updated_at=now() where document_id=p_document_id and owner_id=v_owner;
  insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata,dedup_key)
  values(p_document_id,v_owner,'RETURNED_FOR_CORRECTION','supervisor',jsonb_build_object('reason',v_reason,'previousVersion',v_version),'returned:'||v_version::text||':'||encode(extensions.digest(v_reason,'sha256'),'hex')) on conflict do nothing;
  return jsonb_build_object('ok',true,'lifecycleStatus','RETURNED_FOR_CORRECTION','previousVersion',v_version);
end;
$$;

create or replace function public.review_submitted_mandatory_document_v2(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_owner uuid:=auth.uid();
  v_doc public.foreman_mandatory_documents%rowtype;
  v_file public.foreman_mandatory_pdf_files%rowtype;
  v_version integer:=0;
  v_version_sha text;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  select * into v_doc from public.foreman_mandatory_documents
  where id=p_document_id and owner_id=v_owner and lifecycle_status in ('SUBMITTED','RECEIVED')
  for update;
  if not found then raise exception 'Documento no disponible para revisión'; end if;

  select * into v_file from public.foreman_mandatory_pdf_files
  where document_id=p_document_id and owner_id=v_owner
  for update;
  if not found or v_file.signed_pdf is null or coalesce(v_file.signed_sha256,'')='' then
    raise exception 'No existe un PDF firmado vigente para revisar';
  end if;
  if lower(encode(extensions.digest(v_file.signed_pdf,'sha256'),'hex'))<>lower(v_file.signed_sha256) then
    raise exception 'El PDF firmado vigente no coincide con su SHA-256';
  end if;
  select version_no,signed_sha256 into v_version,v_version_sha
  from public.mandatory_document_versions_v2
  where document_id=p_document_id
  order by version_no desc limit 1;
  if coalesce(v_version,0)=0 or lower(coalesce(v_version_sha,''))<>lower(v_file.signed_sha256) then
    raise exception 'La versión histórica vigente no coincide con el PDF firmado';
  end if;

  if v_doc.lifecycle_status='SUBMITTED' then
    update public.foreman_mandatory_documents
    set lifecycle_status='RECEIVED',received_at=coalesce(received_at,now()),details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus','RECEIVED'),updated_at=now()
    where id=p_document_id and owner_id=v_owner;
    insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata,dedup_key)
    values(p_document_id,v_owner,'RECEIVED_BY_SUPERVISOR','supervisor',jsonb_build_object('signedSha256',v_file.signed_sha256,'implicitFromReview',true),'received:'||v_file.signed_sha256) on conflict do nothing;
  end if;

  update public.foreman_mandatory_documents
  set lifecycle_status='REVIEWED',status='reviewed',reviewed_at=now(),details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus','REVIEWED'),updated_at=now()
  where id=p_document_id and owner_id=v_owner;
  insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata,dedup_key)
  values(p_document_id,v_owner,'REVIEWED','supervisor',jsonb_build_object('version',v_version,'signedSha256',v_file.signed_sha256),'reviewed:'||v_version::text) on conflict do nothing;
  return jsonb_build_object('ok',true,'lifecycleStatus','REVIEWED','version',v_version,'signedSha256',v_file.signed_sha256);
end;
$$;

create or replace function public.reopen_mandatory_document_v2(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_owner uuid:=auth.uid();
  v_status text;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_owner and lifecycle_status='PDF_VALIDATION_ERROR' for update) then
    raise exception 'El documento no está pendiente de reparación';
  end if;
  v_status:=public.mandatory_v2_resolve_preassignment_status(p_document_id);
  update public.foreman_mandatory_documents
  set status='pending',lifecycle_status=v_status,completed_at=null,reviewed_at=null,correction_pending=false,correction_reason=null,correction_requested_at=null,
      details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus',v_status,'legacyRepairReopenedAt',now()),updated_at=now()
  where id=p_document_id;
  update public.foreman_mandatory_pdf_files set signed_pdf=null,signed_sha256=null,fidelity=null,updated_at=now() where document_id=p_document_id and owner_id=v_owner;
  insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata)
  values(p_document_id,v_owner,'REOPENED_FOR_REPAIR','supervisor',jsonb_build_object('nextStatus',v_status));
  return jsonb_build_object('ok',true,'lifecycleStatus',v_status);
end;
$$;

create or replace function public.get_supervisor_mandatory_traceability_v2(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_owner uuid:=auth.uid(); begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_owner) then raise exception 'Documento no válido'; end if;
  return jsonb_build_object(
    'document',(select to_jsonb(d) from public.foreman_mandatory_documents d where d.id=p_document_id),
    'workers',(select coalesce(jsonb_agg(to_jsonb(w) order by w.row_index nulls last,w.created_at),'[]'::jsonb) from public.mandatory_document_workers_v2 w where w.document_id=p_document_id),
    'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]'::jsonb) from public.mandatory_document_events_v2 e where e.document_id=p_document_id),
    'versions',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'versionNo',v.version_no,'signedSha256',v.signed_sha256,'signedCount',v.signed_count,'requiredCount',v.required_count,'submissionMode',v.submission_mode,'submittedAt',v.submitted_at) order by v.version_no),'[]'::jsonb) from public.mandatory_document_versions_v2 v where v.document_id=p_document_id)
  );
end;
$$;

-- Backfill existing imported Inicio / Control documents without changing their visible legacy data.
do $$
declare
  d public.foreman_mandatory_documents%rowtype;
  item jsonb;
  anchor jsonb;
  legacy_id bigint;
  worker_name text;
  worker_uuid uuid;
  sig jsonb;
  life text;
  hist_file public.foreman_mandatory_pdf_files%rowtype;
  hist_sha text;
  hist_signed integer:=0;
  hist_total integer:=0;
  hist_mode text;
  pre_status text;
  bridge_seq integer:=0;
begin
  for d in select * from public.foreman_mandatory_documents where document_type in ('inicio','control_presencia') and v2_initialized_at is null loop
    bridge_seq:=0;
    for item in select value from jsonb_array_elements(coalesce(d.details->'importedWorkers','[]'::jsonb)) loop
      legacy_id:=nullif(item->>'id','')::bigint;
      if legacy_id is null then bridge_seq:=bridge_seq+1; legacy_id:=-900000000000000::bigint-bridge_seq; end if;
      worker_name:=trim(coalesce(item->>'apellidosNombre',''));
      select value into anchor from jsonb_array_elements(coalesce(d.details->'workerAnchors','[]'::jsonb)) where value->>'workerId'=legacy_id::text limit 1;
      insert into public.mandatory_document_workers_v2(document_id,owner_id,legacy_worker_id,printed_name,page,row_index,detection_status,detection_confidence,position_status,position_source,name_box,signature_box,frozen_at)
      values(d.id,d.owner_id,legacy_id,coalesce(nullif(worker_name,''),coalesce(anchor->>'workerName','Persona del documento')),nullif(anchor->>'page','')::integer,nullif(anchor->>'order','')::integer,'CONFIRMED',coalesce(nullif(anchor->>'confidence','')::numeric,1),
        case when coalesce((anchor->>'resolved')::boolean,false) and anchor->>'signatureX' is not null and anchor->>'signatureY' is not null and anchor->>'signatureWidth' is not null and anchor->>'signatureHeight' is not null then 'RESOLVED' else 'PENDING' end,
        case when coalesce((anchor->>'confidence')::numeric,0)>=0.999 or coalesce(anchor->>'reason','') ~* 'confirmada manualmente por el supervisor|identidad confirmada por el supervisor' then 'MANUAL' else 'AUTO' end,
        case when anchor->>'nameX' is not null then jsonb_build_object('x',(anchor->>'nameX')::numeric,'y',(anchor->>'nameY')::numeric,'width',coalesce((anchor->>'nameWidth')::numeric,1),'height',coalesce((anchor->>'nameHeight')::numeric,1)) else null end,
        case when anchor->>'signatureX' is not null then jsonb_build_object('x',(anchor->>'signatureX')::numeric,'y',(anchor->>'signatureY')::numeric,'width',(anchor->>'signatureWidth')::numeric,'height',(anchor->>'signatureHeight')::numeric) else null end,
        case when d.status in ('completed','reviewed') then coalesce(d.completed_at,d.updated_at,now()) else null end)
      on conflict(document_id,legacy_worker_id) where legacy_worker_id is not null do update set printed_name=excluded.printed_name
      returning id into worker_uuid;
      sig:=d.signatures->legacy_id::text;
      if sig is not null and (case when jsonb_typeof(sig)='string' then trim(both '"' from sig::text) else coalesce(sig->>'signature','') end) ~ '^data:image/(png|jpeg|jpg|webp);base64,' then
        insert into public.mandatory_document_signatures_v2(document_id,document_worker_id,owner_id,signature,signature_sha256,signed_at)
        values(d.id,worker_uuid,d.owner_id,case when jsonb_typeof(sig)='string' then trim(both '"' from sig::text) else sig->>'signature' end,
          encode(extensions.digest(case when jsonb_typeof(sig)='string' then trim(both '"' from sig::text) else coalesce(sig->>'signature','') end,'sha256'),'hex'),
          coalesce((sig->>'signedAt')::timestamptz,d.completed_at,d.updated_at,now()))
        on conflict(document_worker_id) do nothing;
      end if;
    end loop;

    -- Historical fallback 1: anchors may exist even when importedWorkers is incomplete.
    for anchor in select value from jsonb_array_elements(coalesce(d.details->'workerAnchors','[]'::jsonb)) loop
      legacy_id:=nullif(anchor->>'workerId','')::bigint;
      if legacy_id is null then continue; end if;
      if exists(select 1 from public.mandatory_document_workers_v2 where document_id=d.id and legacy_worker_id=legacy_id) then continue; end if;
      worker_name:=trim(coalesce(anchor->>'workerName',''));
      insert into public.mandatory_document_workers_v2(document_id,owner_id,legacy_worker_id,printed_name,page,row_index,detection_status,detection_confidence,position_status,position_source,name_box,signature_box,frozen_at)
      values(d.id,d.owner_id,legacy_id,coalesce(nullif(worker_name,''),'Persona incluida en el documento'),nullif(anchor->>'page','')::integer,nullif(anchor->>'order','')::integer,'CONFIRMED',coalesce(nullif(anchor->>'confidence','')::numeric,0.9),
        case when coalesce((anchor->>'resolved')::boolean,false) and anchor->>'signatureX' is not null and anchor->>'signatureY' is not null and anchor->>'signatureWidth' is not null and anchor->>'signatureHeight' is not null then 'RESOLVED' else 'PENDING' end,
        case when coalesce((anchor->>'confidence')::numeric,0)>=0.999 or coalesce(anchor->>'reason','') ~* 'confirmada manualmente por el supervisor|identidad confirmada por el supervisor' then 'MANUAL' else 'AUTO' end,
        case when anchor->>'nameX' is not null then jsonb_build_object('x',(anchor->>'nameX')::numeric,'y',(anchor->>'nameY')::numeric,'width',coalesce((anchor->>'nameWidth')::numeric,1),'height',coalesce((anchor->>'nameHeight')::numeric,1)) else null end,
        case when anchor->>'signatureX' is not null then jsonb_build_object('x',(anchor->>'signatureX')::numeric,'y',(anchor->>'signatureY')::numeric,'width',(anchor->>'signatureWidth')::numeric,'height',(anchor->>'signatureHeight')::numeric) else null end,
        case when d.status in ('completed','reviewed') then coalesce(d.completed_at,d.updated_at,now()) else null end)
      returning id into worker_uuid;
      sig:=d.signatures->legacy_id::text;
      if sig is not null and (case when jsonb_typeof(sig)='string' then trim(both '"' from sig::text) else coalesce(sig->>'signature','') end) ~ '^data:image/(png|jpeg|jpg|webp);base64,' then
        insert into public.mandatory_document_signatures_v2(document_id,document_worker_id,owner_id,signature,signature_sha256,signed_at)
        values(d.id,worker_uuid,d.owner_id,case when jsonb_typeof(sig)='string' then trim(both '"' from sig::text) else sig->>'signature' end,
          encode(extensions.digest(case when jsonb_typeof(sig)='string' then trim(both '"' from sig::text) else coalesce(sig->>'signature','') end,'sha256'),'hex'),
          coalesce((sig->>'signedAt')::timestamptz,d.completed_at,d.updated_at,now()))
        on conflict(document_worker_id) do nothing;
      end if;
    end loop;

    -- Historical fallback 2: keep ids even when neither snapshot nor anchor survived.
    for legacy_id in select value::bigint from jsonb_array_elements_text(coalesce(d.details->'importedWorkerIds','[]'::jsonb)) x(value) where value ~ '^-?[0-9]+$' loop
      if exists(select 1 from public.mandatory_document_workers_v2 where document_id=d.id and legacy_worker_id=legacy_id) then continue; end if;
      insert into public.mandatory_document_workers_v2(document_id,owner_id,legacy_worker_id,printed_name,detection_status,detection_confidence,position_status,frozen_at)
      values(d.id,d.owner_id,legacy_id,'Persona incluida en el documento','DETECTED',null,'PENDING',null)
      returning id into worker_uuid;
      sig:=d.signatures->legacy_id::text;
      if sig is not null and (case when jsonb_typeof(sig)='string' then trim(both '"' from sig::text) else coalesce(sig->>'signature','') end) ~ '^data:image/(png|jpeg|jpg|webp);base64,' then
        insert into public.mandatory_document_signatures_v2(document_id,document_worker_id,owner_id,signature,signature_sha256,signed_at)
        values(d.id,worker_uuid,d.owner_id,case when jsonb_typeof(sig)='string' then trim(both '"' from sig::text) else sig->>'signature' end,
          encode(extensions.digest(case when jsonb_typeof(sig)='string' then trim(both '"' from sig::text) else coalesce(sig->>'signature','') end,'sha256'),'hex'),
          coalesce((sig->>'signedAt')::timestamptz,d.completed_at,d.updated_at,now()))
        on conflict(document_worker_id) do nothing;
      end if;
    end loop;

    if d.status in ('completed','reviewed') then
      select * into hist_file from public.foreman_mandatory_pdf_files where document_id=d.id and owner_id=d.owner_id;
      select count(*) into hist_total from public.mandatory_document_workers_v2 where document_id=d.id and detection_status='CONFIRMED';
      select count(*) into hist_signed
      from public.mandatory_document_signatures_v2 s
      join public.mandatory_document_workers_v2 w on w.id=s.document_worker_id and w.document_id=s.document_id
      where s.document_id=d.id and w.detection_status='CONFIRMED';
      if found and hist_file.signed_pdf is not null and hist_total>0 and hist_signed>0 then
        hist_sha:=encode(extensions.digest(hist_file.signed_pdf,'sha256'),'hex');
        if coalesce(hist_file.signed_sha256,'')='' then
          update public.foreman_mandatory_pdf_files set signed_sha256=hist_sha,updated_at=now() where document_id=d.id;
          hist_file.signed_sha256:=hist_sha;
        end if;
        if lower(coalesce(hist_file.signed_sha256,''))=lower(hist_sha)
           and coalesce((hist_file.fidelity->>'ok')::boolean,false)=true then
          hist_mode:=case when hist_signed<hist_total then 'partial' else 'complete' end;
          insert into public.mandatory_document_versions_v2(document_id,owner_id,version_no,signed_pdf,signed_sha256,fidelity,signed_count,required_count,submission_mode,submitted_at)
          values(d.id,d.owner_id,1,hist_file.signed_pdf,hist_sha,coalesce(hist_file.fidelity,'{}'::jsonb),hist_signed,hist_total,hist_mode,coalesce(d.completed_at,d.updated_at,now()))
          on conflict(document_id,version_no) do nothing;
          life:=case when d.status='reviewed' then 'REVIEWED' else 'SUBMITTED' end;
        else
          life:='PDF_VALIDATION_ERROR';
        end if;
      else
        life:='PDF_VALIDATION_ERROR';
      end if;
    elsif d.status='returned' then
      pre_status:=public.mandatory_v2_resolve_preassignment_status(d.id);
      if pre_status='READY' then
        update public.mandatory_document_workers_v2
        set frozen_at=coalesce(frozen_at,d.correction_requested_at,d.updated_at,now()),updated_at=updated_at
        where document_id=d.id and detection_status='CONFIRMED';
        life:='RETURNED_FOR_CORRECTION';
      else
        life:=pre_status;
      end if;
    else
      life:=public.mandatory_v2_resolve_preassignment_status(d.id);
    end if;
    update public.foreman_mandatory_documents
    set lifecycle_status=life,v2_initialized_at=now(),details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus',life,'legacyBackfill',true,'legacyPdfValidated',life not in ('PDF_VALIDATION_ERROR')),updated_at=updated_at
    where id=d.id;

    insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata,dedup_key)
    values(
      d.id,d.owner_id,'LEGACY_BACKFILLED','sistema',
      jsonb_build_object(
        'legacyStatus',d.status,
        'lifecycleStatus',life,
        'sourceFilename',coalesce(d.source_attachment_name,d.details->>'sourceFilename',''),
        'signedVersionRecovered',exists(select 1 from public.mandatory_document_versions_v2 v where v.document_id=d.id)
      ),
      'legacy-backfill'
    ) on conflict do nothing;
  end loop;
end;
$$;


-- Harden portal payload: V2 mandatory documents are invisible until assigned.
create or replace function public.resolve_foreman_portal(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
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
    into v_work_start,v_work_end from public.user_settings where user_id=v_access.owner_id limit 1;
  v_work_start:=coalesce(v_work_start,'08:00'); v_work_end:=coalesce(v_work_end,'15:00');

  return jsonb_build_object(
    'valid',true,'obra',v_access.obra,'foremanName',v_access.foreman_name,
    'defaultWorkStartHour',v_work_start,'defaultWorkEndHour',v_work_end,
    'worksite',coalesce((select jsonb_build_object(
      'codigo',coalesce(o.codigo,''),'nombre',coalesce(o.nombre,v_access.obra),'municipio',coalesce(o.municipio,''),
      'empresa',coalesce(o.empresa,''),'cif',coalesce(o.cif,''),'recursoPreventivo',coalesce(o.recurso_preventivo,v_access.foreman_name)
    ) from public.obras o where o.owner_id=v_access.owner_id and lower(coalesce(o.nombre,''))=lower(v_access.obra) order by o.updated_at desc limit 1),
    jsonb_build_object('codigo','','nombre',v_access.obra,'municipio','','empresa','','cif','','recursoPreventivo',v_access.foreman_name)),
    'workers',coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.id,'apellidosNombre',t.apellidos_nombre,'dni',t.dni,'categoria',t.categoria,'obra',t.obra,'numOferta',t.num_oferta,
      'quincena',t.quincena,'periodoInicio',t.periodo_inicio,'periodoFin',t.periodo_fin,'telefono',t.telefono,'calzado',t.calzado,
      'formacion',t.formacion,'lugarFormacion',t.lugar_formacion,'aptitudMedica',t.aptitud_medica,'limitacionesAptitud',t.limitaciones_aptitud,
      'reconocimientoEstado',t.reconocimiento_estado,'reconocimientoFecha',t.reconocimiento_fecha,'reconocimientoValidez',t.reconocimiento_validez,
      'reconocimientoLimitaciones',t.reconocimiento_limitaciones,'reconocimientoObservaciones',t.reconocimiento_observaciones
    ) order by t.apellidos_nombre) from public.trabajadores t where t.owner_id=v_access.owner_id and lower(t.obra)=lower(v_access.obra)),'[]'::jsonb),
    'attendance',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'workDate',a.work_date,
      'rows',coalesce((select jsonb_agg(
        (r.row - 'entrySignature' - 'exitSignature')
        || case when length(coalesce(r.row->>'entrySignature',''))>0 then jsonb_build_object('entrySignature','signed') else '{}'::jsonb end
        || case when length(coalesce(r.row->>'exitSignature',''))>0 then jsonb_build_object('exitSignature','signed') else '{}'::jsonb end
        order by r.ord
      ) from jsonb_array_elements(coalesce(a.rows,'[]'::jsonb)) with ordinality as r(row,ord)),'[]'::jsonb),
      'status',a.status,'completedAt',a.completed_at,'updatedAt',a.updated_at,
      'correctionPending',a.correction_pending,'correctionReason',a.correction_reason,'correctionRequestedAt',a.correction_requested_at
    ) order by a.work_date desc) from public.foreman_attendance_days a where a.owner_id=v_access.owner_id and lower(a.obra)=lower(v_access.obra) and a.work_date>=current_date-31),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'workDate',d.work_date,'documentType',d.document_type,'workerId',d.worker_id,'workerSnapshot',d.worker_snapshot,
      'answers',d.answers,'signatures',case when d.correction_pending then d.signatures else coalesce((
        select jsonb_object_agg(k,'signed') from jsonb_object_keys(coalesce(d.signatures,'{}'::jsonb)) k
      ),'{}'::jsonb) end,'status',d.status,'completedAt',d.completed_at,
      'correctionPending',d.correction_pending,'correctionReason',d.correction_reason,'correctionRequestedAt',d.correction_requested_at
    ) order by d.created_at desc) from public.foreman_documents d where d.owner_id=v_access.owner_id and lower(d.obra)=lower(v_access.obra) and d.created_at>=now()-interval '90 days'),'[]'::jsonb),
    'mandatoryDocuments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'workDate',m.work_date,'periodKey',m.period_key,'documentType',m.document_type,'category',m.category,
      'workers',m.workers,'signatures',coalesce((select jsonb_object_agg(k,'signed') from jsonb_object_keys(coalesce(m.signatures,'{}'::jsonb)) k),'{}'::jsonb),
      'status',m.status,'completedAt',m.completed_at,'details',m.details,'lifecycleStatus',m.lifecycle_status,
      'correctionPending',m.correction_pending,'correctionReason',m.correction_reason,'correctionRequestedAt',m.correction_requested_at
    ) order by m.work_date desc,m.document_type,m.category) from public.foreman_mandatory_documents m
      where m.owner_id=v_access.owner_id and lower(m.obra)=lower(v_access.obra) and m.work_date>=current_date-62
        and (m.v2_initialized_at is null or m.lifecycle_status in ('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION','SUBMITTED','RECEIVED','REVIEWED'))
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.resolve_foreman_portal(text) from public;
grant execute on function public.resolve_foreman_portal(text) to anon,authenticated;

revoke all on function public.mandatory_v2_resolve_preassignment_status(uuid) from public,anon,authenticated;
revoke all on function public.mandatory_v2_refresh_legacy_worker_snapshot(uuid) from public,anon,authenticated;

revoke all on function public.initialize_mandatory_document_v2(uuid,jsonb,text,text) from public,anon;

create or replace function public.update_mandatory_document_worker_geometry_v2(
  p_document_id uuid,
  p_document_worker_id uuid,
  p_name_box jsonb,
  p_signature_box jsonb,
  p_page integer default null,
  p_row_index integer default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_owner uuid:=auth.uid();
  v_doc public.foreman_mandatory_documents%rowtype;
  v_worker public.mandatory_document_workers_v2%rowtype;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  select * into v_doc from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_owner for update;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.lifecycle_status in ('ASSIGNED','IN_SIGNATURE','SUBMITTED','RECEIVED','REVIEWED') then
    raise exception 'El documento ya está congelado';
  end if;
  if v_doc.lifecycle_status='RETURNED_FOR_CORRECTION' then
    update public.mandatory_document_workers_v2 set frozen_at=null,updated_at=now() where document_id=p_document_id and owner_id=v_owner and detection_status='CONFIRMED';
    update public.foreman_mandatory_documents set assigned_at=null,updated_at=now() where id=p_document_id and owner_id=v_owner;
  end if;
  if not public.mandatory_v2_box_valid(p_signature_box) then
    raise exception 'La posición de firma debe ser válida';
  end if;
  select * into v_worker from public.mandatory_document_workers_v2
  where id=p_document_worker_id and document_id=p_document_id and owner_id=v_owner and detection_status='CONFIRMED'
  for update;
  if not found then raise exception 'Persona documental no válida'; end if;

  update public.mandatory_document_workers_v2
  set name_box=p_name_box,
      signature_box=p_signature_box,
      position_source=case when public.mandatory_v2_box_valid(p_name_box) then 'AUTO' else 'MANUAL' end,
      page=coalesce(p_page,page),
      row_index=coalesce(p_row_index,row_index),
      position_status='RESOLVED',
      frozen_at=null,
      updated_at=now()
  where id=p_document_worker_id;

  insert into public.mandatory_document_events_v2(document_id,owner_id,document_worker_id,event_type,actor_type,metadata,dedup_key)
  values(p_document_id,v_owner,p_document_worker_id,'SIGNATURE_POSITION_RESOLVED','supervisor',jsonb_build_object('page',p_page,'rowIndex',p_row_index),'geometry:'||p_document_worker_id::text||':'||encode(extensions.digest(coalesce(p_signature_box::text,''),'sha256'),'hex'))
  on conflict do nothing;

  perform public.mandatory_v2_refresh_legacy_worker_snapshot(p_document_id);
  update public.foreman_mandatory_documents
  set lifecycle_status=public.mandatory_v2_resolve_preassignment_status(p_document_id),
      details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus',public.mandatory_v2_resolve_preassignment_status(p_document_id)),
      updated_at=now()
  where id=p_document_id and owner_id=v_owner;
  return jsonb_build_object('ok',true,'lifecycleStatus',public.mandatory_v2_resolve_preassignment_status(p_document_id));
end;
$$;



create or replace function public.guard_mandatory_v2_lifecycle_transition()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if old.v2_initialized_at is not null and new.v2_initialized_at is null then
    raise exception 'No se puede desactivar la trazabilidad V2 de un documento inicializado';
  end if;
  if old.v2_initialized_at is null then
    return new;
  end if;
  if new.lifecycle_status is not distinct from old.lifecycle_status then
    return new;
  end if;

  if old.lifecycle_status='ANALYZED' and new.lifecycle_status in ('NEEDS_WORKSITE_REVIEW','NEEDS_WORKER_REVIEW','NEEDS_SIGNATURE_POSITION_REVIEW','READY') then return new; end if;
  if old.lifecycle_status='NEEDS_WORKSITE_REVIEW' and new.lifecycle_status in ('NEEDS_WORKER_REVIEW','NEEDS_SIGNATURE_POSITION_REVIEW','READY') then return new; end if;
  if old.lifecycle_status='NEEDS_WORKER_REVIEW' and new.lifecycle_status in ('NEEDS_WORKER_REVIEW','NEEDS_SIGNATURE_POSITION_REVIEW','READY') then return new; end if;
  if old.lifecycle_status='NEEDS_SIGNATURE_POSITION_REVIEW' and new.lifecycle_status in ('NEEDS_WORKER_REVIEW','NEEDS_SIGNATURE_POSITION_REVIEW','READY') then return new; end if;
  if old.lifecycle_status='READY' and new.lifecycle_status in ('NEEDS_WORKER_REVIEW','NEEDS_SIGNATURE_POSITION_REVIEW','READY','ASSIGNED') then return new; end if;
  if old.lifecycle_status='ASSIGNED' and new.lifecycle_status in ('IN_SIGNATURE','SUBMITTED') then return new; end if;
  if old.lifecycle_status='IN_SIGNATURE' and new.lifecycle_status in ('IN_SIGNATURE','SUBMITTED') then return new; end if;
  if old.lifecycle_status='SUBMITTED' and new.lifecycle_status in ('RECEIVED','REVIEWED','RETURNED_FOR_CORRECTION') then return new; end if;
  if old.lifecycle_status='RECEIVED' and new.lifecycle_status in ('REVIEWED','RETURNED_FOR_CORRECTION') then return new; end if;
  if old.lifecycle_status='REVIEWED' and new.lifecycle_status='RETURNED_FOR_CORRECTION' then return new; end if;
  if old.lifecycle_status='RETURNED_FOR_CORRECTION' and new.lifecycle_status in ('IN_SIGNATURE','SUBMITTED','NEEDS_WORKER_REVIEW','NEEDS_SIGNATURE_POSITION_REVIEW','READY') then return new; end if;
  if old.lifecycle_status='PDF_VALIDATION_ERROR' and new.lifecycle_status in ('NEEDS_WORKSITE_REVIEW','NEEDS_WORKER_REVIEW','NEEDS_SIGNATURE_POSITION_REVIEW','READY') then return new; end if;

  raise exception 'Transición V2 no permitida: % -> %',coalesce(old.lifecycle_status,'NULL'),coalesce(new.lifecycle_status,'NULL');
end;
$$;

drop trigger if exists trg_guard_mandatory_v2_lifecycle_transition on public.foreman_mandatory_documents;
create trigger trg_guard_mandatory_v2_lifecycle_transition
before update of lifecycle_status,v2_initialized_at on public.foreman_mandatory_documents
for each row
execute function public.guard_mandatory_v2_lifecycle_transition();

revoke all on function public.guard_mandatory_v2_lifecycle_transition() from public,anon,authenticated;

revoke all on function public.update_mandatory_document_worker_geometry_v2(uuid,uuid,jsonb,jsonb,integer,integer) from public,anon;
grant execute on function public.update_mandatory_document_worker_geometry_v2(uuid,uuid,jsonb,jsonb,integer,integer) to authenticated;

revoke all on function public.review_mandatory_document_worker_v2(uuid,uuid,text,text,jsonb,jsonb) from public,anon;
revoke all on function public.confirm_mandatory_document_worksite_v2(uuid,text) from public,anon;
revoke all on function public.assign_mandatory_document_v2(uuid) from public,anon;
revoke all on function public.sign_mandatory_document_worker_v2(text,uuid,uuid,text) from public;
revoke all on function public.submit_mandatory_document_v2(text,uuid,text,text,jsonb) from public;
revoke all on function public.get_supervisor_mandatory_signed_pdf_v2(uuid) from public,anon;
revoke all on function public.return_mandatory_document_v2(uuid,text) from public,anon;
revoke all on function public.review_submitted_mandatory_document_v2(uuid) from public,anon;
revoke all on function public.reopen_mandatory_document_v2(uuid) from public,anon;
revoke all on function public.get_supervisor_mandatory_traceability_v2(uuid) from public,anon;

grant execute on function public.initialize_mandatory_document_v2(uuid,jsonb,text,text) to authenticated;
grant execute on function public.review_mandatory_document_worker_v2(uuid,uuid,text,text,jsonb,jsonb) to authenticated;
grant execute on function public.confirm_mandatory_document_worksite_v2(uuid,text) to authenticated;
grant execute on function public.assign_mandatory_document_v2(uuid) to authenticated;
grant execute on function public.sign_mandatory_document_worker_v2(text,uuid,uuid,text) to anon,authenticated;
grant execute on function public.submit_mandatory_document_v2(text,uuid,text,text,jsonb) to anon,authenticated;
grant execute on function public.get_supervisor_mandatory_signed_pdf_v2(uuid) to authenticated;
grant execute on function public.return_mandatory_document_v2(uuid,text) to authenticated;
grant execute on function public.review_submitted_mandatory_document_v2(uuid) to authenticated;
grant execute on function public.reopen_mandatory_document_v2(uuid) to authenticated;
grant execute on function public.get_supervisor_mandatory_traceability_v2(uuid) to authenticated;
