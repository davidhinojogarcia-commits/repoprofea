import assert from 'node:assert/strict';
import { visitTestServer } from './visitMinutesTestServer.mjs';
import { id } from './visitMinutesFixture.mjs';
import { generateVisitWriting, VISIT_WRITING_INSTRUCTION } from '../src/server/visitWriting.ts';
import { generateVisitWritingGateway } from '../src/server/visitWritingGateway.ts';

const names=['VISIT_WRITING_PROVIDER','VISIT_WRITING_GATEWAY_MODEL','AI_GATEWAY_API_KEY','VERCEL_OIDC_TOKEN','GEMINI_API_KEY'];
const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
const contextSymbol=Symbol.for('@vercel/request-context'),previousContext=globalThis[contextSymbol];
delete globalThis[contextSymbol];
for(const name of names)delete process.env[name];
const oidcToken=[Buffer.from('{"alg":"HS256"}').toString('base64url'),Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'synthetic-signature'].join('.');
process.env.VERCEL_OIDC_TOKEN=oidcToken;
process.env.GEMINI_API_KEY='synthetic-unused-gemini-key';
const env=await visitTestServer();
const fixtureFetch=globalThis.fetch,requests=[];
let mode='ok';
const input={mode:'written',title:'Arqueta',text:'No ejecutar. Pendiente de comprobar 1,50 m.'};
const request={clientVersion:'3.1',action:'assist-writing',worksiteId:id(10),...input};
globalThis.fetch=async(input,init)=>{
  const url=typeof input==='string'?input:input.url;
  if(url?.startsWith('https://ai-gateway.vercel.sh/')){
    const body=JSON.parse(init?.body||await input.clone().text());
    const headers=new Headers(init?.headers||input.headers);requests.push({body,headers});
    assert.equal(headers.get('authorization'),'Bearer '+oidcToken);
    assert.equal(headers.get('ai-language-model-id'),'openai/gpt-5.4-mini');
    assert.equal(body.providerOptions.gateway.zeroDataRetention,true);
    assert.deepEqual(body.providerOptions.gateway.only,['openai','azure']);
    assert.equal(body.providerOptions.gateway.models,undefined,'no fallback model');
    if(typeof mode==='number')return new Response(JSON.stringify({error:{message:'PRIVATE_PROVIDER_ERROR synthetic-oidc-token synthetic-unused-gemini-key'}}),{status:mode});
    const original=JSON.parse(body.prompt.find(message=>message.role==='user').content[0].text);
    assert.deepEqual(Object.keys(original).sort(),['mode','text','title']);
    const result={points:[{title:original.title||'Revisión',description:original.text}],warnings:[]};
    if(mode==='invalid')result.points[0].description='Ejecutar 999 m.';
    return new Response(JSON.stringify({
      content:[{type:'text',text:JSON.stringify(result)}],
      finishReason:{unified:mode==='truncated'?'length':'stop',raw:mode==='truncated'?'length':'stop'},
      usage:{inputTokens:{total:10,noCache:10,cacheRead:0,cacheWrite:0},outputTokens:{total:20,text:20,reasoning:0}},warnings:[]
    }),{status:200,headers:{'Content-Type':'application/json'}});
  }
  if(url?.includes('generativelanguage.googleapis.com'))throw new Error('Unexpected Gemini fallback');
  return fixtureFetch(input,init);
};
try{
  const status=await env.invoke({action:'writing-status'},null);
  assert.deepEqual(status.data.writing,{configured:true,providerConfigured:true,model:'openai/gpt-5.4-mini'});
  assert(!JSON.stringify(status).includes('synthetic-'));assert(!JSON.stringify(status).includes(oidcToken));assert.equal(requests.length,0,'status never invokes provider');
  delete process.env.VERCEL_OIDC_TOKEN;
  globalThis[contextSymbol]={get:()=>({headers:{'x-vercel-oidc-token':oidcToken}})};
  assert.equal((await env.invoke({action:'writing-status'},null)).data.writing.configured,true,'readiness supports OIDC request context without an environment variable');
  for(const user of [null,2,3,4])assert.notEqual((await env.invoke(request,user)).status,200);
  assert.equal(requests.length,0,'authorization before Gateway');
  const written=await env.invoke({...request,attachments:['must-not-leave-server'],participants:['must-not-leave-server']});
  assert.equal(written.status,200,JSON.stringify(written.data));assert.equal(written.data.proposal.points.length,1);
  assert(!JSON.stringify(requests.map(r=>r.body)).includes('must-not-leave-server'));
  assert.equal((await env.invoke({...request,mode:'dictated',title:'',text:'Arqueta pendiente. Pavimento terminado.'})).status,200);
  mode='invalid';assert.equal((await env.invoke(request)).status,502,'fidelity safeguards also apply to Gateway');
  mode='truncated';await assert.rejects(generateVisitWritingGateway(input,VISIT_WRITING_INSTRUCTION),e=>e.status===502);
  for(const [http,status,code] of [[402,503,'VISIT_WRITING_QUOTA'],[401,503,'VISIT_WRITING_AUTH_REQUIRED'],[403,503,'VISIT_WRITING_AUTH_REQUIRED'],[429,429,'VISIT_WRITING_RATE_LIMIT'],[503,502,'VISIT_WRITING_PROVIDER_FAILED']]){
    mode=http;const before=requests.length;
    await assert.rejects(generateVisitWritingGateway(input,VISIT_WRITING_INSTRUCTION),error=>{
      assert.equal(error.status,status);assert.equal(error.code,code);
      assert(!error.message.includes('PRIVATE_PROVIDER_ERROR'));assert(!error.message.includes('synthetic-'));return true;
    });
    assert.equal(requests.length,before+1,'no automatic SDK retries');
  }
  delete process.env.VERCEL_OIDC_TOKEN;
  delete globalThis[contextSymbol];
  assert.equal((await env.invoke({action:'writing-status'},null)).data.writing.configured,false,'Gemini key does not enable Gateway or weaken ZDR');
  const before=requests.length;await assert.rejects(generateVisitWriting(input),e=>e.status===503&&e.code==='VISIT_WRITING_NOT_CONFIGURED');
  assert.equal(requests.length,before);
  process.env.VISIT_WRITING_PROVIDER='invalid';await assert.rejects(generateVisitWriting(input),e=>e.status===503);
  assert.equal(env.sent.length,0);assert.equal(env.objects.size,0);
  assert(!env.calls.some(c=>c.url?.includes('visit_minutes?')&&c.method==='POST'),'writing does not create an acta');
  console.log('PASS Gateway SDK HTTP/OIDC, permissions in PGlite, written/dictated proposals, ZDR/provider restrictions, fidelity, no Gemini fallback, no retry, safe credit/auth/rate/provider errors, no mail/files/actas. Provider HTTP simulated.');
}finally{
  if(previousContext===undefined)delete globalThis[contextSymbol];else globalThis[contextSymbol]=previousContext;
  globalThis.fetch=fixtureFetch;await env.cleanup();
  for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
}
