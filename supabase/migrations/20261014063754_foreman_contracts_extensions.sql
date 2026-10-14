-- Extend the existing imported-original and V2 circuit. No new table or public RPC.
-- Definitions preserve current production fixes and existing ownership/token checks.
alter table public.foreman_mandatory_documents drop constraint if exists foreman_mandatory_documents_document_type_check;
alter table public.foreman_mandatory_documents add constraint foreman_mandatory_documents_document_type_check
check (document_type in ('inicio','control_presencia','contrato','prorroga','epis','formacion','maquinaria','autorizacion_uso_maquinaria'));

-- save_foreman_mandatory_original_pdf
CREATE OR REPLACE FUNCTION public.save_foreman_mandatory_original_pdf(p_document_id uuid, p_pdf_base64 text, p_filename text, p_original_sha256 text, p_page_meta jsonb, p_worker_anchors jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_owner uuid := auth.uid();
  v_doc public.foreman_mandatory_documents%rowtype;
  v_file public.foreman_mandatory_pdf_files%rowtype;
  v_original_bytes bytea;
  v_computed_sha text;
  v_unresolved integer := 0;
begin
  if v_owner is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_doc
  from public.foreman_mandatory_documents
  where id=p_document_id
    and owner_id=v_owner
  for update;

  if not found then
    raise exception 'Documento no válido';
  end if;
  if v_doc.document_type not in ('inicio','control_presencia','contrato','prorroga') then
    raise exception 'Este modo solo se aplica a Inicio y Control de presencia';
  end if;
  if jsonb_typeof(coalesce(p_worker_anchors,'[]'::jsonb))<>'array' then
    raise exception 'Metadatos de posiciones no válidos';
  end if;

  begin
    v_original_bytes := decode(coalesce(p_pdf_base64,''),'base64');
  exception when others then
    raise exception 'El PDF original no tiene un formato binario válido';
  end;

  if octet_length(v_original_bytes)=0 then
    raise exception 'El PDF original está vacío';
  end if;

  v_computed_sha := encode(digest(v_original_bytes,'sha256'),'hex');
  if coalesce(trim(p_original_sha256),'')<>''
     and lower(trim(p_original_sha256))<>lower(v_computed_sha) then
    raise exception 'La huella SHA-256 del PDF original no coincide';
  end if;

  select *
    into v_file
  from public.foreman_mandatory_pdf_files
  where document_id=p_document_id
    and owner_id=v_owner;

  if found then
    if coalesce(v_file.original_sha256,'')<>v_computed_sha
       and exists (select 1 from jsonb_object_keys(coalesce(v_doc.signatures,'{}'::jsonb))) then
      raise exception 'Este documento ya contiene firmas. El PDF original no puede sustituirse por otro archivo distinto';
    end if;

    if coalesce(v_file.original_sha256,'')=v_computed_sha
       and exists (select 1 from jsonb_object_keys(coalesce(v_doc.signatures,'{}'::jsonb))) then
      return jsonb_build_object(
        'ok',true,
        'preserved',true,
        'originalSha256',v_computed_sha,
        'message','El mismo PDF original ya estaba almacenado; se conservan sus firmas y posiciones.'
      );
    end if;
  elsif v_doc.status in ('completed','reviewed') then
    raise exception 'Un documento ya finalizado no puede convertirse después al modo PDF original';
  end if;

  select count(*)
    into v_unresolved
  from jsonb_array_elements(coalesce(p_worker_anchors,'[]'::jsonb)) anchor
  where coalesce((anchor->>'resolved')::boolean,false)=false
     or coalesce(anchor->>'workerId','') !~ '^[1-9][0-9]*$';

  insert into public.foreman_mandatory_pdf_files(
    document_id,owner_id,original_pdf,signed_pdf,original_filename,original_sha256,
    signed_sha256,page_meta,fidelity,updated_at
  ) values(
    p_document_id,v_owner,v_original_bytes,null,coalesce(p_filename,''),
    v_computed_sha,null,coalesce(p_page_meta,'[]'::jsonb),null,now()
  )
  on conflict(document_id) do update set
    original_pdf=excluded.original_pdf,
    signed_pdf=null,
    original_filename=excluded.original_filename,
    original_sha256=excluded.original_sha256,
    signed_sha256=null,
    page_meta=excluded.page_meta,
    fidelity=null,
    updated_at=now();

  update public.foreman_mandatory_documents
     set details=coalesce(details,'{}'::jsonb) || jsonb_build_object(
       'originalPdfMode','overlay',
       'originalPdfStored',true,
       'originalFilename',coalesce(p_filename,''),
       'originalSha256',v_computed_sha,
       'pageMeta',coalesce(p_page_meta,'[]'::jsonb),
       'workerAnchors',coalesce(p_worker_anchors,'[]'::jsonb),
       'unresolvedAnchorCount',v_unresolved
     ),
     updated_at=now()
   where id=p_document_id;

  return jsonb_build_object(
    'ok',true,
    'originalSha256',v_computed_sha,
    'unresolvedAnchorCount',v_unresolved
  );
end;
$function$;

revoke all on function public.save_foreman_mandatory_original_pdf(uuid,text,text,text,jsonb,jsonb) from public;
revoke all on function public.save_foreman_mandatory_original_pdf(uuid,text,text,text,jsonb,jsonb) from anon;
grant execute on function public.save_foreman_mandatory_original_pdf(uuid,text,text,text,jsonb,jsonb) to authenticated;

-- sign_foreman_mandatory_document
CREATE OR REPLACE FUNCTION public.sign_foreman_mandatory_document(p_token text, p_document_id uuid, p_worker_id bigint, p_signature text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_access public.foreman_portal_access%rowtype;
  v_doc public.foreman_mandatory_documents%rowtype;
  v_hash text;
  v_signatures jsonb;
  v_workers jsonb;
  v_worker jsonb;
  v_total integer;
  v_signed integer;
  v_allowed boolean := false;
begin
  if length(trim(coalesce(p_signature,''))) < 20 then raise exception 'Firma no válida'; end if;

  v_hash := encode(digest(trim(coalesce(p_token,'')), 'sha256'), 'hex');
  select * into v_access from public.foreman_portal_access
  where token_hash=v_hash and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;

  select * into v_doc
  from public.foreman_mandatory_documents
  where id=p_document_id
    and owner_id=v_access.owner_id
    and lower(obra)=lower(v_access.obra)
  limit 1;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.document_type in ('contrato','prorroga') then raise exception 'Utiliza el circuito V2 de contratos y prórrogas'; end if;
  if v_doc.status in ('completed','reviewed') and not coalesce(v_doc.correction_pending,false) then
    raise exception 'El documento ya está finalizado';
  end if;

  v_workers := coalesce(v_doc.workers,'[]'::jsonb);

  if v_doc.document_type in ('inicio','control_presencia') then
    select exists(
      select 1
      from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb)) x(worker_id)
      where x.worker_id=p_worker_id::text
    ) into v_allowed;
    if not v_allowed then raise exception 'Esta persona no aparece en el documento importado'; end if;

    select w into v_worker
    from jsonb_array_elements(coalesce(v_doc.details->'importedWorkers','[]'::jsonb)) w
    where w->>'id'=p_worker_id::text
    limit 1;

    if v_worker is null then
      select jsonb_build_object(
        'id',t.id,'apellidosNombre',t.apellidos_nombre,'dni',t.dni,
        'categoria',t.categoria,'obra',v_doc.obra,'numOferta',t.num_oferta,
        'periodoInicio',t.periodo_inicio,'periodoFin',t.periodo_fin
      ) into v_worker
      from public.trabajadores t
      where t.owner_id=v_access.owner_id and t.id=p_worker_id
      limit 1;
    end if;

    if v_worker is null then raise exception 'No se han podido recuperar los datos de esta persona'; end if;

    if not exists(select 1 from jsonb_array_elements(v_workers) w where w->>'id'=p_worker_id::text) then
      v_workers:=v_workers||jsonb_build_array(v_worker);
    end if;
  else
    if not exists(select 1 from jsonb_array_elements(v_workers) w where w->>'id'=p_worker_id::text) then
      raise exception 'Trabajador no incluido en el documento';
    end if;
  end if;

  v_signatures:=coalesce(v_doc.signatures,'{}'::jsonb)||jsonb_build_object(
    p_worker_id::text,jsonb_build_object('signature',p_signature,'signedAt',now())
  );

  if v_doc.document_type in ('inicio','control_presencia') then
    select count(*) into v_total
    from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb));
    select count(*) into v_signed
    from jsonb_object_keys(v_signatures) key
    where exists(
      select 1 from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb)) x(worker_id)
      where x.worker_id=key
    );
  else
    select count(*) into v_total from jsonb_array_elements(v_workers);
    select count(*) into v_signed from jsonb_object_keys(v_signatures);
  end if;

  update public.foreman_mandatory_documents
  set workers=v_workers,signatures=v_signatures,status='in_progress',completed_at=null,updated_at=now()
  where id=v_doc.id;

  insert into public.worker_document_evidence(
    owner_id,worker_id,obra,document_id,document_type,work_date,category,signed_at,metadata
  ) values(
    v_access.owner_id,p_worker_id,v_doc.obra,v_doc.id,v_doc.document_type,v_doc.work_date,v_doc.category,now(),
    jsonb_build_object('source','portal_encargado','status','signed','documentLocal',p_worker_id<0)
  )
  on conflict(owner_id,worker_id,document_id) do update
    set signed_at=excluded.signed_at,metadata=excluded.metadata;

  return jsonb_build_object('ok',true,'signed',v_signed,'total',v_total,'readyToFinalize',v_signed>=v_total and v_total>0);
