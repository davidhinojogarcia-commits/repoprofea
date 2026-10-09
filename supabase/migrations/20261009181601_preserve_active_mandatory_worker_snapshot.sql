-- Preserve active lifecycle while rebuilding signing projections.
-- No transition guard, ownership checks, or execute grants are relaxed.

CREATE OR REPLACE FUNCTION public.mandatory_v2_refresh_legacy_worker_snapshot(p_document_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Lock the parent before projecting workers. An assigned document must never
  -- pass through READY, even transiently: the lifecycle trigger rejects it.
  select lifecycle_status into v_status
  from public.foreman_mandatory_documents
  where id=p_document_id for update;
  if v_status is null or v_status not in ('ASSIGNED','IN_SIGNATURE','SUBMITTED','RECEIVED','REVIEWED') then
    v_status:=public.mandatory_v2_resolve_preassignment_status(p_document_id);
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.review_mandatory_document_worker_v2(p_document_id uuid, p_document_worker_id uuid, p_action text, p_printed_name text DEFAULT NULL::text, p_name_box jsonb DEFAULT NULL::jsonb, p_signature_box jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid:=auth.uid();
  v_doc public.foreman_mandatory_documents%rowtype;
  v_worker public.mandatory_document_workers_v2%rowtype;
  v_status text;
  v_was_active boolean:=false;
  v_confirmed_remaining integer:=0;
  v_signed_remaining integer:=0;
  v_workers jsonb;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if p_action not in ('confirm','reject') then raise exception 'Acción no válida'; end if;

  select * into v_doc
  from public.foreman_mandatory_documents
  where id=p_document_id and owner_id=v_owner
  for update;
  if not found then raise exception 'Documento no válido'; end if;

  -- Los documentos enviados/recibidos/revisados siguen siendo inmutables.
  if v_doc.lifecycle_status in ('SUBMITTED','RECEIVED','REVIEWED') then
    raise exception 'El documento ya está congelado';
  end if;

  -- En un documento ya entregado al encargado solo permitimos quitar una detección
  -- errónea. No permitimos cambiar identidades ni geometrías por esta vía.
  v_was_active:=v_doc.lifecycle_status in ('ASSIGNED','IN_SIGNATURE');
  if v_was_active and p_action<>'reject' then
    raise exception 'El documento ya está congelado';
  end if;

  if v_doc.lifecycle_status='RETURNED_FOR_CORRECTION' then
    update public.mandatory_document_workers_v2
    set frozen_at=null,updated_at=now()
    where document_id=p_document_id and owner_id=v_owner and detection_status='CONFIRMED';
    update public.foreman_mandatory_documents
    set assigned_at=null,updated_at=now()
    where id=p_document_id and owner_id=v_owner;
  end if;

  select * into v_worker
  from public.mandatory_document_workers_v2
  where id=p_document_worker_id
    and document_id=p_document_id
    and owner_id=v_owner
  for update;
  if not found then raise exception 'Persona no válida'; end if;

  if p_action='reject' then
    update public.mandatory_document_workers_v2
    set detection_status='REJECTED',
        position_status='REJECTED',
        name_box=null,
        signature_box=null,
        rejection_reason='false_positive',
        frozen_at=null,
        updated_at=now()
    where id=p_document_worker_id;

    delete from public.mandatory_document_signatures_v2
    where document_worker_id=p_document_worker_id;

    if v_worker.legacy_worker_id is not null then
      select coalesce(jsonb_agg(item order by ord),'[]'::jsonb)
      into v_workers
      from jsonb_array_elements(coalesce(v_doc.workers,'[]'::jsonb))
        with ordinality x(item,ord)
      where coalesce(item->>'id','')<>v_worker.legacy_worker_id::text;

      update public.foreman_mandatory_documents
      set signatures=coalesce(signatures,'{}'::jsonb)-v_worker.legacy_worker_id::text,
          workers=v_workers,
          updated_at=now()
      where id=p_document_id and owner_id=v_owner;
    end if;

    -- Cualquier PDF firmado previo queda invalidado al cambiar el conjunto de firmantes.
    update public.foreman_mandatory_pdf_files
    set signed_pdf=null,signed_sha256=null,fidelity=null,updated_at=now()
    where document_id=p_document_id and owner_id=v_owner;
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

  insert into public.mandatory_document_events_v2(
    document_id,owner_id,document_worker_id,event_type,actor_type,metadata,dedup_key
  )
  values(
    p_document_id,v_owner,p_document_worker_id,
    case when p_action='reject' then 'WORKER_REJECTED' else 'WORKER_CONFIRMED' end,
    'supervisor',
    jsonb_build_object(
      'printedName',coalesce(p_printed_name,v_worker.printed_name),
      'nameBox',p_name_box,
      'signatureBox',p_signature_box,
      'source',case when v_was_active and p_action='reject' then 'signature_editor_active_document' else 'review' end
    ),
    case when p_action='reject'
      then 'worker-rejected:'||p_document_worker_id::text
      else 'worker-confirmed:'||p_document_worker_id::text||':'||
        encode(extensions.digest(
          coalesce(p_printed_name,v_worker.printed_name,'')||
          coalesce(p_name_box::text,'')||
          coalesce(p_signature_box::text,''),
          'sha256'
        ),'hex')
    end
  )
  on conflict do nothing;

  perform public.mandatory_v2_refresh_legacy_worker_snapshot(p_document_id);
  v_status:=public.mandatory_v2_resolve_preassignment_status(p_document_id);

  select count(*) into v_confirmed_remaining
  from public.mandatory_document_workers_v2
  where document_id=p_document_id and detection_status='CONFIRMED';

  if p_action='reject' then
    select count(*) into v_signed_remaining
    from public.mandatory_document_signatures_v2 s
    join public.mandatory_document_workers_v2 w on w.id=s.document_worker_id
    where s.document_id=p_document_id
      and w.detection_status='CONFIRMED';

    update public.foreman_mandatory_documents
    set status=case when v_signed_remaining>0 then 'in_progress' else 'pending' end,
        completed_at=null,
        reviewed_at=null,
        updated_at=now()
    where id=p_document_id and owner_id=v_owner;
  end if;

  -- Preserve the operational state, including when the last false positive is removed.
  -- Empty signing projections prevent signatures without an invalid lifecycle transition.
  if v_was_active and p_action='reject' then
    v_status:=v_doc.lifecycle_status;
    update public.foreman_mandatory_documents
    set lifecycle_status=v_status,
        details=coalesce(details,'{}'::jsonb)||jsonb_build_object(
          'lifecycleStatus',v_status,
          'lastRemovedDocumentWorkerId',p_document_worker_id,
          'lastRemovedWorkerAt',now(),
          'lastRemovedWorkerBy','supervisor'
        ),
        updated_at=now()
    where id=p_document_id and owner_id=v_owner;
  else
    if v_confirmed_remaining=0 then
      update public.foreman_mandatory_documents
      set assigned_at=null
      where id=p_document_id and owner_id=v_owner;
    end if;
    update public.foreman_mandatory_documents
    set lifecycle_status=v_status,
        details=coalesce(details,'{}'::jsonb)||jsonb_build_object('lifecycleStatus',v_status),
        updated_at=now()
    where id=p_document_id and owner_id=v_owner;
  end if;

  return jsonb_build_object(
    'ok',true,
    'lifecycleStatus',v_status,
    'removed',p_action='reject',
    'remainingWorkers',v_confirmed_remaining
  );
end;
$function$;
