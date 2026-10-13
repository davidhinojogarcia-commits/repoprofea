-- Explain the exact publication blocker without modifying saved workers or coordinates.
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
  v_names text;
  v_pending integer;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  select lifecycle_status into v_current_status from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_owner for update;
  if not found then raise exception 'Documento no válido'; end if;
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
$$;
revoke all on function public.assign_mandatory_document_v2(uuid) from public,anon;
grant execute on function public.assign_mandatory_document_v2(uuid) to authenticated;
notify pgrst,'reload schema';
