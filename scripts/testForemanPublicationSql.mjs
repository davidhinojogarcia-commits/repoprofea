import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
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
 // Running the migration again must not change documents or add events.
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
 await query("insert into foreman_portal_access(owner_id,obra,foreman_name,token_hash,active) values($1,'Obra A','Encargado',encode(extensions.digest($2,'sha256'),'hex'),true)",[owner,token]);
 await query("insert into foreman_mandatory_documents(id,owner_id,obra,status,lifecycle_status) values($1,$2,'Obra A','pending','READY')",[doc,owner]);
 await query("insert into foreman_mandatory_pdf_files(document_id,owner_id,original_pdf,original_sha256,page_meta) values($1,$2,convert_to('original','UTF8'),encode(extensions.digest('original','sha256'),'hex'),$3)",[doc,owner,[{page:1,width:595,height:842}]]);
 for(const [worker,n,y,width] of [[w1,1,500,120],[w2,2,470,260]])await query("insert into mandatory_document_workers_v2(id,document_id,owner_id,legacy_worker_id,printed_name,page,row_index,detection_status,position_status,name_box,signature_box) values($1,$2,$3,$4::integer::bigint,$5,1,$4::integer,'CONFIRMED','RESOLVED',$6,$7)",[worker,doc,owner,n,'Persona '+n,{x:60,y:y+2,width,height:10},box(y)]);
 await db.exec('grant execute on function public.resolve_foreman_portal(text) to anon,authenticated');
 await db.exec('grant execute on function public.assign_mandatory_document_v2(uuid),public.sign_mandatory_document_worker_v2(text,uuid,uuid,text),public.submit_mandatory_document_v2(text,uuid,text,text,jsonb),public.update_mandatory_document_worker_geometry_v2(uuid,uuid,jsonb,jsonb,integer,integer) to authenticated,anon');
 await asUser(other);await assert.rejects(rpc('assign_mandatory_document_v2',[doc]),/Documento no válido/);
 await assert.rejects(rpc('withdraw_mandatory_document_v2',[doc]),/Documento no válido/);
 await asUser(null);assert.equal((await rpc('resolve_foreman_portal',[token])).mandatoryDocuments.length,0,'draft invisible');
 await asUser(owner);await rpc('assign_mandatory_document_v2',[doc]);
 await asUser(null);assert.equal((await rpc('resolve_foreman_portal',[token])).mandatoryDocuments.length,1,'explicitly published document visible');
 const signature='data:image/png;base64,'+'A'.repeat(40);
 await asUser(null);await rpc('sign_mandatory_document_worker_v2',[token,doc,w1,signature]);
 await assert.rejects(rpc('revoke_mandatory_signature_v2',['bad-token',doc,w1]),/revocado/);
 await assert.rejects(rpc('revoke_mandatory_signature_v2',[token,doc,id(999)]),/Persona documental/);
 const fidelity={ok:true,originalSha256:crypto.createHash('sha256').update('original').digest('hex'),pageCountMatches:true,dimensionsMatch:true,textMatches:true,visualMismatchRatio:0};
 await assert.rejects(rpc('submit_mandatory_document_v2',[token,doc,Buffer.from('signed-pdf').toString('base64'),'',fidelity]),/Faltan firmas/);
 await rpc('sign_mandatory_document_worker_v2',[token,doc,w2,signature]);
 const revoked=await rpc('revoke_mandatory_signature_v2',[token,doc,w1]);assert.equal(revoked.revoked,true);
 const retry=await rpc('revoke_mandatory_signature_v2',[token,doc,w1]);assert.equal(retry.revoked,false);
 await db.exec('reset role');
 assert.equal((await query('select count(*)::int n from mandatory_document_signatures_v2'))[0].n,1);
 assert.deepEqual(Object.keys((await query('select signatures from foreman_mandatory_documents'))[0].signatures),['2']);
 assert.equal((await query("select count(*)::int n from mandatory_document_events_v2 where event_type='SIGNATURE_REVOKED'"))[0].n,1);
 await asUser(owner);await rpc('withdraw_mandatory_document_v2',[doc]);
 await db.exec('reset role');
 assert.equal((await query('select lifecycle_status from foreman_mandatory_documents'))[0].lifecycle_status,'READY');
 assert.equal((await query('select count(*)::int n from mandatory_document_signatures_v2'))[0].n,1,'position correction preserves the other signature');
 assert.equal((await query('select count(*)::int n from mandatory_document_workers_v2 where frozen_at is not null'))[0].n,0);
 await asUser(null);assert.equal((await rpc('resolve_foreman_portal',[token])).mandatoryDocuments.length,0,'withdrawn draft invisible');await assert.rejects(rpc('sign_mandatory_document_worker_v2',[token,doc,w1,signature]),/no disponible/);
 await assert.rejects(rpc('revoke_mandatory_signature_v2',[token,doc,w2]),/retirado/);
 await asUser(owner);
 await rpc('update_mandatory_document_worker_geometry_v2',[doc,w2,{x:60,y:472,width:260,height:10},box(472),1,2]);
 await assert.rejects(rpc('update_mandatory_document_worker_geometry_v2',[doc,w2,{x:60,y:472,width:260,height:10},box(472),2,2]),/Revoca su firma/);
 // Published geometry must fail atomically when boxes overlap.
 await rpc('update_mandatory_document_worker_geometry_v2',[doc,w1,{x:60,y:502,width:120,height:10},box(472),1,1]);
 await assert.rejects(rpc('assign_mandatory_document_v2',[doc]),/solapa/);
 await db.exec('reset role');assert.equal((await query('select lifecycle_status from foreman_mandatory_documents'))[0].lifecycle_status,'READY');
 await asUser(owner);await rpc('update_mandatory_document_worker_geometry_v2',[doc,w1,{x:60,y:502,width:120,height:10},box(500),1,1]);
 await rpc('assign_mandatory_document_v2',[doc]);
 await asUser(null);await rpc('sign_mandatory_document_worker_v2',[token,doc,w1,signature]);
 const submitted=await rpc('submit_mandatory_document_v2',[token,doc,Buffer.from('signed-pdf').toString('base64'),'',fidelity]);assert.equal(submitted.partial,false);
 await assert.rejects(rpc('revoke_mandatory_signature_v2',[token,doc,w1]),/ya fue enviado/);
 await asUser(owner);await assert.rejects(rpc('withdraw_mandatory_document_v2',[doc]),/no está disponible/);
 await db.exec('reset role');
 const events=await query('select metadata from mandatory_document_events_v2');assert(!JSON.stringify(events).includes('data:image'),'events never duplicate signature images');
 console.log('PASS: real PostgreSQL RPCs; explicit publication, ownership, geometry validation, selective revocation/retry, withdrawal, retained signatures, identity lock, complete submission and closed-document protections.');
} finally {await db.close();}
