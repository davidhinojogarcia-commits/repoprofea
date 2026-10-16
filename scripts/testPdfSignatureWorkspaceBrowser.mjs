import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createServer,transformWithEsbuild} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';
const root=new URL('../',import.meta.url).pathname;
const out=process.env.EMPLOYMENT_TEST_OUTPUT||await fs.mkdtemp(path.join(os.tmpdir(),'pdf-workspace-'));
await fs.mkdir(out,{recursive:true});
const tailwind=process.env.SIGNATURE_TAILWIND_SCRIPT?await fs.readFile(process.env.SIGNATURE_TAILWIND_SCRIPT):execFileSync('curl',['-fsSL','--max-time','30','https://cdn.tailwindcss.com']);
const mock=`export const getSupervisorMandatoryPdf=async()=>({base64:window.sourceBase64});export const prepareMandatoryDocumentFromEmail=async(input)=>{window.imported=input;return 'doc';};export const restoreForemanMandatoryGmailSource=async()=>{};`;
const harness=`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PDFDocument,StandardFonts} from 'pdf-lib';import {processManualMandatoryFiles} from '/src/lib/mandatoryEmailIntake.ts';import {buildSignedMandatoryPdf,verifyMandatoryPdfFidelity,bytesToBase64} from '/src/lib/mandatoryPdfOverlay.ts';import MandatoryPdfAnchorEditor from '/components/MandatoryPdfAnchorEditor.tsx';import '/index.css';import '/notification-modal-layout.css';
window.PDFLib={PDFDocument};const root=createRoot(document.getElementById('root'));
window.runImport=async(type,count)=>{const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);for(let i=0;i<count;i++){const p=pdf.addPage([595,842]);p.drawText(type==='contrato'?'CONTRATO DE TRABAJO':'PRÓRROGA DEL CONTRATO',{x:50,y:790,size:17,font});p.drawText('Página '+(i+1)+' - Documento original',{x:50,y:760,size:12,font});if(i===(window.signaturePage||count)-1){p.drawText('REPRESENTANTE DE LA EMPRESA',{x:50,y:290,size:10,font});p.drawText('Juan Empresa García',{x:50,y:265,size:12,font});p.drawText('EL TRABAJADOR',{x:350,y:235,size:12,font});p.drawText('María López Ruiz',{x:350,y:205,size:12,font});}}
const original=await pdf.save();window.sourceBase64=bytesToBase64(original);const result=await processManualMandatoryFiles([new File([original],type+'.pdf',{type:'application/pdf'})],{obraHint:'Obra A',obraCandidates:['Obra A']});window.importResult=result;window.saved=null;const anchors=window.imported.workerAnchors.map(a=>({...a,documentWorkerId:'worker-1'}));root.render(<MandatoryPdfAnchorEditor key={type+count} documentId="doc" title={type==='contrato'?'Contrato de trabajo':'Prórroga de contrato'} obra="Obra A" documentType={type} anchors={anchors} onCancel={()=>{}} onSave={a=>{window.saved=a;}} onRemoveWorker={()=>{}}/>);return {result,original:window.sourceBase64,input:window.imported};};
window.openUnrecognizedPdf=async(base64)=>{window.sourceBase64=base64;root.render(<MandatoryPdfAnchorEditor key="unrecognized" documentId="doc" title="Prórroga pendiente de identificar" obra="Obra A" documentType="prorroga" anchors={[]} onCancel={()=>{}} onSave={()=>{}} onRemoveWorker={()=>{}}/>);};\nwindow.signAndVerify=async()=>{const anchors=window.saved;const c=document.createElement('canvas');c.width=200;c.height=70;const x=c.getContext('2d');x.strokeStyle='blue';x.lineWidth=3;x.beginPath();x.moveTo(20,50);x.bezierCurveTo(80,5,30,80,170,20);x.stroke();const signature=c.toDataURL('image/png');const signed=await buildSignedMandatoryPdf({originalPdfBase64:window.sourceBase64,anchors,signatures:{[anchors[0].workerId]:signature}});const fidelity=await verifyMandatoryPdfFidelity(window.sourceBase64,signed,anchors);return {signed:bytesToBase64(signed),fidelity};};
window.generation=0;window.failSave=false;window.saveCalls=0;
window.reopen=(anchors,type='contrato')=>{window.sourceAnchors=structuredClone(anchors);flushSync(()=>root.render(<MandatoryPdfAnchorEditor key={'reopen'+(++window.generation)} documentId="doc" title="Documento de prueba" obra="Obra A" documentType={type} anchors={anchors} onCancel={()=>root.render(null)} onSave={async a=>{window.saveCalls++;if(window.failSave)throw Error('Fallo de conexión de prueba');window.saved=structuredClone(a);}}/>));};
window.loadReal=async(base64,type)=>{window.sourceBase64=base64;const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));window.imported=null;const result=await processManualMandatoryFiles([new File([bytes],type+'.pdf',{type:'application/pdf'})],{obraHint:'Obra A',obraCandidates:['Obra A']});if(!window.imported)throw Error(JSON.stringify(result));window.reopen(window.imported.workerAnchors,type);return {result,input:window.imported};};
window.closeEditor=()=>root.render(null);
`;
const server=await createServer({root,configFile:false,cacheDir:path.join(out,'vite-cache'),optimizeDeps:{include:['react','react-dom/client','pdf-lib']},plugins:[react(),{name:'employment-boundaries',enforce:'pre',resolveId(id){if(id==='tesseract.js'&&process.env.PDF_OCR_LANGUAGE_DIRECTORY)return '\0workspace-ocr';if(/foremanPortalService(?:\.ts)?$/.test(id))return '\0employment-portal';if(/services\/databaseService(?:\.ts)?$/.test(id))return '\0employment-db';if(/services\/appSettingsService(?:\.ts)?$/.test(id))return '\0employment-settings';if(/(?:\/lib\/|\.\/)supabase(?:\.ts)?$/.test(id))return '\0employment-supabase';if(id==='virtual:employment-harness')return '\0employment-harness';},async load(id){if(id==='\0workspace-ocr')return "import Tesseract from '/node_modules/tesseract.js/dist/tesseract.esm.min.js';export const createWorker=(lang)=>Tesseract.createWorker(lang,1,{workerPath:'/ocr-worker.js',corePath:'/ocr-core',langPath:'/ocr-language'});";if(id==='\0employment-portal')return mock;if(id==='\0employment-supabase')return "export const supabase={query:async()=>[],auth:{getSession:async()=>({data:{session:null}})}};";if(id==='\0employment-db')return "export const getDocuments=async()=>[];";if(id==='\0employment-settings')return "export const loadAppBusinessSettings=async()=>({});";if(id==='\0employment-harness')return await transformWithEsbuild(harness,'employment.tsx',{loader:'tsx'});},transform(code,id){if(id==='\0employment-harness')return null;},configureServer(s){s.middlewares.use(async(req,res,next)=>{const url=req.url.split('?')[0];let file;if(url==='/ocr-worker.js')file=path.join(root,'node_modules/tesseract.js/dist/worker.min.js');else if(url.startsWith('/ocr-core/'))file=path.join(root,'node_modules/tesseract.js-core',path.basename(url));else if(url.startsWith('/ocr-language/')&&process.env.PDF_OCR_LANGUAGE_DIRECTORY)file=path.join(process.env.PDF_OCR_LANGUAGE_DIRECTORY,path.basename(url));if(!file)return next();try{res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':file.endsWith('.js')?'application/javascript':'application/octet-stream');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});s.middlewares.use('/tailwind.js',async(_,res)=>{res.setHeader('Content-Type','application/javascript');res.end(tailwind);});s.middlewares.use('/employment-test',async(_,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/employment-test','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><script>tailwind.config={darkMode:"class"}</script></head><body><div id="root"></div><script type="module" src="/@id/virtual:employment-harness"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0}});
let browser;
try {
 await server.listen();const port=server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.SIGNATURE_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({hasTouch:true,viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>{window.activeWorkers=0;const Native=Worker;window.Worker=class extends Native{constructor(...args){super(...args);window.activeWorkers++;this.stopped=false;}terminate(){if(!this.stopped){window.activeWorkers--;this.stopped=true;}return super.terminate();}};});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+port+'/employment-test');await page.waitForFunction(()=>!!window.runImport);
 const waitEditor=async()=>{await page.waitForSelector('.mandatory-pdf-page canvas');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Guardar trabajadores y posiciones'&&!b.disabled));};
 const save=()=>page.getByRole('button',{name:'Guardar trabajadores y posiciones',exact:true}).click();
 await page.evaluate(()=>{window.signaturePage=2;});
 const imported=await page.evaluate(()=>window.runImport('contrato',4));
 assert.equal(imported.input.workerAnchors[0].page,2,'signature may be on an interior page, never assumed last');
 await waitEditor();assert.equal(await page.locator('[data-pdf-page]').count(),4);
 const initial=imported.input.workerAnchors;
 await page.evaluate(a=>window.reopen(a),initial);await waitEditor();
 const scroll=page.locator('.mandatory-continuous-scroll');
 await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight;});await page.waitForTimeout(100);
 assert(await scroll.evaluate(el=>el.scrollTop>0&&el.scrollHeight>el.clientHeight),'vertical continuous scroll');
 await save();assert.deepEqual(await page.evaluate(()=>window.saved),initial,'navigation does not move or confirm a signature');
 await page.getByRole('button',{name:'Ampliar zoom',exact:true}).click({clickCount:3});
 await scroll.evaluate(el=>{el.scrollLeft=el.scrollWidth;});assert(await scroll.evaluate(el=>el.scrollLeft>0),'horizontal scroll after zoom');
 await save();assert.deepEqual(await page.evaluate(()=>window.saved),initial,'zoom and horizontal scroll preserve real PDF coordinates');
 await page.getByRole('button',{name:'Ajustar página',exact:true}).click();
 await page.getByRole('button',{name:'Ajustar al ancho',exact:true}).click();
 // Editing uses visible inputs without the old 160/40 point restrictions.
 await page.getByRole('textbox',{name:'Ancho de firma',exact:true}).fill('230');
 await page.getByRole('textbox',{name:'Alto de firma',exact:true}).fill('70');
 await page.getByRole('textbox',{name:'Alto de firma',exact:true}).blur();
 await page.getByRole('button',{name:'Confirmar zona de firma y trabajador',exact:true}).click();
 await save();const resized=await page.evaluate(()=>window.saved);assert.equal(resized[0].signatureWidth,230);assert.equal(resized[0].signatureHeight,70);
 await page.evaluate(()=>window.reopen(window.saved));await waitEditor();
 assert.equal(await page.getByRole('textbox',{name:'Ancho de firma',exact:true}).inputValue(),'230');
 await page.getByRole('button',{name:'Mover firma',exact:true}).click();
 const box=page.locator('[data-signature-index="0"]');await box.scrollIntoViewIfNeeded();
 let r=await box.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+25,r.y+r.height/2-20,{steps:6});await page.mouse.up();
 await save();const moved=await page.evaluate(()=>window.saved);assert.notEqual(moved[0].signatureX,resized[0].signatureX);assert.notEqual(moved[0].signatureY,resized[0].signatureY);
 const handle=page.getByRole('button',{name:'Redimensionar firma se',exact:true});await handle.scrollIntoViewIfNeeded();r=await handle.boundingBox();
 await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+25,r.y+r.height/2+20,{steps:6});await page.mouse.up();
 await save();let dragged=await page.evaluate(()=>window.saved);assert(dragged[0].signatureWidth>moved[0].signatureWidth);assert(dragged[0].signatureHeight>moved[0].signatureHeight);
 // Save errors keep the draft, and retries preserve exactly the approved dimensions.
 await page.evaluate(()=>{window.failSave=true;});await save();assert(await page.getByRole('alert').count());
 await page.evaluate(()=>{window.failSave=false;});await save();assert.deepEqual(await page.evaluate(()=>window.saved),dragged);

 const once=await page.evaluate(()=>{const before=window.saveCalls;const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Guardar trabajadores y posiciones');b.click();b.click();return {before,after:window.saveCalls};});assert.equal(once.after,once.before+1,'double save invokes the service once');
 await page.setViewportSize({width:820,height:1180});await handle.scrollIntoViewIfNeeded();
 const touchHandle=await handle.boundingBox(),touchSession=await context.newCDPSession(page);
 await touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchHandle.x+touchHandle.width/2,y:touchHandle.y+touchHandle.height/2}]});
 await touchSession.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchHandle.x+touchHandle.width/2-20,y:touchHandle.y+touchHandle.height/2-15}]});
 await touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await save();
 const touchResized=await page.evaluate(()=>window.saved);assert(touchResized[0].signatureWidth<dragged[0].signatureWidth,'touch corner resizes the signature');
 dragged=touchResized;await touchSession.detach();await page.setViewportSize({width:1440,height:1000});
 const signed=await page.evaluate(()=>window.signAndVerify());assert(signed.fidelity.ok,JSON.stringify(signed.fidelity));
 console.log('PASS: continuous 4-page native PDF, interior-page signature, navigation/zoom invariance, oversized dimensions, drag/resize handles, reopen, error/retry and signed PDF fidelity.');
 // Every type uses the same editor. Test real DOM/touch scroll and compact panels.
 for(const type of ['contrato','prorroga','inicio','control_presencia','epis']){
  await page.evaluate(({a,type})=>window.reopen(a,type),{a:dragged,type});await waitEditor();
  await page.getByRole('button',{name:'Ocultar ajustes',exact:true}).click();
  assert.equal(await page.locator('.mandatory-editor-controls').isVisible(),false);
  await page.getByRole('button',{name:'Ocultar herramientas',exact:true}).click();
  assert.equal(await page.locator('.mandatory-continuous-toolbar').count(),0);
  await page.setViewportSize({width:820,height:1180});
  await scroll.evaluate(el=>{el.scrollTop=0;});
  const area=await scroll.boundingBox(),cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:area.x+area.width*.6,y:area.y+area.height*.7}]});
  for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:area.x+area.width*.6,y:area.y+area.height*.7-i*45}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(180);
  assert(await scroll.evaluate(el=>el.scrollTop>0),'touch scroll '+type);
  await save();assert.deepEqual(await page.evaluate(()=>window.saved),dragged,'touch navigation leaves signature unchanged '+type);
  await cdp.detach();await page.setViewportSize({width:1440,height:1000});
 }
 console.log('PASS: same viewer for contract/extension/start/attendance/EPIs; tablet touch navigation, collapsible controls and unchanged saved signatures.');
 for(const [type,envName,count,signaturePage] of [['contrato','PDF_REAL_CONTRACT',3,3],['prorroga','PDF_REAL_EXTENSION',1,1]]){
  const file=process.env[envName];if(!file)continue;
  const bytes=await fs.readFile(file),original=bytes.toString('base64');
  const real=await page.evaluate(({original,type})=>window.loadReal(original,type),{original,type});
  assert.equal(real.result.importedDocuments,1);assert.equal(real.input.sourcePdfBase64,original);assert.equal(real.input.pageMeta.length,count);
  assert.equal(real.input.workerAnchors.length,1,'unique identity from real scanned form');
  const anchor=real.input.workerAnchors[0];assert.equal(anchor.page,signaturePage);assert(anchor.signatureX!=null&&anchor.signatureY!=null,'actual Spanish OCR finds the signing label');assert(anchor.signatureX<250,'worker column, not company');assert.equal(anchor.resolved,false);
  const expected=JSON.parse(process.env.PDF_EXPECTED_WORKER_NAMES||'{}')[type];if(expected)assert.equal(anchor.workerName.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z]/g,'').toUpperCase(),expected.replace(/[^A-Za-z]/g,'').toUpperCase());
  await waitEditor();await page.getByRole('button',{name:'Confirmar zona de firma y trabajador',exact:true}).click();await save();
  const result=await page.evaluate(()=>window.signAndVerify());assert(result.fidelity.ok,JSON.stringify(result.fidelity));
  assert.equal(await page.evaluate(()=>window.sourceBase64),original);
  await fs.writeFile(path.join(out,type+'-real-signed.pdf'),Buffer.from(result.signed,'base64'));
  await page.screenshot({path:path.join(out,type+'-real-editor.png')});
  console.log('PASS: real scanned '+type+', actual Spanish OCR, correct worker/signing column, original bytes/pages retained and signed PDF fidelity.');
 }
 await page.evaluate(()=>window.closeEditor());await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>window.activeWorkers),0,'closing releases all PDF/OCR workers');
 assert.deepEqual(errors,[]);console.log('Evidence:',out);
}finally{await browser?.close();await server.close();}
