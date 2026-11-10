import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleDfOwner,handleDfGuest} from '../src/server/visitDfContributions.ts';

const owner='10000000-0000-4000-8000-000000000001';
const recordId='20000000-0000-4000-8000-000000000001';
const personId='30000000-0000-4000-8000-000000000001';
const digest=x=>createHash('sha256').update(x).digest('hex');
const state={participants:[{id:personId,firstName:'Ana',lastName:'Arquitecta',role:'Dirección Facultativa',email:'arquitecta@example.test'}],
  content:{points:[{id:'40000000-0000-4000-8000-000000000001',title:'Punto previo',description:'Texto exclusivo del supervisor',attachmentIds:[]}]}};
let record={id:recordId,owner_id:owner,obra_id:'50000000-0000-4000-8000-000000000001',
  version:1,revision:1,status:'draft',number:'AV-2026-000001',worksite:'Obra prueba',visit_date:'2026-11-10',state};
const invites=[],contributions=[];let lastCode='',sends=0;
const rows=(path,collection)=>{const query=new URLSearchParams(path.split('?')[1]);
  return collection.filter(row=>Array.from(query.entries()).every(([key,v])=>
    key==='select'||key==='limit'||key==='order'||(v.startsWith('eq.')?String(row[key])===v.slice(3):true)));
};
const database=async(path,body,auth,method)=>{
  if(path.startsWith('visit_df_invitations?')){
    const found=rows(path,invites);
    if(method==='PATCH'){for(const item of found)Object.assign(item,body);return found;}
    return found;
  }
  if(path==='visit_df_invitations'){invites.push({...body});return [body];}
  if(path.startsWith('visit_minutes?'))return rows(path,[record]);
  if(path.startsWith('visit_df_contributions?'))return rows(path,contributions);
  if(path==='visit_minutes_events')return [body];
  if(path==='rpc/visit_minutes_owner_can_write')return true;
  if(path==='rpc/visit_df_challenge'){
    const invite=invites.find(i=>i.id===body.p_id);if(!invite||invite.requests>=10)return false;
    invite.otp_hash=body.p_hash;invite.requests++;return true;
  }
  if(path==='rpc/visit_df_verify'){
    const invite=invites.find(i=>i.id===body.p_id);if(!invite||invite.otp_hash!==body.p_hash)return false;
    invite.session_hash=body.p_session_hash;invite.session_expires_at=new Date(Date.now()+3600000).toISOString();
    invite.otp_hash=null;return true;
  }
  if(path==='rpc/visit_df_submit'){
    const invite=invites.find(i=>i.id===body.p_id);assert.equal(invite.session_hash,body.p_session_hash);
    const id='60000000-0000-4000-8000-'+String(contributions.length+1).padStart(12,'0');
    contributions.push({id,invitation_id:invite.id,record_id:record.id,version:1,person_id:personId,
      title:body.p_title,description:body.p_description,status:'pending'});return id;
  }
  if(path==='rpc/visit_df_review'){
    const item=contributions.find(x=>x.id===body.p_id);
    assert(item&&item.status==='pending');assert.equal(body.p_revision,record.revision);
    item.status=body.p_accept?'accepted':'rejected';
    if(body.p_accept){record.state.content.points.push({id:'70000000-0000-4000-8000-000000000001',
      title:item.title,description:item.description,attachmentIds:[]});record.revision++;}
    return true;
  }
  throw Error('Unmocked database path: '+path);
};
const sendCode=async(_,email,subject,body)=>{assert.equal(email,'arquitecta@example.test');assert(subject.includes('Código'));lastCode=body.match(/\b\d{6}\b/)[0];sends++;};
const deps={database,digest,sendCode,ownerRecord:async(id,user)=>{
  if(id!==recordId||user!==owner)throw Object.assign(new Error('Sin permiso'),{status:403});
  return {...record,canWrite:true};
}};
const respond=()=>({json(value){this.result=value;return value;}});
const actor={id:owner};
await assert.rejects(handleDfOwner({action:'df-invite',id:recordId,personId},respond(),deps,{id:'90000000-0000-4000-8000-000000000001'},'token'),/permiso/);
let res=respond();await handleDfOwner({action:'df-invite',id:recordId,personId},res,deps,actor,'token');
assert.equal(invites.length,1);
const url=new URL(res.result.url),token=new URLSearchParams(url.hash.slice(1)).get('visit-df');
assert(token&&token.length===43);
await assert.rejects(handleDfGuest({action:'df-portal-get',token,session:'bad'},respond(),deps),/Verifica/);
await handleDfGuest({action:'df-challenge',token},respond(),deps);assert.equal(sends,1);
await assert.rejects(handleDfGuest({action:'df-verify',token,code:'000000'},respond(),deps),/incorrecto/);
res=respond();await handleDfGuest({action:'df-verify',token,code:lastCode},res,deps);
const session=res.result.session;assert.equal(session.length,43);
await handleDfGuest({action:'df-submit',token,session,title:'Cotas',description:'Revisar las cotas antes de hormigonar'},respond(),deps);
assert.equal(contributions.length,1);
const baseline=record.state.content.points[0];
res=respond();await handleDfOwner({action:'df-list',id:recordId},res,deps,actor,'token');assert.equal(res.result.contributions.length,1);
await handleDfOwner({action:'df-review',id:recordId,revision:1,contributionId:contributions[0].id,accept:true},respond(),deps,actor,'token');
assert.equal(record.state.content.points.length,2);assert.deepEqual(record.state.content.points[0],baseline);
assert.equal(record.state.content.points[1].description,'Revisar las cotas antes de hormigonar');
await assert.rejects(handleDfOwner({action:'df-review',id:recordId,revision:1,contributionId:contributions[0].id,accept:true},respond(),deps,actor,'token'),/cambiado|pendiente/);
await handleDfOwner({action:'df-revoke',id:recordId,personId},respond(),deps,actor,'token');
await assert.rejects(handleDfGuest({action:'df-submit',token,session,description:'No debe entrar'},respond(),deps),/revocada/);
console.log('PASS: DF invite owner isolation, OTP verification, restricted portal, submission, append-only review, stale rejection and revocation; database mocked.');
