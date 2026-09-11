create table if not exists public.subcontrata_documentos (
  id text primary key,
  subcontrata_id text not null references public.subcontratas(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  categoria text not null default 'empresa' check (categoria in ('empresa','trabajadores','maquinaria')),
  nombre text not null default '', descripcion text not null default '', normativa text not null default '',
  obligatorio boolean not null default true, estado text not null default 'pendiente',
  fecha_entrega date, fecha_caducidad date, observaciones text not null default '', documento_nombre text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
create index if not exists idx_subcontrata_documentos_subcontrata on public.subcontrata_documentos(subcontrata_id);
create index if not exists idx_subcontrata_documentos_owner on public.subcontrata_documentos(owner_id);
create index if not exists idx_subcontrata_documentos_estado on public.subcontrata_documentos(estado);

create or replace function public.stamp_subcontrata_documento() returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_owner uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select s.owner_id into v_owner from public.subcontratas s where s.id = new.subcontrata_id;
  if v_owner is null then raise exception 'Subcontrata not found'; end if;
  new.owner_id := v_owner; new.updated_by := auth.uid(); new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now(); else new.created_by := old.created_by; new.created_at := old.created_at; end if;
  return new;
end; $$;

alter table public.subcontrata_documentos enable row level security;
drop policy if exists subcontrata_documentos_select on public.subcontrata_documentos;
create policy subcontrata_documentos_select on public.subcontrata_documentos for select using (exists (select 1 from public.subcontratas s where s.id = subcontrata_id and private.can_access_business_row('subcontratas','subcontratas',s.id,s.owner_id,s.obra_id,'read')));
drop policy if exists subcontrata_documentos_insert on public.subcontrata_documentos;
create policy subcontrata_documentos_insert on public.subcontrata_documentos for insert with check (exists (select 1 from public.subcontratas s where s.id = subcontrata_id and private.can_access_business_row('subcontratas','subcontratas',s.id,s.owner_id,s.obra_id,'update')));
drop policy if exists subcontrata_documentos_update on public.subcontrata_documentos;
create policy subcontrata_documentos_update on public.subcontrata_documentos for update using (exists (select 1 from public.subcontratas s where s.id = subcontrata_id and private.can_access_business_row('subcontratas','subcontratas',s.id,s.owner_id,s.obra_id,'update'))) with check (exists (select 1 from public.subcontratas s where s.id = subcontrata_id and private.can_access_business_row('subcontratas','subcontratas',s.id,s.owner_id,s.obra_id,'update')));
drop policy if exists subcontrata_documentos_delete on public.subcontrata_documentos;
create policy subcontrata_documentos_delete on public.subcontrata_documentos for delete using (exists (select 1 from public.subcontratas s where s.id = subcontrata_id and private.can_access_business_row('subcontratas','subcontratas',s.id,s.owner_id,s.obra_id,'update')));
drop trigger if exists trg_subcontrata_documentos_stamp on public.subcontrata_documentos;
create trigger trg_subcontrata_documentos_stamp before insert or update on public.subcontrata_documentos for each row execute function public.stamp_subcontrata_documento();
drop trigger if exists trg_subcontrata_documentos_audit on public.subcontrata_documentos;
create trigger trg_subcontrata_documentos_audit after insert or update or delete on public.subcontrata_documentos for each row execute function public.audit_business_change();
