import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const output=new URL('./.employment-intake-fallback.mjs',import.meta.url);
let captured;
globalThis.__employmentPrepare=async input=>{captured=input;return 'draft-id';};
try {
 await build({stdin:{contents:"export {processManualMandatoryFiles} from './src/lib/mandatoryEmailIntake';",resolveDir:new URL('../',import.meta.url).pathname},outfile:output.pathname,bundle:true,format:'esm',platform:'node',packages:'external',plugins:[{name:'intake-boundaries',setup(b){
 b.onResolve({filter:/clientDocumentText$|gmailConnection$|appSettingsService$|databaseService$|foremanPortalService$|mandatoryPdfOverlay$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:path.endsWith('clientDocumentText')?"export const extractClientDocumentText=async(file,progress,options)=>{if(options?.forceOcr)throw Error('OCR unavailable');return {text:'CONTRATO DE TRABAJO\\nDatos ilegibles',source:'pdf-native'};};":path.endsWith('databaseService')?"export const getDocuments=async()=>[];":path.endsWith('appSettingsService')?"export const loadAppBusinessSettings=async()=>({});":path.endsWith('foremanPortalService')?"export const prepareMandatoryDocumentFromEmail=globalThis.__employmentPrepare;export const restoreForemanMandatoryGmailSource=async()=>{};":path.endsWith('gmailConnection')?"export const base64UrlAttachmentToFile=()=>{};export const getGmailConnectionStatus=async()=>({});export const scanAdministrativeGmail=async()=>[];":`import crypto from 'node:crypto';export const analyzeEmploymentOriginalPdf=async()=>({pages:[{page:1,width:595,height:842}],anchors:[],orderedWorkerIds:[],unresolvedWorkerIds:[]});export const analyzeMandatoryOriginalPdf=()=>{throw Error('Must use employment analyzer');};export const resolveMandatoryAnchorsWithOcrRows=()=>{throw Error('Must not use table OCR');};export const fileToBase64=async file=>Buffer.from(await file.arrayBuffer()).toString('base64');export const sha256Hex=async bytes=>crypto.createHash('sha256').update(bytes).digest('hex');`}));
 }}]});
 const {processManualMandatoryFiles}=await import(output.href);
 const bytes=Buffer.from('%PDF-1.7\n unreadable worker');
 const result=await processManualMandatoryFiles([new File([bytes],'contrato.pdf',{type:'application/pdf'})],{obraHint:'Obra A',obraCandidates:['Obra A']});
 assert.equal(result.importedDocuments,1);assert.equal(result.skippedFiles,0);assert.match(result.warnings.join(' '),/original conservado/);
 assert.deepEqual(captured.importedWorkers,[]);assert.deepEqual(captured.workerAnchors,[]);assert.equal(captured.sourcePdfBase64,bytes.toString('base64'));assert.equal(captured.sourcePdfSha256,crypto.createHash('sha256').update(bytes).digest('hex'));
 console.log('PASS: unreadable worker and unavailable OCR preserve original/hash as manual-review draft without inventing a signer.');
} finally {delete globalThis.__employmentPrepare;await fs.rm(output,{force:true});}
