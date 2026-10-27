import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const tailwind=process.env.SIGNATURE_TAILWIND_SCRIPT?await fs.readFile(process.env.SIGNATURE_TAILWIND_SCRIPT,'utf8'):await(await fetch('https://cdn.tailwindcss.com',{signal:AbortSignal.timeout(15000)})).text();
const root = new URL('../', import.meta.url).pathname;
const bundle = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import WorkerCardModal from './components/WorkerCardModal';import{generateWorkerCard}from './src/lib/workerCard';
const person={id:1,apellidosNombre:'García Fernández, María del Carmen',dni:'12345678Z',categoria:'Oficial de primera',obra:'Reurbanización de la plaza y mejora de las redes de abastecimiento',periodoInicio:'2027-01-01',periodoFin:'2027-01-31',iban:'PRIVATE_BANK',nuss:'PRIVATE_NUSS',observaciones:'PRIVATE_NOTE',fechaNacimiento:'1960-01-01',reconocimientoLimitaciones:'PRIVATE_MEDICAL'};
window.cardPdf=()=>Array.from(new Uint8Array(generateWorkerCard(person).doc.output('arraybuffer')));
createRoot(document.getElementById('root')).render(<WorkerCardModal person={person} onClose={()=>{window.closedCard=true}}/>);`, loader: 'tsx', resolveDir: root }, bundle: true, format: 'iife', platform: 'browser', write: false, plugins: [{ name: 'qr-share-stub', setup(b) { b.onResolve({ filter: /workerQrShareService$/ }, () => ({ path: 'qr-share-stub', namespace: 'qr-test' })); b.onLoad({ filter: /.*/, namespace: 'qr-test' }, () => ({ contents: "export async function ensureWorkerQrShare(){ return '123e4567-e89b-12d3-a456-426614174000'; }" })); } }, { name: 'worker', setup(b) { b.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: 'worker', namespace: 'asset' })); b.onLoad({ filter: /.*/, namespace: 'asset' }, () => ({ contents: "export default '/worker.mjs'" })); } }] })).outputFiles[0].text;
const worker = await fs.readFile(root + 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');
const server = http.createServer((req,res) => { res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');res.end(req.url==='/tailwind.js'?tailwind:req.url==='/app.js'?bundle:req.url==='/worker.mjs'?worker:'<meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><div id="root"></div><script src="/app.js"></script>'); });
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const img=page.getByRole('img');await img.waitFor();
 assert(await img.evaluate(i=>i.complete&&i.naturalWidth>1000&&Math.abs(i.naturalWidth/i.naturalHeight-95/62)<0.01));
 for(const width of [390,820,1440]){
  await page.setViewportSize({width,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const name of ['Compartir tarjeta','Descargar imagen','Cerrar carnet']){
   const button=page.getByRole('button',{name,exact:true});await button.scrollIntoViewIfNeeded();
   assert(await button.evaluate(el=>{const r=el.getBoundingClientRect();return r.height>=44&&r.width>=44&&r.x>=0&&r.right<=innerWidth}));
  }
 }
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/tmp/worker-card-modal.png'});
 await img.screenshot({path:'/tmp/worker-card-preview.png'});
 const pdf=await page.evaluate(()=>window.cardPdf());
 const {PDFDocument}=await import('pdf-lib');const doc=await PDFDocument.load(new Uint8Array(pdf));
 assert.equal(doc.getPageCount(),1);assert(Math.abs(doc.getPage(0).getWidth()/doc.getPage(0).getHeight()-95/62)<0.001);
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const parseTask=pdfjs.getDocument({data:new Uint8Array(pdf),useSystemFonts:true});const parsed=await parseTask.promise;
 const text=(await(await parsed.getPage(1)).getTextContent()).items.map(i=>i.str).join(' ');
 assert(text.includes('García Fernández'.toUpperCase()));assert(text.includes('01/01/2027'));
 for(const forbidden of ['PRIVATE_','HISTORIAL','1960','FICHA COMPLETA','worker-qr'])assert(!text.includes(forbidden),forbidden);
 await parseTask.destroy();
 let dl=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar imagen',exact:true}).click();assert((await dl).suggestedFilename().endsWith('.png'));
 dl=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar PDF para imprimir'}).click();assert((await dl).suggestedFilename().endsWith('.pdf'));
 await page.evaluate(()=>{Object.defineProperty(navigator,'canShare',{configurable:true,writable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,writable:true,value:async data=>{window.shared={type:data.files[0].type,name:data.files[0].name,count:data.files.length}}});});
 await page.getByRole('button',{name:'Compartir tarjeta'}).click();assert.deepEqual(await page.evaluate(()=>window.shared),{type:'image/png',name:'CARNE_PROFEA_Garcia_Fernandez_Maria_del_Carmen.png',count:1});
 await page.evaluate(()=>{navigator.share=async()=>{throw new DOMException('Cancelled','AbortError')}});
 let downloads=0;page.on('download',()=>downloads++);await page.getByRole('button',{name:'Compartir tarjeta'}).click();await page.waitForTimeout(100);assert.equal(downloads,0);
 await page.evaluate(()=>{navigator.canShare=()=>false});dl=page.waitForEvent('download');await page.getByRole('button',{name:'Compartir tarjeta'}).click();assert((await dl).suggestedFilename().endsWith('.png'));
 await page.getByRole('status').filter({hasText:'Se ha descargado'}).waitFor();
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.closedCard),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: actual card rendering, PNG >1000px, PDF 95×62mm, excluded private fields/history, image/PDF download, file sharing, cancellation, unsupported-share fallback, Escape. Native mobile share simulated.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
