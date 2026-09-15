begin;

alter table public.obras
  add column if not exists empresa text,
  add column if not exists cif text,
  add column if not exists recurso_preventivo text,
  add column if not exists recurso_preventivo_categoria text;

-- A work code belongs to its supervisor; the same administrative code must not
-- cause collisions between isolated accounts.
drop index if exists public.obras_codigo_unique;
create unique index if not exists obras_owner_codigo_unique
  on public.obras(owner_id, codigo)
  where codigo is not null and btrim(codigo) <> '';

-- Preserve existing assignments stored in user settings while moving their
-- source of truth to the work row. Empty municipality values stay empty so the
-- UI can identify them as pending instead of inventing data.
with configured_resources as (
  select
    us.user_id,
    entry.key as work_name,
    nullif(btrim(entry.value ->> 'recursoPreventivoNombre'), '') as resource_name,
    nullif(btrim(entry.value ->> 'recursoPreventivoCategoria'), '') as resource_category
  from public.user_settings us
  cross join lateral jsonb_each(
    coalesce(us.settings -> 'subcontratasPreferences' -> 'obrasRecursosPreventivos', '{}'::jsonb)
  ) as entry
)
update public.obras work
set
  recurso_preventivo = coalesce(nullif(btrim(work.recurso_preventivo), ''), configured_resources.resource_name),
  recurso_preventivo_categoria = coalesce(nullif(btrim(work.recurso_preventivo_categoria), ''), configured_resources.resource_category),
  updated_at = now()
from configured_resources
where work.owner_id = configured_resources.user_id
  and lower(btrim(work.nombre)) = lower(btrim(configured_resources.work_name))
  and configured_resources.resource_name is not null;

commit;
