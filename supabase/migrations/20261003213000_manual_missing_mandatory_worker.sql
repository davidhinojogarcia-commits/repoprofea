-- GestionProfea · recuperación manual de trabajadores omitidos en documentos importados
-- Permite incorporar una persona que sí aparece en el PDF de Inicio/Control de presencia
-- pero que no fue detectada automáticamente. La identidad queda limitada al documento.

create or replace function public.add_missing_mandatory_document_worker_v2(
  p_document_id uuid,
  p_printed_name text,
  p_page integer,
  p_row_index integer,
  p_signature_box jsonb,
  p_name_box jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
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
  if v_doc.document_type not in ('inicio','control_presencia') then raise exception 'Tipo de documento no compatible'; end if;
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
$$;

revoke all on function public.add_missing_mandatory_document_worker_v2(uuid,text,integer,integer,jsonb,jsonb) from public,anon;
grant execute on function public.add_missing_mandatory_document_worker_v2(uuid,text,integer,integer,jsonb,jsonb) to authenticated;
