import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { visitTestServer } from './visitMinutesTestServer.mjs';
import { content, person, id } from './visitMinutesFixture.mjs';

const env = await visitTestServer();
const fixtureFetch = globalThis.fetch, requests = [];
const previous = { key:process.env.GEMINI_API_KEY, model:process.env.VISIT_WRITING_MODEL, google:process.env.GOOGLE_API_KEY, generative:process.env.GOOGLE_GENERATIVE_AI_API_KEY };
delete process.env.GOOGLE_API_KEY;delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
process.env.GEMINI_API_KEY='synthetic-test-key';process.env.VISIT_WRITING_MODEL='synthetic-test-model';
let mode='ok';
globalThis.fetch=async(input,init)=>{
  const url=typeof input==='string'?input:input.url;
  if(url?.startsWith('https://generativelanguage.googleapis.com/')){
    const body=JSON.parse(init?.body || await input.clone().text());requests.push(body);
    if(mode==='failure')return new Response(JSON.stringify({error:{message:'PRIVATE_PROVIDER_ERROR synthetic-test-key'}}),{status:503});
    const original=JSON.parse(body.contents[0].parts[0].text);
    const result={points:[{title:original.title||'Revisión',description:original.text}],warnings:[]};
    if(mode==='invalid')result.points[0].description='Se ordena ejecutar 999 m.';
    if(mode==='truncated')return new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:JSON.stringify(result)}]}}]}));
    return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(result)}]}}]}),{status:200});
  }
  return fixtureFetch(input,init);
};
const request={clientVersion:'3.1',action:'assist-writing',worksiteId:id(10),mode:'written',title:'Arqueta',text:'No ejecutar. Pendiente de comprobar 1,50 m.'};
try {
  const beforeStatus=requests.length;
  const status=await env.invoke({action:'writing-status'},null);
  assert.equal(status.status,200);assert.equal(status.data.writing.configured,true);
  assert.equal(requests.length,beforeStatus,'readiness never invokes provider');
  assert(!JSON.stringify(status).includes('synthetic-test-key'),'readiness never exposes credentials');
  delete process.env.VISIT_WRITING_MODEL;
  assert.equal((await env.invoke({action:'writing-status'},null)).data.writing.model,'gemini-2.5-flash-lite');
  process.env.VISIT_WRITING_MODEL='synthetic-test-model';
  const primary=process.env.GEMINI_API_KEY;delete process.env.GEMINI_API_KEY;
  assert.equal((await env.invoke({action:'writing-status'},null)).data.writing.configured,false);
  process.env.GOOGLE_API_KEY=primary;
  assert.equal((await env.invoke({action:'writing-status'},null)).data.writing.configured,true);
  delete process.env.GOOGLE_API_KEY;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY=primary;
  assert.equal((await env.invoke({action:'writing-status'},null)).data.writing.configured,true);
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  for(const name of ['GEMINI_API_KEY','GOOGLE_API_KEY','GOOGLE_GENERATIVE_AI_API_KEY'])process.env[name]='   ';
  const emptyStatus=await env.invoke({action:'writing-status'},null);
  assert.deepEqual(emptyStatus.data.writing,{configured:false,providerConfigured:false,model:'synthetic-test-model'});
  const missing=await env.invoke(request);
  assert.equal(missing.status,503);
  assert.equal(missing.data.code,'VISIT_WRITING_NOT_CONFIGURED');
  assert.equal(requests.length,beforeStatus,'blank credentials fail before the provider');
  delete process.env.GOOGLE_API_KEY;delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;process.env.GEMINI_API_KEY=primary;
  for(const user of [null,2,3,4]){
    const response=await env.invoke(request,user);assert.notEqual(response.status,200,'anonymous, foreign, read-only and inactive users rejected');
  }
  assert.equal(requests.length,0,'authorization before provider');
  const result=await env.invoke({...request,attachments:['must-not-leave-server'],participants:['must-not-leave-server']});
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(requests.length,1);
  assert(!JSON.stringify(requests).includes('must-not-leave-server'),'only minimum text sent');
  assert.deepEqual(Object.keys(JSON.parse(requests[0].contents[0].parts[0].text)).sort(),['mode','text','title']);
  assert(!env.calls.some(c=>c.url?.includes('visit_minutes?')&&c.method==='POST'),'writing does not save an acta');
  assert.equal(env.sent.length,0);assert.equal(env.objects.size,0,'no PDF, audio or asset storage');
  const record=(await env.invoke({clientVersion:'3.1',action:'create',id:randomUUID(),operation:randomUUID(),content,participants:[person()]})).data.record;
  assert(record);
  assert.equal((await env.invoke({...request,id:record.id})).status,200);
  const count=requests.length;
  assert.equal((await env.invoke({...request,id:record.id,worksiteId:id(11)})).status,403);
  assert.equal((await env.invoke({...request,id:record.id},2)).status,403);
  assert.equal(requests.length,count);
  await env.invoke({clientVersion:'3.1',action:'command',id:record.id,revision:record.revision,operation:randomUUID(),command:{type:'review'}});
  assert.equal((await env.invoke({...request,id:record.id})).status,403,'reviewed acta cannot be rewritten');
  mode='invalid';let response=await env.invoke(request);assert.equal(response.status,502);
  mode='truncated';response=await env.invoke(request);assert.equal(response.status,502);
  mode='failure';response=await env.invoke(request);assert.equal(response.status,502);assert(!JSON.stringify(response.data).includes('PRIVATE_PROVIDER_ERROR'));assert(!JSON.stringify(response.data).includes('synthetic-test-key'));
  console.log('PASS writing API: authenticated permissions/RLS in PGlite, draft-only access, minimized provider payload, SDK HTTP adapter, invalid/truncated/failing provider, no mail/files/orders. Provider HTTP simulated.');
} finally {
  if(previous.key===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous.key;
  if(previous.model===undefined)delete process.env.VISIT_WRITING_MODEL;else process.env.VISIT_WRITING_MODEL=previous.model;
  if(previous.google===undefined)delete process.env.GOOGLE_API_KEY;else process.env.GOOGLE_API_KEY=previous.google;
  if(previous.generative===undefined)delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;else process.env.GOOGLE_GENERATIVE_AI_API_KEY=previous.generative;
  globalThis.fetch=fixtureFetch;await env.cleanup();
}

