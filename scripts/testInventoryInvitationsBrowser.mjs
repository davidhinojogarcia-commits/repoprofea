import assert from 'node:assert/strict';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {InventoryInvitationLink} from './components/InventoryInvitationLink';createRoot(document.getElementById('root')).render(React.createElement(InventoryInvitationLink,{invitationId:'invitation-test',email:'guest@example.com'}));`,resolveDir:new URL('../',import.meta.url).pathname,loader:'tsx'},bundle:true,platform:'browser',format:'iife',write:false,plugins:[{name:'mail-boundary',setup(b){
 b.onResolve({filter:/(?:\/lib\/|\.\/)supabase$/},()=>({path:'auth',namespace:'test-auth'}));
 b.onLoad({filter:/.*/,namespace:'test-auth'},()=>({contents:"export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'fixture-session'}}})}};"}));
 b.onResolve({filter:/inventoryService$/},()=>({path:'mail',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:"export async function sendInventoryParkInvitationEmail(){window.mailCalls=(window.mailCalls||0)+1;if(window.holdMail)await new Promise(resolve=>{window.releaseMail=resolve;});if(!window.mailSuccess)throw Error('503');return {ok:true,delivery:'sent'};}"}));
}}]});
const server=http.createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(result.outputFiles[0].text);}else{res.setHeader('content-type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 const executablePath=process.env.SIGNATURE_BROWSER_EXECUTABLE;
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
 const errors=[];
 for(const width of [390,820,1440]) {
  const context=await browser.newContext({viewport:{width,height:900}});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  let gmailCalls=0,gmailFail=true;
  await page.route('**/api/gmail?action=send-inventory-invite',async route=>{gmailCalls++;assert.deepEqual(route.request().postDataJSON(),{invitationId:'invitation-test'});assert.equal(route.request().headers().authorization,'Bearer fixture-session');await route.fulfill({status:gmailFail?401:200,contentType:'application/json',body:JSON.stringify(gmailFail?{code:'GMAIL_NOT_CONNECTED',message:'Conecta Gmail en Configuración'}:{ok:true,delivery:'sent',provider:'gmail',messageId:'test-message',from:'supervisor@example.com'})});});
  await page.goto(`http://127.0.0.1:${server.address().port}/?token=do-not-share#private`);
  await page.getByRole('button',{name:'Copiar enlace'}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Enlace de invitación'}).inputValue(),`http://127.0.0.1:${server.address().port}/?inventoryInvite=invitation-test`);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('Denied');}},configurable:true}));
  await page.getByRole('button',{name:'Copiar enlace'}).click();await page.getByRole('status').filter({hasText:'Selecciona y copia'}).waitFor();
  await page.evaluate(()=>{window.holdMail=true;});
  await page.getByRole('button',{name:'Reintentar correo'}).click();assert(await page.getByRole('button',{name:'Enviando correo…'}).isDisabled());
  await page.evaluate(()=>window.releaseMail());await page.getByRole('status').filter({hasText:'La invitación sigue pendiente'}).waitFor();
  await page.evaluate(()=>{window.holdMail=false;window.mailSuccess=true;});
  await page.getByRole('button',{name:'Reintentar correo'}).click();await page.getByRole('status').filter({hasText:'Correo enviado'}).waitFor();
  assert.equal(await page.evaluate(()=>window.mailCalls),2);
  await page.getByRole('button',{name:'Enviar invitación por Gmail'}).click();await page.getByRole('status').filter({hasText:'Conecta Gmail en Configuración'}).waitFor();
  gmailFail=false;await page.getByRole('button',{name:'Enviar invitación por Gmail'}).click();await page.getByRole('status').filter({hasText:'Invitación enviada por Gmail desde supervisor@example.com'}).waitFor();assert.equal(gmailCalls,2);
  await context.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS Chromium: real invitation link component and Gmail client at 390/820/1440, accessible controls, clipboard denial, slow/failing mail, Gmail authorization failure/retry and confirmed sender; no page errors. Viewports emulated; mail API mocked.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
