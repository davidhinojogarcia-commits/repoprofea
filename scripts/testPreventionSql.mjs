import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { preventionSqlFixture, owner, other, token } from './preventionSqlFixture.mjs';
const { db, asUser } = await preventionSqlFixture();

async function save(id,data,accessToken=null,version=null) {
  return (await db.query('select public.save_prevention_record($1,$2,$3,$4) as record',[id,data,accessToken,version])).rows[0].record;
}
async function list(accessToken=null) {
  return (await db.query('select public.list_prevention_records($1) as result',[accessToken])).rows[0].result;
}
const draft = { obra:'Obra A',kind:'incident',work_date:'2026-10-01',category:'Excavaciones',severity:'high',title:'Borde sin protección',task:'Excavación',description:'Falta protección en el borde',measures:'Balizar',responsible:'Responsable',deadline:'2026-10-02',checks:{},photo:null };
const id=crypto.randomUUID();
try {
  await asUser(null,'anon');
  await assert.rejects(list(),/iniciar sesión/);
  await assert.rejects(list('invalid'),/revocado/);
  await assert.rejects(db.query('select * from public.prevention_records'),/permission denied/);
  await asUser(owner);
  const initial=await save(id,draft);
  assert.equal(initial.status,'pending'); assert.equal(initial.actor,'Supervisor');
  await save(id,draft); assert.equal((await list()).records.length,1,'Retry must not duplicate');
  await assert.rejects(save(id,{...draft,title:'Otro contenido'}),/Otro usuario/);
  await assert.rejects(save(crypto.randomUUID(),{...draft,obra:'Obra ajena'}),/configuración/);
  await assert.rejects(save(crypto.randomUUID(),{...draft,description:''}),/Describe/);
  await assert.rejects(db.query('insert into public.prevention_records(id) values ($1)',[crypto.randomUUID()]),/permission denied/);
  await asUser(other);
  assert.equal((await list()).records.length,0);
  assert.equal((await db.query('select * from public.prevention_records')).rows.length,0,'RLS must isolate owners');
  await assert.rejects(save(id,draft),/no disponible/);
  await assert.rejects(db.query('select public.get_prevention_record_details($1,null)',[id]),/no disponible/);
  await asUser(owner);
  await assert.rejects(save(id,{status:'closed',measures:'',responsible:'David'},null,initial.updated_at),/medidas/);
  const closed=await save(id,{status:'closed',measures:'Protección instalada',responsible:'David',deadline:''},null,initial.updated_at);
  assert.ok(closed.resolved_at);
  await assert.rejects(save(id,{status:'pending',measures:'Cambio antiguo',responsible:'David'},null,initial.updated_at),/Otro usuario/);
  const reopened=await save(id,{status:'in_progress',measures:'Revisar protección',responsible:'David'},null,closed.updated_at);
  assert.equal(reopened.resolved_at,null);
  assert.equal((await db.query('select * from prevention_events where record_id=$1',[id])).rows.length,3);
  const checks=Object.fromEntries(['task','weather','water','access','equipment','specific'].map(k=>[k,'yes']));
  const precheck={...draft,kind:'precheck',checks};
  assert.equal((await save(crypto.randomUUID(),precheck)).status,'closed');
  await assert.rejects(save(crypto.randomUUID(),{...precheck,checks:{task:'yes'}}),/todas las comprobaciones/);
  await assert.rejects(save(crypto.randomUUID(),{...precheck,checks:{...checks,unknown:'yes'}}),/no válidas/);
  await assert.rejects(save(crypto.randomUUID(),{...precheck,checks:{...checks,weather:'no'},measures:''}),/medidas/);
  assert.equal((await save(crypto.randomUUID(),{...precheck,checks:{...checks,weather:'no'}})).status,'pending');
  const otherWork=await save(crypto.randomUUID(),{...draft,obra:'Obra B'});
  const photo='data:image/jpeg;base64,YWJj';
  const withPhoto=await save(crypto.randomUUID(),{...draft,photo});
  const listed=(await list()).records.find(r=>r.id===withPhoto.id);
  assert.equal(listed.has_photo,true); assert.equal(listed.photo,undefined,'List must not load photos');
  await assert.rejects(save(crypto.randomUUID(),{...draft,photo:'javascript:alert(1)'}),/check constraint/);
  await asUser(null,'anon');
  const portalList=await list(token); assert.ok(portalList.records.every(r=>r.obra==='Obra A'));
  const portalRecord=await save(crypto.randomUUID(),draft,token); assert.equal(portalRecord.actor,'Encargado A');
  await assert.rejects(save(crypto.randomUUID(),{...draft,obra:'Obra B'},token),/no corresponde/);
  await assert.rejects(save(id,{status:'closed',responsible:'X',measures:'X'},token,reopened.updated_at),/supervisor/);
  const details=(await db.query('select public.get_prevention_record_details($1,$2) as result',[withPhoto.id,token])).rows[0].result;
  assert.equal(details.photo,photo); assert.equal(details.events.length,1);
  assert.ok(!('owner_id' in details.events[0]));
  await assert.rejects(db.query('select public.get_prevention_record_details($1,$2)',[otherWork.id,token]),/no disponible/,'Report photo access must not cross work boundaries');
  await db.exec('reset role');
  await db.query('update foreman_portal_access set active=false');
  await asUser(null,'anon'); await assert.rejects(list(token),/revocado/);
  console.log('PASS: SQL ejecutado en Postgres local; persistencia, reintentos, cierres, concurrencia, comprobaciones, fotos, RLS y acceso/revocación del encargado.');
} finally { await db.close(); }
