export type PdfBox = { signatureX:number; signatureY:number; signatureWidth:number; signatureHeight:number };
export type PdfBounds = { x:number; y:number; width:number; height:number };
export type PdfViewport = { width:number; height:number; transform:number[] };

export function viewportToPdf(view:PdfViewport,x:number,y:number):[number,number] {
  const [a,b,c,d,e,f]=view.transform,det=a*d-b*c;
  if(!Number.isFinite(det)||!det)throw new Error('Transformación de página no válida.');
  return [(d*(x-e)-c*(y-f))/det,(-b*(x-e)+a*(y-f))/det];
}
export function pdfToViewport(view:PdfViewport,x:number,y:number):[number,number] {
  const [a,b,c,d,e,f]=view.transform;
  return [a*x+c*y+e,b*x+d*y+f];
}
export function pdfBoxToViewport(view:PdfViewport,box:PdfBox) {
  const points=[[box.signatureX,box.signatureY],[box.signatureX+box.signatureWidth,box.signatureY],
    [box.signatureX,box.signatureY+box.signatureHeight],[box.signatureX+box.signatureWidth,box.signatureY+box.signatureHeight]]
    .map(([x,y])=>pdfToViewport(view,x,y));
  const x=Math.min(...points.map(p=>p[0])),y=Math.min(...points.map(p=>p[1]));
  return {x,y,width:Math.max(...points.map(p=>p[0]))-x,height:Math.max(...points.map(p=>p[1]))-y};
}
export function clampPdfBox(box:PdfBox,bounds:PdfBounds):PdfBox {
  if(![box.signatureX,box.signatureY,box.signatureWidth,box.signatureHeight].every(Number.isFinite))throw new Error('Coordenadas de firma no válidas.');
  const width=Math.min(bounds.width,Math.max(8,box.signatureWidth));
  const height=Math.min(bounds.height,Math.max(4,box.signatureHeight));
  return {signatureX:Math.max(bounds.x,Math.min(bounds.x+bounds.width-width,box.signatureX)),
    signatureY:Math.max(bounds.y,Math.min(bounds.y+bounds.height-height,box.signatureY)),
    signatureWidth:width,signatureHeight:height};
}
export function resizePdfBox(view:PdfViewport,box:PdfBox,corner:string,dx:number,dy:number,bounds:PdfBounds):PdfBox {
  const r=pdfBoxToViewport(view,box);
  let left=r.x,top=r.y,right=r.x+r.width,bottom=r.y+r.height;
  if(corner.includes('w'))left=Math.min(right-8,Math.max(0,left+dx));
  if(corner.includes('e'))right=Math.max(left+8,Math.min(view.width,right+dx));
  if(corner.includes('n'))top=Math.min(bottom-8,Math.max(0,top+dy));
  if(corner.includes('s'))bottom=Math.max(top+8,Math.min(view.height,bottom+dy));
  const points=[[left,top],[right,top],[left,bottom],[right,bottom]].map(([x,y])=>viewportToPdf(view,x,y));
  const x=Math.min(...points.map(p=>p[0])),y=Math.min(...points.map(p=>p[1]));
  return clampPdfBox({signatureX:x,signatureY:y,signatureWidth:Math.max(...points.map(p=>p[0]))-x,
    signatureHeight:Math.max(...points.map(p=>p[1]))-y},bounds);
}