end;
$function$;

revoke all on function public.sign_foreman_mandatory_document(text,uuid,bigint,text) from public;
grant execute on function public.sign_foreman_mandatory_document(text,uuid,bigint,text) to anon,authenticated;

-- add_missing_mandatory_document_worker_v2
CREATE OR REPLACE FUNCTION public.add_missing_mandatory_document_worker_v2(p_document_id uuid, p_printed_name text, p_page integer, p_row_index integer, p_signature_box jsonb, p_name_box jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_owner uuid:=auth.uid();
  v_doc public.foreman_mandatory_documents%rowtype;
  v_name text:=regexp_replace(trim(coalesce(p_printed_name,'')),'\s+',' ','g');
  v_worker_id uuid;
  v_legacy_worker_id bigint;
  v_status text;
  v_keep_active boolean:=false;
  v_ids jsonb;
  v_anchors jsonb;
  v_workers jsonb;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if length(v_name)<3 then raise exception 'Indica el nombre y apellidos que aparecen en el PDF'; end if;
  if coalesce(p_page,0)<1 then raise exception 'Página no válida'; end if;
  if coalesce(p_row_index,-1)<0 then raise exception 'Fila no válida'; end if;
  if not public.mandatory_v2_box_valid(p_signature_box) then raise exception 'La posición de firma debe ser válida'; end if;

  select * into v_doc
  from public.foreman_mandatory_documents
  where id=p_document_id and owner_id=v_owner
  for update;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.document_type not in ('inicio','control_presencia','contrato','prorroga') then raise exception 'Tipo de documento no compatible'; end if;
  if v_doc.v2_initialized_at is null then raise exception 'La trazabilidad V2 del documento no está inicializada'; end if;
  if v_doc.lifecycle_status in ('SUBMITTED','RECEIVED','REVIEWED') then
    raise exception 'El documento ya fue enviado y no admite nuevas personas';
  end if;

  if exists(
    select 1
    from public.mandatory_document_workers_v2
    where document_id=p_document_id
      and detection_status='CONFIRMED'
      and lower(regexp_replace(trim(printed_name),'\s+',' ','g'))=lower(v_name)
      and coalesce(page,1)=p_page
  ) then
    raise exception 'Ese trabajador ya figura en este documento';
  end if;

  if v_doc.lifecycle_status='RETURNED_FOR_CORRECTION' then
    update public.mandatory_document_workers_v2
    set frozen_at=null,updated_at=now()
    where document_id=p_document_id and owner_id=v_owner and detection_status='CONFIRMED';
    update public.foreman_mandatory_documents
    set assigned_at=null,updated_at=now()
    where id=p_document_id and owner_id=v_owner;
  end if;

  v_keep_active:=v_doc.lifecycle_status in ('ASSIGNED','IN_SIGNATURE');

  select coalesce(min(legacy_worker_id) filter (where legacy_worker_id<0),-900000000000000::bigint)-1
  into v_legacy_worker_id
  from public.mandatory_document_workers_v2
  where document_id=p_document_id;

  insert into public.mandatory_document_workers_v2(
    document_id,owner_id,legacy_worker_id,printed_name,directory_worker_id,page,row_index,
    detection_status,detection_confidence,position_status,position_source,name_box,signature_box,
    rejection_reason,frozen_at,created_at,updated_at
  ) values(
    p_document_id,v_owner,v_legacy_worker_id,v_name,null,p_page,p_row_index,
    'CONFIRMED',null,'RESOLVED','MANUAL',p_name_box,p_signature_box,
    null,case when v_keep_active then now() else null end,now(),now()
  )
  returning id into v_worker_id;

  insert into public.mandatory_document_events_v2(
    document_id,owner_id,document_worker_id,event_type,actor_type,metadata,dedup_key
  ) values(
    p_document_id,v_owner,v_worker_id,'WORKER_ADDED_MANUALLY','supervisor',
    jsonb_build_object(
      'printedName',v_name,
      'page',p_page,
      'rowIndex',p_row_index,
      'signatureBox',p_signature_box,
      'source','pdf_manual_recovery'
    ),
    'worker-added-manually:'||v_worker_id::text
  ) on conflict do nothing;

  insert into public.mandatory_document_events_v2(
    document_id,owner_id,document_worker_id,event_type,actor_type,metadata,dedup_key
  ) values(
    p_document_id,v_owner,v_worker_id,'SIGNATURE_POSITION_RESOLVED','supervisor',
    jsonb_build_object('page',p_page,'rowIndex',p_row_index,'source','MANUAL'),
    'manual-position:'||v_worker_id::text
  ) on conflict do nothing;

  update public.foreman_mandatory_pdf_files
  set signed_pdf=null,signed_sha256=null,fidelity=null,updated_at=now()
  where document_id=p_document_id and owner_id=v_owner;

  if v_keep_active then
    select coalesce(jsonb_agg(legacy_worker_id order by row_index nulls last,created_at)
      filter (where detection_status='CONFIRMED' and legacy_worker_id is not null),'[]'::jsonb)
    into v_ids
    from public.mandatory_document_workers_v2
    where document_id=p_document_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'workerId',legacy_worker_id,
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
    ) order by row_index nulls last,created_at)
      filter (where detection_status='CONFIRMED'),'[]'::jsonb)
    into v_anchors
    from public.mandatory_document_workers_v2
    where document_id=p_document_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'legacyWorkerId',legacy_worker_id,'printedName',printed_name,
      'detectionStatus',detection_status,'positionStatus',position_status,'positionSource',position_source,
      'page',page,'rowIndex',row_index
    ) order by row_index nulls last,created_at),'[]'::jsonb)
    into v_workers
    from public.mandatory_document_workers_v2
    where document_id=p_document_id;

    update public.foreman_mandatory_documents
    set details=coalesce(details,'{}'::jsonb)||jsonb_build_object(
        'importedWorkerIds',v_ids,
        'workerAnchors',v_anchors,
        'documentWorkersV2',v_workers,
        'lifecycleStatus',v_doc.lifecycle_status,
        'manualRecoveryAt',now()
      ),
      updated_at=now()
    where id=p_document_id and owner_id=v_owner;
    v_status:=v_doc.lifecycle_status;
  else
    perform public.mandatory_v2_refresh_legacy_worker_snapshot(p_document_id);
    v_status:=public.mandatory_v2_resolve_preassignment_status(p_document_id);
    update public.foreman_mandatory_documents
    set lifecycle_status=v_status,
        details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus',v_status,'manualRecoveryAt',now()),
        updated_at=now()
    where id=p_document_id and owner_id=v_owner;
  end if;

  return jsonb_build_object(
    'ok',true,
    'documentWorkerId',v_worker_id,
    'legacyWorkerId',v_legacy_worker_id,
    'printedName',v_name,
    'lifecycleStatus',v_status
  );
