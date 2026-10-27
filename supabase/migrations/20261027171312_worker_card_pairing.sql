-- A pairing is restricted to one supervisor and two authenticated Supabase sessions.
-- Only token hashes are stored. No worker details or QR tokens are sent to Realtime.
create table public.worker_card_pair_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  desktop_session_id uuid not null,
  pair_hash text not null unique check (pair_hash ~ '^[0-9a-f]{64}$'),
  mobile_hash text unique check (mobile_hash is null or mobile_hash ~ '^[0-9a-f]{64}$'),
  mobile_session_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes',
  paired_at timestamptz,
  revoked_at timestamptz,
  last_scan_at timestamptz,
  scan_count integer not null default 0 check (scan_count between 0 and 60)
);
create table public.worker_card_pair_results (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.worker_card_pair_sessions(id) on delete cascade,
  worker_id bigint not null references public.trabajadores(id),
  created_at timestamptz not null default now()
);
alter table public.worker_card_pair_sessions enable row level security;
alter table public.worker_card_pair_results enable row level security;
revoke all on public.worker_card_pair_sessions from public, anon, authenticated;
revoke all on public.worker_card_pair_results from public, anon, authenticated;
grant select on public.worker_card_pair_results to authenticated;
-- The policy needs a narrowly scoped helper because the underlying table is private.
create or replace function public.worker_card_pair_can_read(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (select 1 from public.worker_card_pair_sessions s where s.id=p_id
 and s.owner_id=(select auth.uid()) and s.desktop_session_id::text=(select auth.jwt()->>'session_id')
 and s.revoked_at is null and s.expires_at>now());
$$;
revoke all on function public.worker_card_pair_can_read(uuid) from public, anon;
grant execute on function public.worker_card_pair_can_read(uuid) to authenticated;
create policy worker_card_pair_results_desktop on public.worker_card_pair_results for select to authenticated
using (public.worker_card_pair_can_read(session_id));

create or replace function public.worker_card_pair_create(p_pair_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_expiry timestamptz; v_sid uuid;
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt()->>'session_id'),'') !~ '^[0-9a-fA-F-]{36}$' or coalesce(p_pair_hash,'') !~ '^[0-9a-f]{64}$' then raise exception 'invalid session'; end if;
  v_sid := (select (auth.jwt()->>'session_id')::uuid);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_sid::text, 0));
  delete from public.worker_card_pair_sessions where owner_id=(select auth.uid()) and expires_at < now();
  update public.worker_card_pair_sessions set revoked_at=now() where owner_id=(select auth.uid()) and desktop_session_id=v_sid and revoked_at is null;
  insert into public.worker_card_pair_sessions(owner_id,desktop_session_id,pair_hash) values ((select auth.uid()),v_sid,p_pair_hash) returning id,expires_at into v_id,v_expiry;
  return jsonb_build_object('id',v_id,'expires_at',v_expiry);
end; $$;

create or replace function public.worker_card_pair_connect(p_pair_token text,p_mobile_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.worker_card_pair_sessions%rowtype; v_sid uuid;
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt()->>'session_id'),'') !~ '^[0-9a-fA-F-]{36}$' or coalesce(p_pair_token,'') !~ '^[A-Za-z0-9_-]{43}$' or coalesce(p_mobile_hash,'') !~ '^[0-9a-f]{64}$' then raise exception 'invalid pairing'; end if;
  v_sid := (select (auth.jwt()->>'session_id')::uuid);
  update public.worker_card_pair_sessions s set mobile_hash=p_mobile_hash,mobile_session_id=v_sid,paired_at=now()
    where s.pair_hash=encode(extensions.digest(p_pair_token,'sha256'),'hex') and s.owner_id=(select auth.uid())
    and s.desktop_session_id<>v_sid and s.paired_at is null and s.revoked_at is null and s.expires_at>now()
    returning s.* into v_session;
  if v_session.id is null then return jsonb_build_object('valid',false); end if;
  return jsonb_build_object('valid',true,'expires_at',v_session.expires_at);
end; $$;

create or replace function public.worker_card_pair_submit(p_mobile_token text,p_worker_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_session public.worker_card_pair_sessions%rowtype; v_worker bigint;
begin
  if (select auth.uid()) is null or coalesce(p_mobile_token,'') !~ '^[A-Za-z0-9_-]{43}$' then return false; end if;
  select * into v_session from public.worker_card_pair_sessions s
    where s.mobile_hash=encode(extensions.digest(p_mobile_token,'sha256'),'hex') and s.owner_id=(select auth.uid())
    and s.mobile_session_id::text=(select auth.jwt()->>'session_id') and s.revoked_at is null and s.expires_at>now() for update;
  if v_session.id is null or v_session.scan_count>=60 or (v_session.last_scan_at is not null and v_session.last_scan_at>now()-interval '1 second') then return false; end if;
  v_worker := public.resolve_worker_card_owner(p_worker_token);
  if v_worker is null then return false; end if;
  insert into public.worker_card_pair_results(session_id,worker_id) values (v_session.id,v_worker);
  update public.worker_card_pair_sessions set last_scan_at=now(),scan_count=scan_count+1 where id=v_session.id;
  return true;
end; $$;

create or replace function public.worker_card_pair_close(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.worker_card_pair_sessions set revoked_at=coalesce(revoked_at,now())
    where id=p_id and owner_id=(select auth.uid()) and desktop_session_id::text=(select auth.jwt()->>'session_id');
  if found then delete from public.worker_card_pair_results where session_id=p_id; end if;
end; $$;
revoke all on function public.worker_card_pair_create(text), public.worker_card_pair_connect(text,text), public.worker_card_pair_submit(text,uuid), public.worker_card_pair_close(uuid) from public, anon;
grant execute on function public.worker_card_pair_create(text), public.worker_card_pair_connect(text,text), public.worker_card_pair_submit(text,uuid), public.worker_card_pair_close(uuid) to authenticated;
do $$ begin alter publication supabase_realtime add table public.worker_card_pair_results; exception when duplicate_object then null; end $$;
