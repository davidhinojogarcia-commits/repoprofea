-- Evita duplicar entradas de auditoría en workers y trash.
-- Se conservan los triggers históricos workers_audit/trash_audit y
-- los triggers de metadata/updated_at. Las tablas de negocio nuevas
-- siguen usando audit_business_change mediante sus propios triggers.

drop trigger if exists trg_workers_audit on public.workers;
drop trigger if exists trg_trash_audit on public.trash;
