import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { visitTestServer } from './visitMinutesTestServer.mjs';

const root=new URL('../',import.meta.url).pathname;
const tailwind=process.env.SIGNATURE_TAILWIND_SCRIPT?await fs.readFile(process.env.SIGNATURE_TAILWIND_SCRIPT,'utf8'):await(await fetch('https://cdn.tailwindcss.com',{signal:AbortSignal.timeout(30000)})).text();
const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8'),config=html.match(/<script>\s*(tailwind.config[\s\S]*?)<\/script>/)[1];
const env=await visitTestServer(),engine=process.env.BROWSER_ENGINE==='webkit'?'webkit':'chromium',errors=[],calls=[];
let browser,server,held,release,debugPage,fail=false;
try{
 const bundle=(await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{VisitMinutesPanel}from'./components/VisitMinutesPanel';createRoot(document.getElementById('root')).render(<VisitMinutesPanel initialWorksite='Obra de prueba'/>);`,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',format:'iife',write:false,define:{'import.meta.env':'{}'},plugins:[{name:'test-boundaries',setup(b){
   b.onResolve({filter:/pdf\.worker\.min\.mjs\?url$/},()=>({path:'worker',namespace:'test-asset'}));b.onLoad({filter:/.*/,namespace:'test-asset'},()=>({contents:"export default '/pdf-worker.mjs'"}));
   b.onResolve({filter:/(?:\/lib\/|\.\/)supabase$/},()=>({path:'auth',namespace:'test-boundary'}));b.onResolve({filter:/appSettingsService$/},()=>({path:'settings',namespace:'test-boundary'}));
   b.onLoad({filter:/.*/,namespace:'test-boundary'},args=>({contents:args.path==='auth'?"const user={id:'10000000-0000-4000-8000-000000000001'};export const getSessionUser=async()=>user;export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'user-1',user}}})},query:async()=>[]};":"export const loadAppBusinessSettings=async()=>({supervisor:{nombreApellidos:'Supervisor de Prueba',cargo:'Supervisor de obras',email:'supervisor@example.test'},technician:{}});"}));
 }}]})).outputFiles[0].text;
 server=http.createServer(async(req,res)=>{
  try{
   if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle);}
   if(req.url==='/tailwind.js'){res.setHeader('Content-Type','text/javascript');return res.end(tailwind);}
   if(req.url==='/api/visit-minutes'){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());calls.push(body.action);res.setHeader('Content-Type','application/json');
    if(body.action==='assist-writing'){
     held?.();if(held)await new Promise(resolve=>release=resolve);
     if(fail){res.statusCode=503;return res.end(JSON.stringify({ok:false,message:'Fallo de IA simulado. El original se conserva.'}));}
     const points=body.mode==='written'?[{title:body.title||'Arqueta',description:'No ejecutar todavía. Pendiente de comprobar 1,50 m.'}]:[{title:'Arquetas',description:'Quedan 2 arquetas pendientes.'},{title:'Pavimento',description:'El pavimento está terminado.'}];
     return res.end(JSON.stringify({ok:true,proposal:{points,warnings:[]}}));
    }
    const result=await env.invoke(body,req.headers.authorization==='Bearer user-1'?1:null);res.statusCode=result.status;return res.end(JSON.stringify(result.data));
   }
   res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><script>${config}</script><style>body{margin:0}button,input,textarea{font:inherit}</style><body><div id="root" style="padding:12px;max-width:1100px;margin:auto"></div><script src="/app.js"></script></body></html>`);
  }catch(e){errors.push(e.message);res.statusCode=500;res.end('Synthetic server error');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await(engine==='webkit'?webkit:chromium).launch({headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();debugPage=page;page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByRole('button',{name:'Nueva acta de visita',exact:true}).click();
 const point=n=>page.getByLabel('Descripción del punto '+n,{exact:true}),proposed=()=>page.getByRole('region',{name:'Propuesta de redacción',exact:true});
 await point(1).fill('No ejecutar. Pendiente de comprobar 1,50 m.');await page.getByRole('button',{name:'+ Añadir asunto',exact:true}).click();await point(2).fill('Segundo asunto intacto.');
 const before=calls.filter(a=>a==='assist-writing').length;
 await page.getByRole('button',{name:'Mejorar y desarrollar',exact:true}).first().evaluate(el=>{el.click();el.click();});await proposed().waitFor();
 assert.equal(calls.filter(a=>a==='assist-writing').length,before+1);assert.equal(await point(1).inputValue(),'No ejecutar. Pendiente de comprobar 1,50 m.');
 await proposed().getByRole('button',{name:'Descartar propuesta',exact:true}).click();assert.equal(await point(1).inputValue(),'No ejecutar. Pendiente de comprobar 1,50 m.');
 await page.getByRole('button',{name:'Mejorar y desarrollar',exact:true}).first().click();await proposed().waitFor();
 for(const [width,height]of[[390,844],[820,1180],[1440,900]]){
  await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow '+width);
  const apply=proposed().getByRole('button',{name:'Aplicar propuesta',exact:true});await apply.scrollIntoViewIfNeeded();assert(await apply.evaluate(el=>{const r=el.getBoundingClientRect();return r.height>=44&&r.top>=0&&r.bottom<=innerHeight&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
 }
 await proposed().getByRole('button',{name:'Aplicar propuesta',exact:true}).click();assert.equal(await point(1).inputValue(),'No ejecutar todavía. Pendiente de comprobar 1,50 m.');assert.equal(await point(2).inputValue(),'Segundo asunto intacto.');
 let started;const start=new Promise(resolve=>started=resolve);held=started;
 await page.getByRole('button',{name:'Mejorar y desarrollar',exact:true}).first().click();await start;
 await point(1).fill('Edición posterior que se conserva.');release();held=null;await proposed().waitFor();assert(await proposed().getByRole('button',{name:'Aplicar propuesta',exact:true}).isDisabled());await proposed().getByRole('button',{name:'Descartar propuesta',exact:true}).click();assert.equal(await point(1).inputValue(),'Edición posterior que se conserva.');
 fail=true;await page.getByRole('button',{name:'Mejorar y desarrollar',exact:true}).first().click();await page.getByRole('alert').filter({hasText:'Fallo de IA simulado'}).waitFor();assert.equal(await point(1).inputValue(),'Edición posterior que se conserva.');fail=false;
 await page.getByRole('button',{name:'Dictar visita',exact:true}).click();const raw='Quedan 2 arquetas pendientes y el pavimento está terminado.';await page.getByLabel('Dictado de la visita',{exact:true}).fill(raw);
 // Server save must retain unincorporated dictation in the encrypted local draft.
 await page.getByRole('button',{name:'Guardar borrador',exact:true}).click();await page.getByRole('status',{name:'Estado de guardado',exact:true}).filter({hasText:'dictado pendiente'}).waitFor();
 await page.reload();await page.getByRole('button',{name:'Recuperar borrador',exact:true}).click();assert.equal(await page.getByLabel('Dictado de la visita',{exact:true}).inputValue(),raw);
 assert(await page.getByRole('button',{name:'Revisar y firmar',exact:true}).isDisabled());
 await page.getByRole('button',{name:'Organizar dictado',exact:true}).click();await proposed().waitFor();assert.equal(await point(1).inputValue(),'Edición posterior que se conserva.');
 await proposed().getByRole('button',{name:'Aplicar propuesta',exact:true}).click();assert.equal(await point(3).inputValue(),'Quedan 2 arquetas pendientes.');assert.equal(await point(4).inputValue(),'El pavimento está terminado.');assert.equal(await page.getByRole('group',{name:/^Orden \d+$/}).count(),0);
 await page.getByRole('button',{name:'Unir punto 4 con el anterior',exact:true}).click();assert((await point(3).inputValue()).includes('El pavimento está terminado.'));assert.equal(await point(4).count(),0);
 await page.getByRole('button',{name:'Subir punto 3',exact:true}).click();assert((await point(2).inputValue()).includes('2 arquetas'));await page.getByRole('button',{name:'Eliminar punto 2',exact:true}).click();assert.equal(await point(2).inputValue(),'Segundo asunto intacto.');
 await context.setOffline(true);await page.getByRole('button',{name:'Mejorar y desarrollar',exact:true}).first().click();await page.getByRole('alert').filter({hasText:'Sin conexión. Tu texto se conserva'}).waitFor();assert.equal(await point(1).inputValue(),'Edición posterior que se conserva.');await context.setOffline(false);
 assert.deepEqual(errors,[]);await context.close();
 console.log('PASS '+engine+': real React panel/handler/PostgreSQL, written improve/discard/apply, double click, concurrent edits, provider failure, native-keyboard dictation text, encrypted raw recovery after save/reload, append/merge/reorder/delete, no automatic orders, offline fallback, layout 390/820/1440. IA output simulated; no voice capture or physical devices tested.');
}catch(e){if(debugPage&&!debugPage.isClosed()){console.error((await debugPage.locator('body').innerText()).slice(-4500));await debugPage.screenshot({path:'/tmp/visit-writing-failure.png',fullPage:true});}throw e;}finally{release?.();await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await env.cleanup();}
