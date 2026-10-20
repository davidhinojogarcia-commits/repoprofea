-- Offline signatures use the same token authorization as the existing mobile portal.
-- Receipts and version helpers are not exposed as readable tables or public helpers.
create schema if not exists foreman_private;
revoke all on schema foreman_private from public,anon,authenticated;
create table if not exists foreman_private.offline_receipts(
 operation_id uuid primary key,access_id uuid not null,document_id uuid not null,
 payload_hash text not null,received_at timestamptz not null default now()
);
alter table foreman_private.offline_receipts enable row level security;
revoke all on foreman_private.offline_receipts from public,anon,authenticated;

create or replace function foreman_private.document_version(p_id uuid) returns text
language sql stable security invoker set search_path=public,extensions as $$
 select encode(digest(jsonb_build_object(
 'owner',d.owner_id,'obra',d.obra,'type',d.document_type,'period',d.period_key,
 'date',d.work_date,'workers',d.workers,
 'details',coalesce(d.details,'{}'::jsonb)-array['lifecycleStatus','submissionMode','submittedSignedCount','submittedRequiredCount','signedSha256','submissionVersion','submittedAt'],
 'original',f.original_sha256,
 'positions',(select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'name',w.printed_name,'legacy',w.legacy_worker_id,'status',w.detection_status,'position',w.position_status,'box',w.signature_box,'page',w.page) order by w.id),'[]') from public.mandatory_document_workers_v2 w where w.document_id=d.id)
 )::text,'sha256'),'hex')
 from public.foreman_mandatory_documents d left join public.foreman_mandatory_pdf_files f on f.document_id=d.id where d.id=p_id;
$$;
revoke all on function foreman_private.document_version(uuid) from public,anon,authenticated;

