-- Native institutional models contain a foreman cell; missing configuration
-- must enable signing, rather than silently bypassing the foreman's approval.
create or replace function public.default_foreman_signature_layout(p_type text) returns jsonb
language sql immutable set search_path=public as $$
 select case when p_type in ('epis','formacion','maquinaria','autorizacion_uso_maquinaria','control_horario') then
 jsonb_build_object('templateKey',p_type||':modelo-institucional','enabled',true,'required',true,
 'allPages',true,'x',(case when p_type='control_horario' then 214 else 14 end)::numeric/297,
 'y',(case when p_type='control_horario' then 86 else 18 end)::numeric/210,
 'width',(case when p_type='control_horario' then 68 else 82 end)::numeric/297,
 'height',(case when p_type='control_horario' then 10 else 14 end)::numeric/210,
 'pageRatio',297::numeric/210,'revision',1) else null end;
$$;

create or replace function public.initialize_native_foreman_signature() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.document_type in ('epis','formacion','maquinaria','autorizacion_uso_maquinaria')
    and new.status not in ('completed','reviewed') and (
      (tg_op='INSERT' and auth.uid() is distinct from new.owner_id)
      or ((new.details->>'originalPdfMode') is distinct from 'overlay' and
          coalesce(new.details->'foremanSignatureTemplate','null'::jsonb)='null'::jsonb)
    ) then
   new.details=coalesce(new.details,'{}'::jsonb)||jsonb_build_object('foremanSignatureTemplate',public.default_foreman_signature_layout(new.document_type));
 end if;
 return new;
end $$;
drop trigger if exists a_initialize_native_foreman_signature on public.foreman_mandatory_documents;
create trigger a_initialize_native_foreman_signature before insert or update of details,document_type,status
on public.foreman_mandatory_documents for each row execute function public.initialize_native_foreman_signature();

create or replace function public.initialize_attendance_foreman_signature() returns trigger
language plpgsql security definer set search_path=public as $$
declare existing public.foreman_attendance_days%rowtype;
begin
 if tg_op='UPDATE' then
   if new.status='draft' and new.foreman_signature_template is null then
     new.foreman_signature_template=public.default_foreman_signature_layout('control_horario');
   end if;
   return new;
 end if;
 -- save_foreman_attendance uses INSERT ... ON CONFLICT UPDATE, so candidate
 -- inserts must inherit any existing supervisor override/evidence first.
 select * into existing from public.foreman_attendance_days
 where owner_id=new.owner_id and obra=new.obra and work_date=new.work_date;
 if found then
   new.foreman_signature_template=coalesce(existing.foreman_signature_template,public.default_foreman_signature_layout('control_horario'));
   new.foreman_signature_evidence=existing.foreman_signature_evidence;
 else
   new.foreman_signature_template=public.default_foreman_signature_layout('control_horario');
   new.foreman_signature_evidence=null;
 end if;
 return new;
end $$;
drop trigger if exists a_initialize_attendance_foreman_signature on public.foreman_attendance_days;
create trigger a_initialize_attendance_foreman_signature before insert or update of status on public.foreman_attendance_days
for each row execute function public.initialize_attendance_foreman_signature();

create or replace function public.guard_attendance_foreman_signature() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and (new.foreman_signature_template is distinct from old.foreman_signature_template or new.rows is distinct from old.rows) then
   new.foreman_signature_evidence=null;
 end if;
 if new.foreman_signature_template is not null and not public.foreman_layout_valid(new.foreman_signature_template) then raise exception 'Plantilla no válida'; end if;
 if new.status in ('completed','reviewed') and (tg_op='INSERT' or old.status is distinct from new.status)
    and new.foreman_signature_template->>'enabled'='true' and new.foreman_signature_template->>'required'='true'
    and coalesce(length(new.foreman_signature_evidence->>'signature'),0)=0 then
    raise exception 'Falta la firma obligatoria del encargado';
 end if;
 return new;
end $$;
drop trigger if exists guard_attendance_foreman_signature on public.foreman_attendance_days;
create trigger guard_attendance_foreman_signature before insert or update on public.foreman_attendance_days
for each row execute function public.guard_attendance_foreman_signature();

create or replace function public.get_attendance_foreman_evidence(p_token text,p_work_date date) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a public.foreman_portal_access%rowtype; d public.foreman_attendance_days%rowtype;
begin
 select * into a from public.foreman_portal_access where active and token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
 if not found then raise exception 'Acceso no válido'; end if;
 select * into d from public.foreman_attendance_days where owner_id=a.owner_id and lower(obra)=lower(a.obra) and work_date=p_work_date;
 return jsonb_build_object('layout',coalesce(d.foreman_signature_template,public.default_foreman_signature_layout('control_horario')),
 'signed',coalesce(length(d.foreman_signature_evidence->>'signature')>0,false),'signedAt',d.foreman_signature_evidence->>'signedAt');
end $$;

-- Repair existing pending native documents without touching workers, ink,
-- supervisor overrides, imported originals or previously finalized PDFs.
update public.foreman_mandatory_documents set
 details=coalesce(details,'{}'::jsonb)||jsonb_build_object('foremanSignatureTemplate',public.default_foreman_signature_layout(document_type)),updated_at=now()
where document_type in ('epis','formacion','maquinaria','autorizacion_uso_maquinaria')
 and status not in ('completed','reviewed') and (details->>'originalPdfMode') is distinct from 'overlay'
 and coalesce(details->'foremanSignatureTemplate','null'::jsonb)='null'::jsonb;
update public.foreman_attendance_days set foreman_signature_template=public.default_foreman_signature_layout('control_horario'),updated_at=now()
where (status='draft' or correction_pending) and foreman_signature_template is null;

revoke all on function public.default_foreman_signature_layout(text),public.initialize_native_foreman_signature(),public.initialize_attendance_foreman_signature(),public.guard_attendance_foreman_signature() from public,anon,authenticated;
revoke all on function public.get_attendance_foreman_evidence(text,date) from public,anon,authenticated;
grant execute on function public.get_attendance_foreman_evidence(text,date) to anon,authenticated;
notify pgrst,'reload schema';
