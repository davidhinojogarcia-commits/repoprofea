import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const output=new URL('./.gmail-authorization-ui.mjs',import.meta.url);
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://local-validation.invalid/'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
window.HTMLCanvasElement.prototype.getContext=()=>null;
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
let scanError={code:'GMAIL_RECONNECT_REQUIRED',status:401,message:'Permiso caducado'},scanCalls=0,redirect='',starts=[];
globalThis.__scan=async()=>{scanCalls++;if(scanError)throw Object.assign(new Error(scanError.message),scanError);return {importedDocuments:0,warnings:[]};};
globalThis.__redirect=url=>{redirect=url;};
globalThis.__api={query:async()=>[],rpc:async()=>null,auth:{getSession:async()=>({data:{session:{access_token:'session'}}})}};
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
 if(String(url).includes('action=status'))return Response.json({connected:false,reconnectRequired:true,email:'supervisor@example.com'});
 if(String(url).includes('action=start')){starts.push(JSON.parse(options.body));return Response.json({authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?state=test'});}
 throw Error('Unexpected fetch '+url);
};
const serviceSource=await fs.readFile(new URL('../src/services/foremanPortalService.ts',import.meta.url),'utf8');
const exportNames=[...serviceSource.matchAll(/export (?:async )?function (\w+)/g)].map(m=>m[1]);
let root;
try{
 await build({stdin:{contents:"export {GmailConnectionPanel} from './components/GmailConnectionPanel';export {ForemanDocumentsDashboard} from './components/ForemanDocumentsDashboard';",resolveDir:new URL('../',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',packages:'external',define:{'import.meta.env':'{}'},outfile:output.pathname,plugins:[{name:'test-boundaries',setup(b){
 b.onLoad({filter:/gmailConnection\.ts$/},async args=>({contents:(await fs.readFile(args.path,'utf8')).replace('window.location.assign(result.authorizationUrl)','globalThis.__redirect(result.authorizationUrl)'),loader:'ts'}));
 for(const [filter,path] of [[/foremanPortalService$/,'portal'],[/(?:\/lib\/|\.\/)supabase$/,'supabase'],[/\/lib\/appDialog$/,'dialog'],[/mandatoryEmailIntake$/,'intake'],[/appSettingsService$/,'settings'],[/\?url$/,'url']])b.onResolve({filter},()=>({path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='portal'?exportNames.map(n=>`export const ${n}=async()=>null;`).join('\n'):args.path==='supabase'?"export const supabase=globalThis.__api;export const getSessionUser=async()=>({id:'owner'});":args.path==='dialog'?"export const appConfirm=async()=>false;export const appAlert=async()=>{};export const appPrompt=async()=>null;":args.path==='intake'?"export const processAdministrativeMandatoryInbox=(...args)=>globalThis.__scan(...args);export const processManualMandatoryFiles=async()=>({importedDocuments:0,warnings:[]});":args.path==='settings'?"export const getCachedSupervisorSettings=()=>({});export const getCachedTechnicianSettings=()=>({});export const loadAppBusinessSettings=async()=>({supervisor:{email:'supervisor@example.com'}});":"export default '';"}));
 }}]});
 const React=await import('react');const {createRoot}=await import('react-dom/client');const {GmailConnectionPanel,ForemanDocumentsDashboard}=await import(output.href);
 const action=async fn=>{await React.act(async()=>{await fn();await new Promise(r=>setTimeout(r,30));});};
 const find=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
 const mount=async node=>{if(root)await action(()=>root.unmount());root=createRoot(document.getElementById('root'));await action(()=>root.render(node));};
 await mount(React.createElement(GmailConnectionPanel,{email:''}));
 assert(document.body.textContent.includes('Gmail necesita renovar el permiso'));assert(!document.body.textContent.includes('Gmail conectado ·'));
 await action(()=>find('Volver a autorizar Gmail').click());assert.equal(starts.at(-1).email,'supervisor@example.com');assert(redirect.startsWith('https://accounts.google.com/'));
 await mount(React.createElement(ForemanDocumentsDashboard));await action(()=>find('Revisar Gmail').click());
 assert(find('Volver a autorizar Gmail'));assert(document.querySelector('[role="alert"]'));
 const previous=scanCalls;await action(()=>document.dispatchEvent(new window.Event('visibilitychange')));assert.equal(scanCalls,previous,'expired Gmail blocks automatic retries');
 await action(()=>find('Volver a autorizar Gmail').click());assert.equal(starts.length,2,'recovery from document dashboard starts OAuth');
 await mount(React.createElement(ForemanDocumentsDashboard));await action(()=>find('Revisar Gmail').click());
 scanError=null;await action(()=>find('Revisar Gmail').click());assert(!find('Volver a autorizar Gmail'),'successful manual scan clears recovery prompt');
 scanError={code:'GMAIL_TEMPORARILY_UNAVAILABLE',status:503,message:'Temporal'};await action(()=>find('Revisar Gmail').click());assert(!find('Volver a autorizar Gmail'),'temporary Google outage does not request new consent');
 console.log('PASS Gmail UI: actual client API, expired badge, existing email fallback, dashboard recovery click and OAuth redirect, stopped retries, recovery and temporary failures.');
}finally{if(root)await (await import('react')).act(()=>root.unmount());globalThis.fetch=nativeFetch;dom.window.close();await fs.unlink(output).catch(()=>{});}
