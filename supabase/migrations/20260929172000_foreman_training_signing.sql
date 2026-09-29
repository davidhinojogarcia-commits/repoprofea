create or replace function public.create_foreman_operational_document(
  p_token text,
  p_document_type text,
  p_work_date date,
  p_worker_ids bigint[],
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  v_access public.foreman_portal_access%rowtype;
  v_hash text;
  v_workers jsonb;
  v_id uuid;
  v_type text := trim(coalesce(p_document_type,''));
begin
  if v_type not in ('epis','formacion','maquinaria','autorizacion_uso_maquinaria') then
    raise exception 'Tipo de documento no permitido';
  end if;

  v_hash := encode(digest(trim(coalesce(p_token,'')), 'sha256'), 'hex');
  select * into v_access
    from public.foreman_portal_access
   where token_hash=v_hash and active=true
   limit 1;
  if not found then raise exception 'Acceso no válido o revocado'; end if;

  if coalesce(array_length(p_worker_ids,1),0)=0 then
    raise exception 'Selecciona al menos un trabajador';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,
    'apellidosNombre',t.apellidos_nombre,
    'dni',t.dni,
    'categoria',t.categoria,
    'obra',t.obra,
    'numOferta',t.num_oferta,
    'quincena',t.quincena,
    'periodoInicio',t.periodo_inicio,
    'periodoFin',t.periodo_fin,
    'calzado',t.calzado,
    'formacion',t.formacion
  ) order by t.apellidos_nombre),'[]'::jsonb)
  into v_workers
  from public.trabajadores t
  where t.owner_id=v_access.owner_id
    and lower(t.obra)=lower(v_access.obra)
    and t.id=any(p_worker_ids);

  if jsonb_array_length(v_workers)=0 then
    raise exception 'No hay trabajadores válidos para esta obra';
  end if;

  insert into public.foreman_mandatory_documents(
    owner_id,obra,period_key,work_date,document_type,category,
    workers,signatures,status,details,updated_at
  ) values(
    v_access.owner_id,
    v_access.obra,
    'encargado:'||v_type||':'||to_char(coalesce(p_work_date,current_date),'YYYY-MM-DD')||':'||encode(gen_random_bytes(6),'hex'),
    coalesce(p_work_date,current_date),
    v_type,
    '',
    v_workers,
    '{}'::jsonb,
    'pending',
    coalesce(p_details,'{}'::jsonb),
    now()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

revoke execute on function public.create_foreman_operational_document(text,text,date,bigint[],jsonb) from public;
grant execute on function public.create_foreman_operational_document(text,text,date,bigint[],jsonb) to anon, authenticated;
