-- External occupational inspection: opt-in, authenticated email, owner-attested
-- identity, strict per-worker access, short TTL, revocation and audit.
-- Never publish source medical data or signed documents through this mechanism.
create table if not exists public.inspection_access_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  worker_id bigint not null,
  recipient_email text not null,
  access_role text not null check (access_role in ('inspector','direccion_facultativa','coordinador_seguridad')),
  permitted_sections text[] not null,
  identity_verification_note text not null,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists inspection_access_grants_owner_idx
  on public.inspection_access_grants(owner_id, created_at desc);
create table if not exists public.inspection_access_audit (
  id bigint generated always as identity primary key,
  grant_id uuid not null references public.inspection_access_grants(id) on delete restrict,
  actor_id uuid not null,
  event_type text not null check(event_type in ('issued','consulted','revoked')),
  happened_at timestamptz not null default now()
);
create index if not exists inspection_access_audit_grant_idx
  on public.inspection_access_audit(grant_id, happened_at desc);
alter table public.inspection_access_grants enable row level security;
alter table public.inspection_access_audit enable row level security;
revoke all on public.inspection_access_grants, public.inspection_access_audit from public, anon, authenticated;
revoke all on sequence public.inspection_access_audit_id_seq from public, anon, authenticated;

create or replace function public.issue_inspection_access(
  p_worker_id bigint, p_recipient_email text, p_role text,
  p_sections text[], p_duration_minutes integer, p_verification_note text
) returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_sections text[];
  v_allowed text[];
  v_id uuid;
begin
  if v_owner is null then raise exception 'Sesión autenticada requerida'; end if;
  if not exists (
    select 1 from public.trabajadores t
    where t.id = p_worker_id and t.owner_id = v_owner
  ) then raise exception 'Trabajador no disponible para este supervisor'; end if;
  if p_role not in ('inspector','direccion_facultativa','coordinador_seguridad') then
    raise exception 'Perfil no permitido'; end if;
  if p_duration_minutes is null or p_duration_minutes < 5 or p_duration_minutes > 60 then
    raise exception 'Duración fuera del intervalo permitido'; end if;
  if p_recipient_email is null or length(trim(p_recipient_email)) > 254
    or trim(p_recipient_email) !~* '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$' then
    raise exception 'Correo de destinatario no válido'; end if;
  if length(trim(coalesce(p_verification_note,''))) < 15
    or length(p_verification_note) > 500 then
    raise exception 'Debe documentarse cómo se verificó la identidad profesional'; end if;
  v_allowed := case p_role
    when 'inspector' then array['identity','employment','worksite','prevention','medical_conclusion']
    when 'coordinador_seguridad' then array['identity','worksite','prevention','medical_conclusion']
    else array['identity','worksite','prevention'] end;
  select array_agg(distinct s order by s) into v_sections
    from unnest(coalesce(p_sections,array[]::text[])) s;
  if v_sections is null or not (v_sections @> array['identity']::text[])
    or not (v_sections <@ v_allowed) then
    raise exception 'Apartados no autorizados para este perfil'; end if;
  insert into public.inspection_access_grants(
    owner_id,worker_id,recipient_email,access_role,
    permitted_sections,identity_verification_note,expires_at)
    values (v_owner,p_worker_id,lower(trim(p_recipient_email)),p_role,
      v_sections,trim(p_verification_note),now()+make_interval(mins=>p_duration_minutes))
    returning id into v_id;
  insert into public.inspection_access_audit(grant_id,actor_id,event_type)
    values(v_id,v_owner,'issued');
  return v_id;
end;
$$;

