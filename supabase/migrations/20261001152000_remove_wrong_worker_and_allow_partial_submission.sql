-- Inicio / Control de presencia:
-- 1) permite quitar personas detectadas erróneamente, tanto por supervisor como por encargado;
-- 2) permite enviar el documento al supervisor aunque queden firmas pendientes;
-- 3) conserva trazabilidad explícita del envío parcial.

create or replace function public.remove_foreman_mandatory_worker(
  p_token text,
  p_document_id uuid,
  p_worker_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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
$$;

revoke all on function public.remove_foreman_mandatory_worker(text,uuid,bigint) from public;
grant execute on function public.remove_foreman_mandatory_worker(text,uuid,bigint) to anon, authenticated;


create or replace function public.remove_supervisor_mandatory_worker(
  p_document_id uuid,
  p_worker_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    and document_type in ('inicio','control_presencia')
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
$$;

revoke all on function public.remove_supervisor_mandatory_worker(uuid,bigint) from public, anon;
grant execute on function public.remove_supervisor_mandatory_worker(uuid,bigint) to authenticated;


-- Guardar el PDF deja de exigir el 100% de firmas: puede ser una entrega parcial.
-- La fidelidad del original sigue siendo obligatoria.
create or replace function public.store_foreman_mandatory_signed_pdf(
  p_token text,
  p_document_id uuid,
  p_pdf_base64 text,
  p_signed_sha256 text,
  p_fidelity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_access public.foreman_portal_access%rowtype;
  v_doc public.foreman_mandatory_documents%rowtype;
  v_signed_bytes bytea;
  v_computed_sha text;
  v_total integer := 0;
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
  for update;
  if not found then raise exception 'Documento no válido'; end if;

  if coalesce(v_doc.details->>'originalPdfMode','')<>'overlay' then
    raise exception 'El documento no está configurado en modo PDF original';
  end if;

  if coalesce((p_fidelity->>'ok')::boolean,false)=false then
    raise exception 'La verificación de fidelidad del PDF no ha sido superada';
  end if;

  begin
    v_signed_bytes := decode(coalesce(p_pdf_base64,''),'base64');
  exception when others then
    raise exception 'El PDF firmado no tiene un formato binario válido';
  end;

  if octet_length(v_signed_bytes)=0 then
    raise exception 'El PDF firmado está vacío';
  end if;

  v_computed_sha := encode(digest(v_signed_bytes,'sha256'),'hex');
  if coalesce(trim(p_signed_sha256),'')<>''
     and lower(trim(p_signed_sha256))<>lower(v_computed_sha) then
    raise exception 'La huella SHA-256 del PDF firmado no coincide';
  end if;

  select count(*) into v_total
  from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb));

  select count(*) into v_signed
  from jsonb_object_keys(coalesce(v_doc.signatures,'{}'::jsonb)) key
  where exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb)) ids(value)
    where ids.value=key
  );

  update public.foreman_mandatory_pdf_files
  set signed_pdf=v_signed_bytes,
      signed_sha256=v_computed_sha,
      fidelity=coalesce(p_fidelity,'{}'::jsonb),
      updated_at=now()
  where document_id=p_document_id
    and owner_id=v_access.owner_id;

  if not found then raise exception 'El PDF original no está almacenado'; end if;

  return jsonb_build_object(
    'ok',true,
    'signedSha256',v_computed_sha,
    'signed',v_signed,
    'total',v_total,
    'partial',v_signed<v_total
  );
end;
$$;

revoke all on function public.store_foreman_mandatory_signed_pdf(text,uuid,text,text,jsonb) from public, anon;
grant execute on function public.store_foreman_mandatory_signed_pdf(text,uuid,text,text,jsonb) to anon, authenticated;


-- El estado completed significa "enviado al supervisor".
-- La completitud de firmas queda registrada aparte para no confundir una entrega parcial.
create or replace function public.finalize_foreman_mandatory_document(
  p_token text,
  p_document_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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
$$;

revoke all on function public.finalize_foreman_mandatory_document(text,uuid) from public;
grant execute on function public.finalize_foreman_mandatory_document(text,uuid) to anon, authenticated;


-- Mantiene las comprobaciones del PDF, pero no impide el estado completed por firmas pendientes.
create or replace function public.guard_exact_mandatory_pdf_completion()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_file public.foreman_mandatory_pdf_files%rowtype;
begin
  if new.status='completed'
     and coalesce(old.status,'')<>'completed'
     and new.document_type in ('inicio','control_presencia')
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
$$;

drop trigger if exists trg_guard_exact_mandatory_pdf_completion
  on public.foreman_mandatory_documents;
create trigger trg_guard_exact_mandatory_pdf_completion
before update of status on public.foreman_mandatory_documents
for each row
execute function public.guard_exact_mandatory_pdf_completion();

comment on function public.finalize_foreman_mandatory_document(text,uuid)
is 'Envía Inicio/Control al supervisor con todas o parte de las firmas; details registra si la entrega es parcial.';
