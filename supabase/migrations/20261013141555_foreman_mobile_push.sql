-- Device endpoints and credentials are accessible only through scoped RPCs.
create table public.foreman_push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 access_id uuid not null references public.foreman_portal_access(id) on delete cascade,
 endpoint text not null unique, keys jsonb not null, access_token_hash text not null,
 active boolean not null default true, updated_at timestamptz not null default now()
);
create index foreman_push_access_idx on public.foreman_push_subscriptions(access_id);
create table public.foreman_push_deliveries (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.foreman_mandatory_documents(id) on delete cascade,
 subscription_id uuid not null references public.foreman_push_subscriptions(id) on delete cascade,
 assigned_at timestamptz not null, status text not null default 'pending' check(status in ('pending','sending','accepted','failed','expired')),
 attempts integer not null default 0, lease uuid, leased_at timestamptz, status_code integer,
 updated_at timestamptz not null default now(),
 unique(document_id,assigned_at,subscription_id)
);
create index foreman_push_subscription_idx on public.foreman_push_deliveries(subscription_id);
alter table public.foreman_push_subscriptions enable row level security;
alter table public.foreman_push_deliveries enable row level security;
revoke all on public.foreman_push_subscriptions, public.foreman_push_deliveries from anon, authenticated;

create function public.register_foreman_push_subscription(p_token text,p_subscription jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a public.foreman_portal_access%rowtype; e text:=p_subscription->>'endpoint'; s public.foreman_push_subscriptions%rowtype; saved uuid;
begin
 select * into a from public.foreman_portal_access where active and token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex') for update;
 if not found then raise exception 'Acceso no válido'; end if;
 if length(e)>2048 or e !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)/[^[:space:]]+$'
   or coalesce(p_subscription#>>'{keys,p256dh}','') !~ '^[A-Za-z0-9_-]{87}={0,1}$'
   or coalesce(p_subscription#>>'{keys,auth}','') !~ '^[A-Za-z0-9_-]{22}={0,2}$' then raise exception 'Suscripción no válida'; end if;
 select * into s from public.foreman_push_subscriptions where endpoint=e for update;
 if found and s.access_id<>a.id then
   if s.active and exists(select 1 from public.foreman_portal_access where id=s.access_id and active and token_hash=s.access_token_hash) then raise exception 'Desactiva primero los avisos de la otra obra en este dispositivo'; end if;
   delete from public.foreman_push_subscriptions where id=s.id; s.id:=null;
 end if;
 if (s.id is null or not s.active) and (select count(*) from public.foreman_push_subscriptions where access_id=a.id and active)>=10 then raise exception 'Límite de dispositivos alcanzado'; end if;
 insert into public.foreman_push_subscriptions(access_id,endpoint,keys,access_token_hash) values(a.id,e,jsonb_build_object('p256dh',p_subscription#>>'{keys,p256dh}','auth',p_subscription#>>'{keys,auth}'),a.token_hash)
 on conflict(endpoint) do update set active=true,keys=excluded.keys,access_token_hash=excluded.access_token_hash,updated_at=now()
 where foreman_push_subscriptions.access_id=a.id returning id into saved;
 if saved is null then raise exception 'Dispositivo vinculado a otra obra'; end if;
 return jsonb_build_object('ok',true);
end $$;
create function public.unregister_foreman_push_subscription(p_token text,p_endpoint text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a uuid;
begin
 select id into a from public.foreman_portal_access where active and token_hash=encode(digest(trim(coalesce(p_token,'')),'sha256'),'hex');
 if a is null then raise exception 'Acceso no válido'; end if;
 update public.foreman_push_subscriptions set active=false,updated_at=now() where access_id=a and endpoint=p_endpoint;
 return jsonb_build_object('ok',true);
end $$;

create function public.claim_foreman_document_push(p_document_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare d public.foreman_mandatory_documents%rowtype; result jsonb; batch jsonb; total integer; accepted integer; remaining integer; deferred_failures integer;
begin
 select * into d from public.foreman_mandatory_documents where id=p_document_id and owner_id=auth.uid() for update;
 if not found or d.assigned_at is null or d.lifecycle_status not in ('ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION') then raise exception 'Documento no publicado o no autorizado'; end if;
 -- Bound retained history per document; no PDF or personal names are stored here.
 delete from public.foreman_push_deliveries where document_id=d.id and assigned_at<>d.assigned_at and updated_at<now()-interval '90 days';
 insert into public.foreman_push_deliveries(document_id,subscription_id,assigned_at)
 select d.id,s.id,d.assigned_at from public.foreman_push_subscriptions s join public.foreman_portal_access a on a.id=s.access_id
 where s.active and a.active and s.access_token_hash=a.token_hash and a.owner_id=d.owner_id and lower(a.obra)=lower(d.obra)
 on conflict(document_id,assigned_at,subscription_id) do nothing;
 with claimed as (
 update public.foreman_push_deliveries x set status='sending',attempts=attempts+1,lease=gen_random_uuid(),leased_at=now(),updated_at=now()
 where document_id=d.id and assigned_at=d.assigned_at and attempts<3 and
 (status='pending' or (status='failed' and updated_at<now()-interval '30 seconds') or (status='sending' and leased_at<now()-interval '2 minutes'))
 and exists(select 1 from public.foreman_push_subscriptions s join public.foreman_portal_access a on a.id=s.access_id
 where s.id=x.subscription_id and s.active and a.active and s.access_token_hash=a.token_hash and a.owner_id=d.owner_id and lower(a.obra)=lower(d.obra))
 returning x.id,x.subscription_id,x.lease
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'lease',c.lease,'endpoint',s.endpoint,'keys',s.keys)),'[]') into batch
 from claimed c join public.foreman_push_subscriptions s on s.id=c.subscription_id;
 select count(*),count(*) filter(where x.status='accepted'),count(*) filter(where x.status in ('pending','sending')),count(*) filter(where x.status in ('failed','expired')) into total,accepted,remaining,deferred_failures
 from public.foreman_push_deliveries x join public.foreman_push_subscriptions s on s.id=x.subscription_id join public.foreman_portal_access a on a.id=s.access_id
 where x.document_id=d.id and x.assigned_at=d.assigned_at and a.active and s.access_token_hash=a.token_hash and a.owner_id=d.owner_id and lower(a.obra)=lower(d.obra);
 return jsonb_build_object('obra',d.obra,'documentType',d.document_type,'period',d.period_key,'assignedAt',d.assigned_at,'deliveries',batch,'total',total,'accepted',accepted,'failed',deferred_failures,'inFlight',remaining-jsonb_array_length(batch));
end $$;

create function public.finish_foreman_document_push(p_delivery_id uuid,p_lease uuid,p_status_code integer) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s uuid;
begin
 update public.foreman_push_deliveries x set status=case when p_status_code between 200 and 299 then 'accepted' when p_status_code in (404,410) then 'expired' else 'failed' end,
 status_code=p_status_code,updated_at=now()
 where x.id=p_delivery_id and x.lease=p_lease and x.status='sending' and exists(select 1 from public.foreman_mandatory_documents d where d.id=x.document_id and d.owner_id=auth.uid())
 returning subscription_id into s;
 if s is null then raise exception 'Aviso no autorizado o concesión caducada'; end if;
 if p_status_code in (404,410) then update public.foreman_push_subscriptions set active=false,updated_at=now() where id=s; end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.register_foreman_push_subscription(text,jsonb),public.unregister_foreman_push_subscription(text,text),public.claim_foreman_document_push(uuid),public.finish_foreman_document_push(uuid,uuid,integer) from public;
grant execute on function public.register_foreman_push_subscription(text,jsonb),public.unregister_foreman_push_subscription(text,text) to anon,authenticated;
grant execute on function public.claim_foreman_document_push(uuid),public.finish_foreman_document_push(uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
