-- Si el encargado corrige el nombre leído del PDF, invalidamos cualquier
-- coordenada anterior. La siguiente firma obliga a relocalizar el nombre real
-- dentro del PDF original. Nunca se reutiliza una posición aproximada u obsoleta.

create or replace function public.correct_foreman_mandatory_worker_name(
  p_token text,
  p_document_id uuid,
  p_worker_id bigint,
  p_worker_name text
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
  v_name text;
  v_workers jsonb;
  v_imported_workers jsonb;
  v_anchors jsonb;
begin
  v_name := regexp_replace(trim(coalesce(p_worker_name,'')), '\s+', ' ', 'g');
  if length(v_name) < 3 then
    raise exception 'Indica un nombre válido';
  end if;

  v_hash := encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
  select * into v_access
    from public.foreman_portal_access
   where token_hash=v_hash and active=true
   limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;

  select * into v_doc
    from public.foreman_mandatory_documents
   where id=p_document_id
     and owner_id=v_access.owner_id
     and lower(obra)=lower(v_access.obra)
   for update;
  if not found then raise exception 'Documento no válido'; end if;

  if coalesce(v_doc.signatures,'{}'::jsonb) ? p_worker_id::text then
    raise exception 'El nombre no puede cambiarse después de firmar';
  end if;

  if not exists (
    select 1
      from jsonb_array_elements_text(coalesce(v_doc.details->'importedWorkerIds','[]'::jsonb)) x(value)
     where x.value=p_worker_id::text
  ) then
    raise exception 'La persona no pertenece al documento importado';
  end if;

  select coalesce(jsonb_agg(
    case when coalesce(item->>'id','')=p_worker_id::text
      then jsonb_set(item,'{apellidosNombre}',to_jsonb(v_name),true)
      else item end
  ),'[]'::jsonb)
  into v_imported_workers
  from jsonb_array_elements(coalesce(v_doc.details->'importedWorkers','[]'::jsonb)) item;

  select coalesce(jsonb_agg(
    case when coalesce(item->>'id','')=p_worker_id::text
      then jsonb_set(item,'{apellidosNombre}',to_jsonb(v_name),true)
      else item end
  ),'[]'::jsonb)
  into v_workers
  from jsonb_array_elements(coalesce(v_doc.workers,'[]'::jsonb)) item;

  select coalesce(jsonb_agg(
    case when coalesce(item->>'workerId','')=p_worker_id::text then
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(item,'{workerName}',to_jsonb(v_name),true),
                      '{resolved}','false'::jsonb,true
                    ),
                    '{nameX}','null'::jsonb,true
                  ),
                  '{nameY}','null'::jsonb,true
                ),
                '{nameRightX}','null'::jsonb,true
              ),
              '{signatureX}','null'::jsonb,true
            ),
            '{signatureY}','null'::jsonb,true
          ),
          '{signatureWidth}','null'::jsonb,true
        ),
        '{signatureHeight}','null'::jsonb,true
      )
      else item end
  ),'[]'::jsonb)
  into v_anchors
  from jsonb_array_elements(coalesce(v_doc.details->'workerAnchors','[]'::jsonb)) item;

  update public.foreman_mandatory_documents
     set workers=v_workers,
         details=jsonb_set(
           jsonb_set(coalesce(details,'{}'::jsonb),'{importedWorkers}',v_imported_workers,true),
           '{workerAnchors}',v_anchors,true
         ),
         updated_at=now()
   where id=p_document_id;

  return jsonb_build_object('ok',true,'workerId',p_worker_id,'workerName',v_name,'anchorInvalidated',true);
end;
$$;

revoke all on function public.correct_foreman_mandatory_worker_name(text,uuid,bigint,text) from public;
grant execute on function public.correct_foreman_mandatory_worker_name(text,uuid,bigint,text) to anon, authenticated;
