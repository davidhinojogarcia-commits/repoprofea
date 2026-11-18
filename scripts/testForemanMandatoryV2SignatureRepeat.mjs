import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

// Execute the actual V2 signing and revocation functions on an isolated,
// deterministic PostgreSQL fixture; never touch live documents.
const db=new PGlite();
const migration=fs.readFileSync(new URL('../supabase/migrations/20261003090000_mandatory_traceability_v2.sql',import.meta.url),'utf8');
const correction=fs.readFileSync(new URL('../supabase/migrations/20261009192354_manual_foreman_publication_and_signature_revoke.sql',import.meta.url),'utf8');
const functionSql=(source,name)=>{
  const start=source.toLowerCase().indexOf('create or replace function public.'+name+'(');
  assert(start>=0,'Missing real RPC '+name);
  const end=source.indexOf('$$;',start);
  assert(end>start,'SQL delimiter missing for '+name);
  return source.slice(start,end+3);
};
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=uuid(1),otherOwner=uuid(2),foreignDoc=uuid(99);
const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
const rpc=async(name,...args)=>(await query(
  'select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as result',args
))[0].result;
const as=async(role)=>{await db.exec('reset role');if(role)await db.exec('set role '+role);};
const sign='sign_mandatory_document_worker_v2';
const revoke='revoke_mandatory_signature_v2';
const validInk=value=>'data:image/png;base64,'+Buffer.from('ink-for-'+value+'-signed').toString('base64');
const table=async(name,doc)=>query('select * from public.'+name+' where document_id=$1',[doc]);

