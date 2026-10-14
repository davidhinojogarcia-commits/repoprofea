import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
const output=new URL('./.employment-worksite-service.mjs',import.meta.url);
let saved,initialized;const calls=[];
globalThis.__worksiteService={
 rpc:async(name,args)=>{calls.push(name);if(name==='prepare_foreman_mandatory_from_email'){assert.equal(args.p_obra_hint,'__PENDING_WORKSITE__');return 'doc';}if(name==='initialize_mandatory_document_v2'){initialized=args;return {ok:true};}return {ok:true};},
 query:async(table,options)=>{if(options.method==='PATCH'){saved=options.body;return null;}return [{details:{retained:'existing'}}];},
};
try{
 await build({stdin:{contents:"export {prepareMandatoryDocumentFromEmail} from './src/services/foremanPortalService';",resolveDir:new URL('../',import.meta.url).pathname},outfile:output.pathname,bundle:true,format:'esm',platform:'node',packages:'external',plugins:[{name:'worksite-service',setup(b){b.onResolve({filter:/(?:\/lib\/|\.\/)supabase$/},()=>({path:'supabase',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase=globalThis.__worksiteService;'}));}}]});
 const {prepareMandatoryDocumentFromEmail}=await import(output.href);
 const proposal={suggestedObra:'Acerados',detectedCodes:['11002GR'],reason:'code',status:'pending'};
 await prepareMandatoryDocumentFromEmail({documentType:'contrato',workerIds:[],importedWorkers:[],workDate:'2026-10-14',periodKey:'2026-10-1Q',obraHint:'__PENDING_WORKSITE__',worksiteProposal:proposal,sourcePdfBase64:'JVBERg==',sourcePdfSha256:'original-hash',workerAnchors:[],pageMeta:[]});
 assert.deepEqual(saved.details.worksiteAssignment,proposal);assert.equal(saved.details.retained,'existing');assert.equal(initialized.p_detected_worksite,null);assert(calls.includes('save_foreman_mandatory_original_pdf'));assert(!calls.some(name=>/assign_mandatory|confirm_mandatory/.test(name)));
 console.log('PASS: persisted proposal survives existing details merge; original-saving path retained; worksite not confirmed or published by import.');
}finally{delete globalThis.__worksiteService;await fs.rm(output,{force:true});}
