-- Tablas relacionales de negocio principales y RLS multiusuario.
-- Supabase es la única fuente de verdad. Esta migración refleja el cambio aplicado
-- al proyecto remoto y puede ejecutarse después de la base de seguridad multiusuario.

create table if not exists public.citas (
  id text primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  obra_id uuid references public.obras(id) on delete set null,
  trabajador_id bigint,
  cita_dia date,
  cita_hora time,
  sitio_reconocimiento text,
  num_oferta text,
  quincena text,
  supervisor_responsable text,
  telefono_supervisor text,
  dia_comienzo date,
  dia_fin_contrato date,
  dia_contratacion date,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.subcontratas (
  id text primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  obra_id uuid references public.obras(id) on delete set null,
  nombre_empresa text,
  cif text,
  municipio text,
  persona_contacto text,
  telefono text,
  email text,
  actividad_gremio text,
  fecha_inicio_prevista date,
  supervisor_responsable text,
  recurso_preventivo text,
  numero_trabajadores_previstos integer,
  estado_expediente text,
  notas text,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.reconocimientos (
  id text primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  obra_id uuid references public.obras(id) on delete set null,
  trabajador_id bigint,
  dni text,
  apellidos_nombre text,
  resultado text,
  limitaciones text,
  fecha_reconocimiento date,
  validez date,
  centro_medico text,
  observaciones text,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.contrataciones (
  id text primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  obra_id uuid references public.obras(id) on delete set null,
  trabajador_id bigint,
  num_oferta text,
  categoria text,
  periodo_inicio date,
  periodo_fin date,
  quincena text,
  estado text,
  observaciones text,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create index if not exists citas_owner_idx on public.citas(owner_id);
create index if not exists citas_obra_idx on public.citas(obra_id);
create index if not exists citas_trabajador_idx on public.citas(trabajador_id);
create index if not exists citas_fecha_idx on public.citas(cita_dia);
create index if not exists subcontratas_owner_idx on public.subcontratas(owner_id);
create index if not exists subcontratas_obra_idx on public.subcontratas(obra_id);
create index if not exists subcontratas_cif_idx on public.subcontratas(cif);
create index if not exists reconocimientos_owner_idx on public.reconocimientos(owner_id);
create index if not exists reconocimientos_obra_idx on public.reconocimientos(obra_id);
create index if not exists reconocimientos_trabajador_idx on public.reconocimientos(trabajador_id);
create index if not exists reconocimientos_dni_idx on public.reconocimientos(dni);
create index if not exists contrataciones_owner_idx on public.contrataciones(owner_id);
create index if not exists contrataciones_obra_idx on public.contrataciones(obra_id);
create index if not exists contrataciones_trabajador_idx on public.contrataciones(trabajador_id);

create or replace function private.can_access_business_row(
  p_module text,
  p_resource_type text,
  p_resource_id text,
  p_owner_id uuid,
  p_obra_id uuid,
  p_action text
) returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select
    private.is_admin()
    or (
      auth.uid() = p_owner_id
      and private.has_module_permission(p_module, p_action)
    )
    or (
      private.has_module_permission(p_module, p_action)
      and private.has_resource_permission(p_resource_type, p_resource_id, p_action)
    )
    or (
      p_obra_id is not null
      and private.has_module_permission(p_module, p_action)
      and private.has_obra_permission(p_obra_id, p_action)
    );
$$;

create or replace function public.stamp_business_row()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if tg_op = 'INSERT' then
    new.owner_id := auth.uid();
    new.created_by := auth.uid();
    new.created_at := coalesce(new.created_at, now());
  else
    new.owner_id := old.owner_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

alter table public.citas enable row level security;
alter table public.subcontratas enable row level security;
alter table public.reconocimientos enable row level security;
alter table public.contrataciones enable row level security;

-- CITAS
drop policy if exists citas_select on public.citas;
create policy citas_select on public.citas for select to authenticated
using (private.can_access_business_row('citas','citas',id,owner_id,obra_id,'read'));
drop policy if exists citas_insert on public.citas;
create policy citas_insert on public.citas for insert to authenticated
with check (private.has_module_permission('citas','create'));
drop policy if exists citas_update on public.citas;
create policy citas_update on public.citas for update to authenticated
using (private.can_access_business_row('citas','citas',id,owner_id,obra_id,'update'))
with check (private.can_access_business_row('citas','citas',id,owner_id,obra_id,'update'));
drop policy if exists citas_delete on public.citas;
create policy citas_delete on public.citas for delete to authenticated
using (private.can_access_business_row('citas','citas',id,owner_id,obra_id,'delete'));

-- SUBCONTRATAS
drop policy if exists subcontratas_select on public.subcontratas;
create policy subcontratas_select on public.subcontratas for select to authenticated
using (private.can_access_business_row('subcontratas','subcontratas',id,owner_id,obra_id,'read'));
drop policy if exists subcontratas_insert on public.subcontratas;
create policy subcontratas_insert on public.subcontratas for insert to authenticated
with check (private.has_module_permission('subcontratas','create'));
drop policy if exists subcontratas_update on public.subcontratas;
create policy subcontratas_update on public.subcontratas for update to authenticated
using (private.can_access_business_row('subcontratas','subcontratas',id,owner_id,obra_id,'update'))
with check (private.can_access_business_row('subcontratas','subcontratas',id,owner_id,obra_id,'update'));
drop policy if exists subcontratas_delete on public.subcontratas;
create policy subcontratas_delete on public.subcontratas for delete to authenticated
using (private.can_access_business_row('subcontratas','subcontratas',id,owner_id,obra_id,'delete'));

-- RECONOCIMIENTOS
drop policy if exists reconocimientos_select on public.reconocimientos;
create policy reconocimientos_select on public.reconocimientos for select to authenticated
using (private.can_access_business_row('reconocimientos','reconocimientos',id,owner_id,obra_id,'read'));
drop policy if exists reconocimientos_insert on public.reconocimientos;
create policy reconocimientos_insert on public.reconocimientos for insert to authenticated
with check (private.has_module_permission('reconocimientos','create'));
drop policy if exists reconocimientos_update on public.reconocimientos;
create policy reconocimientos_update on public.reconocimientos for update to authenticated
using (private.can_access_business_row('reconocimientos','reconocimientos',id,owner_id,obra_id,'update'))
with check (private.can_access_business_row('reconocimientos','reconocimientos',id,owner_id,obra_id,'update'));
drop policy if exists reconocimientos_delete on public.reconocimientos;
create policy reconocimientos_delete on public.reconocimientos for delete to authenticated
using (private.can_access_business_row('reconocimientos','reconocimientos',id,owner_id,obra_id,'delete'));

-- CONTRATACIONES (el permiso de módulo existente se denomina "contratacion")
drop policy if exists contrataciones_select on public.contrataciones;
create policy contrataciones_select on public.contrataciones for select to authenticated
using (private.can_access_business_row('contratacion','contrataciones',id,owner_id,obra_id,'read'));
drop policy if exists contrataciones_insert on public.contrataciones;
create policy contrataciones_insert on public.contrataciones for insert to authenticated
with check (private.has_module_permission('contratacion','create'));
drop policy if exists contrataciones_update on public.contrataciones;
create policy contrataciones_update on public.contrataciones for update to authenticated
using (private.can_access_business_row('contratacion','contrataciones',id,owner_id,obra_id,'update'))
with check (private.can_access_business_row('contratacion','contrataciones',id,owner_id,obra_id,'update'));
drop policy if exists contrataciones_delete on public.contrataciones;
create policy contrataciones_delete on public.contrataciones for delete to authenticated
using (private.can_access_business_row('contratacion','contrataciones',id,owner_id,obra_id,'delete'));

-- Metadatos de ownership/trazabilidad controlados en servidor.
do $$
declare t text;
begin
  foreach t in array array['citas','subcontratas','reconocimientos','contrataciones'] loop
    execute format('drop trigger if exists trg_%I_stamp on public.%I', t, t);
    execute format('create trigger trg_%I_stamp before insert or update on public.%I for each row execute function public.stamp_business_row()', t, t);
  end loop;
end $$;

-- Auditoría de servidor para estas tablas cuando la función común ya existe.
do $$
declare t text;
begin
  if to_regprocedure('public.audit_business_change()') is not null then
    foreach t in array array['citas','subcontratas','reconocimientos','contrataciones'] loop
      execute format('drop trigger if exists trg_%I_audit on public.%I', t, t);
      execute format('create trigger trg_%I_audit after insert or update or delete on public.%I for each row execute function public.audit_business_change()', t, t);
    end loop;
  end if;
end $$;
