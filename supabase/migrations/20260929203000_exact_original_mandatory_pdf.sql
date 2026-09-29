-- Exact preservation for imported Inicio / Control de presencia PDFs.
-- The imported PDF remains the immutable visual master. The signed copy is the
-- same document with signature images overlaid in confirmed coordinates only.

drop function if exists public.prepare_foreman_mandatory_from_email(
  text,bigint[],date,text,text,text,text,text,text,text,text
);

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
  p_attachment_name text,
  p_obra_hint text default null
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
  v_existing public.foreman_mandatory_documents%rowtype;
  v_category text := coalesce(trim(p_category),'');
  v_period_key text;
  v_valid_worker_ids bigint[] := '{}'::bigint[];
  v_imported_ids jsonb := '[]'::jsonb;
begin
  if v_owner is null then
    raise exception 'Authentication required';
  end if;
  if p_document_type not in ('inicio','control_presencia') then
    raise exception 'Tipo de documento no válido';
  end if;

  if coalesce(array_length(p_worker_ids,1),0)>0 then
    select t.obra
      into v_obra
    from unnest(p_worker_ids) with ordinality ids(id,ord)
    join public.trabajadores t
      on t.id=ids.id
     and t.owner_id=v_owner
    group by t.obra
    order by count(*) desc, min(ids.ord)
    limit 1;
  end if;

  if coalesce(trim(v_obra),'')='' and coalesce(trim(p_obra_hint),'')<>'' then
    select t.obra
      into v_obra
    from public.trabajadores t
    where t.owner_id=v_owner
      and lower(coalesce(t.obra,''))=lower(trim(p_obra_hint))
    limit 1;
  end if;

  if coalesce(trim(v_obra),'')='' then
    raise exception 'No se ha podido identificar la obra. Selecciona la obra antes de importar el documento';
  end if;

  if p_document_type='control_presencia' then
    v_category := '';
  end if;

  if coalesce(array_length(p_worker_ids,1),0)>0 then
    select coalesce(array_agg(t.id order by ids.ord),'{}'::bigint[])
      into v_valid_worker_ids
    from unnest(p_worker_ids) with ordinality ids(id,ord)
    join public.trabajadores t
      on t.id=ids.id
    where t.owner_id=v_owner
      and lower(coalesce(t.obra,''))=lower(v_obra);
  end if;

  select coalesce(jsonb_agg(worker_id order by ord),'[]'::jsonb)
    into v_imported_ids
  from unnest(v_valid_worker_ids) with ordinality ids2(worker_id,ord);

  v_period_key := coalesce(
    nullif(trim(p_period_key),''),
    to_char(coalesce(p_work_date,current_date),'YYYY-MM-DD')
  );

  select *
    into v_existing
  from public.foreman_mandatory_documents
  where owner_id=v_owner
    and lower(obra)=lower(v_obra)
    and period_key=v_period_key
    and document_type=p_document_type
    and category=v_category
  limit 1
  for update;

  if found then
    if jsonb_object_length(coalesce(v_existing.signatures,'{}'::jsonb))>0 then
      return v_existing.id;
    end if;

    update public.foreman_mandatory_documents
       set work_date=coalesce(p_work_date,work_date),
           source_gmail_message_id=coalesce(p_gmail_message_id,source_gmail_message_id),
           source_gmail_thread_id=coalesce(p_gmail_thread_id,source_gmail_thread_id),
           source_rfc_message_id=coalesce(p_rfc_message_id,source_rfc_message_id),
           source_email_from=coalesce(p_email_from,source_email_from),
           source_email_subject=coalesce(p_email_subject,source_email_subject),
           source_attachment_name=coalesce(p_attachment_name,source_attachment_name),
           details=coalesce(details,'{}'::jsonb) || jsonb_build_object(
             'importedWorkerIds',v_imported_ids,
             'sourceFilename',coalesce(p_attachment_name,source_attachment_name,'')
           ),
           updated_at=now()
     where id=v_existing.id
     returning id into v_id;
    return v_id;
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
    jsonb_build_object(
      'importedWorkerIds',v_imported_ids,
      'sourceFilename',coalesce(p_attachment_name,'')
    ),
    now()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.prepare_foreman_mandatory_from_email(
  text,bigint[],date,text,text,text,text,text,text,text,text,text
) from public;
revoke execute on function public.prepare_foreman_mandatory_from_email(
  text,bigint[],date,text,text,text,text,text,text,text,text,text
) from anon;
grant execute on function public.prepare_foreman_mandatory_from_email(
  text,bigint[],date,text,text,text,text,text,text,text,text,text
) to authenticated;