end;
$function$;

revoke all on function public.add_missing_mandatory_document_worker_v2(uuid,text,integer,integer,jsonb,jsonb) from public;
revoke all on function public.add_missing_mandatory_document_worker_v2(uuid,text,integer,integer,jsonb,jsonb) from anon;
grant execute on function public.add_missing_mandatory_document_worker_v2(uuid,text,integer,integer,jsonb,jsonb) to authenticated;

-- ensure_exact_pdf_worker_anchor_placeholders
CREATE OR REPLACE FUNCTION public.ensure_exact_pdf_worker_anchor_placeholders()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_anchors jsonb := coalesce(new.details->'workerAnchors','[]'::jsonb);
  v_worker jsonb;
  v_id text;
  v_order integer;
  v_unresolved integer;
begin
  if new.document_type not in ('inicio','control_presencia','contrato','prorroga')
     or coalesce(new.details->>'originalPdfMode','')<>'overlay' then
    return new;
  end if;

  v_order := jsonb_array_length(v_anchors);

  for v_worker in
    select value
    from jsonb_array_elements(coalesce(new.workers,'[]'::jsonb))
  loop
    v_id := v_worker->>'id';

    if coalesce(v_id,'')<>''
       and not exists(
         select 1
         from jsonb_array_elements(v_anchors) a
         where a->>'workerId'=v_id
       ) then
      v_anchors := v_anchors || jsonb_build_array(jsonb_build_object(
        'workerId',(v_id)::bigint,
        'workerName',coalesce(v_worker->>'apellidosNombre',''),
        'dni',coalesce(v_worker->>'dni',''),
        'page',1,
        'order',v_order,
        'nameX',null,
        'nameY',null,
        'rowHeight',null,
        'signatureX',null,
        'signatureY',null,
        'signatureWidth',null,
        'signatureHeight',null,
        'confidence',0,
        'resolved',false,
        'reason','Trabajador añadido desde el periodo: el supervisor debe confirmar la línea y la zona de firma.'
      ));
      v_order := v_order+1;
    end if;
  end loop;

  select count(*)
    into v_unresolved
  from jsonb_array_elements(v_anchors) a
  where coalesce((a->>'resolved')::boolean,false)=false
     or coalesce(a->>'workerId','') !~ '^[1-9][0-9]*$';

  new.details := coalesce(new.details,'{}'::jsonb) || jsonb_build_object(
    'workerAnchors',v_anchors,
    'unresolvedAnchorCount',v_unresolved
  );

  return new;
end;
$function$;

revoke all on function public.ensure_exact_pdf_worker_anchor_placeholders() from public;
revoke all on function public.ensure_exact_pdf_worker_anchor_placeholders() from anon,authenticated;

-- finalize_foreman_mandatory_document
CREATE OR REPLACE FUNCTION public.finalize_foreman_mandatory_document(p_token text, p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_hash text;
  v_access public.foreman_portal_access%rowtype;
  v_doc public.foreman_mandatory_documents%rowtype;
  v_total integer := 0;
  v_signed integer := 0;
  v_partial boolean := false;
begin
  v_hash := encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');

  select * into v_access
  from public.foreman_portal_access
  where token_hash=v_hash and active=true
  limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;

  select * into v_doc
  from public.foreman_mandatory_documents
  where id=p_document_id
    and owner_id=v_access.owner_id
    and lower(obra)=lower(v_access.obra)
  for update;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.document_type in ('contrato','prorroga') then raise exception 'Utiliza el circuito V2 de contratos y prórrogas'; end if;
  if v_doc.status in ('completed','reviewed') then raise exception 'El documento ya está bloqueado'; end if;

  if v_doc.document_type in ('inicio','control_presencia') then
    select count(*) into v_total
    from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb));

    select count(*) into v_signed
    from jsonb_object_keys(coalesce(v_doc.signatures,'{}'::jsonb)) key
    where exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb)) ids(value)
      where ids.value=key
    );
  else
    select count(*) into v_total
    from jsonb_array_elements(coalesce(v_doc.workers,'[]'::jsonb)) w;

    select count(*) into v_signed
    from jsonb_array_elements(coalesce(v_doc.workers,'[]'::jsonb)) w
    where coalesce(v_doc.signatures,'{}'::jsonb) ? (w->>'id');
  end if;

  if v_total=0 then raise exception 'El documento no tiene personas incluidas'; end if;

  v_partial := v_signed < v_total;

  update public.foreman_mandatory_documents
  set status='completed',
      completed_at=now(),
      correction_pending=false,
      correction_reason=null,
      correction_requested_at=null,
      details=coalesce(details,'{}'::jsonb)
        || jsonb_build_object(
          'submissionMode',case when v_partial then 'partial' else 'complete' end,
          'submittedSignedCount',v_signed,
          'submittedRequiredCount',v_total,
          'missingSignatureCount',greatest(v_total-v_signed,0),
          'submittedAt',now()
        ),
      updated_at=now()
  where id=p_document_id;

  return jsonb_build_object(
    'ok',true,
    'completed',true,
    'signed',v_signed,
    'total',v_total,
    'partial',v_partial,
    'missing',greatest(v_total-v_signed,0)
  );
