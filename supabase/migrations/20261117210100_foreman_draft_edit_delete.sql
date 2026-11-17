-- Edición segura de borradores creados por el encargado (nunca originales asignados).
-- El acceso por token está siempre restringido a propietario + obra activa.
create table if not exists public.foreman_portal_draft_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  obra text not null,
  document_id uuid not null,
  document_group text not null,
  action text not null,
  previous_snapshot jsonb not null,
  recorded_at timestamptz not null default now()
);
create index if not exists foreman_portal_draft_audit_document_idx
  on public.foreman_portal_draft_audit(owner_id,document_id,recorded_at desc);
alter table public.foreman_portal_draft_audit enable row level security;
drop policy if exists foreman_portal_draft_audit_owner_select on public.foreman_portal_draft_audit;
create policy foreman_portal_draft_audit_owner_select on public.foreman_portal_draft_audit
  for select to authenticated using (owner_id=(select auth.uid()));
revoke all on public.foreman_portal_draft_audit from public,anon,authenticated;
grant select on public.foreman_portal_draft_audit to authenticated;

create or replace function public.update_foreman_operational_draft(
  p_token text,p_document_id uuid,p_work_date date,p_worker_ids bigint[],
  p_details jsonb,p_reset_signatures boolean default false
) returns uuid language plpgsql security definer
set search_path=public,extensions as $$
declare
  v_access public.foreman_portal_access%rowtype;
  v_doc public.foreman_mandatory_documents%rowtype;
  v_workers jsonb;
  v_expected integer;
  v_actual integer;
  v_signature_count integer;
begin
  select * into v_access from public.foreman_portal_access
   where token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex') and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;
  select * into v_doc from public.foreman_mandatory_documents
   where id=p_document_id and owner_id=v_access.owner_id and lower(obra)=lower(v_access.obra)
   for update;
  if not found then raise exception 'Documento no encontrado en tu obra'; end if;
  if v_doc.document_type not in ('epis','formacion','maquinaria','autorizacion_uso_maquinaria')
    or coalesce(v_doc.period_key,'') not like 'encargado:%'
    or v_doc.lifecycle_status is not null
    or v_doc.v2_initialized_at is not null
    or v_doc.source_gmail_message_id is not null
    or v_doc.status not in ('pending','in_progress')
    or coalesce(v_doc.correction_pending,false)
    then raise exception 'Solo puedes editar tus documentos preparados que aún no se han enviado'; end if;
  if p_work_date is null or p_details is null or jsonb_typeof(p_details)<>'object'
     or length(p_details::text)>24000 then
    raise exception 'Fecha o información del documento no válida';
  end if;
  v_expected:=coalesce(array_length(p_worker_ids,1),0);
  if v_expected<1 or v_expected>300 or v_expected<>(select count(distinct worker_id) from unnest(p_worker_ids) as ids(worker_id))
    then raise exception 'Selecciona trabajadores válidos y sin duplicados'; end if;
  select count(*),coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'apellidosNombre',t.apellidos_nombre,'dni',t.dni,'categoria',t.categoria,'obra',t.obra,
    'numOferta',t.num_oferta,'periodoInicio',t.periodo_inicio,'periodoFin',t.periodo_fin,
    'calzado',t.calzado,'formacion',t.formacion) order by t.apellidos_nombre),'[]'::jsonb)
    into v_actual,v_workers from public.trabajadores t
   where t.owner_id=v_access.owner_id and lower(t.obra)=lower(v_access.obra)
     and t.id=any(p_worker_ids);
  if v_actual<>v_expected then raise exception 'Hay trabajadores fuera de esta obra'; end if;
  select count(*) into v_signature_count from jsonb_object_keys(coalesce(v_doc.signatures,'{}'::jsonb));
  if v_signature_count>0 and not p_reset_signatures then
    raise exception 'Este documento ya tiene firmas. Confirma su retirada para modificarlo';
  end if;
  insert into public.foreman_portal_draft_audit(owner_id,obra,document_id,document_group,action,previous_snapshot)
  values(v_access.owner_id,v_access.obra,v_doc.id,'operational','EDIT',
    jsonb_build_object('workDate',v_doc.work_date,'workers',v_doc.workers,
      'details',v_doc.details,'signatures',v_doc.signatures,'status',v_doc.status));
  if v_signature_count>0 then
    delete from public.worker_document_evidence where document_id=v_doc.id and owner_id=v_access.owner_id;
  end if;
  update public.foreman_mandatory_documents
     set work_date=p_work_date,workers=v_workers,details=p_details,
         signatures='{}'::jsonb,status='pending',completed_at=null,updated_at=now()
   where id=v_doc.id;
  return v_doc.id;
end; $$;
revoke all on function public.update_foreman_operational_draft(text,uuid,date,bigint[],jsonb,boolean) from public;
grant execute on function public.update_foreman_operational_draft(text,uuid,date,bigint[],jsonb,boolean) to anon,authenticated;

