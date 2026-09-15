create or replace function public.scanner_mobile_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session public.scanner_sessions%rowtype;
begin
  select * into v_session
  from public.scanner_sessions
  where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex')
    and status = 'active'
    and expires_at > now()
  limit 1;

  if v_session.id is null then
    return jsonb_build_object('valid', false);
  end if;

  update public.scanner_sessions
  set paired_at = coalesce(paired_at, now()), last_seen_at = now()
  where id = v_session.id;

  return jsonb_build_object('valid', true, 'expires_at', v_session.expires_at);
end;
$$;

create or replace function public.scanner_mobile_upload(p_token text, p_image_data text, p_file_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session_id uuid;
  v_capture_id uuid;
begin
  if length(coalesce(p_image_data,'')) < 100 then
    raise exception 'invalid image';
  end if;
  if length(p_image_data) > 6000000 then
    raise exception 'image too large';
  end if;

  select id into v_session_id
  from public.scanner_sessions
  where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex')
    and status = 'active'
    and expires_at > now()
  limit 1;

  if v_session_id is null then
    raise exception 'scanner session expired';
  end if;

  insert into public.scanner_captures(session_id, image_data, file_name)
  values (v_session_id, p_image_data, left(coalesce(p_file_name,'captura.jpg'), 180))
  returning id into v_capture_id;

  update public.scanner_sessions set last_seen_at = now() where id = v_session_id;
  return v_capture_id;
end;
$$;

grant execute on function public.scanner_mobile_status(text) to anon, authenticated;
grant execute on function public.scanner_mobile_upload(text, text, text) to anon, authenticated;
