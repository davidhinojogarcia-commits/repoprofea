-- Personalización de parques e inventario documental por máquina.
-- Cada supervisor puede mantener su propio parque/nave y compartirlo sin exponer nombres en la UI.

alter table public.inventory_parks
  add column if not exists coordinator_email text null;

-- El nombre y la zona dejan de ser únicos globalmente: dos supervisores pueden usar
-- el mismo nombre/zona sin mezclar inventarios. La unicidad queda limitada al propietario.
drop index if exists public.inventory_parks_name_zone_unique;
create unique index if not exists inventory_parks_owner_name_zone_unique
  on public.inventory_parks (created_by, lower(nombre), lower(zona));

alter table public.inventory_maintenance
  add column if not exists mechanic_name text null,
  add column if not exists signed_document_paths jsonb not null default '[]'::jsonb;

create table if not exists public.inventory_documents (
  id uuid primary key default gen_random_uuid(),
  park_id uuid not null references public.inventory_parks(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  document_type text not null,
  title text not null,
  file_path text not null,
  file_name text not null,
  issue_date date null,
  expiry_date date null,
  notes text null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists inventory_documents_item_idx
  on public.inventory_documents(item_id, created_at desc);
create index if not exists inventory_documents_park_idx
  on public.inventory_documents(park_id, created_at desc);

alter table public.inventory_documents enable row level security;

drop policy if exists inventory_documents_select on public.inventory_documents;
create policy inventory_documents_select on public.inventory_documents
for select to authenticated
using (private.inventory_is_member(park_id,false));

drop policy if exists inventory_documents_insert on public.inventory_documents;
create policy inventory_documents_insert on public.inventory_documents
for insert to authenticated
with check (private.inventory_is_member(park_id,true) and created_by=(select auth.uid()));

drop policy if exists inventory_documents_update on public.inventory_documents;
create policy inventory_documents_update on public.inventory_documents
for update to authenticated
using (private.inventory_is_member(park_id,true))
with check (private.inventory_is_member(park_id,true));

drop policy if exists inventory_documents_delete on public.inventory_documents;
create policy inventory_documents_delete on public.inventory_documents
for delete to authenticated
using (private.inventory_is_member(park_id,true));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'inventory-documents',
  'inventory-documents',
  false,
  15728640,
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists inventory_documents_storage_select on storage.objects;
create policy inventory_documents_storage_select on storage.objects
for select to authenticated
using (
  bucket_id='inventory-documents'
  and private.inventory_is_member(((storage.foldername(name))[1])::uuid,false)
);

drop policy if exists inventory_documents_storage_insert on storage.objects;
create policy inventory_documents_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='inventory-documents'
  and private.inventory_is_member(((storage.foldername(name))[1])::uuid,true)
);

drop policy if exists inventory_documents_storage_delete on storage.objects;
create policy inventory_documents_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id='inventory-documents'
  and private.inventory_is_member(((storage.foldername(name))[1])::uuid,true)
);
