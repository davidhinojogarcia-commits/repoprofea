-- Actas 3.1: metadata-only states and one private copy of each optimized asset.
-- No original signed snapshot or PDF is rewritten.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('visit-minutes-private','visit-minutes-private',false,20000000,array['image/png','image/jpeg','application/pdf'])
on conflict(id) do nothing;
do $$begin if exists(select 1 from storage.buckets where id='visit-minutes-private' and public) then raise exception 'El bucket documental debe ser privado';end if;end $$;
create table public.visit_minutes_assets(
 id uuid primary key,owner_id uuid not null references public.profiles(id),obra_id uuid not null references public.obras(id),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'),bytes integer not null check(bytes>0 and bytes<=1500000),
 mime text not null check(mime in ('image/png','image/jpeg','application/pdf')),storage_path text not null unique,
 created_at timestamptz not null default now(),unique(owner_id,obra_id,sha256)
);
create index visit_minutes_assets_owner_date on public.visit_minutes_assets(owner_id,created_at);
create table public.visit_minutes_draft_files(
 record_id uuid not null references public.visit_minutes(id),version integer not null,source_hash text not null,
 owner_id uuid not null references public.profiles(id),storage_path text not null unique,sha256 text not null,
 created_at timestamptz not null default now(),primary key(record_id,version,source_hash)
);
alter table public.visit_minutes_assets enable row level security;
alter table public.visit_minutes_draft_files enable row level security;
revoke all on public.visit_minutes_assets,public.visit_minutes_draft_files from public,anon,authenticated;
grant all on public.visit_minutes_assets,public.visit_minutes_draft_files to service_role;
alter table public.visit_minutes_files add column storage_path text;
alter table public.visit_minutes_files alter column base64 drop not null;
alter table public.visit_minutes_files add constraint visit_pdf_source check((base64 is not null) <> (storage_path is not null));
alter function public.visit_minutes_commit(uuid,uuid,uuid,integer,jsonb,uuid,text,text,text,jsonb,jsonb,text,text,uuid,text,jsonb) rename to visit_minutes_commit_before_assets;
create function public.visit_minutes_commit(
 p_id uuid,p_owner uuid,p_obra uuid,p_expected integer,p_state jsonb,p_operation uuid,p_hash text,p_actor text,p_event text,
 p_links jsonb default '[]',p_jobs jsonb default '[]',p_pdf text default null,p_sha text default null,p_access uuid default null,p_session text default null,p_details jsonb default '{}'
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;path text=p_details->>'finalStoragePath';a jsonb;total bigint=0;
begin
 for a in select * from jsonb_array_elements(coalesce(p_state#>'{content,attachments}','[]')) loop
   if a ? 'fileId' then
     if not exists(select 1 from public.visit_minutes_assets asset where asset.id=(a->>'fileId')::uuid and asset.owner_id=p_owner and asset.obra_id=p_obra and asset.sha256=a->>'sha256' and asset.bytes=(a->>'bytes')::integer and asset.mime=a->>'mime') then raise exception 'Anexo de otra obra, propietario o contenido';end if;
     total=total+(a->>'bytes')::bigint;
   else total=total+length(decode(a->>'base64','base64'));end if;
 end loop;
 if total>8000000 then raise exception 'Los anexos superan el límite total';end if;
 if path is not null and (p_event<>'finalize' or path<>p_owner::text||'/final/'||p_id::text||'_v'||(p_state->>'version')||'_'||p_sha||'.pdf') then raise exception 'Referencia final inválida';end if;
 result=public.visit_minutes_commit_before_assets(p_id,p_owner,p_obra,p_expected,p_state,p_operation,p_hash,p_actor,p_event,p_links,p_jobs,case when path is null then p_pdf else '' end,p_sha,p_access,p_session,p_details-'finalStoragePath');
 if path is not null then
   update public.visit_minutes_files set base64=null,storage_path=path where record_id=p_id and version=(p_state->>'version')::integer and sha256=p_sha;
 end if;
 return result;
end $$;
revoke all on function public.visit_minutes_commit(uuid,uuid,uuid,integer,jsonb,uuid,text,text,text,jsonb,jsonb,text,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.visit_minutes_commit(uuid,uuid,uuid,integer,jsonb,uuid,text,text,text,jsonb,jsonb,text,text,uuid,text,jsonb) to service_role;
commit;
