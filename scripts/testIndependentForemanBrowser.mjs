import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createServer,transformWithEsbuild} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';
const root=new URL('../',import.meta.url).pathname;
const out=await fs.mkdtemp(path.join(os.tmpdir(),'independent-foreman-browser-'));
const service=await fs.readFile(new URL('../src/services/foremanPortalService.ts',import.meta.url),'utf8');
const exports=[...service.matchAll(/export (?:async )?function (\w+)/g)].map(m=>m[1]);
const mock=exports.map(name=>`export const ${name}=(...args)=>window.testApi.${name}(...args);`).join('\n');
const tailwind=execFileSync('curl',['-fsSL','--max-time','30','https://cdn.tailwindcss.com']);
const productionCss=[...((await fs.readFile(path.join(root,'index.tsx'),'utf8')).matchAll(/import '([^']+\.css)'/g))].map(m=>`import '/${m[1].replace(/^\.\//,'')}';`).join('');
const harness=`${productionCss}import React from 'react';import {createRoot} from 'react-dom/client';import {ForemanMobilePortal} from '/components/ForemanMobilePortal.tsx';import ForemanModelSettings from '/components/ForemanModelSettings.tsx';import ModalPortal from '/components/ModalPortal.tsx';import '/index.css';import {PDFDocument,PDFName,StandardFonts} from 'pdf-lib';import {buildSignedMandatoryPdf,verifyMandatoryPdfFidelity,bytesToBase64} from '/src/lib/mandatoryPdfOverlay.ts';
window.PDFLib={PDFDocument,PDFName};
const layout={templateKey:'epis:fixture',enabled:true,required:true,allPages:true,x:.7,y:.1,width:.2,height:.08,pageRatio:297/210,revision:1};
const date=new Date().toISOString().slice(0,10),month=date.slice(0,7);
window.fixtureTypes=['inicio','control_presencia','contrato','prorroga','epis','formacion','maquinaria'];
const docs=window.fixtureTypes.map((type,i)=>({id:type,workDate:date,periodKey:month,documentType:type,category:'',workers:[{id:7,apellidosNombre:'Persona prueba',categoria:'PEON'}],signatures:{'7':'signed'},status:'pending',lifecycleStatus:'ASSIGNED',assignedAt:date,details:{sourceFilename:type+'.pdf',importedWorkerIds:[7],importedWorkers:[{id:7,apellidosNombre:'Persona prueba'}],workerAnchors:[{workerId:7,workerName:'Persona prueba',resolved:true}],...(['inicio','control_presencia','contrato','prorroga'].includes(type)?{foremanSignatureTemplate:{...layout,templateKey:type+':fixture'}}:{})}}));
let store=JSON.parse(sessionStorage.getItem('signatures')||'{}');window.workerSnapshot=JSON.stringify(docs.map(d=>d.signatures));window.calls=[];
window.testApi={createForemanOperationalDocument:async input=>{docs.push({id:'new-epis',workDate:date,periodKey:month,documentType:'epis',category:'',workers:[{id:7,apellidosNombre:'Persona prueba',categoria:'PEON'}],signatures:{'7':'signed'},status:'pending',details:input.details});return 'new-epis';},resolveForemanPortal:async()=>({valid:true,obra:'Obra A',foremanName:'Encargado prueba',workers:[{id:7,apellidosNombre:'Persona prueba',dni:'',categoria:'PEON',quincena:'PERIODO DE PRUEBA',periodoInicio:month+'-01',periodoFin:month+'-28'}],attendance:[],documents:[],mandatoryDocuments:docs}),getForemanMandatorySignatures:async()=>({'7':'signed'}),getImportedForemanSignature:async(_,id)=>({signed:!!store[id],signature:store[id],signedAt:store[id]?date:null}),signImportedDocumentAsForeman:async(_,id,img)=>{window.calls.push(id);store[id]=img;sessionStorage.setItem('signatures',JSON.stringify(store));return {ok:true};},getAttendanceForemanEvidence:async()=>({layout:{...layout,templateKey:'control_horario:fixture'},signed:!!store.attendance}),saveForemanAttendance:async()=>{},signAttendanceAsForeman:async(_,day,img)=>{store.attendance=img;sessionStorage.setItem('signatures',JSON.stringify(store));},getReusableForemanLayout:async()=>layout};
window.checkOriginalFidelity=async()=>{const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);for(let n=0;n<3;n++){pdf.addPage([595,842]).drawText('Original unchanged '+n,{font,x:40,y:780});}const source=bytesToBase64(await pdf.save());const template={...layout,pageRatio:595/842};const worker={workerId:7,workerName:'Worker',dni:'',page:2,order:0,resolved:true,nameX:30,nameY:500,rowHeight:20,signatureX:300,signatureY:500,signatureWidth:80,signatureHeight:25};const signature=store.epis;const signed=await buildSignedMandatoryPdf({documentType:'epis',originalPdfBase64:source,anchors:[worker],signatures:{'7':signature},foreman:{signature,template}});const masks=[worker,...[1,2,3].map(page=>({...worker,page,workerId:-1,signatureX:template.x*595,signatureY:template.y*842,signatureWidth:template.width*595,signatureHeight:template.height*842}))];return verifyMandatoryPdfFidelity(source,signed,masks);};
window.finishFixtures=async()=>{
 for(const type of ['epis','formacion','maquinaria']){const d=docs.find(d=>d.id===type);d.status='completed';d.signatures={'7':'signed'};}
 const pdf=await PDFDocument.create();pdf.addPage([595,842]).drawText('Stored signed original');window.importedPdf=bytesToBase64(await pdf.save());
 docs.push({id:'stored-contract',workDate:date,documentType:'contrato',workers:[],signatures:{},status:'completed',details:{sourceFilename:'stored-contract.pdf',originalPdfMode:'overlay'}});
 window.pdfCalls=[];window.testApi.getForemanMandatoryPdf=async(_,id,variant)=>{window.pdfCalls.push([id,variant]);if(id!=='stored-contract')throw Error('Native documents have no imported original');return {base64:window.importedPdf,filename:'stored-contract.pdf',variant:window.unsignedFallback?'original':'signed'};};
 window.testApi.getForemanMandatorySignatures=async(_,id)=>({'7':{signature:store[id],signedAt:date}});
 Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.sharedPdf={name:data.files[0].name,base64:bytesToBase64(new Uint8Array(await data.files[0].arrayBuffer()))};}});
};
window.testApi.checkWorkers=()=>JSON.stringify(docs.map(d=>d.signatures))===window.workerSnapshot;
const app=createRoot(document.getElementById('root'));
window.showWorkspaceStack=()=>app.render(<><div style={{position:'fixed',inset:0,background:'#fff'}}>Fondo</div>{['Primera ventana','Segunda ventana'].map(label=><ModalPortal key={label} label={label}><div style={{position:'absolute',inset:0,background:'#fff',display:'grid',placeItems:'center'}}><button>{label}</button></div></ModalPortal>)}</>);
window.showSettings=()=>app.render(<><div style={{position:'fixed',inset:0,background:'#fff'}}>Tarjetas de documentos del supervisor</div><ForemanModelSettings modelKey="epis:fixture" onClose={()=>{}} onSave={async l=>{window.savedLayout=l;}}/></>);app.render(<ForemanMobilePortal token="synthetic-test-only"/>);`;
const server=await createServer({configFile:false,root,cacheDir:path.join(out,'cache'),plugins:[react(),{name:'foreman-browser-fixture',enforce:'pre',resolveId(id){if(id==='virtual:foreman-harness')return '\0foreman-harness';if(id.endsWith('foremanPortalService'))return '\0portal-mock';if(id.endsWith('/lib/supabase'))return '\0supabase-mock';if(id.endsWith('/lib/appDialog'))return '\0dialog-mock';if(id.endsWith('/PreventionSection'))return '\0prevention-mock';},async load(id){if(id==='\0foreman-harness')return (await transformWithEsbuild(harness,'harness.tsx',{loader:'tsx'})).code;if(id==='\0portal-mock')return mock;if(id==='\0supabase-mock')return 'export const supabase={query:async()=>[]};export const getSessionUser=async()=>null;';if(id==='\0dialog-mock')return 'export const appAlert=async message=>{window.lastAlert=message;};export const appConfirm=async()=>true;export const appPrompt=async()=>null;';if(id==='\0prevention-mock')return 'export const PreventionSection=()=>null;';},configureServer(s){s.middlewares.use('/tailwind.js',(_,res)=>{res.setHeader('Content-Type','application/javascript');res.end(tailwind);});s.middlewares.use('/foreman-test',async(_,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/foreman-test','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><script>tailwind.config={darkMode:"class"}</script></head><body><div id="root"></div><script type="module" src="/@id/virtual:foreman-harness"></script></body></html>'));});}}],optimizeDeps:{include:['jspdf','jspdf-autotable','exceljs','qrcode']},server:{host:'127.0.0.1',port:0}});
let browser;
try{
 await server.listen();browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const url='http://127.0.0.1:'+server.httpServer.address().port+'/foreman-test';await page.goto(url);await page.getByRole('button',{name:'Actualizar documentos',exact:true}).waitFor();
 for(const type of ['inicio','control_presencia','contrato','prorroga']){
  await page.getByRole('button').filter({hasText:type+'.pdf'}).click();
  assert.equal(await page.getByRole('button',{name:'Firmar como encargado',exact:true}).count(),0,type+' has no independent signing');
 }
 for(const [tab,type] of [['EPIs','epis'],['Formación','formacion'],['Maquinaria','maquinaria']]){
  await page.getByRole('button',{name:tab,exact:true}).click();await page.getByRole('button').filter({hasText:type+'.pdf'}).click();
  const sign=page.getByRole('button',{name:'Firmar como encargado',exact:true});await sign.waitFor();assert(await page.getByRole('button',{name:'Finalizar y enviar al supervisor',exact:true}).isDisabled(),'missing foreman signature blocks each native document without setup');
  for(const [width,height] of [[390,844],[820,1180],[1440,900]])for(const dark of [false,true]){
   await page.setViewportSize({width,height});await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);await sign.scrollIntoViewIfNeeded();
   const box=await sign.boundingBox();assert(box.width>200&&box.height>=48&&box.x>=0&&box.x+box.width<=width+1,'visible mobile signing target');
   assert(await sign.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'unclipped label');
   await page.getByText('Cargando PDF…',{exact:true}).waitFor({state:'hidden'});
   if(type==='epis')await page.screenshot({path:path.join(out,'epis-'+width+'-'+dark+'.png')});
  }
  await sign.click();const canvas=page.locator('canvas').last();await canvas.waitFor();const box=await canvas.boundingBox();
  await page.mouse.move(box.x+20,box.y+35);await page.mouse.down();await page.mouse.move(box.x+90,box.y+80,{steps:10});await page.mouse.move(box.x+160,box.y+25,{steps:10});await page.mouse.up();
  assert.equal(await canvas.evaluate(el=>el.getContext('2d').strokeStyle),'#164b9b');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.getByText('✓ Firma del encargado guardada',{exact:true}).waitFor();
  assert(await page.evaluate(()=>window.testApi.checkWorkers()),'worker signatures untouched');
 }
 const fidelity=await page.evaluate(()=>window.checkOriginalFidelity());assert.equal(fidelity.ok,true,JSON.stringify(fidelity));
 await page.reload();await page.getByRole('button',{name:'EPIs',exact:true}).click();await page.getByRole('button').filter({hasText:'epis.pdf'}).click();await page.getByRole('button',{name:'Volver a firmar como encargado',exact:true}).waitFor();
 await page.getByRole('combobox',{name:'Añadir quincena o contrato',exact:true}).selectOption('PERIODO DE PRUEBA');
 await page.getByRole('button',{name:/Preparar relación para firmas/}).click();await page.locator('#foreman-signing-new-epis').getByRole('button',{name:'Firmar como encargado',exact:true}).waitFor();assert(await page.locator('#foreman-signing-new-epis').getByRole('button',{name:'Finalizar y enviar al supervisor',exact:true}).isDisabled(),'new document auto-expands with foreman panel');
 await page.getByRole('button',{name:'Control horario',exact:true}).click();await page.getByRole('button',{name:'Firmar como encargado',exact:true}).waitFor();
 await page.getByRole('button',{name:'Firmar como encargado',exact:true}).click();const attendanceCanvas=page.locator('canvas').last();const ab=await attendanceCanvas.boundingBox();await page.mouse.move(ab.x+20,ab.y+25);await page.mouse.down();await page.mouse.move(ab.x+120,ab.y+70,{steps:10});await page.mouse.up();await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.getByText('Firma guardada y verificada',{exact:true}).waitFor();
 await page.evaluate(()=>{document.getElementById('root').style.cssText='position:relative;z-index:22000';});
 await page.evaluate(()=>window.finishFixtures());await page.getByRole('button',{name:'Finalizados',exact:true}).click();await page.getByRole('button',{name:'Actualizar',exact:true}).click();
 for(const [type,label] of [['epis','Entrega de EPIs'],['formacion','Formación e información'],['maquinaria','Autorización de maquinaria'],['stored-contract','Contrato de trabajo']]){
  const card=page.locator('section > div').filter({has:page.getByText(label,{exact:true})}).filter({has:page.getByRole('button',{name:'Ver PDF',exact:true})});
  await card.getByRole('button',{name:'Ver PDF',exact:true}).click();await page.getByText(label+' · PDF firmado',{exact:true}).waitFor();await page.locator('canvas').first().waitFor();
  for(const [width,height] of [[390,844],[820,1180],[1440,900]])for(const dark of [false,true]){
   await page.setViewportSize({width,height});await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);
  const geometry=await page.locator('.profea-modal-overlay').last().evaluate(el=>{const rect=el.getBoundingClientRect(),canvas=el.querySelector('canvas'),c=canvas.getBoundingClientRect();return {z:Number(getComputedStyle(el).zIndex),x:rect.x,y:rect.y,w:rect.width,h:rect.height,canvasWidth:c.width,canvasVisible:el.contains(document.elementFromPoint(c.x+c.width/2,Math.min(innerHeight-30,c.y+20)))};});
  assert(geometry.z>1000000,'global stylesheet must preserve portal stack layer');assert(geometry.x===0&&geometry.y===0&&geometry.w===width&&geometry.h===height,'PDF viewer occupies viewport');assert(geometry.canvasWidth>=Math.min(850,width-24)&&geometry.canvasVisible,'PDF canvas readable and above background');
   await page.getByText('Cargando PDF…',{exact:true}).waitFor({state:'hidden'});
   if(type==='epis')await page.screenshot({path:path.join(out,'completed-pdf-'+width+'-'+dark+'.png')});
  }
  await page.setViewportSize({width:390,height:844});
  const before=await page.locator('.foreman-pdf-viewer canvas').first().boundingBox();await page.getByRole('button',{name:'Ampliar PDF',exact:true}).click();await page.getByText('150 %',{exact:true}).waitFor();await page.getByText('Cargando PDF…',{exact:true}).waitFor({state:'hidden'});
  const after=await page.locator('.foreman-pdf-viewer canvas').first().boundingBox();assert(after.width>before.width*1.4,'zoom enlarges the PDF');assert(await page.locator('.foreman-pdf-viewer-pages').evaluate(el=>el.scrollWidth>el.clientWidth),'zoomed PDF scrolls horizontally');await page.getByRole('button',{name:'Ajustar a pantalla',exact:true}).click();await page.getByText('100 %',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.evaluate(()=>{window.sharedPdf=null;});await card.getByRole('button',{name:'Compartir',exact:true}).click();await page.waitForFunction(()=>window.sharedPdf);
  const shared=await page.evaluate(async()=>{const pdf=await window.PDFLib.PDFDocument.load(Uint8Array.from(atob(window.sharedPdf.base64),c=>c.charCodeAt(0)));return {...window.sharedPdf,pages:pdf.getPageCount(),images:pdf.context.enumerateIndirectObjects().filter(([,o])=>o.dict?.get?.(window.PDFLib.PDFName.of('Subtype'))?.toString()==='/Image').length};});
  assert(shared.pages>0);assert(shared.name.endsWith('.pdf'));
  if(type==='stored-contract')assert.equal(shared.base64,await page.evaluate(()=>window.importedPdf),'imported signed bytes preserved exactly');else assert(shared.images>=2,'native PDF contains separate worker and foreman images');
 }
 const importedCard=page.locator('section > div').filter({has:page.getByText('Contrato de trabajo',{exact:true})}).filter({has:page.getByRole('button',{name:'Ver PDF',exact:true})});
 await page.evaluate(()=>{window.unsignedFallback=true;});await importedCard.getByRole('button',{name:'Ver PDF',exact:true}).click();await page.waitForFunction(()=>window.lastAlert==='No se ha encontrado el PDF firmado de este documento.');assert.equal(await page.getByRole('button',{name:'Cerrar',exact:true}).count(),0,'unsigned original is never presented as signed');
 assert.deepEqual(await page.evaluate(()=>window.pdfCalls),[['stored-contract','signed'],['stored-contract','signed'],['stored-contract','signed']],'only imported documents use stored PDF RPC');
 await page.evaluate(()=>window.showSettings());await page.getByRole('button',{name:'Cargar plantilla guardada',exact:true}).click();await page.getByLabel('Corresponde firma del encargado').waitFor();
 for(const [width,height] of [[390,844],[820,1180],[1440,900]])for(const dark of [false,true]){
  await page.setViewportSize({width,height});await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);
  const close=page.getByRole('button',{name:'Cerrar',exact:true});await close.scrollIntoViewIfNeeded();
  assert(await close.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'settings actions above supervisor cards');
  await page.screenshot({path:path.join(out,'settings-'+width+'-'+dark+'.png')});
 }
 assert(await page.getByLabel('Corresponde firma del encargado').isChecked());
 await page.getByRole('button',{name:'Guardar plantilla',exact:true}).click();await page.waitForFunction(()=>window.savedLayout?.templateKey==='epis:fixture');
 await page.evaluate(()=>window.showWorkspaceStack());await page.getByRole('button',{name:'Segunda ventana',exact:true}).waitFor();
 const layers=await page.locator('.profea-modal-overlay').evaluateAll(els=>els.map(el=>Number(getComputedStyle(el).zIndex)));assert(layers.length===2&&layers[1]>layers[0]&&layers[0]>1000000,'global CSS preserves increasing workspace stack');
 assert(await page.getByRole('button',{name:'Segunda ventana',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'last workspace modal is above earlier modal and background');
 assert.deepEqual(errors,[]);console.log('PASS: real Chromium portal navigation, 4 exclusions despite stale metadata, 3 operational types, blue canvas capture, separate read-after-write evidence, reload, attendance capture, original PDF raster fidelity, completed native PDF viewing/sharing with both signatures and exact stored contract PDF, model reuse/save and mobile/tablet/desktop light/dark signing controls.');console.log('Screenshots:',out);
}finally{await browser?.close();await server.close();}
