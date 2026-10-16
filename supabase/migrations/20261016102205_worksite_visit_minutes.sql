-- Additive module. No historical rows or permissions are rewritten.
create sequence public.visit_minutes_number_seq;
create table public.visit_contacts (
 id uuid primary key, owner_id uuid not null references public.profiles(id), revision integer not null default 1,
 email text not null default '', active boolean not null default true, data jsonb not null,
 updated_at timestamptz not null default now()
);
create unique index visit_contacts_email_unique on public.visit_contacts(owner_id,lower(email)) where email <> '';
create index visit_contacts_owner_idx on public.visit_contacts(owner_id,updated_at desc);
create table public.visit_minutes (
 id uuid primary key, owner_id uuid not null references public.profiles(id), obra_id uuid not null references public.obras(id),
 number text not null unique default ('AV-' || to_char(now() at time zone 'Europe/Madrid','YYYY') || '-' || lpad(nextval('public.visit_minutes_number_seq')::text,6,'0')),
 revision integer not null default 1, version integer not null default 1, status text not null,
 worksite text not null, visit_date date not null, state jsonb not null, search_text text not null default '',
 updated_at timestamptz not null default now(),
 check(status in ('draft','review','changes','rejected','signing','signed','cancelled')),
 check(revision > 0 and version > 0 and jsonb_typeof(state)='object')
);
create index visit_minutes_owner_date_idx on public.visit_minutes(owner_id,visit_date desc,id);
create index visit_minutes_worksite_date_idx on public.visit_minutes(obra_id,visit_date desc,id);
create table public.visit_minutes_versions (
 record_id uuid not null references public.visit_minutes(id), version integer not null, state jsonb not null,
 archived_at timestamptz not null default now(), primary key(record_id,version)
);
create table public.visit_minutes_files (
 record_id uuid not null references public.visit_minutes(id), version integer not null, base64 text not null,
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now(), primary key(record_id,version)
);
create table public.visit_minutes_events (
 id bigint generated always as identity primary key, record_id uuid not null references public.visit_minutes(id),
 version integer not null, actor text not null, event text not null, at timestamptz not null default now(),
 details jsonb not null default '{}'::jsonb
);
create index visit_minutes_events_record_idx on public.visit_minutes_events(record_id,id);
create table public.visit_minutes_operations (
 record_id uuid not null references public.visit_minutes(id), operation_id uuid not null, request_hash text not null,
 primary key(record_id,operation_id)
);
create table public.visit_minutes_access (
 id uuid primary key, record_id uuid not null references public.visit_minutes(id), version integer not null,
 person_id uuid not null, token_hash text not null unique, token_encrypted text not null,
 expires_at timestamptz not null, revoked boolean not null default false,
 otp_hash text, otp_expires_at timestamptz, otp_requested_at timestamptz, attempts integer not null default 0,
 requests integer not null default 0, session_hash text, session_expires_at timestamptz,
 unique(record_id,version,person_id)
);
create table public.visit_minutes_mail_jobs (
 id uuid primary key, record_id uuid not null references public.visit_minutes(id), version integer not null,
 person_id uuid not null, kind text not null check(kind in ('review','signing','final')),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','uncertain','cancelled')),
 attempts integer not null default 0, message_id text, error_code text, updated_at timestamptz not null default now(),
 unique(record_id,version,person_id,kind)
);
create index visit_minutes_jobs_record_idx on public.visit_minutes_mail_jobs(record_id,version);

-- These tables are only mutated by the authenticated application server. There
-- is no client-writable CAS endpoint capable of bypassing the state machine.
alter table public.visit_contacts enable row level security;
alter table public.visit_minutes enable row level security;
alter table public.visit_minutes_versions enable row level security;
alter table public.visit_minutes_files enable row level security;
alter table public.visit_minutes_events enable row level security;
alter table public.visit_minutes_operations enable row level security;
alter table public.visit_minutes_access enable row level security;
alter table public.visit_minutes_mail_jobs enable row level security;
revoke all on public.visit_contacts,public.visit_minutes,public.visit_minutes_versions,public.visit_minutes_files,public.visit_minutes_events,public.visit_minutes_operations,public.visit_minutes_access,public.visit_minutes_mail_jobs from anon,authenticated;
grant select on public.visit_contacts,public.visit_minutes to authenticated;
grant all on public.visit_contacts,public.visit_minutes,public.visit_minutes_versions,public.visit_minutes_files,public.visit_minutes_events,public.visit_minutes_operations,public.visit_minutes_access,public.visit_minutes_mail_jobs to service_role;
grant usage,select on sequence public.visit_minutes_number_seq,public.visit_minutes_events_id_seq to service_role;
create policy visit_contacts_read on public.visit_contacts for select to authenticated using (
 owner_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true)
);
create policy visit_minutes_read on public.visit_minutes for select to authenticated using (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true)
 and (owner_id=(select auth.uid()) or private.has_obra_permission(obra_id,worksite,'read') or exists(select 1 from public.obras o where o.id=obra_id and o.owner_id=(select auth.uid())))
);

