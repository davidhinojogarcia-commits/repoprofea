-- Corrección controlada de una única firma manuscrita antes de cerrar documentos.
-- El encargado solo puede modificar documentos de su obra con token activo.
-- No se conserva la imagen revocada en el registro: únicamente su hash SHA-256.

create or replace function public.revoke_foreman_operational_worker_signature(
  p_token text,p_document_id uuid,p_worker_id bigint
) returns jsonb language plpgsql security definer
set search_path='' as $
declare
  v_access public.foreman_portal_access%rowtype;
  v_doc public.foreman_mandatory_documents%rowtype;
  v_prior jsonb;
begin
  if p_worker_id is null then raise exception 'Trabajador no válido'; end if;
  select * into v_access from public.foreman_portal_access
   where token_hash=encode(extensions.digest(trim(coalesce(p_token,'')),'sha256'),'hex')
     and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;

  select * into v_doc from public.foreman_mandatory_documents
   where id=p_document_id and owner_id=v_access.owner_id
     and lower(obra)=lower(v_access.obra) for update;
  if not found then raise exception 'Documento fuera de tu obra o inexistente'; end if;
  if v_doc.document_type not in ('epis','formacion','maquinaria','autorizacion_uso_maquinaria')
     or v_doc.lifecycle_status is not null
     or v_doc.v2_initialized_at is not null
     or v_doc.source_gmail_message_id is not null
     or not (v_doc.status in ('pending','in_progress')
             or (v_doc.status='returned' and coalesce(v_doc.correction_pending,false)))
     then raise exception 'Documento enviado o no editable; solicita su devolución al supervisor'; end if;

  if not exists (select 1 from jsonb_array_elements(coalesce(v_doc.workers,'[]'::jsonb)) w
                 where w->>'id'=p_worker_id::text) then
    raise exception 'El trabajador no pertenece a este documento';
  end if;
  v_prior:=coalesce(v_doc.signatures,'{}'::jsonb)->p_worker_id::text;
  if v_prior is null or v_prior='null'::jsonb then
    raise exception 'No hay ninguna firma de este trabajador que revocar';
  end if;

  insert into public.foreman_activity_log(
    owner_id,obra,entity_type,entity_id,document_type,action,actor_type,actor_name,worker_id,metadata
  ) values (
    v_access.owner_id,v_doc.obra,'mandatory',v_doc.id,v_doc.document_type,
    'WORKER_SIGNATURE_REVOKED','encargado',coalesce(v_access.foreman_name,''),p_worker_id,
    jsonb_build_object('signatureSha256',encode(extensions.digest(v_prior::text,'sha256'),'hex'),
                       'statusBefore',v_doc.status,'reason','Corrección de firma errónea')
  );

  update public.foreman_mandatory_documents
     set signatures=coalesce(v_doc.signatures,'{}'::jsonb)-p_worker_id::text,
         status='in_progress',completed_at=null,updated_at=now()
   where id=v_doc.id;
  delete from public.worker_document_evidence
   where owner_id=v_access.owner_id and document_id=v_doc.id and worker_id=p_worker_id;
  update public.foreman_mandatory_pdf_files
     set signed_pdf=null,signed_sha256=null,fidelity=null,updated_at=now()
   where owner_id=v_access.owner_id and document_id=v_doc.id;
  return jsonb_build_object('ok',true,'revoked',true,'documentId',v_doc.id,'workerId',p_worker_id);
end; $$;
revoke all on function public.revoke_foreman_operational_worker_signature(text,uuid,bigint)
 from public;
grant execute on function public.revoke_foreman_operational_worker_signature(text,uuid,bigint)
 to anon,authenticated;

create or replace function public.revoke_foreman_attendance_worker_signature(
  p_token text,p_work_date date,p_worker_id bigint,p_kind text
) returns jsonb language plpgsql security definer
set search_path='' as $
declare
  v_access public.foreman_portal_access%rowtype;
  v_day public.foreman_attendance_days%rowtype;
  v_key text;
  v_prior text;
  v_matches integer;
  v_rows jsonb;
begin
  if p_kind not in ('entry','exit') or p_worker_id is null or p_work_date is null then
    raise exception 'Firma solicitada no válida';
  end if;
  v_key:=case when p_kind='entry' then 'entrySignature' else 'exitSignature' end;
  select * into v_access from public.foreman_portal_access
   where token_hash=encode(extensions.digest(trim(coalesce(p_token,'')),'sha256'),'hex')
     and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;

  select * into v_day from public.foreman_attendance_days
   where owner_id=v_access.owner_id and lower(obra)=lower(v_access.obra)
     and work_date=p_work_date for update;
  if not found then raise exception 'La jornada no está guardada'; end if;
  if v_day.status<>'draft' and not coalesce(v_day.correction_pending,false) then
    raise exception 'Jornada enviada; solicita devolución al supervisor para corregirla';
  end if;

  select count(*),max(e->>v_key) into v_matches,v_prior
    from jsonb_array_elements(coalesce(v_day.rows,'[]'::jsonb)) e
   where e->>'workerId'=p_worker_id::text;
  if v_matches<>1 or nullif(trim(coalesce(v_prior,'')),'') is null then
    raise exception 'No existe una única firma guardada de este trabajador';
  end if;

  select coalesce(jsonb_agg(
    case when e.row->>'workerId'=p_worker_id::text then e.row-v_key else e.row end
    order by e.ord
  ),'[]'::jsonb) into v_rows
  from jsonb_array_elements(coalesce(v_day.rows,'[]'::jsonb))
       with ordinality as e(row,ord);

  insert into public.foreman_activity_log(
    owner_id,obra,entity_type,entity_id,document_type,action,actor_type,actor_name,worker_id,metadata
  ) values (
    v_access.owner_id,v_day.obra,'attendance',v_day.id,'control_horario',
    'WORKER_SIGNATURE_REVOKED','encargado',coalesce(v_access.foreman_name,''),p_worker_id,
    jsonb_build_object('signatureSha256',encode(extensions.digest(v_prior,'sha256'),'hex'),
      'workDate',p_work_date,'kind',p_kind,'statusBefore',v_day.status,
      'foremanSignatureInvalidated',v_day.foreman_signature_evidence is not null)
  );

  update public.foreman_attendance_days
     set rows=v_rows,status='draft',completed_at=null,
         foreman_signature_evidence=null,updated_at=now()
   where id=v_day.id;
  return jsonb_build_object('ok',true,'revoked',true,'workDate',p_work_date,
                            'workerId',p_worker_id,'kind',p_kind);
end; $$;
revoke all on function public.revoke_foreman_attendance_worker_signature(text,date,bigint,text)
 from public;
grant execute on function public.revoke_foreman_attendance_worker_signature(text,date,bigint,text)
 to anon,authenticated;
