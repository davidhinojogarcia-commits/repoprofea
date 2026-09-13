create table if not exists public.sae_needs (
  id text primary key,
  owner_id uuid not null default auth.uid(),
  obra text not null default '',
  codigo_obra text not null default '',
  mes text not null default '',
  ano integer,
  estado text not null default 'Pendiente de candidatos SAE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sae_need_categories (
  id text primary key,
  need_id text not null references public.sae_needs(id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  categoria text not null default '',
  cantidad integer not null default 0 check (cantidad >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.sae_reports (
  id text primary key,
  need_id text not null references public.sae_needs(id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  file_name text not null default '',
  file_base64 text not null default '',
  extracted_text text not null default '',
  extraction_source text not null default '',
  offer_number text not null default '',
  obra text not null default '',
  codigo_obra text not null default '',
  mes text not null default '',
  quincena text not null default '',
  categoria text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sae_candidates (
  id text primary key,
  need_id text not null references public.sae_needs(id) on delete cascade,
  report_id text not null references public.sae_reports(id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  order_number integer not null default 0,
  full_name_original text not null default '',
  normalized_name text not null default '',
  apellidos text not null default '',
  nombre text not null default '',
  categoria text not null default '',
  obra text not null default '',
  codigo_obra text not null default '',
  offer_number text not null default '',
  mes text not null default '',
  quincena text not null default '',
  estado text not null default 'Sin asignar',
  result_code text not null default '',
  linked_worker_id bigint,
  page_number integer not null default 2,
  overlay_x numeric not null default 184,
  overlay_y numeric not null default 50,
  confidence text not null default 'Media',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(report_id, order_number)
);

create index if not exists sae_need_categories_need_idx on public.sae_need_categories(need_id);
create index if not exists sae_reports_need_idx on public.sae_reports(need_id);
create index if not exists sae_candidates_need_idx on public.sae_candidates(need_id);
create index if not exists sae_candidates_report_idx on public.sae_candidates(report_id);
create index if not exists sae_candidates_status_idx on public.sae_candidates(estado);

alter table public.sae_needs enable row level security;
alter table public.sae_need_categories enable row level security;
alter table public.sae_reports enable row level security;
alter table public.sae_candidates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sae_needs' and policyname='sae_needs_owner') then
    create policy sae_needs_owner on public.sae_needs for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sae_need_categories' and policyname='sae_need_categories_owner') then
    create policy sae_need_categories_owner on public.sae_need_categories for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sae_reports' and policyname='sae_reports_owner') then
    create policy sae_reports_owner on public.sae_reports for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sae_candidates' and policyname='sae_candidates_owner') then
    create policy sae_candidates_owner on public.sae_candidates for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  end if;
end $$;

create or replace function public.touch_sae_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_sae_needs_touch on public.sae_needs;
create trigger trg_sae_needs_touch before update on public.sae_needs for each row execute function public.touch_sae_updated_at();
drop trigger if exists trg_sae_reports_touch on public.sae_reports;
create trigger trg_sae_reports_touch before update on public.sae_reports for each row execute function public.touch_sae_updated_at();
drop trigger if exists trg_sae_candidates_touch on public.sae_candidates;
create trigger trg_sae_candidates_touch before update on public.sae_candidates for each row execute function public.touch_sae_updated_at();
