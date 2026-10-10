import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const output=new URL('./.foreman-publication-ui.mjs',import.meta.url);
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://local-validation.invalid/'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
window.HTMLCanvasElement.prototype.getContext=()=>null;
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
window.HTMLElement.prototype.scrollIntoView=()=>{};
const workers=[{id:1,apellidosNombre:'Persona Uno',categoria:'PEON'},{id:2,apellidosNombre:'Persona Dos',categoria:'PEON'}];
const doc={id:'doc',owner_id:'owner',obra:'Obra A',work_date:'2026-10-09',period_key:'2026-10',document_type:'control_presencia',category:'',status:'pending',lifecycle_status:'READY',workers:[],signatures:{'1':'signed','2':'signed'},details:{sourceFilename:'control.pdf',originalPdfMode:'overlay',importedWorkerIds:[1,2],importedWorkers:workers,workerAnchors:workers.map(w=>({workerId:w.id,workerName:w.apellidosNombre,resolved:true,documentWorkerId:'w'+w.id})),documentWorkersV2:workers.map(w=>({id:'w'+w.id,legacyWorkerId:w.id,printedName:w.apellidosNombre,detectionStatus:'CONFIRMED'}))}};
let calls=[],confirmResult=true,confirmMessages=[];
globalThis.__confirm=async(message)=>{confirmMessages.push(message);return confirmResult;};
const portalDocument=()=>({id:doc.id,workDate:doc.work_date,periodKey:doc.period_key,documentType:doc.document_type,category:doc.category,status:doc.status,details:doc.details,signatures:doc.signatures,workers:doc.workers});
globalThis.__foremanUi={
 async resolveForemanPortal(){return {valid:true,obra:'Obra A',foremanName:'Encargado',workers:[],attendance:[],documents:[],mandatoryDocuments:['ASSIGNED','IN_SIGNATURE'].includes(doc.lifecycle_status)?[portalDocument()]:[]};},
 async getForemanMandatorySignatures(){return Object.fromEntries(Object.keys(doc.signatures).map(k=>[k,{signature:'data:image/png;base64,AAAA'}]));},
 async getSupervisorMandatorySignatures(){return {};},
};
globalThis.__foremanApi={
 async query(table){return table==='foreman_mandatory_documents'?[structuredClone(doc)]:[];},
 async rpc(name,args){calls.push({name,args});if(name==='assign_mandatory_document_v2'){doc.lifecycle_status='ASSIGNED';return {ok:true};}if(name==='withdraw_mandatory_document_v2'){doc.lifecycle_status='READY';return {ok:true};}if(name==='revoke_mandatory_signature_v2'){delete doc.signatures[args.p_document_worker_id.slice(1)];return {ok:true};}throw Error(name);},
};
const serviceSource=await fs.readFile(new URL('../src/services/foremanPortalService.ts',import.meta.url),'utf8');
const exportNames=[...serviceSource.matchAll(/export (?:async )?function (\w+)/g)].map(m=>m[1]);
let root;
try {
 await build({stdin:{contents:"export {ForemanMobilePortal} from './components/ForemanMobilePortal'; export {ForemanDocumentsDashboard} from './components/ForemanDocumentsDashboard';",resolveDir:new URL('../',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',packages:'external',define:{'import.meta.env':'{}'},outfile:output.pathname,
 plugins:[{name:'test-boundaries',setup(b){
 b.onResolve({filter:/foremanPortalService$/},()=>({path:'portal',namespace:'mock'}));
 b.onResolve({filter:/(?:\/lib\/|\.\/)supabase$/},()=>({path:'supabase',namespace:'mock'}));
 b.onResolve({filter:/\/lib\/appDialog$/},()=>({path:'dialog',namespace:'mock'}));
 b.onResolve({filter:/mandatoryEmailIntake$/},()=>({path:'intake',namespace:'mock'}));
 b.onResolve({filter:/PreventionSection$/},()=>({path:'prevention',namespace:'mock'}));
 b.onResolve({filter:/\?url$/},()=>({path:'url',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='portal'?exportNames.map(name=>`export const ${name}=(...args)=>globalThis.__foremanUi.${name}(...args);`).join('\n'):args.path==='supabase'?"export const supabase=globalThis.__foremanApi; export const getSessionUser=async()=>({id:'owner'});":args.path==='dialog'?"export const appConfirm=(...args)=>globalThis.__confirm(...args);export const appAlert=async()=>{};export const appPrompt=async()=>null;":args.path==='intake'?"export const processAdministrativeMandatoryInbox=async()=>({importedDocuments:0,warnings:[]});export const processManualMandatoryFiles=async()=>({importedDocuments:0,warnings:[]});":args.path==='prevention'?"export const PreventionSection=()=>null;":"export default '';"}));
 }}]});
 const React=await import('react');const {createRoot}=await import('react-dom/client');const {ForemanMobilePortal,ForemanDocumentsDashboard}=await import(output.href);
 const action=async callback=>{await React.act(async()=>{await callback();await new Promise(resolve=>setTimeout(resolve,30));});};
 const find=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
 const mount=async component=>{if(root)await action(()=>root.unmount());root=createRoot(document.getElementById('root'));await action(()=>root.render(component));};
 await mount(React.createElement(ForemanDocumentsDashboard));
 assert(!document.body.textContent.includes('Ver trazabilidad'));
 assert(find('Enviar al portal de encargados'),'explicit publication button');
 assert.equal(calls.length,0,'opening supervisor dashboard must not publish');
 doc.details.workerAnchors.forEach(a=>Object.assign(a,{page:1,nameX:null,nameY:null,rowHeight:null,signatureX:350,signatureY:500,signatureWidth:70,signatureHeight:14}));
 confirmResult=false;
 await action(()=>find('Enviar al portal de encargados').click());
 assert.equal(calls.length,0,'cancelled overlap confirmation never publishes');
 assert(confirmMessages.at(-1).includes('se solapan'),'supervisor sees overlap warning');
 confirmResult=true;
 await action(()=>find('Enviar al portal de encargados').click());
 assert.equal(calls[0].name,'assign_mandatory_document_v2');assert(find('Retirar del portal para corregir'));
 await action(()=>find('Retirar del portal para corregir').click());assert.equal(doc.lifecycle_status,'READY');assert.equal(Object.keys(doc.signatures).length,2);
 await action(()=>find('Enviar al portal de encargados').click());
 await mount(React.createElement(ForemanMobilePortal,{token:'test'}));
 await action(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('control.pdf')).click());
 assert.equal(find('Finalizar y enviar al supervisor').disabled,false,'all signatures allow send');
 assert(document.body.textContent.includes('Trabajadores revisados y habilitados por el supervisor'));
 await action(()=>find('Revocar firma y volver a firmar').click());
 assert.equal(doc.signatures['1'],undefined);assert.equal(doc.signatures['2'],'signed');
 assert.equal(find('Finalizar y enviar al supervisor').disabled,true,'revoked mandatory signature blocks submission');
 assert(find('Firmar esta persona'),'revoked person can sign again');
 await mount(React.createElement(ForemanMobilePortal,{token:'test'}));
 await action(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('control.pdf')).click());
 assert.equal(find('Finalizar y enviar al supervisor').disabled,true,'revocation survives reload');
 console.log('PASS: rendered React UI; traceability button absent, explicit publication/withdrawal, selective revocation, pending signer and send restriction after reload.');
 await action(()=>root.unmount());root=null;
} catch(error) {console.error(error);process.exitCode=1;} finally {if(root)root.unmount();dom.window.close();await fs.rm(output,{force:true});}

process.exit(process.exitCode||0);
