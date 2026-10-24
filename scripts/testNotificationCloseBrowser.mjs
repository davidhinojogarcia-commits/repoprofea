import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const root=new URL('../',import.meta.url).pathname;
const css=await fs.readFile(root+'notification-modal-layout.css','utf8');
const bundle=(await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{PushNotificationManagerModal as Modal}from'./components/PushNotificationManagerModal';function App(){const[open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>Abrir alertas</button><Modal isOpen={open} onClose={()=>setOpen(false)} people={[]} onToast={()=>{}}/></>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:root,loader:'tsx'},define:{'process.env.NODE_ENV':'"production"'},bundle:true,write:false,format:'iife',platform:'browser',plugins:[{name:'notifications-boundary',setup(b){b.onResolve({filter:/lib\/pushNotifications$/},()=>({path:'push',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const getNotificationPreferences=()=>({});export const getSWRegistrationInfo=async()=>({active:true});export const getNotificationAlertsSummary=()=>({citasVencidas:[],citasHoy:[],citasManana:[],contratosVencidos:[],contratosProximos:[],totalAlertas:0});export const requestNotificationPermission=async()=> 'granted';export const sendLocalSWNotification=async()=>{};export const checkAndTriggerUpcomingAlerts=async()=>{};export const saveNotificationPreferences=()=>{};`}));}}]})).outputFiles[0].text;
const server=http.createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);}else {res.setHeader('Content-Type','text/html');res.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script>`);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();
try{
 for(const [width,height]of [[390,600],[820,600],[1440,900],[1180,420]])for(const dark of [false,true]){
  const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);if(dark)await page.evaluate(()=>document.documentElement.classList.add('dark'));
  await page.waitForTimeout(100);assert.deepEqual(errors,[]);
  const opener=page.getByRole('button',{name:'Abrir alertas',exact:true});
  for(const exit of ['Cerrar alertas','Cerrar y volver al panel','Escape']){
   await opener.click();await page.getByRole('dialog').waitFor();
   await page.locator('.profea-notifications-body').evaluate(e=>e.scrollTop=e.scrollHeight);
   for(const label of ['Cerrar alertas','Cerrar y volver al panel']){
    const button=page.getByRole('button',{name:label,exact:true});const box=await button.boundingBox();
    assert(box&&box.y>=0&&box.y+box.height<=height&&box.x>=0&&box.x+box.width<=width,`${label} reachable at ${width}x${height}`);
    assert(box.height>=44);await button.click({trial:true});
   }
   const bg=await page.locator('.profea-notifications-header').evaluate(e=>getComputedStyle(e).backgroundColor);assert.equal(bg,'rgb(0, 84, 142)');
   if(exit==='Escape')await page.keyboard.press('Escape');else await page.getByRole('button',{name:exit,exact:true}).click();
   await page.getByRole('dialog').waitFor({state:'hidden'});await opener.focus();assert.equal(await page.locator('body').evaluate(e=>e.style.overflow),'');
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS notification dialog: header/footer exits visible after scrolling, Escape, body unlock, light/dark and four phone/tablet/desktop/short viewports.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