create or replace function public.delete_foreman_operational_draft(
  p_token text,p_document_id uuid
) returns boolean language plpgsql security definer
set search_path=public,extensions as $$
declare v_access public.foreman_portal_access%rowtype;v_doc public.foreman_mandatory_documents%rowtype;
begin
  select * into v_access from public.foreman_portal_access
   where token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex') and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;
  select * into v_doc from public.foreman_mandatory_documents
   where id=p_document_id and owner_id=v_access.owner_id and lower(obra)=lower(v_access.obra) for update;
  if not found then raise exception 'Documento no encontrado en tu obra'; end if;
  if v_doc.document_type not in ('epis','formacion','maquinaria','autorizacion_uso_maquinaria')
    or coalesce(v_doc.period_key,'') not like 'encargado:%'
    or v_doc.lifecycle_status is not null or v_doc.v2_initialized_at is not null
    or v_doc.source_gmail_message_id is not null
    or v_doc.status not in ('pending','in_progress')
    or coalesce(v_doc.correction_pending,false)
    then raise exception 'No se puede eliminar un documento enviado o asignado por el supervisor'; end if;
  insert into public.foreman_portal_draft_audit(owner_id,obra,document_id,document_group,action,previous_snapshot)
  values(v_access.owner_id,v_access.obra,v_doc.id,'operational','DELETE',
    jsonb_build_object('workDate',v_doc.work_date,'documentType',v_doc.document_type,
      'workers',v_doc.workers,'details',v_doc.details,'signatures',v_doc.signatures,'status',v_doc.status));
  delete from public.foreman_mandatory_documents where id=v_doc.id;
  return true;
end; $$;
revoke all on function public.delete_foreman_operational_draft(text,uuid) from public;
grant execute on function public.delete_foreman_operational_draft(text,uuid) to anon,authenticated;

create or replace function public.save_foreman_additional_draft(
  p_token text,p_document_type text,p_work_date date,p_worker_id bigint,
  p_answers jsonb,p_document_id uuid default null
) returns uuid language plpgsql security definer
set search_path=public,extensions as $$
declare
  v_access public.foreman_portal_access%rowtype;
  v_worker public.trabajadores%rowtype;
  v_doc public.foreman_documents%rowtype;
  v_id uuid;
  v_snapshot jsonb;
begin
  select * into v_access from public.foreman_portal_access
   where token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex') and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;
  if p_document_type not in ('baja_voluntaria','ausencia_trabajador','permiso_lactancia',
    'parte_asistencia_fremap','comunicacion_accidente','certificado_trabajando_actualmente',
    'certificado_servicios_prestados') then raise exception 'Tipo de documento no permitido'; end if;
  if p_work_date is null or p_answers is null or jsonb_typeof(p_answers)<>'object'
    or length(p_answers::text)>24000 then raise exception 'Datos de borrador no válidos'; end if;
  select * into v_worker from public.trabajadores
   where id=p_worker_id and owner_id=v_access.owner_id and lower(obra)=lower(v_access.obra) limit 1;
  if not found then raise exception 'Trabajador no válido para esta obra'; end if;
  v_snapshot:=jsonb_build_object(
    'id',v_worker.id,'apellidosNombre',v_worker.apellidos_nombre,'dni',v_worker.dni,
    'categoria',v_worker.categoria,'obra',v_worker.obra,'numOferta',v_worker.num_oferta,
    'periodoInicio',v_worker.periodo_inicio,'periodoFin',v_worker.periodo_fin);
  if p_document_id is null then
    insert into public.foreman_documents(owner_id,obra,work_date,document_type,worker_id,
      worker_snapshot,answers,signatures,completed_by,status,updated_at)
    values(v_access.owner_id,v_access.obra,p_work_date,p_document_type,p_worker_id,v_snapshot,
      p_answers,'{}'::jsonb,v_access.foreman_name,'draft',now()) returning id into v_id;
  else
    select * into v_doc from public.foreman_documents where id=p_document_id
      and owner_id=v_access.owner_id and lower(obra)=lower(v_access.obra) for update;
    if not found or v_doc.status<>'draft' or coalesce(v_doc.correction_pending,false) then
      raise exception 'Solo puedes modificar un borrador sin enviar'; end if;
    insert into public.foreman_portal_draft_audit(owner_id,obra,document_id,document_group,action,previous_snapshot)
      values(v_access.owner_id,v_access.obra,v_doc.id,'additional','EDIT',
      jsonb_build_object('documentType',v_doc.document_type,'workDate',v_doc.work_date,
      'workerId',v_doc.worker_id,'answers',v_doc.answers));
    update public.foreman_documents set document_type=p_document_type,work_date=p_work_date,
      worker_id=p_worker_id,worker_snapshot=v_snapshot,answers=p_answers,
      signatures='{}'::jsonb,updated_at=now() where id=v_doc.id;
    v_id:=v_doc.id;
  end if;
  return v_id;
