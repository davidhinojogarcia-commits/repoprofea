import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const owner=id(1),other=id(2),access=id(3),doc=id(10),day=id(20);
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN6kAAAAASUVORK5CYII=';
const layout={templateKey:'epis:modelo-A',enabled:true,required:true,allPages:true,x:.7,y:.1,width:.2,height:.08,pageRatio:297/210,revision:1};
const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
const rpc=async(name,...args)=>(await query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args))[0].value;
const as=async(user)=>{await db.exec('reset role');await query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);await db.exec(user?'set role authenticated':'set role anon');};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema extensions;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
 create table public.foreman_portal_access(id uuid primary key,owner_id uuid,obra text,foreman_name text,token_hash text,active boolean);
 create table public.foreman_mandatory_documents(id uuid primary key,owner_id uuid,obra text,document_type text,status text,lifecycle_status text,assigned_at timestamptz,details jsonb default '{}',signatures jsonb default '{}',updated_at timestamptz,correction_pending boolean default false);
 create table public.mandatory_document_events_v2(id bigserial,document_id uuid,owner_id uuid,event_type text,actor_type text,actor_name text,metadata jsonb);
 create table public.foreman_attendance_days(id uuid primary key,owner_id uuid,obra text,work_date date,status text,rows jsonb default '[]',updated_at timestamptz,correction_pending boolean default false);
 `);
 for(const file of ['20261016150500_foreman_reusable_signature.sql','20261016150510_enforce_foreman_signature_completion.sql','20261016154418_independent_foreman_signature_scope.sql'])await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 // Repeat migration proves it is safe after an interrupted local deployment.
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261016154418_independent_foreman_signature_scope.sql',import.meta.url),'utf8'));
 await query("insert into foreman_portal_access values($1,$2,'Obra A','Encargado',encode(extensions.digest('token','sha256'),'hex'),true)",[access,owner]);
 await query("insert into foreman_portal_access values($1,$2,'Obra B','Otro',encode(extensions.digest('wrong-worksite','sha256'),'hex'),true)",[id(4),owner]);
 await query("insert into foreman_mandatory_documents(id,owner_id,obra,document_type,status,lifecycle_status,assigned_at,signatures) values($1,$2,'Obra A','epis','pending','READY',null,'{\"7\":\"worker-ink\"}')",[doc,owner]);
 await query("insert into foreman_attendance_days values($1,$2,'Obra A','2026-10-16','draft','[{\"workerId\":7,\"entrySignature\":\"worker-ink\"}]',now(),false,null,null)",[day,owner]);
 await as(other);await assert.rejects(rpc('save_foreman_signature_template',doc,layout.templateKey,layout),/no autorizado/);
 await assert.rejects(rpc('get_supervisor_foreman_evidence',doc),/no autorizado/);
 await as(null);await assert.rejects(rpc('save_foreman_signature_template',doc,layout.templateKey,layout),/permission denied/);
 await assert.rejects(rpc('sign_foreman_document_as_foreman','invalid',doc,png),/no válido/);
 await as(owner);await assert.rejects(rpc('save_foreman_signature_template',doc,layout.templateKey,{...layout,x:1}),/Plantilla|coordenadas/);
 await rpc('save_foreman_signature_template',doc,layout.templateKey,layout);
 assert.deepEqual(await rpc('get_foreman_signature_template',doc,layout.templateKey),layout);
 assert.deepEqual(await rpc('get_reusable_foreman_layout',layout.templateKey),layout);
 await as(other);assert.equal(await rpc('get_reusable_foreman_layout',layout.templateKey),null);
 await as(null);await assert.rejects(rpc('sign_foreman_document_as_foreman','wrong-worksite',doc,png),/no disponible/);
 await assert.rejects(rpc('sign_foreman_document_as_foreman','token',doc,'invalid'),/Firma no válida/);
 await db.exec('reset role');await assert.rejects(query("update foreman_mandatory_documents set status='completed' where id=$1",[doc]),/Falta la firma/);
 await as(null);await rpc('sign_foreman_document_as_foreman','token',doc,png);
 assert.equal((await rpc('sign_foreman_document_as_foreman','token',doc,png)).unchanged,true,'retry is idempotent');
 assert.equal((await rpc('get_foreman_document_signature','token',doc)).signature,png,'read-after-write evidence');
 await as(owner);assert.equal((await rpc('get_supervisor_foreman_evidence',doc)).signature,png);
 await db.exec('reset role');assert.equal((await query('select signatures from foreman_mandatory_documents where id=$1',[doc]))[0].signatures['7'],'worker-ink');
 assert.equal((await query("select count(*)::int n from mandatory_document_events_v2 where event_type='FOREMAN_SIGNED'"))[0].n,1);
 await query("update foreman_mandatory_documents set status='completed' where id=$1",[doc]);
 await as(null);await assert.rejects(rpc('sign_foreman_document_as_foreman','token',doc,png),/no disponible/,'completed immutable');
 // Exclusions remain unenforced even with historical enabled/required metadata.
 for(const [i,type] of ['inicio','control_presencia','contrato','prorroga'].entries()){
  const document=id(30+i);await db.exec('reset role');
  await query("insert into foreman_mandatory_documents(id,owner_id,obra,document_type,status,lifecycle_status,assigned_at,details) values($1,$2,'Obra A',$3,'pending','ASSIGNED',now(),$4)",[document,owner,type,{foremanSignatureTemplate:layout}]);
  await as(owner);await assert.rejects(rpc('save_foreman_signature_template',document,layout.templateKey,layout),/no admite/);
  await as(null);await assert.rejects(rpc('sign_foreman_document_as_foreman','token',document,png),/no disponible/);
  await db.exec('reset role');await query("update foreman_mandatory_documents set status='completed' where id=$1",[document]);
 }
 // Withdrawal + a changed model invalidates only foreman ink, never worker ink.
 await db.exec('reset role');await query("update foreman_mandatory_documents set status='pending',lifecycle_status='READY',assigned_at=null where id=$1",[doc]);
 await as(owner);await rpc('save_foreman_signature_template',doc,layout.templateKey,{...layout,x:.6,revision:2});
 await as(null);assert.equal((await rpc('get_foreman_document_signature','token',doc)).signed,false);
 const attendance={...layout,templateKey:'control_horario:institucional'};
 await as(owner);await rpc('save_attendance_foreman_template',day,attendance);
 await as(other);await assert.rejects(rpc('save_attendance_foreman_template',day,attendance),/no autorizada/);
 await as(null);assert.equal((await rpc('get_attendance_foreman_evidence','token','2026-10-16')).layout.required,true);
 await assert.rejects(rpc('sign_attendance_as_foreman','wrong-worksite','2026-10-16',png),/no disponible/);
 await db.exec('reset role');await assert.rejects(query("update foreman_attendance_days set status='completed' where id=$1",[day]),/Falta la firma/);
 await as(null);await rpc('sign_attendance_as_foreman','token','2026-10-16',png);
 assert.equal((await rpc('get_attendance_foreman_evidence','token','2026-10-16')).signed,true);
 await as(owner);assert.equal((await rpc('get_supervisor_foreman_evidence',day)).signature,png);
 await db.exec('reset role');await query("update foreman_attendance_days set status='completed' where id=$1",[day]);
 await as(null);await assert.rejects(rpc('sign_attendance_as_foreman','token','2026-10-16',png),/no disponible/);
 await db.exec('reset role');await query("update foreman_attendance_days set status='draft',correction_pending=true,rows='[]' where id=$1",[day]);
 await as(null);assert.equal((await rpc('get_attendance_foreman_evidence','token','2026-10-16')).signed,false,'row changes invalidate responsible approval');
 await as(owner);assert.equal((await query('select * from foreman_attendance_signature_events')).length,2,'signed and invalidated audit events');
 await as(other);assert.equal((await query('select * from foreman_attendance_signature_events')).length,0,'audit RLS isolates owners');
 await db.exec('reset role');await query('update foreman_portal_access set active=false where id=$1',[access]);
 await as(null);await assert.rejects(rpc('get_attendance_foreman_evidence','token','2026-10-16'),/no válido/);
 for(const table of ['foreman_signature_templates','foreman_document_signatures'])await assert.rejects(query('select * from '+table),/permission denied/);
 console.log('PASS: independent foreman SQL permissions, owner/worksite/revoked-token isolation, 4 exclusions, required completion, persistence, model reuse, audit, worker separation, attendance and invalidation.');
}finally{await db.close();}
