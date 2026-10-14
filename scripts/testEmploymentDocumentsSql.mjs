import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
const serviceOutput=new URL('./.mandatory-draft-sql-service.mjs',import.meta.url);
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const owner=id(1),other=id(2),doc=id(10),w1=id(11),w2=id(12),token='local-only-token';
const base=fs.readFileSync(new URL('../supabase/migrations/20261003090000_mandatory_traceability_v2.sql',import.meta.url),'utf8');
const fn=name=>{const a=base.indexOf(`create or replace function public.${name}(`);return base.slice(a,base.indexOf('$$;',base.indexOf('as $$',a))+3);};
const migration=fs.readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(f=>f.endsWith('manual_foreman_publication_and_signature_revoke.sql'));
const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
const rpc=async(name,args)=> (await query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;
const asUser=async(user)=>{await db.exec('reset role');await query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);await db.exec(user?'set role authenticated':'set role anon');};
const box=(y)=>({x:350,y,width:70,height:14});
try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema extensions;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
 create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
 create table auth.users(id uuid primary key);
 create table public.foreman_portal_access(id uuid primary key default gen_random_uuid(),owner_id uuid,obra text,foreman_name text,token_hash text,active boolean,last_used_at timestamptz);
 create table public.foreman_mandatory_documents(id uuid primary key,owner_id uuid,obra text,status text,lifecycle_status text,
 work_date date default current_date,period_key text,document_type text default 'control_presencia',category text,signatures jsonb default '{}',workers jsonb default '[]',details jsonb default '{}',v2_initialized_at timestamptz default now(),
 assigned_at timestamptz,received_at timestamptz,completed_at timestamptz,reviewed_at timestamptz,correction_pending boolean default false,
 correction_reason text,correction_requested_at timestamptz,updated_at timestamptz default now());
 create table public.foreman_mandatory_pdf_files(document_id uuid primary key,owner_id uuid,original_pdf bytea,signed_pdf bytea,
 original_sha256 text,signed_sha256 text,fidelity jsonb,page_meta jsonb,updated_at timestamptz);
 `);
 await query('insert into auth.users values ($1),($2)',[owner,other]);
 await db.exec(base.slice(base.indexOf('create table if not exists public.mandatory_document_workers_v2'),base.indexOf('alter table public.mandatory_document_workers_v2 enable row level security')));
 for(const name of ['mandatory_v2_box_valid','mandatory_v2_resolve_preassignment_status','sign_mandatory_document_worker_v2','update_mandatory_document_worker_geometry_v2'])await db.exec(fn(name));
 // The same guard used in production prevents unsafe direct lifecycle changes.
 await db.exec(fn('guard_mandatory_v2_lifecycle_transition'));
 await db.exec(`create trigger guard_lifecycle before update on public.foreman_mandatory_documents for each row execute function public.guard_mandatory_v2_lifecycle_transition();`);
 await db.exec(`
 create table user_settings(user_id uuid,settings jsonb);
 create table obras(owner_id uuid,codigo text,nombre text,municipio text,empresa text,cif text,recurso_preventivo text,updated_at timestamptz);
 create table trabajadores(owner_id uuid,id bigint,apellidos_nombre text,dni text,categoria text,obra text,num_oferta text,quincena text,periodo_inicio text,periodo_fin text,telefono text,calzado text,formacion text,lugar_formacion text,aptitud_medica text,limitaciones_aptitud text,reconocimiento_estado text,reconocimiento_fecha text,reconocimiento_validez text,reconocimiento_limitaciones text,reconocimiento_observaciones text);
 create table foreman_attendance_days(id uuid,owner_id uuid,obra text,work_date date,foreman_name text,rows jsonb,status text,completed_at timestamptz,updated_at timestamptz,correction_pending boolean,correction_reason text,correction_requested_at timestamptz);
 create table foreman_documents(id uuid,owner_id uuid,obra text,work_date date,document_type text,worker_id bigint,worker_snapshot jsonb,answers jsonb,signatures jsonb,status text,completed_at timestamptz,created_at timestamptz,correction_pending boolean,correction_reason text,correction_requested_at timestamptz);
 `);
 const projection=fs.readFileSync(new URL('../supabase/migrations/20261009181601_preserve_active_mandatory_worker_snapshot.sql',import.meta.url),'utf8');
 await db.exec(projection.slice(0,projection.indexOf('CREATE OR REPLACE FUNCTION public.review_mandatory_document_worker_v2')));
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261009200007_atomic_mandatory_draft_positions.sql',import.meta.url),'utf8'));
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261009200007_atomic_mandatory_draft_positions.sql',import.meta.url),'utf8'));
 // Running the migration again must not change documents or add events.
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261009201210_allow_mandatory_signature_overlap.sql',import.meta.url),'utf8'));
 await db.exec(`
 alter table foreman_mandatory_documents alter column id set default gen_random_uuid();
 alter table foreman_mandatory_documents alter column v2_initialized_at drop default;
 alter table foreman_mandatory_documents add column detected_obra text,add column confirmed_obra text,
 add column created_at timestamptz default now(),add column source_gmail_message_id text,add column source_gmail_thread_id text,
 add column source_rfc_message_id text,add column source_email_from text,add column source_email_subject text,add column source_attachment_name text;
 alter table foreman_mandatory_pdf_files add column original_filename text,add column signed_filename text,add column created_at timestamptz default now();
 create table foreman_mandatory_delete_tombstones(owner_id uuid,source_gmail_message_id text,source_attachment_name text);
 `);
 // Install the full new migration twice: syntax, RPC definitions, grants and idempotence.
 const employmentMigration=fs.readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(f=>f.endsWith('_foreman_contracts_extensions.sql'));
 const employmentSql=fs.readFileSync(new URL('../supabase/migrations/'+employmentMigration,import.meta.url),'utf8');
 await db.exec(employmentSql);await db.exec(employmentSql);
 for(const name of ['assign_mandatory_document_v2','initialize_mandatory_document_v2','save_foreman_mandatory_original_pdf','save_mandatory_positions_draft_v2']) {const rights=await query("select has_function_privilege('anon',oid,'EXECUTE') allowed from pg_proc where proname=$1",[name]);assert.equal(rights[0].allowed,false,name+' restricted to supervisor');}
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261013092414_advisory_mandatory_row_proximity.sql',import.meta.url),'utf8'));
 await query("insert into obras(owner_id,nombre) values($1,'Obra A')",[owner]);
 await query("insert into foreman_portal_access(owner_id,obra,foreman_name,token_hash,active) values($1,'Obra A','Encargado',encode(extensions.digest($2,'sha256'),'hex'),true)",[owner,token]);
 await query("insert into foreman_portal_access(owner_id,obra,token_hash,active) values($1,'Obra B',encode(extensions.digest('other-work','sha256'),'hex'),true),($2,'Obra A',encode(extensions.digest('other-owner','sha256'),'hex'),true)",[owner,other]);
 await db.exec('grant select on foreman_mandatory_documents,mandatory_document_workers_v2,foreman_mandatory_pdf_files,mandatory_document_versions_v2 to authenticated');
 for(const [index,type,pages] of [[1,'contrato',3],[2,'prorroga',1],[3,'contrato',4],[4,'prorroga',2],[5,'inicio',2],[6,'control_presencia',1]]) {
   await asUser(owner);
   const document=await rpc('prepare_foreman_mandatory_from_email',[type,[], '2026-10-14','', '2026-10-1Q',null,null,null,null,null,type+'.pdf','Obra A']);
   const bytes=Buffer.from('%PDF-1.7\nOriginal '+type),hash=crypto.createHash('sha256').update(bytes).digest('hex');
   const pageMeta=Array.from({length:pages},(_,i)=>({page:i+1,width:595,height:842,rotation:0}));
   await rpc('save_foreman_mandatory_original_pdf',[document,bytes.toString('base64'),type+'.pdf',hash,pageMeta,[]]);
   await rpc('initialize_mandatory_document_v2',[document,[{legacyWorkerId:-index,printedName:'López Ruiz, María',page:pages,rowIndex:0,detectionStatus:'CONFIRMED',positionStatus:'RESOLVED',positionSource:'AUTO',nameBox:{x:350,y:185,width:140,height:12},signatureBox:{x:350,y:115,width:140,height:50}}],'Obra A',null]);
   const rows=await query('select * from mandatory_document_workers_v2 where document_id=$1',[document]);
   if(['contrato','prorroga'].includes(type)){assert.equal(rows[0].detection_status,'DETECTED','server never auto-confirms employment identity');await assert.rejects(rpc('assign_mandatory_document_v2',[document]),/Revisa y guarda/);}else assert.equal(rows[0].detection_status,'CONFIRMED','existing import auto-confirmation preserved');
   await asUser(null);
   if(['contrato','prorroga'].includes(type))await assert.rejects(rpc('get_foreman_mandatory_pdf',[token,document,'original']),/todavía no se ha enviado/);
   assert(!(await rpc('resolve_foreman_portal',[token])).mandatoryDocuments.some(d=>d.id===document),'draft is hidden');
   await assert.rejects(rpc('sign_mandatory_document_worker_v2',[token,document,rows[0].id,'data:image/png;base64,'+'A'.repeat(60)]),/disponible|asignado|confirmad|habilitad|firmar/i);
   await assert.rejects(rpc('save_mandatory_positions_draft_v2',[document,[],null]),/permission denied/);
   await asUser(other);await assert.rejects(rpc('assign_mandatory_document_v2',[document]),/Documento no válido/);
   await assert.rejects(rpc('save_mandatory_positions_draft_v2',[document,[],null]),/Documento no válido/);
   await asUser(owner);
   const worker={documentWorkerId:rows[0].id,printedName:rows[0].printed_name,page:pages,rowIndex:0,resolved:true,nameBox:rows[0].name_box,signatureBox:rows[0].signature_box};
   await rpc('save_mandatory_positions_draft_v2',[document,[worker],null]);
   const reopened=(await query('select * from mandatory_document_workers_v2 where id=$1',[rows[0].id]))[0];
   assert.equal(reopened.position_source,'MANUAL');assert.equal(reopened.detection_status,'CONFIRMED');assert.deepEqual(reopened.signature_box,worker.signatureBox);assert.equal(reopened.page,pages);
   await rpc('assign_mandatory_document_v2',[document]);
   await asUser(null);
   assert.equal((await rpc('get_foreman_mandatory_pdf',[token,document,'original'])).base64.replace(/\s/g,''),bytes.toString('base64'));
   if(['contrato','prorroga'].includes(type))await assert.rejects(rpc('correct_foreman_mandatory_worker_name',[token,document,-index,'Persona distinta']),/supervisor debe corregir/);
   assert((await rpc('resolve_foreman_portal',[token])).mandatoryDocuments.some(d=>d.id===document));
   for(const bad of ['bad-token','other-work','other-owner'])await assert.rejects(rpc('sign_mandatory_document_worker_v2',[bad,document,rows[0].id,'data:image/png;base64,'+'A'.repeat(60)]),/Acceso|Documento/);
   if(['contrato','prorroga'].includes(type)) await assert.rejects(rpc('sign_foreman_mandatory_document',[token,document,-index,'data:image/png;base64,'+'A'.repeat(60)]),/circuito V2/);
   if(['contrato','prorroga'].includes(type)) await assert.rejects(rpc('finalize_foreman_mandatory_document',[token,document]),/circuito V2/);
   const signed=Buffer.from('%PDF-1.7\nSigned '+type),signedHash=crypto.createHash('sha256').update(signed).digest('hex');
   await assert.rejects(rpc('submit_mandatory_document_v2',[token,document,signed.toString('base64'),signedHash,{ok:true}]),/Falta la firma obligatoria|Faltan firmas|al menos una firma/);
   await rpc('sign_mandatory_document_worker_v2',[token,document,rows[0].id,'data:image/png;base64,'+'A'.repeat(60)]);
   await assert.rejects(rpc('submit_mandatory_document_v2',[token,document,signed.toString('base64'),'wrong',{ok:true}]),/SHA/);
   await assert.rejects(rpc('submit_mandatory_document_v2',[token,document,signed.toString('base64'),signedHash,{ok:false}]),/fidelidad/);
   await rpc('submit_mandatory_document_v2',[token,document,signed.toString('base64'),signedHash,{ok:true,originalSha256:hash,pageCountMatches:true,dimensionsMatch:true,textMatches:true,visualMismatchRatio:0}]);
   assert.equal((await rpc('submit_mandatory_document_v2',[token,document,signed.toString('base64'),signedHash,{ok:true,pageCountMatches:true,dimensionsMatch:true,textMatches:true,visualMismatchRatio:0}])).idempotent,true);
   await asUser(owner);
   const persisted=(await query('select * from foreman_mandatory_pdf_files where document_id=$1',[document]))[0];
   assert.deepEqual(Buffer.from(persisted.original_pdf),bytes,'original bytes stay intact');assert.deepEqual(Buffer.from(persisted.signed_pdf),signed,'same signed bytes return to supervisor');
   assert.equal((await query('select count(*)::int n from mandatory_document_versions_v2 where document_id=$1',[document]))[0].n,1,'no duplicate submission');
 }
 // Invalid type and multiple signers must never publish a contract.
 await asUser(owner);await assert.rejects(rpc('prepare_foreman_mandatory_from_email',['unknown',[],'2026-10-14','','',null,null,null,null,null,'x.pdf','Obra A']),/Tipo/);
 const multi=await rpc('prepare_foreman_mandatory_from_email',['contrato',[],'2026-10-14','','',null,null,null,null,null,'x.pdf','Obra A']);
 await rpc('initialize_mandatory_document_v2',[multi,[],'Obra A',null]);
 await assert.rejects(rpc('assign_mandatory_document_v2',[multi]),/único trabajador/);
 await db.exec('reset role');
 await query("insert into mandatory_document_workers_v2(document_id,owner_id,printed_name,detection_status,position_status,position_source,page,row_index,signature_box) values($1,$2,'Uno','CONFIRMED','RESOLVED','MANUAL',1,0,$3),($1,$2,'Dos','CONFIRMED','RESOLVED','MANUAL',1,1,$3)",[multi,owner,box(100)]);
 await asUser(owner);await assert.rejects(rpc('assign_mandatory_document_v2',[multi]),/único trabajador/);
 console.log('PASS: contract/extension import, variations, manual confirmation, persistence, exact bytes, token/owner/worksite security, mandatory signature and idempotence in PostgreSQL.');
} finally {await db.close();}