create table if not exists public.foreman_mandatory_pdf_files (
  document_id uuid primary key references public.foreman_mandatory_documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  original_pdf bytea not null,
  signed_pdf bytea,
  original_filename text not null default '',
  original_sha256 text not null default '',
  signed_sha256 text,
  page_meta jsonb not null default '[]'::jsonb,
  fidelity jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.foreman_mandatory_pdf_files enable row level security;

drop policy if exists "foreman_pdf_files_owner_all" on public.foreman_mandatory_pdf_files;
create policy "foreman_pdf_files_owner_all"
on public.foreman_mandatory_pdf_files
for all
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

revoke all on table public.foreman_mandatory_pdf_files from anon;
grant select,insert,update,delete on table public.foreman_mandatory_pdf_files to authenticated;


create or replace function public.save_foreman_mandatory_original_pdf(
  p_document_id uuid,
  p_pdf_base64 text,
  p_filename text,
  p_original_sha256 text,
  p_page_meta jsonb,
  p_worker_anchors jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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
  if v_doc.document_type not in ('inicio','control_presencia') then
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
       and jsonb_object_length(coalesce(v_doc.signatures,'{}'::jsonb))>0 then
      raise exception 'Este documento ya contiene firmas. El PDF original no puede sustituirse por otro archivo distinto';
    end if;

    if coalesce(v_file.original_sha256,'')=v_computed_sha
       and jsonb_object_length(coalesce(v_doc.signatures,'{}'::jsonb))>0 then
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
$$;


create or replace function public.get_foreman_mandatory_pdf(
  p_token text,
  p_document_id uuid,
  p_variant text default 'original'
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
$$;


create or replace function public.get_supervisor_mandatory_pdf(
  p_document_id uuid,
  p_variant text default 'signed'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_file public.foreman_mandatory_pdf_files%rowtype;
  v_bytes bytea;
  v_sha text;
  v_variant text := 'original';
begin
  if v_owner is null then
    raise exception 'Authentication required';
  end if;

  select f.*
    into v_file
  from public.foreman_mandatory_pdf_files f
  join public.foreman_mandatory_documents d
    on d.id=f.document_id
  where f.document_id=p_document_id
    and f.owner_id=v_owner
    and d.owner_id=v_owner
  limit 1;

  if not found then
    raise exception 'PDF no disponible';
  end if;

  if lower(coalesce(p_variant,'signed'))='signed' and v_file.signed_pdf is not null then
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
$$;


create or replace function public.get_foreman_mandatory_signatures(
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

  return coalesce(v_doc.signatures,'{}'::jsonb);
end;
$$;


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
  v_unresolved integer := 0;
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
  for update;

  if not found then
    raise exception 'Documento no válido';
  end if;
  if coalesce(v_doc.details->>'originalPdfMode','')<>'overlay' then
    raise exception 'El documento no está configurado en modo PDF original';
  end if;

  select count(*)
    into v_unresolved
  from jsonb_array_elements(coalesce(v_doc.details->'workerAnchors','[]'::jsonb)) anchor
  where coalesce((anchor->>'resolved')::boolean,false)=false
     or coalesce(anchor->>'workerId','') !~ '^[1-9][0-9]*$';

  if v_unresolved>0 then
    raise exception 'Hay posiciones o identidades de firma pendientes de confirmar';
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

  update public.foreman_mandatory_pdf_files
     set signed_pdf=v_signed_bytes,
         signed_sha256=v_computed_sha,
         fidelity=coalesce(p_fidelity,'{}'::jsonb),
         updated_at=now()
   where document_id=p_document_id
     and owner_id=v_access.owner_id;

  if not found then
    raise exception 'El PDF original no está almacenado';
  end if;

  return jsonb_build_object(
    'ok',true,
    'signedSha256',v_computed_sha
  );
end;
$$;


create or replace function public.ensure_exact_pdf_worker_anchor_placeholders()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_anchors jsonb := coalesce(new.details->'workerAnchors','[]'::jsonb);
  v_worker jsonb;
  v_id text;
  v_order integer;
  v_unresolved integer;
begin
  if new.document_type not in ('inicio','control_presencia')
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
$$;


create or replace function public.guard_exact_mandatory_pdf_completion()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_file public.foreman_mandatory_pdf_files%rowtype;
  v_unresolved integer := 0;
begin
  if new.status='completed'
     and coalesce(old.status,'')<>'completed'
     and new.document_type in ('inicio','control_presencia')
     and coalesce(new.details->>'originalPdfMode','')='overlay' then

    select count(*)
      into v_unresolved
    from jsonb_array_elements(coalesce(new.details->'workerAnchors','[]'::jsonb)) anchor
    where coalesce((anchor->>'resolved')::boolean,false)=false
       or coalesce(anchor->>'workerId','') !~ '^[1-9][0-9]*$';

    if v_unresolved>0 then
      raise exception 'Hay posiciones o identidades de firma pendientes de confirmar';
    end if;

    select *
      into v_file
    from public.foreman_mandatory_pdf_files
    where document_id=new.id
      and owner_id=new.owner_id;

    if not found or v_file.signed_pdf is null then
      raise exception 'Debe generarse y guardarse el PDF firmado antes de finalizar';
    end if;

    if coalesce((v_file.fidelity->>'ok')::boolean,false)=false then
      raise exception 'La copia firmada no ha superado la verificación de fidelidad';
    end if;
  end if;

  return new;
end;
$$;


drop trigger if exists trg_exact_pdf_anchor_placeholders
  on public.foreman_mandatory_documents;
create trigger trg_exact_pdf_anchor_placeholders
before update of workers on public.foreman_mandatory_documents
for each row
execute function public.ensure_exact_pdf_worker_anchor_placeholders();

drop trigger if exists trg_guard_exact_mandatory_pdf_completion
  on public.foreman_mandatory_documents;
create trigger trg_guard_exact_mandatory_pdf_completion
before update of status on public.foreman_mandatory_documents
for each row
execute function public.guard_exact_mandatory_pdf_completion();


revoke all on function public.save_foreman_mandatory_original_pdf(
  uuid,text,text,text,jsonb,jsonb
) from public;
revoke execute on function public.save_foreman_mandatory_original_pdf(
  uuid,text,text,text,jsonb,jsonb
) from anon;
grant execute on function public.save_foreman_mandatory_original_pdf(
  uuid,text,text,text,jsonb,jsonb
) to authenticated;

revoke all on function public.get_foreman_mandatory_pdf(text,uuid,text) from public;
grant execute on function public.get_foreman_mandatory_pdf(text,uuid,text) to anon, authenticated;

revoke all on function public.get_supervisor_mandatory_pdf(uuid,text) from public;
revoke execute on function public.get_supervisor_mandatory_pdf(uuid,text) from anon;
grant execute on function public.get_supervisor_mandatory_pdf(uuid,text) to authenticated;

revoke all on function public.get_foreman_mandatory_signatures(text,uuid) from public;
grant execute on function public.get_foreman_mandatory_signatures(text,uuid) to anon, authenticated;

revoke all on function public.store_foreman_mandatory_signed_pdf(
  text,uuid,text,text,jsonb
) from public;
grant execute on function public.store_foreman_mandatory_signed_pdf(
  text,uuid,text,text,jsonb
) to anon, authenticated;
