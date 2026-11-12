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
 await page.waitForFunction(()=>Boolean(document.querySelector('[role="img"],img,[role="alert"]')),{timeout:30000});
 const startupError=await page.getByRole('alert').allTextContents();
 assert.equal(startupError.length,0,'Worker card must render without error: '+startupError.join(' | '));
 const img=page.getByRole('img');await img.waitFor();
 assert(await img.evaluate(i=>i.complete&&i.naturalWidth>1000&&Math.abs(i.naturalWidth/i.naturalHeight-95/62)<0.01));
 for(const width of [390,820,1440]){
  await page.setViewportSize({width,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const name of ['Compartir tarjeta','Descargar imagen','Abrir PDF para imprimir a doble cara','Descargar PDF de ambas caras','Prueba de calibración','Ver cara trasera','Cerrar carnet']){
   const button=page.getByRole('button',{name,exact:true});await button.scrollIntoViewIfNeeded();
   assert(await button.evaluate(el=>{const r=el.getBoundingClientRect();return r.height>=44&&r.width>=44&&r.x>=0&&r.right<=innerWidth}));
  }
 }
 await page.setViewportSize({width:390,height:844});
 assert(await page.getByText('la misma hoja física',{exact:false}).count()>0,'duplex workflow explicitly describes one physical sheet');
 assert(await page.getByText('Voltear por borde largo',{exact:false}).count()>0,'duplex workflow explains printer flipping');
 const singleSided=page.locator('details').filter({hasText:'Otras opciones (solo una cara)'});
 await singleSided.locator('summary').click();
 assert.equal(await singleSided.getByRole('button').count(),2,'legacy one-sided exports are in advanced section');
 const originalSrc=await img.getAttribute('src');
 await page.getByRole('button',{name:'Ver cara trasera'}).click();
 assert.notEqual(await img.getAttribute('src'),originalSrc,'back preview is a separate image');
 await page.waitForFunction(()=>{const i=document.querySelector('img');return Boolean(i?.complete&&i.naturalWidth>=900);},{timeout:10000});
 assert(await img.evaluate(i=>i.complete&&i.naturalWidth>=900),'rendered ID-1 reverse preview');
 await page.getByRole('button',{name:'Ver carnet',exact:true}).click();
 assert.equal(await img.getAttribute('src'),originalSrc,'front preview remains unchanged');
 await page.screenshot({path:'/tmp/worker-card-modal.png'});
 await img.screenshot({path:'/tmp/worker-card-preview.png'});
 const pdf=await page.evaluate(()=>window.cardPdf());
 const {PDFDocument}=await import('pdf-lib');const doc=await PDFDocument.load(new Uint8Array(pdf));
 assert.equal(doc.getPageCount(),1);assert(Math.abs(doc.getPage(0).getWidth()/doc.getPage(0).getHeight()-95/62)<0.001);
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const parseTask=pdfjs.getDocument({data:new Uint8Array(pdf),useSystemFonts:true});const parsed=await parseTask.promise;
 const text=(await(await parsed.getPage(1)).getTextContent()).items.map(i=>i.str).join(' ');
 assert(text.includes('García Fernández'.toUpperCase()));assert(!text.includes('01/01/2027'));
assert(!text.includes('OBRA'));
assert(!text.includes('CONTRATO'));assert(!text.includes('12345678Z'),'No exponer DNI completo en tarjeta compartible');
 for(const forbidden of ['PRIVATE_','HISTORIAL','1960','FICHA COMPLETA','worker-qr'])assert(!text.includes(forbidden),forbidden);
 await parseTask.destroy();
 let dl=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar imagen',exact:true}).click();assert((await dl).suggestedFilename().endsWith('.png'));
 dl=page.waitForEvent('download');await page.getByRole('button',{name:'PDF original (solo anverso)'}).click();
 dl=page.waitForEvent('download');await page.getByRole('button',{name:'PDF tamaño DNI · A4 (solo anverso)'}).click();assert((await dl).suggestedFilename().includes('DNI_A4'));assert((await dl).suggestedFilename().endsWith('.pdf'));
 dl=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar PDF de ambas caras'}).click();
 const duplexDownload=await dl;assert(duplexDownload.suggestedFilename().includes('DOBLE_CARA'));
 await page.evaluate(()=>{
   const originalOpen=window.open.bind(window);
   window.open=(url,target)=>{window.lastDuplexPrintOpen={url:String(url),target};return originalOpen(url,target)};
 });
 const popupPromise=page.waitForEvent('popup');
 await page.getByRole('button',{name:'Abrir PDF para imprimir a doble cara'}).click();
 const openedPdf=await popupPromise;
 const printOpen=await page.evaluate(()=>window.lastDuplexPrintOpen);
 assert(printOpen?.url.startsWith('blob:')&&printOpen?.target==='_blank','print action opens generated duplex PDF in a separate tab');
 await openedPdf.close();
  const duplexPath=await duplexDownload.path();
 const duplexPdf=await PDFDocument.load(await fs.readFile(duplexPath));
 assert.equal(duplexPdf.getPageCount(),2,'single worker has front and back pages');
 for(const p of duplexPdf.getPages()){
   assert(Math.abs(p.getWidth()*25.4/72-210)<0.03);
   assert(Math.abs(p.getHeight()*25.4/72-297)<0.03);
 }
 dl=page.waitForEvent('download');await page.getByRole('button',{name:'Prueba de calibración'}).click();
 assert((await dl).suggestedFilename().includes('CALIBRACION'));
 await page.getByText('Imprimir varios carnets · selección autorizada').click();
 assert.equal(await page.getByRole('checkbox').count(),1);
 dl=page.waitForEvent('download');await page.getByRole('button',{name:'Imprimir varios carnets · A4 dúplex'}).click();
 assert((await dl).suggestedFilename().includes('DOBLE_CARA'));

 // Native image sharing must receive the actual PNG, even on desktop.
 await page.evaluate(()=>{
   Object.defineProperty(navigator,'canShare',{configurable:true,writable:true,value:({files})=>files?.[0]?.type==='image/png'});
   Object.defineProperty(navigator,'share',{configurable:true,writable:true,value:async data=>{
     window.shared= {type:data.files[0].type,name:data.files[0].name,count:data.files.length};
   }});
 });
 await page.getByRole('button',{name:'Compartir tarjeta'}).click();
 await page.waitForFunction(()=>Boolean(window.shared));
 assert.deepEqual(await page.evaluate(()=>window.shared),{type:'image/png',name:'CARNE_PROFEA_Garcia_Fernandez_Maria_del_Carmen.png',count:1});
 assert.equal(await page.getByRole('group',{name:'Opciones para compartir el carnet'}).count(),0);
 await page.evaluate(()=>{navigator.share=async()=>{throw new DOMException('Cancelled','AbortError')};});
 await page.getByRole('button',{name:'Compartir tarjeta'}).click();
 await page.evaluate(()=>{navigator.canShare=()=>false;});
 await page.getByRole('button',{name:'Compartir tarjeta'}).click();
 await page.getByRole('status').filter({hasText:'Este navegador no permite compartir imágenes'}).waitFor();
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.closedCard),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: actual card rendering, PNG >1000px, PDF 95×62mm, excluded private fields/history, image/PDF download, native PNG file sharing on desktop, cancellation, unsupported browser guidance, Escape.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
