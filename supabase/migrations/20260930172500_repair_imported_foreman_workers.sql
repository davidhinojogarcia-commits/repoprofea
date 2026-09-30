-- Repair imported Inicio / Control documents from their own source PDF text.
-- Exact worker names and printed worksite are the only source of truth.

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

with candidate_docs as (
  select
    d.id,
    d.owner_id,
    d.details,
    public.foreman_normalize_text(d.details->>'sourceText') as source_norm,
    (
      select o.nombre
      from public.obras o
      where o.owner_id=d.owner_id
        and public.foreman_normalize_text(d.details->>'sourceText')
            like '%' || public.foreman_normalize_text(o.nombre) || '%'
      order by length(public.foreman_normalize_text(o.nombre)) desc
      limit 1
    ) as detected_obra
  from public.foreman_mandatory_documents d
  where d.document_type in ('inicio','control_presencia')
    and d.source_attachment_name is not null
    and d.status in ('pending','in_progress','returned')
    and not exists (
      select 1 from jsonb_object_keys(coalesce(d.signatures,'{}'::jsonb))
    )
),
matched as (
  select
    d.id as document_id,
    d.detected_obra,
    t.id as worker_id,
    public.foreman_normalize_text(
      regexp_replace(coalesce(t.apellidos_nombre,''),'\\s*\\[[^]]*\\]\\s*$','','g')
    ) as worker_name_norm,
    row_number() over (
      partition by d.id,
        public.foreman_normalize_text(
          regexp_replace(coalesce(t.apellidos_nombre,''),'\\s*\\[[^]]*\\]\\s*$','','g')
        )
      order by t.id desc
    ) as duplicate_rank
  from candidate_docs d
  join public.trabajadores t
    on t.owner_id=d.owner_id
   and (d.detected_obra is null or lower(coalesce(t.obra,''))=lower(d.detected_obra))
  where length(public.foreman_normalize_text(
          regexp_replace(coalesce(t.apellidos_nombre,''),'\\s*\\[[^]]*\\]\\s*$','','g')
        )) >= 5
    and d.source_norm like '%' ||
        public.foreman_normalize_text(
          regexp_replace(coalesce(t.apellidos_nombre,''),'\\s*\\[[^]]*\\]\\s*$','','g')
        ) || '%'
),
aggregated as (
  select
    d.id,
    d.detected_obra,
    coalesce(
      jsonb_agg(m.worker_id order by strpos(d.source_norm,m.worker_name_norm))
        filter (where m.duplicate_rank=1),
      '[]'::jsonb
    ) as worker_ids
  from candidate_docs d
  left join matched m on m.document_id=d.id
  group by d.id,d.detected_obra,d.source_norm
)
update public.foreman_mandatory_documents doc
set obra=coalesce(a.detected_obra,doc.obra),
    workers='[]'::jsonb,
    details=coalesce(doc.details,'{}'::jsonb) || jsonb_build_object(
      'importedWorkerIds',a.worker_ids,
      'workerAnchors','[]'::jsonb,
      'unresolvedAnchorCount',jsonb_array_length(a.worker_ids),
      'recognitionMode','exact_pdf_name'
    ),
    updated_at=now()
from aggregated a
where doc.id=a.id;

drop function if exists public.foreman_normalize_text(text);
