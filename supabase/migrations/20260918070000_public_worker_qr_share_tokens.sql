create table if not exists public.worker_qr_shares (
  token uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  worker_dni text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (owner_id, worker_dni)
);

alter table public.worker_qr_shares enable row level security;
revoke all on table public.worker_qr_shares from anon, authenticated;

create or replace function public.ensure_worker_qr_share(p_worker_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_dni text;
  v_token uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  select t.owner_id,
         upper(regexp_replace(coalesce(t.dni, ''), '[[:space:]-]', '', 'g'))
    into v_owner, v_dni
  from public.trabajadores t
  where t.id = p_worker_id
  limit 1;

  if v_owner is null then
    raise exception 'worker not found';
  end if;
  if v_owner <> (select auth.uid()) then
    raise exception 'only the worker owner can create the QR share';
  end if;
  if coalesce(v_dni, '') = '' then
    raise exception 'worker DNI is required';
  end if;

  insert into public.worker_qr_shares(owner_id, worker_dni, revoked_at)
  values (v_owner, v_dni, null)
  on conflict (owner_id, worker_dni)
  do update set revoked_at = null, updated_at = now()
  returning token into v_token;

  return v_token;
end;
$$;

create or replace function public.resolve_worker_qr_share(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_share public.worker_qr_shares%rowtype;
  v_history jsonb;
begin
  select *
    into v_share
  from public.worker_qr_shares s
  where s.token = p_token
    and s.revoked_at is null
  limit 1;

  if v_share.token is null then
    return jsonb_build_object('valid', false, 'history', '[]'::jsonb);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'supervisorResponsable', t.supervisor_responsable,
        'numOferta', t.num_oferta,
        'obra', t.obra,
        'categoria', t.categoria,
        'quincena', t.quincena,
        'apellidosNombre', t.apellidos_nombre,
        'dni', t.dni,
        'fechaNacimiento', t.fecha_nacimiento,
        'periodoInicio', t.periodo_inicio,
        'periodoFin', t.periodo_fin,
        'telefono', t.telefono,
        'calzado', t.calzado,
        'formacion', t.formacion,
        'lugarFormacion', t.lugar_formacion,
        'citaDia', t.cita_dia,
        'citaHora', t.cita_hora,
        'sitioReconocimiento', t.sitio_reconocimiento,
        'documentacionCompleta', t.documentacion_completa,
        'observaciones', t.observaciones,
        'fechaRegistro', t.fecha_registro,
        'necesitaReconocimiento', t.necesita_reconocimiento,
        'aptitudMedica', t.aptitud_medica,
        'limitacionesAptitud', t.limitaciones_aptitud,
        'reconocimientoEstado', t.reconocimiento_estado,
        'reconocimientoFecha', t.reconocimiento_fecha,
        'reconocimientoValidez', t.reconocimiento_validez,
        'reconocimientoLimitaciones', t.reconocimiento_limitaciones,
        'reconocimientoObservaciones', t.reconocimiento_observaciones
      )
      order by coalesce(t.periodo_inicio, t.fecha_registro::date) desc, t.id desc
    ),
    '[]'::jsonb
  )
  into v_history
  from public.trabajadores t
  where t.owner_id = v_share.owner_id
    and upper(regexp_replace(coalesce(t.dni, ''), '[[:space:]-]', '', 'g')) = v_share.worker_dni;

  if jsonb_array_length(v_history) = 0 then
    return jsonb_build_object('valid', false, 'history', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'valid', true,
    'history', v_history
  );
end;
$$;

revoke all on function public.ensure_worker_qr_share(bigint) from public, anon;
revoke all on function public.resolve_worker_qr_share(uuid) from public;
grant execute on function public.ensure_worker_qr_share(bigint) to authenticated;
grant execute on function public.resolve_worker_qr_share(uuid) to anon, authenticated;
