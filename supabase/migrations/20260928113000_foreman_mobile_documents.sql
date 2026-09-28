create extension if not exists pgcrypto;

create table if not exists public.foreman_portal_access (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  obra text not null,
  foreman_name text not null default '',
  token_hash text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

create unique index if not exists foreman_portal_access_owner_obra_idx
  on public.foreman_portal_access(owner_id, obra);

create table if not exists public.foreman_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  obra text not null,
  work_date date not null default current_date,
  document_type text not null,
  worker_id bigint,
  worker_snapshot jsonb not null default '{}'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  signatures jsonb not null default '{}'::jsonb,
  completed_by text not null default '',
  status text not null default 'completed' check (status in ('draft','completed','reviewed')),
  completed_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists foreman_documents_owner_idx on public.foreman_documents(owner_id);
create index if not exists foreman_documents_obra_date_idx on public.foreman_documents(owner_id, obra, work_date desc);

create table if not exists public.foreman_attendance_days (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  obra text not null,
  work_date date not null,
  foreman_name text not null default '',
  rows jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','completed','reviewed')),
  completed_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, obra, work_date)
);

alter table public.foreman_portal_access enable row level security;
alter table public.foreman_documents enable row level security;
alter table public.foreman_attendance_days enable row level security;

drop policy if exists foreman_access_owner_all on public.foreman_portal_access;
create policy foreman_access_owner_all on public.foreman_portal_access
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists foreman_documents_owner_all on public.foreman_documents;
create policy foreman_documents_owner_all on public.foreman_documents
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists foreman_attendance_owner_all on public.foreman_attendance_days;
create policy foreman_attendance_owner_all on public.foreman_attendance_days
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

grant select,insert,update,delete on public.foreman_portal_access to authenticated;
grant select,insert,update,delete on public.foreman_documents to authenticated;
grant select,insert,update,delete on public.foreman_attendance_days to authenticated;

create or replace function public.ensure_foreman_portal_access(p_obra text, p_foreman_name text default '')
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_hash text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_obra),'') is null then raise exception 'Obra requerida'; end if;
  v_token := encode(gen_random_bytes(24), 'hex');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  insert into public.foreman_portal_access(owner_id, obra, foreman_name, token_hash, active, updated_at)
  values(auth.uid(), trim(p_obra), trim(coalesce(p_foreman_name,'')), v_hash, true, now())
  on conflict(owner_id, obra) do update
    set foreman_name=excluded.foreman_name,
        token_hash=excluded.token_hash,
        active=true,
        updated_at=now();

  return v_token;
end;
$$;

