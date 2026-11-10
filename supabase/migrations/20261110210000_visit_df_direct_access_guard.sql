-- Direct personal link / QR access to DF drafting only. A link is a bearer credential,
-- not proof of professional identity and never grants signing or order approval.
create or replace function public.visit_df_open(p_id uuid,p_token_hash text,p_session_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v public.visit_df_invitations; r public.visit_minutes;
begin
 select * into v from public.visit_df_invitations where id=p_id for update;
 if not found or v.revoked or v.expires_at<=now() or v.token_hash is distinct from p_token_hash
    or p_session_hash !~ '^[0-9a-f]{64}$' then return false; end if;
 select * into r from public.visit_minutes where id=v.record_id for update;
 if not found or r.status<>'draft' or r.version<>v.version
    or not public.visit_minutes_owner_can_write(r.owner_id,r.obra_id)
    or not exists (select 1 from jsonb_array_elements(coalesce(r.state->'participants','[]'::jsonb)) p
                   where p->>'id'=v.person_id::text
                     and lower(btrim(coalesce(p->>'email','')))=v.email
                     and (p->>'role' ~* 'arquitect|direcci[oó]n|director|facultativ'))
 then return false; end if;
 update public.visit_df_invitations set session_hash=p_session_hash,
    session_expires_at=least(now()+interval '2 hours',v.expires_at),
    otp_hash=null,otp_expires_at=null where id=v.id;
 return true;
end $$;
revoke all on function public.visit_df_open(uuid,text,text) from public,anon,authenticated;
grant execute on function public.visit_df_open(uuid,text,text) to service_role;

-- This trigger uses the same visit_minutes row lock as visit_df_submit.
-- Draft -> review/signing must not race with unreviewed contributions.
create or replace function public.visit_df_block_unreviewed_close()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='draft' and new.status<>'draft'
    and exists(select 1 from public.visit_df_contributions c
               where c.record_id=old.id and c.version=old.version and c.status='pending')
 then
   raise exception 'Existen aportaciones de Dirección Facultativa pendientes de revisión';
 end if;
 return new;
end $$;
drop trigger if exists visit_df_close_guard on public.visit_minutes;
create trigger visit_df_close_guard before update of status on public.visit_minutes
for each row execute function public.visit_df_block_unreviewed_close();
revoke all on function public.visit_df_block_unreviewed_close() from public,anon,authenticated;
