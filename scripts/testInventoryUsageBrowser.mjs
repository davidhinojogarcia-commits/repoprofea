import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildUsageFixture} from './inventoryUsageFixture.mjs';
const root=new URL('../',import.meta.url).pathname;
const bundle=(await buildUsageFixture(true)).outputFiles[0].text;
const tailwind=process.env.SIGNATURE_TAILWIND_SCRIPT?await fs.readFile(process.env.SIGNATURE_TAILWIND_SCRIPT,'utf8'):await (await fetch('https://cdn.tailwindcss.com',{signal:AbortSignal.timeout(30000)})).text();
const index=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
const config=index.match(/<script>\s*(tailwind.config[\s\S]*?)<\/script>/)[1];
const entry=await fs.readFile(new URL('../index.tsx',import.meta.url),'utf8');
const styles=[...entry.matchAll(/import '\.\/(.+\.css)'/g)].map(match=>`<link rel="stylesheet" href="/${match[1]}">`).join('');
const screenshots=process.env.INVENTORY_SCREENSHOTS;
if(screenshots)await fs.mkdir(screenshots,{recursive:true});
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(bundle);}
  else if(req.url==='/tailwind.js'){res.setHeader('content-type','text/javascript');res.end(tailwind);}
  else if(req.url?.endsWith('.css')){const file=path.resolve(root,'.'+req.url);if(!file.startsWith(root))throw Error('Forbidden');res.setHeader('content-type','text/css');res.end(await fs.readFile(file));}
  else{res.setHeader('content-type','text/html');res.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><script>${config}</script>${styles}<body class="bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"><main id="root" class="p-3 sm:p-6 max-w-screen-xl mx-auto"></main><script src="/app.js"></script></body></html>`);}
 }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 browser=await chromium.launch({headless:true,...(process.env.SIGNATURE_BROWSER_EXECUTABLE?{executablePath:process.env.SIGNATURE_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});
 const errors=[];
 for(const width of [390,820,1440])for(const dark of [false,true]){
  const context=await browser.newContext({viewport:{width,height:1000}});const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const mailRequests=[];await page.route('**/api/gmail?action=send-inventory-breakdown',async route=>{mailRequests.push(route.request().postDataJSON());await route.fulfill({status:mailRequests.length===1?409:200,contentType:'application/json',body:JSON.stringify(mailRequests.length===1?{ok:false,code:'GMAIL_NOT_CONNECTED',message:'Autoriza Gmail del supervisor.'}:{ok:true,delivery:'sent',provider:'gmail',messageId:'gmail-test',from:'supervisor@example.test'})});});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:'Inventario',exact:true}).click();
  await page.getByLabel('Buscar equipo o responsable').fill('nunez');
  const list=width<768?page.locator('.md\\:hidden').filter({hasText:'Hormigonera'}).last():page.locator('tbody');
  await list.getByText('Lucía Núñez',{exact:true}).waitFor();
  await page.getByLabel('Buscar equipo o responsable').fill('');
  await page.getByLabel('Filtrar por responsable').selectOption('user-i');
  assert.equal(await page.locator('tbody tr').count(),1);
  await page.evaluate(value=>document.documentElement.classList.toggle('dark',value),dark);
  await page.waitForTimeout(200); // Tailwind observes the new DOM/classes.
  const colors=await page.locator('[aria-label^="Ver equipos de "]').evaluateAll(buttons=>buttons.map(button=>button.parentElement.querySelector('span').style.backgroundColor));
  assert.equal(colors.length,2);assert.notEqual(colors[0],colors[1]);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal page overflow');
  if(screenshots)await page.screenshot({path:path.join(screenshots,`inventory-${width}-${dark?'dark':'light'}.png`),fullPage:true});
  await page.getByLabel('Filtrar por responsable').selectOption('');
  const move=width<768?page.locator('.md\\:hidden [title="Mover"]').last():page.locator('tbody tr').first().getByTitle('Mover',{exact:true});
  await move.click();const modal=page.getByRole('dialog');
  const responsible=modal.getByLabel('Responsable / quién está usando el equipo');await responsible.waitFor();assert.equal(await responsible.locator('option').count(),3);
  assert.equal(await responsible.inputValue(),'user-a','movement defaults to current supervisor, not previous user');
  await responsible.selectOption('user-i');await modal.getByLabel('Destino / obra').fill('Obra B');
  await modal.getByRole('button',{name:'Registrar movimiento',exact:true}).click();await modal.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>__usage.saves[0].responsableId),'user-i');
  await move.click();const breakdown=page.getByRole('dialog');await breakdown.getByLabel('Tipo').selectOption('Avería');await breakdown.getByLabel('Destino / obra',{exact:true}).fill('Taller');await breakdown.getByLabel('Descripción de la avería',{exact:true}).fill('No arranca');await breakdown.getByRole('button',{name:'Registrar avería y enviar por Gmail',exact:true}).click();await breakdown.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Autorizar Gmail del supervisor',exact:true}).waitFor();const savedCount=await page.evaluate(()=>__usage.saves.length);await page.getByRole('button',{name:'Reintentar aviso por Gmail',exact:true}).click();await page.getByRole('status').filter({hasText:'Gmail ha aceptado'}).waitFor();assert.equal(await page.evaluate(()=>__usage.saves.length),savedCount,'mail retry does not duplicate movement');assert.equal(mailRequests.length,2);assert.equal(mailRequests[0].movementId,mailRequests[1].movementId);assert.deepEqual(Object.keys(mailRequests[0]),['movementId']);assert(page.url().startsWith('http://127.0.0.1:'),'no mail client opened');
  await context.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS Chromium full inventory: desktop/tablet/mobile viewports, light/dark, two distinct colors, names/search/filters, accepted-only user selection, save and no horizontal page overflow. Data transport simulated.');
} finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
