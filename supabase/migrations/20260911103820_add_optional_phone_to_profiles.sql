alter table public.profiles
  add column if not exists telefono text null;

comment on column public.profiles.telefono is
  'Teléfono opcional del usuario para fines de contacto administrativo.';
