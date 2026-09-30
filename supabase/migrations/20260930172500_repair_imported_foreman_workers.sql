-- Imported Inicio / Control documents are self-contained.
-- The PDF's printed worksite and printed people are the source of truth.

create or replace function public.repair_foreman_mandatory_anchors(
  p_token text,
  p_document_id uuid,
  p_worker_anchors jsonb
)
returns boolean
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
  if jsonb_typeof(coalesce(p_worker_anchors,'[]'::jsonb)) <> 'array' then
    raise exception 'Zonas de firma no válidas';
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
    and document_type in ('inicio','control_presencia')
  for update;
  if not found then raise exception 'Documento no válido'; end if;

  select count(*) into v_unresolved
  from jsonb_array_elements(coalesce(p_worker_anchors,'[]'::jsonb)) a
  where coalesce((a->>'resolved')::boolean,false)=false;

  update public.foreman_mandatory_documents
  set details=coalesce(details,'{}'::jsonb) || jsonb_build_object(
        'workerAnchors',coalesce(p_worker_anchors,'[]'::jsonb),
        'unresolvedAnchorCount',v_unresolved
      ),
      updated_at=now()
  where id=p_document_id;

  return true;
end;
$$;

revoke all on function public.repair_foreman_mandatory_anchors(text,uuid,jsonb) from public;
grant execute on function public.repair_foreman_mandatory_anchors(text,uuid,jsonb) to anon, authenticated;

create or replace function public.foreman_normalize_text(p_value text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    regexp_replace(
      upper(translate(coalesce(p_value,''),
        'ÁÉÍÓÚÜÀÈÌÒÙÂÊÎÔÛÄËÏÖÜÇ',
        'AEIOUUAEIOUAEIOUAEIOUC')),
      '[^A-Z0-9Ñ]+',' ','g'),
    '\\s+',' ','g'
  ));
$$;

-- Repair already imported, unsigned rows from the text embedded in their PDFs.
with candidate_docs as (
  select
    d.id,d.owner_id,d.details,d.obra as old_obra,
    coalesce((
      select o.nombre
      from public.obras o
      where o.owner_id=d.owner_id
        and public.foreman_normalize_text(d.details->>'sourceText')
            like '%' || public.foreman_normalize_text(o.nombre) || '%'
      order by length(public.foreman_normalize_text(o.nombre)) desc
      limit 1
    ),d.obra) as detected_obra
  from public.foreman_mandatory_documents d
  where d.document_type in ('inicio','control_presencia')
    and d.source_attachment_name is not null
    and d.status in ('pending','in_progress','returned')
    and not exists (
      select 1 from jsonb_object_keys(coalesce(d.signatures,'{}'::jsonb))
    )
),
printed_names as (
  select
    d.id,d.owner_id,d.detected_obra,
    trim(regexp_replace(line.raw_line, '\\s*,\\s*', ' ', 'g')) as display_name,
    public.foreman_normalize_text(trim(regexp_replace(line.raw_line, '\\s*,\\s*', ' ', 'g'))) as name_norm,
    line.ord
  from candidate_docs d
  cross join lateral regexp_split_to_table(coalesce(d.details->>'sourceText',''), E'\\n')
    with ordinality as line(raw_line,ord)
  where line.raw_line like '%,%'
    and trim(line.raw_line)=upper(trim(line.raw_line))
    and public.foreman_normalize_text(line.raw_line) !~ '^(CADIZ|DIPUTACION|CATEGORIA|AREA|GESTION|EXCMA|EMPRESA|PAGINA)\\b'
    and public.foreman_normalize_text(line.raw_line) ~ '^[A-ZÑ]+( [A-ZÑ]+)+$'
),
dedup_names as (
  select distinct on (id,name_norm)
    id,owner_id,detected_obra,display_name,name_norm,ord
  from printed_names
  where length(name_norm)>=5
  order by id,name_norm,ord
),
resolved as (
  select
    n.*,
    t.id as canonical_id,
    t.dni as canonical_dni,
    t.categoria as canonical_category,
    t.apellidos_nombre as canonical_name,
    -(3000000000::bigint + (('x'||substr(md5(n.name_norm),1,8))::bit(32)::bigint)) as synthetic_id
  from dedup_names n
  left join lateral (
    select w.*
    from public.trabajadores w
    where w.owner_id=n.owner_id
      and public.foreman_normalize_text(regexp_replace(coalesce(w.apellidos_nombre,''),'\\s*\\[[^]]*\\]\\s*$','','g'))=n.name_norm
    order by
      case when lower(coalesce(w.obra,''))=lower(n.detected_obra) then 0 else 1 end,
      w.id desc
    limit 1
  ) t on true
),
aggregated as (
  select
    d.id,d.detected_obra,
    coalesce(jsonb_agg(coalesce(r.canonical_id,r.synthetic_id) order by r.ord)
      filter(where r.name_norm is not null),'[]'::jsonb) as worker_ids,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id',coalesce(r.canonical_id,r.synthetic_id),
        'apellidosNombre',coalesce(r.canonical_name,r.display_name),
        'dni',coalesce(r.canonical_dni,''),
        'categoria',coalesce(r.canonical_category,''),
        'obra',d.detected_obra
      ) order by r.ord
    ) filter(where r.name_norm is not null),'[]'::jsonb) as imported_workers
  from candidate_docs d
  left join resolved r on r.id=d.id
  group by d.id,d.detected_obra
)
update public.foreman_mandatory_documents doc
set obra=a.detected_obra,
    workers='[]'::jsonb,
    details=coalesce(doc.details,'{}'::jsonb) || jsonb_build_object(
      'importedWorkerIds',a.worker_ids,
      'importedWorkers',a.imported_workers,
      'workerAnchors','[]'::jsonb,
      'unresolvedAnchorCount',jsonb_array_length(a.worker_ids),
      'recognitionMode','pdf_printed_people'
    ),
    updated_at=now()
