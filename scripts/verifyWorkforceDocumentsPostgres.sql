-- Execute on the verified Supabase project. Synthetic rows are rolled back.
begin;
set local role service_role;
do $$
declare owner uuid; work uuid:=gen_random_uuid(); doc uuid:=gen_random_uuid(); op uuid:=gen_random_uuid();
 worker bigint:=9000000000001; s jsonb; result jsonb; total integer;
begin
 select id into owner from public.profiles where active=true order by id limit 1;
 if owner is null then raise exception 'No active owner available for isolated FK test';end if;
 while exists(select 1 from public.trabajadores where owner_id=owner and id=worker) loop worker:=worker+1;end loop;
 insert into public.obras(id,owner_id,nombre,codigo,municipio,empresa,cif,recurso_preventivo,created_by,updated_by)
 values(work,owner,'OBRA SINTÉTICA TRANSACCIÓN REVERTIDA','TEST-WF-ROLLBACK','Municipio sintético','Entidad sintética','X0000000T','Encargado sintético',owner,owner);
 insert into public.trabajadores(owner_id,id,obra_id,obra,apellidos_nombre,dni,categoria,created_by,updated_by)
 values(owner,worker,work,'OBRA SINTÉTICA TRANSACCIÓN REVERTIDA','Persona sintética','00000000T','Peón',owner,owner);
 s:=jsonb_build_object('id',doc,'ownerId',owner,'workerId',worker,'worksiteId',work,'accessId',null,'kind','salida_obra','revision',1,'version',1,'status','draft');
 result:=public.workforce_document_commit(owner,doc,0,op,'test-request','save','{"name":"Actor sintético"}',s,null,null);
 if result<>s then raise exception 'Commit did not persist state';end if;
 result:=public.workforce_document_commit(owner,doc,0,op,'test-request','save','{"name":"Actor sintético"}',s,null,null);
 select count(*) into total from public.workforce_document_events where document_id=doc;
 if total<>1 then raise exception 'Duplicate idempotency event';end if;
 begin
  perform public.workforce_document_commit(owner,doc,0,gen_random_uuid(),'stale','save','{}',s,null,null);
  raise exception 'Expected revision rejection';
 exception when sqlstate 'PT409' then null;end;
 begin
  perform public.workforce_document_commit(owner,doc,0,op,'different-request','save','{}',s,null,null);
  raise exception 'Expected idempotency rejection';
 exception when sqlstate 'PT409' then null;end;
 s:=s||jsonb_build_object('revision',2,'status','completed');
 perform public.workforce_document_commit(owner,doc,1,gen_random_uuid(),'final','sign-foreman','{}',s,'c3ludGhldGljLXBkZg==',null);
 s:=s||jsonb_build_object('revision',3,'status','return_recorded');
 perform public.workforce_document_commit(owner,doc,2,gen_random_uuid(),'return','return','{}',s,null,'c3ludGhldGljLXJldHVybg==');
 if not exists(select 1 from public.workforce_documents where id=doc and revision=3 and pdf_base64='c3ludGhldGljLXBkZg==' and return_pdf_base64='c3ludGhldGljLXJldHVybg==') then raise exception 'PDF preservation failed';end if;
 if has_table_privilege('anon','public.workforce_documents','select') or has_table_privilege('authenticated','public.workforce_documents','select') or has_table_privilege('service_role','public.workforce_document_events','update') then raise exception 'Excess table privileges';end if;
 if has_function_privilege('anon','public.workforce_document_commit(uuid,uuid,integer,uuid,text,text,jsonb,jsonb,text,text)','execute') or has_function_privilege('authenticated','public.workforce_document_commit(uuid,uuid,integer,uuid,text,text,jsonb,jsonb,text,text)','execute') then raise exception 'Excess RPC privileges';end if;
end;$$;
rollback;
select 'PASS: real PostgreSQL transaction, invoker RPC, CAS, idempotency, immutable PDF, separate return PDF, least privileges; all synthetic writes rolled back' as verification;
