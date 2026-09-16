-- Corrige el requisito legado de "recurso preventivo" de la subcontrata.
-- El checklist CAE debe identificar a la persona de enlace de la subcontrata
-- (encargado/interlocutor) sin tratarla como recurso preventivo obligatorio.

-- 1) Documentos normalizados ya existentes.
update public.subcontrata_documentos
set
  nombre = 'Responsable de coordinación de la subcontrata (encargado o interlocutor)',
  descripcion = 'Identificación de la persona designada por la empresa subcontratista como encargado o interlocutor responsable de la coordinación, comunicación y seguimiento de sus trabajos en la obra. No supone la designación de un recurso preventivo propio, salvo cuando resulte legal o preventivamente exigible.',
  normativa = 'Art. 24 Ley 31/1995 y RD 171/2004 (CAE). Art. 32 bis Ley 31/1995 cuando proceda recurso preventivo.',
  obligatorio = false,
  estado = case when estado = 'entregado' then 'entregado' else 'no_aplica' end,
  data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
    'nombre', 'Responsable de coordinación de la subcontrata (encargado o interlocutor)',
    'descripcion', 'Identificación de la persona designada por la empresa subcontratista como encargado o interlocutor responsable de la coordinación, comunicación y seguimiento de sus trabajos en la obra. No supone la designación de un recurso preventivo propio, salvo cuando resulte legal o preventivamente exigible.',
    'normativa', 'Art. 24 Ley 31/1995 y RD 171/2004 (CAE). Art. 32 bis Ley 31/1995 cuando proceda recurso preventivo.',
    'obligatorio', false,
    'estado', case when estado = 'entregado' then 'entregado' else 'no_aplica' end
  )
where data->>'id' = 'recurso_preventivo'
   or id like '%:recurso_preventivo';

-- 2) Copia JSON embebida en cada subcontrata, utilizada por la interfaz.
update public.subcontratas s
set data = jsonb_set(
  s.data,
  '{checklist}',
  (
    select jsonb_agg(
      case
        when item->>'id' = 'recurso_preventivo' then
          item || jsonb_build_object(
            'nombre', 'Responsable de coordinación de la subcontrata (encargado o interlocutor)',
            'descripcion', 'Identificación de la persona designada por la empresa subcontratista como encargado o interlocutor responsable de la coordinación, comunicación y seguimiento de sus trabajos en la obra. No supone la designación de un recurso preventivo propio, salvo cuando resulte legal o preventivamente exigible.',
            'normativa', 'Art. 24 Ley 31/1995 y RD 171/2004 (CAE). Art. 32 bis Ley 31/1995 cuando proceda recurso preventivo.',
            'obligatorio', false,
            'estado', case when item->>'estado' = 'entregado' then 'entregado' else 'no_aplica' end
          )
        else item
      end
      order by ord
    )
    from jsonb_array_elements(s.data->'checklist') with ordinality as t(item, ord)
  ),
  true
)
where jsonb_typeof(s.data->'checklist') = 'array'
  and exists (
    select 1
    from jsonb_array_elements(s.data->'checklist') as t(item)
    where item->>'id' = 'recurso_preventivo'
  );

-- 3) Plantillas personalizadas guardadas por usuario.
update public.user_settings us
set settings = jsonb_set(
  us.settings,
  '{subcontratas,checklistTemplate}',
  (
    select jsonb_agg(
      case
        when item->>'id' = 'recurso_preventivo' then
          item || jsonb_build_object(
            'nombre', 'Responsable de coordinación de la subcontrata (encargado o interlocutor)',
            'descripcion', 'Identificación de la persona designada por la empresa subcontratista como encargado o interlocutor responsable de la coordinación, comunicación y seguimiento de sus trabajos en la obra. No supone la designación de un recurso preventivo propio, salvo cuando resulte legal o preventivamente exigible.',
            'normativa', 'Art. 24 Ley 31/1995 y RD 171/2004 (CAE). Art. 32 bis Ley 31/1995 cuando proceda recurso preventivo.',
            'obligatorio', false,
            'estado', case when item->>'estado' = 'entregado' then 'entregado' else 'no_aplica' end
          )
        else item
      end
      order by ord
    )
    from jsonb_array_elements(us.settings#>'{subcontratas,checklistTemplate}') with ordinality as t(item, ord)
  ),
  true
)
where jsonb_typeof(us.settings#>'{subcontratas,checklistTemplate}') = 'array'
  and exists (
    select 1
    from jsonb_array_elements(us.settings#>'{subcontratas,checklistTemplate}') as t(item)
    where item->>'id' = 'recurso_preventivo'
  );
