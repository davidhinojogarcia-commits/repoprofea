import { build } from 'esbuild';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
for(const key of ['window','document','sessionStorage','HTMLElement','Event','FormData'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
let authCallback,token='token',requests=[],nav=[],filters=[];
globalThis.__tutorUi = { supabase: { auth: {
  getSession: async () => ({ data: { session: token ? { access_token: token } : null } }),
  onAuthStateChange(callback) { authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; }
} } };
const originalFetch=globalThis.fetch;
let response={answer:'Completa la incidencia',incidentForm:true,taskStatus:'diagnostic'};
globalThis.fetch=async(_url,init)=>{requests.push(JSON.parse(init.body));return new Response(JSON.stringify(response),{status:200})};
const entry=new URL('../components/ProfeaTutor.tsx',import.meta.url).pathname;
const output=new URL('./.tutor-ui-test.mjs',import.meta.url);
const { createRoot } = await import('react-dom/client');
const root=createRoot(document.getElementById('root'));
const button=text=>[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===text||x.getAttribute('aria-label')===text);
async function click(text){const b=button(text);assert.ok(b,text);await act(async()=>{b.click()})}
async function ask(text){const area=[...document.querySelectorAll('textarea')].find(x=>!x.name);assert.ok(area);await act(async()=>{const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set;setter.call(area,text);area.dispatchEvent(new Event('input',{bubbles:true}));area.dispatchEvent(new Event('change',{bubbles:true}))});await click('Enviar pregunta')}
try{
 await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',packages:'external',outfile:output.pathname,plugins:[{name:'supabase-stub',setup(b){b.onResolve({filter:/\/supabase$/},args=>args.importer===entry?{path:'supabase',namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase = globalThis.__tutorUi.supabase;',loader:'js'}))}}]});
 const {ProfeaTutor}=await import(output.href);
 await act(async()=>{root.render(React.createElement(ProfeaTutor,{activeView:'prevencion',activeObra:'A',activePeriod:'P1',onNavigate:v=>nav.push(v),onApplyFilters:f=>filters.push(f)}))});
 await act(async()=>{authCallback('SIGNED_IN',{user:{id:'u'}})});
 await click('Abrir Tutor PROFEA');
 await ask('Registra una incidencia');
 assert.ok(button('Registrar incidencia'));const f=button('Registrar incidencia').closest('form');
 const values={obra:'A',fecha:'2026-10-10','categoría':'Otros',prioridad:'Media','título':'Protección',tarea:'Trabajo','descripción':'Falta protección'};
 for(const [key,value]of Object.entries(values))f.elements.namedItem(key).value=value;
 response={answer:'Incidencia guardada y recuperada de la base de datos.',verified:true,taskStatus:'completed'};
 await act(async()=>{f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});
 assert.match(requests.at(-1).question,/Registra una incidencia/);assert.match(requests.at(-1).question,/categoría: Otros/);assert.match(requests.at(-1).question,/descripción: Falta protección/);assert.match(document.body.textContent,/Verificado/);
 response={answer:'Filtros solicitados',clientActions:[{type:'apply_filters',obra:'A',periodo:'P1'},{type:'navigate',view:'sae'}],verified:false};
 await ask('Aplica filtros; obra: A; periodo: P1');assert.deepEqual(filters.at(-1),{obra:'A',periodo:'P1'});assert.equal(nav.at(-1),'sae');
 token='';await ask('Registra una incidencia');assert.match(document.body.textContent,/Vuelve a iniciar sesión/);
 await act(async()=>{authCallback('SIGNED_OUT',null)});assert.ok(!document.body.textContent.includes('Falta protección'));assert.equal(JSON.parse(sessionStorage.getItem('profea:tutor:conversation:v2')).messages.length,0);
 console.log('PASS Tutor UI: formulario, envío explícito, filtros, navegación, aviso de sesión y limpieza entre usuarios.');
}finally{await act(async()=>root.unmount());globalThis.fetch=originalFetch;await fs.unlink(output.pathname).catch(()=>{});dom.window.close()}