from aggregated a
where doc.id=a.id;

-- Imported workers can be document-local snapshots. They do not need to exist
-- in the supervisor's directory in order to sign the PDF they are printed on.
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
  if length(trim(coalesce(p_signature,''))) < 20 then raise exception 'Firma no válida'; end if;

  v_hash := encode(digest(trim(coalesce(p_token,'')), 'sha256'), 'hex');
  select * into v_access from public.foreman_portal_access
  where token_hash=v_hash and active=true limit 1;
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
    select exists(
      select 1
      from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb)) x(worker_id)
      where x.worker_id=p_worker_id::text
    ) into v_allowed;
    if not v_allowed then raise exception 'Esta persona no aparece en el documento importado'; end if;

    select w into v_worker
    from jsonb_array_elements(coalesce(v_doc.details->'importedWorkers','[]'::jsonb)) w
    where w->>'id'=p_worker_id::text
    limit 1;

    if v_worker is null then
      select jsonb_build_object(
        'id',t.id,'apellidosNombre',t.apellidos_nombre,'dni',t.dni,
        'categoria',t.categoria,'obra',v_doc.obra,'numOferta',t.num_oferta,
        'periodoInicio',t.periodo_inicio,'periodoFin',t.periodo_fin
      ) into v_worker
      from public.trabajadores t
      where t.owner_id=v_access.owner_id and t.id=p_worker_id
      limit 1;
    end if;

    if v_worker is null then raise exception 'No se han podido recuperar los datos de esta persona'; end if;

    if not exists(select 1 from jsonb_array_elements(v_workers) w where w->>'id'=p_worker_id::text) then
      v_workers:=v_workers||jsonb_build_array(v_worker);
    end if;
  else
    if not exists(select 1 from jsonb_array_elements(v_workers) w where w->>'id'=p_worker_id::text) then
      raise exception 'Trabajador no incluido en el documento';
    end if;
  end if;

  v_signatures:=coalesce(v_doc.signatures,'{}'::jsonb)||jsonb_build_object(
    p_worker_id::text,jsonb_build_object('signature',p_signature,'signedAt',now())
  );

  if v_doc.document_type in ('inicio','control_presencia') then
    select count(*) into v_total
    from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb));
    select count(*) into v_signed
    from jsonb_object_keys(v_signatures) key
    where exists(
      select 1 from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb)) x(worker_id)
      where x.worker_id=key
    );
  else
    select count(*) into v_total from jsonb_array_elements(v_workers);
    select count(*) into v_signed from jsonb_object_keys(v_signatures);
  end if;

  update public.foreman_mandatory_documents
  set workers=v_workers,signatures=v_signatures,status='in_progress',completed_at=null,updated_at=now()
  where id=v_doc.id;

  insert into public.worker_document_evidence(
    owner_id,worker_id,obra,document_id,document_type,work_date,category,signed_at,metadata
  ) values(
    v_access.owner_id,p_worker_id,v_doc.obra,v_doc.id,v_doc.document_type,v_doc.work_date,v_doc.category,now(),
    jsonb_build_object('source','portal_encargado','status','signed','documentLocal',p_worker_id<0)
  )
  on conflict(owner_id,worker_id,document_id) do update
    set signed_at=excluded.signed_at,metadata=excluded.metadata;

  return jsonb_build_object('ok',true,'signed',v_signed,'total',v_total,'readyToFinalize',v_signed>=v_total and v_total>0);
end;
$$;

revoke all on function public.sign_foreman_mandatory_document(text,uuid,bigint,text) from public, anon;
grant execute on function public.sign_foreman_mandatory_document(text,uuid,bigint,text) to anon, authenticated;

drop function if exists public.foreman_normalize_text(text);
