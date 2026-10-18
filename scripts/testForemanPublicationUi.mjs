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
let scrolledDocument='';
window.HTMLElement.prototype.scrollIntoView=function(){scrolledDocument=this.id;};
const workers=[{id:1,apellidosNombre:'Persona Uno',categoria:'PEON'},{id:2,apellidosNombre:'Persona Dos',categoria:'PEON'}];
const doc={id:'doc',owner_id:'owner',obra:'Obra A',work_date:'2026-10-09',period_key:'2026-10',document_type:process.argv[2]||process.env.FOREMAN_TEST_DOCUMENT_TYPE||'control_presencia',category:'',status:'pending',lifecycle_status:'READY',workers:[],signatures:{'1':'signed','2':'signed'},details:{sourceFilename:'control.pdf',originalPdfMode:'overlay',importedWorkerIds:[1,2],importedWorkers:workers,workerAnchors:workers.map(w=>({workerId:w.id,workerName:w.apellidosNombre,resolved:true,documentWorkerId:'w'+w.id})),documentWorkersV2:workers.map(w=>({id:'w'+w.id,legacyWorkerId:w.id,printedName:w.apellidosNombre,detectionStatus:'CONFIRMED'}))}};
let signatureAttempts=0,failSignatureSave=true,signatureReads=0;
let calls=[],confirmResult=true,confirmMessages=[],alerts=[],portalReads=0,extraDocs=[],includeAttendance=true;
globalThis.__alerts=alerts;
globalThis.__confirm=async(message)=>{confirmMessages.push(message);return confirmResult;};
const portalDocument=()=>({id:doc.id,workDate:doc.work_date,periodKey:doc.period_key,documentType:doc.document_type,category:doc.category,status:doc.status,lifecycleStatus:doc.lifecycle_status,assignedAt:doc.assigned_at,details:{...doc.details,lifecycleStatus:'READY'},signatures:doc.signatures,workers:doc.workers});
globalThis.__foremanUi={
 async resolveForemanPortal(){portalReads++;return {valid:true,obra:'Obra A',foremanName:'Encargado',workers:[],attendance:[],documents:[],mandatoryDocuments:['ASSIGNED','IN_SIGNATURE'].includes(doc.lifecycle_status)?[portalDocument()]:[]};},
 async getForemanMandatorySignatures(){signatureReads++;return Object.fromEntries(Object.keys(doc.signatures).map(k=>[k,{signature:'data:image/png;base64,AAAA'}]));},
 async getSupervisorMandatorySignatures(){return {};},
};
globalThis.__foremanApi={
 async query(table){return table==='foreman_mandatory_documents'?[structuredClone(doc),...structuredClone(extraDocs)]:table==='foreman_attendance_days'&&includeAttendance?[
   {id:'signed-day',obra:'Obra A',work_date:'2026-10-09',foreman_name:'ENCARGADO CON FIRMAS',status:'draft',rows:[{workerId:1,entrySignature:'data:image/png;base64,AAAA',exitSignature:'data:image/png;base64,AAAA'}]},
   {id:'unsigned-day',obra:'Obra A',work_date:'2026-10-09',foreman_name:'ENCARGADO SIN FIRMAS',status:'completed',rows:[{workerId:2}]},
   {id:'partial-day',obra:'Obra A',work_date:'2026-10-09',foreman_name:'ENCARGADO FIRMA PARCIAL',status:'reviewed',rows:[{workerId:3,entrySignature:'data:image/png;base64,AAAA'}]},
 ]:[];},
 async rpc(name,args){calls.push({name,args});if(name==='sign_mandatory_document_worker_v2'){signatureAttempts++;if(failSignatureSave)throw new Error('Conexión lenta o interrumpida');doc.signatures[args.p_document_worker_id.slice(1)]=args.p_signature;return {ok:true};}if(name==='assign_mandatory_document_v2'){doc.lifecycle_status='ASSIGNED';doc.assigned_at='2026-10-13T07:00:00Z';return {ok:true,lifecycleStatus:'ASSIGNED'};}if(name==='withdraw_mandatory_document_v2'){doc.lifecycle_status='READY';return {ok:true};}if(name==='revoke_mandatory_signature_v2'){delete doc.signatures[args.p_document_worker_id.slice(1)];return {ok:true};}throw Error(name);},
};
const serviceSource=await fs.readFile(new URL('../src/services/foremanPortalService.ts',import.meta.url),'utf8');
const exportNames=[...serviceSource.matchAll(/export (?:async )?function (\w+)/g)].map(m=>m[1]);
let root;
try {
 await build({stdin:{contents:"export {ForemanMobilePortal} from './components/ForemanMobilePortal'; export {ForemanDocumentsDashboard} from './components/ForemanDocumentsDashboard';",resolveDir:new URL('../',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',packages:'external',define:{'import.meta.env':'{}'},outfile:output.pathname,
 plugins:[{name:'test-boundaries',setup(b){
 b.onResolve({filter:/^react$/},()=>({path:'react',external:true}));
 b.onResolve({filter:/useHandwrittenSignature$/},()=>({path:'signature-hook',namespace:'mock'}));
 b.onResolve({filter:/foremanPortalService$/},()=>({path:'portal',namespace:'mock'}));
 b.onResolve({filter:/(?:\/lib\/|\.\/)supabase$/},()=>({path:'supabase',namespace:'mock'}));
 b.onResolve({filter:/\/lib\/appDialog$/},()=>({path:'dialog',namespace:'mock'}));
 b.onResolve({filter:/mandatoryEmailIntake$/},()=>({path:'intake',namespace:'mock'}));
 b.onResolve({filter:/ForemanVisitMinutes$/},()=>({path:'visits',namespace:'mock'}));
 b.onResolve({filter:/PreventionSection$/},()=>({path:'prevention',namespace:'mock'}));
 b.onResolve({filter:/\?url$/},()=>({path:'url',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='signature-hook'?"import {useRef} from 'react';export function useHandwrittenSignature(){return {ref:useRef(null),handlers:{},clear(){},exportPng(){return 'data:image/png;base64,AAAA';},hasInk:true,error:''};}":args.path==='portal'?exportNames.map(name=>`export const ${name}=(...args)=>globalThis.__foremanUi.${name}(...args);`).join('\n'):args.path==='supabase'?"export const supabase=globalThis.__foremanApi; export const getSessionUser=async()=>({id:'owner'});":args.path==='dialog'?"export const appConfirm=(...args)=>globalThis.__confirm(...args);export const appAlert=async(message,options)=>globalThis.__alerts.push({message,options});export const appPrompt=async()=>null;":args.path==='intake'?"export const processAdministrativeMandatoryInbox=async()=>({importedDocuments:0,warnings:[]});export const processManualMandatoryFiles=async()=>({importedDocuments:0,warnings:[]});":args.path==='visits'?"export default function Visits({token,onOpenPdf}){return globalThis.__React.createElement('section',{'data-testid':'actual-visit-tab','data-token':token,'data-viewer':typeof onOpenPdf},'Actas firmadas y órdenes pendientes');}":args.path==='prevention'?"export const PreventionSection=()=>null;":"export default '';"}));
 }}]});
 const React=await import('react');globalThis.__React=React;const {createRoot}=await import('react-dom/client');const {ForemanMobilePortal,ForemanDocumentsDashboard}=await import(output.href);
 const action=async callback=>{await React.act(async()=>{await callback();await new Promise(resolve=>setTimeout(resolve,30));});};
 const find=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text);
 const mount=async component=>{if(root)await action(()=>root.unmount());root=createRoot(document.getElementById('root'));await action(()=>root.render(component));};
 await mount(React.createElement(ForemanDocumentsDashboard));
 assert(document.body.textContent.includes('ENCARGADO CON FIRMAS'),'signed attendance remains visible even in a mixed draft');
 assert(!document.body.textContent.includes('ENCARGADO SIN FIRMAS'),'completed status alone cannot expose unsigned attendance');
 assert(!document.body.textContent.includes('ENCARGADO FIRMA PARCIAL'),'partial signatures cannot expose an unsigned PDF');
 includeAttendance=false;
 assert(!document.body.textContent.includes('Ver trazabilidad'));
 assert(find('Enviar al portal de encargados'),'explicit publication button');
 assert.equal(calls.length,0,'opening supervisor dashboard must not publish');
 doc.details.workerAnchors.forEach(a=>Object.assign(a,{page:1,nameX:null,nameY:null,rowHeight:null,signatureX:350,signatureY:500,signatureWidth:70,signatureHeight:14}));
 confirmResult=false;
 await action(()=>find('Enviar al portal de encargados').click());
 assert.equal(calls.length,0,'cancelled overlap confirmation never publishes');
 assert(confirmMessages.at(-1).includes('se solapan'),'supervisor sees overlap warning');
 confirmResult=true;
 await action(()=>{const button=find('Enviar al portal de encargados');button.click();button.click();});
 assert.equal(calls.length,1,'rapid double tap cannot publish twice');
 assert.equal(calls[0].name,'assign_mandatory_document_v2');assert(find('Retirar del portal para corregir'));
 assert(alerts.at(-1).message.includes('Obra: Obra A'),'modal identifies destination');
 assert(alerts.at(-1).message.includes('Periodo: 2026-10'),'modal identifies period');
 assert.equal(alerts.at(-1).options.title,'Envío guardado · revisa el acceso','missing active portal warning');
 assert(document.body.textContent.includes('Último envío guardado:'),'durable publication date');
 await action(()=>find('Retirar del portal para corregir').click());assert.equal(doc.lifecycle_status,'READY');assert.equal(Object.keys(doc.signatures).length,2);
 await action(()=>find('Enviar al portal de encargados').click());
 await mount(React.createElement(ForemanMobilePortal,{token:'test'}));
 assert(find('Actualizar documentos'),'manual refresh in Control inicios');
 await action(()=>find('Actas de visitas').click());assert(document.querySelector('[data-testid=actual-visit-tab]'),'visit tab mounts its panel in the complete portal');assert.equal(document.querySelector('[data-testid=actual-visit-tab]').dataset.token,'test');assert.equal(document.querySelector('[data-testid=actual-visit-tab]').dataset.viewer,'function');assert([...document.querySelectorAll('button')].every(b=>!b.className.includes('[object Object]')),'panels must not be interpolated into button classes');await action(()=>find('Control, inicios y contratos').click());assert(!document.querySelector('[data-testid=actual-visit-tab]'));

 const beforeRefresh=portalReads;await action(()=>find('Actualizar documentos').click());
 assert.equal(portalReads,beforeRefresh+1,'manual refresh queries portal');
 const periodButton=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('quincena')&&b.textContent.includes('· 1'));
 await action(()=>periodButton.click());
 doc.period_key='2026-07';await action(()=>find('Actualizar documentos').click());
 assert(document.body.textContent.includes('No hay documentos en los periodos seleccionados'),'filtered empty state explains hidden documents');
 await action(()=>find('Todos').click());
 assert([...document.querySelectorAll('button')].some(b=>b.textContent.includes('control.pdf')),'clear filters reveals new period');

 await action(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('control.pdf')).click());
 assert.equal(find('Finalizar y enviar al supervisor').disabled,false,'all signatures allow send');
 assert(document.body.textContent.includes('Trabajadores revisados y habilitados por el supervisor'));
 await action(()=>find('Revocar firma y volver a firmar').click());
 assert.equal(doc.signatures['1'],undefined);assert.equal(doc.signatures['2'],'signed');
 assert.equal(find('Finalizar y enviar al supervisor').disabled,true,'revoked mandatory signature blocks submission');
 assert(find('Firmar esta persona'),'revoked person can sign again');
 await action(()=>find('Firmar esta persona').click());
 await action(()=>{const button=find('Guardar');button.click();button.click();});
 assert.equal(signatureAttempts,1,'double save emits a single mutation');
 assert(document.querySelector('canvas'),'failed save keeps the signature pad mounted');
 assert(document.body.textContent.includes('Conexión lenta o interrumpida'),'save failure is visible');
 failSignatureSave=false;
 await action(()=>find('Guardar').click());
 assert.equal(signatureAttempts,2,'explicit retry persists the retained image');
 assert.equal(doc.signatures['1'],'data:image/png;base64,AAAA');
 assert(!find('Guardar'),'pad closes only after verified persistence');
 await action(()=>find('Revocar firma y volver a firmar').click());

 await mount(React.createElement(ForemanMobilePortal,{token:'test'}));
 await action(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('control.pdf')).click());
 assert.equal(find('Finalizar y enviar al supervisor').disabled,true,'revocation survives reload');
 window.history.replaceState({},'', '/encargados?document=doc');
 await mount(React.createElement(ForemanMobilePortal,{token:'test'}));
 assert(document.getElementById('foreman-signing-doc').className.includes('ring-4'),'notification deep link highlights the scoped document');
 assert(find('Finalizar y enviar al supervisor'),'notification opens signing document automatically');
 assert(find('Activar avisos de mi obra'),'mobile notification activation is exposed in portal');
 await action(()=>new Promise(resolve=>setTimeout(resolve,150)));
 assert.equal(scrolledDocument,'foreman-signing-doc','deep link scrolls after the document renders');
 window.history.replaceState({},'', '/encargados');
 doc.period_key='2026-10-2Q';
 extraDocs=[{...structuredClone(doc),id:'first-half',period_key:'2026-10-1Q',work_date:'2026-10-16',category:'FIRST_HALF'}, {...structuredClone(doc),id:'other-month',period_key:'2026-09-1Q',category:'OTHER_MONTH'}, {...structuredClone(doc),id:'other-work',obra:'Obra B',category:'OTHER_WORK'}];
 await mount(React.createElement(ForemanDocumentsDashboard));
 const headings=[...document.querySelectorAll('h3')].map(h=>h.textContent);
 assert(headings.some(h=>h.includes('1ª quincena'))&&headings.some(h=>h.includes('2ª quincena')),'both quincenas grouped inside month');
 assert.equal(document.querySelectorAll('article').length,2,'work and authoritative period month restrict documents');
 const secondHalf=[...document.querySelectorAll('[aria-label="Filtrar por quincena"] button')].find(b=>b.textContent.startsWith('2ª quincena'));
 await action(()=>secondHalf.click());
 assert.equal(document.querySelectorAll('article').length,1,'second quincena filters documents');
 assert(!document.querySelector('article').textContent.includes('FIRST_HALF'),'period key wins over work date');
 await action(()=>find('Todas las quincenas').click());
 assert.equal(document.querySelectorAll('article').length,2,'all quincenas restores documents without duplicates');
 await action(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Septiembre 2026')).click());
 assert.equal(document.querySelectorAll('article').length,1,'month change clears quincena filter');
 assert(document.querySelector('article').textContent.includes('OTHER_MONTH'));
 doc.signatures={};doc.lifecycle_status='ASSIGNED';doc.period_key='2026-10';doc.status='pending';
 await mount(React.createElement(ForemanMobilePortal,{token:'test'}));
 await action(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('quincena')&&b.textContent.includes('· 1')).click());
 const beforeUnsigned=signatureReads;
 await action(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('control.pdf')).click());
 assert.equal(signatureReads,beforeUnsigned,'unsigned document has no signature images to download');
 console.log('PASS: unsigned expansion skips image RPC; duplicate save blocked; failed save retains pad and verified retry closes it.');
 console.log('PASS: fortnight grouping, explicit period precedence, month/work isolation, filter and reset.');
 console.log('PASS: rendered React UI; traceability button absent, explicit publication/withdrawal, selective revocation, pending signer and send restriction after reload.');
 await action(()=>root.unmount());root=null;
} catch(error) {console.error(error);process.exitCode=1;} finally {if(root)root.unmount();dom.window.close();await fs.rm(output,{force:true});}

process.exit(process.exitCode||0);

