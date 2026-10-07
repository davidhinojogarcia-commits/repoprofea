import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const owner=id(99);
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth; create schema private;create schema extensions;create schema cron;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
 -- Deterministic digest stand-in; production uses extensions.pgcrypto SHA-256.
 create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select $1$$;
 create table public.foreman_mandatory_documents(id uuid primary key,owner_id uuid,status text,lifecycle_status text,correction_pending boolean,details jsonb,updated_at timestamptz);
 create table public.foreman_mandatory_pdf_files(document_id uuid primary key,owner_id uuid,original_pdf bytea not null,signed_pdf bytea,original_sha256 text,signed_sha256 text,fidelity jsonb,updated_at timestamptz);
 create table public.mandatory_document_versions_v2(document_id uuid,owner_id uuid,version_no integer,signed_pdf bytea,signed_sha256 text,fidelity jsonb,submission_mode text,signed_count integer,required_count integer);
 create table public.mandatory_document_events_v2(document_id uuid,owner_id uuid,event_type text,actor_type text,metadata jsonb);
 create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text);
 create table cron.job_run_details(jobid bigint,end_time timestamptz);
 create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values($1,$2,$3) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid$$;
 `);
 const sql=await fs.readFile(new URL('../supabase/migrations/20261007171146_temporary_imported_originals.sql',import.meta.url),'utf8');
 await db.exec(sql);await db.exec(sql);
 assert.equal((await db.query('select count(*)::int n from cron.job')).rows[0].n,1);
 for(let n=1;n<=5;n++){
  await db.query(`insert into public.foreman_mandatory_documents values($1,$2,$3,$4,false,'{}',now())`,[id(n),owner,n===3?'pending':'reviewed',n===3?'ASSIGNED':'REVIEWED']);
  await db.query(`insert into public.foreman_mandatory_pdf_files(document_id,owner_id,original_pdf,signed_pdf,original_sha256,signed_sha256,fidelity) values($1,$2,decode('25504446','hex'),decode('255349474e','hex'),'25504446',$3,$4)`,[id(n),owner,n===4?'bad':'255349474e',n===5?{ok:false}:{ok:true}]);
  await db.query(`insert into public.mandatory_document_versions_v2 values($1,$2,1,decode('255349474e','hex'),$3,$4,$5,$6,2)`,[id(n),owner,n===4?'bad':'255349474e',n===5?{ok:false}:{ok:true},n===2?'partial':'complete',n===2?1:2]);
 }
 assert.equal((await db.query('select private.prune_reviewed_original_pdfs() n')).rows[0].n,1);
 assert.equal((await db.query('select private.prune_reviewed_original_pdfs() n')).rows[0].n,0,'idempotent');
 const files=(await db.query('select document_id,original_pdf is null purged,encode(signed_pdf,\'hex\') signed from public.foreman_mandatory_pdf_files order by document_id')).rows;
 assert.deepEqual(files.map(f=>f.purged),[true,false,false,false,false],'partial, pending, corrupt and unverified originals retained');
 assert(files.every(f=>f.signed==='255349474e'),'signed PDFs untouched');
 await assert.rejects(db.query(`update public.foreman_mandatory_documents set lifecycle_status='RETURNED_FOR_CORRECTION' where id=$1`,[id(1)]),/Reimporta/);
 assert.equal((await db.query('select count(*)::int n from public.mandatory_document_versions_v2')).rows[0].n,5);
 await db.query(`select set_config('test.user',$1,false)`,[id(98)]);
 await assert.rejects(db.query('select public.restore_mandatory_original_pdf($1,$2)',[id(1),'JVBERg==']),/no disponible/);
 await db.query(`select set_config('test.user',$1,false)`,[owner]);
 await assert.rejects(db.query('select public.restore_mandatory_original_pdf($1,$2)',[id(1),'d3Jvbmc=']),/no coincide/);
 const restored=(await db.query('select public.restore_mandatory_original_pdf($1,$2) result',[id(1),'JVBERg=='])).rows[0].result;
 assert(restored.signedPdfPreserved);
 assert.equal((await db.query('select private.prune_reviewed_original_pdfs() n')).rows[0].n,0,'restored original stays available for correction');
 await db.query(`update public.foreman_mandatory_documents set lifecycle_status='RETURNED_FOR_CORRECTION' where id=$1`,[id(1)]);
 for(const role of ['anon','authenticated','service_role']){
  await db.exec(`set role ${role}`);
  await assert.rejects(db.query('select private.prune_reviewed_original_pdfs()'),/permission denied/);
  await db.exec('reset role');
 }
 console.log('PASS: temporary original retention, signature preservation, guards, restoration, ownership and private maintenance permissions');
}finally{await db.close();}
