begin;

-- Derive responsibility from the recorded movement, including existing history.
-- No historical assignment is rewritten and editing equipment metadata cannot
-- accidentally change the supervisor responsible for its last movement.
create or replace function public.get_inventory_supervisors(p_park_id uuid)
returns table(item_id uuid,supervisor_id uuid,supervisor_name text)
language sql stable security invoker set search_path=pg_catalog,public as $$
  select i.id,m.created_by,m.created_by_name
  from public.inventory_items i
  cross join lateral (
    select created_by,created_by_name from public.inventory_movements
    where item_id=i.id order by created_at desc,id desc limit 1
  ) m
  where i.park_id=p_park_id and auth.uid() is not null;
$$;
revoke all on function public.get_inventory_supervisors(uuid) from public,anon;
grant execute on function public.get_inventory_supervisors(uuid) to authenticated;

create table if not exists public.inventory_breakdown_mail (
  -- Keep minimal send evidence if a movement is later deleted with its audit.
  movement_id uuid primary key,
  actor_id uuid not null references public.profiles(id),
  status text not null check(status in ('sending','sent','failed','uncertain')),
  attempts integer not null default 1 check(attempts between 1 and 5),
  message_id text,
  error_code text,
  updated_at timestamptz not null default clock_timestamp(),
  check(status <> 'sent' or nullif(btrim(message_id),'') is not null)
);
alter table public.inventory_breakdown_mail enable row level security;
revoke all on public.inventory_breakdown_mail from public,anon,authenticated;
grant select,insert,update on public.inventory_breakdown_mail to service_role;

create or replace function public.inventory_claim_breakdown_mail(p_movement_id uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.inventory_breakdown_mail; v_claimed boolean := false;
begin
  if not exists (
    select 1 from public.inventory_movements m join public.profiles pr on pr.id=p_actor and pr.active
    join public.inventory_parks p on p.id=m.park_id
    where m.id=p_movement_id and m.tipo='Avería' and m.created_by=p_actor
      and (p.created_by=p_actor or exists(select 1 from public.inventory_park_members pm where pm.park_id=p.id and pm.user_id=p_actor and pm.active and pm.role='responsable'))
  ) then raise exception 'Aviso no disponible para este supervisor'; end if;
  insert into public.inventory_breakdown_mail(movement_id,actor_id,status)
    values(p_movement_id,p_actor,'sending') on conflict do nothing returning * into v_row;
  if found then v_claimed := true;
  else
    update public.inventory_breakdown_mail set status='sending',attempts=attempts+1,error_code=null,updated_at=clock_timestamp()
    where movement_id=p_movement_id and actor_id=p_actor and status='failed' and attempts<5 returning * into v_row;
    if found then v_claimed := true;
    else select * into v_row from public.inventory_breakdown_mail where movement_id=p_movement_id and actor_id=p_actor; end if;
  end if;
  return jsonb_build_object('claimed',v_claimed,'status',v_row.status,'messageId',v_row.message_id);
end;
$$;

create or replace function public.inventory_finish_breakdown_mail(p_movement_id uuid,p_actor uuid,p_status text,p_message text default null,p_code text default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_status not in ('sent','failed','uncertain') then raise exception 'Estado de envío inválido'; end if;
  if p_status='sent' and exists(select 1 from public.inventory_breakdown_mail where movement_id=p_movement_id and actor_id=p_actor and status='sent' and message_id=p_message) then return; end if;
  update public.inventory_breakdown_mail set status=p_status,message_id=p_message,error_code=p_code,updated_at=clock_timestamp()
    where movement_id=p_movement_id and actor_id=p_actor and (status='sending' or status='uncertain' and p_status='sent');
  if not found then raise exception 'Intento de envío no disponible'; end if;
end;
$$;
revoke all on function public.inventory_claim_breakdown_mail(uuid,uuid),public.inventory_finish_breakdown_mail(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.inventory_claim_breakdown_mail(uuid,uuid),public.inventory_finish_breakdown_mail(uuid,uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