create or replace function public.get_foreman_offline_snapshot(p_token text,p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a public.foreman_portal_access%rowtype;d public.foreman_mandatory_documents%rowtype;p jsonb;
begin
 select * into a from public.foreman_portal_access where active and token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex') for share;
 if not found then raise exception 'Acceso no válido o revocado';end if;
 select * into d from public.foreman_mandatory_documents where id=p_document_id and owner_id=a.owner_id and lower(obra)=lower(a.obra) for share;
 if not found or d.lifecycle_status='ARCHIVED' or (d.details->>'originalPdfMode'='overlay' and (d.assigned_at is null or d.lifecycle_status not in ('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION','SUBMITTED','RECEIVED','REVIEWED'))) then raise exception 'Documento no disponible';end if;
 if exists(select 1 from public.foreman_mandatory_pdf_files where document_id=d.id) then
 p:=public.get_foreman_mandatory_pdf(p_token,p_document_id,case when d.status in ('completed','reviewed') then 'signed' else 'original' end);
 elsif d.details->>'originalPdfMode'='overlay' then raise exception 'No se encuentra el PDF original';
 end if;
 return jsonb_build_object('id',d.id,'version',foreman_private.document_version(d.id),'pdf',p,'document',jsonb_build_object('id',d.id,'documentType',d.document_type,'periodKey',d.period_key,'workDate',d.work_date,'workers',d.workers,'signatures',d.signatures,'status',d.status,'details',coalesce(d.details,'{}'::jsonb)||jsonb_build_object('foremanSignature',(select signature from public.foreman_document_signatures where document_id=d.id)),'obra',d.obra),'downloadedAt',now());
end $$;

create or replace function public.sync_foreman_offline_signature(
 p_token text,p_operation_id uuid,p_document_id uuid,p_version text,p_signature text,
 p_worker_id bigint default null,p_document_worker_id uuid default null,p_foreman boolean default false)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a public.foreman_portal_access%rowtype;d public.foreman_mandatory_documents%rowtype;
 r foreman_private.offline_receipts%rowtype;h text;existing text;result jsonb;
begin
 select * into a from public.foreman_portal_access where active and token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex') for share;
 if not found then raise exception 'Acceso no válido o revocado';end if;
 select * into d from public.foreman_mandatory_documents where id=p_document_id and owner_id=a.owner_id and lower(obra)=lower(a.obra) for update;
 if not found then raise exception 'Documento no disponible';end if;
 if p_operation_id is null or p_foreman is null or length(coalesce(p_signature,''))<100 or length(p_signature)>350000 or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' then raise exception 'Firma no válida';end if;
 h:=encode(digest(jsonb_build_array(p_document_id,p_version,p_signature,p_worker_id,p_document_worker_id,p_foreman)::text,'sha256'),'hex');
 select * into r from foreman_private.offline_receipts where operation_id=p_operation_id;
 if found then
   if r.access_id<>a.id or r.document_id<>d.id or r.payload_hash<>h then raise exception 'Operación incompatible';end if;
   return jsonb_build_object('ok',true,'duplicate',true,'receivedAt',r.received_at);
 end if;
 if d.lifecycle_status='ARCHIVED' or d.status in ('completed','reviewed') or (d.details->>'originalPdfMode'='overlay' and (d.assigned_at is null or d.lifecycle_status not in ('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION'))) then raise exception 'Documento no disponible para firma';end if;
 if p_version is distinct from foreman_private.document_version(d.id) then raise exception 'Documento modificado. Es necesario revisarlo.';end if;
 if p_foreman then
   select signature into existing from public.foreman_document_signatures where document_id=d.id;
 else
   existing:=case when jsonb_typeof(d.signatures->p_worker_id::text)='string' then d.signatures->>p_worker_id::text else d.signatures#>>array[p_worker_id::text,'signature'] end;
 end if;
 if coalesce(existing,'')<>'' and existing<>p_signature then raise exception 'Ya existe otra firma. Es necesario revisar el documento.';end if;
 if coalesce(existing,'')='' then
   if p_foreman then result:=public.sign_foreman_document_as_foreman(p_token,d.id,p_signature);
   elsif d.document_type in ('inicio','control_presencia','contrato','prorroga') then
     if not exists(select 1 from public.mandatory_document_workers_v2 where id=p_document_worker_id and document_id=d.id and legacy_worker_id=p_worker_id) then raise exception 'Persona no válida';end if;
     result:=public.sign_mandatory_document_worker_v2(p_token,d.id,p_document_worker_id,p_signature);
   else perform public.sign_foreman_mandatory_document(p_token,d.id,p_worker_id,p_signature);
   end if;
 end if;
 insert into foreman_private.offline_receipts(operation_id,access_id,document_id,payload_hash) values(p_operation_id,a.id,d.id,h);
 return jsonb_build_object('ok',true,'receivedAt',now());
end $$;
revoke all on function public.get_foreman_offline_snapshot(text,uuid),public.sync_foreman_offline_signature(text,uuid,uuid,text,text,bigint,uuid,boolean) from public;
grant execute on function public.get_foreman_offline_snapshot(text,uuid),public.sync_foreman_offline_signature(text,uuid,uuid,text,text,bigint,uuid,boolean) to anon,authenticated;

-- Corrections use a different imported document. Original PDFs and signatures stay intact.
create table if not exists public.foreman_document_change_requests(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,access_id uuid not null,
 document_id uuid not null references public.foreman_mandatory_documents(id),
 action text not null check(action in ('rectify','replace','annul','withdraw')),
 reason text not null check(length(trim(reason)) between 3 and 2000),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 replacement_id uuid references public.foreman_mandatory_documents(id),
 created_at timestamptz not null default now(),resolved_at timestamptz,resolved_by uuid
);
alter table public.foreman_document_change_requests enable row level security;
revoke all on public.foreman_document_change_requests from public,anon,authenticated;
grant select on public.foreman_document_change_requests to authenticated;
drop policy if exists foreman_changes_owner_read on public.foreman_document_change_requests;
create policy foreman_changes_owner_read on public.foreman_document_change_requests for select to authenticated using(owner_id=(select auth.uid()));
create index if not exists foreman_changes_pending_idx on public.foreman_document_change_requests(owner_id,status,created_at desc);
create unique index if not exists foreman_changes_one_pending on public.foreman_document_change_requests(document_id,access_id,action) where status='pending';

create or replace function public.request_foreman_document_change(p_token text,p_document_id uuid,p_action text,p_reason text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare a public.foreman_portal_access%rowtype;d public.foreman_mandatory_documents%rowtype;r uuid;
begin
 select * into a from public.foreman_portal_access where active and token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex') for share;
 if not found then raise exception 'Acceso no válido o revocado';end if;
 select * into d from public.foreman_mandatory_documents where id=p_document_id and owner_id=a.owner_id and lower(obra)=lower(a.obra) for share;
 if not found or d.lifecycle_status='ARCHIVED' or (d.details->>'originalPdfMode'='overlay' and d.assigned_at is null) then raise exception 'Documento no disponible';end if;
 if p_action not in ('rectify','replace','annul','withdraw') or length(trim(coalesce(p_reason,''))) not between 3 and 2000 then raise exception 'Indica un motivo de entre 3 y 2000 caracteres';end if;
 insert into public.foreman_document_change_requests(owner_id,access_id,document_id,action,reason)
 values(a.owner_id,a.id,d.id,p_action,trim(p_reason))
 on conflict(document_id,access_id,action) where status='pending' do nothing returning id into r;
 if r is null then select id into r from public.foreman_document_change_requests where document_id=d.id and access_id=a.id and action=p_action and status='pending';end if;
 return r;
end $$;

create or replace function public.resolve_foreman_document_change(p_request_id uuid,p_approve boolean,p_replacement_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.foreman_document_change_requests%rowtype;d public.foreman_mandatory_documents%rowtype;n public.foreman_mandatory_documents%rowtype;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select * into r from public.foreman_document_change_requests where id=p_request_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Solicitud no autorizada';end if;
 if r.status<>'pending' then return jsonb_build_object('ok',true,'status',r.status);end if;
 select * into d from public.foreman_mandatory_documents where id=r.document_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Documento no autorizado';end if;
 if p_approve is null then raise exception 'Confirma la decisión';end if;
 if p_approve then
   if r.action in ('rectify','replace') then
     select * into n from public.foreman_mandatory_documents where id=p_replacement_id and id<>d.id and owner_id=d.owner_id and lower(obra)=lower(d.obra) for update;
     if not found or coalesce(n.signatures,'{}'::jsonb)<>'{}'::jsonb or n.status in ('completed','reviewed') or exists(select 1 from public.foreman_document_signatures where document_id=n.id) then raise exception 'Selecciona una nueva versión sin firmas de la misma obra';end if;
     if exists(select 1 from public.mandatory_document_signatures_v2 where document_id=n.id) then raise exception 'La nueva versión ya contiene firmas';end if;
     update public.foreman_mandatory_documents set details=coalesce(details,'{}'::jsonb)||jsonb_build_object('previousDocumentId',d.id,'revisionReason',r.reason),updated_at=now() where id=n.id;
   end if;
   update public.foreman_mandatory_documents set lifecycle_status='ARCHIVED',assigned_at=null,
     details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus','ARCHIVED','documentDisposition',r.action,'dispositionReason',r.reason,'replacementDocumentId',n.id,'dispositionAt',now(),'dispositionBy',auth.uid()),updated_at=now() where id=d.id;
   insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata)
   values(d.id,d.owner_id,'DOCUMENT_'||upper(r.action),'supervisor',jsonb_build_object('requestId',r.id,'reason',r.reason,'replacementId',n.id));
 end if;
 update public.foreman_document_change_requests set status=case when p_approve then 'approved' else 'rejected' end,replacement_id=case when p_approve then n.id else null end,resolved_by=auth.uid(),resolved_at=now() where id=r.id;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.get_foreman_document_changes(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a public.foreman_portal_access%rowtype;
begin
 select * into a from public.foreman_portal_access where active and token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
 if not found then raise exception 'Acceso no válido o revocado';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'documentId',r.document_id,'action',r.action,'reason',r.reason,'status',r.status,'replacementId',r.replacement_id,'createdAt',r.created_at,'resolvedAt',r.resolved_at) order by r.created_at desc)
 from public.foreman_document_change_requests r join public.foreman_mandatory_documents d on d.id=r.document_id where r.owner_id=a.owner_id and lower(d.obra)=lower(a.obra)),'[]'::jsonb);
