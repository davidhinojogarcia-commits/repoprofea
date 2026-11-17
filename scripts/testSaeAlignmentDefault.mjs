import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'esbuild';
const output=new URL('./.sae-default-test.mjs',import.meta.url);
let owner='owner-a',settings={},calls=[],failRead=false,failSave=false,skipSave=false,inserted=[];
globalThis.__alignmentDefault={
 getSessionUser:async()=>({id:owner}),
 supabase:{url:'https://storage.example.test',key:'synthetic',auth:{getSession:async()=>({data:{session:{access_token:'synthetic-token'}}})},
 query:async(table,options)=>{
  calls.push({table,...options});
  if(table==='user_settings'){
   assert.equal(options.networkOnly,true);assert.match(options.query,/select=alignment:settings->saeReportAlignment/);
   if(failRead)throw Error('Lectura sin conexión');
   const user=new URLSearchParams(options.query).get('user_id').slice(3);
   return [{alignment:structuredClone(settings[user]?.saeReportAlignment)}];
  }
  if(options.method==='POST'){inserted.push({table,body:structuredClone(options.body)});return [];}
  return [];
 },
 rpc:async(name,body)=>{
  calls.push({name,body});assert.equal(name,'patch_user_settings');
  if(failSave)throw Error('Guardado sin conexión');
  if(!skipSave)settings[owner]={...settings[owner],...structuredClone(body.p_patch)};
  return structuredClone(settings[owner]);
 }}
};
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>String(url).startsWith('https://storage.example.test/')?new Response('',{status:200}):nativeFetch(url,init);
try {
 await build({stdin:{contents:`export * from './src/services/saeAlignmentPreferences';export {createSaeReport} from './src/services/saeService';`,resolveDir:new URL('../',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:output.pathname,plugins:[{name:'transport',setup(b){b.onResolve({filter:/\/lib\/supabase$/},()=>({path:'transport',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const {supabase,getSessionUser}=globalThis.__alignmentDefault;'}));}}]});
 const {saveSaeAlignmentDefault,loadSaeAlignmentDefault,createSaeReport,parseSaeAlignmentDefault}=await import(output.href);
 assert.equal(await loadSaeAlignmentDefault(owner),null);
 settings[owner]={app:{supervisor:'keep'},unrelated:'keep'};
 await saveSaeAlignmentDefault(-12.5,-3.25);
 assert.deepEqual(settings[owner].app,{supervisor:'keep'});assert.equal(settings[owner].unrelated,'keep');
 assert.deepEqual(await loadSaeAlignmentDefault(owner),{version:1,ownerId:owner,x:-12.5,y:-3.25});
 const report={fileName:'synthetic.pdf',fileBase64:'data:application/pdf;base64,JVBERi0=',extractionSource:'native',extractedText:'',obra:'Obra',mes:'Octubre'};
 const candidates=[{fullNameOriginal:'Sintético',normalizedName:'Sintético',nombre:'Sintético',apellidos:'Prueba',overlayX:182,overlayY:50,pageNumber:1,orderNumber:1}];
 const imported=async()=>{inserted=[];await createSaeReport('need',report,candidates);return inserted.find(r=>r.table==='sae_candidates').body[0];};
 let row=await imported();assert.equal(row.alignment_offset_x,-12.5);assert.equal(row.alignment_offset_y,-3.25);assert.equal(row.source_position.x,182,'original coordinates unchanged');
 const historical=structuredClone(row);
 await saveSaeAlignmentDefault(0,0);row=await imported();assert.equal(row.alignment_offset_x,0);assert.equal(row.alignment_offset_y,0);assert.equal(historical.alignment_offset_x,-12.5,'previous imported snapshot preserved');
 owner='owner-b';assert.equal(await loadSaeAlignmentDefault(owner),null);row=await imported();assert.equal(row.alignment_offset_x,0,'another supervisor never inherits A');
 assert.equal(parseSaeAlignmentDefault(settings['owner-a'].saeReportAlignment,owner),null);
 owner='owner-a';failSave=true;await assert.rejects(saveSaeAlignmentDefault(4,5),/sin conexión/);failSave=false;
 skipSave=true;await assert.rejects(saveSaeAlignmentDefault(4,5),/verificar/);skipSave=false;
 failRead=true;inserted=[];await assert.rejects(imported(),/sin conexión/);assert.equal(inserted.length,0,'failed preference read cannot import a silently wrong default');
 const count=calls.length;await assert.rejects(saveSaeAlignmentDefault(NaN,2),/válidos/);assert.equal(calls.length,count);
 console.log('PASS real SAE preferences/import: negative/zero defaults, reload, future import snapshot, unchanged original coordinates, previous reports, owner isolation, atomic settings-key merge and network/no-op failures. Synthetic transport/storage, no production writes.');
} finally {await fs.rm(output,{force:true});globalThis.fetch=nativeFetch;delete globalThis.__alignmentDefault;}
