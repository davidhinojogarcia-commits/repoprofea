import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const owner=id(1), other=id(2), need=id(10), first=id(20), second=id(21), a=id(30), b=id(31);
const q = async (sql,args=[]) => (await db.query(sql,args)).rows;
const asUser = async user => { await db.exec('reset role'); await q("select set_config('request.jwt.claim.sub',$1,false)",[user||'']); await db.exec(user?'set role authenticated':'set role anon'); };
const sync = async (n=need,c=null,s=null,apply=null) => (await q('select public.sae_sync_fortnight_codes($1,$2,$3,$4) result',[n,c,s,apply]))[0].result;
const state = async () => (await sync()).find(s=>s.candidateId===b);
const code = async () => (await q('select result_code from sae_candidates where id=$1',[b]))[0].result_code;
const patch = async (c,values) => {
  const keys=Object.keys(values); await q(`update sae_candidates set ${keys.map((k,i)=>`${k}=$${i+2}`).join(',')} where id=$1`,[c,...Object.values(values)]);
};
const confirm = async (value='2001') => patch(a,{status:'contratado',result_code:value,existing_worker_id:100,existing_worker_owner_id:owner});
const candidate = async (c,report,fortnight,name='Juan Hinojo García',n=need,user=owner,extra={}) => {
  const row={id:c,need_id:n,source_report_id:report,owner_id:user,normalized_full_name:name,original_full_name:name,
    hiring_month:10,fortnight,work_code:'11002 GR',work_name:'Obra A',created_by:user,updated_by:user,...extra};
  await q(`insert into sae_candidates(${Object.keys(row).join(',')}) values(${Object.keys(row).map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
};
const report = async (r,n=need,user=owner) => q('insert into sae_reports(id,need_id,owner_id,detected_legend) values($1,$2,$3,$4)',[r,n,user,{'2000':'Admitido','2001':'Contratará al candidato','2100':'Rechazo voluntario','2101':'No se ha presentado','2103':'Ha dejado el proceso de selección','2107':'No aceptó las condiciones del puesto','2200':'No cumple los requisitos','2210':'No corresponde al perfil por otros motivos','2212':'Otros motivos','2500':'Ya estaba ocupado el puesto de trabajo'}]);
const makeNeed = async (n=need,work='11002 GR',month=10,year=2026,user=owner) => q('insert into sae_needs(id,owner_id,work_code,work_name,hiring_month,hiring_year) values($1,$2,$3,$4,$5,$6)',[n,user,work,'Obra A',month,year]);
const reset = async () => {
  await db.exec('reset role; truncate sae_candidates,sae_reports,sae_needs,sae_generated_documents,sae_private.code_state,sae_private.code_audit cascade');
  await asUser(owner); await makeNeed(); await report(first); await report(second);
  await candidate(a,first,1); await candidate(b,second,2,'  JUAN  HINOJO GARCIA  ');
};
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.sae_has_permission(action text) returns boolean language sql stable as $$select coalesce(current_setting('test.sae.update',true),'true')<>'false' or action='read'$$;
    grant usage on schema auth to anon,authenticated;
    create table sae_needs(id uuid primary key,owner_id uuid,work_code text,work_name text,hiring_month smallint,hiring_year smallint,status text default 'en_contratacion');
    create table sae_reports(id uuid primary key,need_id uuid,owner_id uuid,updated_by uuid,processing_status text default 'review',detected_legend jsonb default '{}');
    create table sae_candidates(id uuid primary key,need_id uuid,source_report_id uuid,owner_id uuid,
      original_full_name text,normalized_full_name text,dni_nie text,work_code text,work_name text,
      hiring_month smallint,fortnight smallint,status text default 'sin_asignar',result_code text,result_label text,
      existing_worker_id bigint,existing_worker_owner_id uuid,created_by uuid,updated_by uuid,created_at timestamptz default clock_timestamp(),updated_at timestamptz default clock_timestamp());
    create table sae_generated_documents(id uuid primary key,source_report_id uuid);
    alter table sae_needs enable row level security; alter table sae_candidates enable row level security; alter table sae_reports enable row level security;
    create policy self_need on sae_needs to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
    create policy self_candidate on sae_candidates to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
    create policy self_report on sae_reports to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
    grant select,insert,update,delete on sae_needs,sae_candidates,sae_reports to authenticated;
    create function touch_candidate() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;
    create trigger sae_candidates_touch_updated_at before update on sae_candidates for each row execute function touch_candidate();`);
  const migration=fs.readdirSync(new URL('../supabase/migrations',import.meta.url)).find(n=>n.endsWith('_sae_fortnight_codes.sql'));
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
  await reset(); await patch(a,{result_code:'2001',status:'preseleccionado'}); assert.equal(await code(),null,'selection is not confirmation');
  await confirm(); assert.equal(await code(),'2500'); assert.equal((await state()).automaticCode,'2500');
  await sync(); assert.equal(await code(),'2500','reopening retains server value');
  await db.exec('reset role'); let events=(await q("select count(*)::int n from sae_private.code_audit where action='automatic'"))[0].n;
  assert.equal(events,1); await asUser(owner); await confirm(); await sync();
  await db.exec('reset role'); assert.equal((await q("select count(*)::int n from sae_private.code_audit where action='automatic'"))[0].n,events,'repeated confirmation is idempotent');
  await asUser(owner); await confirm('2100'); assert.equal(await code(),'2212');
  await patch(b,{result_code:'2200'}); let pending=await state(); assert.equal(await code(),'2200'); assert.equal(pending.pendingCode,'2212');
  await sync(need,b,pending.signature,false); assert.equal((await state()).issue,null); assert.equal(await code(),'2200');
  await confirm('2001'); pending=await state(); assert.equal(pending.pendingCode,'2500');
  await assert.rejects(sync(need,b,'stale',true),/propuesta ha cambiado/); assert.equal(await code(),'2200');
  await sync(need,b,pending.signature,true); assert.equal(await code(),'2500'); assert.equal((await state()).manual,false);
  await assert.rejects(sync(need,b,pending.signature,true),/propuesta ha cambiado/,'duplicate decisions cannot apply twice');
  await patch(a,{status:'primera_quincena',existing_worker_id:null,result_code:null}); assert.equal(await code(),'2500'); assert.match((await state()).issue,/anulada/);
  await confirm('2001'); assert.equal((await state()).issue,null);
  await assert.rejects(patch(a,{existing_worker_id:999}),/otro dispositivo/,'a second registration cannot replace the confirmed worker');
  await reset(); await patch(b,{result_code:'2101'}); await confirm(); assert.equal(await code(),'2101'); assert.equal((await state()).issue,'manual_confirmation','preexisting manual values protected');
  await reset(); await patch(b,{status:'contratado',existing_worker_id:101,result_code:'2001'}); await confirm(); assert.equal(await code(),'2001'); assert.match((await state()).issue,/rectificación/);
  for(const issued of ['finalized','versions','document']) {
    await reset();
    if(issued==='document'){await db.exec('reset role');await q('insert into sae_generated_documents values($1,$2)',[id(70),second]);await asUser(owner);}
    else await q('update sae_reports set detected_legend=detected_legend || $1::jsonb where id=$2',[issued==='versions'?{__workflow_state:'review',__finalized_versions:[{version:1}]}:{__workflow_state:'finalized'},second]);
    await confirm(); assert.equal(await code(),null); assert.match((await state()).issue,/rectificación/);
  }
  await reset(); await candidate(id(32),first,1); await confirm(); assert.equal(await code(),null); assert.match((await state()).issue,/ambigua/);
  await reset(); await candidate(id(32),second,2); await confirm(); assert.equal(await code(),null); assert.match((await state()).issue,/ambigua/);
  await reset(); await patch(a,{dni_nie:'123A'}); await patch(b,{dni_nie:'999B'}); await confirm(); assert.equal(await code(),null); assert.match((await state()).issue,/identidad/);
  await reset(); await patch(b,{normalized_full_name:'Juan Hinojo Pérez'}); await confirm(); assert.equal(await code(),null);
  for(const scope of ['work','month','year']) {
    await reset(); await makeNeed(id(11),scope==='work'?'11003 GR':'11002 GR',scope==='month'?11:10,scope==='year'?2027:2026);
    await report(id(22),id(11)); await patch(b,{need_id:id(11),source_report_id:id(22),work_code:scope==='work'?'11003 GR':'11002 GR',hiring_month:scope==='month'?11:10});
    await confirm(); assert.equal(await code(),null,scope+' isolation');
  }
  await reset(); await patch(b,{fortnight:null}); await confirm(); assert.equal(await code(),null,'monthly/special periods excluded');
  await reset(); await patch(b,{fortnight:3}); await confirm(); assert.equal(await code(),null,'third fortnight excluded');
  await reset(); await q('delete from sae_candidates where id=$1',[b]); await confirm(); await candidate(b,second,2); assert.equal(await code(),'2500','late imported second report reconciles');
  await reset(); await q('delete from sae_candidates where id=$1',[a]); assert.equal(await code(),null,'only second fortnight');
  await reset(); await confirm('9999'); assert.equal(await code(),null); assert.match((await state()).issue,/desconocido/);
  for(const catalog of [{},{'2212':'Otros motivos','999':'Otros motivos'}]) {
    await reset(); await q('update sae_reports set detected_legend=$1 where id=$2',[catalog,second]); await confirm('2100');
    assert.equal(await code(),null); assert.match((await state()).issue,/Configuración/);
  }
  await reset(); await patch(b,{created_at:'2020-01-01'}); await confirm(); assert.equal(await code(),'2500','new confirmation activates old draft explicitly');
  await reset(); await db.exec('reset role'); await q("select set_config('request.jwt.claim.sub','',false)");
  await q("update sae_candidates set created_at='2020-01-01',status=case when id=$1 then 'contratado' else status end,result_code=case when id=$1 then '2001' else result_code end,existing_worker_id=case when id=$1 then 100 else null end",[a]);
  await asUser(owner); await sync(); assert.equal(await code(),null,'migration/reopen does not backfill historical pairs');
  await reset(); await confirm();
  await asUser(other); await assert.rejects(sync(),/no accesible/); assert.equal((await q('select * from sae_candidates')).length,0);
  await assert.rejects(db.exec('select * from sae_private.code_state'),/permission denied/);
  await assert.rejects(db.exec("insert into sae_private.code_audit(candidate_id,owner_id,action) values(null,null,'fake')"),/permission denied/);
  await asUser(null); await assert.rejects(sync(),/permission denied/);
  await asUser(other); await makeNeed(id(11),'11002 GR',10,2026,other); await report(id(22),id(11),other);
  await candidate(id(40),first,1,'Juan Hinojo García',id(11),other,{status:'contratado',result_code:'2001',existing_worker_id:101,existing_worker_owner_id:other});
  await candidate(id(41),id(22),2,'Juan Hinojo García',id(11),other);
  await sync(id(11));assert.equal((await q('select result_code from sae_candidates where id=$1',[id(41)]))[0].result_code,null,'a foreign source report cannot be borrowed by an owned candidate');
  await assert.rejects(sync(id(11),b,'foreign',true),/propuesta ha cambiado/);
  await asUser(owner); await q("select set_config('test.sae.update','false',false)");
  assert.equal((await sync()).find(s=>s.candidateId===b).automaticCode,'2500','read-only users may inspect persisted result');
  await assert.rejects(sync(need,b,'any',true),/permitida/);
  await q("select set_config('test.sae.update','true',false)");
  // A database error must roll back the confirmation and its downstream code.
  await reset(); await db.exec('reset role');
  await db.exec(`create function reject_code() returns trigger language plpgsql as $$begin if new.result_code='2500' then raise exception 'test database failure';end if;return new;end$$;
    create trigger reject_code before update on sae_candidates for each row execute function reject_code();`);
  await asUser(owner); await assert.rejects(confirm(),/test database failure/); assert.equal(await code(),null);
  assert.equal((await q('select status from sae_candidates where id=$1',[a]))[0].status,'sin_asignar','failed transaction rolls back source too');
  await db.exec('reset role; drop trigger reject_code on sae_candidates'); await asUser(owner); await confirm(); assert.equal(await code(),'2500','retry recovers without duplicates');
  await db.exec('reset role'); const audits=await q("select * from sae_private.code_audit where action='automatic'");
  assert.equal(audits.length,1); assert.equal(audits[0].actor_id,owner); assert.equal(audits[0].source_report_id,first); assert.equal(audits[0].target_report_id,second);
  await asUser(owner);const snapshot=[{id:b,resultCode:'2500',orderNumber:1,pageNumber:1,overlayX:184,overlayY:50}];
  await confirm('2100');
  const finalize=async rows=>(await q('select sae_finalize_report_version($1,$2) version',[second,rows]))[0].version;
  await assert.rejects(finalize(snapshot),/han cambiado/,'cannot finalize stale code while building PDF');
  snapshot[0].resultCode='2212';assert.equal(await finalize(snapshot),1);assert.equal(await finalize(snapshot),1,'finalization retry does not duplicate the version');
  await confirm('2001');assert.equal(await code(),'2212','finalized version cannot be silently changed');
  await asUser(other);await assert.rejects(finalize(snapshot),/no accesible/);
  await asUser(null);await assert.rejects(finalize(snapshot),/permission denied/);
  // Count calls around the actual function to catch accidental per-row work on
  // bulk imports. The implementation under test remains the migration's SQL.
  await reset(); await db.exec('reset role');
  const definition=(await q("select pg_get_functiondef('sae_private.reconcile(uuid,uuid)'::regprocedure) definition"))[0].definition;
  await db.exec(definition.replace('sae_private.reconcile(', 'sae_private.reconcile_impl('));
  await db.exec(`create table sae_private.test_calls(id int);create or replace function sae_private.reconcile(owner uuid,need uuid) returns void
    language plpgsql security definer set search_path='' as $$begin insert into sae_private.test_calls values(1);perform sae_private.reconcile_impl(owner,need);end$$;`);
  await asUser(owner);
  await q(`insert into sae_candidates(id,need_id,source_report_id,owner_id,normalized_full_name,original_full_name,work_code,work_name,hiring_month,fortnight,created_by,updated_by)
    select md5('bulk-'||i)::uuid,$1,$2,$3,'Worker '||i,'Worker '||i,'11002 GR','Obra A',10,2,$3,$3 from generate_series(1,50) i`,[need,second,owner]);
  await db.exec('reset role');assert.equal((await q('select count(*)::int n from sae_private.test_calls'))[0].n,1,'bulk import reconciles once per scope, not once per candidate');
  console.log('PASS SAE PostgreSQL: confirmation, 2500/2212, manual decisions, stale/double requests, cancellation, homonyms/DNI, work/month/year isolation, issued reports, late import, historical exclusion, RLS/ACL, rollback/recovery and protected audit.');
} catch (error) { console.error(error.message, error.detail || '', error.where || '', error.internalQuery || ''); process.exitCode=1; }
finally { await db.close(); }
