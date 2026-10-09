-- Explicit supervisor publication, selective revocation and safe row placement.
-- Existing live documents remain visible; future imports stay as drafts.
-- No polling, duplicate PDFs or new signature image history is introduced.

create or replace function public.mandatory_v2_validate_signature_geometry(p_document_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare
  a public.mandatory_document_workers_v2%rowtype;
  b public.mandatory_document_workers_v2%rowtype;
  v_pages jsonb; v_page jsonb;
  ax numeric; ay numeric; aw numeric; ah numeric;
  bx numeric; by_ numeric; bw numeric; bh numeric;
  own_center numeric; other_center numeric;
begin
  select page_meta into v_pages from public.foreman_mandatory_pdf_files where document_id=p_document_id;
  for a in select * from public.mandatory_document_workers_v2 where document_id=p_document_id and detection_status='CONFIRMED' loop
    if not public.mandatory_v2_box_valid(a.signature_box) then raise exception 'Falta una posición válida para %',a.printed_name; end if;
    ax:=(a.signature_box->>'x')::numeric;ay:=(a.signature_box->>'y')::numeric;
    aw:=(a.signature_box->>'width')::numeric;ah:=(a.signature_box->>'height')::numeric;
    select value into v_page from jsonb_array_elements(coalesce(v_pages,'[]'::jsonb)) where (value->>'page')::integer=a.page;
    if v_page is null or ax+aw>(v_page->>'width')::numeric or ay+ah>(v_page->>'height')::numeric then
      raise exception 'La firma de % queda fuera de la página. Revisa las posiciones o reimporta el original.',a.printed_name;
    end if;
    for b in select * from public.mandatory_document_workers_v2 where document_id=p_document_id and detection_status='CONFIRMED' and id<>a.id and page=a.page loop
      if public.mandatory_v2_box_valid(b.signature_box) then
        bx:=(b.signature_box->>'x')::numeric;by_:=(b.signature_box->>'y')::numeric;
        bw:=(b.signature_box->>'width')::numeric;bh:=(b.signature_box->>'height')::numeric;
        if ax<bx+bw+2 and ax+aw+2>bx and ay<by_+bh+2 and ay+ah+2>by_ then
          raise exception 'La firma de % solapa con la de %. Corrige las posiciones antes de enviar.',a.printed_name,b.printed_name;
        end if;
      end if;
      if public.mandatory_v2_box_valid(b.name_box) then
        bx:=(b.name_box->>'x')::numeric;by_:=(b.name_box->>'y')::numeric;
        bw:=(b.name_box->>'width')::numeric;bh:=(b.name_box->>'height')::numeric;
        if ax<bx+bw+2 and ax+aw+2>bx and ay<by_+bh+2 and ay+ah+2>by_ then
          raise exception 'La firma de % invade el nombre de %.',a.printed_name,b.printed_name;
        end if;
        if public.mandatory_v2_box_valid(a.name_box) then
          own_center:=(a.name_box->>'y')::numeric+(a.name_box->>'height')::numeric/2;
          other_center:=by_+bh/2;
          if abs(ay+ah/2-other_center)+1<abs(ay+ah/2-own_center) then
            raise exception 'La firma de % queda en una fila más cercana a %. Corrige su posición.',a.printed_name,b.printed_name;
          end if;
        end if;
      end if;
    end loop;
  end loop;
end;
$$;
revoke all on function public.mandatory_v2_validate_signature_geometry(uuid) from public,anon,authenticated;

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
  if old.lifecycle_status in ('ASSIGNED','IN_SIGNATURE') and new.lifecycle_status='RETURNED_FOR_CORRECTION' then return new; end if;
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

create or replace function public.withdraw_mandatory_document_v2(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_owner uuid:=auth.uid();v_doc public.foreman_mandatory_documents%rowtype;v_status text;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  select * into v_doc from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_owner for update;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.lifecycle_status not in ('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION') then
    raise exception 'El documento no está disponible para retirar del portal';
  end if;
  -- Compatible with the state machine, atomic: no intermediate state is visible.
  update public.foreman_mandatory_documents set lifecycle_status='RETURNED_FOR_CORRECTION' where id=p_document_id;
  update public.mandatory_document_workers_v2 set frozen_at=null,updated_at=now() where document_id=p_document_id and owner_id=v_owner;
  v_status:=public.mandatory_v2_resolve_preassignment_status(p_document_id);
  update public.foreman_mandatory_documents
  set lifecycle_status=v_status,assigned_at=null,status='pending',completed_at=null,correction_pending=false,correction_reason=null,
      details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus',v_status),updated_at=now()
  where id=p_document_id;
  update public.foreman_mandatory_pdf_files set signed_pdf=null,signed_sha256=null,fidelity=null,updated_at=now() where document_id=p_document_id and owner_id=v_owner;
  insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata)
  values(p_document_id,v_owner,'WITHDRAWN_FROM_PORTAL','supervisor','{}'::jsonb);
  return jsonb_build_object('ok',true,'lifecycleStatus',v_status);
end;
$$;
revoke all on function public.withdraw_mandatory_document_v2(uuid) from public,anon;
grant execute on function public.withdraw_mandatory_document_v2(uuid) to authenticated;

create or replace function public.revoke_mandatory_signature_v2(p_token text,p_document_id uuid,p_document_worker_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_access public.foreman_portal_access%rowtype;v_doc public.foreman_mandatory_documents%rowtype;
  v_worker public.mandatory_document_workers_v2%rowtype;v_removed integer;
begin
  select * into v_access from public.foreman_portal_access
  where token_hash=encode(extensions.digest(trim(coalesce(p_token,'')),'sha256'),'hex') and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;
  select * into v_doc from public.foreman_mandatory_documents
  where id=p_document_id and owner_id=v_access.owner_id and lower(obra)=lower(v_access.obra) for update;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.lifecycle_status not in ('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION') then
    raise exception 'El documento ya fue enviado o retirado. El supervisor debe devolverlo antes de revocar firmas';
  end if;
  select * into v_worker from public.mandatory_document_workers_v2
  where id=p_document_worker_id and document_id=p_document_id and owner_id=v_access.owner_id and detection_status='CONFIRMED' for update;
  if not found then raise exception 'Persona documental no válida'; end if;
  delete from public.mandatory_document_signatures_v2 where document_id=p_document_id and document_worker_id=p_document_worker_id and owner_id=v_access.owner_id;
  get diagnostics v_removed=row_count;
  update public.foreman_mandatory_documents
  set signatures=coalesce(signatures,'{}'::jsonb)-coalesce(v_worker.legacy_worker_id::text,''),completed_at=null,updated_at=now()
  where id=p_document_id;
  update public.foreman_mandatory_pdf_files set signed_pdf=null,signed_sha256=null,fidelity=null,updated_at=now() where document_id=p_document_id and owner_id=v_access.owner_id;
  if v_removed>0 then
    insert into public.mandatory_document_events_v2(document_id,owner_id,document_worker_id,event_type,actor_type,actor_name,metadata)
    values(p_document_id,v_access.owner_id,p_document_worker_id,'SIGNATURE_REVOKED','encargado',coalesce(v_access.foreman_name,''),'{}'::jsonb);
  end if;
  return jsonb_build_object('ok',true,'revoked',v_removed>0);
end;
$$;
revoke all on function public.revoke_mandatory_signature_v2(text,uuid,uuid) from public;
grant execute on function public.revoke_mandatory_signature_v2(text,uuid,uuid) to anon,authenticated;

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
  perform public.mandatory_v2_validate_signature_geometry(p_document_id);
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
  if v_signed<v_total then raise exception 'Faltan firmas obligatorias. Completa todas antes de enviar'; end if;
  perform public.mandatory_v2_validate_signature_geometry(p_document_id);
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

create or replace function public.guard_signed_mandatory_worker_identity_v2()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if (new.printed_name is distinct from old.printed_name or new.page is distinct from old.page or new.legacy_worker_id is distinct from old.legacy_worker_id)
     and exists(select 1 from public.mandatory_document_signatures_v2 where document_worker_id=old.id) then
    raise exception 'Este trabajador ya ha firmado. Revoca su firma antes de cambiar su identidad o página';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_signed_mandatory_worker_identity_v2() from public,anon,authenticated;
drop trigger if exists guard_signed_mandatory_worker_identity_v2 on public.mandatory_document_workers_v2;
create trigger guard_signed_mandatory_worker_identity_v2 before update on public.mandatory_document_workers_v2
for each row execute function public.guard_signed_mandatory_worker_identity_v2();

CREATE OR REPLACE FUNCTION public.resolve_foreman_portal(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
        and ((m.document_type not in ('inicio','control_presencia') and m.v2_initialized_at is null) or m.lifecycle_status in ('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION','SUBMITTED','RECEIVED','REVIEWED'))
    ),'[]'::jsonb)
  );
end;
$function$

;

notify pgrst,'reload schema';
