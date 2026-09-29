create or replace function public.resolve_foreman_portal(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_access public.foreman_portal_access%rowtype;
  v_hash text;
  v_work_start text:='08:00';
  v_work_end text:='15:00';
begin
  v_hash:=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
  select * into v_access
    from public.foreman_portal_access
   where token_hash=v_hash and active=true
   limit 1;
  if not found then return jsonb_build_object('valid',false); end if;

  update public.foreman_portal_access set last_used_at=now() where id=v_access.id;

  select coalesce(nullif(settings #>> '{app,workStartHour}',''),'08:00'),
         coalesce(nullif(settings #>> '{app,workEndHour}',''),'15:00')
    into v_work_start,v_work_end
    from public.user_settings
   where user_id=v_access.owner_id
   limit 1;
  v_work_start:=coalesce(v_work_start,'08:00');
  v_work_end:=coalesce(v_work_end,'15:00');

  return jsonb_build_object(
    'valid',true,
    'obra',v_access.obra,
    'foremanName',v_access.foreman_name,
    'defaultWorkStartHour',v_work_start,
    'defaultWorkEndHour',v_work_end,
    'worksite',coalesce((
      select jsonb_build_object(
        'codigo',coalesce(o.codigo,''),
        'nombre',coalesce(o.nombre,v_access.obra),
        'municipio',coalesce(o.municipio,''),
        'empresa',coalesce(o.empresa,''),
        'cif',coalesce(o.cif,''),
        'recursoPreventivo',coalesce(o.recurso_preventivo,v_access.foreman_name)
      )
      from public.obras o
      where o.owner_id=v_access.owner_id
        and lower(coalesce(o.nombre,''))=lower(v_access.obra)
      order by o.updated_at desc
      limit 1
    ),jsonb_build_object(
      'codigo','',
      'nombre',v_access.obra,
      'municipio','',
      'empresa','',
      'cif','',
      'recursoPreventivo',v_access.foreman_name
    )),
    'workers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',t.id,
        'apellidosNombre',t.apellidos_nombre,
        'dni',t.dni,
        'categoria',t.categoria,
        'obra',t.obra,
        'numOferta',t.num_oferta,
        'quincena',t.quincena,
        'periodoInicio',t.periodo_inicio,
        'periodoFin',t.periodo_fin,
        'telefono',t.telefono,
        'calzado',t.calzado,
        'formacion',t.formacion,
        'lugarFormacion',t.lugar_formacion,
        'aptitudMedica',t.aptitud_medica,
        'limitacionesAptitud',t.limitaciones_aptitud,
        'reconocimientoEstado',t.reconocimiento_estado,
        'reconocimientoFecha',t.reconocimiento_fecha,
        'reconocimientoValidez',t.reconocimiento_validez,
        'reconocimientoLimitaciones',t.reconocimiento_limitaciones,
        'reconocimientoObservaciones',t.reconocimiento_observaciones
      ) order by t.apellidos_nombre)
      from public.trabajadores t
      where t.owner_id=v_access.owner_id
        and lower(t.obra)=lower(v_access.obra)
    ),'[]'::jsonb),
    'attendance',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'workDate',a.work_date,'rows',a.rows,'status',a.status,
        'completedAt',a.completed_at,'updatedAt',a.updated_at,
        'correctionPending',a.correction_pending,'correctionReason',a.correction_reason,
        'correctionRequestedAt',a.correction_requested_at
      ) order by a.work_date desc)
      from public.foreman_attendance_days a
      where a.owner_id=v_access.owner_id
        and lower(a.obra)=lower(v_access.obra)
        and a.work_date>=current_date-31
    ),'[]'::jsonb),
    'documents',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',d.id,'workDate',d.work_date,'documentType',d.document_type,
        'workerId',d.worker_id,'workerSnapshot',d.worker_snapshot,
        'answers',d.answers,'signatures',d.signatures,'status',d.status,
        'completedAt',d.completed_at,'correctionPending',d.correction_pending,
        'correctionReason',d.correction_reason,'correctionRequestedAt',d.correction_requested_at
      ) order by d.created_at desc)
      from public.foreman_documents d
      where d.owner_id=v_access.owner_id
        and lower(d.obra)=lower(v_access.obra)
        and d.created_at>=now()-interval '90 days'
    ),'[]'::jsonb),
    'mandatoryDocuments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'workDate',m.work_date,'periodKey',m.period_key,
        'documentType',m.document_type,'category',m.category,
        'workers',m.workers,'signatures',m.signatures,'status',m.status,
        'completedAt',m.completed_at,'details',m.details,
        'correctionPending',m.correction_pending,'correctionReason',m.correction_reason,
        'correctionRequestedAt',m.correction_requested_at
      ) order by m.work_date desc,m.document_type,m.category)
      from public.foreman_mandatory_documents m
      where m.owner_id=v_access.owner_id
        and lower(m.obra)=lower(v_access.obra)
        and m.work_date>=current_date-62
    ),'[]'::jsonb)
  );
end;
$$;

revoke execute on function public.resolve_foreman_portal(text) from public;
grant execute on function public.resolve_foreman_portal(text) to anon, authenticated;
