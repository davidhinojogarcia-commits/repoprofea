import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import {content,person,png,id} from './visitMinutesFixture.mjs';
const output=new URL('./.visit-domain.mjs',import.meta.url),now='2026-10-16T08:00:00.000Z';
try{
 await build({entryPoints:['src/lib/visitMinutes.ts'],outfile:output.pathname,bundle:true,platform:'node',format:'esm'});
 const {newVisit,applyVisitCommand:act,cleanContact,cleanVisit,visitMail,madridTimestamp}=await import(output.href);
 let state=newVisit(content,[person(),person(21)],now);const initial=structuredClone(state);
 assert.throws(()=>act(state,{type:'finalize'},now),/firmas/);
 assert.throws(()=>act(state,{type:'sign',personId:id(20),image:png,mode:'email-code'},now),/abierta/);
 state=act(state,{type:'review'},now);assert.equal(initial.status,'draft');
 assert.throws(()=>act(state,{type:'save',content,participants:[person()]},now),/nueva versión/);
 assert.throws(()=>act(state,{type:'open-signing'},now),/conformidades/);
 assert.throws(()=>act(state,{type:'respond',personId:id(99),decision:'agree',comment:'',mode:'email-code'},now),/persona/);
 for(const p of [person(),person(21)])state=act(state,{type:'respond',personId:p.id,decision:'agree',comment:p.id===id(20)?'Conforme con el replanteo.':'',mode:'email-code'},now);
 assert.throws(()=>act(state,{type:'respond',personId:id(20),decision:'agree',comment:'',mode:'email-code'},now),/ya ha respondido/);
 state=act(state,{type:'open-signing'},now);
 for(const p of [person(),person(21)])state=act(state,{type:'sign',personId:p.id,image:png,mode:'in-person'},now);
 assert.throws(()=>act(state,{type:'sign',personId:id(20),image:png,mode:'in-person'},now),/confirmada/);
 state=act(state,{type:'finalize'},now);assert.equal(state.status,'signed');
 const snapshot=structuredClone(state);state=act(state,{type:'followup',agreementId:id(40),done:true,note:'Cotas comprobadas.',mode:'in-person'},now);
 assert.deepEqual(state.content,snapshot.content);assert.deepEqual(state.signatures,snapshot.signatures);
 const revised=act(state,{type:'revise'},now);assert.equal(revised.version,2);assert.equal(revised.status,'draft');assert.deepEqual(revised.responses,{});assert.deepEqual(revised.signatures,{});assert.equal(state.version,1);
 for(const decision of ['changes','reject']){
   let s=act(newVisit(content,[person()],now),{type:'review'},now);
   assert.throws(()=>act(s,{type:'respond',personId:id(20),decision,comment:'',mode:'email-code'},now),/Explica/);
   s=act(s,{type:'respond',personId:id(20),decision,comment:'Revisar las cotas.',mode:'email-code'},now);assert.equal(s.status,decision==='reject'?'rejected':'changes');assert.throws(()=>act(s,{type:'open-signing'},now),/conformidades/);
 }
 assert.throws(()=>cleanVisit({...content,date:'2026-02-30'},[person()]),/Fecha/);
 assert.throws(()=>cleanVisit({...content,end:'08:00'},[person()]),/posterior/);
 assert.throws(()=>cleanVisit(content,[person(),{...person(21),email:person().email}]),/propio correo/);
 assert.throws(()=>cleanVisit(content,[{...person(),signing:'required',reviewRequired:false}]),/revisar/);
 assert.throws(()=>act(newVisit(content,[{...person(),email:''}],now),{type:'review'},now),/correo/);
 assert.throws(()=>act(newVisit(content,[],now),{type:'review'},now),/firmante/);
 assert.throws(()=>cleanContact({...person(),assignments:[{worksiteId:id(10),role:''},{worksiteId:id(10),role:''}]}),/duplicadas/);
 const contact=cleanContact({...person(),email:'',assignments:[]});assert.equal(contact.email,'');assert(!('signature'in contact));
 assert(madridTimestamp('2026-03-29T01:30:00Z').includes('3:30'));assert(madridTimestamp('2026-10-25T01:30:00Z').includes('2:30'));
 const mail=visitMail(snapshot,'AV-2026-000001','final',person());assert(mail.body.includes(content.agreements[0].text));assert(!mail.body.includes(person(21).email));
 const cancelled=act(snapshot,{type:'cancel',reason:'Visita duplicada'},now);assert.throws(()=>act(cancelled,{type:'revise'},now),/anulada/);assert.deepEqual(cancelled.signatures,snapshot.signatures);
 console.log('PASS: visit state machine, consent/version/signature isolation, required and optional data, snapshots, follow-up, DST, recipient privacy and immutable cancellation.');
}finally{await fs.rm(output,{force:true});}