create or replace function public.read_inspection_access(p_grant_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_grant public.inspection_access_grants%rowtype;
  v_worker record;
  v_medical text;
  v_training text;
begin
  if v_user is null then raise exception 'Inicia sesión con el correo autorizado'; end if;
  select lower(email) into v_email from auth.users
    where id=v_user and email_confirmed_at is not null;
  if v_email is null then raise exception 'Correo no verificado'; end if;
  select * into v_grant from public.inspection_access_grants
    where id=p_grant_id and recipient_email=v_email
      and revoked_at is null and expires_at > now();
  if not found then raise exception 'Acceso no autorizado, revocado o caducado'; end if;
  select t.apellidos_nombre, t.categoria, t.obra, t.periodo_inicio, t.periodo_fin,
         t.formacion, t.aptitud_medica, t.reconocimiento_estado
    into v_worker
    from public.trabajadores t
    where t.id=v_grant.worker_id and t.owner_id=v_grant.owner_id;
  if not found then raise exception 'Ficha no disponible'; end if;
  v_medical := coalesce(nullif(trim(v_worker.aptitud_medica),''),nullif(trim(v_worker.reconocimiento_estado),''));
  v_medical := case
    when lower(v_medical)='apto' then 'Apto'
    when lower(v_medical)='no apto' then 'No apto'
    when lower(v_medical) in ('apto con limitaciones','apto con limitación') then 'Apto con limitaciones'
    else 'Sin conclusión verificada' end;
  v_training := case
    when lower(trim(coalesce(v_worker.formacion,''))) in ('sí','si') then 'Consta en ficha'
    when lower(trim(coalesce(v_worker.formacion,''))) in ('no','pendiente') then 'No consta acreditación en ficha'
    else 'Pendiente de verificar' end;
  insert into public.inspection_access_audit(grant_id,actor_id,event_type)
    values(v_grant.id,v_user,'consulted');
  return jsonb_build_object(
    'role',v_grant.access_role,'expiresAt',v_grant.expires_at,
    'sections',v_grant.permitted_sections,
    'worker',jsonb_strip_nulls(jsonb_build_object(
      'name',case when 'identity'=any(v_grant.permitted_sections) then v_worker.apellidos_nombre else null end,
      'category',case when 'identity'=any(v_grant.permitted_sections) then v_worker.categoria else null end,
      'worksite',case when 'worksite'=any(v_grant.permitted_sections) then v_worker.obra else null end,
      'periodStart',case when 'employment'=any(v_grant.permitted_sections) then v_worker.periodo_inicio else null end,
      'periodEnd',case when 'employment'=any(v_grant.permitted_sections) then v_worker.periodo_fin else null end,
      'trainingRecord',case when 'prevention'=any(v_grant.permitted_sections) then v_training else null end,
      'aptitudeConclusion',case when 'medical_conclusion'=any(v_grant.permitted_sections) then v_medical else null end
    )),
    'notice','Extracto informativo. No sustituye documentos originales ni acredita alta o contratación vigente.'
  );
end;
$$;

create or replace function public.revoke_inspection_access(p_grant_id uuid)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'Sesión requerida'; end if;
  update public.inspection_access_grants
    set revoked_at=now()
    where id=p_grant_id and owner_id=v_owner and revoked_at is null;
  if not found then return false; end if;
  insert into public.inspection_access_audit(grant_id,actor_id,event_type)
    values(p_grant_id,v_owner,'revoked');
  return true;
end;
$$;

create or replace function public.list_inspection_access(p_worker_id bigint)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',g.id,'role',g.access_role,'email',g.recipient_email,
    'expiresAt',g.expires_at,'revokedAt',g.revoked_at,
    'createdAt',g.created_at) order by g.created_at desc),'[]'::jsonb)
  from public.inspection_access_grants g
  where auth.uid() is not null and g.owner_id=auth.uid()
    and g.worker_id=p_worker_id
    and exists (select 1 from public.trabajadores t where t.id=g.worker_id and t.owner_id=auth.uid());
$$;

revoke all on function public.issue_inspection_access(bigint,text,text,text[],integer,text) from public, anon;
revoke all on function public.read_inspection_access(uuid) from public, anon;
revoke all on function public.revoke_inspection_access(uuid) from public, anon;
revoke all on function public.list_inspection_access(bigint) from public, anon;
grant execute on function public.issue_inspection_access(bigint,text,text,text[],integer,text) to authenticated;
grant execute on function public.read_inspection_access(uuid) to authenticated;
grant execute on function public.revoke_inspection_access(uuid) to authenticated;
grant execute on function public.list_inspection_access(bigint) to authenticated;
