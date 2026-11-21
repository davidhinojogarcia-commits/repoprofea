import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=uuid(1),otherOwner=uuid(2),doc=uuid(10),foreignDoc=uuid(11),closed=uuid(12),v2=uuid(13);
const day=uuid(20),closedDay=uuid(21);
const sql=async(query,args=[])=> (await db.query(query,args)).rows;
const rpc=async(name,...args)=>(await sql('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args))[0].value;
const as=async(role)=>{await db.exec('reset role');if(role)await db.exec('set role '+role);};
const revokeDoc='revoke_foreman_operational_worker_signature';
const revokeDay='revoke_foreman_attendance_worker_signature';
try{
  await db.exec([
    'create role anon;create role authenticated;create schema extensions;',
    "create function extensions.digest(text,text) returns bytea language sql immutable as $$ select sha256(convert_to($1,'UTF8')) $$;",
    'grant usage on schema public,extensions to anon,authenticated;',
    'create table public.foreman_portal_access(owner_id uuid,obra text,foreman_name text,token_hash text,active boolean);',
    "create table public.foreman_mandatory_documents(id uuid primary key,owner_id uuid,obra text,period_key text,document_type text,status text,workers jsonb default '[]',signatures jsonb default '{}',lifecycle_status text,v2_initialized_at timestamptz,source_gmail_message_id text,correction_pending boolean default false,completed_at timestamptz,updated_at timestamptz);",
    'create table public.worker_document_evidence(owner_id uuid,worker_id bigint,document_id uuid);',
    'create table public.foreman_mandatory_pdf_files(owner_id uuid,document_id uuid,signed_pdf bytea,signed_sha256 text,fidelity jsonb,updated_at timestamptz);',
    'create table public.foreman_attendance_days(id uuid primary key,owner_id uuid,obra text,work_date date,rows jsonb,status text,correction_pending boolean default false,completed_at timestamptz,foreman_signature_evidence jsonb,updated_at timestamptz);',
    "create table public.foreman_activity_log(id bigserial primary key,owner_id uuid,obra text,entity_type text,entity_id uuid,document_type text,action text,actor_type text,actor_name text,worker_id bigint,metadata jsonb default '{}');",
  ].join('\n'));
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261117222600_foreman_worker_signature_revocation.sql',import.meta.url),'utf8'));
  await sql("insert into public.foreman_portal_access(owner_id,obra,foreman_name,token_hash,active) values($1,'Obra A','ENCARGADO',encode(extensions.digest('valid-token','sha256'),'hex'),true)",[owner]);
  await sql("insert into public.foreman_mandatory_documents(id,owner_id,obra,period_key,document_type,status,workers,signatures) values($1,$2,'Obra A','encargado:epis:2026-11-17','epis','in_progress',$3::jsonb,$4::jsonb)",[doc,owner,JSON.stringify([{id:31},{id:32}]),JSON.stringify({'31':{signature:'IMAGE-OLD'},'32':{signature:'IMAGE-OTHER'}})]);
  await sql("insert into public.foreman_mandatory_documents(id,owner_id,obra,document_type,status,workers,signatures) values($1,$2,'Obra B','epis','in_progress','[{\"id\":31}]','{\"31\":\"FOREIGN\"}')",[foreignDoc,owner]);
  await sql("insert into public.foreman_mandatory_documents(id,owner_id,obra,document_type,status,workers,signatures) values($1,$2,'Obra A','epis','completed','[{\"id\":31}]','{\"31\":\"CLOSED\"}')",[closed,owner]);
  await sql("insert into public.foreman_mandatory_documents(id,owner_id,obra,document_type,status,workers,signatures,lifecycle_status) values($1,$2,'Obra A','epis','in_progress','[{\"id\":31}]','{\"31\":\"V2\"}','ASSIGNED')",[v2,owner]);
  await sql('insert into public.worker_document_evidence(owner_id,worker_id,document_id) values($1,31,$2),($1,32,$2)',[owner,doc]);
  await sql("insert into public.foreman_mandatory_pdf_files(owner_id,document_id,signed_sha256,fidelity) values($1,$2,'old-signed-hash','{}')",[owner,doc]);
  await sql("insert into public.foreman_attendance_days(id,owner_id,obra,work_date,status,rows,foreman_signature_evidence) values($1,$2,'Obra A','2026-11-17','draft',$3::jsonb,'{\"signed\":true}')",[day,owner,JSON.stringify([{workerId:31,entrySignature:'ENTRY-OLD',exitSignature:'EXIT-OK'},{workerId:32,entrySignature:'ENTRY-OTHER',exitSignature:'EXIT-OTHER'}])]);
  await sql("insert into public.foreman_attendance_days(id,owner_id,obra,work_date,status,rows) values($1,$2,'Obra A','2026-11-16','completed','[{\"workerId\":31,\"entrySignature\":\"CLOSED\"}]')",[closedDay,owner]);
  await as('anon');
  await assert.rejects(rpc(revokeDoc,'wrong',doc,31),/Acceso no válido/);
  await assert.rejects(rpc(revokeDoc,'valid-token',foreignDoc,31),/fuera de tu obra/);
  await assert.rejects(rpc(revokeDoc,'valid-token',closed,31),/enviado o no editable/);
  await assert.rejects(rpc(revokeDoc,'valid-token',v2,31),/enviado o no editable/);
  await assert.rejects(rpc(revokeDoc,'valid-token',doc,999),/no pertenece/);
  const changed=await rpc(revokeDoc,'valid-token',doc,31);
  assert.equal(changed.revoked,true);
  await assert.rejects(rpc(revokeDoc,'valid-token',doc,31),/No hay ninguna firma/);
  await assert.rejects(rpc(revokeDay,'wrong','2026-11-17',31,'entry'),/Acceso no válido/);
  await assert.rejects(rpc(revokeDay,'valid-token','2026-11-16',31,'entry'),/Jornada enviada/);
  await assert.rejects(rpc(revokeDay,'valid-token','2026-11-17',32,'other'),/Firma solicitada no válida/);
  assert.equal((await rpc(revokeDay,'valid-token','2026-11-17',31,'entry')).revoked,true);
  await assert.rejects(rpc(revokeDay,'valid-token','2026-11-17',31,'entry'),/No existe una única firma/);
  await as(null);
  const document=(await sql('select status,signatures from public.foreman_mandatory_documents where id=$1',[doc]))[0];
  assert.equal(document.status,'in_progress');
  assert.equal(document.signatures['31'],undefined);
  assert.equal(document.signatures['32'].signature,'IMAGE-OTHER');
  assert.deepEqual((await sql('select worker_id from public.worker_document_evidence where document_id=$1',[doc])).map(x=>Number(x.worker_id)),[32]);
  const pdf=(await sql('select signed_sha256 from public.foreman_mandatory_pdf_files where document_id=$1',[doc]))[0];
  assert.equal(pdf.signed_sha256,null);
  const attendance=(await sql('select rows,status,foreman_signature_evidence from public.foreman_attendance_days where id=$1',[day]))[0];
  assert.equal(attendance.status,'draft');
  assert.equal(attendance.rows[0].entrySignature,undefined);
  assert.equal(attendance.rows[0].exitSignature,'EXIT-OK');
  assert.equal(attendance.rows[1].entrySignature,'ENTRY-OTHER');
  assert.equal(attendance.foreman_signature_evidence,null);
  const audit=await sql('select action,entity_type,worker_id,metadata from public.foreman_activity_log order by id');
  assert.equal(audit.length,2);
  assert(audit.every(a=>a.action==='WORKER_SIGNATURE_REVOKED' && Number(a.worker_id)===31));
  assert.deepEqual(audit.map(a=>a.entity_type),['mandatory','attendance']);
  assert(audit.every(a=>/^[a-f0-9]{64}$/.test(a.metadata.signatureSha256)));
  assert(!JSON.stringify(audit).includes('IMAGE-OLD')&&!JSON.stringify(audit).includes('ENTRY-OLD'));
  console.log('PASS: PGlite anon token/obra scope, submitted/v2 guards, targeted worker revocation, evidence+PDF invalidation, attendance entry preservation and SHA-256 audit.');
}finally{await db.close();}
