create or replace function public.import_workers_atomic(p_workers jsonb)
returns integer
language plpgsql
set search_path to 'public','private','pg_temp'
as $$
declare
  v_user uuid := auth.uid();
  v_item jsonb;
  v_id bigint;
  v_count integer := 0;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.has_module_permission('trabajadores','create') then raise exception 'Permission denied'; end if;
  if p_workers is null or jsonb_typeof(p_workers) <> 'array' then raise exception 'Workers payload must be an array'; end if;

  for v_item in select value from jsonb_array_elements(p_workers) loop
    begin v_id := (v_item->>'id')::bigint; exception when others then raise exception 'Invalid worker id'; end;
    if v_id is null or v_id <= 0 then raise exception 'Invalid worker id'; end if;

    insert into public.trabajadores(
      owner_id,id,obra_id,supervisor_responsable,num_oferta,obra,categoria,quincena,apellidos_nombre,dni,
      fecha_nacimiento,periodo_inicio,periodo_fin,telefono,calzado,formacion,lugar_formacion,cita_dia,cita_hora,
      sitio_reconocimiento,documentacion_completa,observaciones,fecha_registro,necesita_reconocimiento,
      aptitud_medica,limitaciones_aptitud,reconocimiento_estado,reconocimiento_fecha,reconocimiento_validez,
      reconocimiento_limitaciones,reconocimiento_observaciones,data,created_by,updated_by
    ) values (
      v_user,v_id,
      (select o.id from public.obras o where o.owner_id=v_user and lower(o.nombre)=lower(coalesce(v_item->>'obra','')) order by o.created_at limit 1),
      coalesce(v_item->>'supervisorResponsable',''),coalesce(v_item->>'numOferta',''),coalesce(v_item->>'obra',''),
      coalesce(v_item->>'categoria',''),coalesce(v_item->>'quincena',''),coalesce(v_item->>'apellidosNombre',''),coalesce(v_item->>'dni',''),
      coalesce(v_item->>'fechaNacimiento',''),coalesce(v_item->>'periodoInicio',''),coalesce(v_item->>'periodoFin',''),coalesce(v_item->>'telefono',''),
      coalesce(v_item->>'calzado',''),coalesce(v_item->>'formacion',''),nullif(v_item->>'lugarFormacion',''),coalesce(v_item->>'citaDia',''),
      coalesce(v_item->>'citaHora',''),coalesce(v_item->>'sitioReconocimiento',''),coalesce(v_item->>'documentacionCompleta',''),nullif(v_item->>'observaciones',''),
      coalesce(v_item->>'fechaRegistro',''),nullif(v_item->>'necesitaReconocimiento',''),nullif(v_item->>'aptitudMedica',''),nullif(v_item->>'limitacionesAptitud',''),
      nullif(v_item->>'reconocimientoEstado',''),nullif(v_item->>'reconocimientoFecha',''),nullif(v_item->>'reconocimientoValidez',''),
      nullif(v_item->>'reconocimientoLimitaciones',''),nullif(v_item->>'reconocimientoObservaciones',''),v_item,v_user,v_user
    )
    on conflict (owner_id,id) do update set
      obra_id=excluded.obra_id,supervisor_responsable=excluded.supervisor_responsable,num_oferta=excluded.num_oferta,obra=excluded.obra,
      categoria=excluded.categoria,quincena=excluded.quincena,apellidos_nombre=excluded.apellidos_nombre,dni=excluded.dni,
      fecha_nacimiento=excluded.fecha_nacimiento,periodo_inicio=excluded.periodo_inicio,periodo_fin=excluded.periodo_fin,telefono=excluded.telefono,
      calzado=excluded.calzado,formacion=excluded.formacion,lugar_formacion=excluded.lugar_formacion,cita_dia=excluded.cita_dia,cita_hora=excluded.cita_hora,
      sitio_reconocimiento=excluded.sitio_reconocimiento,documentacion_completa=excluded.documentacion_completa,observaciones=excluded.observaciones,
      fecha_registro=excluded.fecha_registro,necesita_reconocimiento=excluded.necesita_reconocimiento,aptitud_medica=excluded.aptitud_medica,
      limitaciones_aptitud=excluded.limitaciones_aptitud,reconocimiento_estado=excluded.reconocimiento_estado,reconocimiento_fecha=excluded.reconocimiento_fecha,
      reconocimiento_validez=excluded.reconocimiento_validez,reconocimiento_limitaciones=excluded.reconocimiento_limitaciones,
      reconocimiento_observaciones=excluded.reconocimiento_observaciones,data=excluded.data,updated_by=v_user,updated_at=now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
