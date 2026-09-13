-- SAE: flujo completo de necesidades, candidatos, contratación y devolución documental.
-- Las entidades candidato y trabajador permanecen separadas hasta la confirmación expresa.

create extension if not exists pgcrypto;

create or replace function public.sae_has_permission(requested_action text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.user_permissions up on up.user_id = p.id
    where p.id = (select auth.uid())
      and p.active is true
      and (
        p.role = 'admin'
        or coalesce((up.modules -> 'sae' ->> requested_action)::boolean, false)
      )
  );
$$;

create table if not exists public.sae_needs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  work_name text not null check (length(trim(work_name)) > 0),
  work_code text,
  hiring_month smallint not null check (hiring_month between 1 and 12),
  hiring_year smallint not null check (hiring_year between 2020 and 2200),
  total_requested integer not null default 0 check (total_requested >= 0),
  status text not null default 'pendiente_candidatos_sae' check (status in ('pendiente_candidatos_sae','candidatos_recibidos','en_distribucion','en_contratacion','finalizada')),
  notes text,
  source_file_name text,
  source_storage_path text,
  extraction_evidence jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sae_need_categories (
  id uuid primary key default gen_random_uuid(),
  need_id uuid not null references public.sae_needs(id) on delete cascade,
  category text not null check (length(trim(category)) > 0),
  category_code text,
  requested_count integer not null check (requested_count >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (need_id, category)
);

create table if not exists public.sae_reports (
  id uuid primary key default gen_random_uuid(),
  need_id uuid not null references public.sae_needs(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  storage_path text not null unique,
  page_count integer not null default 1 check (page_count > 0),
  extraction_method text not null check (extraction_method in ('native','ocr','hybrid')),
  processing_status text not null default 'review' check (processing_status in ('processing','review','confirmed','error')),
  raw_text text not null default '',
  detected_legend jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sae_candidates (
  id uuid primary key default gen_random_uuid(),
  need_id uuid not null references public.sae_needs(id) on delete cascade,
  source_report_id uuid not null references public.sae_reports(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  original_full_name text not null,
  normalized_full_name text not null,
  first_name text,
  surnames text,
  dni_nie text,
  category text,
  category_code text,
  offer_number text,
  work_name text,
  work_code text,
  hiring_month smallint check (hiring_month between 1 and 12),
  fortnight smallint check (fortnight in (1,2)),
  expected_hire_date date,
  sae_identifier text,
  source_page integer not null check (source_page > 0),
  source_row_text text not null,
  source_position jsonb not null,
  confidence text not null check (confidence in ('alta','media','baja')),
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'sin_asignar' check (status in ('sin_asignar','preseleccionado','primera_quincena','segunda_quincena','contratado','no_contratado','pendiente_datos')),
  selected_for_hire boolean not null default false,
  existing_worker_owner_id uuid,
  existing_worker_id bigint,
  result_code text,
  result_label text check (result_label in ('contratado','no_contratado')),
  alignment_offset_x numeric(8,2) not null default 0,
  alignment_offset_y numeric(8,2) not null default 0,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_report_id, source_page, original_full_name, source_row_text),
  foreign key (existing_worker_owner_id, existing_worker_id) references public.trabajadores(owner_id, id) on delete set null
);

create table if not exists public.sae_candidate_allocations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.sae_candidates(id) on delete cascade,
  need_id uuid not null references public.sae_needs(id) on delete cascade,
  hiring_year smallint not null,
  hiring_month smallint not null check (hiring_month between 1 and 12),
  fortnight smallint check (fortnight in (1,2)),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  unique (candidate_id)
);

create table if not exists public.sae_registration_drafts (
  id uuid primary key default gen_random_uuid(),
  need_id uuid not null references public.sae_needs(id) on delete cascade,
  candidate_id uuid not null references public.sae_candidates(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  existing_worker_owner_id uuid,
  existing_worker_id bigint,
  status text not null default 'borrador_sae' check (status in ('borrador_sae','enlazado','contratado')),
  data jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id),
  foreign key (existing_worker_owner_id, existing_worker_id) references public.trabajadores(owner_id, id) on delete set null
);

create table if not exists public.sae_result_codes (
  result_key text primary key,
  code text not null check (length(trim(code)) > 0),
  label text not null,
  active boolean not null default true,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.sae_generated_documents (
  id uuid primary key default gen_random_uuid(),
  need_id uuid not null references public.sae_needs(id) on delete cascade,
  source_report_id uuid not null references public.sae_reports(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  file_name text not null,
  storage_path text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

insert into public.sae_result_codes (result_key, code, label)
values ('contratado', '2100', 'Contratado')
on conflict (result_key) do nothing;

create index if not exists sae_needs_period_idx on public.sae_needs (hiring_year, hiring_month, status);
create index if not exists sae_need_categories_need_idx on public.sae_need_categories (need_id);
create index if not exists sae_reports_need_idx on public.sae_reports (need_id);
create index if not exists sae_candidates_need_status_idx on public.sae_candidates (need_id, status);
create index if not exists sae_candidates_identity_idx on public.sae_candidates (dni_nie, normalized_full_name);
create index if not exists sae_candidates_source_idx on public.sae_candidates (source_report_id, source_page);
create index if not exists sae_drafts_need_idx on public.sae_registration_drafts (need_id, status);
create index if not exists sae_generated_need_idx on public.sae_generated_documents (need_id, created_at desc);

create or replace function public.sae_touch_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sae_needs_touch_updated_at on public.sae_needs;
create trigger sae_needs_touch_updated_at before update on public.sae_needs for each row execute function public.sae_touch_updated_at();
drop trigger if exists sae_reports_touch_updated_at on public.sae_reports;
create trigger sae_reports_touch_updated_at before update on public.sae_reports for each row execute function public.sae_touch_updated_at();
drop trigger if exists sae_candidates_touch_updated_at on public.sae_candidates;
create trigger sae_candidates_touch_updated_at before update on public.sae_candidates for each row execute function public.sae_touch_updated_at();
drop trigger if exists sae_drafts_touch_updated_at on public.sae_registration_drafts;
create trigger sae_drafts_touch_updated_at before update on public.sae_registration_drafts for each row execute function public.sae_touch_updated_at();
drop trigger if exists sae_codes_touch_updated_at on public.sae_result_codes;
create trigger sae_codes_touch_updated_at before update on public.sae_result_codes for each row execute function public.sae_touch_updated_at();

alter table public.sae_needs enable row level security;
alter table public.sae_need_categories enable row level security;
alter table public.sae_reports enable row level security;
alter table public.sae_candidates enable row level security;
alter table public.sae_candidate_allocations enable row level security;
alter table public.sae_registration_drafts enable row level security;
alter table public.sae_result_codes enable row level security;
alter table public.sae_generated_documents enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['sae_needs','sae_need_categories','sae_reports','sae_candidates','sae_candidate_allocations','sae_registration_drafts','sae_generated_documents']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_read', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (public.sae_has_permission(''read''))', table_name || '_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.sae_has_permission(''create''))', table_name || '_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (public.sae_has_permission(''update'')) with check (public.sae_has_permission(''update''))', table_name || '_update', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (public.sae_has_permission(''delete''))', table_name || '_delete', table_name);
  end loop;
end $$;

drop policy if exists sae_result_codes_read on public.sae_result_codes;
create policy sae_result_codes_read on public.sae_result_codes for select to authenticated using (public.sae_has_permission('read'));
drop policy if exists sae_result_codes_admin_insert on public.sae_result_codes;
create policy sae_result_codes_admin_insert on public.sae_result_codes for insert to authenticated with check (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin' and active is true));
drop policy if exists sae_result_codes_admin_update on public.sae_result_codes;
create policy sae_result_codes_admin_update on public.sae_result_codes for update to authenticated using (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin' and active is true)) with check (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin' and active is true));
drop policy if exists sae_result_codes_admin_delete on public.sae_result_codes;
create policy sae_result_codes_admin_delete on public.sae_result_codes for delete to authenticated using (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin' and active is true));

grant select, insert, update, delete on public.sae_needs, public.sae_need_categories, public.sae_reports, public.sae_candidates, public.sae_candidate_allocations, public.sae_registration_drafts, public.sae_result_codes, public.sae_generated_documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sae-documents', 'sae-documents', false, 26214400, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists sae_documents_read on storage.objects;
create policy sae_documents_read on storage.objects for select to authenticated using (bucket_id = 'sae-documents' and public.sae_has_permission('read'));
drop policy if exists sae_documents_insert on storage.objects;
create policy sae_documents_insert on storage.objects for insert to authenticated with check (bucket_id = 'sae-documents' and (storage.foldername(name))[1] = (select auth.uid())::text and public.sae_has_permission('create'));
drop policy if exists sae_documents_update on storage.objects;
create policy sae_documents_update on storage.objects for update to authenticated using (bucket_id = 'sae-documents' and owner_id = (select auth.uid())::text and public.sae_has_permission('update')) with check (bucket_id = 'sae-documents' and owner_id = (select auth.uid())::text and public.sae_has_permission('update'));
drop policy if exists sae_documents_delete on storage.objects;
create policy sae_documents_delete on storage.objects for delete to authenticated using (bucket_id = 'sae-documents' and owner_id = (select auth.uid())::text and public.sae_has_permission('delete'));
