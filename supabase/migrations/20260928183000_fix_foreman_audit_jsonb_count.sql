-- Corrige el trigger de auditoría del portal del encargado.
-- PostgreSQL no dispone de jsonb_object_length(jsonb); se cuentan las claves
-- mediante jsonb_object_keys para mantener la auditoría de firmas sin romper
-- altas/rotaciones de acceso ni importaciones múltiples.

create or replace function public.foreman_audit_row_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_new jsonb := case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_old jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_owner uuid;
  v_obra text;
  v_entity_id uuid;
  v_doc_type text;
  v_actor_type text;
  v_actor_name text := '';
  v_action text;
  v_worker bigint;
  v_metadata jsonb := '{}'::jsonb;
  v_old_status text;
  v_new_status text;
  v_next_version integer;
  v_signed_count integer;
begin
  v_owner := coalesce((v_new->>'owner_id')::uuid,(v_old->>'owner_id')::uuid);
  v_obra := coalesce(v_new->>'obra',v_old->>'obra','');
  v_entity_id := coalesce(nullif(v_new->>'id','')::uuid,nullif(v_old->>'id','')::uuid);
  v_doc_type := coalesce(v_new->>'document_type',v_old->>'document_type');
  v_old_status := v_old->>'status';
  v_new_status := v_new->>'status';
  begin
    v_worker := nullif(coalesce(v_new->>'worker_id',v_old->>'worker_id'),'')::bigint;
  exception when others then
    v_worker := null;
  end;

  if jsonb_typeof(v_new->'signatures')='object' then
    select count(*)::integer
      into v_signed_count
      from jsonb_object_keys(v_new->'signatures');
  else
    v_signed_count := null;
  end if;

  if auth.uid() is not null and auth.uid()=v_owner then
    v_actor_type := 'supervisor';
  else
    v_actor_type := 'encargado';
    select coalesce(a.foreman_name,'') into v_actor_name
      from public.foreman_portal_access a
     where a.owner_id=v_owner and lower(a.obra)=lower(v_obra)
     limit 1;
  end if;

  if tg_op='INSERT' then
    if tg_table_name='foreman_portal_access' then v_action := 'access_authorized';
    else v_action := case when v_new_status='completed' then 'created_and_finalized' else 'created' end; end if;
  elsif tg_op='DELETE' then
    v_action := 'deleted';
  elsif tg_table_name='foreman_portal_access' then
    if coalesce((v_old->>'active')::boolean,false) and not coalesce((v_new->>'active')::boolean,false) then
      v_action := 'access_revoked';
    elsif not coalesce((v_old->>'active')::boolean,false) and coalesce((v_new->>'active')::boolean,false) then
      v_action := 'access_authorized';
    elsif (v_old->>'token_hash') is distinct from (v_new->>'token_hash') then
      v_action := 'access_rotated';
    else
      v_action := 'access_updated';
    end if;
  elsif v_old_status is distinct from v_new_status then
    if v_new_status='completed' then v_action := 'finalized';
    elsif v_new_status='reviewed' then v_action := 'reviewed';
    elsif v_new_status='returned' or coalesce((v_new->>'correction_pending')::boolean,false) then v_action := 'returned_for_correction';
    else v_action := 'status_changed'; end if;
  elsif (v_old->'signatures') is distinct from (v_new->'signatures') then
    v_action := 'signature_updated';
  elsif (v_old->'rows') is distinct from (v_new->'rows') then
    v_action := 'attendance_updated';
  elsif (v_old->'answers') is distinct from (v_new->'answers') then
    v_action := 'answers_updated';
  else
    v_action := 'updated';
  end if;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'oldStatus',v_old_status,
    'newStatus',v_new_status,
    'correctionReason',v_new->>'correction_reason',
    'signedCount',v_signed_count,
    'workerCount',case when jsonb_typeof(v_new->'workers')='array' then jsonb_array_length(v_new->'workers') else null end
  ));

  insert into public.foreman_activity_log(
    owner_id,obra,entity_type,entity_id,document_type,action,actor_type,actor_name,worker_id,metadata
  ) values(
    v_owner,v_obra,tg_table_name,v_entity_id,v_doc_type,v_action,v_actor_type,coalesce(v_actor_name,''),v_worker,v_metadata
  );

  if tg_op<>'DELETE'
     and tg_table_name in ('foreman_mandatory_documents','foreman_documents','foreman_attendance_days')
     and v_new_status='completed'
     and (tg_op='INSERT' or v_old_status is distinct from 'completed') then
    select coalesce(max(version_no),0)+1 into v_next_version
      from public.foreman_document_versions
     where owner_id=v_owner and entity_type=tg_table_name and entity_id=v_entity_id;
    insert into public.foreman_document_versions(owner_id,obra,entity_type,entity_id,version_no,snapshot)
    values(v_owner,v_obra,tg_table_name,v_entity_id,v_next_version,v_new);
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$$;
