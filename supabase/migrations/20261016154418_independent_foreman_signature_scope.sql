-- Validate at the database boundary as well as in the editor.
create or replace function public.foreman_layout_valid(p jsonb) returns boolean
language plpgsql immutable set search_path=public as $$
begin
 return coalesce(jsonb_typeof(p)='object'
 and jsonb_typeof(p->'enabled')='boolean' and jsonb_typeof(p->'required')='boolean'
 and p->>'allPages'='true'
 and length(trim(p->>'templateKey')) between 3 and 120
 and (p->>'x')::numeric between 0 and 1 and (p->>'y')::numeric between 0 and 1
 and (p->>'width')::numeric>0 and (p->>'height')::numeric>0
 and (p->>'x')::numeric+(p->>'width')::numeric<=1
 and (p->>'y')::numeric+(p->>'height')::numeric<=1
 and (p->>'pageRatio')::numeric between 0.1 and 10
 and (p->>'revision')::integer>0,false);
exception when others then return false;
end $$;

create or replace function public.get_foreman_signature_template(p_document_id uuid,p_model_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.foreman_mandatory_documents%rowtype; t jsonb;
begin
 select * into d from public.foreman_mandatory_documents where id=p_document_id and owner_id=auth.uid();
 if not found then raise exception 'Documento no autorizado'; end if;
 if d.document_type in ('inicio','control_presencia','contrato','prorroga') then raise exception 'Este documento no admite firma del encargado'; end if;
 select layout into t from public.foreman_signature_templates where owner_id=d.owner_id and model_key=p_model_key;
 return case when d.details#>>'{foremanSignatureTemplate,templateKey}'=p_model_key then d.details->'foremanSignatureTemplate' else coalesce(t,'null'::jsonb) end;
end $$;

create or replace function public.save_foreman_signature_template(
 p_document_id uuid,p_model_key text,p_layout jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.foreman_mandatory_documents%rowtype;
begin
 select * into d from public.foreman_mandatory_documents where id=p_document_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Documento no autorizado'; end if;
 if d.document_type in ('inicio','control_presencia','contrato','prorroga') then raise exception 'Este documento no admite firma del encargado'; end if;
 if d.assigned_at is not null and d.lifecycle_status not in ('ANALYZED','READY','NEEDS_WORKER_REVIEW','NEEDS_SIGNATURE_POSITION_REVIEW','RETURNED_FOR_CORRECTION') then
   raise exception 'Retira el documento del portal antes de cambiar la plantilla'; end if;
 if d.status in ('completed','reviewed') and not coalesce(d.correction_pending,false) then raise exception 'Devuelve el documento para corrección'; end if;
 if not public.foreman_layout_valid(p_layout) then raise exception 'Plantilla no válida'; end if;
 if length(trim(coalesce(p_model_key,'')))<3 or length(p_model_key)>120 then raise exception 'Nombre del modelo no válido'; end if;
 if jsonb_typeof(p_layout)<>'object' or
    coalesce((p_layout->>'x')::numeric,-1)<0 or coalesce((p_layout->>'y')::numeric,-1)<0 or
    coalesce((p_layout->>'width')::numeric,0)<=0 or coalesce((p_layout->>'height')::numeric,0)<=0 or
    coalesce((p_layout->>'x')::numeric,2)+coalesce((p_layout->>'width')::numeric,2)>1 or
    coalesce((p_layout->>'y')::numeric,2)+coalesce((p_layout->>'height')::numeric,2)>1 or
    coalesce((p_layout->>'pageRatio')::numeric,0)<=0 then
      raise exception 'Las coordenadas de la firma no son válidas';
 end if;
 if coalesce(p_layout->>'templateKey','')<>p_model_key then raise exception 'El modelo no coincide'; end if;
 insert into public.foreman_signature_templates(owner_id,model_key,layout)
 values(d.owner_id,p_model_key,p_layout)
 on conflict(owner_id,model_key) do update set layout=excluded.layout,updated_at=now();
 update public.foreman_mandatory_documents
 set details=coalesce(details,'{}'::jsonb)||jsonb_build_object('foremanSignatureTemplate',p_layout),
 updated_at=now() where id=d.id;
 return jsonb_build_object('ok',true,'layout',p_layout);
end $$;

create or replace function public.sign_foreman_document_as_foreman(
 p_token text,p_document_id uuid,p_signature text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a public.foreman_portal_access%rowtype; d public.foreman_mandatory_documents%rowtype;
begin
 select * into a from public.foreman_portal_access
 where active and token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
 if not found then raise exception 'Acceso del encargado no válido'; end if;
 select * into d from public.foreman_mandatory_documents where id=p_document_id and owner_id=a.owner_id and lower(obra)=lower(a.obra) for update;
 if not found or d.document_type in ('inicio','control_presencia','contrato','prorroga') or
 (d.status in ('completed','reviewed') and not coalesce(d.correction_pending,false)) or
 (d.details->>'originalPdfMode'='overlay' and (d.assigned_at is null or d.lifecycle_status not in ('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION'))) then
   raise exception 'Documento no disponible para firmar'; end if;
 if d.details->'foremanSignatureTemplate' is null or coalesce((d.details#>>'{foremanSignatureTemplate,enabled}')::boolean,false)=false then
   raise exception 'El supervisor no ha habilitado la firma del encargado'; end if;
 if length(coalesce(p_signature,''))<100 or length(p_signature)>350000 or p_signature !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$'
 then raise exception 'Firma no válida o demasiado grande'; end if;
 if exists(select 1 from public.foreman_document_signatures where document_id=d.id and access_id=a.id and signature=p_signature) then
   return jsonb_build_object('ok',true,'unchanged',true);
 end if;
 insert into public.foreman_document_signatures(document_id,access_id,signature)
 values(d.id,a.id,p_signature)
 on conflict(document_id) do update set access_id=excluded.access_id,signature=excluded.signature,signed_at=now();
 update public.foreman_mandatory_documents set lifecycle_status='IN_SIGNATURE',updated_at=now() where id=d.id and lifecycle_status='ASSIGNED';
 return jsonb_build_object('ok',true,'signedAt',now());
end $$;

create or replace function public.get_foreman_document_signature(p_token text,p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a public.foreman_portal_access%rowtype; s public.foreman_document_signatures%rowtype;
begin
 select * into a from public.foreman_portal_access where active and token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
 if not found then raise exception 'Acceso no válido'; end if;
 if not exists(select 1 from public.foreman_mandatory_documents d
 where d.id=p_document_id and d.owner_id=a.owner_id and lower(d.obra)=lower(a.obra) and d.document_type not in ('inicio','control_presencia','contrato','prorroga')
 and (d.details->>'originalPdfMode' is distinct from 'overlay' or d.assigned_at is not null))
 then raise exception 'Documento no autorizado'; end if;
 select * into s from public.foreman_document_signatures where document_id=p_document_id;
 if not found then return jsonb_build_object('signed',false); end if;
 return jsonb_build_object('signed',true,'signature',s.signature,'signedAt',s.signed_at);
end $$;

revoke all on function public.get_foreman_signature_template(uuid,text),
 public.save_foreman_signature_template(uuid,text,jsonb),
 public.sign_foreman_document_as_foreman(text,uuid,text),
 public.get_foreman_document_signature(text,uuid) from public,anon;
grant execute on function public.get_foreman_signature_template(uuid,text),
 public.save_foreman_signature_template(uuid,text,jsonb) to authenticated;
grant execute on function public.sign_foreman_document_as_foreman(text,uuid,text),
 public.get_foreman_document_signature(text,uuid) to anon,authenticated;
notify pgrst,'reload schema';

-- Enforce required foreman ink at the database boundary, not only in the mobile UI.
create or replace function public.enforce_required_foreman_document_signature()
returns trigger language plpgsql security definer set search_path=public as $trigger_body$
begin
 if new.document_type not in ('inicio','control_presencia','contrato','prorroga') and coalesce((new.details#>>'{foremanSignatureTemplate,enabled}')::boolean,false)
    and coalesce((new.details#>>'{foremanSignatureTemplate,required}')::boolean,false)
    and (
      (new.lifecycle_status in ('SUBMITTED','RECEIVED','REVIEWED') and old.lifecycle_status is distinct from new.lifecycle_status)
      or (new.status in ('completed','reviewed') and old.status is distinct from new.status)
    )
    and not exists(select 1 from public.foreman_document_signatures f where f.document_id=new.id)
 then raise exception 'Falta la firma obligatoria del encargado. No se puede finalizar el documento';
 end if;
 return new;
end $trigger_body$;
drop trigger if exists foreman_required_signature_before_finalize on public.foreman_mandatory_documents;
create trigger foreman_required_signature_before_finalize
before update of lifecycle_status,status on public.foreman_mandatory_documents
for each row execute function public.enforce_required_foreman_document_signature();

-- A trigger also protects generic supervisor updates and stale clients. Historical
-- excluded PDFs/evidence are left intact; they no longer gate future completion.
create or replace function public.guard_foreman_layout_scope() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.details->'foremanSignatureTemplate' is distinct from old.details->'foremanSignatureTemplate' then
   if new.details#>>'{foremanSignatureTemplate,enabled}'='true' and
      new.document_type in ('inicio','control_presencia','contrato','prorroga') then
     raise exception 'Este documento no admite firma del encargado';
   end if;
   if new.details->'foremanSignatureTemplate' is not null and
      not public.foreman_layout_valid(new.details->'foremanSignatureTemplate') then
     raise exception 'Plantilla del encargado no válida';
   end if;
   if exists(select 1 from public.foreman_document_signatures where document_id=new.id) then
     delete from public.foreman_document_signatures where document_id=new.id;
   end if;
 end if;
 return new;
end $$;
drop trigger if exists guard_foreman_layout_scope on public.foreman_mandatory_documents;
create trigger guard_foreman_layout_scope before update of details on public.foreman_mandatory_documents
for each row execute function public.guard_foreman_layout_scope();

create or replace function public.audit_independent_foreman_signature() returns trigger
language plpgsql security definer set search_path=public as $$
declare d public.foreman_mandatory_documents%rowtype;
begin
 select * into d from public.foreman_mandatory_documents where id=new.document_id;
 insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,actor_name,metadata)
 select d.id,d.owner_id,'FOREMAN_SIGNED','encargado',a.foreman_name,
 jsonb_build_object('accessId',a.id,'signedAt',new.signed_at,'template',d.details->'foremanSignatureTemplate')
 from public.foreman_portal_access a where a.id=new.access_id;
 return new;
end $$;
drop trigger if exists audit_independent_foreman_signature on public.foreman_document_signatures;
create trigger audit_independent_foreman_signature after insert or update on public.foreman_document_signatures
for each row execute function public.audit_independent_foreman_signature();

alter table public.foreman_attendance_days add column if not exists foreman_signature_template jsonb;
alter table public.foreman_attendance_days add column if not exists foreman_signature_evidence jsonb;

create or replace function public.get_reusable_foreman_layout(p_model_key text) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Acceso no autorizado'; end if;
 return (select layout from public.foreman_signature_templates where owner_id=auth.uid() and model_key=p_model_key);
end $$;

create or replace function public.save_attendance_foreman_template(p_document_id uuid,p_layout jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare d public.foreman_attendance_days%rowtype;
begin
 select * into d from public.foreman_attendance_days where id=p_document_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Jornada no autorizada'; end if;
 if d.status in ('completed','reviewed') and not coalesce(d.correction_pending,false) then raise exception 'Devuelve la jornada para corrección antes de cambiar la firma'; end if;
 if not public.foreman_layout_valid(p_layout) or (p_layout->>'templateKey') not like 'control_horario:%' then raise exception 'Plantilla de control horario no válida'; end if;
 update public.foreman_attendance_days set foreman_signature_template=p_layout,
 updated_at=now() where id=d.id;
 insert into public.foreman_signature_templates(owner_id,model_key,layout) values(d.owner_id,p_layout->>'templateKey',p_layout)
 on conflict(owner_id,model_key) do update set layout=excluded.layout,updated_at=now();
 return jsonb_build_object('ok',true,'layout',p_layout);
end $$;

create or replace function public.get_attendance_foreman_evidence(p_token text,p_work_date date) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a public.foreman_portal_access%rowtype; d public.foreman_attendance_days%rowtype;
begin
 select * into a from public.foreman_portal_access where active and token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
 if not found then raise exception 'Acceso no válido'; end if;
 select * into d from public.foreman_attendance_days where owner_id=a.owner_id and lower(obra)=lower(a.obra) and work_date=p_work_date;
 return jsonb_build_object('layout',d.foreman_signature_template,'signed',coalesce(length(d.foreman_signature_evidence->>'signature')>0,false),'signedAt',d.foreman_signature_evidence->>'signedAt');
end $$;

create or replace function public.sign_attendance_as_foreman(p_token text,p_work_date date,p_signature text) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a public.foreman_portal_access%rowtype; d public.foreman_attendance_days%rowtype;
begin
 select * into a from public.foreman_portal_access where active and token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
 if not found then raise exception 'Acceso no válido'; end if;
 select * into d from public.foreman_attendance_days where owner_id=a.owner_id and lower(obra)=lower(a.obra) and work_date=p_work_date for update;
 if not found or (d.status in ('completed','reviewed') and not coalesce(d.correction_pending,false)) then raise exception 'Jornada no disponible para firmar'; end if;
 if d.foreman_signature_template->>'enabled' is distinct from 'true' then raise exception 'El supervisor no ha habilitado la firma del encargado'; end if;
 if length(coalesce(p_signature,''))<100 or length(p_signature)>350000 or p_signature !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$' then raise exception 'Firma no válida'; end if;
 if d.foreman_signature_evidence->>'signature'=p_signature and d.foreman_signature_evidence->>'accessId'=a.id::text then
   return jsonb_build_object('ok',true,'unchanged',true);
 end if;
 update public.foreman_attendance_days set foreman_signature_evidence=jsonb_build_object('signature',p_signature,'signedAt',now(),'accessId',a.id,'name',a.foreman_name),updated_at=now() where id=d.id;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.guard_attendance_foreman_signature() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.foreman_signature_template is distinct from old.foreman_signature_template or new.rows is distinct from old.rows then
   new.foreman_signature_evidence=null;
 end if;
 if new.foreman_signature_template is not null and not public.foreman_layout_valid(new.foreman_signature_template) then raise exception 'Plantilla no válida'; end if;
 if new.status in ('completed','reviewed') and old.status is distinct from new.status
    and new.foreman_signature_template->>'enabled'='true' and new.foreman_signature_template->>'required'='true'
    and coalesce(length(new.foreman_signature_evidence->>'signature'),0)=0 then
    raise exception 'Falta la firma obligatoria del encargado';
 end if;
 return new;
end $$;
drop trigger if exists guard_attendance_foreman_signature on public.foreman_attendance_days;
create trigger guard_attendance_foreman_signature before update on public.foreman_attendance_days
for each row execute function public.guard_attendance_foreman_signature();

-- Compact business evidence, without duplicating signature images in activity logs.
create table if not exists public.foreman_attendance_signature_events (
 id bigint generated always as identity primary key,
 attendance_id uuid not null references public.foreman_attendance_days(id) on delete cascade,
 owner_id uuid not null, action text not null check(action in ('SIGNED','INVALIDATED')),
 access_id text, actor_name text, template jsonb, created_at timestamptz not null default now()
);
alter table public.foreman_attendance_signature_events enable row level security;
revoke all on public.foreman_attendance_signature_events from public,anon,authenticated;
grant select on public.foreman_attendance_signature_events to authenticated;
drop policy if exists attendance_signature_event_owner on public.foreman_attendance_signature_events;
create policy attendance_signature_event_owner on public.foreman_attendance_signature_events for select to authenticated
using(owner_id=(select auth.uid()));
create or replace function public.audit_attendance_foreman_signature() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.foreman_signature_evidence is distinct from old.foreman_signature_evidence then
   insert into public.foreman_attendance_signature_events(attendance_id,owner_id,action,access_id,actor_name,template)
   values(new.id,new.owner_id,case when new.foreman_signature_evidence is null then 'INVALIDATED' else 'SIGNED' end,
     coalesce(new.foreman_signature_evidence,old.foreman_signature_evidence)->>'accessId',
     coalesce(new.foreman_signature_evidence,old.foreman_signature_evidence)->>'name',new.foreman_signature_template);
 end if;
 return new;
end $$;
drop trigger if exists audit_attendance_foreman_signature on public.foreman_attendance_days;
create trigger audit_attendance_foreman_signature after update on public.foreman_attendance_days
for each row execute function public.audit_attendance_foreman_signature();
revoke all on function public.audit_attendance_foreman_signature() from public,anon,authenticated;

create or replace function public.get_supervisor_foreman_evidence(p_document_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Acceso no autorizado'; end if;
 select jsonb_build_object('signature',f.signature,'signedAt',f.signed_at,'layout',d.details->'foremanSignatureTemplate') into result
 from public.foreman_mandatory_documents d left join public.foreman_document_signatures f on f.document_id=d.id
 where d.id=p_document_id and d.owner_id=auth.uid() and d.document_type not in ('inicio','control_presencia','contrato','prorroga');
 if found then return result; end if;
 select jsonb_build_object('signature',d.foreman_signature_evidence->>'signature','signedAt',d.foreman_signature_evidence->>'signedAt','layout',d.foreman_signature_template) into result
 from public.foreman_attendance_days d where d.id=p_document_id and d.owner_id=auth.uid();
 if not found then raise exception 'Documento no autorizado'; end if;
 return result;
end $$;

revoke all on function public.foreman_layout_valid(jsonb),public.guard_foreman_layout_scope(),public.audit_independent_foreman_signature(),public.guard_attendance_foreman_signature() from public,anon,authenticated;
revoke all on function public.get_reusable_foreman_layout(text),public.save_attendance_foreman_template(uuid,jsonb),public.get_supervisor_foreman_evidence(uuid),public.get_attendance_foreman_evidence(text,date),public.sign_attendance_as_foreman(text,date,text) from public,anon,authenticated;
grant execute on function public.get_reusable_foreman_layout(text),public.save_attendance_foreman_template(uuid,jsonb),public.get_supervisor_foreman_evidence(uuid) to authenticated;
grant execute on function public.get_attendance_foreman_evidence(text,date),public.sign_attendance_as_foreman(text,date,text) to anon,authenticated;
notify pgrst,'reload schema';
