import assert from 'node:assert/strict';
import {pdfToViewport,viewportToPdf,pdfBoxToViewport,resizePdfBox,clampPdfBox} from '../src/lib/pdfSignatureCoordinates';
import {getPdfPageOcr,rememberPdfPageOcr} from '../src/lib/pdfOcrCache';
import {SIGNATURE_INK} from '../src/lib/signatureInk';
for(const scale of [.2,1,1.7,4])for(const rotation of [0,90,180,270]){
 const [a,b,c,d,e,f]=rotation===0?[scale,0,0,-scale,0,842*scale]:rotation===90?[0,scale,scale,0,0,0]:
   rotation===180?[-scale,0,0,scale,595*scale,0]:[0,-scale,-scale,0,842*scale,595*scale];
 const view={width:(rotation%180?842:595)*scale,height:(rotation%180?595:842)*scale,transform:[a,b,c,d,e,f]};
 for(let i=0;i<100;i++){
  const x=i*5.5,y=i*7.5,[vx,vy]=pdfToViewport(view,x,y),[rx,ry]=viewportToPdf(view,vx,vy);
  assert(Math.abs(rx-x)<1e-8&&Math.abs(ry-y)<1e-8);
 }
 const box={signatureX:100,signatureY:150,signatureWidth:210,signatureHeight:65};
 const r=pdfBoxToViewport(view,box);assert(r.width>0&&r.height>0);
 const grown=resizePdfBox(view,box,'se',20,20,{x:0,y:0,width:595,height:842});
 assert(grown.signatureX>=0&&grown.signatureY>=0&&grown.signatureX+grown.signatureWidth<=595&&grown.signatureY+grown.signatureHeight<=842);
 assert(grown.signatureWidth*grown.signatureHeight>box.signatureWidth*box.signatureHeight);
 assert.deepEqual(box,{signatureX:100,signatureY:150,signatureWidth:210,signatureHeight:65},'projection never mutates saved coordinates');
}
const cropped={width:500,height:700,transform:[1,0,0,-1,-30,740]};
assert.deepEqual(viewportToPdf(cropped,...pdfToViewport(cropped,100,200)),[100,200]);
assert.deepEqual(clampPdfBox({signatureX:900,signatureY:-30,signatureWidth:700,signatureHeight:1000},{x:0,y:0,width:595,height:842}),
 {signatureX:0,signatureY:0,signatureWidth:595,signatureHeight:842});
assert.throws(()=>viewportToPdf({width:0,height:0,transform:[0,0,0,0,0,0]},1,1));
assert.throws(()=>clampPdfBox({signatureX:NaN,signatureY:0,signatureWidth:90,signatureHeight:32},{x:0,y:0,width:595,height:842}));
const first=new File(['one'],'document.pdf'),second=new File(['two'],'document.pdf');
rememberPdfPageOcr(first,1,{text:'first'},2);
assert.equal(getPdfPageOcr(first,1)?.data.text,'first');assert.equal(getPdfPageOcr(first,2),undefined);assert.equal(getPdfPageOcr(second,1),undefined);
assert.equal(SIGNATURE_INK,'#164B9B');
console.log('PASS: 1600 coordinate round trips across zoom/rotations, crop offsets, resizing/bounds, immutable saved boxes and per-file/page OCR cache isolation.');