end;
$function$;

revoke all on function public.finalize_foreman_mandatory_document(text,uuid) from public;
grant execute on function public.finalize_foreman_mandatory_document(text,uuid) to anon,authenticated;

-- guard_exact_mandatory_pdf_completion
CREATE OR REPLACE FUNCTION public.guard_exact_mandatory_pdf_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_file public.foreman_mandatory_pdf_files%rowtype;
begin
  if new.status='completed'
     and coalesce(old.status,'')<>'completed'
     and new.document_type in ('inicio','control_presencia','contrato','prorroga')
     and coalesce(new.details->>'originalPdfMode','')='overlay' then

    select * into v_file
    from public.foreman_mandatory_pdf_files
    where document_id=new.id
      and owner_id=new.owner_id;

    if not found or v_file.signed_pdf is null then
      raise exception 'Debe generarse y guardarse el PDF antes de enviarlo al supervisor';
    end if;

    if coalesce((v_file.fidelity->>'ok')::boolean,false)=false then
      raise exception 'La copia no ha superado la verificación de fidelidad';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_exact_mandatory_pdf_completion() from public;
revoke all on function public.guard_exact_mandatory_pdf_completion() from anon,authenticated;

-- initialize_mandatory_document_v2
CREATE OR REPLACE FUNCTION public.initialize_mandatory_document_v2(p_document_id uuid, p_workers jsonb, p_detected_worksite text DEFAULT NULL::text, p_lifecycle_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if v_doc.document_type not in ('inicio','control_presencia','contrato','prorroga') then raise exception 'Tipo de documento no compatible con V2'; end if;
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
      case when v_doc.document_type in ('contrato','prorroga') then 'DETECTED' else coalesce(nullif(v_item->>'detectionStatus',''),'DETECTED') end,
      nullif(v_item->>'detectionConfidence','')::numeric,
      case when v_doc.document_type in ('contrato','prorroga') then 'PENDING' else coalesce(nullif(v_item->>'positionStatus',''),'PENDING') end,
      case when v_item->>'positionSource'='MANUAL' then 'MANUAL' else 'AUTO' end,
      v_item->'nameBox',v_item->'signatureBox',v_item->>'rejectionReason'
    ) returning id into v_id;

    insert into public.mandatory_document_events_v2(document_id,owner_id,document_worker_id,event_type,actor_type,metadata,dedup_key)
    values(p_document_id,v_owner,v_id,'WORKER_DETECTED','sistema',jsonb_build_object('printedName',v_item->>'printedName'),'worker-detected:'||v_id::text)
    on conflict do nothing;
    if v_doc.document_type not in ('contrato','prorroga') and coalesce(v_item->>'detectionStatus','')='CONFIRMED' then
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
$function$;

revoke all on function public.initialize_mandatory_document_v2(uuid,jsonb,text,text) from public;
revoke all on function public.initialize_mandatory_document_v2(uuid,jsonb,text,text) from anon;
grant execute on function public.initialize_mandatory_document_v2(uuid,jsonb,text,text) to authenticated;

