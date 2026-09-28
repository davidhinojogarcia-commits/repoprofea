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
