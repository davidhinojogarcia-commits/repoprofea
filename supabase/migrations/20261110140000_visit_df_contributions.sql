-- DF collaboration is opt-in and additive. Public clients never read/write these tables.
create table if not exists public.visit_df_invitations (
 id uuid primary key default gen_random_uuid(),
 record_id uuid not null references public.visit_minutes(id) on delete cascade,
 version integer not null,
 person_id uuid not null,
 email text not null,
 token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz not null,
 revoked boolean not null default false,
 otp_hash text,
 otp_expires_at timestamptz,
 otp_requested_at timestamptz,
 attempts integer not null default 0,
 requests integer not null default 0,
 session_hash text,
 session_expires_at timestamptz,
 created_at timestamptz not null default now(),
 unique(record_id, version, person_id)
);
create index if not exists visit_df_invitation_record on public.visit_df_invitations(record_id,version);
create table if not exists public.visit_df_contributions (
 id uuid primary key default gen_random_uuid(),
 invitation_id uuid not null references public.visit_df_invitations(id),
 operation_id uuid not null,
 record_id uuid not null references public.visit_minutes(id) on delete cascade,
 version integer not null,
 person_id uuid not null,
 title text not null default '',
 description text not null,
 status text not null default 'pending' check (status in ('pending','accepted','rejected')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewer uuid references public.profiles(id),
 constraint visit_df_unique_request unique(invitation_id,operation_id),
 constraint visit_df_title_length check (char_length(title) <= 200),
 constraint visit_df_description_length check (char_length(btrim(description)) between 1 and 20000)
);
create index if not exists visit_df_contrib_record on public.visit_df_contributions(record_id,version,status,created_at);
alter table public.visit_df_invitations enable row level security;
alter table public.visit_df_contributions enable row level security;
revoke all on public.visit_df_invitations, public.visit_df_contributions from public, anon, authenticated;
grant all on public.visit_df_invitations, public.visit_df_contributions to service_role;

-- Rate limits, OTP consumption and sessions are serialized within PostgreSQL.
create or replace function public.visit_df_challenge(p_id uuid,p_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare v public.visit_df_invitations;
begin
 select * into v from public.visit_df_invitations where id=p_id for update;
 if not found or v.revoked or v.expires_at<=now() or v.requests>=10
    or v.otp_requested_at>now()-interval '60 seconds' then return false; end if;
 update public.visit_df_invitations set otp_hash=p_hash,otp_expires_at=now()+interval '10 minutes',
    otp_requested_at=now(),requests=requests+1,attempts=0,session_hash=null,session_expires_at=null
 where id=p_id;
 return true;
end $$;
create or replace function public.visit_df_verify(p_id uuid,p_hash text,p_session_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare v public.visit_df_invitations;
begin
 select * into v from public.visit_df_invitations where id=p_id for update;
 if not found or v.revoked or v.expires_at<=now() or v.otp_expires_at<=now()
   or v.otp_hash is null or v.attempts>=5 then return false; end if;
 if v.otp_hash<>p_hash then
   update public.visit_df_invitations set attempts=attempts+1 where id=p_id;
   return false;
 end if;
 update public.visit_df_invitations set otp_hash=null,otp_expires_at=null,
  session_hash=p_session_hash,session_expires_at=now()+interval '2 hours'
 where id=p_id;
 return true;
end $$;
create or replace function public.visit_df_submit(p_id uuid,p_session_hash text,p_operation uuid,p_title text,p_description text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.visit_df_invitations; r public.visit_minutes; result uuid; n integer;
begin
 select * into v from public.visit_df_invitations where id=p_id for update;
 if not found or v.revoked or v.expires_at<=now() or v.session_hash is distinct from p_session_hash
   or v.session_expires_at<=now() then raise exception 'Acceso revocado o sesión caducada'; end if;
 select * into r from public.visit_minutes where id=v.record_id for update;
 if not found or r.version<>v.version or r.status<>'draft'
    or not public.visit_minutes_owner_can_write(r.owner_id,r.obra_id) then
   raise exception 'Acta no disponible para aportaciones'; end if;
 if char_length(p_title)>200 or char_length(btrim(p_description)) not between 1 and 20000 then
   raise exception 'Punto no válido'; end if;
 select count(*) into n from public.visit_df_contributions where record_id=r.id and version=r.version;
 if n>=100 then raise exception 'Límite de aportaciones alcanzado'; end if;
 insert into public.visit_df_contributions(invitation_id,operation_id,record_id,version,person_id,title,description)
 values(v.id,p_operation,v.record_id,v.version,v.person_id,coalesce(p_title,''),btrim(p_description))
 on conflict (invitation_id,operation_id) do nothing returning id into result;
 if result is null then
   select id into result from public.visit_df_contributions where invitation_id=v.id and operation_id=p_operation;
 end if;
 return result;
end $$;
-- Atomic review: only the owner can append DF text; never replace existing points.
create or replace function public.visit_df_review(p_id uuid,p_owner uuid,p_revision integer,p_accept boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.visit_df_contributions; r public.visit_minutes; points jsonb; point jsonb;
begin
 select * into c from public.visit_df_contributions where id=p_id for update;
 if not found or c.status<>'pending' then raise exception 'Aportación ya revisada'; end if;
 select * into r from public.visit_minutes where id=c.record_id for update;
 if not found or r.owner_id<>p_owner or r.status<>'draft' or r.version<>c.version
    or r.revision<>p_revision or not public.visit_minutes_owner_can_write(p_owner,r.obra_id) then
   raise exception 'Revisión desactualizada o sin permisos'; end if;
 if p_accept then
   points=coalesce(r.state #> '{content,points}','[]'::jsonb);
   if jsonb_typeof(points)<>'array' or jsonb_array_length(points)>=100 then raise exception 'Límite de puntos del acta'; end if;
   point=jsonb_build_object('id',gen_random_uuid(),
     'title',left('Aportación DF · '||coalesce(nullif(c.title,''),'Punto de visita'),200),
     'description',c.description,'attachmentIds',jsonb_build_array());
   update public.visit_minutes set
     state=jsonb_set(state,'{content,points}',points||jsonb_build_array(point),true),
     revision=revision+1,updated_at=now()
   where id=r.id;
 end if;
 update public.visit_df_contributions set status=case when p_accept then 'accepted' else 'rejected' end,
    reviewed_at=now(),reviewer=p_owner where id=p_id;
 insert into public.visit_minutes_events(record_id,version,actor,event,details)
 values(r.id,r.version,p_owner::text,case when p_accept then 'df-point-accepted' else 'df-point-rejected' end,
   jsonb_build_object('contributionId',c.id,'personId',c.person_id,'source','direccion-facultativa'));
 return true;
end $$;
revoke all on function public.visit_df_challenge(uuid,text),public.visit_df_verify(uuid,text,text),
 public.visit_df_submit(uuid,text,uuid,text,text),public.visit_df_review(uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.visit_df_challenge(uuid,text),public.visit_df_verify(uuid,text,text),
 public.visit_df_submit(uuid,text,uuid,text,text),public.visit_df_review(uuid,uuid,integer,boolean) to service_role;
