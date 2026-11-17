-- Private versioned records. Only the authenticated server command layer may write/read.
create table public.workforce_documents (
 id uuid primary key,
 owner_id uuid not null references public.profiles(id),
 worker_id bigint not null,
 worksite_id uuid not null references public.obras(id),
 access_id uuid references public.foreman_portal_access(id),
 kind text not null check(kind in ('rechazo_voluntario','salida_obra')),
 revision integer not null check(revision>0),
 state jsonb not null,
 pdf_base64 text,
 return_pdf_base64 text,
 updated_at timestamptz not null default now(),
 foreign key(owner_id,worker_id) references public.trabajadores(owner_id,id)
);
create index workforce_documents_scope on public.workforce_documents(owner_id,worksite_id,updated_at desc,id);
create index workforce_documents_worker on public.workforce_documents(owner_id,worker_id);
create index workforce_documents_worksite on public.workforce_documents(worksite_id);
create index workforce_documents_access on public.workforce_documents(access_id);
create table public.workforce_document_events (
 document_id uuid not null references public.workforce_documents(id),
 revision integer not null,
 operation_id uuid not null,
 request_hash text not null,
 action text not null,
 actor jsonb not null,
 state jsonb not null,
 pdf_base64 text,
 return_pdf_base64 text,
 at timestamptz not null default now(),
 primary key(document_id,revision), unique(document_id,operation_id)
);
alter table public.workforce_documents enable row level security;
alter table public.workforce_document_events enable row level security;
revoke all on public.workforce_documents,public.workforce_document_events from public,anon,authenticated,service_role;
grant select,insert,update on public.workforce_documents to service_role;
grant select,insert on public.workforce_document_events to service_role;
-- Invoker function, server-only. CAS, idempotency and atomic PDF + audit commit.
create function public.workforce_document_commit(
 p_owner uuid,p_id uuid,p_expected integer,p_operation uuid,p_request_hash text,
 p_action text,p_actor jsonb,p_state jsonb,p_pdf text default null,p_return_pdf text default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare prior public.workforce_documents; event public.workforce_document_events;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into prior from public.workforce_documents where id=p_id for update;
 if found and prior.owner_id<>p_owner then raise exception 'Scope mismatch' using errcode='42501';end if;
 select * into event from public.workforce_document_events where document_id=p_id and operation_id=p_operation;
 if found then
  if event.request_hash<>p_request_hash then raise exception 'Idempotency mismatch' using errcode='PT409';end if;
  return prior.state;
 end if;
 if coalesce(prior.revision,0)<>p_expected then raise exception 'Revision conflict' using errcode='PT409';end if;
 if p_state->>'ownerId'<>p_owner::text or p_state->>'id'<>p_id::text or (p_state->>'revision')::int<>p_expected+1 then raise exception 'Invalid state';end if;
 if prior.id is not null and (prior.worker_id<>(p_state->>'workerId')::bigint or prior.worksite_id<>(p_state->>'worksiteId')::uuid or prior.kind<>p_state->>'kind' or prior.access_id is distinct from nullif(p_state->>'accessId','')::uuid) then raise exception 'Immutable scope' using errcode='42501';end if;
 if not exists(select 1 from public.obras where id=(p_state->>'worksiteId')::uuid and owner_id=p_owner) or not exists(select 1 from public.trabajadores where owner_id=p_owner and id=(p_state->>'workerId')::bigint) then raise exception 'Invalid scope' using errcode='42501';end if;
 insert into public.workforce_documents(id,owner_id,worker_id,worksite_id,access_id,kind,revision,state,pdf_base64,return_pdf_base64)
 values(p_id,p_owner,(p_state->>'workerId')::bigint,(p_state->>'worksiteId')::uuid,nullif(p_state->>'accessId','')::uuid,p_state->>'kind',p_expected+1,p_state,p_pdf,p_return_pdf)
 on conflict(id) do update set revision=excluded.revision,state=excluded.state,
 pdf_base64=coalesce(excluded.pdf_base64,workforce_documents.pdf_base64),
 return_pdf_base64=coalesce(excluded.return_pdf_base64,workforce_documents.return_pdf_base64),updated_at=now();
 insert into public.workforce_document_events(document_id,revision,operation_id,request_hash,action,actor,state,pdf_base64,return_pdf_base64)
 values(p_id,p_expected+1,p_operation,p_request_hash,p_action,p_actor,p_state,p_pdf,p_return_pdf);
 return p_state;
end;$$;
revoke all on function public.workforce_document_commit(uuid,uuid,integer,uuid,text,text,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.workforce_document_commit(uuid,uuid,integer,uuid,text,text,jsonb,jsonb,text,text) to service_role;
