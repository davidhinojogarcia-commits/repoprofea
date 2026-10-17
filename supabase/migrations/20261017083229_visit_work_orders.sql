-- Additive work-order register. No historical signed state or PDF is rewritten.
create table public.visit_order_authorities (
 obra_id uuid not null references public.obras(id),person_id uuid not null, user_id uuid references public.profiles(id),
 data jsonb not null,scopes text[] not null,can_verify boolean not null default false,active boolean not null default true,
 primary key(obra_id,person_id),check(scopes <@ array['technical','preventive','recommendation']::text[]),check(cardinality(scopes)>0)
);
create table public.visit_order_authority_events (
 id bigint generated always as identity primary key,obra_id uuid not null references public.obras(id),person_id uuid not null,
 actor uuid not null references public.profiles(id),at timestamptz not null default now(),data jsonb not null
);
create table public.visit_work_orders (
 id uuid primary key,owner_id uuid not null references public.profiles(id),obra_id uuid not null references public.obras(id),
 origin_record_id uuid not null references public.visit_minutes(id),origin_number text not null,origin_version integer not null,
 number integer not null,definition jsonb not null,original_definition jsonb not null,
 status text not null default 'communicated' check(status in ('pending_communication','communicated','pending_execution','in_progress','executed_pending_verification','verified','breached','cancelled','superseded')),
 revision integer not null default 1,executed_at timestamptz,verified_at timestamptz,verified_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(origin_record_id,number),check(number>0)
);
create index visit_work_orders_work_pending on public.visit_work_orders(obra_id,status,updated_at desc,id);
create index visit_work_orders_owner_work on public.visit_work_orders(owner_id,obra_id,updated_at desc,id);
create table public.visit_order_definitions (
 order_id uuid not null references public.visit_work_orders(id),version integer not null,definition jsonb not null,
 reason text not null default '',at timestamptz not null default now(),primary key(order_id,version)
);
create table public.visit_order_events (
 id bigint generated always as identity primary key,order_id uuid not null references public.visit_work_orders(id),revision integer not null,
 actor_type text not null,actor_id uuid not null,event text not null,from_status text,to_status text,note text not null default '',
 details jsonb not null default '{}',at timestamptz not null default now()
);
create index visit_order_events_order_id on public.visit_order_events(order_id,id desc);
create table public.visit_order_evidence (
 id uuid primary key,order_id uuid not null references public.visit_work_orders(id),name text not null,mime text not null,
 base64 text not null,sha256 text not null,caption text not null default '',access_rules jsonb not null default '{}',actor_id uuid not null,at timestamptz not null default now(),
 check(mime in ('image/png','image/jpeg','application/pdf')),check(length(base64)<=2000000),check(sha256~'^[a-f0-9]{64}$')
);
create index visit_order_evidence_order on public.visit_order_evidence(order_id,at);
create table public.visit_order_operations (
 order_id uuid not null references public.visit_work_orders(id),operation_id uuid not null,request_hash text not null,primary key(order_id,operation_id)
);
create table public.visit_signed_publications (
 record_id uuid not null,version integer not null,owner_id uuid not null references public.profiles(id),obra_id uuid not null references public.obras(id),
 number text not null,visit_date date not null,sha256 text not null,access_rules jsonb not null default '[]',published_at timestamptz not null default now(),
 primary key(record_id,version),foreign key(record_id,version) references public.visit_minutes_files(record_id,version)
);
create index visit_signed_publications_work on public.visit_signed_publications(owner_id,obra_id,visit_date desc,record_id);
create table public.visit_signed_reads (
 record_id uuid not null,version integer not null,access_id uuid not null references public.foreman_portal_access(id),at timestamptz not null default now(),
 primary key(record_id,version,access_id),foreign key(record_id,version) references public.visit_signed_publications(record_id,version)
);
-- Data API callers never mutate or enumerate these private application records.
do $$declare t text;begin
 foreach t in array array['visit_order_authorities','visit_order_authority_events','visit_work_orders','visit_order_definitions','visit_order_events','visit_order_evidence','visit_order_operations','visit_signed_publications','visit_signed_reads'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.visit_order_authority_events_id_seq,public.visit_order_events_id_seq to service_role;

create function public.visit_order_save_authority(p_actor uuid,p_work uuid,p_person uuid,p_user uuid,p_data jsonb,p_scopes text[],p_verify boolean,p_active boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.visit_order_authorities;
begin
 if not exists(select 1 from public.profiles p join public.obras o on o.id=p_work where p.id=p_actor and p.active and (o.owner_id=p_actor or p.role='admin')) then raise exception 'Solo el responsable de la obra puede autorizar competencias';end if;
 if coalesce(length(btrim(p_data->>'justification')),0)<5 or coalesce(length(btrim(p_data->>'name')),0)=0 or coalesce(length(btrim(p_data->>'role')),0)=0 then raise exception 'Justifica la competencia e identifica a la persona';end if;
 if p_verify and (p_user is null or not public.visit_minutes_owner_can_write(p_user,p_work)) then raise exception 'La verificación requiere un usuario con permiso de escritura de obra';end if;
 if p_user is not null and not exists(select 1 from public.profiles where id=p_user and active) then raise exception 'Usuario de competencia inválido';end if;
 insert into public.visit_order_authorities(obra_id,person_id,user_id,data,scopes,can_verify,active) values(p_work,p_person,p_user,p_data,p_scopes,p_verify,p_active)
 on conflict(obra_id,person_id) do update set user_id=excluded.user_id,data=excluded.data,scopes=excluded.scopes,can_verify=excluded.can_verify,active=excluded.active returning * into result;
 insert into public.visit_order_authority_events(obra_id,person_id,actor,data) values(p_work,p_person,p_actor,jsonb_build_object('userId',p_user,'scopes',p_scopes,'canVerify',p_verify,'active',p_active,'declaration',p_data));
 return to_jsonb(result);
end $$;

-- Keep the established transactional commit and add publication atomically.
alter function public.visit_minutes_commit(uuid,uuid,uuid,integer,jsonb,uuid,text,text,text,jsonb,jsonb,text,text,uuid,text,jsonb) rename to visit_minutes_commit_without_orders;
create function public.visit_minutes_commit(
 p_id uuid,p_owner uuid,p_obra uuid,p_expected integer,p_state jsonb,p_operation uuid,p_hash text,p_actor text,p_event text,
 p_links jsonb default '[]',p_jobs jsonb default '[]',p_pdf text default null,p_sha text default null,p_access uuid default null,p_session text default null,p_details jsonb default '{}'
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; prior public.visit_minutes; o jsonb; existing public.visit_work_orders; a public.visit_order_authorities; changed boolean; prior_order_status text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into prior from public.visit_minutes where id=p_id;
 result=public.visit_minutes_commit_without_orders(p_id,p_owner,p_obra,p_expected,p_state,p_operation,p_hash,p_actor,p_event,p_links,p_jobs,p_pdf,p_sha,p_access,p_session,p_details);
 if exists(select 1 from jsonb_array_elements(coalesce(p_state#>'{content,orderReferences}','[]')) ref where not exists(select 1 from public.visit_work_orders wo where wo.id=(ref->>'id')::uuid and wo.obra_id=p_obra)) then raise exception 'Referencia de otra obra';end if;
 if p_state->>'status'='signed' and (prior.status is distinct from 'signed' or prior.version<>(p_state->>'version')::int) then
   if p_pdf is null then raise exception 'Publicación sin PDF firmado';end if;
   if exists(select 1 from public.visit_work_orders old_order where old_order.origin_record_id=p_id and not exists(select 1 from jsonb_array_elements(coalesce(p_state#>'{content,orders}','[]')) x where x->>'id'=old_order.id::text)) then raise exception 'Una orden emitida no se elimina de una nueva versión; conserva la orden y justifica su seguimiento';end if;
   for o in select * from jsonb_array_elements(coalesce(p_state#>'{content,orders}','[]')) loop
     select * into a from public.visit_order_authorities where obra_id=p_obra and person_id=(o->>'issuerId')::uuid and active and (o->>'nature')=any(scopes);
     if a.person_id is null or a.data->>'name' is distinct from o->>'issuerName' or a.data->>'role' is distinct from o->>'issuerRole' or a.data->>'entity' is distinct from o->>'issuerEntity' then raise exception 'Emisor sin competencia expresa vigente';end if;
     if coalesce(length(btrim(o->>'description')),0)=0 then raise exception 'Orden vacía';end if;
     if exists(select 1 from jsonb_array_elements_text(coalesce(o->'foremanAccessIds','[]')) f where not exists(select 1 from public.foreman_portal_access fa join public.obras w on w.id=p_obra where fa.id=f::uuid and fa.owner_id=w.owner_id and lower(btrim(fa.obra))=lower(btrim(w.nombre)) and fa.active)) then raise exception 'Destinatario de portal ajeno a la obra';end if;
     select * into existing from public.visit_work_orders where id=(o->>'id')::uuid for update;
     changed=existing.id is not null and existing.definition is distinct from o;
     if existing.id is not null and (existing.origin_record_id<>p_id or existing.owner_id<>(select owner_id from public.obras where id=p_obra) or existing.obra_id<>p_obra or existing.number<>(o->>'number')::int) then raise exception 'Orden de otra acta, propietario u obra';end if;
     if changed and (existing.status in ('verified','cancelled','superseded') or coalesce(length(btrim(o->>'correctionReason')),0)<5) then raise exception 'La corrección de una orden emitida requiere justificación y no puede alterar una orden cerrada';end if;
     if existing.id is null then
       insert into public.visit_work_orders(id,owner_id,obra_id,origin_record_id,origin_number,origin_version,number,definition,original_definition)
       values((o->>'id')::uuid,(select owner_id from public.obras where id=p_obra),p_obra,p_id,result->>'number',(p_state->>'version')::int,(o->>'number')::int,o,o) returning * into existing;
       insert into public.visit_order_events(order_id,revision,actor_type,actor_id,event,from_status,to_status,note) values(existing.id,1,'supervisor',p_owner,'published','pending_communication','communicated','Disponible en el portal según destinatarios autorizados; la publicación no implica lectura ni aceptación');
       update public.visit_order_events set details=jsonb_build_object('visibility',o->>'visibility','accessIds',o->'foremanAccessIds') where order_id=existing.id and revision=1;
     elsif changed then
       prior_order_status=existing.status;
       update public.visit_work_orders set definition=o,origin_version=(p_state->>'version')::int,revision=revision+1,status='pending_execution',updated_at=now() where id=existing.id returning * into existing;
       insert into public.visit_order_events(order_id,revision,actor_type,actor_id,event,from_status,to_status,note) values(existing.id,existing.revision,'supervisor',p_owner,'definition_revised',prior_order_status,'pending_execution',o->>'correctionReason');
       update public.visit_order_events set details=jsonb_build_object('visibility',o->>'visibility','accessIds',o->'foremanAccessIds') where order_id=existing.id and revision=existing.revision;
     end if;
     insert into public.visit_order_definitions(order_id,version,definition,reason) values(existing.id,(p_state->>'version')::int,o,coalesce(o->>'correctionReason',''));
   end loop;
   insert into public.visit_signed_publications(record_id,version,owner_id,obra_id,number,visit_date,sha256,access_rules)
   values(p_id,(p_state->>'version')::int,(select owner_id from public.obras where id=p_obra),p_obra,result->>'number',(p_state#>>'{content,date}')::date,p_sha,
     coalesce((select jsonb_agg(jsonb_build_object('orderId',v->>'id','visibility',v->>'visibility','accessIds',v->'foremanAccessIds')) from jsonb_array_elements(coalesce(p_state#>'{content,orders}','[]')||coalesce(p_state#>'{content,orderReferences}','[]')) v),'[]'));
 end if;
 return result;
end $$;

create function public.visit_order_transition(p_id uuid,p_expected integer,p_operation uuid,p_hash text,p_actor_type text,p_actor_id uuid,p_status text,p_note text,p_evidence jsonb default '[]',p_replacement uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.visit_work_orders; old_status text; e jsonb; can_verify boolean; access public.foreman_portal_access; ids jsonb='[]';
begin
 select * into r from public.visit_work_orders where id=p_id for update;
 if r.id is null then raise exception 'Orden no disponible';end if;
 if p_actor_type='foreman' then
   select * into access from public.foreman_portal_access where id=p_actor_id and active;
   if r.status='pending_communication' or access.id is null or access.owner_id<>r.owner_id or not exists(select 1 from public.obras w where w.id=r.obra_id and lower(btrim(w.nombre))=lower(btrim(access.obra)))
     or (r.definition->>'visibility'='restricted' and not coalesce(r.definition->'foremanAccessIds','[]') ? p_actor_id::text) or r.definition->>'foremanCanReport' is distinct from 'true' then raise exception 'Encargado sin autorización para esta orden';end if;
   if p_status is not null and p_status not in ('pending_execution','in_progress','executed_pending_verification') then raise exception 'El encargado no puede verificar ni anular';end if;
 else
   if p_actor_type<>'supervisor' or not public.visit_minutes_owner_can_write(p_actor_id,r.obra_id) then raise exception 'Sin permiso de escritura de obra';end if;
   select exists(select 1 from public.visit_order_authorities a where a.obra_id=r.obra_id and a.user_id=p_actor_id and a.active and a.can_verify and (r.definition->>'nature')=any(a.scopes)) into can_verify;
   if p_status in ('verified','cancelled','superseded','breached') and not can_verify then raise exception 'Sin competencia expresa para comprobar o anular';end if;
 end if;
 if exists(select 1 from public.visit_order_operations where order_id=p_id and operation_id=p_operation) then
   if not exists(select 1 from public.visit_order_operations where order_id=p_id and operation_id=p_operation and request_hash=p_hash) then raise exception 'Operación reutilizada';end if;
   return to_jsonb(r);
 end if;
 if r.revision<>p_expected then raise exception 'Revisión desactualizada';end if;
 if r.status in ('verified','cancelled','superseded') then raise exception 'Orden cerrada; no se sobrescribe su historial';end if;
 if p_status=r.status then raise exception 'Sin cambio de estado';end if;
 if p_status='verified' and r.status<>'executed_pending_verification' then raise exception 'Debe declararse ejecutada antes de verificar';end if;
 if p_status in ('verified','cancelled','superseded','breached') and coalesce(length(btrim(p_note)),0)<5 then raise exception 'Justificación obligatoria';end if;
 if p_status='superseded' and not exists(select 1 from public.visit_work_orders w where w.id=p_replacement and w.obra_id=r.obra_id and w.id<>r.id) then raise exception 'Orden sustituta inválida';end if;
 if p_status is null and coalesce(length(btrim(p_note)),0)=0 and jsonb_array_length(p_evidence)=0 then raise exception 'Avance vacío';end if;
 if jsonb_array_length(p_evidence)>8 or octet_length(p_evidence::text)>2000000 then raise exception 'Evidencia demasiado grande';end if;
 if (select coalesce(sum(length(base64)),0) from public.visit_order_evidence where order_id=p_id)+octet_length(p_evidence::text)>30000000 then raise exception 'Límite de evidencias de la orden alcanzado';end if;
 for e in select * from jsonb_array_elements(p_evidence) loop
   insert into public.visit_order_evidence(id,order_id,name,mime,base64,sha256,caption,access_rules,actor_id) values((e->>'id')::uuid,p_id,e->>'name',e->>'mime',e->>'base64',e->>'sha256',coalesce(e->>'caption',''),jsonb_build_object('visibility',r.definition->>'visibility','accessIds',r.definition->'foremanAccessIds'),p_actor_id);
   ids=ids||jsonb_build_array(e->>'id');
 end loop;
 old_status=r.status;
 update public.visit_work_orders set status=coalesce(p_status,status),revision=revision+1,updated_at=now(),
 executed_at=case when p_status='executed_pending_verification' then now() else executed_at end,
 verified_at=case when p_status='verified' then now() else verified_at end,verified_by=case when p_status='verified' then p_actor_id else verified_by end
 where id=p_id returning * into r;
 insert into public.visit_order_operations values(p_id,p_operation,p_hash);
 insert into public.visit_order_events(order_id,revision,actor_type,actor_id,event,from_status,to_status,note,details)
 values(p_id,r.revision,p_actor_type,p_actor_id,case when p_status is null then 'progress' else 'transition' end,old_status,r.status,coalesce(p_note,''),jsonb_build_object('evidenceIds',ids,'replacementOrderId',p_replacement,'visibility',r.definition->>'visibility','accessIds',r.definition->'foremanAccessIds'));
 return to_jsonb(r);
end $$;

create function public.visit_signed_acknowledge(p_record uuid,p_version integer,p_access uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.foreman_portal_access;p public.visit_signed_publications;stamp timestamptz;
begin
 select * into a from public.foreman_portal_access where id=p_access and active;
 select * into p from public.visit_signed_publications where record_id=p_record and version=p_version;
 if a.id is null or p.record_id is null or a.owner_id<>p.owner_id or not exists(select 1 from public.obras w where w.id=p.obra_id and lower(btrim(w.nombre))=lower(btrim(a.obra)))
 or exists(select 1 from jsonb_array_elements(p.access_rules) rule where rule->>'visibility'='restricted' and not coalesce(rule->'accessIds','[]') ? p_access::text) or exists(select 1 from jsonb_array_elements(p.access_rules) rule join public.visit_work_orders wo on wo.id=(rule->>'orderId')::uuid where wo.definition->>'visibility'='restricted' and not (coalesce(wo.definition->'foremanAccessIds','[]') ? p_access::text)) then raise exception 'Acta no autorizada';end if;
 insert into public.visit_signed_reads values(p_record,p_version,p_access,now()) on conflict do nothing;
 select at into stamp from public.visit_signed_reads where record_id=p_record and version=p_version and access_id=p_access;
 return jsonb_build_object('readAt',stamp,'meaning','Lectura confirmada; no es aceptación de órdenes ni verificación de cumplimiento');
end $$;

-- Publish existing final files without touching their immutable bytes or state.
insert into public.visit_signed_publications(record_id,version,owner_id,obra_id,number,visit_date,sha256)
select f.record_id,f.version,m.owner_id,m.obra_id,m.number,m.visit_date,f.sha256 from public.visit_minutes_files f join public.visit_minutes m on m.id=f.record_id;
revoke all on function public.visit_order_save_authority(uuid,uuid,uuid,uuid,jsonb,text[],boolean,boolean),public.visit_minutes_commit(uuid,uuid,uuid,integer,jsonb,uuid,text,text,text,jsonb,jsonb,text,text,uuid,text,jsonb),public.visit_order_transition(uuid,integer,uuid,text,text,uuid,text,text,jsonb,uuid),public.visit_signed_acknowledge(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.visit_order_save_authority(uuid,uuid,uuid,uuid,jsonb,text[],boolean,boolean),public.visit_minutes_commit(uuid,uuid,uuid,integer,jsonb,uuid,text,text,text,jsonb,jsonb,text,text,uuid,text,jsonb),public.visit_order_transition(uuid,integer,uuid,text,text,uuid,text,text,jsonb,uuid),public.visit_signed_acknowledge(uuid,integer,uuid) to service_role;
notify pgrst,'reload schema';

-- Minimal list of accounts that can act on this worksite, for explicit verifier grants.
create function public.visit_order_work_users(p_work uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'email',p.email)),'[]') from public.profiles p
 where p.active and public.visit_minutes_owner_can_write(p.id,p_work);
$$;
revoke all on function public.visit_order_work_users(uuid) from public,anon,authenticated;
grant execute on function public.visit_order_work_users(uuid) to service_role;
