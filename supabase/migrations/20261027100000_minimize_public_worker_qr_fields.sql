-- Limit anonymous worker-QR lookup to the minimum inspection-facing fields.
-- The shared QR is a bearer token; do not return private payroll, contact,
-- medical, observations or full government identifiers to an anonymous caller.
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
  select * into v_share
  from public.worker_qr_shares s
  where s.token = p_token and s.revoked_at is null
  limit 1;

  if v_share.token is null then
    return jsonb_build_object('valid', false, 'history', '[]'::jsonb);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'apellidosNombre', t.apellidos_nombre,
        'dni', case
          when length(regexp_replace(coalesce(t.dni, ''), '[[:space:]-]', '', 'g')) >= 4
          then '****' || right(regexp_replace(t.dni, '[[:space:]-]', '', 'g'), 4)
          else '****'
        end,
        'obra', t.obra,
        'categoria', t.categoria,
        'periodoInicio', t.periodo_inicio,
        'periodoFin', t.periodo_fin,
        'documentacionCompleta', t.documentacion_completa
      )
      order by coalesce(nullif(t.periodo_inicio, ''), nullif(t.fecha_registro, '')) desc, t.id desc
    ),
    '[]'::jsonb
  ) into v_history
  from public.trabajadores t
  where t.owner_id = v_share.owner_id
    and upper(regexp_replace(coalesce(t.dni, ''), '[[:space:]-]', '', 'g')) = v_share.worker_dni;

  if jsonb_array_length(v_history) = 0 then
    return jsonb_build_object('valid', false, 'history', '[]'::jsonb);
  end if;
  return jsonb_build_object('valid', true, 'history', v_history);
end;
$$;

revoke all on function public.resolve_worker_qr_share(uuid) from public;
grant execute on function public.resolve_worker_qr_share(uuid) to anon, authenticated;
