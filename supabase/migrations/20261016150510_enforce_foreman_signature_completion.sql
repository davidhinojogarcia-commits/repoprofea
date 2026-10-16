-- Enforce required foreman ink at the database boundary, not only in the mobile UI.
create or replace function public.enforce_required_foreman_document_signature()
returns trigger language plpgsql security definer set search_path=public as $
begin
 if coalesce((new.details#>>'{foremanSignatureTemplate,enabled}')::boolean,false)
    and coalesce((new.details#>>'{foremanSignatureTemplate,required}')::boolean,false)
    and (
      (new.lifecycle_status in ('SUBMITTED','RECEIVED','REVIEWED') and old.lifecycle_status is distinct from new.lifecycle_status)
      or (new.status in ('completed','reviewed') and old.status is distinct from new.status)
    )
    and not exists(select 1 from public.foreman_document_signatures f where f.document_id=new.id)
 then raise exception 'Falta la firma obligatoria del encargado. No se puede finalizar el documento';
 end if;
 return new;
end $$;
drop trigger if exists foreman_required_signature_before_finalize on public.foreman_mandatory_documents;
create trigger foreman_required_signature_before_finalize
before update of lifecycle_status,status on public.foreman_mandatory_documents
for each row execute function public.enforce_required_foreman_document_signature();