end $$;
revoke all on function public.request_foreman_document_change(text,uuid,text,text),public.get_foreman_document_changes(text),public.resolve_foreman_document_change(uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.request_foreman_document_change(text,uuid,text,text),public.get_foreman_document_changes(text) to anon,authenticated;
grant execute on function public.resolve_foreman_document_change(uuid,boolean,uuid) to authenticated;

create or replace function foreman_private.attendance_version(p_rows jsonb,p_template jsonb) returns text
language sql immutable set search_path=public,extensions as $$
 select encode(digest(jsonb_build_object('rows',coalesce(jsonb_agg(row-array['entrySignature','exitSignature'] order by row->>'workerId'),'[]'),'template',p_template)::text,'sha256'),'hex') from jsonb_array_elements(p_rows) row;
$$;
revoke all on function foreman_private.attendance_version(jsonb,jsonb) from public,anon,authenticated;
create or replace function public.get_foreman_offline_attendance(p_token text,p_work_date date)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a public.foreman_portal_access%rowtype;d public.foreman_attendance_days%rowtype;
begin
 select * into a from public.foreman_portal_access where active and token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex') for share;
 if not found then raise exception 'Acceso no válido o revocado';end if;
 select * into d from public.foreman_attendance_days where owner_id=a.owner_id and lower(obra)=lower(a.obra) and work_date=p_work_date for share;
 if not found then raise exception 'Guarda la jornada con conexión antes de prepararla sin cobertura';end if;
 return jsonb_build_object('id',d.id,'workDate',d.work_date,'rows',d.rows,'version',foreman_private.attendance_version(d.rows,d.foreman_signature_template),'status',d.status);
end $$;
create or replace function public.sync_foreman_offline_attendance(p_token text,p_operation_id uuid,p_work_date date,p_version text,p_signature text,p_worker_id bigint,p_kind text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a public.foreman_portal_access%rowtype;d public.foreman_attendance_days%rowtype;r foreman_private.offline_receipts%rowtype;h text;existing text;compact jsonb;
begin
 select * into a from public.foreman_portal_access where active and token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex') for share;
 if not found then raise exception 'Acceso no válido o revocado';end if;
 select * into d from public.foreman_attendance_days where owner_id=a.owner_id and lower(obra)=lower(a.obra) and work_date=p_work_date for update;
 if not found then raise exception 'Jornada no disponible';end if;
 if p_operation_id is null or p_kind is null or p_kind not in ('entry','exit','foreman') or length(coalesce(p_signature,''))<100 or length(p_signature)>350000 or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' then raise exception 'Firma no válida';end if;
 h:=encode(digest(jsonb_build_array(d.id,p_version,p_signature,p_worker_id,p_kind)::text,'sha256'),'hex');
 select * into r from foreman_private.offline_receipts where operation_id=p_operation_id;
 if found then
  if r.access_id<>a.id or r.document_id<>d.id or r.payload_hash<>h then raise exception 'Operación incompatible';end if;
  return jsonb_build_object('ok',true,'duplicate',true);
 end if;
 if d.status in ('completed','reviewed') then raise exception 'Jornada no disponible para firma';end if;
 if p_version is distinct from foreman_private.attendance_version(d.rows,d.foreman_signature_template) then raise exception 'Documento modificado. Es necesario revisar la jornada.';end if;
 if p_kind='foreman' then existing:=d.foreman_signature_evidence->>'signature';
 else
  select row->>case when p_kind='entry' then 'entrySignature' else 'exitSignature' end into existing from jsonb_array_elements(d.rows) row where row->>'workerId'=p_worker_id::text;
  if not found then raise exception 'Persona no válida';end if;
 end if;
 if coalesce(existing,'')<>'' and existing<>p_signature then raise exception 'Ya existe otra firma. Es necesario revisar la jornada.';end if;
 if coalesce(existing,'')='' then
  if p_kind='foreman' then perform public.sign_attendance_as_foreman(p_token,p_work_date,p_signature);
  else
   select jsonb_agg(row-array['entrySignature','exitSignature']) into compact from jsonb_array_elements(d.rows) row;
   perform public.sign_foreman_attendance(p_token,p_work_date,compact,p_worker_id,p_kind,p_signature);
  end if;
 end if;
 insert into foreman_private.offline_receipts(operation_id,access_id,document_id,payload_hash) values(p_operation_id,a.id,d.id,h);
 return jsonb_build_object('ok',true,'receivedAt',now());
end $$;
revoke all on function public.get_foreman_offline_attendance(text,date),public.sync_foreman_offline_attendance(text,uuid,date,text,text,bigint,text) from public;
grant execute on function public.get_foreman_offline_attendance(text,date),public.sync_foreman_offline_attendance(text,uuid,date,text,text,bigint,text) to anon,authenticated;

-- Serialize legacy online writes with offline reconciliation. Validation/business logic
-- remains in the original implementations, now private and callable only by wrappers.
do $$begin
 if to_regprocedure('foreman_private.sign_document_legacy(text,uuid,bigint,text)') is null then
  alter function public.sign_foreman_mandatory_document(text,uuid,bigint,text) set schema foreman_private;
  alter function foreman_private.sign_foreman_mandatory_document(text,uuid,bigint,text) rename to sign_document_legacy;
 end if;
 if to_regprocedure('foreman_private.sign_attendance_legacy(text,date,jsonb,bigint,text,text)') is null then
  alter function public.sign_foreman_attendance(text,date,jsonb,bigint,text,text) set schema foreman_private;
  alter function foreman_private.sign_foreman_attendance(text,date,jsonb,bigint,text,text) rename to sign_attendance_legacy;
 end if;
end $$;
revoke all on function foreman_private.sign_document_legacy(text,uuid,bigint,text),foreman_private.sign_attendance_legacy(text,date,jsonb,bigint,text,text) from public,anon,authenticated;
create or replace function public.sign_foreman_mandatory_document(p_token text,p_document_id uuid,p_worker_id bigint,p_signature text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
begin
 perform 1 from public.foreman_mandatory_documents d join public.foreman_portal_access a on a.owner_id=d.owner_id and lower(a.obra)=lower(d.obra)
 where d.id=p_document_id and a.active and a.token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex') for update of d;
 if not found then raise exception 'Documento no disponible o acceso revocado';end if;
 return foreman_private.sign_document_legacy(p_token,p_document_id,p_worker_id,p_signature);
end $$;
create or replace function public.sign_foreman_attendance(p_token text,p_work_date date,p_rows jsonb,p_worker_id bigint,p_kind text,p_signature text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
begin
 perform 1 from public.foreman_attendance_days d join public.foreman_portal_access a on a.owner_id=d.owner_id and lower(a.obra)=lower(d.obra)
 where d.work_date=p_work_date and a.active and a.token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex') for update of d;
 -- The legacy function also handles the first online signature before a day exists.
 return foreman_private.sign_attendance_legacy(p_token,p_work_date,p_rows,p_worker_id,p_kind,p_signature);
end $$;
revoke all on function public.sign_foreman_mandatory_document(text,uuid,bigint,text),public.sign_foreman_attendance(text,date,jsonb,bigint,text,text) from public;
grant execute on function public.sign_foreman_mandatory_document(text,uuid,bigint,text),public.sign_foreman_attendance(text,date,jsonb,bigint,text,text) to anon,authenticated;
do $$begin
 if to_regprocedure('foreman_private.save_attendance_legacy(text,date,jsonb,text)') is null then
  alter function public.save_foreman_attendance(text,date,jsonb,text) set schema foreman_private;
  alter function foreman_private.save_foreman_attendance(text,date,jsonb,text) rename to save_attendance_legacy;
 end if;
end $$;
revoke all on function foreman_private.save_attendance_legacy(text,date,jsonb,text) from public,anon,authenticated;
create or replace function public.save_foreman_attendance(p_token text,p_work_date date,p_rows jsonb,p_status text default 'draft')
returns uuid language plpgsql security definer set search_path=public,extensions as $$
begin
 perform 1 from public.foreman_attendance_days d join public.foreman_portal_access a on a.owner_id=d.owner_id and lower(a.obra)=lower(d.obra)
 where d.work_date=p_work_date and a.active and a.token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex') for update of d;
 return foreman_private.save_attendance_legacy(p_token,p_work_date,p_rows,p_status);
end $$;
revoke all on function public.save_foreman_attendance(text,date,jsonb,text) from public;
grant execute on function public.save_foreman_attendance(text,date,jsonb,text) to anon,authenticated;