create or replace function public.revoke_foreman_portal_access(p_obra text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.foreman_portal_access
     set active=false, updated_at=now()
   where owner_id=auth.uid() and lower(obra)=lower(trim(p_obra));
$$;

create or replace function public.resolve_foreman_portal(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_access public.foreman_portal_access%rowtype;
  v_hash text;
begin
  v_hash := encode(digest(trim(coalesce(p_token,'')), 'sha256'), 'hex');
  select * into v_access
    from public.foreman_portal_access
   where token_hash=v_hash and active=true
   limit 1;
  if not found then return jsonb_build_object('valid',false); end if;

  update public.foreman_portal_access set last_used_at=now() where id=v_access.id;

  return jsonb_build_object(
    'valid', true,
    'obra', v_access.obra,
    'foremanName', v_access.foreman_name,
    'workers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'apellidosNombre', t.apellidos_nombre,
          'dni', t.dni,
          'categoria', t.categoria,
          'obra', t.obra,
          'numOferta', t.num_oferta,
          'periodoInicio', t.periodo_inicio,
          'periodoFin', t.periodo_fin,
          'telefono', t.telefono
        ) order by t.apellidos_nombre
      )
      from public.trabajadores t
      where t.owner_id=v_access.owner_id and lower(t.obra)=lower(v_access.obra)
    ), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'workDate', a.work_date,
        'rows', a.rows,
        'status', a.status,
        'completedAt', a.completed_at,
        'updatedAt', a.updated_at
      ) order by a.work_date desc)
      from public.foreman_attendance_days a
      where a.owner_id=v_access.owner_id and lower(a.obra)=lower(v_access.obra)
        and a.work_date >= current_date - 31
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'workDate', d.work_date,
        'documentType', d.document_type,
        'workerId', d.worker_id,
        'workerSnapshot', d.worker_snapshot,
        'answers', d.answers,
        'signatures', d.signatures,
        'status', d.status,
        'completedAt', d.completed_at
      ) order by d.created_at desc)
      from public.foreman_documents d
      where d.owner_id=v_access.owner_id and lower(d.obra)=lower(v_access.obra)
        and d.created_at >= now() - interval '90 days'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_foreman_attendance(
  p_token text,
  p_work_date date,
  p_rows jsonb,
  p_status text default 'draft'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_access public.foreman_portal_access%rowtype;
  v_hash text;
  v_id uuid;
  v_status text;
begin
  v_hash := encode(digest(trim(coalesce(p_token,'')), 'sha256'), 'hex');
  select * into v_access from public.foreman_portal_access where token_hash=v_hash and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;
  v_status := case when p_status in ('draft','completed') then p_status else 'draft' end;

  insert into public.foreman_attendance_days(owner_id, obra, work_date, foreman_name, rows, status, completed_at, updated_at)
  values(v_access.owner_id, v_access.obra, p_work_date, v_access.foreman_name, coalesce(p_rows,'[]'::jsonb), v_status,
    case when v_status='completed' then now() else null end, now())
  on conflict(owner_id, obra, work_date) do update
    set rows=excluded.rows,
        foreman_name=excluded.foreman_name,
        status=excluded.status,
        completed_at=case when excluded.status='completed' then coalesce(public.foreman_attendance_days.completed_at,now()) else null end,
        updated_at=now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.submit_foreman_document(
  p_token text,
  p_document_type text,
  p_work_date date,
  p_worker_id bigint,
  p_answers jsonb,
  p_signatures jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_access public.foreman_portal_access%rowtype;
  v_worker public.trabajadores%rowtype;
  v_hash text;
  v_id uuid;
begin
  v_hash := encode(digest(trim(coalesce(p_token,'')), 'sha256'), 'hex');
  select * into v_access from public.foreman_portal_access where token_hash=v_hash and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;

  if p_worker_id is not null then
    select * into v_worker from public.trabajadores
      where owner_id=v_access.owner_id and id=p_worker_id and lower(obra)=lower(v_access.obra)
      limit 1;
    if not found then raise exception 'Trabajador no válido para esta obra'; end if;
  end if;

  insert into public.foreman_documents(
    owner_id, obra, work_date, document_type, worker_id, worker_snapshot,
    answers, signatures, completed_by, status, completed_at, updated_at
  ) values (
    v_access.owner_id, v_access.obra, coalesce(p_work_date,current_date), p_document_type, p_worker_id,
    case when p_worker_id is null then '{}'::jsonb else jsonb_build_object(
      'id',v_worker.id,'apellidosNombre',v_worker.apellidos_nombre,'dni',v_worker.dni,
      'categoria',v_worker.categoria,'obra',v_worker.obra,'numOferta',v_worker.num_oferta,
      'periodoInicio',v_worker.periodo_inicio,'periodoFin',v_worker.periodo_fin
    ) end,
    coalesce(p_answers,'{}'::jsonb), coalesce(p_signatures,'{}'::jsonb),
    v_access.foreman_name, 'completed', now(), now()
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.ensure_foreman_portal_access(text,text) from public;
revoke all on function public.revoke_foreman_portal_access(text) from public;
grant execute on function public.ensure_foreman_portal_access(text,text) to authenticated;
grant execute on function public.revoke_foreman_portal_access(text) to authenticated;

grant execute on function public.resolve_foreman_portal(text) to anon, authenticated;
grant execute on function public.save_foreman_attendance(text,date,jsonb,text) to anon, authenticated;
grant execute on function public.submit_foreman_document(text,text,date,bigint,jsonb,jsonb) to anon, authenticated;


create table if not exists public.foreman_mandatory_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  obra text not null,
  period_key text not null,
  work_date date not null,
  document_type text not null check (document_type in ('inicio','control_presencia')),
  category text not null default '',
  workers jsonb not null default '[]'::jsonb,
  signatures jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','in_progress','completed','reviewed')),
  completed_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists foreman_mandatory_document_unique_idx
  on public.foreman_mandatory_documents(owner_id, obra, period_key, document_type, category);
create index if not exists foreman_mandatory_documents_owner_date_idx
  on public.foreman_mandatory_documents(owner_id, work_date desc);

alter table public.foreman_mandatory_documents enable row level security;

drop policy if exists foreman_mandatory_owner_all on public.foreman_mandatory_documents;
create policy foreman_mandatory_owner_all on public.foreman_mandatory_documents
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

grant select,insert,update,delete on public.foreman_mandatory_documents to authenticated;

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
    if v_obra = '' then continue; end if;

    -- INICIO: solo personas de la importación que comienzan en este periodo,
    -- agrupadas por obra + fecha de inicio + categoría.
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

    if jsonb_array_length(v_workers) > 0 then
      insert into public.foreman_mandatory_documents(owner_id,obra,period_key,work_date,document_type,category,workers,updated_at)
      values(v_owner,v_obra,v_period||':'||to_char(v_start,'YYYY-MM-DD'),v_start,'inicio',v_category,v_workers,now())
      on conflict(owner_id,obra,period_key,document_type,category) do update
        set workers=excluded.workers, updated_at=now(),
            status=case when public.foreman_mandatory_documents.status='reviewed' then 'reviewed' else public.foreman_mandatory_documents.status end;
      v_created := v_created + 1;
    end if;

    -- CONTROL DE PRESENCIA: todos los trabajadores activos en la obra al inicio
    -- del periodo, incluidos los que ya venían de periodos anteriores.
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

    if jsonb_array_length(v_workers) > 0 then
      insert into public.foreman_mandatory_documents(owner_id,obra,period_key,work_date,document_type,category,workers,updated_at)
      values(v_owner,v_obra,v_period||':'||to_char(v_start,'YYYY-MM-DD'),v_start,'control_presencia','',v_workers,now())
      on conflict(owner_id,obra,period_key,document_type,category) do update
        set workers=excluded.workers, updated_at=now();
      v_created := v_created + 1;
    end if;
  end loop;
  return v_created;
end;
$$;

create or replace function public.resolve_foreman_portal(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_access public.foreman_portal_access%rowtype;
  v_hash text;
begin
  v_hash := encode(digest(trim(coalesce(p_token,'')), 'sha256'), 'hex');
  select * into v_access
    from public.foreman_portal_access
   where token_hash=v_hash and active=true
   limit 1;
  if not found then return jsonb_build_object('valid',false); end if;

  update public.foreman_portal_access set last_used_at=now() where id=v_access.id;

  return jsonb_build_object(
    'valid', true,
    'obra', v_access.obra,
    'foremanName', v_access.foreman_name,
    'workers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',t.id,'apellidosNombre',t.apellidos_nombre,'dni',t.dni,'categoria',t.categoria,
        'obra',t.obra,'numOferta',t.num_oferta,'periodoInicio',t.periodo_inicio,'periodoFin',t.periodo_fin,'telefono',t.telefono
      ) order by t.apellidos_nombre)
      from public.trabajadores t where t.owner_id=v_access.owner_id and lower(t.obra)=lower(v_access.obra)
    ), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object('id',a.id,'workDate',a.work_date,'rows',a.rows,'status',a.status,'completedAt',a.completed_at,'updatedAt',a.updated_at) order by a.work_date desc)
      from public.foreman_attendance_days a
      where a.owner_id=v_access.owner_id and lower(a.obra)=lower(v_access.obra) and a.work_date >= current_date - 31
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('id',d.id,'workDate',d.work_date,'documentType',d.document_type,'workerId',d.worker_id,'workerSnapshot',d.worker_snapshot,'answers',d.answers,'signatures',d.signatures,'status',d.status,'completedAt',d.completed_at) order by d.created_at desc)
      from public.foreman_documents d
      where d.owner_id=v_access.owner_id and lower(d.obra)=lower(v_access.obra) and d.created_at >= now() - interval '90 days'
    ), '[]'::jsonb),
    'mandatoryDocuments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'workDate',m.work_date,'periodKey',m.period_key,'documentType',m.document_type,
        'category',m.category,'workers',m.workers,'signatures',m.signatures,'status',m.status,'completedAt',m.completed_at
      ) order by m.work_date desc,m.document_type,m.category)
      from public.foreman_mandatory_documents m
      where m.owner_id=v_access.owner_id and lower(m.obra)=lower(v_access.obra)
        and m.work_date >= current_date - 62
    ), '[]'::jsonb)
  );
