import assert from 'node:assert/strict';
import { visitTestServer } from './visitMinutesTestServer.mjs';
import { id } from './visitMinutesFixture.mjs';
import { generateVisitWriting, VISIT_WRITING_INSTRUCTION } from '../src/server/visitWriting.ts';
import { generateVisitWritingGroq } from '../src/server/visitWritingGroq.ts';
const names=['VISIT_WRITING_PROVIDER','GROQ_API_KEY','GEMINI_API_KEY','VISIT_WRITING_GROQ_MODEL'];
const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
for(const n of names)delete process.env[n];
process.env.GEMINI_API_KEY='synthetic-unused-key';
const env=await visitTestServer(), originalFetch=globalThis.fetch, requests=[];
let mode='ok';
const input={mode:'written',title:'Arqueta',text:'No ejecutar. Pendiente de comprobar 1,50 m.'};
const request={clientVersion:'3.1',action:'assist-writing',worksiteId:id(10),...input};
globalThis.fetch=async(url,init)=>{
 if(String(url).startsWith('https://api.groq.com/')){
  assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(init.headers.Authorization,'Bearer synthetic-groq-key');
  assert.equal(init.redirect,'error');assert(init.signal);
  const body=JSON.parse(init.body);requests.push(body);
  assert.equal(body.model,'openai/gpt-oss-20b');assert.equal(body.response_format.json_schema.strict,true);
  assert.equal(body.tools,undefined);assert.equal(body.stream,false);
  const sent=JSON.parse(body.messages[1].content);assert.deepEqual(Object.keys(sent).sort(),['mode','text','title']);
  if(typeof mode==='number')return new Response('PRIVATE_ERROR synthetic-groq-key',{status:mode});
  if(mode==='network')throw new Error('PRIVATE_ERROR synthetic-groq-key');
  const result={points:[{title:sent.title||'Revisión',description:mode==='invalid'?'Ejecutar 999 m.':sent.text}],warnings:[]};
  return new Response(JSON.stringify({choices:[{finish_reason:mode==='truncated'?'length':'stop',message:{content:mode==='malformed'?'{':JSON.stringify(result)}}]}));
 }
 if(/ai-gateway|generativelanguage/.test(String(url)))throw new Error('Unexpected fallback');
 return originalFetch(url,init);
};
try{
 assert.equal((await env.invoke({action:'writing-status'},null)).data.writing.configured,false);
 await assert.rejects(generateVisitWriting(input),e=>e.status===503);assert.equal(requests.length,0);
 process.env.GROQ_API_KEY='  synthetic-groq-key  ';
 const status=await env.invoke({action:'writing-status'},null);
 assert.deepEqual(status.data.writing,{configured:true,providerConfigured:true,model:'openai/gpt-oss-20b'});
 assert(!JSON.stringify(status).includes('synthetic'));assert.equal(requests.length,0);
 for(const user of [null,2,3,4])assert.notEqual((await env.invoke(request,user)).status,200);
 assert.equal(requests.length,0,'authorization before provider');
 for(const inputMode of ['written','dictated']){
  const result=await env.invoke({...request,mode:inputMode,attachments:['must-not-leave-server'],participants:['must-not-leave-server']});
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.proposal.points.length,1);
 }
 assert(!JSON.stringify(requests).includes('must-not-leave-server'));
 mode='invalid';assert.equal((await env.invoke(request)).status,502);
 for(const [failure,status,code] of [[401,503,'VISIT_WRITING_AUTH_REQUIRED'],[403,503,'VISIT_WRITING_AUTH_REQUIRED'],[402,503,'VISIT_WRITING_QUOTA'],[429,429,'VISIT_WRITING_RATE_LIMIT'],[500,502,'VISIT_WRITING_PROVIDER_FAILED'],['network',502,'VISIT_WRITING_PROVIDER_FAILED'],['truncated',502,'VISIT_WRITING_PROVIDER_FAILED'],['malformed',502,'VISIT_WRITING_PROVIDER_FAILED']]){
  mode=failure;const count=requests.length;
  await assert.rejects(generateVisitWritingGroq(input,VISIT_WRITING_INSTRUCTION),e=>e.status===status&&e.code===code&&!/PRIVATE|synthetic/.test(e.message));
  assert.equal(requests.length,count+1,'one attempt, no paid fallback');
 }
 process.env.GROQ_API_KEY=' ';
 assert.equal((await env.invoke({action:'writing-status'},null)).data.writing.configured,false);
 process.env.VISIT_WRITING_PROVIDER='gateway';await assert.rejects(generateVisitWriting(input),e=>e.status===503);
 assert.equal(env.sent.length,0);assert.equal(env.objects.size,0);
 assert(!env.calls.some(c=>c.url?.includes('visit_minutes?')&&c.method==='POST'));
 console.log('PASS Groq simulated HTTP: secure status, permissions/PGlite, written/dictated, fidelity, isolated payload, safe errors, no retries/fallback/mail/files/actas. Not a real generation.');
}finally{
 globalThis.fetch=originalFetch;await env.cleanup();
 for(const n of names)if(previous[n]===undefined)delete process.env[n];else process.env[n]=previous[n];
}