-- prepare_foreman_mandatory_from_email
CREATE OR REPLACE FUNCTION public.prepare_foreman_mandatory_from_email(p_document_type text, p_worker_ids bigint[], p_work_date date, p_category text, p_period_key text, p_gmail_message_id text, p_gmail_thread_id text, p_rfc_message_id text, p_email_from text, p_email_subject text, p_attachment_name text, p_obra_hint text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid := auth.uid();
  v_obra text;
  v_id uuid;
  v_category text := coalesce(trim(p_category),'');
  v_period_key text;
  v_valid_worker_ids bigint[] := '{}'::bigint[];
  v_imported_ids jsonb := '[]'::jsonb;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if p_document_type not in ('inicio','control_presencia','contrato','prorroga') then raise exception 'Tipo de documento no válido'; end if;

  if coalesce(trim(p_obra_hint),'')<>'' then v_obra := trim(p_obra_hint); end if;

  if coalesce(trim(v_obra),'')='' and coalesce(array_length(p_worker_ids,1),0)>0 then
    select t.obra into v_obra
    from unnest(p_worker_ids) with ordinality ids(id,ord)
    join public.trabajadores t on t.id=ids.id and t.owner_id=v_owner
    group by t.obra
    order by count(*) desc, min(ids.ord)
    limit 1;
  end if;

  if coalesce(trim(v_obra),'')='' then
    raise exception 'No se ha podido identificar la obra. Selecciona la obra antes de importar el documento';
  end if;

  if p_document_type='control_presencia' then v_category := ''; end if;

  if coalesce(array_length(p_worker_ids,1),0)>0 then
    select coalesce(array_agg(t.id order by ids.ord),'{}'::bigint[])
      into v_valid_worker_ids
    from unnest(p_worker_ids) with ordinality ids(id,ord)
    join public.trabajadores t on t.id=ids.id
    where t.owner_id=v_owner
      and lower(coalesce(t.obra,''))=lower(v_obra);
  end if;

  select coalesce(jsonb_agg(worker_id order by ord),'[]'::jsonb)
    into v_imported_ids
  from unnest(v_valid_worker_ids) with ordinality ids2(worker_id,ord);

  v_period_key := coalesce(nullif(trim(p_period_key),''),to_char(coalesce(p_work_date,current_date),'YYYY-MM-DD'));

  if nullif(trim(coalesce(p_gmail_message_id,'')),'') is not null
     and nullif(trim(coalesce(p_attachment_name,'')),'') is not null then
    if exists (
      select 1
      from public.foreman_mandatory_delete_tombstones t
      where t.owner_id=v_owner
        and t.source_gmail_message_id=p_gmail_message_id
        and t.source_attachment_name=p_attachment_name
    ) then
      return null;
    end if;

    select id into v_id
    from public.foreman_mandatory_documents
    where owner_id=v_owner
      and source_gmail_message_id=p_gmail_message_id
      and source_attachment_name=p_attachment_name
    limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  insert into public.foreman_mandatory_documents(
    owner_id,obra,period_key,work_date,document_type,category,workers,signatures,status,
    source_gmail_message_id,source_gmail_thread_id,source_rfc_message_id,source_email_from,
    source_email_subject,source_attachment_name,details,updated_at
  ) values(
    v_owner,v_obra,v_period_key,coalesce(p_work_date,current_date),p_document_type,v_category,
    '[]'::jsonb,'{}'::jsonb,'pending',
    p_gmail_message_id,p_gmail_thread_id,p_rfc_message_id,p_email_from,
    p_email_subject,p_attachment_name,
    jsonb_build_object('importedWorkerIds',v_imported_ids,'sourceFilename',coalesce(p_attachment_name,'')),
    now()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.prepare_foreman_mandatory_from_email(text,bigint[],date,text,text,text,text,text,text,text,text,text) from public;
revoke all on function public.prepare_foreman_mandatory_from_email(text,bigint[],date,text,text,text,text,text,text,text,text,text) from anon;
grant execute on function public.prepare_foreman_mandatory_from_email(text,bigint[],date,text,text,text,text,text,text,text,text,text) to authenticated;

-- remove_foreman_mandatory_worker
CREATE OR REPLACE FUNCTION public.remove_foreman_mandatory_worker(p_token text, p_document_id uuid, p_worker_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_hash text;
  v_access public.foreman_portal_access%rowtype;
  v_doc public.foreman_mandatory_documents%rowtype;
  v_ids jsonb;
  v_imported_workers jsonb;
  v_workers jsonb;
  v_anchors jsonb;
  v_signatures jsonb;
  v_remaining integer := 0;
  v_signed integer := 0;
begin
  v_hash := encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');

  select * into v_access
  from public.foreman_portal_access
  where token_hash=v_hash and active=true
  limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;

  select * into v_doc
  from public.foreman_mandatory_documents
  where id=p_document_id
    and owner_id=v_access.owner_id
    and lower(obra)=lower(v_access.obra)
    and document_type in ('inicio','control_presencia')
  for update;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.document_type in ('contrato','prorroga') then raise exception 'Utiliza el circuito V2 de contratos y prórrogas'; end if;

  if v_doc.status in ('completed','reviewed') then
    raise exception 'El documento ya fue enviado al supervisor';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb)) x(value)
    where x.value=p_worker_id::text
  ) then
    raise exception 'La persona no pertenece al documento importado';
  end if;

  select coalesce(jsonb_agg(to_jsonb(value) order by ord),'[]'::jsonb)
    into v_ids
  from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb))
    with ordinality x(value,ord)
  where value<>p_worker_id::text;

  select coalesce(jsonb_agg(item order by ord),'[]'::jsonb)
    into v_imported_workers
  from jsonb_array_elements(coalesce(v_doc.details->'importedWorkers','[]'::jsonb))
    with ordinality x(item,ord)
  where coalesce(item->>'id','')<>p_worker_id::text;

  select coalesce(jsonb_agg(item order by ord),'[]'::jsonb)
    into v_workers
  from jsonb_array_elements(coalesce(v_doc.workers,'[]'::jsonb))
    with ordinality x(item,ord)
  where coalesce(item->>'id','')<>p_worker_id::text;

  select coalesce(jsonb_agg(item order by ord),'[]'::jsonb)
    into v_anchors
  from jsonb_array_elements(coalesce(v_doc.details->'workerAnchors','[]'::jsonb))
    with ordinality x(item,ord)
  where coalesce(item->>'workerId','')<>p_worker_id::text;

  v_signatures := coalesce(v_doc.signatures,'{}'::jsonb) - p_worker_id::text;
  v_remaining := jsonb_array_length(v_ids);
  select count(*) into v_signed
  from jsonb_object_keys(v_signatures) key
  where exists (
    select 1 from jsonb_array_elements_text(v_ids) ids(value)
    where ids.value=key
  );

  update public.foreman_mandatory_documents
  set workers=v_workers,
      signatures=v_signatures,
      details=coalesce(details,'{}'::jsonb)
        || jsonb_build_object(
          'importedWorkerIds',v_ids,
          'importedWorkers',v_imported_workers,
          'workerAnchors',v_anchors,
          'unresolvedAnchorCount',(
            select count(*)
            from jsonb_array_elements(v_anchors) a
            where coalesce((a->>'resolved')::boolean,false)=false
          ),
          'lastRemovedWorkerId',p_worker_id,
          'lastRemovedWorkerAt',now(),
          'lastRemovedWorkerBy','encargado'
        ),
      status=case when v_signed>0 then 'in_progress' else 'pending' end,
      completed_at=null,
      updated_at=now()
  where id=p_document_id;

  delete from public.worker_document_evidence
  where owner_id=v_access.owner_id
    and document_id=p_document_id
    and worker_id=p_worker_id;

  update public.foreman_mandatory_pdf_files
  set signed_pdf=null,signed_sha256=null,fidelity=null,updated_at=now()
  where document_id=p_document_id
    and owner_id=v_access.owner_id;

  return jsonb_build_object(
    'ok',true,
    'removedWorkerId',p_worker_id,
    'remainingWorkers',v_remaining,
    'signedWorkers',v_signed
  );
end;
$function$;

revoke all on function public.remove_foreman_mandatory_worker(text,uuid,bigint) from public;
grant execute on function public.remove_foreman_mandatory_worker(text,uuid,bigint) to anon,authenticated;

