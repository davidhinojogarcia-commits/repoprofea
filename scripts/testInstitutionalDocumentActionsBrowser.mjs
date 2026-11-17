import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, webkit } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const server=await createServer({root,configFile:false,plugins:[
 react(),
 {name:'document-action-test-page',configureServer(server){
    server.middlewares.use('/__document-actions',async (_req,res)=>{
      res.setHeader('Content-Type','text/html; charset=utf-8');
      const html='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/documentActionsHarness.tsx"></script></body></html>';
      res.end(await server.transformIndexHtml('/__document-actions',html));
    });
 }}
],server:{host:'127.0.0.1',port:0},logLevel:'error'});
await server.listen();
const addr=server.httpServer.address();
const url='http://127.0.0.1:'+addr.port+'/__document-actions';
let runs=0;
try{
  for(const [name,browserType] of [['Chromium',chromium],['WebKit',webkit]]){
    const browser=await browserType.launch({headless:true,args:name==='Chromium'?['--no-sandbox']:[]});
    try{
      const page=await browser.newPage({viewport:{width:390,height:844}});
      const errors=[];
      page.on('pageerror',e=>errors.push('JS: '+e.message));
      page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
      page.on('response',res=>{if(res.status()>=400)errors.push('HTTP '+res.status()+' '+res.url());});
      await page.goto(url);
      try { await page.locator('.profea-institutional-document-actions').waitFor({timeout:15000}); }
      catch (error) { throw new Error(name+' mount failed. Browser errors: '+JSON.stringify(errors)+'; page: '+(await page.locator('body').innerText()).slice(0,1400)+'; html: '+(await page.content()).slice(0,1400),{cause:error}); }
      const toggle=page.getByRole('button',{name:'Más acciones'});
      assert.equal(await toggle.isVisible(),true,name+' mobile toggle visible');
      assert.equal(await page.getByRole('button',{name:'Marcar revisado'}).isVisible(),true);
      assert.equal(await page.getByRole('button',{name:'PDF'}).isVisible(),false,'Secondary hidden by default');
      assert.equal(await toggle.getAttribute('aria-expanded'),'false');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'),'true');
      const actions=page.locator('.profea-institutional-document-actions button:visible');
      const sizes=await actions.evaluateAll(els=>els.map(el=>{
        const rect=el.getBoundingClientRect();
        const style=getComputedStyle(el);
        return {width:rect.width,height:rect.height,radius:style.borderRadius,fontSize:style.fontSize,fontWeight:style.fontWeight};
      }));
      for(const size of sizes){
        assert(size.height>=44,name+' action too short: '+JSON.stringify(size));
        assert(size.width>0,name+' zero width');
        assert.equal(size.radius,'12px',name+' mismatched radius');
        assert.equal(size.fontSize,'14px',name+' mismatched type');
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' mobile overflow');
      await page.getByRole('button',{name:'PDF'}).click();
      assert.equal(await page.locator('#events').textContent(),'pdf');
      assert.equal(await toggle.getAttribute('aria-expanded'),'false','Action should close dropdown');
      await toggle.click();
      await page.getByRole('button',{name:'Editar'}).focus();
      await page.keyboard.press('Escape');
      assert.equal(await toggle.getAttribute('aria-expanded'),'false','Escape must close');
      assert.equal(await toggle.evaluate(el=>el===document.activeElement),true,'Escape must return focus to trigger');
      await toggle.click();
      assert.equal(await page.getByRole('button',{name:'No autorizado'}).isDisabled(),true);
      await page.setViewportSize({width:1440,height:900});
      assert.equal(await toggle.isVisible(),false,name+' desktop hides toggle');
      assert.equal(await page.getByRole('button',{name:'PDF'}).isVisible(),true,name+' desktop exposes secondary');
      const desktop=await page.locator('.profea-institutional-document-actions__secondary-grid button').evaluateAll(els=>els.map(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})));
      assert(desktop.every(x=>x.h>=44&&x.w>0));
      await page.evaluate(()=>document.documentElement.classList.add('dark'));
      assert.equal(await page.getByRole('button',{name:'PDF'}).isVisible(),true);
      assert.deepEqual(errors,[],name+' browser JS errors');
      runs++;
      await page.close();
    }finally{await browser.close();}
  }
  const source=await fs.readFile(path.join(root,'components/ForemanDocumentsDashboard.tsx'),'utf8');
  for(const method of ['openPdf(card)','editAnyDocument(card)','deleteGenericItem(card)','sendCompletedMandatory(card.item as DbMandatory)','returnForCorrection(','setSignatureSettings(card)','markReviewed(']){
    assert(source.includes(method),'Document action missing after refactor: '+method);
  }
  assert(source.includes('<InstitutionalDocumentActions'),'Shared component must be wired to real document card');
  console.log('PASS: institutional documentary actions, '+runs+' engines, mobile/desktop/dark, touch sizing, keyboard Escape, permission-disabled, existing handlers.');
}finally{await server.close();}
