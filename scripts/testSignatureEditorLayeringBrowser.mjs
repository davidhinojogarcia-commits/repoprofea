import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Real editor, portal and application CSS. Only PDF transport/rendering and the
// database are stubbed: this test targets layout/hit-testing, not PDF fidelity.
const root = new URL('../', import.meta.url).pathname;
const out = await fs.mkdtemp(path.join(os.tmpdir(), 'signature-layering-'));
const tailwind = process.env.SIGNATURE_TAILWIND_SCRIPT
  ? await fs.readFile(process.env.SIGNATURE_TAILWIND_SCRIPT, 'utf8')
  : execFileSync('curl', ['-fsSL', '--max-time', '30', 'https://cdn.tailwindcss.com'], {encoding:'utf8'});
const harness = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import Editor from './components/MandatoryPdfAnchorEditor';
import ModalPortal from './components/ModalPortal';
const root=createRoot(document.getElementById('mount'));
window.saved=null;
window.anchor={workerId:7,workerName:'Persona de prueba',page:1,order:0,nameX:100,nameY:150,rowHeight:20,signatureX:100,signatureY:100,signatureWidth:90,signatureHeight:20,confidence:1,resolved:true};
window.openEditor=()=>root.render(<Editor documentId="test" title="Prórroga · Ajustar firmas" obra="Obra de prueba" documentType="prorroga" anchors={[window.anchor]} onSave={anchors=>{window.saved=anchors;}} onCancel={()=>root.render(null)}/>);
window.openTouchEditor=()=>root.render(<Editor documentId="test" title="Inicio · Ajustar firmas" obra="Obra de prueba" documentType="inicio" anchors={[window.anchor]} onSave={anchors=>{window.saved=anchors;}} onCancel={()=>root.render(null)}/>);
window.openWorkspace=()=>root.render(<ModalPortal label="Modal normal"><div className="bg-white">Modal normal</div></ModalPortal>);
`;
let browser;
try {
  const bundle=await build({stdin:{contents:harness,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',plugins:[{
    name:'layout-boundaries',
    setup(b) {
      b.onResolve({filter:/foremanPortalService$|\/supabase$|mandatoryPdfOverlay$|^pdfjs-dist\/|^lucide-react$/}, args=>({path:args.path,namespace:'layout-mock'}));
      b.onLoad({filter:/.*/,namespace:'layout-mock'}, ({path:p})=>{
        if(p.includes('foremanPortalService'))return {contents:'export const loadForemanSignatureTemplate=async()=>null;export const getSupervisorMandatoryPdf=async()=>({base64:"JVBERg=="});'};
        if(p.endsWith('/supabase'))return {contents:'export const supabase={query:async()=>[]};'};
        if(p.endsWith('mandatoryPdfOverlay'))return {contents:'export const base64ToBytes=()=>new Uint8Array();'};
        if(p==='lucide-react')return {contents:'export const Trash2=()=>null;'};
        if(p.includes('?url'))return {contents:'export default "mock-worker";'};
        return {contents:`export const GlobalWorkerOptions={};export const getDocument=()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({view:[0,0,595,842],getViewport:({scale})=>({width:595*scale,height:842*scale,transform:[scale,0,0,-scale,0,842*scale],viewBox:[0,0,595,842]}),render:({canvasContext,viewport})=>{canvasContext.fillStyle="white";canvasContext.fillRect(0,0,viewport.width,viewport.height);return {promise:Promise.resolve(),cancel(){}};}})})});`};
      });
    }
  }]});
  const styles=await Promise.all(['index.css','notification-modal-layout.css'].map(p=>fs.readFile(path.join(root,p),'utf8')));
  browser=await chromium.launch({executablePath:process.env.SIGNATURE_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<html><head><script>'+tailwind+'</script><script>tailwind.config={darkMode:"class"}</script><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"><aside class="app-navigation-panel fixed top-0 left-0 h-screen lg:w-20" style="width:80px;background:#eee"><button>Menú</button></aside><button id="launch">Abrir editor</button></div><div id="mount"></div></body></html>');
  for(const content of styles)await page.addStyleTag({content});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const sizes=[[1536,1152],[1366,1024],[1024,768],[820,1180],[390,844],[844,390]];
  for(const [width,height] of sizes)for(const expanded of [false,true])for(const dark of [false,true]){
    await page.setViewportSize({width,height});
    await page.evaluate(({expanded,dark})=>{
      document.documentElement.classList.toggle('dark',dark);
      const sidebar=document.querySelector('aside.app-navigation-panel');
      sidebar.classList.toggle('lg:w-64',expanded);sidebar.classList.toggle('lg:w-20',!expanded);
      sidebar.style.width=expanded?'256px':'80px';
      document.getElementById('launch').focus();window.openEditor();
    },{expanded,dark});
    const save=page.getByRole('button',{name:'Guardar trabajadores y posiciones',exact:true});
    await save.waitFor();await save.isEnabled().then(async enabled=>{if(!enabled)await page.waitForFunction(()=>!document.querySelector('.mandatory-editor-footer button:last-child').disabled);});
    if(width===1536&&!expanded&&!dark){
      await page.getByRole('button',{name:'Mover firma',exact:true}).click();
      await page.locator('.mandatory-pdf-resize-handle').first().waitFor();
      assert.equal(await page.locator('.mandatory-pdf-resize-handle').first().evaluate(el=>getComputedStyle(el).width),'26px','desktop vertex size must remain exactly 26px');
      assert(!await page.locator('.mandatory-editor-phone-selection-bar').isVisible(),'desktop must not show phone navigation');
      assert(!await page.locator('.mandatory-pdf-phone-navigate').isVisible(),'desktop toolbar unchanged');
    }
    await page.locator('.mandatory-editor-controls select').scrollIntoViewIfNeeded();
    const metrics=await page.evaluate(()=>{
      const overlay=document.querySelector('.profea-modal-overlay');
      const controls=document.querySelector('.mandatory-editor-controls');
      const close=[...document.querySelectorAll('button')].find(b=>b.textContent==='Cerrar');
      const save=document.querySelector('.mandatory-editor-footer button:last-child');
      const hit=el=>{const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return el===top||el.contains(top);};
      const rect=overlay.getBoundingClientRect();
      return {left:rect.left,top:rect.top,width:rect.width,height:rect.height,
        layer:Number(getComputedStyle(overlay).zIndex),sidebarLayer:Number(getComputedStyle(document.querySelector('aside.app-navigation-panel')).zIndex),
        close:hit(close),save:hit(save),controls:hit(controls.querySelector('select')),
        right:save.getBoundingClientRect().right,bottom:save.getBoundingClientRect().bottom,
        overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.deepEqual([metrics.left,metrics.top,metrics.width,metrics.height],[0,0,width,height]);
    assert(metrics.layer>metrics.sidebarLayer,'editor must paint above navigation');
    assert(metrics.close&&metrics.save&&metrics.controls,'navigation must not intercept editor controls');
    assert(metrics.right<=width&&metrics.bottom<=height,'actions must remain inside the viewport');
    assert(!metrics.overflow,'no horizontal document overflow');
    await save.click();
    assert.deepEqual(await page.evaluate(()=>window.saved),[await page.evaluate(()=>window.anchor)],'opening/saving must preserve identities and coordinates');
    await page.getByRole('button',{name:'Cerrar',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.profea-modal-overlay'));
    assert.equal(await page.evaluate(()=>document.activeElement.id),'launch');
  }
  // Existing workspace dialogs retain their default inset geometry.
  await page.setViewportSize({width:1366,height:1024});
  await page.evaluate(()=>window.openWorkspace());
  await page.waitForSelector('[data-modal-layout="workspace"]');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.profea-modal-overlay')).position==='fixed');
  assert(await page.locator('.profea-modal-overlay').evaluate(el=>el.getBoundingClientRect().left>80));
  // Phone/tablet touchscreen regression: add an omitted worker, position the
  // signature by touch and adjust it without requiring numeric PDF coordinates.
  const touch=await browser.newPage({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
  touch.on('pageerror',e=>errors.push(e.message));
  await touch.setContent('<html><head><script>'+tailwind+'</script><script>tailwind.config={darkMode:"class"}</script><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="mount"></div></body></html>');
  // about:blank in Playwright is not always a secure context, whereas the
  // installed PWA runs on HTTPS and exposes crypto.randomUUID().
  // Preserve a deterministic UUID generator for this synthetic browser fixture.
  await touch.evaluate(()=>{
    if(typeof crypto.randomUUID!=='function')Object.defineProperty(crypto,'randomUUID',{
      configurable:true,value:()=> '10000000-0000-4000-8000-000000000777'
    });
  });
  for(const content of styles)await touch.addStyleTag({content});
  await touch.addScriptTag({content:bundle.outputFiles[0].text});
  await touch.evaluate(()=>window.openTouchEditor());
  await touch.locator('.mandatory-editor-controls').waitFor();
  assert(await touch.evaluate(()=>matchMedia('(pointer:coarse)').matches),'touch media query is enabled');
  assert(await touch.locator('.mandatory-editor-controls').isVisible(),'phone opens the worker selection panel');
  assert(!await touch.locator('.mandatory-editor-preview').isVisible(),'phone avoids simultaneous cramped panels');
  // Loading the one-page PDF fixture is async; do not create a worker while the editor is still loading.
  await touch.locator('.mandatory-pdf-touch-mode').waitFor({state:'attached'});
  await touch.getByPlaceholder('Nombre y apellidos exactamente como aparecen en el PDF').fill('Trabajador prueba tactil');
  await touch.getByRole('button',{name:'Añadir trabajador del PDF'}).click();
  await touch.waitForTimeout(250);
  await touch.evaluate(e=>{window.__touchErrors=e;},errors);
  const touchState=await touch.evaluate(()=>({
    panel:document.querySelector('.mandatory-anchor-editor')?.getAttribute('data-mobile-panel'),
    preview:getComputedStyle(document.querySelector('.mandatory-editor-preview')).display,
    touchModeButtons:[...document.querySelectorAll('.mandatory-pdf-touch-mode')].map(b=>({pressed:b.getAttribute('aria-pressed'),display:getComputedStyle(b).display,visible:b.getBoundingClientRect().width>0})),
    hasAddedWorker:document.body.textContent.includes('Trabajador prueba tactil'),
    pointerCoarse:matchMedia('(pointer:coarse)').matches,
    viewport:innerWidth,
    loading:document.body.textContent.includes('Abriendo PDF original'),
    error:document.querySelector('.mandatory-editor-footer [role="alert"]')?.textContent||null,
    pageErrors:window.__touchErrors||[],
    errors:[...document.querySelectorAll('.mandatory-editor-controls .text-rose-800, .mandatory-editor-controls [role="alert"]')].map(e=>e.textContent),
    workerInput:document.querySelector('input[placeholder="Nombre y apellidos exactamente como aparecen en el PDF"]')?.value,
    addDisabled:[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Añadir trabajador del PDF'))?.disabled,
    currentButtons:[...document.querySelectorAll('.mandatory-editor-mobile-tabs button')].map(b=>({text:b.textContent,pressed:b.getAttribute('aria-pressed')}))
  }));
  console.log('Touch placement diagnostic',JSON.stringify(touchState));
  assert.equal(touchState.panel,'pdf','adding an omitted worker must switch to PDF panel automatically');
  assert.equal(touchState.hasAddedWorker,true,'new worker must appear in editor');
  await touch.locator('.mandatory-pdf-touch-mode[aria-pressed="true"]').waitFor({timeout:5000});
  assert(await touch.locator('.mandatory-editor-preview').isVisible(),'adding a worker opens PDF placement in edit mode');
  const phone=await touch.evaluate(()=>({
    preview:document.querySelector('.mandatory-editor-preview').getBoundingClientRect().height,
    main:document.querySelector('.mandatory-editor-main').getBoundingClientRect().height,
    screen:innerHeight,
    tools:document.querySelector('.mandatory-continuous-toolbar'),
    selection:getComputedStyle(document.querySelector('.mandatory-editor-phone-selection-bar')).display,
    pane:document.querySelector('.mandatory-anchor-editor')?.dataset.mobilePanel,
  }));
  assert.equal(phone.pane,'pdf');
  assert.equal(phone.selection,'flex','mobile PDF provides compact worker navigation');
  assert(phone.preview>=phone.main-2&&phone.preview>phone.screen*.7,'PDF occupies the entire editor main area on phones');
  assert.equal(phone.tools,null,'zoom tools start collapsed on phones');
  await touch.getByRole('button',{name:'Zoom y páginas'}).click();
  assert(await touch.locator('.mandatory-continuous-toolbar').isVisible(),'zoom options are available on demand');
  await touch.getByRole('button',{name:'Zoom y páginas'}).click();
  await touch.waitForFunction(()=>document.querySelector('.mandatory-pdf-page canvas')?.getBoundingClientRect().width>150);
  await touch.getByRole('button',{name:'Desplazar PDF'}).click();
  await touch.locator('.mandatory-pdf-page canvas').tap({position:{x:70,y:70}});
  assert.equal(await touch.locator('[data-signature-index="1"]').count(),0,'navigating cannot accidentally place a signature');
  await touch.getByRole('button',{name:'Colocar firma'}).click();
  await touch.locator('.mandatory-pdf-page canvas').tap({position:{x:70,y:70}});
  await touch.locator('[data-signature-index="1"]').waitFor();
  const markers=await touch.evaluate(()=>{
    const box=document.querySelector('[data-signature-index="1"]');
    const handle=box.querySelector('.mandatory-pdf-resize-handle.se');
    return {
      handle:parseFloat(getComputedStyle(handle).width),
      dot:parseFloat(getComputedStyle(handle,'::after').width),
      corners:box.querySelectorAll('.mandatory-pdf-phone-corner').length,
      top:box.getBoundingClientRect().top,
    };
  });
  assert.equal(markers.handle,28,'phone resize hit target is compact');
  assert.equal(markers.dot,8,'phone vertex visual is eight pixels');
  assert.equal(markers.corners,3,'all four corners are identifiable without huge dots');
  await touch.getByRole('button',{name:'Seleccionar firma anterior'}).click();
  assert.match(await touch.locator('.mandatory-editor-phone-selection-bar span').innerText(),/^1 de 2/);
  await touch.getByRole('button',{name:'Seleccionar firma siguiente'}).click();
  assert.match(await touch.locator('.mandatory-editor-phone-selection-bar span').innerText(),/^2 de 2/);
  const before=await touch.locator('[data-signature-index="1"]').evaluate(el=>Number.parseFloat(el.style.left));
  await touch.getByRole('button',{name:'Mover firma a la derecha'}).click();
  await touch.waitForFunction(before=>Number.parseFloat(document.querySelector('[data-signature-index="1"]').style.left)>before,before);
  await touch.getByRole('button',{name:'Trabajador y ajustes'}).click();
  assert(await touch.locator('.mandatory-editor-controls').isVisible(),'worker list remains accessible after placement');
  assert(await touch.getByRole('searchbox',{name:'Buscar trabajador por nombre o DNI'}).isVisible(),'mobile worker lookup must be searchable');
  await touch.setViewportSize({width:820,height:1180});
  assert(await touch.locator('.mandatory-editor-mobile-tabs').isVisible(),'tablet retains full-width touch panels');
  await touch.getByRole('button',{name:'PDF y posición de firma'}).click();
  assert(await touch.locator('.mandatory-editor-preview').isVisible(),'tablet can edit the PDF without narrow split panes');
  await touch.setViewportSize({width:1366,height:1024});
  assert(await touch.locator('.mandatory-editor-mobile-tabs').isVisible(),'large landscape iPad must remain in tablet mode');
  await touch.setViewportSize({width:844,height:390});
  assert(await touch.locator('.mandatory-editor-preview').isVisible(),'landscape touch remains in PDF editor');
  assert(await touch.getByRole('button',{name:'Desplazar PDF'}).isVisible(),'phone landscape uses the compact full-screen placement controls');
  assert(!await touch.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'no horizontal overflow on touch');
  await touch.getByRole('button',{name:'Guardar trabajadores y posiciones'}).click();
  await touch.waitForFunction(()=>window.saved?.length===2);
  assert.equal((await touch.evaluate(()=>window.saved))[1].workerName,'Trabajador prueba tactil');
  await touch.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: unchanged desktop controls/26px handles; phone PDF fills the editor, separate pan/place modes, 8px visible vertices, compact resize hit target, zoom overlay, worker stepper, tablet/landscape navigation and 2pt precision nudging.');
} finally {
  await browser?.close();
  await fs.rm(out,{recursive:true,force:true});
}
