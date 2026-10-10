-- Saving a draft is independent from publication geometry validation.
-- A row lock, revision check and one transaction prevent partial/lost saves.
create or replace function public.save_mandatory_positions_draft_v2(
  p_document_id uuid,p_workers jsonb,p_expected_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare
  v_owner uuid:=auth.uid();v_doc public.foreman_mandatory_documents%rowtype;
  v_worker public.mandatory_document_workers_v2%rowtype;entry jsonb;v_id uuid;
  v_name text;v_signature jsonb;v_name_box jsonb;v_resolved boolean;v_legacy bigint;v_hash text;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_workers) is distinct from 'array' or jsonb_array_length(p_workers)>500 then raise exception 'Lista de trabajadores no válida'; end if;
  select * into v_doc from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_owner for update;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.v2_initialized_at is null or v_doc.document_type not in ('inicio','control_presencia') then raise exception 'Documento no compatible'; end if;
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
$$;
revoke all on function public.save_mandatory_positions_draft_v2(uuid,jsonb,timestamptz) from public,anon;
grant execute on function public.save_mandatory_positions_draft_v2(uuid,jsonb,timestamptz) to authenticated;
notify pgrst,'reload schema';
