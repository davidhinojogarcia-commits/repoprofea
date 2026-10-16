import type { jsPDF } from 'jspdf';
import { repeatForemanSignature, type ForemanSignatureTemplate } from './foremanSignatureTemplate';

/** Render separate foreman evidence without changing any worker signature. */
export function drawForemanModelSignature(doc:jsPDF, signature?:string, layout?:ForemanSignatureTemplate) {
  if(!signature||!layout?.enabled)return;
  const sizes=Array.from({length:doc.getNumberOfPages()},(_,i)=>{
    doc.setPage(i+1);return {width:doc.internal.pageSize.getWidth(),height:doc.internal.pageSize.getHeight()};
  });
  const image=doc.getImageProperties(signature);
  for(const box of repeatForemanSignature(layout,sizes)){
    doc.setPage(box.page);
    const scale=Math.min(box.width/image.width,box.height/image.height);
    const width=image.width*scale,height=image.height*scale;
    doc.addImage(signature,'PNG',box.x+(box.width-width)/2,
      sizes[box.page-1].height-box.y-box.height+(box.height-height)/2,width,height);
  }
}
