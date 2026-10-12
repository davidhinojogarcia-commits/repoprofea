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
 const viewport = new dom.window.EventTarget();
 viewport.height=720; viewport.offsetTop=0;
 Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
 Object.defineProperty(window,'innerWidth',{configurable:true,value:390});
 await click('Cerrar Tutor PROFEA');
 await click('Abrir Tutor PROFEA');
 await act(async()=>window.dispatchEvent(new Event('resize')));
 const panel=document.querySelector('section[aria-label="Tutor PROFEA"]');
 assert.equal(panel.style.height,'704px');
 assert.equal(panel.style.top,'8px');
 assert.ok(panel.className.includes('flex-col'));
 assert.ok(button('Enviar pregunta').textContent.includes('Enviar'));
 viewport.height=360; viewport.offsetTop=50;
 await act(async()=>viewport.dispatchEvent(new Event('resize')));
 assert.equal(panel.style.height,'344px');
 assert.equal(panel.style.top,'58px');
 assert.equal(panel.style.bottom,'auto');
 assert.ok(button('Enviar pregunta').closest('section')===panel);
 await click('Cerrar Tutor PROFEA');
 viewport.height=720; viewport.offsetTop=0;
 await act(async()=>viewport.dispatchEvent(new Event('resize')));
 await click('Abrir Tutor PROFEA');
 assert.equal(document.querySelector('section[aria-label="Tutor PROFEA"]').style.height,'704px');
 Object.defineProperty(window,'innerWidth',{configurable:true,value:1024});
 await act(async()=>window.dispatchEvent(new Event('resize')));
 assert.equal(document.querySelector('section[aria-label="Tutor PROFEA"]').style.top,'');
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
 token='token';await act(async()=>{authCallback('SIGNED_IN',{user:{id:'second'}})});
 let resolveDelayed;
 globalThis.fetch=()=>new Promise(resolve=>{resolveDelayed=resolve});
 await ask('Muéstrame mis obras');
 await act(async()=>{authCallback('SIGNED_IN',{user:{id:'third'}})});
 await act(async()=>{resolveDelayed(new Response(JSON.stringify({answer:'DATOS USUARIO ANTERIOR',verified:true})));await Promise.resolve()});
 assert.ok(!document.body.textContent.includes('DATOS USUARIO ANTERIOR'));
 console.log('PASS Tutor UI: formulario, envío explícito, filtros, navegación, aviso de sesión y limpieza entre usuarios y respuesta tardía tras cambiar de sesión.');
}finally{await act(async()=>root.unmount());globalThis.fetch=originalFetch;await fs.unlink(output.pathname).catch(()=>{});dom.window.close()}

