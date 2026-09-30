alter table public.foreman_mandatory_documents
  drop constraint if exists foreman_mandatory_documents_document_type_check;

alter table public.foreman_mandatory_documents
  add constraint foreman_mandatory_documents_document_type_check
  check (document_type in (
    'inicio',
    'control_presencia',
    'epis',
    'formacion',
    'maquinaria',
    'autorizacion_uso_maquinaria'
  ));

-- Verification guard: fail the migration if the resulting constraint does not
-- explicitly accept the Formación document type.
do $$
declare
  v_definition text;
begin
  select pg_get_constraintdef(c.oid)
    into v_definition
    from pg_constraint c
   where c.conrelid = 'public.foreman_mandatory_documents'::regclass
     and c.conname = 'foreman_mandatory_documents_document_type_check';

  if coalesce(v_definition,'') not ilike '%formacion%' then
    raise exception 'La restricción de tipos no incluye formacion';
  end if;
end;
$$;
