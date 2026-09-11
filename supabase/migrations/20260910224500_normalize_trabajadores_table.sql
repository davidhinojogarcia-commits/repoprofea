create table if not exists public.trabajadores (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  id bigint not null,
  obra_id uuid null references public.obras(id) on delete set null,
  supervisor_responsable text not null default '',
  num_oferta text not null default '',
  obra text not null default '',
  categoria text not null default '',
  quincena text not null default '',
  apellidos_nombre text not null default '',
  dni text not null default '',
  fecha_nacimiento text not null default '',
  periodo_inicio text not null default '',
  periodo_fin text not null default '',
  telefono text not null default '',
  calzado text not null default '',
  formacion text not null default '',
  lugar_formacion text,
  cita_dia text not null default '',
  cita_hora text not null default '',
  sitio_reconocimiento text not null default '',
  documentacion_completa text not null default '',
  observaciones text,
  fecha_registro text not null default '',
  necesita_reconocimiento text,
  aptitud_medica text,
  limitaciones_aptitud text,
  reconocimiento_estado text,
  reconocimiento_fecha text,
  reconocimiento_validez text,
  reconocimiento_limitaciones text,
  reconocimiento_observaciones text,
  data jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create index if not exists trabajadores_dni_idx on public.trabajadores (lower(dni));
create index if not exists trabajadores_obra_id_idx on public.trabajadores (obra_id);
create index if not exists trabajadores_owner_id_idx on public.trabajadores (owner_id);

insert into public.trabajadores (
  owner_id,id,obra_id,supervisor_responsable,num_oferta,obra,categoria,quincena,apellidos_nombre,dni,
  fecha_nacimiento,periodo_inicio,periodo_fin,telefono,calzado,formacion,lugar_formacion,cita_dia,cita_hora,
  sitio_reconocimiento,documentacion_completa,observaciones,fecha_registro,necesita_reconocimiento,
  aptitud_medica,limitaciones_aptitud,reconocimiento_estado,reconocimiento_fecha,reconocimiento_validez,
  reconocimiento_limitaciones,reconocimiento_observaciones,data,created_by,created_at,updated_by,updated_at
)
select
  w.owner_id,w.id,
  (select o.id from public.obras o where o.owner_id=w.owner_id and lower(o.nombre)=lower(coalesce(w.data->>'obra','')) order by o.created_at limit 1),
  coalesce(w.data->>'supervisorResponsable',''),coalesce(w.data->>'numOferta',''),coalesce(w.data->>'obra',''),
  coalesce(w.data->>'categoria',''),coalesce(w.data->>'quincena',''),coalesce(w.data->>'apellidosNombre',''),
  coalesce(w.data->>'dni',''),coalesce(w.data->>'fechaNacimiento',''),coalesce(w.data->>'periodoInicio',''),
  coalesce(w.data->>'periodoFin',''),coalesce(w.data->>'telefono',''),coalesce(w.data->>'calzado',''),
  coalesce(w.data->>'formacion',''),nullif(w.data->>'lugarFormacion',''),coalesce(w.data->>'citaDia',''),
  coalesce(w.data->>'citaHora',''),coalesce(w.data->>'sitioReconocimiento',''),coalesce(w.data->>'documentacionCompleta',''),
  nullif(w.data->>'observaciones',''),coalesce(w.data->>'fechaRegistro',''),nullif(w.data->>'necesitaReconocimiento',''),
  nullif(w.data->>'aptitudMedica',''),nullif(w.data->>'limitacionesAptitud',''),nullif(w.data->>'reconocimientoEstado',''),
  nullif(w.data->>'reconocimientoFecha',''),nullif(w.data->>'reconocimientoValidez',''),nullif(w.data->>'reconocimientoLimitaciones',''),
  nullif(w.data->>'reconocimientoObservaciones',''),w.data,w.created_by,w.created_at,w.updated_by,w.updated_at
from public.workers w
on conflict (owner_id,id) do update set
  obra_id=excluded.obra_id, supervisor_responsable=excluded.supervisor_responsable, num_oferta=excluded.num_oferta,
  obra=excluded.obra, categoria=excluded.categoria, quincena=excluded.quincena, apellidos_nombre=excluded.apellidos_nombre,
  dni=excluded.dni, fecha_nacimiento=excluded.fecha_nacimiento, periodo_inicio=excluded.periodo_inicio,
  periodo_fin=excluded.periodo_fin, telefono=excluded.telefono, calzado=excluded.calzado, formacion=excluded.formacion,
  lugar_formacion=excluded.lugar_formacion, cita_dia=excluded.cita_dia, cita_hora=excluded.cita_hora,
  sitio_reconocimiento=excluded.sitio_reconocimiento, documentacion_completa=excluded.documentacion_completa,
  observaciones=excluded.observaciones, fecha_registro=excluded.fecha_registro, necesita_reconocimiento=excluded.necesita_reconocimiento,
  aptitud_medica=excluded.aptitud_medica, limitaciones_aptitud=excluded.limitaciones_aptitud,
  reconocimiento_estado=excluded.reconocimiento_estado, reconocimiento_fecha=excluded.reconocimiento_fecha,
  reconocimiento_validez=excluded.reconocimiento_validez, reconocimiento_limitaciones=excluded.reconocimiento_limitaciones,
  reconocimiento_observaciones=excluded.reconocimiento_observaciones, data=excluded.data, updated_by=excluded.updated_by, updated_at=excluded.updated_at;

alter table public.trabajadores enable row level security;

drop policy if exists trabajadores_select on public.trabajadores;
create policy trabajadores_select on public.trabajadores for select to authenticated using (
  private.has_module_permission('trabajadores','read') and (
    owner_id = auth.uid() or private.has_resource_permission('trabajadores', id::text, 'read') or
    (obra_id is not null and private.has_obra_permission(obra_id,'read'))
  )
);

drop policy if exists trabajadores_insert on public.trabajadores;
create policy trabajadores_insert on public.trabajadores for insert to authenticated with check (
  owner_id = auth.uid() and created_by = auth.uid() and updated_by = auth.uid() and
  private.has_module_permission('trabajadores','create') and
  (obra_id is null or private.has_obra_permission(obra_id,'create') or private.is_admin() or owner_id=auth.uid())
);

drop policy if exists trabajadores_update on public.trabajadores;
create policy trabajadores_update on public.trabajadores for update to authenticated using (
  private.has_module_permission('trabajadores','update') and (
    owner_id = auth.uid() or private.has_resource_permission('trabajadores', id::text, 'update') or
    (obra_id is not null and private.has_obra_permission(obra_id,'update'))
  )
) with check (
  private.has_module_permission('trabajadores','update') and updated_by = auth.uid() and (
    owner_id = auth.uid() or private.has_resource_permission('trabajadores', id::text, 'update') or
    (obra_id is not null and private.has_obra_permission(obra_id,'update'))
  )
);

drop policy if exists trabajadores_delete on public.trabajadores;
create policy trabajadores_delete on public.trabajadores for delete to authenticated using (
  private.has_module_permission('trabajadores','delete') and (
    owner_id = auth.uid() or private.has_resource_permission('trabajadores', id::text, 'delete') or
    (obra_id is not null and private.has_obra_permission(obra_id,'delete'))
  )
);

drop trigger if exists trg_trabajadores_metadata on public.trabajadores;
create trigger trg_trabajadores_metadata before insert or update on public.trabajadores for each row execute function public.secure_business_metadata();

drop trigger if exists trg_trabajadores_audit on public.trabajadores;
create trigger trg_trabajadores_audit after insert or update or delete on public.trabajadores for each row execute function public.audit_business_change();

grant select,insert,update,delete on public.trabajadores to authenticated;