end;
$$;

create table if not exists public.worker_document_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  worker_id bigint not null,
  obra text not null,
  document_id uuid not null references public.foreman_mandatory_documents(id) on delete cascade,
  document_type text not null,
  work_date date not null,
  category text not null default '',
  signed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(owner_id, worker_id, document_id)
);

alter table public.worker_document_evidence enable row level security;
drop policy if exists worker_document_evidence_owner_all on public.worker_document_evidence;
create policy worker_document_evidence_owner_all on public.worker_document_evidence
  for all to authenticated
  using (owner_id=auth.uid())
  with check (owner_id=auth.uid());
grant select,insert,update,delete on public.worker_document_evidence to authenticated;

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
  v_total integer;
  v_signed integer;
begin
  v_hash := encode(digest(trim(coalesce(p_token,'')), 'sha256'), 'hex');
  select * into v_access from public.foreman_portal_access where token_hash=v_hash and active=true limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;
  select * into v_doc from public.foreman_mandatory_documents
   where id=p_document_id and owner_id=v_access.owner_id and lower(obra)=lower(v_access.obra);
  if not found then raise exception 'Documento no válido'; end if;
  if not exists(select 1 from jsonb_array_elements(v_doc.workers) w where (w->>'id')::bigint=p_worker_id) then
    raise exception 'Trabajador no incluido en el documento';
  end if;

  v_signatures := coalesce(v_doc.signatures,'{}'::jsonb) || jsonb_build_object(
    p_worker_id::text, jsonb_build_object('signature',p_signature,'signedAt',now())
  );
  select count(*) into v_total from jsonb_array_elements(v_doc.workers);
  select count(*) into v_signed from jsonb_each(v_signatures);

  update public.foreman_mandatory_documents
     set signatures=v_signatures,
         status=case when v_signed>=v_total and v_total>0 then 'completed' else 'in_progress' end,
         completed_at=case when v_signed>=v_total and v_total>0 then coalesce(completed_at,now()) else null end,
         updated_at=now()
   where id=v_doc.id;

  -- Asiento documental individual vinculado al trabajador, sin modificar su
  -- registro maestro ni sus metadatos de contratación.
  insert into public.worker_document_evidence(
    owner_id,worker_id,obra,document_id,document_type,work_date,category,signed_at,metadata
  ) values(
    v_access.owner_id,p_worker_id,v_doc.obra,v_doc.id,v_doc.document_type,v_doc.work_date,v_doc.category,now(),
    jsonb_build_object('source','portal_encargado','status','signed')
  )
  on conflict(owner_id,worker_id,document_id) do update
    set signed_at=excluded.signed_at, metadata=excluded.metadata;

  return jsonb_build_object('ok',true,'signed',v_signed,'total',v_total,'completed',v_signed>=v_total and v_total>0);
