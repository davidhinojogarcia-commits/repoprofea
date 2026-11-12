import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { CARD_W,CARD_H,A4_W,A4_H,DUPLEX_CAPACITY,cardSlot,drawWorkerCardBack,generateWorkerCardDuplexSheet,generateWorkerCardCalibration,generateWorkerCardBack } from '../src/lib/workerCardDuplex';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

assert.equal(CARD_W,85.6);
assert.equal(CARD_H,53.98);
assert.equal(DUPLEX_CAPACITY,8);
const eq=(a:number,b:number)=>assert(Math.abs(a-b)<0.001,`${a} != ${b}`);
for(let i=0;i<DUPLEX_CAPACITY;i++){
  const front=cardSlot(i),reverse=cardSlot(i,true);
  eq(front.x+reverse.x,A4_W-CARD_W);
  eq(front.y,reverse.y);
  assert(front.x>=10&&front.x+CARD_W<=A4_W-10);
  assert(front.y>=10&&front.y+CARD_H<=A4_H-10);
  for(let j=0;j<i;j++){
    const other=cardSlot(j);
    assert(other.x+CARD_W+2<front.x||front.x+CARD_W+2<other.x||other.y+CARD_H+2<front.y||front.y+CARD_H+2<other.y,'Slots must not overlap');
  }
}
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/e94AAAAASUVORK5CYII=';
for(const count of [1,2,6,8,9]){
  const cards=Array.from({length:count},(_,i)=>({id:i+1,frontPng:pixel}));
  const {doc}=generateWorkerCardDuplexSheet(cards);
  assert.equal(doc.getNumberOfPages(),Math.ceil(count/8)*2,'Each physical sheet has two pages');
  const bytes=new Uint8Array(doc.output('arraybuffer'));
  const pdf=await getDocument({data:bytes,useSystemFonts:true,disableFontFace:true}).promise;
  assert.equal(pdf.numPages,Math.ceil(count/8)*2);
  for(let page=1;page<=pdf.numPages;page++){
    const p=await pdf.getPage(page),viewport=p.getViewport({scale:1});
    assert(Math.abs(viewport.width*25.4/72-A4_W)<0.03,'A4 width within PDF point precision');
    assert(Math.abs(viewport.height*25.4/72-A4_H)<0.03,'A4 height within PDF point precision');
    if(page%2===0){
      const strings=(await p.getTextContent()).items.map(i=>'str' in i?i.str:'').join(' ');
      assert.match(strings,/PROFEA/,'Reverse page includes institutional text');
    }
  }
  await pdf.destroy();
}
assert.throws(()=>generateWorkerCardDuplexSheet([]),/Selecciona/);
assert.throws(()=>generateWorkerCardDuplexSheet([{id:1,frontPng:pixel},{id:1,frontPng:pixel}]),/duplicados/);
assert.throws(()=>generateWorkerCardDuplexSheet([{id:1,frontPng:'malformed'}]),/PNG/);
assert.equal(generateWorkerCardCalibration().doc.getNumberOfPages(),2);
const back=generateWorkerCardBack();
eq(back.internal.pageSize.getWidth(),CARD_W);
eq(back.internal.pageSize.getHeight(),CARD_H);
const scratch=new jsPDF({orientation:'landscape',unit:'mm',format:[CARD_H,CARD_W]});
drawWorkerCardBack(scratch,0,0);
assert(scratch.output('arraybuffer').byteLength>600);
console.log('PASS: duplex 1/2/6/8/9, actual A4 sizes, ID-1 geometry, reverse column pairing, cutting clearance, privacy and calibration');
