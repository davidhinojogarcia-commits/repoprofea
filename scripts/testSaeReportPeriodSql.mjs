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
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261023195934_sae_code_selection_trigger.sql',import.meta.url),'utf8'));
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261023210429_sae_reopened_draft_codes.sql',import.meta.url),'utf8'));
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261024201410_sae_report_manual_period.sql',import.meta.url),'utf8'));
  const save=(r,period,revision='')=>q('select sae_set_report_period($1,$2,$3)',[r,period,revision]);
  const meta=async r=>(await q("select detected_legend->'__manual_period' p from sae_reports where id=$1",[r]))[0].p;
  await reset(); await patch(a,{fortnight:null,hiring_month:null});
  await save(first,'1ª Quincena');
  let m=await meta(first);assert.equal(m.label,'1ª Quincena');assert.equal(m.month,10);assert.equal(m.year,2026);
  assert.ok(m.revision);assert.equal(m.updatedBy,owner);
  assert.deepEqual((await q('select fortnight,hiring_month from sae_candidates where id=$1',[a]))[0],{fortnight:1,hiring_month:10});
  await patch(a,{fortnight:2,hiring_month:11,status:'segunda_quincena'});
  assert.deepEqual((await q('select fortnight,hiring_month,status from sae_candidates where id=$1',[a]))[0],{fortnight:1,hiring_month:10,status:'primera_quincena'},'stale candidate edits respect the manual report period');
  await patch(a,{result_code:'2001'});assert.equal(await code(),'2500','corrected source activates existing reconciliation');
  await assert.rejects(save(first,'2ª Quincena'),/otra sesión/,'stale edits cannot overwrite a saved period');
  await save(first,'2ª Quincena',m.revision);m=await meta(first);assert.equal(m.label,'2ª Quincena');
  await save(first,'Mensual',m.revision);m=await meta(first);assert.equal((await q('select fortnight from sae_candidates where id=$1',[a]))[0].fortnight,null);
  assert.equal(m.label,'Mensual');assert.equal((await meta(second)),null,'other reports untouched');
  await assert.rejects(save(first,'3ª Quincena',m.revision),/válido/);
  await assert.rejects(save(first,null,m.revision),/válido/);
  await assert.rejects(save(first,'1ª Quincena',null),/otra sesión/);
  await q('update sae_reports set detected_legend=detected_legend || $2::jsonb where id=$1',[first,{__workflow_state:'finalized',__finalized_versions:[{version:1}]}]);
  await assert.rejects(save(first,'1ª Quincena',m.revision),/Reabra/);
  await q('select sae_reopen_report($1)',[first]);await save(first,'1ª Quincena',m.revision);m=await meta(first);
  assert.deepEqual((await q("select detected_legend->'__finalized_versions' v from sae_reports where id=$1",[first]))[0].v,[{version:1}]);
  assert.equal((await q("select detected_legend->>'2001' label from sae_reports where id=$1",[first]))[0].label,'Contratará al candidato','result legend preserved');
  await confirm();await assert.rejects(save(first,'Mensual',m.revision),/Revierta/,'registered contract protected');
  assert.equal((await meta(first)).revision,m.revision,'failed save is atomic');
  await asUser(other);await assert.rejects(save(first,'Mensual',m.revision),/no accesible/);
  await asUser(null);await assert.rejects(save(first,'Mensual',m.revision),/permission denied/);
  await asUser(owner);await reset();await q('delete from sae_candidates where source_report_id=$1',[first]);
  await save(first,'Mensual');assert.equal((await meta(first)).label,'Mensual','empty report period persists without a sample candidate');
  // Rollback both report metadata and candidate writes when a database write fails.
  await reset();await db.exec('reset role');
  await db.exec(`create function fail_period_test() returns trigger language plpgsql as $$begin raise exception 'synthetic write failure';end$$;
    create trigger fail_period_test before update on sae_candidates for each row execute function fail_period_test();`);
  await asUser(owner);await assert.rejects(save(first,'Mensual'),/synthetic write failure/);
  assert.equal(await meta(first),null);assert.equal((await q('select fortnight from sae_candidates where id=$1',[a]))[0].fortnight,1);
  await db.exec('reset role;drop trigger fail_period_test on sae_candidates');
  console.log('PASS manual SAE period: missing/detected/monthly/empty reports, persistence, stale revisions, contracts, finalized archives, owner isolation, ACL and transaction rollback.');
} catch (error) { console.error(error.message,error.where||'');process.exitCode=1; }
finally { await db.close(); }
