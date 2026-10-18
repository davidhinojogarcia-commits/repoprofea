-- Additive metadata; retain every original state, PDF, mail attempt and event.
begin;
create function public.visit_minutes_action_summary(s jsonb) returns jsonb language sql immutable strict set search_path='' as $summary$
 select jsonb_build_object(
 'reviews',coalesce((select jsonb_agg(jsonb_build_object('id',p->>'id','name',concat_ws(' ',p->>'firstName',p->>'lastName'))) from jsonb_array_elements(s->'participants') p where (p->>'reviewRequired')::boolean and not coalesce(s->'responses' ? (p->>'id'),false)),'[]'::jsonb),
 'signatures',coalesce((select jsonb_agg(jsonb_build_object('id',p->>'id','name',concat_ws(' ',p->>'firstName',p->>'lastName'))) from jsonb_array_elements(s->'participants') p where p->>'signing'='required' and not coalesce(s->'signatures' ? (p->>'id'),false)),'[]'::jsonb));
$summary$;
revoke all on function public.visit_minutes_action_summary(jsonb) from public,anon,authenticated;
grant execute on function public.visit_minutes_action_summary(jsonb) to service_role;
alter table public.visit_minutes add column action_summary jsonb generated always as (public.visit_minutes_action_summary(state)) stored;
alter table public.visit_minutes_mail_jobs add column notification_key uuid;
alter table public.visit_minutes_mail_jobs drop constraint visit_minutes_mail_jobs_record_id_version_person_id_kind_key;
create unique index visit_minutes_initial_mail_unique on public.visit_minutes_mail_jobs(record_id,version,person_id,kind) where notification_key is null;
-- Keep the established transactional writer, changing only index inference.
do $migration$
declare definition text;
begin
 definition=pg_get_functiondef('public.visit_minutes_commit_without_orders(uuid,uuid,uuid,integer,jsonb,uuid,text,text,text,jsonb,jsonb,text,text,uuid,text,jsonb)'::regprocedure);
 if position('on conflict(record_id,version,person_id,kind) do nothing' in definition)=0 then raise exception 'Unexpected visit writer definition'; end if;
 execute replace(definition,'on conflict(record_id,version,person_id,kind) do nothing','on conflict(record_id,version,person_id,kind) where notification_key is null do nothing');
end $migration$;
alter function public.visit_minutes_commit(uuid,uuid,uuid,integer,jsonb,uuid,text,text,text,jsonb,jsonb,text,text,uuid,text,jsonb) rename to visit_minutes_commit_before_mixed;
create function public.visit_minutes_commit(
 p_id uuid,p_owner uuid,p_obra uuid,p_expected integer,p_state jsonb,p_operation uuid,p_hash text,p_actor text,p_event text,
 p_links jsonb default '[]',p_jobs jsonb default '[]',p_pdf text default null,p_sha text default null,p_access uuid default null,p_session text default null,p_details jsonb default '{}'
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; replay boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 replay=exists(select 1 from public.visit_minutes_operations where record_id=p_id and operation_id=p_operation);
 if p_event='modality' and exists(select 1 from public.visit_minutes_mail_jobs where record_id=p_id and version=(p_state->>'version')::integer and person_id=(p_details->>'personId')::uuid and status in ('sending','uncertain')) then raise exception 'Hay un envío en curso. Comprueba su resultado antes de cambiar la modalidad.'; end if;
 result=public.visit_minutes_commit_before_mixed(p_id,p_owner,p_obra,p_expected,p_state,p_operation,p_hash,p_actor,p_event,p_links,p_jobs,p_pdf,p_sha,p_access,p_session,p_details);
 if p_event='modality' and not replay then
   update public.visit_minutes_access set revoked=true,session_hash=null,otp_hash=null where record_id=p_id and version=(result->>'version')::integer and person_id=(p_details->>'personId')::uuid;
   update public.visit_minutes_mail_jobs set status='cancelled',updated_at=now() where record_id=p_id and version=(result->>'version')::integer and person_id=(p_details->>'personId')::uuid and kind<>'final' and status in ('pending','failed');
 end if;
 return result;
end $$;
revoke all on function public.visit_minutes_commit(uuid,uuid,uuid,integer,jsonb,uuid,text,text,text,jsonb,jsonb,text,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.visit_minutes_commit(uuid,uuid,uuid,integer,jsonb,uuid,text,text,text,jsonb,jsonb,text,text,uuid,text,jsonb) to service_role;
create function public.visit_minutes_reminder(p_id uuid,p_expected integer,p_person uuid,p_kind text,p_operation uuid,p_actor uuid,p_token_hash text,p_token_encrypted text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.visit_minutes; j public.visit_minutes_mail_jobs;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into r from public.visit_minutes where id=p_id for update;
 if r.owner_id is distinct from p_actor or not public.visit_minutes_owner_can_write(p_actor,r.obra_id) then raise exception 'Sin permisos'; end if;
 select * into j from public.visit_minutes_mail_jobs where id=p_operation;
 if j.id is not null then
   if j.record_id<>p_id or j.person_id<>p_person or j.version<>r.version or j.kind<>p_kind then raise exception 'Operación reutilizada';end if;
   return to_jsonb(j);
 end if;
 if r.revision<>p_expected then raise exception 'Revisión desactualizada';end if;
 if p_kind not in ('review','signing') or r.status not in ('review','changes','rejected','signing') then raise exception 'Acta no autorizada';end if;
 if exists(select 1 from public.visit_minutes_mail_jobs where record_id=p_id and version=r.version and person_id=p_person and kind=p_kind and (status in ('pending','failed','sending','uncertain') or notification_key is not null and updated_at>now()-interval '24 hours')) then raise exception 'Hay un envío en curso. Comprueba el resultado o espera 24 horas antes de otro recordatorio.';end if;
 if not (p_kind='review' and coalesce(r.state#>>'{content,workflow}','')='3.1') then
 insert into public.visit_minutes_access(id,record_id,version,person_id,token_hash,token_encrypted,expires_at) values(gen_random_uuid(),p_id,r.version,p_person,p_token_hash,p_token_encrypted,now()+interval '7 days')
 on conflict(record_id,version,person_id) do update set token_hash=excluded.token_hash,token_encrypted=excluded.token_encrypted,expires_at=excluded.expires_at,revoked=false,session_hash=null,otp_hash=null,requests=0,attempts=0;
 end if;
 insert into public.visit_minutes_mail_jobs(id,record_id,version,person_id,kind,notification_key) values(p_operation,p_id,r.version,p_person,p_kind,p_operation) returning * into j;
 insert into public.visit_minutes_events(record_id,version,actor,event,details) values(p_id,r.version,p_actor::text,'reminder-queued',jsonb_build_object('personId',p_person,'kind',p_kind,'jobId',p_operation));
 return to_jsonb(j);
end $$;
revoke all on function public.visit_minutes_reminder(uuid,integer,uuid,text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.visit_minutes_reminder(uuid,integer,uuid,text,uuid,uuid,text,text) to service_role;
commit;
