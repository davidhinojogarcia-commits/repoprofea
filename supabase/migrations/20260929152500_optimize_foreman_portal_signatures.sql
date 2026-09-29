CREATE OR REPLACE FUNCTION public.save_foreman_attendance(p_token text, p_work_date date, p_rows jsonb, p_status text DEFAULT 'draft'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_access public.foreman_portal_access%rowtype;
  v_hash text;
  v_id uuid;
  v_status text;
  v_existing public.foreman_attendance_days%rowtype;
  v_merged_rows jsonb;
begin
  v_hash:=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
  select * into v_access
    from public.foreman_portal_access
   where token_hash=v_hash and active=true
   limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;

  v_status:=case when p_status in ('draft','completed') then p_status else 'draft' end;

  select * into v_existing
    from public.foreman_attendance_days
   where owner_id=v_access.owner_id
     and lower(obra)=lower(v_access.obra)
     and work_date=p_work_date
   limit 1;

  if found and v_existing.status='reviewed' and not v_existing.correction_pending then
    raise exception 'Jornada bloqueada tras revisión del supervisor';
  end if;
  if found and v_existing.status='completed' and not v_existing.correction_pending then
    raise exception 'Jornada finalizada. El supervisor debe devolverla para corrección';
  end if;

  select coalesce(jsonb_agg(
    n.row
    || case
         when n.row ? 'entrySignature' then jsonb_build_object('entrySignature',n.row->'entrySignature')
         when old.row ? 'entrySignature' then jsonb_build_object('entrySignature',old.row->'entrySignature')
         else '{}'::jsonb
       end
    || case
         when n.row ? 'exitSignature' then jsonb_build_object('exitSignature',n.row->'exitSignature')
         when old.row ? 'exitSignature' then jsonb_build_object('exitSignature',old.row->'exitSignature')
         else '{}'::jsonb
       end
    order by n.ord
  ),'[]'::jsonb)
  into v_merged_rows
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) with ordinality as n(row,ord)
  left join lateral (
    select e as row
      from jsonb_array_elements(coalesce(v_existing.rows,'[]'::jsonb)) e
     where e->>'workerId'=n.row->>'workerId'
     limit 1
  ) old on true;

  insert into public.foreman_attendance_days(
    owner_id,obra,work_date,foreman_name,rows,status,completed_at,updated_at,correction_pending
  )
  values(
    v_access.owner_id,v_access.obra,p_work_date,v_access.foreman_name,
    coalesce(v_merged_rows,'[]'::jsonb),v_status,
    case when v_status='completed' then now() else null end,now(),
    case when v_status='completed' then false else coalesce(v_existing.correction_pending,false) end
  )
  on conflict(owner_id,obra,work_date) do update
    set rows=excluded.rows,
        foreman_name=excluded.foreman_name,
        status=excluded.status,
        completed_at=case when excluded.status='completed' then now() else public.foreman_attendance_days.completed_at end,
        correction_pending=case when excluded.status='completed' then false else public.foreman_attendance_days.correction_pending end,
        updated_at=now()
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sign_foreman_attendance(p_token text, p_work_date date, p_rows jsonb, p_worker_id bigint, p_kind text, p_signature text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_access public.foreman_portal_access%rowtype;
  v_hash text;
  v_id uuid;
  v_existing public.foreman_attendance_days%rowtype;
  v_merged_rows jsonb;
  v_signed_rows jsonb;
  v_signature_key text;
begin
  if p_kind not in ('entry','exit') then
    raise exception 'Tipo de firma no válido';
  end if;
  if length(trim(coalesce(p_signature,''))) < 20 then
    raise exception 'Firma no válida';
  end if;

  v_signature_key:=case when p_kind='entry' then 'entrySignature' else 'exitSignature' end;
  v_hash:=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');

  select * into v_access
    from public.foreman_portal_access
   where token_hash=v_hash and active=true
   limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;

  select * into v_existing
    from public.foreman_attendance_days
   where owner_id=v_access.owner_id
     and lower(obra)=lower(v_access.obra)
     and work_date=p_work_date
   limit 1;

  if found and v_existing.status='reviewed' and not v_existing.correction_pending then
    raise exception 'Jornada bloqueada tras revisión del supervisor';
  end if;
  if found and v_existing.status='completed' and not v_existing.correction_pending then
    raise exception 'Jornada finalizada. El supervisor debe devolverla para corrección';
  end if;

  select coalesce(jsonb_agg(
    n.row
    || case
         when n.row ? 'entrySignature' then jsonb_build_object('entrySignature',n.row->'entrySignature')
         when old.row ? 'entrySignature' then jsonb_build_object('entrySignature',old.row->'entrySignature')
         else '{}'::jsonb
       end
    || case
         when n.row ? 'exitSignature' then jsonb_build_object('exitSignature',n.row->'exitSignature')
         when old.row ? 'exitSignature' then jsonb_build_object('exitSignature',old.row->'exitSignature')
         else '{}'::jsonb
       end
    order by n.ord
  ),'[]'::jsonb)
  into v_merged_rows
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) with ordinality as n(row,ord)
  left join lateral (
    select e as row
      from jsonb_array_elements(coalesce(v_existing.rows,'[]'::jsonb)) e
     where e->>'workerId'=n.row->>'workerId'
     limit 1
  ) old on true;

  if not exists (
    select 1
      from jsonb_array_elements(coalesce(v_merged_rows,'[]'::jsonb)) e
     where e->>'workerId'=p_worker_id::text
  ) then
    raise exception 'Trabajador no encontrado en la jornada';
  end if;

  select coalesce(jsonb_agg(
    case
      when e.row->>'workerId'=p_worker_id::text
        then e.row || jsonb_build_object(v_signature_key,p_signature)
      else e.row
    end
    order by e.ord
  ),'[]'::jsonb)
  into v_signed_rows
  from jsonb_array_elements(v_merged_rows) with ordinality as e(row,ord);

  insert into public.foreman_attendance_days(
    owner_id,obra,work_date,foreman_name,rows,status,completed_at,updated_at,correction_pending
  )
  values(
    v_access.owner_id,v_access.obra,p_work_date,v_access.foreman_name,
    v_signed_rows,'draft',null,now(),coalesce(v_existing.correction_pending,false)
  )
  on conflict(owner_id,obra,work_date) do update
    set rows=excluded.rows,
        foreman_name=excluded.foreman_name,
        status='draft',
        updated_at=now()
  returning id into v_id;

  return v_id;
