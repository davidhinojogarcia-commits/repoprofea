-- Flujo de invitación para compartir parques de herramientas y maquinaria.
-- Sustituye la incorporación directa de miembros por invitación -> aceptación.
-- La pertenencia aceptada queda persistente en inventory_park_members hasta revocación.

create table if not exists public.inventory_park_invitations (
  id uuid primary key default gen_random_uuid(),
  park_id uuid not null references public.inventory_parks(id) on delete cascade,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_email text not null,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz null
);

create index if not exists inventory_park_invitations_user_idx
  on public.inventory_park_invitations(invited_user_id,status,created_at desc);
create index if not exists inventory_park_invitations_park_idx
  on public.inventory_park_invitations(park_id,status,created_at desc);
create unique index if not exists inventory_park_invitations_pending_unique
  on public.inventory_park_invitations(park_id,invited_user_id)
  where status='pending';

alter table public.inventory_park_invitations enable row level security;

drop policy if exists inventory_park_invitations_select on public.inventory_park_invitations;
create policy inventory_park_invitations_select
on public.inventory_park_invitations
for select to authenticated
using (
  invited_user_id=(select auth.uid())
  or invited_by=(select auth.uid())
  or private.inventory_is_member(park_id,false)
  or exists(
    select 1 from public.inventory_parks p
    where p.id=park_id and p.created_by=(select auth.uid())
  )
);

-- Las escrituras se realizan solo mediante funciones SECURITY DEFINER.
drop policy if exists inventory_park_invitations_insert on public.inventory_park_invitations;
drop policy if exists inventory_park_invitations_update on public.inventory_park_invitations;
drop policy if exists inventory_park_invitations_delete on public.inventory_park_invitations;

