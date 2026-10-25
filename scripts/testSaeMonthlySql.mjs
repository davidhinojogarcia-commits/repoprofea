import { applyBusinessConflictFix } from './saeBusinessConflictFixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const owner=id(1),other=id(2),origin=id(10),destination=id(11),r1=id(20),r2=id(21),a=id(30),b=id(31);
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const user=async value=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[value||'']);await db.exec(value?'set role authenticated':'set role anon');};
const list=async()=> (await q('select list_sae_monthly_matches($1) result',[destination]))[0].result;
const state=async()=> (await list()).find(s=>s.candidateId===b);
const apply=async signature=>q('select sae_apply_monthly_2500($1,$2)',[b,signature]);
const code=async()=> (await q('select result_code from sae_candidates where id=$1',[b]))[0].result_code;
const patch=async(c,fields)=>q(`update sae_candidates set ${Object.keys(fields).map((key,i)=>`${key}=$${i+2}`).join(',')} where id=$1`,[c,...Object.values(fields)]);
const settings={annualHiringPeriods:[{year:2026,months:[{month:10,period1Start:'2026-10-01',period1End:'2026-10-15',period2Start:'2026-10-16',period2End:'2026-10-31'}]}]};
const reset=async()=>{
  await db.exec('reset role;truncate sae_candidates,sae_reports,sae_needs,sae_generated_documents,trabajadores,user_settings,sae_private.code_state,sae_private.code_audit cascade');
  await user(owner);await q("select set_config('test.update','true',false)");
  await q('insert into user_settings values($1,$2)',[owner,settings]);
  await q("insert into sae_needs values($1,$3,'A','Obra de origen',10,2026,'en_contratacion'),($2,$3,'B','Obra de destino',10,2026,'en_contratacion')",[origin,destination,owner]);
  await q("insert into sae_reports(id,need_id,owner_id,detected_legend) values($1,$3,$5,$6),($2,$4,$5,$6)",[r1,r2,origin,destination,owner,{'2001':'Contratará al candidato','2500':'Ya estaba ocupado el puesto de trabajo','2212':'Otros motivos'}]);
  await q(`insert into sae_candidates(id,need_id,source_report_id,owner_id,normalized_full_name,original_full_name,work_code,work_name,hiring_month,category,result_code)
    values($1,$3,$5,$7,'  HINOJO  GARCÍA JUAN  ','Hinojo García Juan','A','Obra de origen',10,'Oficial de albañilería','2001'),
    ($2,$4,$6,$7,'hinojo garcia juan','Hinojo Garcia Juan','B','Obra de destino',10,'Encofrador',null)`,[a,b,origin,destination,r1,r2,owner]);
};
const register=async()=>{await q("insert into trabajadores(owner_id,id,periodo_inicio,periodo_fin,data,apellidos_nombre,obra,categoria) values($1,100,'2026-10-01','2026-10-31','{}','HINOJO GARCIA JUAN','A','Oficial')",[owner]);await patch(a,{status:'contratado',existing_worker_owner_id:owner,existing_worker_id:100});};
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function sae_has_permission(action text) returns boolean language sql stable as $$select action='read' or coalesce(current_setting('test.update',true),'true')='true'$$;
    grant usage on schema auth to anon,authenticated;
    create table sae_needs(id uuid primary key,owner_id uuid,work_code text,work_name text,hiring_month int,hiring_year int,status text);
    create table sae_reports(id uuid primary key,need_id uuid,owner_id uuid,updated_by uuid,processing_status text default 'review',detected_legend jsonb);
    create table sae_candidates(id uuid primary key,need_id uuid,source_report_id uuid,owner_id uuid,normalized_full_name text,original_full_name text,
      source_position jsonb default '{"orderNumber":2}',work_code text,work_name text,hiring_month int,fortnight int,category text,dni_nie text,status text default 'sin_asignar',result_code text,result_label text,
      existing_worker_id bigint,existing_worker_owner_id uuid,updated_by uuid,created_at timestamptz default clock_timestamp(),updated_at timestamptz default clock_timestamp());
    create table trabajadores(owner_id uuid,id bigint,periodo_inicio text,periodo_fin text,data jsonb,apellidos_nombre text,obra text,categoria text,primary key(owner_id,id));
    create table user_settings(user_id uuid primary key,settings jsonb);
    create table sae_generated_documents(id uuid,source_report_id uuid);
    create function touch() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;
    create trigger touch before update on sae_candidates for each row execute function touch();
    alter table sae_needs enable row level security;alter table sae_reports enable row level security;alter table sae_candidates enable row level security;
    alter table trabajadores enable row level security;alter table user_settings enable row level security;
    create policy self on sae_needs to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
    create policy self on sae_reports to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
    create policy self on sae_candidates to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
    create policy self on trabajadores to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
    create policy self on user_settings to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
    grant select,insert,update,delete on sae_needs,sae_reports,sae_candidates,trabajadores,user_settings to authenticated;`);
  for(const name of ['20261023140416_sae_fortnight_codes.sql','20261023195934_sae_code_selection_trigger.sql','20261023210429_sae_reopened_draft_codes.sql','20261023214422_sae_monthly_work_matches.sql','20261024201222_sae_reverse_fortnight_suggestions.sql'])
    await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
  await applyBusinessConflictFix(db);
  await reset();await patch(b,{source_position:{orderNumber:1}});
  let ranked=await state();assert.equal(ranked.proposedCode,'2212');assert.equal(ranked.currentCode,null);
  await apply(ranked.signature);assert.equal(await code(),'2212');
  await db.exec('reset role');assert.equal((await q("select new_code from sae_private.code_audit where action='monthly_accepted'"))[0].new_code,'2212');await user(owner);
  await reset();ranked=await state();await patch(b,{source_position:{orderNumber:1}});
  await assert.rejects(apply(ranked.signature),/ha cambiado/,'rank changes invalidate the decision');
  ranked=await state();await q("update sae_reports set detected_legend=detected_legend-'2212'||'{\"2299\":\"Otros motivos\"}' where id=$1",[r2]);
  await assert.rejects(apply(ranked.signature),/ha cambiado/,'catalog changes invalidate the decision');
  ranked=await state();assert.equal(ranked.proposedCode,'2299');await apply(ranked.signature);assert.equal(await code(),'2299');
  for(const legend of [{}, {'2212':'Otros motivos','2299':'Otros motivos'}]) {
    await reset();await patch(b,{source_position:{orderNumber:1}});await q('update sae_reports set detected_legend=$1 where id=$2',[legend,r2]);
    ranked=await state();assert.equal(ranked.proposedCode,null);assert.equal(ranked.canApply,false);await assert.rejects(apply(ranked.signature),/Revise/);
  }
  for(const pos of [null,{}, {orderNumber:3},{orderNumber:'incorrecta'}]) {
    await reset();await patch(b,{source_position:pos});ranked=await state();assert.equal(ranked.canApply,false);await assert.rejects(apply(ranked.signature),/Revise/);
  }
  await reset();await patch(b,{source_position:{orderNumber:1}});await register();
  ranked=await state();assert.equal(ranked.matches[0].status,'registered');await apply(ranked.signature);assert.equal(await code(),'2212');
  await reset();await patch(b,{source_position:{orderNumber:1}});await register();await q("update trabajadores set periodo_inicio='2026-11-01',periodo_fin='2026-11-30'");
  ranked=await state();assert.equal(ranked.canApply,false);await assert.rejects(apply(ranked.signature),/Revise/);
  await reset();let item=await state();assert.equal(item.matches[0].status,'planned');assert.equal(item.matches[0].workCode,'A');
  assert.equal(item.matches[0].category,'Oficial de albañilería');assert.equal(item.canApply,true);assert.equal(await code(),null,'reading never changes a code');
  await apply(item.signature);assert.equal(await code(),'2500');await assert.rejects(apply(item.signature),/ha cambiado/,'duplicate request is rejected');
  await db.exec('reset role');assert.equal((await q("select count(*)::int n from sae_private.code_audit where action='monthly_accepted'"))[0].n,1);await user(owner);
  assert.equal((await state()).currentCode,'2500');
  await reset();await register();item=await state();assert.equal(item.matches[0].status,'registered');assert.equal(item.matches[0].start,'2026-10-01');
  assert.equal(item.matches.length,1,'a linked Directory/SAE contract is shown only once');
  await patch(a,{result_code:'2100'});assert.equal((await state()).matches[0].status,'registered','registered hire remains relevant independently of result code');
  await reset();await patch(a,{dni_nie:'11111111A'});await patch(b,{dni_nie:'22222222B'});assert.equal((await state()).canApply,true,'identity uses names only, never DNI');
  await patch(b,{normalized_full_name:'HINOJO GARCI\u0301A JUAN'});assert.equal((await state()).matches.length,1,'Unicode names normalize');
  await patch(b,{normalized_full_name:'HINOJO PÉREZ JUAN'});assert.equal((await list()).length,0,'no fuzzy surnames');
  await reset();await patch(a,{result_code:null,status:'preseleccionado'});assert.equal((await list()).length,0);
  for(const scope of ['month','year','work']) {
    await reset();if(scope==='month'){await q('update sae_needs set hiring_month=11 where id=$1',[origin]);await patch(a,{hiring_month:11});}
    else if(scope==='year')await q('update sae_needs set hiring_year=2027 where id=$1',[origin]);
    else {await q("update sae_needs set work_code='B' where id=$1",[origin]);await patch(a,{work_code:'B'});}
    assert.equal((await list()).length,0,scope+' scope');
  }
  for(const fields of [{category:'Peón'},{category:''},{fortnight:1},{fortnight:2}]) {await reset();await patch(b,fields);assert.equal((await list()).length,0,'monthly qualified targets only');}
  await reset();await patch(a,{category:'Peón'});item=await state();assert.equal(item.matches[0].overlap,null,'a peon without a fortnight has no invented monthly dates');
  await patch(a,{fortnight:1});assert.equal((await state()).canApply,true,'a defined first fortnight is compared with the qualified monthly target');
  await reset();await q(`insert into sae_candidates select $1,need_id,source_report_id,owner_id,normalized_full_name,original_full_name,source_position,work_code,work_name,hiring_month,fortnight,'Otra categoría',dni_nie,status,result_code,result_label,existing_worker_id,existing_worker_owner_id,updated_by,created_at,updated_at from sae_candidates where id=$2`,[id(32),a]);
  item=await state();assert.equal(item.ambiguous,true);assert.equal(item.canApply,false);await assert.rejects(apply(item.signature),/Revise la identidad/);
  await reset();await q(`insert into sae_candidates select $1,need_id,source_report_id,owner_id,normalized_full_name,original_full_name,source_position,work_code,work_name,hiring_month,fortnight,category,dni_nie,status,result_code,result_label,existing_worker_id,existing_worker_owner_id,updated_by,created_at,updated_at from sae_candidates where id=$2`,[id(32),b]);assert.equal((await state()).ambiguous,true);
  await reset();await register();await q("update trabajadores set periodo_inicio='2026-10-01',periodo_fin='2026-10-15'");
  const late={annualHiringPeriods:[{year:2026,months:[{month:10,period1Start:'2026-10-16',period1End:'2026-10-20',period2Start:'2026-10-21',period2End:'2026-10-31'}]}]};
  await q('update user_settings set settings=$1',[late]);item=await state();assert.equal(item.matches[0].overlap,false);assert.equal(item.canApply,false,'same month without overlapping dates is only an antecedent');
  await reset();await q("update user_settings set settings='{}'");item=await state();assert.equal(item.matches[0].overlap,null);assert.equal(item.canApply,false,'unknown dates require review');
  await reset();await q('update user_settings set settings=$1',[{annualHiringPeriods:[{year:2026,periods:[{month:10,startDate:'2026-10-01',endDate:'2026-10-31'}]}]}]);
  item=await state();assert.equal(item.start,'2026-10-01');assert.equal(item.end,'2026-10-31');assert.equal(item.canApply,true,'legacy annual periods agree with the existing service normalization');
  await reset();await register();await q("update trabajadores set periodo_inicio='2026-02-30'");assert.equal((await state()).matches[0].overlap,null,'invalid dates do not crash or invent an overlap');
  await reset();item=await state();await patch(a,{result_code:null});await assert.rejects(apply(item.signature),/ha cambiado/);
  await reset();await patch(a,{result_code:null});
  await q("insert into trabajadores(owner_id,id,periodo_inicio,periodo_fin,data,apellidos_nombre,obra,categoria) values($1,101,'2026-10-01','2026-10-31','{}','HINOJO GARCÍA JUAN','A','Carpintero')",[owner]);
  item=await state();assert.equal(item.matches[0].origin,'directory');assert.equal(item.matches[0].status,'registered');assert.equal(item.canApply,true);
  await apply(item.signature);assert.equal(await code(),'2500','Directory contracts without an SAE candidate are detected too');
  await db.exec('reset role');assert.equal((await q("select source_worker_id from sae_private.code_audit where action='monthly_accepted'"))[0].source_worker_id,101);await user(owner);
  await reset();await patch(a,{result_code:null});
  await user(other);await q("insert into trabajadores(owner_id,id,periodo_inicio,periodo_fin,data,apellidos_nombre,obra,categoria) values($1,101,'2026-10-01','2026-10-31','{}','HINOJO GARCÍA JUAN','A','Carpintero')",[other]);
  await q("insert into sae_needs values($1,$2,'C','Otra obra privada',10,2026,'en_contratacion')",[id(12),other]);
  await q("insert into sae_reports(id,need_id,owner_id,detected_legend) values($1,$2,$3,'{}')",[id(22),id(12),other]);
  await q("insert into sae_candidates(id,need_id,source_report_id,owner_id,normalized_full_name,work_code,work_name,hiring_month,result_code) values($1,$2,$3,$4,'HINOJO GARCIA JUAN','C','Otra obra privada',10,'2001')",[id(32),id(12),id(22),other]);
  await user(owner);assert.equal((await list()).length,0,'other supervisors are excluded from both Directory and SAE matches');
  await patch(a,{result_code:'2001',source_report_id:id(22)});assert.equal((await list()).length,0,'a borrowed report cannot authorize a match');
  await reset();await register();item=await state();await q("update trabajadores set periodo_fin='2026-10-25'");await assert.rejects(apply(item.signature),/ha cambiado/,'contract date corrections invalidate stale decisions');
  await reset();item=await state();await patch(b,{result_code:'2200'});await assert.rejects(apply(item.signature),/ha cambiado/);
  item=await state();assert.equal(item.currentCode,'2200');await apply(item.signature);assert.equal(await code(),'2500','explicit action authorizes replacing a manual value');
  await reset();item=await state();await db.exec('reset role');
  await db.exec(`create function reject_monthly_audit() returns trigger language plpgsql as $$begin if new.action='monthly_accepted' then raise exception 'forced audit failure';end if;return new;end$$;
    create trigger reject_monthly_audit before insert on sae_private.code_audit for each row execute function reject_monthly_audit();`);
  await user(owner);await assert.rejects(apply(item.signature),/forced audit failure/);assert.equal(await code(),null,'audit failure rolls back the result too');
  await db.exec('reset role;drop trigger reject_monthly_audit on sae_private.code_audit');await user(owner);
  await apply(item.signature);assert.equal(await code(),'2500','same decision can be retried after a rolled-back failure');
  for(const locked of ['report','history','need','linked','document']) {
    await reset();
    if(locked==='report')await q("update sae_reports set detected_legend=detected_legend||'{\"__workflow_state\":\"finalized\"}' where id=$1",[r2]);
    if(locked==='history')await q("update sae_reports set detected_legend=detected_legend||'{\"__finalized_versions\":[{\"version\":1}]}' where id=$1",[r2]);
    if(locked==='need')await q("update sae_needs set status='finalizada' where id=$1",[destination]);
    if(locked==='linked')await patch(b,{existing_worker_id:200});
    if(locked==='document'){await db.exec('reset role');await q('insert into sae_generated_documents values($1,$2)',[id(70),r2]);await user(owner);}
    item=await state();assert.equal(item.locked,true,locked+' is protected');assert.equal(item.canApply,false);await assert.rejects(apply(item.signature),/Revise/);
  }
  await reset();const archive=[{version:1,candidates:[{id:b,resultCode:'2200'}]}];await q('update sae_reports set detected_legend=detected_legend||$1 where id=$2',[{__workflow_state:'review',__finalized_versions:archive},r2]);
  await apply((await state()).signature);assert.deepEqual((await q("select detected_legend->'__finalized_versions' v from sae_reports where id=$1",[r2]))[0].v,archive);
  await reset();item=await state();await q("select set_config('test.update','false',false)");assert.equal((await state()).canApply,false);await assert.rejects(apply(item.signature),/permiso/);await q("select set_config('test.update','true',false)");
  await user(other);await assert.rejects(list(),/no accesible/);await assert.rejects(apply(item.signature),/no accesible/);
  await assert.rejects(q('select sae_private.monthly_matches($1,$2)',[owner,destination]),/permission denied/);
  await user(null);await assert.rejects(list(),/permission denied/);await assert.rejects(apply(item.signature),/permission denied/);
  console.log('PASS monthly SAE: name-only identity, category changes, owner/work/month/year scope, planned/registered status, periods, overlap/unknown dates, ambiguity, explicit/stale/double decisions, issued reports, archive and ACL/RLS.');
}catch(e){console.error(e.message,e.where||'',e.detail||'');process.exitCode=1;}
finally{await db.close();}

