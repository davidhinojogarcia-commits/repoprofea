-- Canonical obra_id wins. Match bounded legacy labels and lock the worker through commit.
create or replace function public.workforce_document_commit(
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
 if not exists(select 1 from public.obras where id=(p_state->>'worksiteId')::uuid and owner_id=p_owner) then raise exception 'Invalid scope' using errcode='42501';end if;
 if p_action in('save','prepare','sign-worker','sign-foreman') then
  perform 1 from public.trabajadores t where t.owner_id=p_owner and t.id=(p_state->>'workerId')::bigint
   and (t.obra_id=(p_state->>'worksiteId')::uuid or(t.obra_id is null and(
    lower(trim(t.obra)) in(lower(trim(p_state#>>'{worksite,name}')),lower(trim(p_state#>>'{worksite,code}')),lower(trim(regexp_replace(p_state#>>'{worksite,name}','^\d{5}\s+(GR|EE)\s+','','i'))))
    or exists(select 1 from public.foreman_portal_access a where a.id=nullif(p_state->>'accessId','')::uuid and a.owner_id=p_owner and a.active and lower(trim(a.obra))=lower(trim(t.obra)))
   ))) for share;
  if not found then raise exception 'Worker no longer authorised' using errcode='PT409';end if;
 end if;
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