create or replace function public.inventory_create_invitation(p_park_id uuid,p_email text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user_id uuid;
  v_name text;
  v_invitation_id uuid;
  v_park_name text;
begin
  if not (
    private.inventory_is_member(p_park_id,true)
    or exists(
      select 1 from public.inventory_parks p
      where p.id=p_park_id and p.created_by=auth.uid()
    )
  ) then
    raise exception 'Sin permisos para compartir este parque';
  end if;

  select p.id,
         trim(concat_ws(' ',p.nombre,p.apellidos))
  into v_user_id,v_name
  from public.profiles p
  where lower(p.email)=lower(trim(p_email))
    and p.active=true
  limit 1;

  if v_user_id is null then
    raise exception 'No existe un usuario activo con ese correo corporativo';
  end if;

  if v_user_id=auth.uid() then
    raise exception 'No puedes invitarte a ti mismo';
  end if;

  if exists(
    select 1 from public.inventory_park_members m
    where m.park_id=p_park_id and m.user_id=v_user_id and m.active=true
  ) then
    raise exception 'Este supervisor ya comparte el parque';
  end if;

  select nombre into v_park_name
  from public.inventory_parks
  where id=p_park_id;

  select id into v_invitation_id
  from public.inventory_park_invitations
  where park_id=p_park_id
    and invited_user_id=v_user_id
    and status='pending'
  limit 1;

  if v_invitation_id is null then
    insert into public.inventory_park_invitations(
      park_id,invited_user_id,invited_email,invited_by,status
    )
    values(
      p_park_id,v_user_id,lower(trim(p_email)),auth.uid(),'pending'
    )
    returning id into v_invitation_id;
  else
    update public.inventory_park_invitations
    set invited_email=lower(trim(p_email)),
        invited_by=auth.uid(),
        updated_at=now()
    where id=v_invitation_id;
  end if;

  return jsonb_build_object(
    'invitationId',v_invitation_id,
    'email',lower(trim(p_email)),
    'displayName',coalesce(nullif(v_name,''),lower(trim(p_email))),
    'parkName',coalesce(v_park_name,'Parque de maquinaria'),
    'status','pending'
  );
end;
$$;

revoke all on function public.inventory_create_invitation(uuid,text) from public;
grant execute on function public.inventory_create_invitation(uuid,text) to authenticated;

create or replace function public.inventory_respond_invitation(p_invitation_id uuid,p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_inv public.inventory_park_invitations%rowtype;
begin
  select * into v_inv
  from public.inventory_park_invitations
  where id=p_invitation_id
    and invited_user_id=auth.uid()
    and status='pending'
  for update;

  if v_inv.id is null then
    raise exception 'La invitación no existe, ya fue respondida o no te pertenece';
  end if;

  if p_accept then
    insert into public.inventory_park_members(
      park_id,user_id,role,active,created_by
    )
    values(
      v_inv.park_id,auth.uid(),'responsable',true,v_inv.invited_by
    )
    on conflict(park_id,user_id)
    do update set
      role='responsable',
      active=true,
      created_by=v_inv.invited_by;

    update public.inventory_park_invitations
    set status='accepted',responded_at=now(),updated_at=now()
    where id=v_inv.id;

    return jsonb_build_object(
      'ok',true,
      'accepted',true,
      'parkId',v_inv.park_id
    );
  end if;

  update public.inventory_park_invitations
  set status='rejected',responded_at=now(),updated_at=now()
  where id=v_inv.id;

  return jsonb_build_object(
    'ok',true,
    'accepted',false,
    'parkId',v_inv.park_id
  );
end;
$$;

revoke all on function public.inventory_respond_invitation(uuid,boolean) from public;
grant execute on function public.inventory_respond_invitation(uuid,boolean) to authenticated;

create or replace function public.inventory_revoke_member(p_park_id uuid,p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_owner uuid;
begin
  select created_by into v_owner
  from public.inventory_parks
  where id=p_park_id;

  if v_owner is null then
    raise exception 'Parque no encontrado';
  end if;

  if p_user_id=v_owner then
    raise exception 'No se puede revocar al propietario del parque';
  end if;

  if not (
    v_owner=auth.uid()
    or private.inventory_is_member(p_park_id,true)
  ) then
    raise exception 'Sin permisos para revocar este acceso';
  end if;

  update public.inventory_park_members
  set active=false
  where park_id=p_park_id
    and user_id=p_user_id;

  update public.inventory_park_invitations
  set status='revoked',updated_at=now()
  where park_id=p_park_id
    and invited_user_id=p_user_id
    and status='accepted';

  return jsonb_build_object('ok',true,'parkId',p_park_id,'userId',p_user_id);
end;
$$;

revoke all on function public.inventory_revoke_member(uuid,uuid) from public;
grant execute on function public.inventory_revoke_member(uuid,uuid) to authenticated;

create or replace function public.inventory_list_invitations()
returns table(
  invitation_id uuid,
  park_id uuid,
  park_name text,
  park_zone text,
  inviter_name text,
  inviter_email text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path=public
as $$
  select
    i.id,
    i.park_id,
    p.nombre,
    p.zona,
    coalesce(nullif(trim(concat_ws(' ',pr.nombre,pr.apellidos)),''),pr.email),
    pr.email,
    i.created_at
  from public.inventory_park_invitations i
  join public.inventory_parks p on p.id=i.park_id
  left join public.profiles pr on pr.id=i.invited_by
  where i.invited_user_id=(select auth.uid())
    and i.status='pending'
  order by i.created_at desc;
$$;

revoke all on function public.inventory_list_invitations() from public;
grant execute on function public.inventory_list_invitations() to authenticated;

create or replace function public.inventory_list_park_shares(p_park_id uuid)
returns table(
  participant_key text,
  user_id uuid,
  email text,
  display_name text,
  status text,
  role text,
  is_owner boolean,
  accepted_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public
as $$
begin
  if not (
    private.inventory_is_member(p_park_id,false)
    or exists(
      select 1 from public.inventory_parks p
      where p.id=p_park_id and p.created_by=auth.uid()
    )
  ) then
    raise exception 'Sin permisos para consultar los participantes del parque';
  end if;

  return query
  with park as (
    select p.created_by
    from public.inventory_parks p
    where p.id=p_park_id
  ),
  accepted as (
    select
      'user:' || pr.id::text as participant_key,
      pr.id as user_id,
      pr.email,
      coalesce(nullif(trim(concat_ws(' ',pr.nombre,pr.apellidos)),''),pr.email) as display_name,
      'accepted'::text as status,
      case when pr.id=(select created_by from park) then 'propietario' else m.role end as role,
      (pr.id=(select created_by from park)) as is_owner,
      coalesce(
        (
          select max(i.responded_at)
          from public.inventory_park_invitations i
          where i.park_id=p_park_id
            and i.invited_user_id=pr.id
            and i.status='accepted'
        ),
        m.created_at
      ) as accepted_at
    from public.inventory_park_members m
    join public.profiles pr on pr.id=m.user_id
    where m.park_id=p_park_id
      and m.active=true
      and pr.active=true
  ),
  owner_only as (
    select
      'user:' || pr.id::text as participant_key,
      pr.id as user_id,
      pr.email,
      coalesce(nullif(trim(concat_ws(' ',pr.nombre,pr.apellidos)),''),pr.email) as display_name,
      'accepted'::text as status,
      'propietario'::text as role,
      true as is_owner,
      p.created_at as accepted_at
    from public.inventory_parks p
    join public.profiles pr on pr.id=p.created_by
    where p.id=p_park_id
      and not exists(
        select 1 from accepted a where a.user_id=pr.id
      )
  ),
  pending as (
    select
      'invite:' || i.id::text as participant_key,
      pr.id as user_id,
      i.invited_email as email,
      coalesce(nullif(trim(concat_ws(' ',pr.nombre,pr.apellidos)),''),i.invited_email) as display_name,
      'pending'::text as status,
      'responsable'::text as role,
      false as is_owner,
      null::timestamptz as accepted_at
    from public.inventory_park_invitations i
    join public.profiles pr on pr.id=i.invited_user_id
    where i.park_id=p_park_id
      and i.status='pending'
      and not exists(
        select 1 from accepted a where a.user_id=i.invited_user_id
      )
  )
  select * from accepted
  union all
  select * from owner_only
  union all
  select * from pending
  order by is_owner desc,status,display_name;
end;
$$;

revoke all on function public.inventory_list_park_shares(uuid) from public;
grant execute on function public.inventory_list_park_shares(uuid) to authenticated;

-- El RPC antiguo añadía al compañero directamente, sin aceptación.
-- Se revoca para impedir que clientes antiguos puedan saltarse el nuevo flujo.
revoke execute on function public.inventory_add_member_by_email(uuid,text) from authenticated;
