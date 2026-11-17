import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { PDFDocument } from 'pdf-lib';
const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url).pathname;
let browser, server;
const engine = process.env.BROWSER_ENGINE === 'webkit' ? 'webkit' : 'chromium';
let saved = {x: 0, y: 0}, defaultSaved = null, failDefault = false, fail = false;
const writes = [], errors = [];
try {
  const pdf = await PDFDocument.create(); pdf.addPage([595,842]).drawText('SAE prueba pagina 1'); pdf.addPage([595,842]).drawText('SAE prueba pagina 2');
  const bytes = await pdf.save();
  const worker = await fs.readFile(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'));
  const bundle = (await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Preview from './components/SaeReportPreview';
    const root=createRoot(document.getElementById('root'));
    async function open(){const p=await(await fetch('/position')).json();root.render(<Preview title="Informe de prueba" url="/test.pdf" initialX={p.x} initialY={p.y} onPreview={async()=>{}} onSave={async(x,y)=>{const r=await fetch('/position',{method:'POST',body:JSON.stringify({x,y})});if(!r.ok)throw Error('Error de guardado de prueba');}} onSaveDefault={async(x,y)=>{const r=await fetch('/default',{method:'POST',body:JSON.stringify({x,y})});if(!r.ok)throw Error('Error de predeterminado de prueba');}} onClose={()=>root.render(<button onClick={open}>Reabrir</button>)}/>);}open();`,resolveDir:root,loader:'tsx'},bundle:true,format:'iife',platform:'browser',write:false,
    plugins:[{name:'worker-url',setup(b){b.onResolve({filter:/pdf\.worker.*\?url$/},()=>({path:'worker',namespace:'worker'}));b.onLoad({filter:/.*/,namespace:'worker'},()=>({contents:"export default '/worker.mjs'"}));}}]})).outputFiles[0].text;
  server = http.createServer(async(req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle);}
    if(req.url==='/worker.mjs'){res.setHeader('Content-Type','text/javascript');return res.end(worker);}
    if(req.url==='/test.pdf'){res.setHeader('Content-Type','application/pdf');return res.end(Buffer.from(bytes));}
    if(req.url==='/default'){let body='';for await(const c of req)body+=c;if(failDefault){res.statusCode=503;return res.end('failed');}defaultSaved=JSON.parse(body);return res.end('{}');}
    if(req.url==='/position'){
      res.setHeader('Content-Type','application/json');
      if(req.method==='POST'){
        let body='';for await(const c of req)body+=c;const point=JSON.parse(body);
        await new Promise(resolve=>setTimeout(resolve,250));
        if(fail){res.statusCode=503;return res.end('{}');}
        saved=point;writes.push(point);
      }
      return res.end(JSON.stringify(saved));
    }
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}section{display:flex;flex-direction:column;height:94dvh;width:100%}section>div:last-child{flex:1;min-height:0}button,input{min-height:44px}canvas{max-width:none}</style><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await (engine==='webkit'?webkit:chromium).launch({headless:true});
  for(const [width,height] of [[390,844],[820,1180],[1180,820]]){
    saved={x:0,y:0};defaultSaved=null;failDefault=false;fail=false;
    const context=await browser.newContext({viewport:{width,height},hasTouch:true});const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const x=page.getByLabel('Desplazamiento X'),y=page.getByLabel('Desplazamiento Y');
    const ready=async()=>{await page.getByText(/Página [12] de 2/).waitFor();await page.getByText('Preparando página…',{exact:true}).waitFor({state:'hidden'});};
    await page.getByText('Página 1 de 2',{exact:true}).waitFor({timeout:10000});await page.waitForFunction(()=>document.querySelector('canvas')?.width>300);
    await page.getByRole('button',{name:'Página siguiente',exact:true}).click();await page.getByText('Página 2 de 2',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Acercar PDF',exact:true}).click();
    await page.getByRole('button',{name:'Guardar posición',exact:true}).click();
    await page.getByText(/Posición guardada para este informe y como predeterminada/).waitFor();
    assert.deepEqual(defaultSaved,{x:0,y:0},'explicit Save works without coordinate edits');
    const count=writes.length;await x.fill('-');await page.waitForTimeout(650);assert.equal(writes.length,count,'minus alone never writes zero');
    await x.fill('-12,5');await y.fill('-3.25');
    await page.getByText('Posición guardada y verificada',{exact:true}).waitFor();assert.deepEqual(saved,{x:-12.5,y:-3.25});
    assert.deepEqual(defaultSaved,{x:0,y:0},'autosave changes only the current report');
    failDefault=true;await page.getByRole('button',{name:'Guardar posición',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Error de predeterminado'}).waitFor();
    assert.deepEqual(defaultSaved,{x:0,y:0},'failed default save retains previous preference');
    failDefault=false;await page.getByRole('button',{name:'Guardar posición',exact:true}).click();
    await page.getByText(/Posición guardada para este informe y como predeterminada/).waitFor();
    assert.deepEqual(defaultSaved,{x:-12.5,y:-3.25});
    await page.getByRole('button',{name:'Disminuir X',exact:true}).tap();
    await page.waitForTimeout(550); // let the first write start
    await page.getByRole('button',{name:'Disminuir X',exact:true}).tap();
    await page.getByRole('button',{name:'Disminuir Y',exact:true}).tap();
    await page.getByRole('button',{name:'Cerrar',exact:true}).click();
    await page.getByRole('button',{name:'Reabrir',exact:true}).waitFor();assert.deepEqual(saved,{x:-13.5,y:-3.75},'close flushes the last movement in order');
    await page.getByRole('button',{name:'Reabrir',exact:true}).click();await ready();assert.equal(await x.inputValue(),'-13.5');
    await page.reload();await ready();await x.waitFor();assert.equal(await x.inputValue(),'-13.5');assert.equal(await y.inputValue(),'-3.75');
    fail=true;await x.fill('-20');await page.getByRole('alert').filter({hasText:'Error de guardado'}).waitFor();
    await page.getByRole('button',{name:'Cerrar',exact:true}).click();await page.getByRole('dialog').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Cerrar'&&!b.disabled));assert.equal(saved.x,-13.5);
    fail=false;await page.getByRole('button',{name:'Guardar posición',exact:true}).click();await page.getByText(/Posición guardada para este informe y como predeterminada/).waitFor();assert.equal(saved.x,-20);
    await ready();
    await page.getByRole('button',{name:'Cerrar',exact:true}).click();await page.getByRole('button',{name:'Reabrir',exact:true}).waitFor();
    await context.close();
  }
  assert.deepEqual(errors,[]);console.log(`PASS SAE preview ${engine}: PDF canvas/pages/zoom, signed decimals, touch, serialized last movement, autosave, close/reopen/reload and failed-save retry at phone/tablet portrait/landscape sizes.`);
} finally {await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());}
