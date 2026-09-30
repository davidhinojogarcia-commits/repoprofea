-- Inicio / Control de presencia in the foreman portal are source-driven only.
-- They may exist only after an explicit PDF import or an explicit Gmail recovery.
-- Never rebuild them from workers, periods or historic worksite data.

create or replace function public.prepare_foreman_mandatory_documents(p_workers jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Legacy automatic generation intentionally disabled.
  -- Inicio / Control are created only through prepare_foreman_mandatory_from_email.
  return 0;
end;
$$;

revoke all on function public.prepare_foreman_mandatory_documents(jsonb) from public, anon;
grant execute on function public.prepare_foreman_mandatory_documents(jsonb) to authenticated;

-- Remove only legacy, unfinished automatically generated rows.
-- Imported/manual PDFs always carry source_attachment_name.
delete from public.foreman_mandatory_documents
where document_type in ('inicio','control_presencia')
  and source_attachment_name is null
  and coalesce(details->>'sourceFilename','')=''
  and status in ('pending','in_progress','returned');

-- A worker may sign an imported Inicio / Control only when that worker was
-- actually recognized in that exact source PDF.
create or replace function public.sign_foreman_mandatory_document(
  p_token text,
  p_document_id uuid,
  p_worker_id bigint,
  p_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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
  if length(trim(coalesce(p_signature,''))) < 20 then
    raise exception 'Firma no válida';
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
   limit 1;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.status in ('completed','reviewed') and not coalesce(v_doc.correction_pending,false) then
    raise exception 'El documento ya está finalizado';
  end if;

  v_workers := coalesce(v_doc.workers,'[]'::jsonb);

  if v_doc.document_type in ('inicio','control_presencia') then
    -- Source of truth: importedWorkerIds from THIS PDF, never the worksite roster.
    select exists(
      select 1
      from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb)) x(worker_id)
      where x.worker_id = p_worker_id::text
    ) into v_allowed;

    if not v_allowed then
      raise exception 'Este trabajador no aparece en el documento importado';
    end if;

    select jsonb_build_object(
      'id',t.id,
      'apellidosNombre',t.apellidos_nombre,
      'dni',t.dni,
      'categoria',t.categoria,
      'obra',t.obra,
      'numOferta',t.num_oferta,
      'periodoInicio',t.periodo_inicio,
      'periodoFin',t.periodo_fin
    )
    into v_worker
    from public.trabajadores t
    where t.owner_id=v_access.owner_id
      and t.id=p_worker_id
      and lower(coalesce(t.obra,''))=lower(v_access.obra)
    limit 1;

    if v_worker is null then
      raise exception 'Trabajador no válido para esta obra';
    end if;

    if not exists(
      select 1
      from jsonb_array_elements(v_workers) w
      where w->>'id'=p_worker_id::text
    ) then
      v_workers := v_workers || jsonb_build_array(v_worker);
    end if;
  else
    if not exists(
      select 1
      from jsonb_array_elements(v_workers) w
      where w->>'id'=p_worker_id::text
    ) then
      raise exception 'Trabajador no incluido en el documento';
    end if;
  end if;

  v_signatures := coalesce(v_doc.signatures,'{}'::jsonb) || jsonb_build_object(
    p_worker_id::text,
    jsonb_build_object('signature',p_signature,'signedAt',now())
  );

  select count(*) into v_total
  from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb))
  where v_doc.document_type in ('inicio','control_presencia');

  if v_doc.document_type not in ('inicio','control_presencia') then
    select count(*) into v_total from jsonb_array_elements(v_workers);
  end if;

  select count(*) into v_signed
  from jsonb_object_keys(v_signatures) key
  where v_doc.document_type not in ('inicio','control_presencia')
     or exists(
       select 1
       from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb)) x(worker_id)
       where x.worker_id = key
     );

  update public.foreman_mandatory_documents
     set workers=v_workers,
         signatures=v_signatures,
         status='in_progress',
         completed_at=null,
         updated_at=now()
   where id=v_doc.id;

  insert into public.worker_document_evidence(
    owner_id,worker_id,obra,document_id,document_type,work_date,category,signed_at,metadata
  ) values(
    v_access.owner_id,p_worker_id,v_doc.obra,v_doc.id,v_doc.document_type,v_doc.work_date,v_doc.category,now(),
    jsonb_build_object('source','portal_encargado','status','signed')
  )
  on conflict(owner_id,worker_id,document_id) do update
    set signed_at=excluded.signed_at,
        metadata=excluded.metadata;

  return jsonb_build_object(
    'ok',true,
    'signed',v_signed,
    'total',v_total,
    'readyToFinalize',v_signed>=v_total and v_total>0
  );
end;
$$;

revoke all on function public.sign_foreman_mandatory_document(text,uuid,bigint,text) from public, anon;
grant execute on function public.sign_foreman_mandatory_document(text,uuid,bigint,text) to anon, authenticated;

-- Explicit recovery from Gmail may intentionally bring back a previously deleted attachment.
-- Automatic scans never call this function.
create or replace function public.restore_foreman_mandatory_gmail_source(
  p_gmail_message_id text,
  p_attachment_name text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_deleted integer := 0;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if coalesce(trim(p_gmail_message_id),'')='' or coalesce(trim(p_attachment_name),'')='' then return 0; end if;

  delete from public.foreman_mandatory_delete_tombstones
   where owner_id=v_owner
     and source_gmail_message_id=p_gmail_message_id
     and source_attachment_name=p_attachment_name;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.restore_foreman_mandatory_gmail_source(text,text) from public, anon;
grant execute on function public.restore_foreman_mandatory_gmail_source(text,text) to authenticated;