-- remove_supervisor_mandatory_worker
CREATE OR REPLACE FUNCTION public.remove_supervisor_mandatory_worker(p_document_id uuid, p_worker_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid := auth.uid();
  v_doc public.foreman_mandatory_documents%rowtype;
  v_ids jsonb;
  v_imported_workers jsonb;
  v_workers jsonb;
  v_anchors jsonb;
  v_signatures jsonb;
  v_remaining integer := 0;
  v_signed integer := 0;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;

  select * into v_doc
  from public.foreman_mandatory_documents
  where id=p_document_id
    and owner_id=v_owner
    and document_type in ('inicio','control_presencia','contrato','prorroga')
  for update;
  if not found then raise exception 'Documento no válido'; end if;

  if not exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb)) x(value)
    where x.value=p_worker_id::text
  ) then
    raise exception 'La persona no pertenece al documento importado';
  end if;

  select coalesce(jsonb_agg(to_jsonb(value) order by ord),'[]'::jsonb)
    into v_ids
  from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb))
    with ordinality x(value,ord)
  where value<>p_worker_id::text;

  select coalesce(jsonb_agg(item order by ord),'[]'::jsonb)
    into v_imported_workers
  from jsonb_array_elements(coalesce(v_doc.details->'importedWorkers','[]'::jsonb))
    with ordinality x(item,ord)
  where coalesce(item->>'id','')<>p_worker_id::text;

  select coalesce(jsonb_agg(item order by ord),'[]'::jsonb)
    into v_workers
  from jsonb_array_elements(coalesce(v_doc.workers,'[]'::jsonb))
    with ordinality x(item,ord)
  where coalesce(item->>'id','')<>p_worker_id::text;

  select coalesce(jsonb_agg(item order by ord),'[]'::jsonb)
    into v_anchors
  from jsonb_array_elements(coalesce(v_doc.details->'workerAnchors','[]'::jsonb))
    with ordinality x(item,ord)
  where coalesce(item->>'workerId','')<>p_worker_id::text;

  v_signatures := coalesce(v_doc.signatures,'{}'::jsonb) - p_worker_id::text;
  v_remaining := jsonb_array_length(v_ids);
  select count(*) into v_signed
  from jsonb_object_keys(v_signatures) key
  where exists (
    select 1 from jsonb_array_elements_text(v_ids) ids(value)
    where ids.value=key
  );

  update public.foreman_mandatory_documents
  set workers=v_workers,
      signatures=v_signatures,
      details=coalesce(details,'{}'::jsonb)
        || jsonb_build_object(
          'importedWorkerIds',v_ids,
          'importedWorkers',v_imported_workers,
          'workerAnchors',v_anchors,
          'unresolvedAnchorCount',(
            select count(*)
            from jsonb_array_elements(v_anchors) a
            where coalesce((a->>'resolved')::boolean,false)=false
          ),
          'lastRemovedWorkerId',p_worker_id,
          'lastRemovedWorkerAt',now(),
          'lastRemovedWorkerBy','supervisor'
        ),
      status=case when v_signed>0 then 'in_progress' else 'pending' end,
      completed_at=null,
      reviewed_at=null,
      returned_at=null,
      correction_pending=false,
      correction_reason=null,
      correction_requested_at=null,
      updated_at=now()
  where id=p_document_id;

  delete from public.worker_document_evidence
  where owner_id=v_owner
    and document_id=p_document_id
    and worker_id=p_worker_id;

  update public.foreman_mandatory_pdf_files
  set signed_pdf=null,signed_sha256=null,fidelity=null,updated_at=now()
  where document_id=p_document_id
    and owner_id=v_owner;

  return jsonb_build_object(
    'ok',true,
    'removedWorkerId',p_worker_id,
    'remainingWorkers',v_remaining,
    'signedWorkers',v_signed
  );
end;
$function$;

revoke all on function public.remove_supervisor_mandatory_worker(uuid,bigint) from public;
revoke all on function public.remove_supervisor_mandatory_worker(uuid,bigint) from anon;
grant execute on function public.remove_supervisor_mandatory_worker(uuid,bigint) to authenticated;

-- repair_foreman_mandatory_anchors
CREATE OR REPLACE FUNCTION public.repair_foreman_mandatory_anchors(p_token text, p_document_id uuid, p_worker_anchors jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_hash text;
  v_access public.foreman_portal_access%rowtype;
  v_doc public.foreman_mandatory_documents%rowtype;
  v_unresolved integer := 0;
begin
  if jsonb_typeof(coalesce(p_worker_anchors,'[]'::jsonb)) <> 'array' then
    raise exception 'Zonas de firma no válidas';
  end if;

  v_hash := encode(digest(trim(coalesce(p_token,'')), 'sha256'), 'hex');
  select * into v_access
  from public.foreman_portal_access
  where token_hash=v_hash and active=true
  limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;

  select * into v_doc
  from public.foreman_mandatory_documents
  where id=p_document_id
    and owner_id=v_access.owner_id
    and lower(obra)=lower(v_access.obra)
    and document_type in ('inicio','control_presencia')
  for update;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.document_type in ('contrato','prorroga') then raise exception 'Utiliza el circuito V2 de contratos y prórrogas'; end if;

  select count(*) into v_unresolved
  from jsonb_array_elements(coalesce(p_worker_anchors,'[]'::jsonb)) a
  where coalesce((a->>'resolved')::boolean,false)=false;

  update public.foreman_mandatory_documents
  set details=coalesce(details,'{}'::jsonb) || jsonb_build_object(
        'workerAnchors',coalesce(p_worker_anchors,'[]'::jsonb),
        'unresolvedAnchorCount',v_unresolved
      ),
      updated_at=now()
  where id=p_document_id;

  return true;
end;
$function$;

revoke all on function public.repair_foreman_mandatory_anchors(text,uuid,jsonb) from public;
grant execute on function public.repair_foreman_mandatory_anchors(text,uuid,jsonb) to anon,authenticated;

-- resolve_foreman_portal
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
      'status',m.status,'completedAt',m.completed_at,'details',m.details,'lifecycleStatus',m.lifecycle_status,'assignedAt',m.assigned_at,
      'correctionPending',m.correction_pending,'correctionReason',m.correction_reason,'correctionRequestedAt',m.correction_requested_at
    ) order by m.work_date desc,m.document_type,m.category) from public.foreman_mandatory_documents m
      where m.owner_id=v_access.owner_id and lower(m.obra)=lower(v_access.obra) and (m.lifecycle_status in ('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION')
          or m.work_date>=current_date-62 or m.completed_at>=now()-interval '62 days')
        and ((m.document_type not in ('inicio','control_presencia','contrato','prorroga') and m.v2_initialized_at is null) or m.lifecycle_status in ('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION','SUBMITTED','RECEIVED','REVIEWED'))
    ),'[]'::jsonb)
  );
end;
$function$;

revoke all on function public.resolve_foreman_portal(text) from public;
grant execute on function public.resolve_foreman_portal(text) to anon,authenticated;