end;
$$;

revoke all on function public.prepare_foreman_mandatory_documents(jsonb) from public;
grant execute on function public.prepare_foreman_mandatory_documents(jsonb) to authenticated;
grant execute on function public.sign_foreman_mandatory_document(text,uuid,bigint,text) to anon,authenticated;

alter table public.foreman_mandatory_documents
  add column if not exists source_gmail_message_id text,
  add column if not exists source_gmail_thread_id text,
  add column if not exists source_rfc_message_id text,
  add column if not exists source_email_from text,
  add column if not exists source_email_subject text,
  add column if not exists source_attachment_name text,
  add column if not exists returned_gmail_message_id text,
  add column if not exists returned_at timestamptz;

create unique index if not exists foreman_mandatory_source_attachment_idx
  on public.foreman_mandatory_documents(owner_id, source_gmail_message_id, source_attachment_name)
  where source_gmail_message_id is not null;

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
  v_workers jsonb;
  v_id uuid;
  v_category text := coalesce(trim(p_category),'');
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  if p_document_type not in ('inicio','control_presencia') then raise exception 'Tipo de documento no válido'; end if;
  if coalesce(array_length(p_worker_ids,1),0)=0 then raise exception 'No hay trabajadores identificados'; end if;

  select t.obra into v_obra
  from public.trabajadores t
  where t.owner_id=v_owner and t.id=any(p_worker_ids)
  group by t.obra
  order by count(*) desc
  limit 1;
  if coalesce(trim(v_obra),'')='' then raise exception 'No se ha podido identificar la obra'; end if;

  if p_document_type='control_presencia' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'apellidosNombre',t.apellidos_nombre,'dni',t.dni,'categoria',t.categoria,
      'obra',t.obra,'numOferta',t.num_oferta,'periodoInicio',t.periodo_inicio,'periodoFin',t.periodo_fin
    ) order by t.apellidos_nombre),'[]'::jsonb) into v_workers
    from public.trabajadores t
    where t.owner_id=v_owner and lower(t.obra)=lower(v_obra)
      and (nullif(t.periodo_inicio,'') is null or nullif(t.periodo_inicio,'')::date <= coalesce(p_work_date,current_date))
      and (nullif(t.periodo_fin,'') is null or nullif(t.periodo_fin,'')::date >= coalesce(p_work_date,current_date));
    v_category := '';
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'apellidosNombre',t.apellidos_nombre,'dni',t.dni,'categoria',t.categoria,
      'obra',t.obra,'numOferta',t.num_oferta,'periodoInicio',t.periodo_inicio,'periodoFin',t.periodo_fin
    ) order by t.apellidos_nombre),'[]'::jsonb) into v_workers
    from public.trabajadores t
    where t.owner_id=v_owner and t.id=any(p_worker_ids)
      and lower(t.obra)=lower(v_obra)
      and (v_category='' or lower(t.categoria)=lower(v_category));
  end if;

  insert into public.foreman_mandatory_documents(
    owner_id,obra,period_key,work_date,document_type,category,workers,status,
    source_gmail_message_id,source_gmail_thread_id,source_rfc_message_id,source_email_from,
    source_email_subject,source_attachment_name,updated_at
  ) values(
    v_owner,v_obra,coalesce(nullif(trim(p_period_key),''),to_char(coalesce(p_work_date,current_date),'YYYY-MM-DD')),
    coalesce(p_work_date,current_date),p_document_type,v_category,v_workers,'pending',
    p_gmail_message_id,p_gmail_thread_id,p_rfc_message_id,p_email_from,p_email_subject,p_attachment_name,now()
  )
  on conflict(owner_id,source_gmail_message_id,source_attachment_name)
  where source_gmail_message_id is not null
  do update set updated_at=now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.mark_foreman_mandatory_returned(
  p_id uuid,
  p_gmail_message_id text
)
returns void
language sql
security definer
set search_path=public
as $$
  update public.foreman_mandatory_documents
  set status='reviewed',
      reviewed_at=coalesce(reviewed_at,now()),
      returned_gmail_message_id=p_gmail_message_id,
      returned_at=now(),
      updated_at=now()
  where id=p_id and owner_id=auth.uid();
$$;

revoke all on function public.prepare_foreman_mandatory_from_email(text,bigint[],date,text,text,text,text,text,text,text,text) from public;
grant execute on function public.prepare_foreman_mandatory_from_email(text,bigint[],date,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.mark_foreman_mandatory_returned(uuid,text) to authenticated;
