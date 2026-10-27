import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = new URL('../', import.meta.url).pathname;
const bundle = (await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import QRCode from 'qrcode';import Scanner from './components/WorkerCardScanner';
const token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const canvas=document.createElement('canvas');document.body.append(canvas);canvas.style.display='none';
await QRCode.toCanvas(canvas, location.origin+'/?worker-qr='+token,{width:400,margin:2});
const snapshot=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);setInterval(()=>canvas.getContext('2d').putImageData(snapshot,0,0),100);
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>canvas.captureStream(10)});
createRoot(document.getElementById('root')).render(<Scanner onClose={()=>window.testClosed=true} onFound={id=>{window.found=id;return true}}/>);`,loader:'tsx',resolveDir:root},bundle:true,format:'esm',platform:'browser',write:false,plugins:[{name:'stub',setup(b){b.onResolve({filter:/workerQrShareService$/},()=>({path:'stub',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:`export async function resolveWorkerCardOwner(token){window.calls=(window.calls||0)+1;return token==='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'?42:null}`}));}}]})).outputFiles[0].text;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle:'<meta name="viewport" content="width=device-width"><div id="root"></div><script type="module" src="/app.js"></script>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 try { await page.waitForFunction(()=>window.testClosed===true, null, {timeout:8000}); } catch(e) { console.error('STATUS:', await page.locator('body').innerText()); throw e; }
 assert.equal(await page.evaluate(()=>window.found),42);
 assert.equal(await page.evaluate(()=>window.calls),1);
 console.log('PASS: camera stream QR decoding opens the authorized worker with one request.');
} finally {await browser?.close();await new Promise(r=>server.close(r));}
