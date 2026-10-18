export const VISIT_FILE_BYTES=1_500_000;
export const VISIT_TOTAL_BYTES=8_000_000;
export type PreparedVisitAttachment={blob:Blob;name:string;mime:'image/jpeg'|'image/png'|'application/pdf';originalBytes:number;bytes:number;optimized:boolean};
const prepared=new WeakMap<File,Promise<PreparedVisitAttachment>>();
const fail=(message:string):never=>{throw new Error(message);};
export function jpegOrientation(buffer:ArrayBuffer){
  const v=new DataView(buffer);let pos=2;
  while(pos+4<v.byteLength&&v.getUint8(pos)===255){
    const marker=v.getUint8(pos+1),size=v.getUint16(pos+2);if(size<2||pos+2+size>v.byteLength)break;
    if(marker===225&&size>12&&v.getUint32(pos+4)===0x45786966){
      const t=pos+10,little=v.getUint16(t)===0x4949,offset=t+v.getUint32(t+4,little);
      if(offset+2>pos+size+2)break;const count=v.getUint16(offset,little);
      for(let n=0;n<count;n++){const p=offset+2+n*12;if(p+12>pos+size+2)break;if(v.getUint16(p,little)===0x0112)return v.getUint16(p+8,little);}
    }
    pos+=2+size;
  }
  return 1;
}
async function decode(blob:Blob):Promise<{image:CanvasImageSource;width:number;height:number;close:()=>void}>{
  if(typeof createImageBitmap==='function'){
    try{const image=await createImageBitmap(blob,{imageOrientation:'from-image'});return {image,width:image.width,height:image.height,close:()=>image.close()};}catch{/* Native Safari image decoder is the fallback, including HEIC where supported. */}
  }
  const url=URL.createObjectURL(blob),image=new Image();
  try{image.src=url;await image.decode();return {image,width:image.naturalWidth,height:image.naturalHeight,close:()=>URL.revokeObjectURL(url)};}
  catch{URL.revokeObjectURL(url);return fail('El dispositivo no puede leer esta imagen. Para HEIC no compatible, selecciona una copia JPEG.');}
}
const canvasBlob=(canvas:HTMLCanvasElement,quality:number)=>new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('No se pudo comprimir la imagen. Elige otro archivo.')),'image/jpeg',quality));
async function process(file:File,limit:number):Promise<PreparedVisitAttachment>{
  if(!file.size||file.size>40_000_000)fail('Archivo vacío o demasiado grande para procesarlo con seguridad en el móvil (máximo 40 MB de entrada).');
  const header=await file.slice(0,Math.min(file.size,1_000_000)).arrayBuffer(),bytes=new Uint8Array(header);
  const pdf=bytes.length>5&&String.fromCharCode(...bytes.slice(0,5))==='%PDF-',jpeg=bytes[0]===255&&bytes[1]===216,png=bytes[0]===137&&String.fromCharCode(...bytes.slice(1,4))==='PNG';
  const heic=bytes.length>12&&String.fromCharCode(...bytes.slice(4,8))==='ftyp'&&/heic|heix|hevc|hevx|mif1|msf1/.test(String.fromCharCode(...bytes.slice(8,32)));
  if(!pdf&&!jpeg&&!png&&!heic)fail('Formato incompatible o archivo corrupto. Selecciona JPEG, PNG, HEIC compatible o PDF.');
  if(pdf){
    if(file.size<=limit)return {blob:file,name:file.name,mime:'application/pdf',originalBytes:file.size,bytes:file.size,optimized:false};
    const {PDFDocument,PDFDict,PDFName}=await import('pdf-lib');
    let document;
    try{document=await PDFDocument.load(await file.arrayBuffer(),{updateMetadata:false});}catch{return fail('El PDF está protegido o no se puede leer. No se ha modificado; selecciona otro documento.');}
    const signed=document.context.enumerateIndirectObjects().some(([,obj])=>obj instanceof PDFDict&&(obj.has(PDFName.of('ByteRange'))||obj.get(PDFName.of('FT'))===PDFName.of('Sig')||obj.get(PDFName.of('Type'))===PDFName.of('Sig')));
    if(signed||document.catalog.has(PDFName.of('AcroForm'))||document.catalog.has(PDFName.of('Perms')))fail('El PDF supera 1,5 MB y contiene firmas, formularios o permisos que deben conservarse. No se ha modificado. Selecciona una copia adecuada o solicita una reducción externa segura.');
    const optimized=await document.save({useObjectStreams:true,addDefaultPage:false,updateFieldAppearances:false});
    if(optimized.byteLength>limit)fail('La optimización segura del PDF no basta para reducirlo a 1,5 MB. No se han rasterizado páginas ni eliminado información; utiliza otro documento o una reducción externa.');
    return {blob:new Blob([optimized as BlobPart],{type:'application/pdf'}),name:file.name,mime:'application/pdf',originalBytes:file.size,bytes:optimized.byteLength,optimized:true};
  }
  if(png){const v=new DataView(header),w=v.getUint32(16),h=v.getUint32(20);if(!w||!h||w*h>40_000_000)fail('La imagen tiene dimensiones excesivas. Selecciona una copia más pequeña.');}
  const image=await decode(file);
  try{
    if(!image.width||!image.height||image.width*image.height>40_000_000)fail('La imagen tiene dimensiones excesivas para procesarla en el móvil.');
    const orientation=jpeg?jpegOrientation(header):1;
    if(file.size<=limit&&!heic&&orientation===1&&image.width*image.height<=16_000_000)return {blob:file,name:file.name,mime:png?'image/png':'image/jpeg',originalBytes:file.size,bytes:file.size,optimized:false};
    const canvas=document.createElement('canvas');let edge=Math.min(2400,Math.max(image.width,image.height));
    try{
      while(edge>=Math.min(1200,Math.max(image.width,image.height))){
        const ratio=edge/Math.max(image.width,image.height);canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
        const ctx=canvas.getContext('2d');if(!ctx)fail('El dispositivo no permite comprimir la imagen.');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image.image,0,0,canvas.width,canvas.height);
        for(const quality of [.9,.78,.66]){const blob=await canvasBlob(canvas,quality);if(blob.size<=limit)return {blob,name:file.name.replace(/\.[^.]+$/,'')+'.jpg',mime:'image/jpeg',originalBytes:file.size,bytes:blob.size,optimized:true};}
        edge=Math.floor(edge*.8);
      }
      return fail('No es posible alcanzar 1,5 MB conservando una resolución suficiente. Selecciona otra fotografía.');
    }finally{canvas.width=canvas.height=1;}
  }finally{image.close();}
}
export function prepareVisitAttachment(file:File,limit=VISIT_FILE_BYTES){
  let value=prepared.get(file);if(!value){value=process(file,limit);prepared.set(file,value);void value.catch(()=>prepared.delete(file));}return value;
}
