-- Originals are temporary after complete supervisor review. Signed PDFs remain.
alter table public.foreman_mandatory_pdf_files alter column original_pdf drop not null;
alter table public.foreman_mandatory_pdf_files add column if not exists original_purged_at timestamptz;

create or replace function private.prune_reviewed_original_pdfs()
returns integer language plpgsql security invoker set search_path='' as $$
declare v_doc uuid; v_count integer:=0;
begin
  for v_doc in
    select d.id from public.foreman_mandatory_documents d
    join public.foreman_mandatory_pdf_files f on f.document_id=d.id and f.owner_id=d.owner_id
    join lateral (select * from public.mandatory_document_versions_v2 x
      where x.document_id=d.id and x.owner_id=d.owner_id order by version_no desc limit 1) v on true
    where d.status='reviewed' and d.lifecycle_status='REVIEWED'
      and not coalesce(d.correction_pending,false) and f.original_pdf is not null
      and v.submission_mode='complete' and v.required_count>0 and v.signed_count=v.required_count
      and f.signed_pdf is not null and f.signed_pdf=v.signed_pdf
      and f.signed_sha256=v.signed_sha256
      and lower(pg_catalog.encode(extensions.digest(f.signed_pdf,'sha256'),'hex'))=lower(f.signed_sha256)
      and f.fidelity->>'ok'='true' and v.fidelity->>'ok'='true'
    order by d.id limit 100 for update of d,f skip locked
  loop
    update public.foreman_mandatory_pdf_files set original_pdf=null,original_purged_at=now(),updated_at=now()
      where document_id=v_doc;
    update public.foreman_mandatory_documents set details=coalesce(details,'{}'::jsonb)||
      jsonb_build_object('originalPdfStored',false,'originalPdfPurged',true),updated_at=now() where id=v_doc;
    insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata)
      select id,owner_id,'ORIGINAL_PDF_DISCARDED','sistema',jsonb_build_object('signedPdfPreserved',true)
      from public.foreman_mandatory_documents where id=v_doc;
    v_count:=v_count+1;
  end loop;
  delete from cron.job_run_details where jobid in
    (select jobid from cron.job where jobname='gestionprofea-original-pdf-retention')
    and end_time<now()-interval '7 days';
  return v_count;
end; $$;
revoke all on function private.prune_reviewed_original_pdfs() from public,anon,authenticated,service_role;

-- Refuse reopening before the matching original has been restored; preserve signed copy.
create or replace function private.guard_purged_original_reopening()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (new.status is distinct from old.status or new.lifecycle_status is distinct from old.lifecycle_status)
    and exists(select 1 from public.foreman_mandatory_pdf_files where document_id=old.id
      and original_pdf is null and original_purged_at is not null) then
    raise exception 'El original se eliminó tras la revisión. Reimporta el mismo PDF original antes de corregir; el PDF firmado se conserva.';
  end if;
  return new;
end; $$;
revoke all on function private.guard_purged_original_reopening() from public,anon,authenticated,service_role;
drop trigger if exists guard_purged_original_reopening on public.foreman_mandatory_documents;
create trigger guard_purged_original_reopening before update on public.foreman_mandatory_documents
  for each row execute function private.guard_purged_original_reopening();

create or replace function public.restore_mandatory_original_pdf(p_document_id uuid,p_pdf_base64 text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_file public.foreman_mandatory_pdf_files%rowtype; v_bytes bytea;
begin
  if v_owner is null then raise exception 'Authentication required'; end if;
  perform 1 from public.foreman_mandatory_documents where id=p_document_id and owner_id=v_owner for update;
  if not found then raise exception 'Documento no disponible'; end if;
  select * into v_file from public.foreman_mandatory_pdf_files
    where document_id=p_document_id and owner_id=v_owner for update;
  if not found or v_file.original_purged_at is null then raise exception 'Este documento no necesita reimportar el original'; end if;
  v_bytes:=pg_catalog.decode(p_pdf_base64,'base64');
  if pg_catalog.encode(extensions.digest(v_bytes,'sha256'),'hex')<>v_file.original_sha256 then
    raise exception 'El archivo no coincide con el PDF original importado. Selecciona exactamente el mismo archivo.';
  end if;
  update public.foreman_mandatory_pdf_files set original_pdf=v_bytes,original_purged_at=null,updated_at=now()
    where document_id=p_document_id and owner_id=v_owner;
  update public.foreman_mandatory_documents set details=coalesce(details,'{}'::jsonb)||
    jsonb_build_object('originalPdfStored',true,'originalPdfPurged',false),correction_pending=true,updated_at=now()
    where id=p_document_id and owner_id=v_owner;
  insert into public.mandatory_document_events_v2(document_id,owner_id,event_type,actor_type,metadata)
    values(p_document_id,v_owner,'ORIGINAL_PDF_REIMPORTED','supervisor','{}'::jsonb);
  return jsonb_build_object('ok',true,'signedPdfPreserved',true);
end; $$;
revoke all on function public.restore_mandatory_original_pdf(uuid,text) from public,anon;
grant execute on function public.restore_mandatory_original_pdf(uuid,text) to authenticated;
select cron.schedule('gestionprofea-original-pdf-retention','30 3 * * *',
  $$set statement_timeout='60s'; select private.prune_reviewed_original_pdfs();$$);
