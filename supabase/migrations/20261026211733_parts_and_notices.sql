-- Additive, private module. Only the authenticated application server writes.
create table public.parts_records (
 id uuid primary key, owner_id uuid not null references public.profiles(id),
 worker_id bigint not null, worksite_id uuid not null references public.obras(id), work text not null, access_id uuid not null references public.foreman_portal_access(id),
 number bigint generated always as identity unique, revision integer not null check(revision>0),
 version integer not null check(version>0), kind text not null check(kind in('service','incident')),
 status text not null check(status in('draft','submitted','review','returned','archived','dismissed','authorized','pending_delivery','communicated','unproven_delivery','closed','elevated','annulled')),
 state jsonb not null check(jsonb_typeof(state)='object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(owner_id,worker_id) references public.trabajadores(owner_id,id)
);
create index parts_owner_date on public.parts_records(owner_id,updated_at desc,id);
create index parts_access_date on public.parts_records(access_id,updated_at desc,id);
create index parts_worker_history on public.parts_records(owner_id,worker_id,created_at desc,id);
create table public.parts_events (
 record_id uuid not null references public.parts_records(id), revision integer not null,
 operation_id uuid not null, fingerprint text not null check(length(fingerprint)=64),
 actor_id text not null, action text not null, snapshot jsonb not null, created_at timestamptz not null default now(),
 primary key(record_id,revision),unique(record_id,operation_id)
);
create table public.parts_assets (
 id uuid primary key,record_id uuid not null references public.parts_records(id), revision integer not null,
 purpose text not null check(purpose in('attachment','signature','pdf')),name text not null,
 mime text not null check(mime in('image/png','image/jpeg','application/pdf')),
 sha256 text not null check(length(sha256)=64), bytes integer not null check(bytes between 1 and 5000000),
 base64 text not null,created_at timestamptz not null default now(),
 unique(record_id,revision,purpose,sha256)
);
create index parts_assets_record on public.parts_assets(record_id,revision);
create table public.parts_policies (
 owner_id uuid not null references public.profiles(id),worksite_id uuid not null references public.obras(id),revision integer not null default 1,
 policy jsonb not null,updated_at timestamptz not null default now(),audit jsonb not null default '[]',primary key(owner_id,worksite_id)
);
create table public.parts_notifications (
 id uuid primary key default gen_random_uuid(),record_id uuid not null references public.parts_records(id),
 owner_id uuid not null references public.profiles(id),revision integer not null,recipient text not null check(recipient in('supervisor','foreman')),
 message text not null,created_at timestamptz not null default now(),read_at timestamptz,
 unique(record_id,revision,recipient)
);
create index parts_notification_recipient on public.parts_notifications(owner_id,recipient,created_at desc);
-- No browser writes, including state, signature, asset, PDF, and audit mutations.
alter table public.parts_records enable row level security;
alter table public.parts_events enable row level security;
alter table public.parts_assets enable row level security;
alter table public.parts_policies enable row level security;
alter table public.parts_notifications enable row level security;
revoke all on public.parts_records,public.parts_events,public.parts_assets,public.parts_policies,public.parts_notifications from anon,authenticated;
grant all on public.parts_records,public.parts_events,public.parts_assets,public.parts_policies,public.parts_notifications to service_role;
grant usage,select on sequence public.parts_records_number_seq to service_role;
grant select on public.parts_records,public.parts_policies,public.parts_notifications to authenticated;
create policy parts_owner_read on public.parts_records for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true and p.role in('admin','user')));
create policy parts_policy_read on public.parts_policies for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true));
create policy parts_notification_read on public.parts_notifications for select to authenticated using(owner_id=(select auth.uid()) and recipient='supervisor' and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true));

