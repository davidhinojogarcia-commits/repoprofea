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
  assert.deepEqual(errors,[]);
  console.log('PASS: real signature editor/portal; 24 viewport/sidebar/theme cases, control hit-testing, unchanged identity/positions on save, close/focus restoration and default workspace layout.');
} finally {
  await browser?.close();
  await fs.rm(out,{recursive:true,force:true});
}
