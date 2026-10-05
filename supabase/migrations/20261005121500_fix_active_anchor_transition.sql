-- GestionProfea · hotfix transición V2 al guardar firmas en documento activo
-- Evita que mandatory_v2_refresh_legacy_worker_snapshot fuerce READY mientras
-- el documento está IN_SIGNATURE/ASSIGNED. En documentos activos se refresca
-- solo el espejo JSON y se conserva el lifecycle operativo.

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
  v_was_active boolean:=false;
  v_status text;
  v_ids jsonb;
  v_anchors jsonb;
  v_workers jsonb;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;

  select * into v_doc
  from public.foreman_mandatory_documents
  where id=p_document_id and owner_id=v_owner
  for update;
  if not found then raise exception 'Documento no válido'; end if;

  if v_doc.lifecycle_status in ('SUBMITTED','RECEIVED','REVIEWED') then
    raise exception 'El documento ya está congelado';
  end if;

  v_was_active:=v_doc.lifecycle_status in ('ASSIGNED','IN_SIGNATURE');

  if v_doc.lifecycle_status='RETURNED_FOR_CORRECTION' then
    update public.mandatory_document_workers_v2
    set frozen_at=null,updated_at=now()
    where document_id=p_document_id
      and owner_id=v_owner
      and detection_status='CONFIRMED';
    update public.foreman_mandatory_documents
    set assigned_at=null,updated_at=now()
    where id=p_document_id and owner_id=v_owner;
  end if;

  if not public.mandatory_v2_box_valid(p_signature_box) then
    raise exception 'La posición de firma debe ser válida';
  end if;

  select * into v_worker
  from public.mandatory_document_workers_v2
  where id=p_document_worker_id
    and document_id=p_document_id
    and owner_id=v_owner
    and detection_status='CONFIRMED'
  for update;
  if not found then raise exception 'Persona documental no válida'; end if;

  update public.mandatory_document_workers_v2
  set name_box=p_name_box,
      signature_box=p_signature_box,
      position_source=case when public.mandatory_v2_box_valid(p_name_box) then 'AUTO' else 'MANUAL' end,
      page=coalesce(p_page,page),
      row_index=coalesce(p_row_index,row_index),
      position_status='RESOLVED',
      frozen_at=case when v_was_active then coalesce(frozen_at,now()) else null end,
      updated_at=now()
  where id=p_document_worker_id;

  insert into public.mandatory_document_events_v2(
    document_id,owner_id,document_worker_id,event_type,actor_type,metadata,dedup_key
  )
  values(
    p_document_id,v_owner,p_document_worker_id,'SIGNATURE_POSITION_RESOLVED','supervisor',
    jsonb_build_object('page',p_page,'rowIndex',p_row_index,'activeDocument',v_was_active),
    'geometry:'||p_document_worker_id::text||':'||
      encode(extensions.digest(coalesce(p_signature_box::text,''),'sha256'),'hex')
  )
  on conflict do nothing;

  update public.foreman_mandatory_pdf_files
  set signed_pdf=null,signed_sha256=null,fidelity=null,updated_at=now()
  where document_id=p_document_id and owner_id=v_owner;

  if v_was_active then
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

    v_status:=v_doc.lifecycle_status;

    update public.foreman_mandatory_documents
    set details=coalesce(details,'{}'::jsonb)||jsonb_build_object(
          'importedWorkerIds',v_ids,
          'workerAnchors',v_anchors,
          'documentWorkersV2',v_workers,
          'lifecycleStatus',v_status,
          'supervisorAdjustedAnchorsAt',now()
        ),
        lifecycle_status=v_status,
        updated_at=now()
    where id=p_document_id and owner_id=v_owner;
  else
    perform public.mandatory_v2_refresh_legacy_worker_snapshot(p_document_id);
    v_status:=public.mandatory_v2_resolve_preassignment_status(p_document_id);

    update public.foreman_mandatory_documents
    set lifecycle_status=v_status,
        details=coalesce(details,'{}'::jsonb)||jsonb_build_object(
          'lifecycleStatus',v_status,
          'supervisorAdjustedAnchorsAt',now()
        ),
        updated_at=now()
    where id=p_document_id and owner_id=v_owner;
  end if;

  return jsonb_build_object(
    'ok',true,
    'lifecycleStatus',v_status,
    'documentWorkerId',p_document_worker_id,
    'page',coalesce(p_page,v_worker.page),
    'rowIndex',coalesce(p_row_index,v_worker.row_index),
    'signatureBox',p_signature_box
  );
end;
$$;

revoke all on function public.update_mandatory_document_worker_geometry_v2(uuid,uuid,jsonb,jsonb,integer,integer) from public,anon;
grant execute on function public.update_mandatory_document_worker_geometry_v2(uuid,uuid,jsonb,jsonb,integer,integer) to authenticated;

notify pgrst, 'reload schema';