-- save_mandatory_positions_draft_v2
CREATE OR REPLACE FUNCTION public.save_mandatory_positions_draft_v2(p_document_id uuid, p_workers jsonb, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_owner uuid:=auth.uid();v_doc public.foreman_mandatory_documents%rowtype;
  v_worker public.mandatory_document_workers_v2%rowtype;entry jsonb;v_id uuid;
  v_name text;v_signature jsonb;v_name_box jsonb;v_resolved boolean;v_legacy bigint;v_hash text;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_workers) is distinct from 'array' or jsonb_array_length(p_workers)>500 then raise exception 'Lista de trabajadores no válida'; end if;
  select * into v_doc from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_owner for update;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.v2_initialized_at is null or v_doc.document_type not in ('inicio','control_presencia','contrato','prorroga') then raise exception 'Documento no compatible'; end if;
  if v_doc.lifecycle_status in ('ASSIGNED','IN_SIGNATURE','SUBMITTED','RECEIVED','REVIEWED','RETURNED_FOR_CORRECTION') then
    raise exception 'Retira primero el documento del portal para corregirlo';
  end if;
  v_hash:=encode(extensions.digest(p_workers::text,'sha256'),'hex');
  if v_doc.details->>'draftSaveHash'=v_hash and (v_doc.details->>'draftSavedAt')::timestamptz=v_doc.updated_at then
    return to_jsonb(v_doc);
  end if;
  if p_expected_updated_at is not null and v_doc.updated_at is distinct from p_expected_updated_at then
    raise exception 'Otro cambio ha modificado este documento. Cierra y vuelve a abrir el editor antes de guardar';
  end if;
  if exists(select 1 from jsonb_array_elements(p_workers) x group by x->>'documentWorkerId' having count(*)>1) then raise exception 'Una persona aparece duplicada en el borrador'; end if;
  for entry in select value from jsonb_array_elements(p_workers) loop
    v_id:=(entry->>'documentWorkerId')::uuid;
    v_name:=regexp_replace(trim(coalesce(entry->>'printedName','')),'\s+',' ','g');
    if length(v_name)<3 or coalesce((entry->>'page')::integer,0)<1 or coalesce((entry->>'rowIndex')::integer,-1)<0 then raise exception 'Nombre, página o fila no válidos'; end if;
    v_signature:=nullif(entry->'signatureBox','null'::jsonb);v_name_box:=nullif(entry->'nameBox','null'::jsonb);
    if v_signature is not null and not public.mandatory_v2_box_valid(v_signature) then raise exception 'Coordenadas de firma no válidas para %',v_name; end if;
    if v_name_box is not null and not public.mandatory_v2_box_valid(v_name_box) then raise exception 'Coordenadas del nombre no válidas para %',v_name; end if;
    v_resolved:=coalesce((entry->>'resolved')::boolean,false) and public.mandatory_v2_box_valid(v_signature);
    select * into v_worker from public.mandatory_document_workers_v2 where id=v_id for update;
    if found then
      if v_worker.document_id<>p_document_id or v_worker.owner_id<>v_owner then raise exception 'Persona documental no válida'; end if;
      if v_worker.detection_status='REJECTED' then raise exception 'El trabajador % ya fue eliminado. Actualiza el documento',v_worker.printed_name; end if;
      update public.mandatory_document_workers_v2
      set printed_name=v_name,page=(entry->>'page')::integer,row_index=(entry->>'rowIndex')::integer,
          name_box=v_name_box,signature_box=v_signature,position_status=case when v_resolved then 'RESOLVED' else 'PENDING' end,
          detection_status=case when v_resolved then 'CONFIRMED' else detection_status end,
          position_source='MANUAL',frozen_at=null,updated_at=now()
      where id=v_id;
    else
      if not coalesce((entry->>'create')::boolean,false) then raise exception 'La identidad documental ha cambiado. Actualiza el documento'; end if;
      if exists(select 1 from public.mandatory_document_workers_v2 where document_id=p_document_id and detection_status<>'REJECTED' and lower(printed_name)=lower(v_name) and page=(entry->>'page')::integer) then raise exception 'Ese trabajador ya figura en este documento'; end if;
      select coalesce(min(legacy_worker_id) filter(where legacy_worker_id<0),-900000000000000::bigint)-1 into v_legacy from public.mandatory_document_workers_v2 where document_id=p_document_id;
      insert into public.mandatory_document_workers_v2(id,document_id,owner_id,legacy_worker_id,printed_name,page,row_index,detection_status,position_status,position_source,name_box,signature_box)
      values(v_id,p_document_id,v_owner,v_legacy,v_name,(entry->>'page')::integer,(entry->>'rowIndex')::integer,'CONFIRMED',case when v_resolved then 'RESOLVED' else 'PENDING' end,'MANUAL',v_name_box,v_signature);
    end if;
  end loop;
  perform public.mandatory_v2_refresh_legacy_worker_snapshot(p_document_id);
  update public.foreman_mandatory_pdf_files set signed_pdf=null,signed_sha256=null,fidelity=null,updated_at=now() where document_id=p_document_id and owner_id=v_owner;
  update public.foreman_mandatory_documents
  set details=coalesce(details,'{}'::jsonb)||jsonb_build_object('draftSaveHash',v_hash,'draftSavedAt',now()),updated_at=now()
  where id=p_document_id returning * into v_doc;
  insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata)
  values(p_document_id,v_owner,'POSITIONS_DRAFT_SAVED','supervisor',jsonb_build_object('workers',jsonb_array_length(p_workers)));
  return to_jsonb(v_doc);
end;
$function$;

revoke all on function public.save_mandatory_positions_draft_v2(uuid,jsonb,timestamptz) from public;
revoke all on function public.save_mandatory_positions_draft_v2(uuid,jsonb,timestamptz) from anon;
grant execute on function public.save_mandatory_positions_draft_v2(uuid,jsonb,timestamptz) to authenticated;

