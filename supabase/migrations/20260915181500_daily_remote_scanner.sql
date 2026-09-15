create extension if not exists pgcrypto;

create table if not exists public.scanner_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  paired_at timestamptz,
  last_seen_at timestamptz
);

create table if not exists public.scanner_captures (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.scanner_sessions(id) on delete cascade,
  image_data text not null,
  file_name text,
  created_at timestamptz not null default now()
);

alter table public.scanner_sessions enable row level security;
alter table public.scanner_captures enable row level security;

create policy "scanner sessions owner select" on public.scanner_sessions
for select using (auth.uid() = owner_id);
create policy "scanner sessions owner insert" on public.scanner_sessions
for insert with check (auth.uid() = owner_id);
create policy "scanner sessions owner update" on public.scanner_sessions
for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "scanner sessions owner delete" on public.scanner_sessions
for delete using (auth.uid() = owner_id);

create policy "scanner captures owner select" on public.scanner_captures
for select using (exists (
  select 1 from public.scanner_sessions s where s.id = session_id and s.owner_id = auth.uid()
));
create policy "scanner captures owner delete" on public.scanner_captures
for delete using (exists (
  select 1 from public.scanner_sessions s where s.id = session_id and s.owner_id = auth.uid()
));

create or replace function public.scanner_mobile_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.scanner_sessions%rowtype;
begin
  select * into v_session
  from public.scanner_sessions
  where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex')
    and status = 'active'
    and expires_at > now()
  limit 1;

  if v_session.id is null then
    return jsonb_build_object('valid', false);
  end if;

  update public.scanner_sessions
  set paired_at = coalesce(paired_at, now()), last_seen_at = now()
  where id = v_session.id;

  return jsonb_build_object('valid', true, 'expires_at', v_session.expires_at);
end;
$$;

create or replace function public.scanner_mobile_upload(p_token text, p_image_data text, p_file_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_capture_id uuid;
begin
  if length(coalesce(p_image_data,'')) < 100 then
    raise exception 'invalid image';
  end if;

  select id into v_session_id
  from public.scanner_sessions
  where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex')
    and status = 'active'
    and expires_at > now()
  limit 1;

  if v_session_id is null then
    raise exception 'scanner session expired';
  end if;

  insert into public.scanner_captures(session_id, image_data, file_name)
  values (v_session_id, p_image_data, left(coalesce(p_file_name,'captura.jpg'), 180))
  returning id into v_capture_id;

  update public.scanner_sessions set last_seen_at = now() where id = v_session_id;
  return v_capture_id;
end;
$$;

grant execute on function public.scanner_mobile_status(text) to anon, authenticated;
grant execute on function public.scanner_mobile_upload(text, text, text) to anon, authenticated;

-- Realtime para que el ordenador reciba las capturas al instante.
do $$
begin
  alter publication supabase_realtime add table public.scanner_captures;
exception
  when duplicate_object then null;
end $$;
