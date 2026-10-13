-- Supabase default privileges can grant anon EXECUTE independently of PUBLIC.
-- Dispatch and delivery completion require an authenticated supervisor.
revoke execute on function public.claim_foreman_document_push(uuid), public.finish_foreman_document_push(uuid,uuid,integer) from anon;
grant execute on function public.claim_foreman_document_push(uuid), public.finish_foreman_document_push(uuid,uuid,integer) to authenticated;
notify pgrst, 'reload schema';