-- assign_mandatory_document_v2
CREATE OR REPLACE FUNCTION public.assign_mandatory_document_v2(p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid:=auth.uid();
  v_status text;
  v_current_status text;
  v_confirmed integer;
  v_next_version integer;
  v_names text;
  v_pending integer;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  select lifecycle_status into v_current_status from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_owner for update;
  if not found then raise exception 'Documento no válido'; end if;
  if exists(select 1 from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_owner and document_type in ('contrato','prorroga')) then
    if (select count(*) from public.mandatory_document_workers_v2 where document_id=p_document_id and detection_status<>'REJECTED')<>1 then
      raise exception 'El contrato o prórroga debe tener un único trabajador identificado';
    end if;
    if not exists(select 1 from public.mandatory_document_workers_v2 where document_id=p_document_id and owner_id=v_owner and detection_status='CONFIRMED' and position_status='RESOLVED' and position_source='MANUAL') then
      raise exception 'Revisa y guarda la identidad y zona de firma del trabajador antes de enviar';
    end if;
    if not exists(select 1 from public.foreman_mandatory_pdf_files where document_id=p_document_id and owner_id=v_owner and original_pdf is not null) then
      raise exception 'Falta el PDF original del contrato o prórroga';
    end if;
  end if;

  if coalesce(v_current_status,'') not in ('ANALYZED','NEEDS_WORKSITE_REVIEW','NEEDS_WORKER_REVIEW','NEEDS_SIGNATURE_POSITION_REVIEW','READY','PDF_VALIDATION_ERROR') then
    raise exception 'El documento ya está asignado o cerrado';
  end if;
  v_status:=public.mandatory_v2_resolve_preassignment_status(p_document_id);
  if v_status='NEEDS_WORKSITE_REVIEW' then
    raise exception 'Revisa Asignar obra: el documento todavía no tiene una obra confirmada';
  elsif v_status='NEEDS_WORKER_REVIEW' then
    select count(*) into v_pending from public.mandatory_document_workers_v2 where document_id=p_document_id and detection_status='DETECTED';
    select string_agg(printed_name,', ' order by row_index) into v_names from
      (select left(printed_name,120) as printed_name,row_index from public.mandatory_document_workers_v2
       where document_id=p_document_id and detection_status='DETECTED' order by row_index limit 20) pending;
    if v_pending>0 then
      raise exception 'Revisa Trabajadores: % persona(s) pendiente(s) de confirmar o descartar: %. Las posiciones guardadas se conservan',v_pending,v_names;
    end if;
    raise exception 'Revisa Trabajadores: no hay ninguna persona confirmada para firmar';
  elsif v_status='NEEDS_SIGNATURE_POSITION_REVIEW' then
    select string_agg(printed_name,', ' order by row_index) into v_names from
      (select left(printed_name,120) as printed_name,row_index from public.mandatory_document_workers_v2
       where document_id=p_document_id and detection_status='CONFIRMED' and
         (position_status<>'RESOLVED' or not public.mandatory_v2_box_valid(signature_box)
          or (position_source<>'MANUAL' and not public.mandatory_v2_box_valid(name_box))) order by row_index limit 20) pending;
    raise exception 'Revisa Ajustar firmas: hay posiciones o confirmaciones pendientes para: %. El solapamiento entre firmas no bloquea el envío',v_names;
  elsif v_status<>'READY' then
    raise exception 'No se ha podido validar el documento: %',v_status;
  end if;
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
$function$;

revoke all on function public.assign_mandatory_document_v2(uuid) from public;
revoke all on function public.assign_mandatory_document_v2(uuid) from anon;
grant execute on function public.assign_mandatory_document_v2(uuid) to authenticated;

-- submit_mandatory_document_v2
CREATE OR REPLACE FUNCTION public.submit_mandatory_document_v2(p_token text, p_document_id uuid, p_pdf_base64 text, p_signed_sha256 text, p_fidelity jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  if v_doc.document_type in ('contrato','prorroga') and (v_total<>1 or v_signed<>1) then raise exception 'Falta la firma obligatoria del trabajador del contrato o prórroga'; end if;
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
$function$;

revoke all on function public.submit_mandatory_document_v2(text,uuid,text,text,jsonb) from public;
grant execute on function public.submit_mandatory_document_v2(text,uuid,text,text,jsonb) to anon,authenticated;

-- Contract drafts remain private even when a portal token knows their UUID.
CREATE OR REPLACE FUNCTION public.get_foreman_mandatory_pdf(p_token text, p_document_id uuid, p_variant text DEFAULT 'original'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_hash text;
  v_access public.foreman_portal_access%rowtype;
  v_doc public.foreman_mandatory_documents%rowtype;
  v_file public.foreman_mandatory_pdf_files%rowtype;
  v_bytes bytea;
  v_sha text;
  v_variant text := 'original';
begin
  v_hash := encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');

  select *
    into v_access
  from public.foreman_portal_access
  where token_hash=v_hash
    and active=true
  limit 1;

  if not found then
    raise exception 'Acceso no válido o revocado';
  end if;

  select *
    into v_doc
  from public.foreman_mandatory_documents
  where id=p_document_id
    and owner_id=v_access.owner_id
    and lower(obra)=lower(v_access.obra)
  limit 1;

  if not found then
    raise exception 'Documento no válido';
  end if;

  if v_doc.document_type in ('contrato','prorroga') then
    if coalesce(v_doc.lifecycle_status,'') not in ('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION','SUBMITTED','RECEIVED','REVIEWED') then
      raise exception 'El contrato o prórroga todavía no se ha enviado al portal';
    end if;
  end if;

  select *
    into v_file
  from public.foreman_mandatory_pdf_files
  where document_id=v_doc.id
    and owner_id=v_access.owner_id;

  if not found then
    raise exception 'El PDF original no está disponible; debe volver a importarse';
  end if;

  if lower(coalesce(p_variant,'original'))='signed' and v_file.signed_pdf is not null then
    v_bytes := v_file.signed_pdf;
    v_sha := v_file.signed_sha256;
    v_variant := 'signed';
  else
    v_bytes := v_file.original_pdf;
    v_sha := v_file.original_sha256;
  end if;

  return jsonb_build_object(
    'base64',encode(v_bytes,'base64'),
    'filename',v_file.original_filename,
    'sha256',coalesce(v_sha,''),
    'variant',v_variant,
    'fidelity',v_file.fidelity
  );
end;
$function$;
revoke all on function public.get_foreman_mandatory_pdf(text,uuid,text) from public;
grant execute on function public.get_foreman_mandatory_pdf(text,uuid,text) to anon,authenticated;
-- Only the supervisor can change the reviewed employment identity.
CREATE OR REPLACE FUNCTION public.correct_foreman_mandatory_worker_name(p_token text, p_document_id uuid, p_worker_id bigint, p_worker_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_hash text;
  v_access public.foreman_portal_access%rowtype;
  v_doc public.foreman_mandatory_documents%rowtype;
  v_name text;
  v_workers jsonb;
  v_imported_workers jsonb;
  v_anchors jsonb;
begin
  v_name := regexp_replace(trim(coalesce(p_worker_name,'')), '\s+', ' ', 'g');
  if length(v_name) < 3 then
    raise exception 'Indica un nombre válido';
  end if;

  v_hash := encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
  select * into v_access
    from public.foreman_portal_access
   where token_hash=v_hash and active=true
   limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;

  select * into v_doc
    from public.foreman_mandatory_documents
   where id=p_document_id
     and owner_id=v_access.owner_id
     and lower(obra)=lower(v_access.obra)
   for update;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.document_type in ('contrato','prorroga') then raise exception 'El supervisor debe corregir la identidad del contrato o prórroga antes de volver a enviarlo'; end if;

  if coalesce(v_doc.signatures,'{}'::jsonb) ? p_worker_id::text then
    raise exception 'El nombre no puede cambiarse después de firmar';
  end if;

  if not exists (
    select 1
      from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb)) x(value)
     where x.value=p_worker_id::text
  ) then
    raise exception 'La persona no pertenece al documento importado';
  end if;

  select coalesce(jsonb_agg(
    case when coalesce(item->>'id','')=p_worker_id::text
      then jsonb_set(item,'{apellidosNombre}',to_jsonb(v_name),true)
      else item end
  ),'[]'::jsonb)
  into v_imported_workers
  from jsonb_array_elements(coalesce(v_doc.details->'importedWorkers','[]'::jsonb)) item;

  select coalesce(jsonb_agg(
    case when coalesce(item->>'id','')=p_worker_id::text
      then jsonb_set(item,'{apellidosNombre}',to_jsonb(v_name),true)
      else item end
  ),'[]'::jsonb)
  into v_workers
  from jsonb_array_elements(coalesce(v_doc.workers,'[]'::jsonb)) item;

  select coalesce(jsonb_agg(
    case when coalesce(item->>'workerId','')=p_worker_id::text
      then jsonb_set(item,'{workerName}',to_jsonb(v_name),true)
      else item end
  ),'[]'::jsonb)
  into v_anchors
  from jsonb_array_elements(coalesce(v_doc.details->'workerAnchors','[]'::jsonb)) item;

  update public.foreman_mandatory_documents
     set workers=v_workers,
         details=jsonb_set(
           jsonb_set(coalesce(details,'{}'::jsonb),'{importedWorkers}',v_imported_workers,true),
           '{workerAnchors}',v_anchors,true
         ),
         updated_at=now()
   where id=p_document_id;

  return jsonb_build_object('ok',true,'workerId',p_worker_id,'workerName',v_name);
end;
$function$;
revoke all on function public.correct_foreman_mandatory_worker_name(text,uuid,bigint,text) from public;
grant execute on function public.correct_foreman_mandatory_worker_name(text,uuid,bigint,text) to anon,authenticated;
notify pgrst,'reload schema';