create function public.visit_minutes_owner_can_write(p_owner uuid,p_work uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.profiles p join public.obras o on o.id=p_work where p.id=p_owner and p.active=true
   and (o.owner_id=p_owner or p.role='admin' or exists(select 1 from public.data_permissions dp where dp.user_id=p_owner and dp.resource_type='obra' and dp.can_update=true and lower(btrim(dp.resource_id)) in(lower(o.id::text),lower(btrim(o.nombre)),lower(btrim(o.codigo))))));
$$;
revoke all on function public.visit_minutes_owner_can_write(uuid,uuid) from public,anon,authenticated;
grant execute on function public.visit_minutes_owner_can_write(uuid,uuid) to service_role;

create function public.visit_minutes_can_create_work(p_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.obras o where o.id=p_id
   and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true)
   and (o.owner_id=(select auth.uid()) or private.has_obra_permission(o.id,o.nombre,'update')));
$$;
revoke all on function public.visit_minutes_can_create_work(uuid) from public,anon;
grant execute on function public.visit_minutes_can_create_work(uuid) to authenticated;

create function public.visit_minutes_commit(
 p_id uuid,p_owner uuid,p_obra uuid,p_expected integer,p_state jsonb,p_operation uuid,p_hash text,p_actor text,p_event text,
 p_links jsonb default '[]',p_jobs jsonb default '[]',p_pdf text default null,p_sha text default null,p_access uuid default null,p_session text default null,p_details jsonb default '{}'
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.visit_minutes; v jsonb; a public.visit_minutes_access;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into r from public.visit_minutes where id=p_id for update;
 if not public.visit_minutes_owner_can_write(p_owner,p_obra) then raise exception 'Obra no autorizada'; end if;
 if p_access is not null then
   select * into a from public.visit_minutes_access where id=p_access for update;
   if a.id is null or a.record_id<>p_id or a.version<>r.version or a.revoked or a.expires_at<=now() or a.session_hash is null or a.session_hash<>p_session or a.session_expires_at<=now() or p_actor<>'participant:'||a.person_id::text then raise exception 'Acceso revocado o caducado'; end if;
 end if;
 if r.id is not null then
   if r.owner_id<>p_owner then raise exception 'Sin permisos'; end if;
   if exists(select 1 from public.visit_minutes_operations where record_id=p_id and operation_id=p_operation) then
     if not exists(select 1 from public.visit_minutes_operations where record_id=p_id and operation_id=p_operation and request_hash=p_hash) then raise exception 'Operación reutilizada con otros datos'; end if;
     return to_jsonb(r);
   end if;
 end if;
 if not exists(select 1 from public.profiles where id=p_owner and active=true) then raise exception 'Cuenta no activa'; end if;
 if octet_length(p_state::text)>3500000 or (p_state->'content'->>'worksiteId')::uuid<>p_obra then raise exception 'Acta inválida o demasiado grande'; end if;
 if r.id is null then
   if p_expected<>0 or p_state->>'status'<>'draft' or (p_state->>'version')::int<>1 then raise exception 'Revisión desactualizada'; end if;
   insert into public.visit_minutes(id,owner_id,obra_id,status,state,worksite,visit_date) values(p_id,p_owner,p_obra,'draft',p_state,p_state->'content'->>'worksite',(p_state->'content'->>'date')::date) returning * into r;
 else
   if r.revision<>p_expected then raise exception 'Revisión desactualizada. Recarga antes de guardar.'; end if;
   if r.obra_id<>p_obra then raise exception 'No se puede trasladar el acta a otra obra'; end if;
   if ((p_state->>'version')::int<>r.version or p_state->>'status'='cancelled') and exists(select 1 from public.visit_minutes_mail_jobs where record_id=p_id and status='sending') then raise exception 'Hay un envío en curso. Comprueba su resultado antes de cambiar la versión.'; end if;
   if (p_state->>'version')::int=r.version+1 then
     insert into public.visit_minutes_versions(record_id,version,state) values(r.id,r.version,r.state);
   elsif (p_state->>'version')::int<>r.version then raise exception 'Versión inválida'; end if;
   update public.visit_minutes set state=p_state,status=p_state->>'status',version=(p_state->>'version')::int,revision=revision+1,worksite=p_state->'content'->>'worksite',visit_date=(p_state->'content'->>'date')::date,updated_at=now() where id=p_id returning * into r;
 end if;
 update public.visit_minutes set search_text=lower(number||' '||worksite||' '||(p_state->'participants')::text) where id=p_id;
 if p_pdf is not null then
   if r.status<>'signed' or length(p_pdf)>4200000 or p_sha is null or (p_state->>'finalSha256') is distinct from p_sha then raise exception 'Archivo final inválido'; end if;
   insert into public.visit_minutes_files(record_id,version,base64,sha256) values(p_id,r.version,p_pdf,p_sha);
 end if;
 update public.visit_minutes_access set revoked=true,session_hash=null where record_id=p_id and (version<>r.version or r.status='cancelled');
 update public.visit_minutes_mail_jobs set status='cancelled',updated_at=now() where record_id=p_id and (version<>r.version or r.status='cancelled') and status in('pending','failed');
 for v in select * from jsonb_array_elements(p_links) loop
   insert into public.visit_minutes_access(id,record_id,version,person_id,token_hash,token_encrypted,expires_at)
   values((v->>'id')::uuid,p_id,r.version,(v->>'personId')::uuid,v->>'hash',v->>'encrypted',now()+interval '7 days') on conflict(record_id,version,person_id) do update set token_hash=excluded.token_hash,token_encrypted=excluded.token_encrypted,expires_at=excluded.expires_at,revoked=false,session_hash=null,otp_hash=null,requests=0,attempts=0;
 end loop;
 for v in select * from jsonb_array_elements(p_jobs) loop
   insert into public.visit_minutes_mail_jobs(id,record_id,version,person_id,kind) values((v->>'id')::uuid,p_id,r.version,(v->>'personId')::uuid,v->>'kind') on conflict(record_id,version,person_id,kind) do nothing;
 end loop;
 insert into public.visit_minutes_events(record_id,version,actor,event,details) values(p_id,r.version,p_actor,p_event,jsonb_build_object('revision',r.revision)||coalesce(p_details,'{}'::jsonb));
 insert into public.visit_minutes_operations values(p_id,p_operation,p_hash);
 return to_jsonb(r);
end $$;
revoke all on function public.visit_minutes_commit(uuid,uuid,uuid,integer,jsonb,uuid,text,text,text,jsonb,jsonb,text,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.visit_minutes_commit(uuid,uuid,uuid,integer,jsonb,uuid,text,text,text,jsonb,jsonb,text,text,uuid,text,jsonb) to service_role;

create function public.visit_minutes_challenge(p_id uuid,p_hash text) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.visit_minutes_access;
begin
 select * into r from public.visit_minutes_access where id=p_id for update;
 if r.id is null or r.revoked or r.expires_at<=now() or r.requests>=10 or r.otp_requested_at>now()-interval '60 seconds' then return false; end if;
 update public.visit_minutes_access set otp_hash=p_hash,otp_expires_at=now()+interval '10 minutes',otp_requested_at=now(),attempts=0,requests=requests+1,session_hash=null where id=p_id;
 return true;
end $$;
create function public.visit_minutes_verify(p_id uuid,p_hash text,p_session text) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.visit_minutes_access;
begin
 select * into r from public.visit_minutes_access where id=p_id for update;
 if r.id is null or r.revoked or r.expires_at<=now() or r.otp_expires_at<=now() or r.otp_hash is null or r.attempts>=5 then return false; end if;
 if r.otp_hash<>p_hash then update public.visit_minutes_access set attempts=attempts+1 where id=p_id; return false; end if;
 update public.visit_minutes_access set otp_hash=null,session_hash=p_session,session_expires_at=now()+interval '1 hour' where id=p_id;
 return true;
end $$;
revoke all on function public.visit_minutes_challenge(uuid,text),public.visit_minutes_verify(uuid,text,text) from public,anon,authenticated;
grant execute on function public.visit_minutes_challenge(uuid,text),public.visit_minutes_verify(uuid,text,text) to service_role;

create function public.visit_minutes_claim_mail(p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.visit_minutes_mail_jobs;
begin
 select * into j from public.visit_minutes_mail_jobs where id=p_id for update;
 if j.status='sending' and j.updated_at<now()-interval '2 minutes' then
   update public.visit_minutes_mail_jobs set status='uncertain',error_code='SEND_INTERRUPTED',updated_at=now() where id=p_id; return null;
 end if;
 if j.id is null or j.status not in('pending','failed') or j.attempts>=5 then return null; end if;
 if not exists(select 1 from public.visit_minutes where id=j.record_id and version=j.version and status<>'cancelled' and public.visit_minutes_owner_can_write(owner_id,obra_id)) then return null; end if;
 update public.visit_minutes_mail_jobs set status='sending',attempts=attempts+1,updated_at=now(),error_code=null where id=p_id returning * into j;
 return to_jsonb(j);
end $$;
revoke all on function public.visit_minutes_claim_mail(uuid) from public,anon,authenticated;
grant execute on function public.visit_minutes_claim_mail(uuid) to service_role;

create function public.visit_minutes_finish_mail(p_id uuid,p_status text,p_message text,p_code text,p_actor text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.visit_minutes_mail_jobs;
begin
 select * into j from public.visit_minutes_mail_jobs where id=p_id for update;
 if j.id is null or j.status not in('sending','uncertain') or p_status not in('sent','failed','uncertain') or (p_status='sent' and nullif(p_message,'') is null) then raise exception 'Resultado de envío inválido'; end if;
 update public.visit_minutes_mail_jobs set status=p_status,message_id=p_message,error_code=p_code,updated_at=now() where id=p_id;
 insert into public.visit_minutes_events(record_id,version,actor,event,details) values(j.record_id,j.version,p_actor,case when p_status='sent' then 'mail-accepted' else 'mail-'||p_status end,jsonb_build_object('jobId',j.id,'personId',j.person_id,'kind',j.kind,'errorCode',p_code));
 return true;
end $$;
revoke all on function public.visit_minutes_finish_mail(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.visit_minutes_finish_mail(uuid,text,text,text,text) to service_role;