end; $$;
revoke all on function public.save_foreman_additional_draft(text,text,date,bigint,jsonb,uuid) from public;
grant execute on function public.save_foreman_additional_draft(text,text,date,bigint,jsonb,uuid) to anon,authenticated;

create or replace function public.submit_foreman_additional_draft(
  p_token text,p_document_id uuid,p_answers jsonb,p_signatures jsonb
) returns uuid language plpgsql security definer
set search_path=public,extensions as $$
declare v_access public.foreman_portal_access%rowtype;v_doc public.foreman_documents%rowtype;
begin
  select * into v_access from public.foreman_portal_access
   where token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex') and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;
  select * into v_doc from public.foreman_documents
   where id=p_document_id and owner_id=v_access.owner_id and lower(obra)=lower(v_access.obra)
   for update;
  if not found or v_doc.status<>'draft' or coalesce(v_doc.correction_pending,false) then
    raise exception 'El borrador ya no está disponible para enviarlo'; end if;
  if p_answers is null or jsonb_typeof(p_answers)<>'object' or length(p_answers::text)>24000
    or p_answers is distinct from v_doc.answers
    or p_signatures is null or jsonb_typeof(p_signatures)<>'object'
    or length(coalesce(p_signatures->>'foreman',''))<20
    or (v_doc.document_type in ('baja_voluntaria','ausencia_trabajador','permiso_lactancia',
      'parte_asistencia_fremap','comunicacion_accidente')
      and length(coalesce(p_signatures->>'worker',''))<20)
    then raise exception 'El borrador y las firmas no coinciden o están incompletos'; end if;
  update public.foreman_documents set answers=p_answers,signatures=p_signatures,
    completed_by=v_access.foreman_name,status='completed',completed_at=now(),updated_at=now()
    where id=v_doc.id;
  return v_doc.id;
end; $$;
revoke all on function public.submit_foreman_additional_draft(text,uuid,jsonb,jsonb) from public;
grant execute on function public.submit_foreman_additional_draft(text,uuid,jsonb,jsonb) to anon,authenticated;

create or replace function public.delete_foreman_additional_draft(
  p_token text,p_document_id uuid
) returns boolean language plpgsql security definer
set search_path=public,extensions as $$
declare v_access public.foreman_portal_access%rowtype;v_doc public.foreman_documents%rowtype;
begin
  select * into v_access from public.foreman_portal_access
   where token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex') and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;
  select * into v_doc from public.foreman_documents
   where id=p_document_id and owner_id=v_access.owner_id and lower(obra)=lower(v_access.obra) for update;
  if not found or v_doc.status<>'draft' or coalesce(v_doc.correction_pending,false) then
    raise exception 'Solo puedes eliminar un borrador sin enviar'; end if;
  insert into public.foreman_portal_draft_audit(owner_id,obra,document_id,document_group,action,previous_snapshot)
    values(v_access.owner_id,v_access.obra,v_doc.id,'additional','DELETE',
    jsonb_build_object('documentType',v_doc.document_type,'workDate',v_doc.work_date,
      'workerId',v_doc.worker_id,'answers',v_doc.answers));
  delete from public.foreman_documents where id=v_doc.id;
  return true;
end; $$;
revoke all on function public.delete_foreman_additional_draft(text,uuid) from public;
grant execute on function public.delete_foreman_additional_draft(text,uuid) to anon,authenticated;

create or replace function public.delete_foreman_attendance_draft(
  p_token text,p_work_date date
) returns boolean language plpgsql security definer
set search_path=public,extensions as $$
declare v_access public.foreman_portal_access%rowtype;v_day public.foreman_attendance_days%rowtype;
begin
  select * into v_access from public.foreman_portal_access
   where token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex') and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;
  select * into v_day from public.foreman_attendance_days
   where owner_id=v_access.owner_id and lower(obra)=lower(v_access.obra) and work_date=p_work_date
   for update;
  if not found then raise exception 'No existe jornada guardada'; end if;
  if v_day.status<>'draft' or coalesce(v_day.correction_pending,false) then
    raise exception 'La jornada ya fue enviada o está en revisión'; end if;
  insert into public.foreman_portal_draft_audit(owner_id,obra,document_id,document_group,action,previous_snapshot)
    values(v_access.owner_id,v_access.obra,v_day.id,'attendance','DELETE',
    jsonb_build_object('workDate',v_day.work_date,'rows',v_day.rows,'status',v_day.status));
  delete from public.foreman_attendance_days where id=v_day.id;
  return true;
end; $$;
revoke all on function public.delete_foreman_attendance_draft(text,date) from public;
grant execute on function public.delete_foreman_attendance_draft(text,date) to anon,authenticated;
