-- Datos administrativos del trabajador. Nullable para compatibilidad histórica.
alter table public.trabajadores
  add column if not exists numero_seguridad_social text null,
  add column if not exists iban text null;

create index if not exists trabajadores_nuss_owner_idx
  on public.trabajadores(owner_id, numero_seguridad_social)
  where numero_seguridad_social is not null and numero_seguridad_social <> '';

comment on column public.trabajadores.numero_seguridad_social is 'NUSS/NAF normalizado (12 dígitos). Validado en aplicación antes de persistir.';
comment on column public.trabajadores.iban is 'IBAN normalizado. Dato administrativo sensible sujeto a las RLS existentes de trabajadores.';
