-- Preserve imported Inicio / Control de presencia PDFs byte-for-byte as the master source.
-- Signed copies are stored separately and may differ only by signature overlays.

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
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

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
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_doc public.foreman_mandatory_documents%rowtype;
  v_unresolved integer := 0;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  select * into v_doc
  from public.foreman_mandatory_documents
  where id=p_document_id and owner_id=v_owner
  for update;
  if not found then raise exception 'Documento no válido'; end if;
  if v_doc.document_type not in ('inicio','control_presencia') then
    raise exception 'Este modo solo se aplica a Inicio y Control de presencia';
  end if;

  if jsonb_typeof(coalesce(p_worker_anchors,'[]'::jsonb)) <> 'array' then
    raise exception 'Metadatos de posiciones no válidos';
  end if;

  select count(*) into v_unresolved
  from jsonb_array_elements(coalesce(p_worker_anchors,'[]'::jsonb)) anchor
  where coalesce((anchor->>'resolved')::boolean,false)=false;

  insert into public.foreman_mandatory_pdf_files(
    document_id,owner_id,original_pdf,signed_pdf,original_filename,original_sha256,
    signed_sha256,page_meta,fidelity,updated_at
  ) values(
    p_document_id,v_owner,decode(p_pdf_base64,'base64'),null,coalesce(p_filename,''),
    coalesce(p_original_sha256,''),null,coalesce(p_page_meta,'[]'::jsonb),null,now()
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
      'originalSha256',coalesce(p_original_sha256,''),
      'pageMeta',coalesce(p_page_meta,'[]'::jsonb),
      'workerAnchors',coalesce(p_worker_anchors,'[]'::jsonb),
      'unresolvedAnchorCount',v_unresolved
    ),
    updated_at=now()
  where id=p_document_id;

  return jsonb_build_object('ok',true,'unresolvedAnchorCount',v_unresolved);
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
  limit 1;
  if not found then raise exception 'Documento no válido'; end if;

  select * into v_file
  from public.foreman_mandatory_pdf_files
  where document_id=v_doc.id and owner_id=v_access.owner_id;
  if not found then raise exception 'El PDF original no está disponible; debe volver a importarse'; end if;

  if lower(coalesce(p_variant,'original'))='signed' and v_file.signed_pdf is not null then
    v_bytes := v_file.signed_pdf;
    v_sha := v_file.signed_sha256;
  else
    v_bytes := v_file.original_pdf;
    v_sha := v_file.original_sha256;
  end if;

  return jsonb_build_object(
    'base64',encode(v_bytes,'base64'),
    'filename',v_file.original_filename,
    'sha256',coalesce(v_sha,''),
    'variant',case when v_bytes=v_file.signed_pdf and v_file.signed_pdf is not null then 'signed' else 'original' end,
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
begin
  if v_owner is null then raise exception 'Authentication required'; end if;

  select f.* into v_file
  from public.foreman_mandatory_pdf_files f
  join public.foreman_mandatory_documents d on d.id=f.document_id
  where f.document_id=p_document_id and f.owner_id=v_owner and d.owner_id=v_owner
  limit 1;
  if not found then raise exception 'PDF no disponible'; end if;

  if lower(coalesce(p_variant,'signed'))='signed' and v_file.signed_pdf is not null then
    v_bytes := v_file.signed_pdf;
    v_sha := v_file.signed_sha256;
  else
    v_bytes := v_file.original_pdf;
    v_sha := v_file.original_sha256;
  end if;

  return jsonb_build_object(
    'base64',encode(v_bytes,'base64'),
    'filename',v_file.original_filename,
    'sha256',coalesce(v_sha,''),
    'variant',case when v_bytes=v_file.signed_pdf and v_file.signed_pdf is not null then 'signed' else 'original' end,
    'fidelity',v_file.fidelity
  );
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
  v_unresolved integer := 0;
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

  if coalesce(v_doc.details->>'originalPdfMode','') <> 'overlay' then
    raise exception 'El documento no está configurado en modo PDF original';
  end if;

  select count(*) into v_unresolved
  from jsonb_array_elements(coalesce(v_doc.details->'workerAnchors','[]'::jsonb)) anchor
  where coalesce((anchor->>'resolved')::boolean,false)=false;
  if v_unresolved > 0 then
    raise exception 'Hay posiciones de firma pendientes de confirmar';
  end if;

  if coalesce((p_fidelity->>'ok')::boolean,false)=false then
    raise exception 'La verificación de fidelidad del PDF no ha sido superada';
  end if;

  update public.foreman_mandatory_pdf_files
  set signed_pdf=decode(p_pdf_base64,'base64'),
      signed_sha256=coalesce(p_signed_sha256,''),
      fidelity=coalesce(p_fidelity,'{}'::jsonb),
      updated_at=now()
  where document_id=p_document_id and owner_id=v_access.owner_id;

  if not found then raise exception 'El PDF original no está almacenado'; end if;

  return jsonb_build_object('ok',true);
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
     and coalesce(old.status,'') <> 'completed'
     and new.document_type in ('inicio','control_presencia')
     and coalesce(new.details->>'originalPdfMode','')='overlay' then

    select count(*) into v_unresolved
    from jsonb_array_elements(coalesce(new.details->'workerAnchors','[]'::jsonb)) anchor
    where coalesce((anchor->>'resolved')::boolean,false)=false;

    if v_unresolved > 0 then
      raise exception 'Hay posiciones de firma pendientes de confirmar';
    end if;

    select * into v_file
    from public.foreman_mandatory_pdf_files
    where document_id=new.id and owner_id=new.owner_id;

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

drop trigger if exists trg_guard_exact_mandatory_pdf_completion on public.foreman_mandatory_documents;
create trigger trg_guard_exact_mandatory_pdf_completion
before update of status on public.foreman_mandatory_documents
for each row
execute function public.guard_exact_mandatory_pdf_completion();

revoke all on function public.save_foreman_mandatory_original_pdf(uuid,text,text,text,jsonb,jsonb) from public;
grant execute on function public.save_foreman_mandatory_original_pdf(uuid,text,text,text,jsonb,jsonb) to authenticated;

revoke all on function public.get_foreman_mandatory_pdf(text,uuid,text) from public;
grant execute on function public.get_foreman_mandatory_pdf(text,uuid,text) to anon, authenticated;

revoke all on function public.get_supervisor_mandatory_pdf(uuid,text) from public;
grant execute on function public.get_supervisor_mandatory_pdf(uuid,text) to authenticated;

revoke all on function public.store_foreman_mandatory_signed_pdf(text,uuid,text,text,jsonb) from public;
grant execute on function public.store_foreman_mandatory_signed_pdf(text,uuid,text,text,jsonb) to anon, authenticated;
