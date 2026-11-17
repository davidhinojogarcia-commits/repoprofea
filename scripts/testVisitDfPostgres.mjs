import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {visitTestServer} from './visitMinutesTestServer.mjs';
import {id,content,person} from './visitMinutesFixture.mjs';

const env=await visitTestServer();
const call=async(body,user=1)=>{
  const result=await env.invoke(body,user);
  assert.equal(result.status,200,JSON.stringify({action:body.action,status:result.status,message:result.data.message,problems:env.problems.slice(-3)}));
  return result.data;
};
const direct=async(sql,args=[])=>{await env.db.exec('reset role');return(await env.db.query(sql,args)).rows;};
try{
  const work={...content,workflow:'3.1',discussion:'',agreements:[],
    points:[{id:randomUUID(),title:'Punto del supervisor',description:'Replanteo pendiente de comprobar.',attachmentIds:[]}]};
  const df={...person(20),role:'Dirección Facultativa',email:'arquitecta@example.test'};
  const other={...person(21),role:'Encargado de obra',email:'encargado@example.test'};
  const created=(await call({action:'create',id:id(92),operation:randomUUID(),content:work,participants:[df,other]})).record;
  assert.equal(created.status,'draft');
  assert.equal((await env.invoke({action:'df-list',id:created.id},2)).status,403,'foreign owner cannot inspect contributions');
  assert.equal((await env.invoke({action:'df-invite',id:created.id,personId:other.id})).status,400,'non-DF cannot receive invite');
  const url=(await call({action:'df-invite',id:created.id,personId:df.id})).url;
  assert.match(url,/\/\#visit-df=/);
  const token=url.split('visit-df=')[1];
  assert.equal((await env.invoke({action:'df-portal-get',token},null)).status,401,'guest session is required for contribution reads');
  const directSession=(await call({action:'df-open',token},null)).session;
  assert.equal(directSession.length,43,'personal link opens a drafting session without sending email');
  assert.equal((await call({action:'df-portal-get',token,session:directSession},null)).contributions.length,0);

  await call({action:'df-challenge',token},null);
  assert(env.sent.at(-1).raw.includes('arquitecta@example.test'));
  const code=env.sent.at(-1).body.match(/\b\d{6}\b/)[0];
  assert.equal((await env.invoke({action:'df-challenge',token},null)).status,429,'OTP rate limit');
  assert.equal((await env.invoke({action:'df-verify',token,code:code==='000000'?'999999':'000000'},null)).status,403);
  const session=(await call({action:'df-verify',token,code},null)).session;
  assert.equal((await env.invoke({action:'df-verify',token,code},null)).status,403,'OTP cannot be reused');
  assert.equal((await env.invoke({action:'df-submit',token,session:'invalid',operation:randomUUID(),description:'Inyección'},null)).status,401);
  const op=randomUUID();
  const sent=(await call({action:'df-submit',token,session,operation:op,title:'Cubierta',description:'Revisar pendientes de evacuación de aguas.'},null)).id;
  const replay=(await call({action:'df-submit',token,session,operation:op,title:'Cubierta',description:'Revisar pendientes de evacuación de aguas.'},null)).id;
  assert.equal(sent,replay,'operation ID ensures idempotent submission');
  assert.equal((await direct('select count(*)::int as total from visit_df_contributions'))[0].total,1);
  const closeDenied=await env.invoke({action:'command',id:created.id,revision:created.revision,operation:randomUUID(),command:{type:'review',recipientIds:[]}},1);
  assert.equal(closeDenied.status,409,'unreviewed DF point blocks review/signing');
  assert.equal((await direct('select status from visit_minutes where id=$1',[created.id]))[0].status,'draft');
  await assert.rejects(async()=>direct("update public.visit_minutes set status='review' where id=$1",[created.id]),/Existen aportaciones de Dirección Facultativa pendientes/,'PostgreSQL blocks close even if bypassing HTTP handler');

  assert.equal((await env.invoke({action:'df-review',id:created.id,contributionId:sent,accept:true,revision:created.revision},2)).status,403,'foreign supervisor cannot accept');
  const accepted=await call({action:'df-review',id:created.id,contributionId:sent,accept:true,revision:created.revision});
  assert.equal(accepted.record.revision,created.revision+1);
  assert.equal(accepted.record.state.content.points.length,2);
  assert.deepEqual(accepted.record.state.content.points[0],created.state.content.points[0],'supervisor original unchanged');
  assert.match(accepted.record.state.content.points[1].title,/Aportación DF/);
  assert.equal(accepted.record.state.content.points[1].description,'Revisar pendientes de evacuación de aguas.');
  const acceptedInvitation=(await direct('select token_hash from visit_df_invitations where record_id=$1',[created.id]))[0].token_hash;
  assert(acceptedInvitation&&acceptedInvitation.length===64,'only invitation hash is stored');

  assert.equal((await env.invoke({action:'df-review',id:created.id,contributionId:sent,accept:true,revision:created.revision})).status,409,'stale accept denied');
  const second=(await call({action:'df-submit',token,session,operation:randomUUID(),title:'Observaciones',description:'Segundo punto no aceptado.'},null)).id;
  const rejected=await call({action:'df-review',id:created.id,contributionId:second,accept:false,revision:accepted.record.revision});
  assert.equal(rejected.record.state.content.points.length,2,'rejected item never inserted');
  const third=(await call({action:'df-submit',token,session,operation:randomUUID(),
    title:'Propuesta a corregir',description:'Cota sin referencia.'},null)).id;
  const returned=await call({action:'df-return',id:created.id,contributionId:third,
    reason:'Añade la referencia de nivel y replanteo.',revision:rejected.record.revision});
  assert.equal(returned.record.state.content.points.length,2,'returned proposal cannot modify the consolidated draft');
  const portalAfterReturn=await call({action:'df-portal-get',token,session},null);
  assert.equal(portalAfterReturn.contributions.find(p=>p.id===third).status,'returned');
  assert.equal(portalAfterReturn.contributions.find(p=>p.id===third).return_reason,'Añade la referencia de nivel y replanteo.');

  const events=await direct("select event from visit_minutes_events where record_id=$1 and event like 'df-%' order by id",[created.id]);
  assert(events.some(e=>e.event==='df-point-accepted')&&events.some(e=>e.event==='df-point-rejected')&&events.some(e=>e.event==='df-point-returned'));
  await call({action:'df-revoke',id:created.id,personId:df.id});
  assert.equal((await env.invoke({action:'df-submit',token,session,operation:randomUUID(),description:'Prohibido'},null)).status,403);
  await env.db.exec('reset role');
  await env.db.exec('set role authenticated');
  await assert.rejects(()=>env.db.query('select * from visit_df_invitations'),/permission denied/);
  await assert.rejects(()=>env.db.query('select * from visit_df_contributions'),/permission denied/);
  console.log('PASS: real isolated PGlite migration, direct invitation session, server and SQL closure guard, RLS deny, legacy OTP, replay, owner isolation, append-only review and revocation.');
} finally {await env.cleanup();}
