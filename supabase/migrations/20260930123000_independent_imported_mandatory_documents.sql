-- Imported Inicio / Control PDFs are independent documents.
-- Keep deduplication only for the exact same Gmail attachment.
drop index if exists public.foreman_mandatory_document_unique_idx;

create unique index if not exists foreman_mandatory_generated_unique_idx
  on public.foreman_mandatory_documents(owner_id, obra, period_key, document_type, category)
  where source_attachment_name is null;

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

  if coalesce(trim(p_obra_hint),'')<>'' then
    v_obra := trim(p_obra_hint);
  end if;

  if coalesce(trim(v_obra),'')='' and coalesce(array_length(p_worker_ids,1),0)>0 then
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

  -- Exact Gmail attachment: reuse only that exact source to avoid rescanning duplicates.
  if nullif(trim(coalesce(p_gmail_message_id,'')),'') is not null
     and nullif(trim(coalesce(p_attachment_name,'')),'') is not null then
    select id
      into v_id
    from public.foreman_mandatory_documents
    where owner_id=v_owner
      and source_gmail_message_id=p_gmail_message_id
      and source_attachment_name=p_attachment_name
    limit 1;

    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- Manual imports and different attachments always create independent documents.
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
grant execute on function public.prepare_foreman_mandatory_from_email(
  text,bigint[],date,text,text,text,text,text,text,text,text,text
) to authenticated;
