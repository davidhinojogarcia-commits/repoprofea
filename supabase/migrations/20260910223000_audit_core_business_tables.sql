-- Auditoría automática de CRUD en las tablas de negocio principales.

create trigger trg_citas_audit
after insert or update or delete on public.citas
for each row execute function public.audit_business_change();

create trigger trg_subcontratas_audit
after insert or update or delete on public.subcontratas
for each row execute function public.audit_business_change();

create trigger trg_reconocimientos_audit
after insert or update or delete on public.reconocimientos
for each row execute function public.audit_business_change();

create trigger trg_contrataciones_audit
after insert or update or delete on public.contrataciones
for each row execute function public.audit_business_change();
