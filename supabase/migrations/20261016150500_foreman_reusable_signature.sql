-- Reusable supervisor-owned model layouts and independently signed foreman evidence.
create table if not exists public.foreman_signature_templates (
 owner_id uuid not null, model_key text not null,
 layout jsonb not null, updated_at timestamptz not null default now(),
 primary key(owner_id,model_key)
);
create table if not exists public.foreman_document_signatures (
 document_id uuid primary key references public.foreman_mandatory_documents(id) on delete cascade,
 access_id uuid not null references public.foreman_portal_access(id),
 signature text not null, signed_at timestamptz not null default now()
);
alter table public.foreman_signature_templates enable row level security;
alter table public.foreman_document_signatures enable row level security;
revoke all on public.foreman_signature_templates,public.foreman_document_signatures from public,anon,authenticated;

create or replace function public.get_foreman_signature_template(p_document_id uuid,p_model_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.foreman_mandatory_documents%rowtype; t jsonb;
begin
 select * into d from public.foreman_mandatory_documents where id=p_document_id and owner_id=auth.uid();
 if not found then raise exception 'Documento no autorizado'; end if;
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
 if d.assigned_at is not null and d.lifecycle_status not in ('ANALYZED','READY','NEEDS_WORKER_REVIEW','NEEDS_SIGNATURE_POSITION_REVIEW','RETURNED_FOR_CORRECTION') then
   raise exception 'Retira el documento del portal antes de cambiar la plantilla'; end if;
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
 if not found or d.assigned_at is null or d.lifecycle_status not in ('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION') then
   raise exception 'Documento no disponible para firmar'; end if;
 if d.details->'foremanSignatureTemplate' is null or coalesce((d.details#>>'{foremanSignatureTemplate,enabled}')::boolean,false)=false then
   raise exception 'El supervisor no ha habilitado la firma del encargado'; end if;
 if length(coalesce(p_signature,''))<100 or length(p_signature)>350000 or p_signature !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$'
 then raise exception 'Firma no válida o demasiado grande'; end if;
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
 where d.id=p_document_id and d.owner_id=a.owner_id and lower(d.obra)=lower(a.obra) and d.assigned_at is not null)
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
