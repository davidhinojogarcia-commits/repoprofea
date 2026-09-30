-- Inicio / Control: las posiciones de firma son automáticas y nunca requieren
-- validación manual del supervisor. El PDF original sigue protegido mediante
-- SHA/fidelidad y todas las personas impresas deben haber firmado antes del envío.

drop trigger if exists trg_exact_pdf_anchor_placeholders
  on public.foreman_mandatory_documents;

create or replace function public.store_foreman_mandatory_signed_pdf(
  p_token text,
  p_document_id uuid,
  p_pdf_base64 text,
  p_signed_sha256 text,
  p_fidelity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_access public.foreman_portal_access%rowtype;
  v_doc public.foreman_mandatory_documents%rowtype;
  v_signed_bytes bytea;
  v_computed_sha text;
  v_missing_signatures integer := 0;
begin
  v_hash := encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');

  select *
    into v_access
  from public.foreman_portal_access
  where token_hash=v_hash
    and active=true
  limit 1;

  if not found then
    raise exception 'Acceso no válido o revocado';
  end if;

  select *
    into v_doc
  from public.foreman_mandatory_documents
  where id=p_document_id
    and owner_id=v_access.owner_id
    and lower(obra)=lower(v_access.obra)
  for update;

  if not found then
    raise exception 'Documento no válido';
  end if;

  if coalesce(v_doc.details->>'originalPdfMode','')<>'overlay' then
    raise exception 'El documento no está configurado en modo PDF original';
  end if;

  -- La identidad válida es la de importedWorkerIds, incluidos IDs sintéticos
  -- negativos de personas que solo existen en el PDF. No se exige que las
  -- coordenadas hayan sido confirmadas manualmente.
  select count(*)
    into v_missing_signatures
  from jsonb_array_elements_text(
    coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb)
  ) imported(worker_id)
  where coalesce(imported.worker_id,'')=''
     or imported.worker_id='0'
     or not (coalesce(v_doc.signatures,'{}'::jsonb) ? imported.worker_id);

  if v_missing_signatures>0 then
    raise exception 'Faltan firmas de personas incluidas en el documento importado';
  end if;

  if coalesce((p_fidelity->>'ok')::boolean,false)=false then
    raise exception 'La verificación de fidelidad del PDF no ha sido superada';
  end if;

  begin
    v_signed_bytes := decode(coalesce(p_pdf_base64,''),'base64');
  exception when others then
    raise exception 'El PDF firmado no tiene un formato binario válido';
  end;

  if octet_length(v_signed_bytes)=0 then
    raise exception 'El PDF firmado está vacío';
  end if;

  v_computed_sha := encode(digest(v_signed_bytes,'sha256'),'hex');
  if coalesce(trim(p_signed_sha256),'')<>''
     and lower(trim(p_signed_sha256))<>lower(v_computed_sha) then
    raise exception 'La huella SHA-256 del PDF firmado no coincide';
  end if;

  update public.foreman_mandatory_pdf_files
     set signed_pdf=v_signed_bytes,
         signed_sha256=v_computed_sha,
         fidelity=coalesce(p_fidelity,'{}'::jsonb),
         updated_at=now()
   where document_id=p_document_id
     and owner_id=v_access.owner_id;

  if not found then
    raise exception 'El PDF original no está almacenado';
  end if;

  return jsonb_build_object(
    'ok',true,
    'signedSha256',v_computed_sha
  );
end;
$$;

revoke all on function public.store_foreman_mandatory_signed_pdf(text,uuid,text,text,jsonb) from public, anon;
grant execute on function public.store_foreman_mandatory_signed_pdf(text,uuid,text,text,jsonb) to anon, authenticated;


create or replace function public.guard_exact_mandatory_pdf_completion()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_file public.foreman_mandatory_pdf_files%rowtype;
  v_missing_signatures integer := 0;
begin
  if new.status='completed'
     and coalesce(old.status,'')<>'completed'
     and new.document_type in ('inicio','control_presencia')
     and coalesce(new.details->>'originalPdfMode','')='overlay' then

    select count(*)
      into v_missing_signatures
    from jsonb_array_elements_text(
      coalesce(new.details->'importedWorkerIds','[]'::jsonb)
    ) imported(worker_id)
    where coalesce(imported.worker_id,'')=''
       or imported.worker_id='0'
       or not (coalesce(new.signatures,'{}'::jsonb) ? imported.worker_id);

    if v_missing_signatures>0 then
      raise exception 'Faltan firmas de personas incluidas en el documento importado';
    end if;

    select *
      into v_file
    from public.foreman_mandatory_pdf_files
    where document_id=new.id
      and owner_id=new.owner_id;

    if not found or v_file.signed_pdf is null then
      raise exception 'Debe generarse y guardarse el PDF firmado antes de finalizar';
    end if;

    if coalesce((v_file.fidelity->>'ok')::boolean,false)=false then
      raise exception 'La copia firmada no ha superado la verificación de fidelidad';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_exact_mandatory_pdf_completion
  on public.foreman_mandatory_documents;
create trigger trg_guard_exact_mandatory_pdf_completion
before update of status on public.foreman_mandatory_documents
for each row
execute function public.guard_exact_mandatory_pdf_completion();

comment on function public.store_foreman_mandatory_signed_pdf(text,uuid,text,text,jsonb)
is 'Guarda Inicio/Control firmado sin validación manual de posiciones; exige todas las firmas y fidelidad del PDF.';
