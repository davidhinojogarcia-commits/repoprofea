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
 async resolveForemanPortal(){portalReads++;return {valid:true,obra:'Obra A',foremanName:'Encargado',workers:[],attendance:[],documents:[],mandatoryDocuments:['ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION','SUBMITTED','RECEIVED','REVIEWED'].includes(doc.lifecycle_status)?[portalDocument()]:[]};},
 async getForemanMandatorySignatures(){signatureReads++;return Object.fromEntries(Object.keys(doc.signatures).map(k=>[k,{signature:'data:image/png;base64,AAAA'}]));},
 async getSupervisorMandatorySignatures(){return {};},
 async getAttendanceForemanEvidence(){return {signed:false,layout:null};},
};
globalThis.__foremanApi={
 async query(table){return table==='foreman_mandatory_documents'?[structuredClone(doc),...structuredClone(extraDocs)]:table==='foreman_attendance_days'&&includeAttendance?[
   {id:'signed-day',obra:'Obra A',work_date:'2026-10-09',foreman_name:'ENCARGADO CON FIRMAS',status:'draft',rows:[{workerId:1,entrySignature:'data:image/png;base64,AAAA',exitSignature:'data:image/png;base64,AAAA'}]},
   {id:'unsigned-day',obra:'Obra A',work_date:'2026-10-09',foreman_name:'ENCARGADO SIN FIRMAS',status:'completed',rows:[{workerId:2}]},
   {id:'partial-day',obra:'Obra A',work_date:'2026-10-09',foreman_name:'ENCARGADO FIRMA PARCIAL',status:'reviewed',rows:[{workerId:3,entrySignature:'data:image/png;base64,AAAA'}]},
 ]:[];},
 async rpc(name,args){calls.push({name,args});if(name==='sign_mandatory_document_worker_v2'){signatureAttempts++;if(failSignatureSave)throw new Error('Conexión lenta o interrumpida');doc.signatures[args.p_document_worker_id.slice(1)]=args.p_signature;return {ok:true};}if(name==='assign_mandatory_document_v2'){doc.lifecycle_status='ASSIGNED';doc.assigned_at='2026-10-13T07:00:00Z';return {ok:true,lifecycleStatus:'ASSIGNED'};}if(name==='withdraw_mandatory_document_v2'){doc.lifecycle_status='READY';return {ok:true};}if(name==='revoke_mandatory_signature_v2'){if(!['ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION'].includes(doc.lifecycle_status))throw new Error('El supervisor debe devolverlo antes de revocar firmas');delete doc.signatures[args.p_document_worker_id.slice(1)];return {ok:true,revoked:true};}throw Error(name);},
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
 const headerActions=document.querySelector('[role="group"][aria-label="Acciones de documentación de encargados"]');
 assert(headerActions,'document header groups the three actions without hiding others');
 assert(headerActions.className.includes('sm:grid-cols-3')&&headerActions.className.includes('grid-cols-1'),'header actions stack on narrow screens and align across three columns otherwise');
 const headerButtons=[...headerActions.querySelectorAll('button')];
 assert.deepEqual(headerButtons.map(button=>button.textContent.trim()),['Importar documento','Revisar Gmail','Actualizar'],'existing header actions and order retained');
 assert(headerButtons.every(button=>button.className.includes('min-h-12')&&button.className.includes('w-full')),'all three actions share institutional minimum height and width');
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
 const navigation=document.querySelector('nav[aria-label="Secciones del portal de encargados"],div[role="navigation"][aria-label="Secciones del portal de encargados"]');
 assert(navigation,'mobile portal has guided icon-button ribbon');
 assert.equal(document.getElementById('foreman-section-picker'),null,'mobile dropdown removed');
 assert(!navigation.className.includes('hidden')&&!navigation.className.includes('sm:block'),'mobile ribbon is visible regardless of portrait width');
 const touchTrack=navigation.querySelector('[aria-label="Desliza horizontalmente por los botones de secciones"]');
 assert(touchTrack&&touchTrack.className.includes('overflow-x-auto'),'portrait section ribbon has independent horizontal scrolling');
 assert(navigation.textContent.includes('Desliza para ver más'),'portrait mode gives a discoverable swipe hint');

 if(process.env.FOREMAN_LAYOUT_CAPTURE_DIR){
   const dir=process.env.FOREMAN_LAYOUT_CAPTURE_DIR;
   await fs.mkdir(dir,{recursive:true});
   const capture=async(name)=>fs.writeFile(
     dir+'/'+name+'.html',document.getElementById('root').outerHTML,'utf8');
   await capture('mandatory');
   for(const [name,selector] of [
     ['epis','EPIs'],['formacion','Formación'],['maquinaria','Maquinaria'],
     ['control','Control horario'],['documents','Documentos'],
     ['completed','Finalizados'],['visits','Actas de visitas']
   ]){
     const tile=[...navigation.querySelectorAll('.fp-section-tab')].find(button=>button.textContent.replace(/\s+/g,' ').trim()===selector);
     assert(tile,'missing mobile section: '+selector);
     await action(()=>tile.click());
     await capture(name);
   }
   await action(()=>navigation.querySelector('button[aria-label="Control, inicios y contratos"]').click());
 }


 const labels=['Control, inicios y contratos','Prevención','Partes y avisos','EPIs','Formación','Maquinaria','Control horario','Documentos','Actas de visitas','Finalizados'];
 assert.deepEqual([...navigation.querySelectorAll('button')].map(button=>button.getAttribute('aria-label')||button.textContent.replace(/\s+/g,' ').trim()),labels,'all ten sections stay accessible');
 await action(()=>navigation.querySelector('button[aria-label="Actas de visitas"]').click());
 assert(document.querySelector('[data-testid=actual-visit-tab]'),'guided ribbon opens visits');
 await action(()=>navigation.querySelector('button[aria-label="Control, inicios y contratos"]').click());
 assert(!document.querySelector('[data-testid=actual-visit-tab]'),'guided ribbon returns to mandatory');
 assert(find('Actualizar documentos'),'mandatory documents return after ribbon selection');
 await action(()=>find('Actas de visitas').click());assert(document.querySelector('[data-testid=actual-visit-tab]'),'visit tab mounts its panel in the complete portal');assert.equal(document.querySelector('[data-testid=actual-visit-tab]').dataset.token,'test');assert.equal(document.querySelector('[data-testid=actual-visit-tab]').dataset.viewer,'function');assert([...document.querySelectorAll('button')].every(b=>!b.className.includes('[object Object]')),'panels must not be interpolated into button classes');await action(()=>find('Control, inicios y contratos').click());assert(!document.querySelector('[data-testid=actual-visit-tab]'));

 const beforeRefresh=portalReads;await action(()=>find('Actualizar documentos').click());
 assert.equal(portalReads,beforeRefresh+1,'manual refresh queries portal');
 const periodPicker=document.getElementById('foreman-mandatory-period');
 assert(periodPicker&&periodPicker.tagName==='SELECT','mandatory document period is a native accessible dropdown');
 assert.equal(periodPicker.options[0].value,'','first option lists all periods');
 assert.equal(periodPicker.options[1].value,'2026-10','fortnight selector exposes actual period key');
 assert.match(periodPicker.options[1].textContent,/Octubre 2026 · 1 doc\./,'period option contains readable month, year and document count');
 const quickActions=document.querySelector('[aria-label="Acciones guiadas de documentos"]');
 assert(quickActions&&quickActions.querySelectorAll('button').length===2,'guided ribbon only exposes working actions');
 await action(()=>{periodPicker.value='2026-10';periodPicker.dispatchEvent(new window.Event('change',{bubbles:true}));});
 assert.equal(document.getElementById('foreman-mandatory-period').value,'2026-10','selector keeps selected period');
 doc.period_key='2026-07';await action(()=>find('Actualizar documentos').click());
 assert(document.body.textContent.includes('No hay documentos en la quincena seleccionada'),'filtered empty state explains hidden documents');
 await action(()=>quickActions.querySelector('button').click());
 assert.equal(document.getElementById('foreman-mandatory-period').value,'','Todos resets period selector');
 assert([...document.querySelectorAll('button')].some(b=>b.textContent.includes('control.pdf')),'clear filters reveals new period');
 assert.equal(document.getElementById('foreman-mandatory-period').options[1].value,'2026-07','refreshed selector reflects current periods');

 await action(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('control.pdf')).click());
 assert.equal(find('Finalizar y enviar al supervisor').disabled,false,'all signatures allow send');
 assert(document.body.textContent.includes('Trabajadores revisados y habilitados por el supervisor'));
 await action(()=>find('Revocar y repetir firma').click());
 assert.equal(doc.signatures['1'],undefined);assert.equal(doc.signatures['2'],'signed');
 assert.equal(find('Finalizar y enviar al supervisor').disabled,true,'revoked mandatory signature blocks submission');
 assert(find('Firmar esta persona'),'revoked person can sign again');
 assert(document.querySelector('canvas'),'revocation immediately opens the signature pad for the same worker');
 await action(()=>{const button=find('Guardar');button.click();button.click();});
 assert.equal(signatureAttempts,1,'double save emits a single mutation');
 assert(document.querySelector('canvas'),'failed save keeps the signature pad mounted');
 assert(document.body.textContent.includes('Conexión lenta o interrumpida'),'save failure is visible');
 failSignatureSave=false;
 await action(()=>find('Guardar').click());
 assert.equal(signatureAttempts,2,'explicit retry persists the retained image');
 assert.equal(doc.signatures['1'],'data:image/png;base64,AAAA');
 assert(!find('Guardar'),'pad closes only after verified persistence');
 await action(()=>find('Revocar y repetir firma').click());

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
 const fortnightTrigger=document.querySelector('button[aria-label="Filtrar documentos por quincena"]');
 assert(fortnightTrigger,'app-styled fortnight dropdown replaces native iOS picker');
 assert.equal(fortnightTrigger.getAttribute('aria-expanded'),'false','picker initially closed');
 await action(()=>fortnightTrigger.click());
 assert.equal(fortnightTrigger.getAttribute('aria-expanded'),'true','picker opens in the app');
 const secondHalf=[...document.querySelectorAll('button')].find(button=>button.textContent.startsWith('2ª quincena'));
 assert(secondHalf,'second half appears in app menu');
 await action(()=>secondHalf.click());
 assert.equal(document.querySelectorAll('article').length,1,'second quincena filters documents');
 assert(!document.querySelector('article').textContent.includes('FIRST_HALF'),'period key wins over work date');
 await action(()=>fortnightTrigger.click());
 await action(()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Todas las quincenas').click());
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

 // Each imported mandatory category must support revoking precisely one signed
 // worker and immediately repeating it while the version is editable. A sent
 // or reviewed PDF is immutable until the supervisor returns it for correction.
 for(const type of ['control_presencia','inicio','contrato','prorroga']){
   const ids=['contrato','prorroga'].includes(type)?[1]:[1,2];
   doc.document_type=type;
   doc.lifecycle_status='IN_SIGNATURE';doc.status='in_progress';doc.correction_pending=false;
   doc.signatures=Object.fromEntries(ids.map(id=>[String(id),'signed']));
   doc.details.importedWorkerIds=[...ids];
   doc.details.importedWorkers=workers.filter(w=>ids.includes(w.id));
   doc.details.workerAnchors=workers.filter(w=>ids.includes(w.id)).map(w=>({
     workerId:w.id,workerName:w.apellidosNombre,resolved:true,documentWorkerId:'w'+w.id,
     page:1,signatureX:350,signatureY:500,signatureWidth:70,signatureHeight:14,
   }));
   doc.details.documentWorkersV2=workers.filter(w=>ids.includes(w.id)).map(w=>({
     id:'w'+w.id,legacyWorkerId:w.id,printedName:w.apellidosNombre,detectionStatus:'CONFIRMED',
   }));
   const open=async()=>{
     await mount(React.createElement(ForemanMobilePortal,{token:'test'}));
     const card=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('control.pdf'));
     assert(card,'mandatory document visible: '+type);
     await action(()=>card.click());
   };
   await open();
   const correctionButtons=[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Revocar y repetir firma');
   assert.equal(correctionButtons.length,ids.length,'individual repeat actions on '+type);
   assert.match(document.body.textContent,/Se retirará únicamente su firma|Se retirará únicamente/);
   const previousRevokes=calls.filter(call=>call.name==='revoke_mandatory_signature_v2').length;
   await action(()=>correctionButtons[0].click());
   assert.equal(calls.filter(call=>call.name==='revoke_mandatory_signature_v2').length,previousRevokes+1,'V2 revocation RPC called only once on '+type);
   assert.equal(doc.signatures['1'],undefined,'selected signature revoked: '+type);
   if(ids.length===2)assert.equal(doc.signatures['2'],'signed','other signature remains unchanged: '+type);
   assert(document.querySelector('canvas'),'signature pad opens immediately after revocation: '+type);
   assert.equal(find('Finalizar y enviar al supervisor').disabled,true,'cannot submit with outstanding signature: '+type);
   await action(()=>find('Cancelar').click());
   assert(find('Firmar esta persona'),'worker becomes pending and selectable again: '+type);
   // A reviewed version must remain immutable and provide explicit correction guidance.
   doc.lifecycle_status='REVIEWED';doc.status='reviewed';doc.signatures=Object.fromEntries(ids.map(id=>[String(id),'signed']));
   await open();
   assert.equal([...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Revocar y repetir firma').length,0,'reviewed '+type+' cannot be silently changed');
   assert(document.body.textContent.includes('el supervisor debe devolverlo para corregir'),'reviewed '+type+' explains the return path');
   doc.lifecycle_status='RETURNED_FOR_CORRECTION';doc.status='returned';doc.correction_pending=true;
   await open();
   const returnedButton=find('Revocar y repetir firma');
   assert(returnedButton,'supervisor-returned '+type+' offers selective revocation');
   await action(()=>returnedButton.click());
   assert.equal(doc.signatures['1'],undefined,'returned '+type+' revokes only selected signature');
   if(ids.length===2)assert.equal(doc.signatures['2'],'signed','returned '+type+' retains other signatures');
   assert(document.querySelector('canvas'),'returned '+type+' immediately opens signature pad');
   await action(()=>find('Cancelar').click());
 }

 console.log('PASS: unsigned expansion skips image RPC; duplicate save blocked; failed save retains pad and verified retry closes it.');
 console.log('PASS: fortnight grouping, explicit period precedence, month/work isolation, filter and reset.');
 console.log('PASS: rendered React UI; traceability button absent, explicit publication/withdrawal, selective revocation, pending signer and send restriction after reload.');
 await action(()=>root.unmount());root=null;
} catch(error) {console.error(error);process.exitCode=1;} finally {if(root)root.unmount();dom.window.close();await fs.rm(output,{force:true});}

process.exit(process.exitCode||0);

