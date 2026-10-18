import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {chromium} from 'playwright';
const source=await fs.readFile(new URL('../components/PreventionSection.tsx',import.meta.url),'utf8');
const start=source.indexOf('async function readPhoto('),end=source.indexOf('\n}\n',start)+2;
assert(start>=0&&end>start,'actual prevention photo function');
const script=source.slice(start,end).replace('(file: File): Promise<string>','(file)');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><script>'+script+';window.preparePhoto=readPhoto;</script>');});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 const metrics=await page.evaluate(async()=>{
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  const canvas=document.createElement('canvas');canvas.width=2200;canvas.height=1800;const ctx=canvas.getContext('2d'),image=ctx.createImageData(canvas.width,canvas.height);let seed=9;
  for(let i=0;i<image.data.length;i+=4){for(let k=0;k<3;k++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;image.data[i+k]=seed>>>24;}image.data[i+3]=255;}ctx.putImageData(image,0,0);
  const file=new File([await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))],'camera.png',{type:'image/png'});check(file.size>1_500_000,'representative large camera photo');
  const photo=await window.preparePhoto(file);check(photo.startsWith('data:image/jpeg;base64,')&&photo.length<=400000,'persisted photo respects server data URL limit');const bitmap=await createImageBitmap(await(await fetch(photo)).blob());check(bitmap.width>=600&&bitmap.height>=400,'useful resolution retained for representative input');bitmap.close();
  let error='';try{await window.preparePhoto(new File(['pdf'],'document.pdf',{type:'application/pdf'}));}catch(e){error=e.message;}check(/JPG, PNG o WebP/.test(error),'unsupported format rejected');
  error='';try{await window.preparePhoto(new File([new Uint8Array(30*1024*1024+1)],'huge.jpg',{type:'image/jpeg'}));}catch(e){error=e.message;}check(/30 MB/.test(error),'oversize original rejected before decode');
  canvas.width=canvas.height=1;return {originalBytes:file.size,dataUrlCharacters:photo.length,physicalDevice:false};
 });console.log('PASS prevention photo: actual browser compression, output fits incident field, readable dimensions, unsupported/oversize validation; '+JSON.stringify(metrics));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