end;
$function$;

revoke execute on function public.sign_foreman_attendance(text,date,jsonb,bigint,text,text) from public;

grant execute on function public.sign_foreman_attendance(text,date,jsonb,bigint,text,text) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_foreman_portal(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
        'id',t.id,'apellidosNombre',t.apellidos_nombre,'dni',t.dni,'categoria',t.categoria,'obra',t.obra,
        'numOferta',t.num_oferta,'quincena',t.quincena,'periodoInicio',t.periodo_inicio,'periodoFin',t.periodo_fin,
        'telefono',t.telefono,'calzado',t.calzado,'formacion',t.formacion,'lugarFormacion',t.lugar_formacion,
        'aptitudMedica',t.aptitud_medica,'limitacionesAptitud',t.limitaciones_aptitud,
        'reconocimientoEstado',t.reconocimiento_estado,'reconocimientoFecha',t.reconocimiento_fecha,
        'reconocimientoValidez',t.reconocimiento_validez,'reconocimientoLimitaciones',t.reconocimiento_limitaciones,
        'reconocimientoObservaciones',t.reconocimiento_observaciones
      ) order by t.apellidos_nombre)
      from public.trabajadores t
      where t.owner_id=v_access.owner_id and lower(t.obra)=lower(v_access.obra)
    ),'[]'::jsonb),
    'attendance',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,
        'workDate',a.work_date,
        'rows',coalesce((
          select jsonb_agg(
            (r.row - 'entrySignature' - 'exitSignature')
            || case when length(coalesce(r.row->>'entrySignature',''))>0 then jsonb_build_object('entrySignature','signed') else '{}'::jsonb end
            || case when length(coalesce(r.row->>'exitSignature',''))>0 then jsonb_build_object('exitSignature','signed') else '{}'::jsonb end
            order by r.ord
          )
          from jsonb_array_elements(coalesce(a.rows,'[]'::jsonb)) with ordinality as r(row,ord)
        ),'[]'::jsonb),
        'status',a.status,'completedAt',a.completed_at,'updatedAt',a.updated_at,
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
        'workerId',d.worker_id,'workerSnapshot',d.worker_snapshot,'answers',d.answers,
        'signatures',case
          when d.correction_pending then d.signatures
          else coalesce((
            select jsonb_object_agg(k,'signed')
            from jsonb_object_keys(coalesce(d.signatures,'{}'::jsonb)) k
          ),'{}'::jsonb)
        end,
        'status',d.status,'completedAt',d.completed_at,
        'correctionPending',d.correction_pending,'correctionReason',d.correction_reason,
        'correctionRequestedAt',d.correction_requested_at
      ) order by d.created_at desc)
      from public.foreman_documents d
      where d.owner_id=v_access.owner_id
        and lower(d.obra)=lower(v_access.obra)
        and d.created_at>=now()-interval '90 days'
    ),'[]'::jsonb),
    'mandatoryDocuments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'workDate',m.work_date,'periodKey',m.period_key,'documentType',m.document_type,
        'category',m.category,'workers',m.workers,
        'signatures',coalesce((
          select jsonb_object_agg(k,'signed')
          from jsonb_object_keys(coalesce(m.signatures,'{}'::jsonb)) k
        ),'{}'::jsonb),
        'status',m.status,'completedAt',m.completed_at,'details',m.details,
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
$function$;

revoke execute on function public.resolve_foreman_portal(text) from public;

grant execute on function public.resolve_foreman_portal(text) to anon, authenticated;