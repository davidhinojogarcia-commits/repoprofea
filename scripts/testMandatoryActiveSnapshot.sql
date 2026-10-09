-- Regression test: run through SQL tooling; transaction always rolls back.
begin;
do $test$
declare v_doc record; v_count integer:=0;
begin
  for v_doc in select distinct on (lifecycle_status) id,lifecycle_status from public.foreman_mandatory_documents where lifecycle_status in ('ASSIGNED','IN_SIGNATURE') order by lifecycle_status,id loop
    perform public.mandatory_v2_refresh_legacy_worker_snapshot(v_doc.id);
    if not exists(select 1 from public.foreman_mandatory_documents where id=v_doc.id and lifecycle_status=v_doc.lifecycle_status and details->>'lifecycleStatus'=v_doc.lifecycle_status) then raise exception 'Active lifecycle changed'; end if;
    update public.mandatory_document_workers_v2 set detection_status='REJECTED' where document_id=v_doc.id;
    perform public.mandatory_v2_refresh_legacy_worker_snapshot(v_doc.id);
    if not exists(select 1 from public.foreman_mandatory_documents where id=v_doc.id and lifecycle_status=v_doc.lifecycle_status and details->'importedWorkerIds'='[]'::jsonb and details->'workerAnchors'='[]'::jsonb) then raise exception 'Empty projection regression'; end if;
    v_count:=v_count+1;
  end loop;
  if v_count=0 then raise exception 'No active test candidates'; end if;
end $test$;
select 'PASS: active lifecycle and empty signing projections; all test changes rolled back' as result;
rollback;