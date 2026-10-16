import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const root=new URL('../',import.meta.url).pathname;
const tailwind=await(await fetch('https://cdn.tailwindcss.com',{signal:AbortSignal.timeout(30000)})).text();
const cssFiles=['index.css',...[...(await fs.readFile(path.join(root,'index.tsx'),'utf8')).matchAll(/import '\.\/(.+\.css)'/g)].map(m=>m[1])];
const css=(await Promise.all(cssFiles.map(p=>fs.readFile(path.join(root,p),'utf8')))).join('\n');
const js=(await build({stdin:{resolveDir:root,loader:'tsx',contents:`
 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import{AppDialogHost}from'./components/AppDialogHost';import{ModalPortal}from'./components/ModalPortal';
 import{appConfirm,appPrompt,appAlert}from'./src/lib/appDialog';
 function App(){const[deleted,setDeleted]=useState(0),[result,setResult]=useState('');
 const remove=async()=>{if(await appConfirm('¿Eliminar definitivamente este documento de Entrega de EPIs?',{title:'Eliminar documento',confirmLabel:'Eliminar definitivamente'}))setDeleted(n=>n+1);};
 return <><AppDialogHost/><main><h1>Documentos de encargados</h1><output id="deleted">{deleted}</output><output id="result">{result}</output>
 {Array.from({length:7},(_,i)=><article className="document-card" key={i}><h2>Entrega de EPIs</h2><p>Obra de prueba · 2026-10-16</p><button onClick={remove}>Eliminar documento {i+1}</button></article>)}
 <button id="prompt" onClick={async()=>setResult(await appPrompt('Describe la corrección',{title:'Solicitar corrección'})||'cancelled')}>Solicitar corrección</button>
 <button id="alert" onClick={()=>appAlert('No se han modificado datos.')}>Mostrar aviso</button>
 </main><ModalPortal label="Ventana anterior"><div className="fixture-modal"><button id="nested-delete" onClick={remove}>Eliminar desde ventana</button></div></ModalPortal></>}
 createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,format:'iife',write:false,platform:'browser'})).outputFiles[0].text;
const fixtureCss=`body{margin:0;font:16px Arial;background:#eef5fc}main{padding:20px}.document-card{position:relative;z-index:4;transform:translateZ(0);margin:15px 0;padding:24px;background:white;border-radius:20px}button{min-height:48px;padding:12px;font:inherit}.fixture-modal{position:fixed;inset:12px;border:2px solid blue;background:#ffffffdd;display:flex;align-items:flex-start;justify-content:flex-end}.profea-modal-overlay{position:fixed;inset:0;z-index:2000000010}`;
// Verify both the full application appearance and missing/delayed CDN utilities.
const server=http.createServer((req,res)=>{const script=req.url==='/app.js'||req.url==='/tailwind.js';res.setHeader('Content-Type',script?'text/javascript':'text/html');res.end(req.url==='/app.js'?js:req.url==='/tailwind.js'?tailwind:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${req.url.includes('tailwind')?'<script src="/tailwind.js"></script><script>tailwind.config={darkMode:"class"}</script>':''}<style>${css}\n${fixtureCss}</style><div id="root"></div><script src="/app.js"></script>`);});
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const mode of ['fallback','tailwind'])for(const width of [390,820,1440])for(const dark of [false,true]){
  const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/?'+mode);
  await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);
  await page.locator('#nested-delete').click();const dialog=page.getByRole('dialog');await dialog.waitFor();
  const geometry=await dialog.evaluate(el=>{const overlay=el.parentElement,style=getComputedStyle(overlay),box=el.getBoundingClientRect(),view=overlay.getBoundingClientRect();return{position:style.position,z:Number(style.zIndex),box:{x:box.x,y:box.y,right:box.right,bottom:box.bottom},viewport:{x:view.x,y:view.y,right:view.right,bottom:view.bottom}};});
  assert.equal(geometry.position,'fixed','confirmation must not depend on generated fixed utility');
  assert(geometry.z>2000000010,'global confirmation must be above an existing portaled modal');
  assert.equal(geometry.viewport.x,0);assert.equal(geometry.viewport.y,0);assert.equal(geometry.viewport.right,width);assert.equal(geometry.viewport.bottom,844);
  assert(geometry.box.x>=0&&geometry.box.y>=0&&geometry.box.right<=width&&geometry.box.bottom<=844,'panel fits viewport');
  const confirm=dialog.getByRole('button',{name:'Eliminar definitivamente',exact:true});
  assert(await confirm.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'confirm button wins actual hit testing over cards and the previous modal');
  await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#deleted').textContent(),'0');
  await page.locator('#nested-delete').click();await dialog.getByRole('button',{name:'Cancelar',exact:true}).focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#deleted').textContent(),'0','Enter on Cancel must not confirm deletion');
  await page.locator('#nested-delete').click();await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#deleted').textContent(),'0');
  await page.locator('#nested-delete').click();await page.getByRole('dialog').getByRole('button',{name:'Eliminar definitivamente',exact:true}).click();await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#deleted').textContent(),'1');
  // Open the same dialogs from the document list after closing the fixture modal.
  await page.evaluate(()=>document.querySelector('.fixture-modal').parentElement.style.display='none');
  await page.locator('#prompt').click();await dialog.getByRole('textbox').fill('Revisar documento');await dialog.getByRole('button',{name:'Continuar',exact:true}).click();assert.equal(await page.locator('#result').textContent(),'Revisar documento');
  await page.locator('#alert').click();await dialog.getByRole('button',{name:'Aceptar',exact:true}).click();assert.equal(await page.locator('#deleted').textContent(),'1');
  await page.getByRole('button',{name:'Eliminar documento 3',exact:true}).click();await dialog.waitFor();await fs.mkdir(path.join(root,'tmp/modal-dialog'),{recursive:true});await page.screenshot({path:path.join(root,`tmp/modal-dialog/${mode}-${width}-${dark?'dark':'light'}.png`)});await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: real React confirmations above cards and portaled windows with/without runtime utilities; cancel/Escape never delete, confirm once, prompts/alerts, 390/820/1440 and both themes. Chromium with emulated viewports; no real documents modified.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
