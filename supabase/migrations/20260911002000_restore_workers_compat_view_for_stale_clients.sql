-- Temporary compatibility view for already-deployed clients that still request /rest/v1/workers.
-- The canonical table remains public.trabajadores; RLS is enforced by the underlying table.
create or replace view public.workers
with (security_invoker = true)
as
select * from public.trabajadores;

grant select, insert, update, delete on public.workers to authenticated;
revoke all on public.workers from anon;
