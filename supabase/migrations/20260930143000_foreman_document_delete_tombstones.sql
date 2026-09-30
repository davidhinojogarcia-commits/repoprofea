create table if not exists public.foreman_mandatory_delete_tombstones (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  obra text not null,
  period_key text not null,
  document_type text not null,
  category text not null default '',
  source_gmail_message_id text,
  source_attachment_name text,
  deleted_at timestamptz not null default now()
);

alter table public.foreman_mandatory_delete_tombstones enable row level security;

drop policy if exists foreman_mandatory_delete_tombstones_owner_select on public.foreman_mandatory_delete_tombstones;
create policy foreman_mandatory_delete_tombstones_owner_select
on public.foreman_mandatory_delete_tombstones
for select to authenticated
using ((select auth.uid()) = owner_id);

create unique index if not exists foreman_mandatory_delete_tombstones_gmail_uidx
on public.foreman_mandatory_delete_tombstones(owner_id, source_gmail_message_id, source_attachment_name)
where source_gmail_message_id is not null and source_attachment_name is not null;

create unique index if not exists foreman_mandatory_delete_tombstones_generated_uidx
on public.foreman_mandatory_delete_tombstones(owner_id, obra, period_key, document_type, category)
where source_gmail_message_id is null;

create or replace function public.delete_foreman_mandatory_documents(
  p_ids uuid[] default null,
  p_obra text default null
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
  if v_owner is null then
    raise exception 'Authentication required';
  end if;

  if coalesce(array_length(p_ids,1),0)=0 and coalesce(trim(p_obra),'')='' then
    return 0;
  end if;

  insert into public.foreman_mandatory_delete_tombstones(
    owner_id,obra,period_key,document_type,category,
    source_gmail_message_id,source_attachment_name,deleted_at
  )
  select
    d.owner_id,d.obra,d.period_key,d.document_type,coalesce(d.category,''),
    d.source_gmail_message_id,d.source_attachment_name,now()
  from public.foreman_mandatory_documents d
  where d.owner_id=v_owner
    and (
      (coalesce(array_length(p_ids,1),0)>0 and d.id=any(p_ids))
      or (coalesce(trim(p_obra),'')<>'' and lower(d.obra)=lower(trim(p_obra)))
    )
  on conflict do nothing;

  delete from public.foreman_mandatory_documents d
  where d.owner_id=v_owner
    and (
      (coalesce(array_length(p_ids,1),0)>0 and d.id=any(p_ids))
      or (coalesce(trim(p_obra),'')<>'' and lower(d.obra)=lower(trim(p_obra)))
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.delete_foreman_mandatory_documents(uuid[],text) from public, anon;
grant execute on function public.delete_foreman_mandatory_documents(uuid[],text) to authenticated;

-- Prevent the same Gmail attachment from being recreated after the supervisor deletes it.
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
  if v_owner is null then raise exception 'Authentication required'; end if;
  if p_document_type not in ('inicio','control_presencia') then raise exception 'Tipo de documento no válido'; end if;

  if coalesce(trim(p_obra_hint),'')<>'' then v_obra := trim(p_obra_hint); end if;

  if coalesce(trim(v_obra),'')='' and coalesce(array_length(p_worker_ids,1),0)>0 then
    select t.obra into v_obra
    from unnest(p_worker_ids) with ordinality ids(id,ord)
    join public.trabajadores t on t.id=ids.id and t.owner_id=v_owner
    group by t.obra
    order by count(*) desc, min(ids.ord)
    limit 1;
  end if;

  if coalesce(trim(v_obra),'')='' then
    raise exception 'No se ha podido identificar la obra. Selecciona la obra antes de importar el documento';
  end if;

  if p_document_type='control_presencia' then v_category := ''; end if;

  if coalesce(array_length(p_worker_ids,1),0)>0 then
    select coalesce(array_agg(t.id order by ids.ord),'{}'::bigint[])
      into v_valid_worker_ids
    from unnest(p_worker_ids) with ordinality ids(id,ord)
    join public.trabajadores t on t.id=ids.id
    where t.owner_id=v_owner
      and lower(coalesce(t.obra,''))=lower(v_obra);
  end if;

  select coalesce(jsonb_agg(worker_id order by ord),'[]'::jsonb)
    into v_imported_ids
  from unnest(v_valid_worker_ids) with ordinality ids2(worker_id,ord);

  v_period_key := coalesce(nullif(trim(p_period_key),''),to_char(coalesce(p_work_date,current_date),'YYYY-MM-DD'));

  if nullif(trim(coalesce(p_gmail_message_id,'')),'') is not null
     and nullif(trim(coalesce(p_attachment_name,'')),'') is not null then
    if exists (
      select 1
      from public.foreman_mandatory_delete_tombstones t
      where t.owner_id=v_owner
        and t.source_gmail_message_id=p_gmail_message_id
        and t.source_attachment_name=p_attachment_name
    ) then
      return null;
    end if;

    select id into v_id
    from public.foreman_mandatory_documents
    where owner_id=v_owner
      and source_gmail_message_id=p_gmail_message_id
      and source_attachment_name=p_attachment_name
    limit 1;
    if v_id is not null then return v_id; end if;
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
    jsonb_build_object('importedWorkerIds',v_imported_ids,'sourceFilename',coalesce(p_attachment_name,'')),
    now()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.prepare_foreman_mandatory_from_email(text,bigint[],date,text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.prepare_foreman_mandatory_from_email(text,bigint[],date,text,text,text,text,text,text,text,text,text) to authenticated;

-- Prevent generated Inicio / Control rows from being recreated after deletion.
create or replace function public.prepare_foreman_mandatory_documents(p_workers jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_owner uuid := auth.uid();
  v_obra text;
  v_category text;
  v_start date;
  v_period text;
  v_period_key text;
  v_created integer := 0;
  v_new_ids bigint[];
  v_workers jsonb;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_workers) <> 'array' then return 0; end if;

  for v_item in select value from jsonb_array_elements(p_workers)
  loop
    v_obra := trim(coalesce(v_item->>'obra',''));
    v_category := trim(coalesce(v_item->>'categoria',''));
    begin v_start := nullif(v_item->>'periodoInicio','')::date; exception when others then v_start := current_date; end;
    v_start := coalesce(v_start,current_date);
    v_period := trim(coalesce(v_item->>'quincena',''));
    if v_period = '' then v_period := to_char(v_start,'YYYY-MM-DD'); end if;
    v_period_key := v_period||':'||to_char(v_start,'YYYY-MM-DD');
    if v_obra = '' then continue; end if;

    select array_agg((x->>'id')::bigint)
      into v_new_ids
      from jsonb_array_elements(p_workers) x
     where trim(coalesce(x->>'obra','')) = v_obra
       and trim(coalesce(x->>'categoria','')) = v_category
       and coalesce(nullif(x->>'periodoInicio','')::date,current_date) = v_start;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'apellidosNombre',t.apellidos_nombre,'dni',t.dni,
      'categoria',t.categoria,'obra',t.obra,'numOferta',t.num_oferta,
      'periodoInicio',t.periodo_inicio,'periodoFin',t.periodo_fin
    ) order by t.apellidos_nombre),'[]'::jsonb)
      into v_workers
      from public.trabajadores t
     where t.owner_id=v_owner and t.id = any(coalesce(v_new_ids,'{}'::bigint[]));

    if jsonb_array_length(v_workers) > 0 and not exists (
      select 1 from public.foreman_mandatory_delete_tombstones t
      where t.owner_id=v_owner
        and lower(t.obra)=lower(v_obra)
        and t.period_key=v_period_key
        and t.document_type='inicio'
        and t.category=v_category
        and t.source_gmail_message_id is null
    ) then
      insert into public.foreman_mandatory_documents(owner_id,obra,period_key,work_date,document_type,category,workers,updated_at)
      values(v_owner,v_obra,v_period_key,v_start,'inicio',v_category,v_workers,now())
      on conflict(owner_id,obra,period_key,document_type,category) where source_attachment_name is null do update
        set workers=excluded.workers, updated_at=now(),
            status=case when public.foreman_mandatory_documents.status='reviewed' then 'reviewed' else public.foreman_mandatory_documents.status end;
      v_created := v_created + 1;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'apellidosNombre',t.apellidos_nombre,'dni',t.dni,
      'categoria',t.categoria,'obra',t.obra,'numOferta',t.num_oferta,
      'periodoInicio',t.periodo_inicio,'periodoFin',t.periodo_fin
    ) order by t.apellidos_nombre),'[]'::jsonb)
      into v_workers
      from public.trabajadores t
     where t.owner_id=v_owner
       and lower(t.obra)=lower(v_obra)
       and (nullif(t.periodo_inicio,'') is null or nullif(t.periodo_inicio,'')::date <= v_start)
       and (nullif(t.periodo_fin,'') is null or nullif(t.periodo_fin,'')::date >= v_start);

    if jsonb_array_length(v_workers) > 0 and not exists (
      select 1 from public.foreman_mandatory_delete_tombstones t
      where t.owner_id=v_owner
        and lower(t.obra)=lower(v_obra)
        and t.period_key=v_period_key
        and t.document_type='control_presencia'
        and t.category=''
        and t.source_gmail_message_id is null
    ) then
      insert into public.foreman_mandatory_documents(owner_id,obra,period_key,work_date,document_type,category,workers,updated_at)
      values(v_owner,v_obra,v_period_key,v_start,'control_presencia','',v_workers,now())
      on conflict(owner_id,obra,period_key,document_type,category) where source_attachment_name is null do update
        set workers=excluded.workers, updated_at=now();
      v_created := v_created + 1;
    end if;
  end loop;

  return v_created;
end;
$$;

revoke all on function public.prepare_foreman_mandatory_documents(jsonb) from public, anon;
grant execute on function public.prepare_foreman_mandatory_documents(jsonb) to authenticated;
