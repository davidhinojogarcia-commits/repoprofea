-- Signature-to-signature overlap is an advisory for compact original lists.
-- Row proximity is advisory; retain missing positions, page bounds and name invasion checks.
create or replace function public.mandatory_v2_validate_signature_geometry(p_document_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare
  a public.mandatory_document_workers_v2%rowtype;
  b public.mandatory_document_workers_v2%rowtype;
  v_pages jsonb; v_page jsonb;
  ax numeric; ay numeric; aw numeric; ah numeric;
  bx numeric; by_ numeric; bw numeric; bh numeric;
  own_center numeric; other_center numeric;
begin
  select page_meta into v_pages from public.foreman_mandatory_pdf_files where document_id=p_document_id;
  for a in select * from public.mandatory_document_workers_v2 where document_id=p_document_id and detection_status='CONFIRMED' loop
    if not public.mandatory_v2_box_valid(a.signature_box) then raise exception 'Falta una posición válida para %',a.printed_name; end if;
    ax:=(a.signature_box->>'x')::numeric;ay:=(a.signature_box->>'y')::numeric;
    aw:=(a.signature_box->>'width')::numeric;ah:=(a.signature_box->>'height')::numeric;
    select value into v_page from jsonb_array_elements(coalesce(v_pages,'[]'::jsonb)) where (value->>'page')::integer=a.page;
    if v_page is null or ax+aw>(v_page->>'width')::numeric or ay+ah>(v_page->>'height')::numeric then
      raise exception 'La firma de % queda fuera de la página. Revisa las posiciones o reimporta el original.',a.printed_name;
    end if;
    for b in select * from public.mandatory_document_workers_v2 where document_id=p_document_id and detection_status='CONFIRMED' and id<>a.id and page=a.page loop
      if public.mandatory_v2_box_valid(b.name_box) then
        bx:=(b.name_box->>'x')::numeric;by_:=(b.name_box->>'y')::numeric;
        bw:=(b.name_box->>'width')::numeric;bh:=(b.name_box->>'height')::numeric;
        if ax<bx+bw+2 and ax+aw+2>bx and ay<by_+bh+2 and ay+ah+2>by_ then
          raise exception 'La firma de % invade el nombre de %.',a.printed_name,b.printed_name;
        end if;
        -- Row proximity is reviewed by the supervisor; never reject publication for it.
      end if;
    end loop;
  end loop;
end;
$$;
revoke all on function public.mandatory_v2_validate_signature_geometry(uuid) from public,anon,authenticated;

notify pgrst,'reload schema';