try{
  await db.exec([
    'create role anon; create role authenticated; create schema extensions;',
    "create function extensions.digest(text,text) returns bytea language sql immutable as $$ select sha256(convert_to($1,'UTF8')) $$;",
    'grant usage on schema public,extensions to anon,authenticated;',
    'create table public.foreman_portal_access(owner_id uuid,obra text,foreman_name text,token_hash text,active boolean);',
    "create table public.foreman_mandatory_documents(id uuid primary key,owner_id uuid,obra text,document_type text,signatures jsonb default '{}'::jsonb,status text,lifecycle_status text,details jsonb default '{}'::jsonb,completed_at timestamptz,updated_at timestamptz);",
    "create table public.mandatory_document_workers_v2(id uuid primary key,document_id uuid,owner_id uuid,legacy_worker_id bigint,detection_status text,frozen_at timestamptz,position_status text,signature_box jsonb);",
    "create table public.mandatory_document_signatures_v2(document_id uuid,document_worker_id uuid primary key,owner_id uuid,signature text,signature_sha256 text,signed_at timestamptz,updated_at timestamptz);",
    "create table public.foreman_mandatory_pdf_files(document_id uuid,owner_id uuid,original_pdf bytea,signed_pdf bytea,signed_sha256 text,fidelity jsonb,updated_at timestamptz);",
    "create table public.mandatory_document_versions_v2(document_id uuid,version_no integer,signed_pdf bytea,signed_sha256 text);",
    "create table public.mandatory_document_events_v2(document_id uuid,owner_id uuid,document_worker_id uuid,event_type text,actor_type text,actor_name text,metadata jsonb,dedup_key text unique);",
    "create function public.mandatory_v2_box_valid(jsonb) returns boolean language sql immutable as $$ select $1 is not null $$;",
    functionSql(migration,sign),functionSql(correction,revoke),
    "revoke all on function public."+sign+"(text,uuid,uuid,text) from public;",
    "grant execute on function public."+sign+"(text,uuid,uuid,text) to anon,authenticated;",
    "revoke all on function public."+revoke+"(text,uuid,uuid) from public;",
    "grant execute on function public."+revoke+"(text,uuid,uuid) to anon,authenticated;"
  ].join('\n'));
  await query("insert into public.foreman_portal_access values($1,'OBRA A','ENCARGADO',encode(extensions.digest('valid-token','sha256'),'hex'),true)",[owner]);
  await query("insert into public.foreman_portal_access values($1,'OBRA B','OTRO',encode(extensions.digest('foreign-token','sha256'),'hex'),true)",[otherOwner]);

  const fixtures=[];
  for(const [idx,type] of ['control_presencia','inicio','contrato','prorroga'].entries()){
    for(const [stateIdx,state] of ['IN_SIGNATURE','RETURNED_FOR_CORRECTION'].entries()){
      const doc=uuid(100+idx*10+stateIdx);
      const ids=['contrato','prorroga'].includes(type)?[1]:[1,2];
      const legacy=Object.fromEntries(ids.map(n=>[String(n),{signature:validInk(type+'-'+n)}]));
      await query("insert into public.foreman_mandatory_documents(id,owner_id,obra,document_type,status,lifecycle_status,signatures,details) values($1,$2,'OBRA A',$3,$4,$5,$6::jsonb,$7::jsonb)",[
        doc,owner,type,stateIdx===0?'in_progress':'returned',state,JSON.stringify(legacy),JSON.stringify({lifecycleStatus:state})
      ]);
      for(const n of ids){
        const workerId=uuid(1000+idx*100+stateIdx*10+n);
        await query("insert into public.mandatory_document_workers_v2 values($1,$2,$3,$4,'CONFIRMED',now(),'RESOLVED',$5::jsonb)",[workerId,doc,owner,n,'{"x":100,"y":50,"width":80,"height":20}']);
        await query("insert into public.mandatory_document_signatures_v2(document_id,document_worker_id,owner_id,signature,signature_sha256) values($1,$2,$3,$4,'old-hash')",[doc,workerId,owner,validInk(type+'-'+n)]);
      }
      await query("insert into public.foreman_mandatory_pdf_files(document_id,owner_id,original_pdf,signed_pdf,signed_sha256) values($1,$2,decode('5044462d4f524947494e414c','hex'),decode('5044462d43555252454e54','hex'),'sha-current')",[doc,owner]);
      await query("insert into public.mandatory_document_versions_v2 values($1,1,decode('5044462d484953544f5259','hex'),'sha-history')",[doc]);
      fixtures.push({doc,type,state,ids,worker:uuid(1000+idx*100+stateIdx*10+1)});
    }
  }
  await query("insert into public.foreman_mandatory_documents(id,owner_id,obra,document_type,status,lifecycle_status,signatures) values($1,$2,'OBRA B','inicio','in_progress','IN_SIGNATURE','{\"1\":\"signed\"}'::jsonb)",[foreignDoc,otherOwner]);
  await query("insert into public.mandatory_document_workers_v2 values($1,$2,$3,1,'CONFIRMED',now(),'RESOLVED','{\"x\":100}'::jsonb)",[uuid(9000),foreignDoc,otherOwner]);
  await query("insert into public.mandatory_document_signatures_v2(document_id,document_worker_id,owner_id,signature) values($1,$2,$3,$4)",[foreignDoc,uuid(9000),otherOwner,validInk('foreign')]);

  await as('anon');
  await assert.rejects(rpc(revoke,'wrong-token',fixtures[0].doc,fixtures[0].worker),/Acceso no válido/);
  await assert.rejects(rpc(revoke,'valid-token',foreignDoc,uuid(9000)),/Documento no válido/);
  await assert.rejects(rpc(revoke,'valid-token',fixtures[0].doc,uuid(9000)),/Persona documental no válida/);
  for(const fixture of fixtures){
    const result=await rpc(revoke,'valid-token',fixture.doc,fixture.worker);
    assert.equal(result.revoked,true,'target signature revoked: '+fixture.type+' '+fixture.state);
    await as();
    const row=(await query('select signatures,lifecycle_status from public.foreman_mandatory_documents where id=$1',[fixture.doc]))[0];
    assert.equal(row.signatures['1'],undefined,'legacy signature removed');
    assert.equal(row.lifecycle_status,fixture.state,'revoke never silently changes workflow status');
    if(fixture.ids.length>1)assert(row.signatures['2'],'other signer retained');
    assert.equal((await table('mandatory_document_signatures_v2',fixture.doc)).length,fixture.ids.length-1);
    const file=(await table('foreman_mandatory_pdf_files',fixture.doc))[0];
    assert(file.original_pdf,'original PDF must remain');
    assert.equal(file.signed_pdf,null,'active signed PDF invalidated');
    assert.equal((await table('mandatory_document_versions_v2',fixture.doc)).length,1,'historical signed PDF remains');
    const events=(await table('mandatory_document_events_v2',fixture.doc));
    assert.equal(events.filter(e=>e.event_type==='SIGNATURE_REVOKED').length,1,'audited revocation');
    await as('anon');
    const signed=await rpc(sign,'valid-token',fixture.doc,fixture.worker,validInk('repeated-'+fixture.type+'-'+fixture.state));
    assert.equal(signed.signed,fixture.ids.length,'worker signs again and all other signatures remain');
    await as();
    const final=(await query('select signatures,lifecycle_status from public.foreman_mandatory_documents where id=$1',[fixture.doc]))[0];
    assert(final.signatures['1'].signature.startsWith('data:image/'));
    if(fixture.ids.length>1)assert(final.signatures['2'],'other worker still signed');
    assert.equal(final.lifecycle_status,'IN_SIGNATURE','re-sign leaves document ready to resubmit');
    assert.equal((await table('mandatory_document_versions_v2',fixture.doc)).length,1,'historical version never overwritten by repeat');
    await as('anon');
  }
  await as();
  const blocked=fixtures[0];
  await query("update public.foreman_mandatory_documents set lifecycle_status='REVIEWED',status='reviewed' where id=$1",[blocked.doc]);
  await as('anon');
  await assert.rejects(rpc(revoke,'valid-token',blocked.doc,blocked.worker),/supervisor debe devolverlo/);
  await assert.rejects(rpc(sign,'valid-token',blocked.doc,blocked.worker,validInk('illegal-resign')),/no disponible para firma/);
  await as();
  assert.equal((await table('mandatory_document_versions_v2',blocked.doc)).length,1,'reviewed history preserved');
  assert.equal((await table('mandatory_document_signatures_v2',blocked.doc)).length,blocked.ids.length,'reviewed signatures retained');
  console.log('PASS: actual V2 SQL (anon token, owner/obra, target-only revoke and re-sign, PDF/history/audit, submitted guards) for Control, Inicio, Contrato and Prórroga in both editable states.');
}finally{
  await as();
  await db.close();
}