create function public.parts_commit(p_id uuid,p_owner uuid,p_worker bigint,p_work text,p_access uuid,p_access_hash text,
 p_actor uuid,p_expected integer,p_operation uuid,p_fingerprint text,p_action text,p_state jsonb,p_assets jsonb default '[]') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare prior public.parts_records; event public.parts_events; a public.foreman_portal_access; asset jsonb; result jsonb; seq bigint; reference jsonb; source public.parts_records; policy public.parts_policies;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,71026));
 if not exists(select 1 from public.profiles where id=p_owner and active=true and role in('admin','user')) then raise exception 'Cuenta no autorizada' using errcode='42501';end if;
 select * into a from public.foreman_portal_access where id=p_access and owner_id=p_owner and obra=p_work;
 if a.id is null or (p_actor is null and (not a.active or a.token_hash is distinct from p_access_hash)) or(p_actor is not null and p_actor<>p_owner) then raise exception 'Ámbito no autorizado' using errcode='42501';end if;
 select * into prior from public.parts_records where id=p_id for update;
 if prior.id is not null and (prior.owner_id<>p_owner or prior.worker_id<>p_worker or prior.work<>p_work or prior.access_id<>p_access) then raise exception 'Registro no autorizado' using errcode='42501';end if;
 select * into event from public.parts_events where record_id=p_id and operation_id=p_operation;
 if found then
  if event.fingerprint<>p_fingerprint then raise exception 'Identificador de operación reutilizado' using errcode='PT409';end if;
  return jsonb_build_object('state',event.snapshot,'replayed',true);
 end if;
 if coalesce(prior.revision,0)<>p_expected or (p_state->>'revision')::int<>p_expected+1 then raise exception 'La versión ha cambiado. Actualice antes de reintentar.' using errcode='PT409';end if;
 if p_state->>'id' is distinct from p_id::text or p_state->>'ownerId' is distinct from p_owner::text or (p_state->>'workerId')::bigint is distinct from p_worker or p_state->>'work' is distinct from p_work or p_state->>'foremanAccessId' is distinct from p_access::text or coalesce(p_state->>'contentHash','') !~ '^[a-f0-9]{64}$' then raise exception 'Identidad de la versión no válida' using errcode='42501';end if;
 if p_action in('compare','elevate') then
  if p_actor is null then raise exception 'Revisión no autorizada' using errcode='42501';end if;
  if jsonb_array_length(coalesce(p_state->'comparison','[]'))<>jsonb_array_length(coalesce(p_state->'comparableIds','[]')) then raise exception 'Revise las versiones de los antecedentes' using errcode='PT409';end if;
  select * into policy from public.parts_policies where owner_id=p_owner and worksite_id=(p_state#>>'{worksite,id}')::uuid;
  for reference in select value from jsonb_array_elements(coalesce(p_state->'comparison','[]')) loop
   select * into source from public.parts_records where id=(reference->>'id')::uuid and owner_id=p_owner and worker_id=p_worker and worksite_id=(p_state#>>'{worksite,id}')::uuid;
   if policy.owner_id is null or source.id is null or source.revision<>(reference->>'revision')::int or source.status not in('communicated','closed','elevated') or source.state->>'blockedAt' is not null or source.state#>>'{content,reason}' is distinct from p_state#>>'{content,reason}' or source.state#>'{receipt,signature}' is null or(source.state#>>'{receipt,mode}'='disagreement' and source.state->'receiptReview' is null) or(source.state#>>'{content,occurredAt}')::timestamptz<clock_timestamp()-((policy.policy->>'windowDays')::int*interval '1 day') then
    raise exception 'Los antecedentes han cambiado o ya no computan. Revise la comparación.' using errcode='PT409';
   end if;
  end loop;
 end if;
 if not exists(select 1 from public.obras o where o.id=(p_state#>>'{worksite,id}')::uuid and o.owner_id=p_owner) then raise exception 'Obra no autorizada' using errcode='42501';end if;
 if not exists(select 1 from public.trabajadores t where t.owner_id=p_owner and t.id=p_worker and ((prior.id is not null and p_action not in('edit','submit')) or lower(btrim(t.obra))=lower(btrim(p_work)))) then raise exception 'Trabajador fuera del ámbito' using errcode='42501';end if;
 if p_action='submit' and not exists(select 1 from public.trabajadores t where t.owner_id=p_owner and t.id=p_worker
  and t.periodo_inicio::text=p_state#>>'{worker,periodStart}' and t.periodo_fin::text=p_state#>>'{worker,periodEnd}'
  and ((p_state#>>'{content,occurredAt}')::timestamptz at time zone 'Europe/Madrid')::date between t.periodo_inicio::date and t.periodo_fin::date)
 then raise exception 'La contratación ha cambiado. Revise el borrador antes de firmar.' using errcode='PT409';end if;
 if prior.id is null then
  insert into public.parts_records(id,owner_id,worker_id,worksite_id,work,access_id,revision,version,kind,status,state)
   values(p_id,p_owner,p_worker,(p_state#>>'{worksite,id}')::uuid,p_work,p_access,p_expected+1,(p_state->>'version')::int,p_state->>'kind',p_state->>'status',p_state) returning number into seq;
 else seq:=prior.number;end if;
 result:=p_state||jsonb_build_object('number','PA-'||seq::text,'updatedAt',clock_timestamp());
 if jsonb_array_length(p_assets)>5 then raise exception 'Demasiados archivos';end if;
 for asset in select value from jsonb_array_elements(p_assets) loop
  if encode(extensions.digest(decode(asset->>'base64','base64'),'sha256'),'hex')<>asset->>'sha256' or octet_length(decode(asset->>'base64','base64'))<>(asset->>'bytes')::int then raise exception 'Integridad de archivo no válida';end if;
  insert into public.parts_assets(id,record_id,revision,purpose,name,mime,sha256,bytes,base64) values((asset->>'id')::uuid,p_id,p_expected+1,asset->>'purpose',asset->>'name',asset->>'mime',asset->>'sha256',(asset->>'bytes')::int,asset->>'base64');
 end loop;
 update public.parts_records set state=result,revision=p_expected+1,version=(result->>'version')::int,kind=result->>'kind',status=result->>'status',updated_at=clock_timestamp() where id=p_id;
 insert into public.parts_events(record_id,revision,operation_id,fingerprint,actor_id,action,snapshot) values(p_id,p_expected+1,p_operation,p_fingerprint,coalesce(p_actor::text,p_access::text),p_action,result);
 if p_action not in('create','edit','review','compare') then
  insert into public.parts_notifications(record_id,owner_id,revision,recipient,message)
   values(p_id,p_owner,p_expected+1,case when p_actor is null then 'supervisor' else 'foreman' end,
    case when result#>>'{content,priority}'='urgent' then 'Incidencia urgente pendiente de revisión' when (p_action='submit' and result->>'kind'='incident') or(p_action='receipt' and result->>'status'='review') then 'Nuevo parte pendiente de revisión' else 'Actualización en Partes y avisos' end);
 end if;
 return jsonb_build_object('state',result,'replayed',false);
end $$;
revoke all on function public.parts_commit(uuid,uuid,bigint,text,uuid,text,uuid,integer,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.parts_commit(uuid,uuid,bigint,text,uuid,text,uuid,integer,uuid,text,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
create function public.parts_update_policy(p_owner uuid,p_worksite uuid,p_expected int,p_policy jsonb,p_actor jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare prior public.parts_policies;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,71026));
 if not exists(select 1 from public.profiles where id=p_owner and active=true and role in('admin','user')) or p_actor->>'id'<>p_owner::text then raise exception 'Cuenta no autorizada' using errcode='42501';end if;
 if not exists(select 1 from public.obras where id=p_worksite and owner_id=p_owner) then raise exception 'Obra no autorizada' using errcode='42501';end if;
 select * into prior from public.parts_policies where owner_id=p_owner and worksite_id=p_worksite for update;
 if coalesce(prior.revision,0)<>p_expected then raise exception 'La política ha cambiado' using errcode='PT409';end if;
 insert into public.parts_policies(owner_id,worksite_id,revision,policy,audit) values(p_owner,p_worksite,1,p_policy,jsonb_build_array(jsonb_build_object('at',clock_timestamp(),'actor',p_actor,'policy',p_policy)))
 on conflict(owner_id,worksite_id) do update set revision=parts_policies.revision+1,policy=excluded.policy,updated_at=clock_timestamp(),audit=parts_policies.audit||excluded.audit;
 return p_policy;
end $$;
revoke all on function public.parts_update_policy(uuid,uuid,int,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.parts_update_policy(uuid,uuid,int,jsonb,jsonb) to service_role;
create unique index parts_single_pdf_revision on public.parts_assets(record_id,revision) where purpose='pdf';
create function public.parts_summary(p_owner uuid,p_access uuid default null,p_worker bigint default null,p_work text default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('service',count(*) filter(where kind='service'),'review',count(*) filter(where status in('submitted','review')),'urgent',count(*) filter(where state#>>'{content,priority}'='urgent' and status not in('closed','archived','dismissed','annulled')),'returned',count(*) filter(where status='returned'),'delivery',count(*) filter(where status in('pending_delivery','authorized')),'communicated',count(*) filter(where status='communicated'),'elevated',count(*) filter(where status='elevated'),'closed',count(*) filter(where status='closed'))
 from public.parts_records where owner_id=p_owner and(p_access is null or access_id=p_access) and(p_worker is null or worker_id=p_worker) and(p_work is null or work=p_work)
$$;
revoke all on function public.parts_summary(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.parts_summary(uuid,uuid,bigint,text) to service_role;
create table public.parts_push_subscriptions (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(id),access_id uuid references public.foreman_portal_access(id),
 role text not null check(role in('supervisor','foreman')),access_hash text,endpoint text not null unique,keys jsonb not null,active boolean not null default true,created_at timestamptz not null default now(),
 check((role='supervisor' and access_id is null)or(role='foreman' and access_id is not null))
);
create index parts_push_scope on public.parts_push_subscriptions(owner_id,role,access_id) where active;
create table public.parts_push_deliveries (
 id uuid primary key default gen_random_uuid(),notification_id uuid not null references public.parts_notifications(id),subscription_id uuid not null references public.parts_push_subscriptions(id),
 status text not null default 'pending' check(status in('pending','sending','accepted','failed')),attempts int not null default 0,lease uuid,leased_at timestamptz,status_code int,updated_at timestamptz not null default now(),
 unique(notification_id,subscription_id)
);
create index parts_push_notification on public.parts_push_deliveries(notification_id);
alter table public.parts_push_subscriptions enable row level security;
alter table public.parts_push_deliveries enable row level security;
revoke all on public.parts_push_subscriptions,public.parts_push_deliveries from anon,authenticated;
grant all on public.parts_push_subscriptions,public.parts_push_deliveries to service_role;
create function public.parts_claim_push(p_id uuid,p_revision int) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,71027));
 insert into public.parts_push_deliveries(notification_id,subscription_id)
 select n.id,s.id from public.parts_notifications n join public.parts_records r on r.id=n.record_id
 join public.parts_push_subscriptions s on s.owner_id=n.owner_id and s.role=n.recipient and s.active
 join public.profiles p on p.id=n.owner_id and p.active
 left join public.foreman_portal_access a on a.id=s.access_id
 where n.record_id=p_id and n.revision=p_revision and (s.role='supervisor' or (s.access_id=r.access_id and a.active and a.token_hash=s.access_hash))
 on conflict(notification_id,subscription_id) do nothing;
 with claimed as (
 update public.parts_push_deliveries d set status='sending',attempts=attempts+1,lease=gen_random_uuid(),leased_at=clock_timestamp(),updated_at=clock_timestamp()
 from public.parts_notifications n where n.id=d.notification_id and n.record_id=p_id and n.revision=p_revision and d.attempts<3 and exists(select 1 from public.parts_push_subscriptions sx join public.profiles px on px.id=sx.owner_id and px.active left join public.foreman_portal_access ax on ax.id=sx.access_id where sx.id=d.subscription_id and sx.active and sx.owner_id=n.owner_id and sx.role=n.recipient and(sx.role='supervisor' or(ax.active and ax.token_hash=sx.access_hash and ax.id=(select access_id from public.parts_records where id=p_id)))) and (d.status in('pending','failed') or(d.status='sending' and d.leased_at<now()-interval '1 minute'))
 returning d.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'lease',c.lease,'endpoint',s.endpoint,'keys',s.keys,'message',n.message,'role',s.role)),'[]'::jsonb) into result
 from claimed c join public.parts_push_subscriptions s on s.id=c.subscription_id and s.active join public.parts_notifications n on n.id=c.notification_id;
 return result;
end $$;
revoke all on function public.parts_claim_push(uuid,int) from public,anon,authenticated;
grant execute on function public.parts_claim_push(uuid,int) to service_role;
create function public.parts_finish_push(p_id uuid,p_lease uuid,p_status int) returns boolean
language plpgsql security invoker set search_path='' as $$
declare subscription uuid;
begin
 update public.parts_push_deliveries set status=case when p_status between 200 and 299 then 'accepted' else 'failed' end,status_code=p_status,updated_at=clock_timestamp()
 where id=p_id and lease=p_lease and status='sending' returning subscription_id into subscription;
 if subscription is null then return false;end if;
 if p_status in(404,410) then update public.parts_push_subscriptions set active=false where id=subscription;end if;
 return true;
end $$;
revoke all on function public.parts_finish_push(uuid,uuid,int) from public,anon,authenticated;
grant execute on function public.parts_finish_push(uuid,uuid,int) to service_role;
-- One filtered realtime subscription per supervisor; no polling.
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='parts_notifications') then
  alter publication supabase_realtime add table public.parts_notifications;
 end if;
end $$;
create function public.parts_register_push(p_owner uuid,p_access uuid,p_role text,p_access_hash text,p_endpoint text,p_keys jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare existing public.parts_push_subscriptions; saved uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,71026));
 if p_role not in('supervisor','foreman') or not exists(select 1 from public.profiles where id=p_owner and active=true and role in('admin','user')) then raise exception 'Cuenta no autorizada' using errcode='42501';end if;
 if p_role='foreman' and not exists(select 1 from public.foreman_portal_access where id=p_access and owner_id=p_owner and active and token_hash=p_access_hash) then raise exception 'Acceso no autorizado' using errcode='42501';end if;
 select * into existing from public.parts_push_subscriptions where endpoint=p_endpoint for update;
 if found and (existing.owner_id<>p_owner or existing.role<>p_role or existing.access_id is distinct from p_access) then raise exception 'Dispositivo vinculado a otro acceso' using errcode='PT409';end if;
 if (existing.id is null or not existing.active) and(select count(*) from public.parts_push_subscriptions where owner_id=p_owner and role=p_role and access_id is not distinct from p_access and active)>=5 then raise exception 'Límite de dispositivos' using errcode='PT409';end if;
 insert into public.parts_push_subscriptions(owner_id,access_id,role,access_hash,endpoint,keys) values(p_owner,p_access,p_role,p_access_hash,p_endpoint,p_keys)
 on conflict(endpoint) do update set keys=excluded.keys,access_hash=excluded.access_hash,active=true returning id into saved;
 return saved;
end $$;
revoke all on function public.parts_register_push(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.parts_register_push(uuid,uuid,text,text,text,jsonb) to service_role;

-- Immutable evidence to the application role; a separately authorised legal procedure is required for deletion.
revoke update,delete on public.parts_events,public.parts_assets from service_role;
-- Proposed follow-up level, never a legal classification or sanction.
-- Window aggregation avoids a request per worker/row and expires old antecedents.
create function public.parts_list_repetition(p_owner uuid,p_filters jsonb,p_before jsonb default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 with source as(select r.*,(policy.policy->>'windowDays')::int days,coalesce((r.state#>>'{content,occurredAt}')::timestamptz,r.created_at) occurred_at,
  r.status in('communicated','closed','elevated') and r.state->>'blockedAt' is null and jsonb_typeof(r.state#>'{receipt,signature}')='object'
   and(r.state#>>'{receipt,mode}'<>'disagreement' or jsonb_typeof(r.state->'receiptReview')='object')
   and(r.state#>>'{content,occurredAt}')::timestamptz<=now()
   and(r.state#>>'{content,occurredAt}')::timestamptz>=now()-(policy.policy->>'windowDays')::int*interval '1 day' documented
  from public.parts_records r join public.parts_policies policy on policy.owner_id=r.owner_id and policy.worksite_id=r.worksite_id where r.owner_id=p_owner),
 ranked as(select *,coalesce(sum(case when documented then 1 else 0 end) over(partition by worker_id,worksite_id,state#>>'{content,reason}' order by occurred_at,created_at,id rows between unbounded preceding and 1 preceding),0) prior_count from source),
 page as(select r.id,r.number,r.kind,r.status,r.revision,r.version,r.work,r.worker_id,r.updated_at,r.state#>>'{worker,name}' worker_name,r.state#>>'{content,reason}' reason,r.state#>>'{content,priority}' priority,least(3,r.prior_count+1) reiteration_level,r.prior_count documented_antecedents
 from ranked r
 where r.occurred_at>=now()-r.days*interval '1 day' and r.status not in('archived','dismissed','annulled') and r.state->>'blockedAt' is null
 and least(3,r.prior_count+1)=(p_filters->>'repetition')::int
 and(coalesce(p_filters->>'work','')='' or r.work=p_filters->>'work')
 and(coalesce(p_filters->>'workerId','')='' or r.worker_id=nullif(p_filters->>'workerId','')::bigint)
 and(coalesce(p_filters->>'status','')='' or r.status=p_filters->>'status')
 and(coalesce(p_filters->>'kind','')='' or r.kind=p_filters->>'kind')
 and(coalesce(p_filters->>'reason','')='' or r.state#>>'{content,reason}'=p_filters->>'reason')
 and(coalesce(p_filters->>'priority','')='' or r.state#>>'{content,priority}'=p_filters->>'priority')
 and(coalesce(p_filters->>'fromInstant','')='' or r.occurred_at>=nullif(p_filters->>'fromInstant','')::timestamptz)
 and(coalesce(p_filters->>'untilInstant','')='' or r.occurred_at<nullif(p_filters->>'untilInstant','')::timestamptz)
 and(p_before is null or(r.updated_at,r.id)<((p_before->>'at')::timestamptz,(p_before->>'id')::uuid))
 order by r.updated_at desc,r.id desc limit 26)
 select coalesce(jsonb_agg(to_jsonb(page) order by updated_at desc,id desc),'[]'::jsonb) from page
$$;
revoke all on function public.parts_list_repetition(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.parts_list_repetition(uuid,jsonb,jsonb) to service_role;
