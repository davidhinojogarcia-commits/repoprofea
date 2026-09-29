-- Imported Inicio / Control de presencia documents must start without workers.
-- A worker is appended to the document only when that worker signs in the foreman portal.

create or replace function public.prepare_foreman_mandatory_from_email(
  p_document_type text,
  p_worker_ids bigint[],
  p_work_date date,
  p_category text,
  p_period_key text,
  p_gmail_message_id text,
  p_gmail_thread_id text,
  p_rfc_message_id text,
  p_email_from text,
  p_email_subject text,
  p_attachment_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_obra text;
  v_id uuid;
  v_category text := coalesce(trim(p_category),'');
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if p_document_type not in ('inicio','control_presencia') then raise exception 'Tipo de documento no válido'; end if;
  if coalesce(array_length(p_worker_ids,1),0)=0 then raise exception 'No hay datos suficientes para identificar la obra'; end if;

  -- The detected worker ids are used only to resolve the worksite.
  -- They are never copied into the imported document.
  select t.obra into v_obra
  from public.trabajadores t
  where t.owner_id=v_owner and t.id=any(p_worker_ids)
  group by t.obra
  order by count(*) desc
  limit 1;

  if coalesce(trim(v_obra),'')='' then raise exception 'No se ha podido identificar la obra'; end if;
  if p_document_type='control_presencia' then v_category := ''; end if;

  insert into public.foreman_mandatory_documents(
    owner_id,obra,period_key,work_date,document_type,category,workers,signatures,status,
    source_gmail_message_id,source_gmail_thread_id,source_rfc_message_id,source_email_from,
    source_email_subject,source_attachment_name,updated_at
  ) values(
    v_owner,v_obra,coalesce(nullif(trim(p_period_key),''),to_char(coalesce(p_work_date,current_date),'YYYY-MM-DD')),
    coalesce(p_work_date,current_date),p_document_type,v_category,'[]'::jsonb,'{}'::jsonb,'pending',
    p_gmail_message_id,p_gmail_thread_id,p_rfc_message_id,p_email_from,p_email_subject,p_attachment_name,now()
  )
  on conflict(owner_id,obra,period_key,document_type,category)
  do update set
    source_gmail_message_id=coalesce(excluded.source_gmail_message_id, public.foreman_mandatory_documents.source_gmail_message_id),
    source_gmail_thread_id=coalesce(excluded.source_gmail_thread_id, public.foreman_mandatory_documents.source_gmail_thread_id),
    source_rfc_message_id=coalesce(excluded.source_rfc_message_id, public.foreman_mandatory_documents.source_rfc_message_id),
    source_email_from=coalesce(excluded.source_email_from, public.foreman_mandatory_documents.source_email_from),
    source_email_subject=coalesce(excluded.source_email_subject, public.foreman_mandatory_documents.source_email_subject),
    source_attachment_name=coalesce(excluded.source_attachment_name, public.foreman_mandatory_documents.source_attachment_name),
    updated_at=now()
  returning id into v_id;

  return v_id;
end;
$$;

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
    select jsonb_build_object(
      'id',t.id,
      'apellidosNombre',t.apellidos_nombre,
      'dni',t.dni,
      'categoria',t.categoria,
      'obra',t.obra,
      'numOferta',t.num_oferta,
      'periodoInicio',t.periodo_inicio,
      'periodoFin',t.periodo_fin,
      'quincena',t.quincena
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

    if v_doc.document_type='control_presencia' then
      if exists(
        select 1 from public.trabajadores t
        where t.owner_id=v_access.owner_id
          and t.id=p_worker_id
          and (
            (nullif(t.periodo_inicio,'') is not null and nullif(t.periodo_inicio,'')::date > v_doc.work_date)
            or
            (nullif(t.periodo_fin,'') is not null and nullif(t.periodo_fin,'')::date < v_doc.work_date)
          )
      ) then
        raise exception 'El trabajador no pertenece al periodo de este control de presencia';
      end if;
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

  select count(*) into v_total from jsonb_array_elements(v_workers);
  select count(*) into v_signed from jsonb_each(v_signatures);

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

-- Repair existing imported documents that were preloaded with workers:
-- keep only workers that have already signed; pending unsigned rows disappear.
update public.foreman_mandatory_documents f
set workers = coalesce((
  select jsonb_agg(w order by w->>'apellidosNombre')
  from jsonb_array_elements(coalesce(f.workers,'[]'::jsonb)) w
  where coalesce(f.signatures,'{}'::jsonb) ? (w->>'id')
),'[]'::jsonb),
updated_at = now()
where f.document_type in ('inicio','control_presencia')
  and f.source_attachment_name is not null
  and f.status in ('pending','in_progress');

revoke all on function public.prepare_foreman_mandatory_from_email(text,bigint[],date,text,text,text,text,text,text,text,text) from public;
grant execute on function public.prepare_foreman_mandatory_from_email(text,bigint[],date,text,text,text,text,text,text,text,text) to authenticated;

revoke all on function public.sign_foreman_mandatory_document(text,uuid,bigint,text) from public;
grant execute on function public.sign_foreman_mandatory_document(text,uuid,bigint,text) to anon, authenticated;
