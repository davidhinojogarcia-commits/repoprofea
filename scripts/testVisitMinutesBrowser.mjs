import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {visitTestServer} from './visitMinutesTestServer.mjs';
import {id,content,person} from './visitMinutesFixture.mjs';
// Download only the same Tailwind runtime already used by the application,
// before replacing fetch with the isolated external-service test boundary.
const tailwind=process.env.SIGNATURE_TAILWIND_SCRIPT?await fs.readFile(process.env.SIGNATURE_TAILWIND_SCRIPT,'utf8'):await(await fetch('https://cdn.tailwindcss.com',{signal:AbortSignal.timeout(30000)})).text();
const root=new URL('../',import.meta.url).pathname;
const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');const config=html.match(/<script>\s*(tailwind.config[\s\S]*?)<\/script>/)[1];
const styles=[...((await fs.readFile(new URL('../index.tsx',import.meta.url),'utf8')).matchAll(/import '\.\/(.+\.css)'/g))].map(m=>`<link rel="stylesheet" href="/${m[1]}">`).join('');
const env=await visitTestServer();let server,browser,debugPage;const errors=[];
try{
 const bundle=(await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {VisitMinutesPanel} from './components/VisitMinutesPanel';import {VisitMinutesPortal} from './components/VisitMinutesPortal';import {VisitContactsPanel} from './components/VisitContactsPanel';import {AppDialogHost} from './components/AppDialogHost';import {installModalRuntime} from './src/lib/modalRuntime';import {installAppDialogRuntime} from './src/lib/appDialog';installModalRuntime();installAppDialogRuntime();const token=new URLSearchParams(location.hash.slice(1)).get('visit');createRoot(document.getElementById('root')).render(<><AppDialogHost/>{token?<VisitMinutesPortal token={token}/>:location.pathname==='/contacts'?<VisitContactsPanel/>:<VisitMinutesPanel initialWorksite='Obra de prueba'/>}</>);`,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',format:'iife',write:false,define:{'import.meta.env':'{}'},plugins:[{name:'auth-and-settings-boundaries',setup(b){
  b.onResolve({filter:/(?:\/lib\/|\.\/)supabase$/},()=>({path:'auth',namespace:'visit-test'}));
  b.onResolve({filter:/appSettingsService$/},()=>({path:'settings',namespace:'visit-test'}));
  b.onLoad({filter:/.*/,namespace:'visit-test'},args=>({contents:args.path==='auth'?"export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'user-1'}}})}};":"export const loadAppBusinessSettings=async()=>({supervisor:{nombreApellidos:'Supervisor de Prueba',cargo:'Supervisor de obras',email:'supervisor@example.test',telefono:''}});"}));
 }}]})).outputFiles[0].text;
 let apiHold=false,failSave=false;const apiLog=[];
 server=http.createServer(async(req,res)=>{
  try{
   if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');return res.end(bundle);}
   if(req.url==='/tailwind.js'){res.setHeader('content-type','text/javascript');return res.end(tailwind);}
   if(req.url?.endsWith('.css')){const file=path.resolve(root,'.'+req.url);if(!file.startsWith(root))throw Error('Forbidden');res.setHeader('content-type','text/css');return res.end(await fs.readFile(file));}
   if(req.url==='/api/visit-minutes'){
     const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());apiLog.push({action:body.action,command:body.command?.type});
     if(apiHold)await new Promise(resolve=>setTimeout(resolve,300));
     if(failSave&&body.action==='command'&&body.command.type==='save'){res.statusCode=503;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:false,message:'Fallo de guardado simulado: los datos no se han guardado.'}));}
     const user=req.headers.authorization==='Bearer user-1'?1:null;const result=await env.invoke(body,user);res.statusCode=result.status;for(const[k,v]of Object.entries(result.headers))res.setHeader(k,v);res.setHeader('content-type','application/json');return res.end(JSON.stringify(result.data));
   }
   res.setHeader('content-type','text/html');res.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><script>${config}</script>${styles}<body class="bg-slate-50 dark:bg-slate-950"><div id="root" class="p-3 sm:p-6"></div><script src="/app.js"></script></body></html>`);
  }catch(e){errors.push(e.message);res.statusCode=500;res.end('Test server failure');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.SIGNATURE_BROWSER_EXECUTABLE?{executablePath:process.env.SIGNATURE_BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();debugPage=page;page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/contacts');await page.getByRole('button',{name:'Añadir persona',exact:true}).click();
 await page.getByLabel('Nombre',{exact:true}).fill('Ana');await page.getByLabel('Apellidos',{exact:true}).fill('Persona de Prueba');await page.getByLabel('Entidad / empresa').fill('Entidad de prueba');await page.getByLabel('Correo electrónico',{exact:true}).fill('ana@example.test');
 await page.getByLabel(/11002GR/).check();await page.getByRole('button',{name:'Guardar contacto',exact:true}).click();await page.getByRole('button',{name:/Ana Persona de Prueba/}).waitFor();
 await page.reload();await page.getByRole('button',{name:/Ana Persona de Prueba/}).waitFor();
 await page.goto(base);await page.getByRole('button',{name:'Nueva acta de visita',exact:true}).click();await page.getByLabel('Hora final',{exact:true}).fill('23:59');
 await page.getByLabel('Objeto de la visita',{exact:true}).fill(content.purpose);await page.getByLabel('Asuntos tratados y decisiones').fill(content.discussion);
 await page.getByLabel('Añadir desde Dirección facultativa').selectOption({label:'Ana Persona de Prueba · Dirección de obra'});
 await page.getByRole('button',{name:'Añadir acuerdo',exact:true}).click();await page.getByLabel('Acuerdo 1',{exact:true}).fill(content.agreements[0].text);await page.getByLabel('Responsable',{exact:true}).fill('Dirección de obra');await page.getByLabel('Plazo',{exact:true}).fill('2026-10-20');
 const beforeCreate=apiLog.filter(c=>c.action==='create').length;apiHold=true;await page.getByRole('button',{name:'Guardar borrador',exact:true}).evaluate(el=>{el.click();el.click();});await page.getByRole('button',{name:'Enviar para revisión',exact:true}).waitFor();apiHold=false;
 assert.equal(apiLog.filter(c=>c.action==='create').length-beforeCreate,1,'rapid double click creates one acta');
 await page.getByRole('button',{name:'Actualizar',exact:true}).click();assert.equal(await page.getByLabel('Asuntos tratados y decisiones').inputValue(),content.discussion);
 failSave=true;await page.getByLabel('Incidencias y observaciones',{exact:true}).fill('Observación que debe conservarse tras un error.');await page.getByRole('button',{name:'Guardar borrador',exact:true}).click();await page.getByRole('alert').filter({hasText:'Fallo de guardado simulado'}).waitFor();assert.equal(await page.getByLabel('Incidencias y observaciones',{exact:true}).inputValue(),'Observación que debe conservarse tras un error.');failSave=false;await page.getByRole('button',{name:'Guardar borrador',exact:true}).click();await page.getByText('Acta guardada. Los datos están confirmados por el servidor.').waitFor();
 await page.getByRole('button',{name:'Enviar para revisión',exact:true}).click();const dialog=page.getByRole('dialog').last();await dialog.getByText('ana@example.test',{exact:false}).waitFor();await dialog.getByRole('button',{name:'Confirmar y abrir revisión',exact:true}).click();await page.getByRole('button',{name:'Generar / renovar enlace personal'}).waitFor();
 await page.getByRole('button',{name:'Generar / renovar enlace personal'}).click();const access=page.getByLabel('Enlace personal: entrégalo solo a su destinatario');await access.waitFor();const token=(await access.inputValue()).split('=')[1];
 const attendee=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const mobile=await attendee.newPage();mobile.on('pageerror',e=>errors.push(e.message));
 await mobile.goto(base+'/#visit='+token);await mobile.getByRole('button',{name:'Enviar código a mi correo'}).click();await mobile.getByRole('status').filter({hasText:'Código enviado'}).waitFor();const code=env.sent.at(-1).body.match(/es: (\d{6})/)[1];
 await mobile.getByLabel('Código de seis dígitos').fill(code);await mobile.getByRole('button',{name:'Verificar y abrir acta'}).click();await mobile.getByRole('button',{name:'Doy mi conformidad',exact:true}).click();await mobile.getByText('Respuesta guardada y comprobada en el servidor.').waitFor();
 await page.getByRole('button',{name:'Actualizar',exact:true}).click();await page.getByRole('button',{name:'Abrir firmas y avisar',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'Confirmar y abrir firmas'}).click();await page.getByRole('button',{name:'Firma presencial',exact:true}).waitFor();assert.equal(await page.getByRole('dialog',{name:'Revisar correos antes de enviar'}).count(),0,'signing preview dialog is removed after confirmation');assert.equal(await page.locator('.profea-modal-overlay').count(),0,'signing flow leaves no modal overlay blocking the supervisor');
 await mobile.getByRole('button',{name:'Actualizar acta',exact:true}).click();await mobile.getByRole('button',{name:'Firmar esta versión'}).click();
 const canvas=mobile.getByLabel('Zona de firma de Ana Persona de Prueba');await canvas.scrollIntoViewIfNeeded();const canvasBox=await canvas.boundingBox();
 await mobile.mouse.move(canvasBox.x+20,canvasBox.y+80);await mobile.mouse.down();for(let x=0;x<140;x+=4)await mobile.mouse.move(canvasBox.x+20+x,canvasBox.y+80+25*Math.sin(x/15));await mobile.mouse.up();
 await mobile.getByRole('button',{name:'Borrar / repetir'}).click();assert(await mobile.getByRole('button',{name:'Confirmar firma',exact:true}).isDisabled(),'clear disables confirmation');
 const cdp=await attendee.newCDPSession(mobile);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:canvasBox.x+20,y:canvasBox.y+80,id:3}]});
 for(let x=0;x<140;x+=6)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:canvasBox.x+20+x,y:canvasBox.y+80+20*Math.sin(x/15),id:3}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert(!await mobile.getByRole('button',{name:'Confirmar firma',exact:true}).isEnabled(),'identity checkbox still required after a touch stroke');
 await mobile.getByRole('button',{name:'Borrar / repetir'}).click();await canvas.scrollIntoViewIfNeeded();
 const penBox=await canvas.boundingBox();
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:penBox.x+25,y:penBox.y+90,button:'left',clickCount:1,pointerType:'pen'});
 for(let x=0;x<150;x+=3)await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:penBox.x+25+x,y:penBox.y+90+30*Math.sin(x/17),button:'left',buttons:1,pointerType:'pen'});
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:penBox.x+175,y:penBox.y+90,button:'left',clickCount:1,pointerType:'pen'});
 const inkBounds=()=>canvas.evaluate(c=>{const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let x0=c.width,x1=0,y0=c.height,y1=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(p[(y*c.width+x)*4+3]>100){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}return {width:x1-x0,height:y1-y0};});
 const beforeResize=await inkBounds();await mobile.setViewportSize({width:820,height:1000});await mobile.waitForTimeout(150);await mobile.setViewportSize({width:390,height:844});await mobile.waitForTimeout(150);const afterResize=await inkBounds();assert(Math.abs(beforeResize.width-afterResize.width)<=2&&Math.abs(beforeResize.height-afterResize.height)<=2,'rotation preserves the existing stroke without progressive shrink or stretching');
 await mobile.evaluate(()=>document.documentElement.classList.add('dark'));assert.equal(await canvas.evaluate(c=>getComputedStyle(c).backgroundColor),'rgb(255, 255, 255)','dark capture retains a paper background');
 await mobile.getByLabel(/Soy Ana Persona de Prueba/).check();await mobile.getByRole('button',{name:'Confirmar firma',exact:true}).evaluate(el=>{el.click();el.click();});await mobile.getByText('Tu firma está guardada en esta versión.').waitFor();
 const pixelCheck=await mobile.getByAltText('Firma de Ana Persona de Prueba',{exact:true}).evaluate(async image=>{await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data;let blue=0,transparent=0;for(let i=0;i<p.length;i+=4){if(p[i+3]===0)transparent++;if(p[i+3]>200&&p[i]===22&&p[i+1]===75&&p[i+2]===155)blue++;}return {blue,transparent};});assert(pixelCheck.blue>10&&pixelCheck.transparent>10,'captured PNG retains blue ink and transparent background');
 await page.getByRole('button',{name:'Actualizar',exact:true}).click();await page.getByRole('button',{name:'Finalizar acta firmada',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'Confirmar',exact:true}).click();await page.getByRole('button',{name:'Descargar PDF firmado',exact:true}).waitFor();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar PDF firmado',exact:true}).click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/_FIRMADA.pdf$/);const downloaded=await fs.readFile(await download.path());assert(downloaded.subarray(0,4).toString()==='%PDF');
 await page.getByRole('button',{name:'Enviar acta firmada por correo'}).click();await page.getByRole('dialog').last().getByRole('button',{name:'Confirmar y enviar PDF firmado'}).click();await page.getByText(/1 correo\(s\) aceptados por Gmail/).waitFor();assert(env.sent.at(-1).raw.includes('application/pdf'));
 const screenshots=process.env.VISIT_SCREENSHOTS||new URL('../tmp/visit-ui/',import.meta.url).pathname;await fs.mkdir(screenshots,{recursive:true});
 for(const width of [390,820,1440])for(const dark of [false,true]){
   await page.setViewportSize({width,height:1000});await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);await page.waitForTimeout(150);
   if(dark)assert.equal(await page.getByAltText('Firma de Ana Persona de Prueba',{exact:true}).evaluate(img=>getComputedStyle(img).backgroundColor),'rgb(255, 255, 255)','signed preview remains legible in dark mode');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow '+width);
   await page.screenshot({path:path.join(screenshots,`visit-${width}-${dark?'dark':'light'}.png`),fullPage:true});
 }
 const idle=apiLog.length;await page.waitForTimeout(1000);assert.equal(apiLog.length,idle,'no polling while idle');
 await attendee.close();await context.close();assert.deepEqual(errors,[]);
 console.log('PASS Chromium → real API → PostgreSQL → PDF and simulated Gmail: contacts, persistence, slow/double click, save failure/retry, consent, email code, capture/clear/repeat, immutable final download/distribution, 390/820/1440 light/dark and no idle polling. Viewports are emulated; no real emails or physical devices.');
}catch(error){if(debugPage&&!debugPage.isClosed()){console.error('Synthetic UI diagnostic:',(await debugPage.locator('body').innerText()).slice(-5500));await debugPage.screenshot({path:'/tmp/visit-ui-failure.png',fullPage:true});}throw error;}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await env.cleanup();}
