import assert from 'node:assert/strict';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';
import {PDFDocument,PDFName,PDFNumber} from 'pdf-lib';
const engine=process.env.BROWSER_ENGINE==='webkit'?webkit:chromium;
const bundle=(await build({entryPoints:['src/lib/visitAttachmentProcessing.ts'],bundle:true,format:'iife',globalName:'attachments',write:false})).outputFiles[0].text;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html');res.end(req.url==='/test.js'?bundle:'<!doctype html><html><script src="/test.js"></script></html>');});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await engine.launch({headless:true,...(engine===chromium?{args:['--no-sandbox']}:{}),...(process.env.SIGNATURE_BROWSER_EXECUTABLE?{executablePath:process.env.SIGNATURE_BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const result=await page.evaluate(async()=>{
  const {prepareVisitAttachment:prepare,jpegOrientation}=attachments;
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=80;const ctx=canvas.getContext('2d');ctx.fillStyle='#164B9B';ctx.fillRect(0,0,160,80);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9)),small=new File([blob],'small.jpg',{type:'image/jpeg'});
  const a=await prepare(small);check(a.blob===small&&!a.optimized,'small compatible JPEG retains original bytes');check(await prepare(small)===a,'same file is not processed twice');
  const smallPng=new File([await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))],'small.png',{type:'image/png'});check((await prepare(smallPng)).blob===smallPng,'small compatible PNG retains original bytes');
  const original=new Uint8Array(await small.arrayBuffer());
  // Valid little-endian EXIF orientation 6: browsers must decode it before compression.
  const exif=new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
  const oriented=new File([original.slice(0,2),exif,original.slice(2)],'rotated.jpg',{type:'image/jpeg'});check(jpegOrientation(await oriented.arrayBuffer())===6,'orientation metadata detected');
  const rotated=await prepare(oriented),decoded=await createImageBitmap(rotated.blob);check(decoded.width===80&&decoded.height===160,'orientation baked into compressed image exactly once');decoded.close();
  canvas.width=1600;canvas.height=1400;const data=ctx.createImageData(canvas.width,canvas.height);let seed=42;for(let i=0;i<data.data.length;i+=4){for(let k=0;k<3;k++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data.data[i+k]=seed>>>24;}data.data[i+3]=255;}ctx.putImageData(data,0,0);
  const large=new File([await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))],'large.png',{type:'image/png'});check(large.size>1_500_000,'large input scenario');const compressed=await prepare(large);check(compressed.bytes<=1_500_000&&compressed.optimized&&compressed.mime==='image/jpeg','large photo compressed before upload');const image=await createImageBitmap(compressed.blob);check(image.width>=1200,'legible resolution floor retained');image.close();
  const rejects=async(file,pattern)=>{let message='';try{await prepare(file);}catch(e){message=e.message;}check(pattern.test(message),'expected rejection: '+message);};
  await rejects(new File(['bad'],'bad.jpg',{type:'image/jpeg'}),/incompatible|corrupto/);
  await rejects(new File([],'empty.jpg'),/vacío/);
  await rejects(new File([new Uint8Array([0,0,0,24,102,116,121,112,104,101,105,99,0,0,0,0])],'unsupported.heic',{type:'image/heic'}),/HEIC no compatible|no puede leer/);
  await rejects(new File([new Uint8Array(40_000_001)],'huge.jpg'),/40 MB/);
  await rejects(new File([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,0,0,0,0,0])],'corrupt.png'),/dimensiones/);
  const native=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback){callback(null);};await rejects(new File([large],'compression-failure.png',{type:'image/png'}),/comprimir/);HTMLCanvasElement.prototype.toBlob=native;
  canvas.width=canvas.height=1;
  return {originalBytes:large.size,compressedBytes:compressed.bytes,orientation:true,repeatProcessing:false};
 });
 const doc=await PDFDocument.create();doc.addPage([300,400]).drawText('Texto que debe conservarse');const plain=await doc.save();
 const signed=await PDFDocument.create();signed.addPage();signed.context.register(signed.context.obj({Type:PDFName.of('Sig'),ByteRange:[PDFNumber.of(0),PDFNumber.of(1),PDFNumber.of(2),PDFNumber.of(3)]}));const signedBytes=await signed.save();
 const form=await PDFDocument.create();form.addPage();form.getForm().createTextField('campo').setText('Conservar formulario');const formBytes=await form.save();
 const pdfResult=await page.evaluate(async({plain,signed,form})=>{
  const {prepareVisitAttachment:prepare}=attachments;const check=(c,m)=>{if(!c)throw new Error(m);};
  const file=(bytes,name,large=false)=>new File([new Uint8Array(bytes),...(large?[new Uint8Array(1_500_001).fill(32)]:[])],name,{type:'application/pdf'});
  const smallSigned=file(signed,'signed.pdf');check((await prepare(smallSigned)).blob===smallSigned,'small signed PDF byte-preserved');
  for(const [bytes,name]of [[signed,'signed.pdf'],[form,'form.pdf']]){let error='';try{await prepare(file(bytes,name,true));}catch(e){error=e.message;}check(/firmas, formularios o permisos/.test(error),'large signed/form PDF is never rewritten');}
  const optimized=await prepare(file(plain,'unsigned.pdf',true));check(optimized.optimized&&optimized.bytes<1_500_000,'unsigned PDF safely optimized without rasterization');
  return {bytes:Array.from(new Uint8Array(await optimized.blob.arrayBuffer())),size:optimized.bytes};
 },{plain:Array.from(plain),signed:Array.from(signedBytes),form:Array.from(formBytes)});
 assert.equal((await PDFDocument.load(new Uint8Array(pdfResult.bytes))).getPageCount(),1);
 console.log('PASS attachment browser processing:',JSON.stringify({...result,unsignedPdfBytes:pdfResult.size,engine:process.env.BROWSER_ENGINE||'chromium',physicalDevice:false,heicNativeNotTested:true}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
