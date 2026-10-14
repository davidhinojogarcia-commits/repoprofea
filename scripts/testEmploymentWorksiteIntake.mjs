import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
const output=new URL('./.employment-worksite-intake.mjs',import.meta.url);
const files=[new File(['%PDF contract bytes'],'contrato.pdf',{type:'application/pdf'}),new File(['%PDF extension bytes'],'prorroga.pdf',{type:'application/pdf'})];
const captured=[];let catalogReads=0;
globalThis.__worksiteIntake={
 text:file=>`${file.name.includes('prorroga')?'PRÓRROGA DEL CONTRATO':'CONTRATO DE TRABAJO'}\nDATOS DEL/DE LA TRABAJADOR/A\nMaría López Ruiz\nCÓDIGO DE OBRA: ${file.name.includes('prorroga')?'11003EE':'11002GR'}`,
 documents:async table=>{if(table==='obras'){catalogReads++;return [{nombre:'Acerados',codigo:'11002GR'},{nombre:'Parque',codigo:'11003EE'}];}return [];},
 prepare:async input=>{captured.push(input);return 'doc-'+captured.length;},
};
try{
 await build({stdin:{contents:"export {processManualMandatoryFiles,processAdministrativeMandatoryInbox} from './src/lib/mandatoryEmailIntake';",resolveDir:new URL('../',import.meta.url).pathname},outfile:output.pathname,bundle:true,format:'esm',platform:'node',packages:'external',plugins:[{name:'worksite-boundaries',setup(b){
 b.onResolve({filter:/clientDocumentText$|gmailConnection$|appSettingsService$|databaseService$|foremanPortalService$|mandatoryPdfOverlay$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:path.endsWith('clientDocumentText')?"export const extractClientDocumentText=async file=>({text:globalThis.__worksiteIntake.text(file)});":path.endsWith('databaseService')?"export const getDocuments=(table)=>globalThis.__worksiteIntake.documents(table);":path.endsWith('appSettingsService')?"export const loadAppBusinessSettings=async()=>({administrative:{email:'admin@example.com'}});":path.endsWith('foremanPortalService')?"export const prepareMandatoryDocumentFromEmail=(input)=>globalThis.__worksiteIntake.prepare(input);export const restoreForemanMandatoryGmailSource=async()=>{};":path.endsWith('gmailConnection')?"export const base64UrlAttachmentToFile=a=>new File(['%PDF mail bytes'],a.filename,{type:'application/pdf'});export const getGmailConnectionStatus=async()=>({connected:true,canRead:true});export const scanAdministrativeGmail=async()=>[{id:'message',attachments:[{filename:'contrato.pdf'},{filename:'prorroga.pdf'}]}];":`import crypto from 'node:crypto';export const analyzeEmploymentOriginalPdf=async(file,workers)=>({pages:[{page:1,width:595,height:842}],anchors:[],orderedWorkerIds:workers.map(w=>w.id),unresolvedWorkerIds:[]});export const analyzeMandatoryOriginalPdf=async()=>{throw Error('wrong analyzer')};export const resolveMandatoryAnchorsWithOcrRows=async()=>{throw Error('unexpected OCR')};export const fileToBase64=async file=>Buffer.from(await file.arrayBuffer()).toString('base64');export const sha256Hex=async bytes=>crypto.createHash('sha256').update(bytes).digest('hex');`}));
 }}]});
 const api=await import(output.href);
 const result=await api.processManualMandatoryFiles(files,{obraHint:'Obra seleccionada equivocada',obraCandidates:['Catálogo incompleto']});
 assert.equal(result.importedDocuments,2);assert.equal(result.pendingWorksiteDocuments,2);assert.equal(catalogReads,1,'one complete catalog read per batch');
 assert.deepEqual(captured.map(x=>x.worksiteProposal.suggestedObra),['Acerados','Parque']);
 assert(captured.every(x=>x.obraHint==='__PENDING_WORKSITE__'),'proposals are not assignments');
 assert.equal(captured[0].sourcePdfBase64,Buffer.from(await files[0].arrayBuffer()).toString('base64'));
 captured.length=0;catalogReads=0;
 const mail=await api.processAdministrativeMandatoryInbox();assert.equal(mail.importedDocuments,2);assert.equal(mail.pendingWorksiteDocuments,2);assert.equal(catalogReads,1);
 assert.deepEqual(captured.map(x=>x.worksiteProposal.suggestedObra),['Acerados','Parque']);assert(captured.every(x=>x.obraHint==='__PENDING_WORKSITE__'));
 console.log('PASS: manual/Gmail multi-file proposals, complete catalog, no selected-worksite leakage, pending assignment, original bytes and one catalog read per batch.');
}finally{delete globalThis.__worksiteIntake;await fs.rm(output,{force:true});}
