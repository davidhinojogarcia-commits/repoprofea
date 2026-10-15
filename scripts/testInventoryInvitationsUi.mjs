import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const output=new URL('./.inventory-invitations-ui.mjs',import.meta.url);
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://app.example.com/?inventoryInvite=invite-1&token=private#private'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
const park={id:'park-1',nombre:'Parque prueba',zona:'Zona 6',isOwned:true};
const invitation={invitationId:'invite-1',parkId:park.id,parkName:park.nombre,parkZone:park.zona,inviterName:'Supervisor'};
let pending=[], createCount=0,mailCount=0,responseCount=0,mailFailure=true,responseFailure=false,resolveCreate,resolveMail,resolveResponse;
let holdCreate=false,holdMail=false,holdResponse=false;
const source=await fs.readFile(new URL('../src/services/inventoryService.ts',import.meta.url),'utf8');
const names=[...source.matchAll(/export async function (\w+)/g)].map(match=>match[1]);
globalThis.__inventory={
 ensureInventoryReady:async()=>park,listInventoryParks:async()=>[park],
 listInventoryParkInvitations:async()=>pending,
 listInventoryParkShares:async()=>[{participantKey:'invite:invite-1',email:'guest@example.com',displayName:'Invitado',status:'pending'}],
 createInventoryParkInvitation:async()=>{createCount++;if(holdCreate)await new Promise(resolve=>{resolveCreate=resolve;});return {...invitation,email:'guest@example.com'};},
 sendInventoryParkInvitationEmail:async()=>{mailCount++;if(holdMail)await new Promise(resolve=>{resolveMail=resolve;});if(mailFailure)throw Error('not configured');return {ok:true,delivery:'sent'};},
 respondInventoryParkInvitation:async()=>{responseCount++;if(holdResponse)await new Promise(resolve=>{resolveResponse=resolve;});if(responseFailure)throw Error('No se pudo guardar la respuesta');pending=[];return {ok:true};},
};
let root;
try {
 await build({entryPoints:[new URL('../components/InventorySection.tsx',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',packages:'external',outfile:output.pathname,define:{'import.meta.env':'{}'},plugins:[{name:'boundaries',setup(b){
  b.onResolve({filter:/inventoryService$/},()=>({path:'service',namespace:'mock'}));
  b.onResolve({filter:/inventoryPdf$|inventoryExcelImport$/},()=>({path:'optional',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='service'?names.map(name=>`export const ${name}=(...args)=>globalThis.__inventory.${name}?.(...args)??Promise.resolve([]);`).join('\n')+"\nexport const INVENTORY_ZONES=['Zona 6'];export const MACHINE_DOCUMENT_TYPES=[];export const parkBaseLocation=p=>p.nombre;":"export const exportInventoryStatusPdf=async()=>{};export const analyzeInventoryExcel=async()=>[];export const applyInventoryImportPlan=async()=>({});export const buildInventoryImportPlan=()=>({});"}));
 }}]});
 const React=await import('react');const {createRoot}=await import('react-dom/client');const {InventorySection}=await import(output.href);
 const action=async fn=>{await React.act(async()=>{await fn();await new Promise(resolve=>setTimeout(resolve,10));});};
 const find=text=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===text);
 const mount=async()=>{if(root)await action(()=>root.unmount());root=createRoot(document.getElementById('root'));await action(()=>root.render(React.createElement(InventorySection,{savedObras:[]})));};
 const link=()=>[...document.querySelectorAll('input')].find(input=>input.readOnly);
 await mount();
 assert(document.body.textContent.includes('No hay una invitación pendiente de este enlace para tu cuenta'));
 await action(()=>find('Compartir invitación').click());
 assert.equal(createCount,0,'existing pending invitation reused without write');
 assert.equal(link().value,'https://app.example.com/?inventoryInvite=invite-1','link drops all unrelated query/hash secrets');
 await action(()=>find('Copiar enlace').click());assert(document.body.textContent.includes('Selecciona y copia'));
 let copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{copied=value;}}});
 await action(()=>find('Copiar enlace').click());assert.equal(copied,link().value);
 holdMail=true;await action(()=>{find('Reintentar correo').click();find('Reintentar correo')?.click();});
 assert.equal(mailCount,1,'one email attempt for double click');
 await action(()=>resolveMail());assert(document.body.textContent.includes('La invitación sigue pendiente'));
 holdMail=false;mailFailure=false;await action(()=>find('Reintentar correo').click());assert(document.body.textContent.includes('Correo enviado'));
 mailFailure=true;holdCreate=true;
 await action(()=>{
  const input=document.querySelector('input[placeholder="correo.corporativo@..."]');
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'guest@example.com');
  input.dispatchEvent(new window.Event('input',{bubbles:true}));
 });
 await action(()=>{const form=document.querySelector('form');form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));});
 assert.equal(createCount,1,'one create RPC for double submit');
 await action(()=>resolveCreate());assert(document.body.textContent.includes('Invitación guardada'));assert(link());
 pending=[invitation];await action(()=>find('Actualizar invitaciones y parque').click());assert(find('Aceptar y compartir'));
 responseFailure=true;await action(()=>find('Aceptar y compartir').click());assert(document.body.textContent.includes('No se pudo guardar la respuesta'));assert(find('Aceptar y compartir'));
 responseFailure=false;holdResponse=true;
 await action(()=>{find('Aceptar y compartir').click();find('Rechazar').click();});assert.equal(responseCount,2,'only one in-flight answer after failed retry');
 await action(()=>resolveResponse());assert(document.body.textContent.includes('Has aceptado compartir'));assert(!find('Aceptar y compartir'));assert(!window.location.search.includes('inventoryInvite'));
 pending=[invitation];await mount();holdResponse=false;await action(()=>find('Rechazar').click());assert(document.body.textContent.includes('Has rechazado'));
 console.log('PASS inventory React UI: pending link recovery, secret-free URL, clipboard fallback, mail failure/retry, double submits, refresh, answer failure/retry, acceptance and rejection. Emulated DOM.');
} finally {if(root)await (await import('react')).act(()=>root.unmount());dom.window.close();await fs.unlink(output).catch(()=>{});}
