import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
const root = new URL('../', import.meta.url).pathname;
const engine = process.env.BROWSER_ENGINE === 'webkit' ? 'webkit' : 'chromium';
const bundle = (await build({stdin:{contents:`
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import QRCode from'qrcode';import jsQR from'jsqr';import Scanner from'./components/WorkerCardScanner';
const token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const params=new URLSearchParams(location.search);
const valid=location.origin+'/?worker-qr='+token+'&format=carne-profea-impreso';
const frame=document.createElement('canvas');frame.width=3840;frame.height=2160;
const qr=document.createElement('canvas');let content=valid;
async function paint(value=content){content=value;await QRCode.toCanvas(qr,content,{width:220,margin:4});const ctx=frame.getContext('2d');ctx.fillStyle='#cbd5e1';ctx.fillRect(0,0,frame.width,frame.height);ctx.fillStyle='#fff';ctx.fillRect(1500,750,840,660);ctx.drawImage(qr,1810,970);}
await paint(params.has('invalid')?'https://foreign.example/?worker-qr='+token:valid);
const old=document.createElement('canvas');old.width=960;old.height=540;old.getContext('2d').drawImage(frame,0,0,960,540);const px=old.getContext('2d').getImageData(0,0,960,540);window.oldDecoded=!!jsQR(px.data,960,540,{inversionAttempts:'attemptBoth'});
window.photo=frame.toDataURL('image/png');window.valid=valid;window.changeQr=paint;window.opens=0;window.stops=0;
setInterval(()=>void paint(),200);
if(!navigator.mediaDevices)Object.defineProperty(navigator,'mediaDevices',{value:{}});
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async constraints=>{window.opens++;window.constraints=constraints;if(params.has('photo'))throw new DOMException('denied','NotAllowedError');const stream=frame.captureStream(5);for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{window.stops++;stop();};}return stream;}});
try{delete window.BarcodeDetector;}catch{}
if(params.has('native'))window.BarcodeDetector=class{async detect(){if(params.get('native')==='broken')throw Error('unsupported source');return[{rawValue:content}];}};
if(params.has('transient')){const original=CanvasRenderingContext2D.prototype.getImageData;let fail=true;CanvasRenderingContext2D.prototype.getImageData=function(...args){if(fail&&this.canvas!==frame&&this.canvas!==qr&&this.canvas!==old){fail=false;window.frameFailed=true;throw Error('frame unavailable');}return original.apply(this,args);};}
function App(){const[tick,setTick]=useState(0);useEffect(()=>{const t=setInterval(()=>setTick(n=>n+1),100);return()=>clearInterval(t);},[]);return <Scanner onClose={()=>window.testClosed=true} onFound={id=>{window.found=id;return true;}} onRemoteToken={params.has('remote')?async value=>{window.sent=(window.sent||[]).concat(value);return true;}:undefined}/>;}
createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:root},bundle:true,format:'esm',platform:'browser',write:false,plugins:[{name:'authenticated-owner-boundary',setup(b){b.onResolve({filter:/workerQrShareService$/},()=>({path:'owner',namespace:'owner'}));b.onLoad({filter:/.*/,namespace:'owner'},()=>({contents:`export async function resolveWorkerCardOwner(token){window.calls=(window.calls||0)+1;await new Promise(r=>setTimeout(r,60));return token==='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'?42:null}`}));}}]})).outputFiles[0].text;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle:'<meta name="viewport" content="width=device-width"><style>video{width:100%;max-height:40vh}section{max-width:500px}</style><div id="root"></div><script type="module" src="/app.js"></script>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
const errors=[];
try {
 browser=await (engine==='webkit'?webkit:chromium).launch({headless:true});
 const base=`http://127.0.0.1:${server.address().port}/`;
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('pageerror',e=>errors.push(e.message));
 // Force an already queued file-change event past disabled UI controls.
 // The scanner's own latch must reject it too, not just the button.
 const injectPhoto = () => page.evaluate(async()=>{
  const blob=await(await fetch(window.photo)).blob();
  const data=new DataTransfer();data.items.add(new File([blob],'carnet.png',{type:'image/png'}));
  const input=document.querySelector('input[type=file]');input.files=data.files;
  input.dispatchEvent(new Event('change',{bubbles:true}));
 });
 const assertPhotoLocked = async () => {
  assert.equal(await page.getByRole('button',{name:'Leer una foto del QR',exact:true}).isDisabled(),true);
  assert.equal(await page.getByLabel('Imagen del código QR',{exact:true}).isDisabled(),true);
  await injectPhoto();
  await page.waitForTimeout(700);
 };
 if(engine==='chromium'){
  for(const query of ['', '?native=broken&transient=1', '?native=working']){
   await page.goto(base+query);
   await page.waitForFunction(()=>window.testClosed===true,null,{timeout:15000});
   assert.equal(await page.evaluate(()=>window.oldDecoded),false,'Fixture reproduces unreadable small QR after old 960px reduction');
   assert.equal(await page.evaluate(()=>window.found),42);
   assert.equal(await page.evaluate(()=>window.calls),1,'Only one authorized lookup');
   assert.equal(await page.evaluate(()=>window.opens),1,'Parent rerenders do not restart the camera');
   assert.ok(await page.evaluate(()=>window.stops>=1),'Camera stops after recognition');
   assert.equal(await page.evaluate(()=>window.constraints.video.width.ideal),1920);
   if(query.includes('transient'))assert.equal(await page.evaluate(()=>window.frameFailed),true);
  }
  await page.goto(base+'?invalid=1');
  await page.getByRole('status').filter({hasText:'QR leído, pero no corresponde'}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls||0),0,'Foreign QR cannot trigger lookup');
  await page.evaluate(()=>window.changeQr(window.valid));
  await page.waitForFunction(()=>window.testClosed===true);
  assert.equal(await page.evaluate(()=>window.calls),1);
  await page.goto(base+'?remote=1');
  await page.getByRole('status').filter({hasText:'Carnet enviado al ordenador'}).waitFor();
  assert.equal(await page.evaluate(()=>window.sent.length),1);
  assert.equal(await page.evaluate(()=>window.calls||0),0,'Paired mobile uses its authenticated pairing transport');
  await assertPhotoLocked();
  assert.equal(await page.evaluate(()=>window.sent.length),1,'Camera then photo cannot send a duplicate without retry');
  await page.getByRole('button',{name:'Reintentar',exact:true}).click();
  await page.waitForFunction(()=>window.sent?.length===2);
  assert.equal(await page.evaluate(()=>window.opens),2,'Only explicit retry reopens the camera');
 }
 await page.goto(base+'?photo=1');
 await page.getByRole('status').filter({hasText:'No se ha podido abrir la cámara'}).waitFor();
 const png=Buffer.from((await page.evaluate(()=>window.photo)).split(',')[1],'base64');
 await page.getByLabel('Imagen del código QR',{exact:true}).setInputFiles({name:'carnet.png',mimeType:'image/png',buffer:png});
 await page.waitForFunction(()=>window.testClosed===true,null,{timeout:15000});
 assert.equal(await page.evaluate(()=>window.found),42);
 assert.equal(await page.evaluate(()=>window.calls),1);
 await assertPhotoLocked();
 assert.equal(await page.evaluate(()=>window.calls),1,'Photo then photo cannot repeat the owner lookup');
 await page.goto(base+'?photo=1&remote=1');
 await page.getByRole('status').filter({hasText:'No se ha podido abrir la cámara'}).waitFor();
 await injectPhoto();
 await page.getByRole('status').filter({hasText:'Carnet enviado al ordenador'}).waitFor();
 await assertPhotoLocked();
 assert.equal(await page.evaluate(()=>window.sent.length),1,'Photo then photo cannot resend to the computer');
 await page.getByRole('button',{name:'Reintentar',exact:true}).click();
 await page.getByRole('status').filter({hasText:'No se ha podido abrir la cámara'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Leer una foto del QR',exact:true}).isEnabled(),true);
 await injectPhoto();
 await page.waitForFunction(()=>window.sent?.length===2);
 assert.equal(await page.evaluate(()=>window.opens),2,'Explicit retry resets both camera and photo latch');
 assert.deepEqual(errors,[],'No unhandled decoder/frame errors');
 console.log(`PASS ${engine}: real dense QR pixels, photo fallback and authenticated lookup; ${engine==='chromium'?'4K video with QR occupying 6% of frame, native and portable decoders, transient frame failure, stable camera across rerenders, foreign URL rejection, mobile pairing and explicit retry':'portable decoder without camera access'}. No physical phone or production writes.`);
} finally {await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
