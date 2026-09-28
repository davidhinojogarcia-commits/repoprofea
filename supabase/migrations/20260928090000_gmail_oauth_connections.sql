create table if not exists public.gmail_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  refresh_token_encrypted text not null,
  scope text not null default 'https://www.googleapis.com/auth/gmail.send',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sent_at timestamptz null
);

alter table public.gmail_connections enable row level security;

revoke all on table public.gmail_connections from anon, authenticated;
grant all on table public.gmail_connections to service_role;

comment on table public.gmail_connections is
  'Conexiones Gmail OAuth por supervisor. Solo accesible desde funciones servidor con service_role.';
comment on column public.gmail_connections.refresh_token_encrypted is
  'Refresh token de Google cifrado en servidor con AES-256-GCM.';
