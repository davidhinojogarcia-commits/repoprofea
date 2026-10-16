import { suggestWorkerSignatureAnchor } from './employmentDocumentAnalysis.mjs';
import { readPdfTextContent } from './clientDocumentText';
import { createWorker } from 'tesseract.js';
import { getPdfPageOcr,rememberPdfPageOcr } from './pdfOcrCache';
import type { Person } from '../../types';
import {
  computeSignatureBoxFromDetectedName,
  fitSignatureInsideBox,
  mandatoryNameTokenMatch,
  scoreMandatoryWorkerNameText,
  blockingMandatorySignatureIssues, validateMandatorySignaturePlacement,
  type MandatorySignaturePlacementIssue,
} from './mandatorySignatureGeometry';

declare global {
  interface Window {
    PDFLib?: any;
  }
}

export type MandatoryWorkerAnchor = {
  documentWorkerId?: string;
  draftNew?: boolean;
  workerId: number;
  workerName: string;
  dni: string;
  page: number;
  order: number;
  nameX: number | null;
  nameY: number | null;
  nameWidth?: number | null;
  nameHeight?: number | null;
  nameRightX?: number | null;
  nameCenterY?: number | null;
  rowHeight: number | null;
  signatureX: number | null;
  signatureY: number | null;
  signatureWidth: number | null;
  signatureHeight: number | null;
  confidence: number;
  resolved: boolean;
  reason?: string;
};

export type MandatoryPdfPageMeta = {
  page: number;
  width: number;
  height: number;
  rotation: number;
};

export type MandatoryPdfAnalysis = {
  pageCount: number;
  pages: MandatoryPdfPageMeta[];
  anchors: MandatoryWorkerAnchor[];
  orderedWorkerIds: number[];
  unresolvedWorkerIds: number[];
};

export type MandatoryFidelityReport = {
  ok: boolean;
  pageCountMatches: boolean;
  dimensionsMatch: boolean;
  textMatches: boolean;
  visualMismatchRatio: number;
  checkedAt: string;
};

const normalize = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const compact = (value: unknown) => normalize(value).replace(/\s+/g, '');

const setupPdfJs = async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerModule = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
  return pdfjs;
};

const cleanWorkerName = (value: unknown) =>
  normalize(String(value || '').replace(/\[[^\]]*\]\s*$/g, '').replace(/\([^)]*\)\s*$/g, ''));

const workerNameTokens = (worker: Person) =>
  cleanWorkerName(worker.apellidosNombre)
    .split(' ')
    .filter(token => token.length >= 2 && !['DE','DEL','LA','LAS','LOS','Y'].includes(token));

const scoreLineForWorker = (worker: Person, lineText: string) => {
  const nameScore=scoreMandatoryWorkerNameText(worker,lineText);
  if(nameScore<=0)return 0;
  const dni = compact(worker.dni);
  const lineCompact = compact(lineText);
  if (dni && dni.length >= 7 && lineCompact.includes(dni)) return Math.min(1,nameScore+0.04);
  return nameScore;
};
const itemBox = (item: any) => {
  const transform = Array.isArray(item?.transform) ? item.transform : [1,0,0,1,0,0];
  const x = Number(transform[4] || 0);
  const y = Number(transform[5] || 0);
  const width = Math.max(0, Number(item?.width || 0));
  const height = Math.max(4, Math.abs(Number(item?.height || transform[3] || 8)));
  return { x, y, width, height };
};

const groupLines = (items: any[]) => {
  const lines: { y:number; items:any[]; text:string; minX:number; maxX:number; height:number }[] = [];
  const sorted = items
    .filter(item => String(item?.str || '').trim())
    .map(item => ({ item, ...itemBox(item) }))
    .sort((a,b) => b.y - a.y || a.x - b.x);

  for (const entry of sorted) {
    const tolerance = Math.max(2.5, entry.height * 0.45);
    let line = lines.find(candidate => Math.abs(candidate.y - entry.y) <= tolerance);
    if (!line) {
      line = { y: entry.y, items: [], text: '', minX: entry.x, maxX: entry.x + entry.width, height: entry.height };
      lines.push(line);
    }
    line.items.push(entry.item);
    line.minX = Math.min(line.minX, entry.x);
    line.maxX = Math.max(line.maxX, entry.x + entry.width);
    line.height = Math.max(line.height, entry.height);
  }

  return lines
    .map(line => {
      line.items.sort((a,b) => itemBox(a).x - itemBox(b).x);
      line.text = line.items.map(item => String(item.str || '').trim()).filter(Boolean).join(' ');
      return line;
    })
    .sort((a,b) => b.y - a.y || a.minX - b.minX);
};

const signatureHeaderXForPage = (items: any[]) => {
  const signatureItems = items
    .filter(item => /FIRMA/i.test(normalize(item?.str || '')))
    .map(item => itemBox(item))
    .sort((a,b) => a.x - b.x);
  return signatureItems.length ? signatureItems[signatureItems.length - 1].x : null;
};

type WorkerNameSpan = {
  text:string;
  x:number;
  y:number;
  right:number;
  width:number;
  height:number;
  centerY:number;
  score:number;
  lineIndexes:number[];
  itemKeys:Set<string>;
};

const itemKey=(item:any)=>{
  const box=itemBox(item);
  return [Number(box.x).toFixed(3),Number(box.y).toFixed(3),Number(box.width).toFixed(3),normalize(item?.str||'')].join(':');
};

const bestNameSpanOnLine=(worker:Person,line:any,lineIndex:number):WorkerNameSpan|null=>{
  const items=(line.items||[]).filter((item:any)=>String(item?.str||'').trim());
  let best:WorkerNameSpan|null=null;
  const maxWindow=Math.min(7,items.length);
  for(let start=0;start<items.length;start+=1){
    for(let len=1;len<=maxWindow&&start+len<=items.length;len+=1){
      const subset=items.slice(start,start+len);
      const text=subset.map((item:any)=>String(item?.str||'').trim()).join(' ');
      const score=scoreMandatoryWorkerNameText(worker,text);
      if(score<0.78)continue;
      const boxes=subset.map(itemBox);
      const x=Math.min(...boxes.map(box=>box.x));
      const right=Math.max(...boxes.map(box=>box.x+box.width));
      const height=Math.max(...boxes.map(box=>box.height));
      const span:WorkerNameSpan={
        text,x,y:line.y,right,width:right-x,height,
        centerY:line.y+(height/2),
        score,lineIndexes:[lineIndex],
        itemKeys:new Set(subset.map(itemKey)),
      };
      if(!best||span.score>best.score+0.001||(Math.abs(span.score-best.score)<=0.001&&span.width<best.width)){
        best=span;
      }
    }
  }
  return best;
};

const candidateNameSpansForWorker=(worker:Person,lines:any[]):WorkerNameSpan[]=>{
  const candidates:WorkerNameSpan[]=[];
  for(let i=0;i<lines.length;i+=1){
    const single=bestNameSpanOnLine(worker,lines[i],i);
    if(single)candidates.push(single);

    if(i+1<lines.length){
      const first=lines[i],second=lines[i+1];
      const verticalGap=Math.abs(Number(first.y)-Number(second.y));
      const maxHeight=Math.max(Number(first.height||8),Number(second.height||8));
      if(verticalGap<=Math.max(18,maxHeight*2.25)){
        const combinedText=`${first.text} ${second.text}`;
        const combinedScore=scoreMandatoryWorkerNameText(worker,combinedText);
        if(combinedScore>=0.82){
          const wanted=workerNameTokens(worker);
          const relevantItems=[...(first.items||[]),...(second.items||[])].filter((item:any)=>{
            const tokens=normalize(item?.str||'').split(' ').filter(Boolean);
            return tokens.some(token=>wanted.some(expected=>mandatoryNameTokenMatch(expected,token)));
          });
          if(relevantItems.length){
            const boxes=relevantItems.map(itemBox);
            const x=Math.min(...boxes.map(box=>box.x));
            const right=Math.max(...boxes.map(box=>box.x+box.width));
            const low=Math.min(...boxes.map(box=>box.y));
            const high=Math.max(...boxes.map(box=>box.y+box.height));
            candidates.push({
              text:combinedText,x,y:low,right,width:right-x,height:high-low,
              centerY:(low+high)/2,
              score:combinedScore,
              lineIndexes:[i,i+1],
              itemKeys:new Set(relevantItems.map(itemKey)),
            });
          }
        }
      }
    }
  }
  return candidates.sort((a,b)=>b.score-a.score||a.width-b.width||b.y-a.y);
};
/** Employment PDFs use a signature below the printed name, not a attendance-table column. */
export async function analyzeEmploymentOriginalPdf(file:File, workers:Person[], onProgress?:(message:string)=>void):Promise<MandatoryPdfAnalysis> {
  const pdfjs=await setupPdfJs();
  const loadingTask=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),useSystemFonts:true});
  const pdf=await loadingTask.promise;
  const round=(value:number)=>Math.round(value*100)/100;
  const pages:MandatoryPdfPageMeta[]=[];
  const textPages:any[]=[];
  let employmentOcr:any=null;
  try {
    for(let number=1;number<=pdf.numPages;number++) {
      onProgress?.(`Revisando zona de firma · página ${number}/${pdf.numPages}…`);
      const page=await pdf.getPage(number), view=page.view;
      const width=Number(view[2])-Number(view[0]),height=Number(view[3])-Number(view[1]);
      pages.push({page:number,width,height,rotation:Number(page.rotate||0)});
      const content=await readPdfTextContent(page);
      let items:any[]=groupLines(content.items).map(line=>({text:line.text,x:(line.minX-view[0])/width,y:1-(line.y-view[1]+line.height)/height,width:(line.maxX-line.minX)/width,height:line.height/height}));
      // Include short native spans so worker/employer labels sharing one row are not merged.
      for(const line of groupLines(content.items)) for(let start=0;start<line.items.length;start++) for(let count=1;count<=4&&start+count<=line.items.length;count++) {
        const span=line.items.slice(start,start+count),boxes=span.map(itemBox);
        const left=Math.min(...boxes.map(b=>b.x)),right=Math.max(...boxes.map(b=>b.x+b.width));
        items.push({text:span.map(i=>String(i.str||'')).join(' '),x:(left-view[0])/width,y:1-(line.y-view[1]+line.height)/height,width:(right-left)/width,height:line.height/height});
      }
      if(!content.items.some((item:any)=>String(item.str||'').trim()) && workers.length===1 && Number(page.rotate||0)===0) {
        try {
          onProgress?.(`Localizando la zona de firma del formulario escaneado · página ${number}…`);
          const cached=getPdfPageOcr(file,number);
          const scale=cached?.scale||2;
          let result=cached?{data:cached.data}:null;
          if(!result){
            employmentOcr ||= await createWorker('spa');
            const viewport=page.getViewport({scale}),canvas=document.createElement('canvas');
            canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
            const context=canvas.getContext('2d');if(!context)throw Error('Lienzo OCR no disponible');
            try{
              await page.render({canvas,canvasContext:context,viewport}).promise;
              result=await employmentOcr.recognize(canvas,{}, {blocks:true,text:true});
              rememberPdfPageOcr(file,number,result.data,scale);
            }finally{canvas.width=0;canvas.height=0;}
          }
          const rows=collectTesseractLines(result.data,scale,height,number);
          items=rows.map(row=>({text:row.text,x:row.x/width,y:1-(row.y+row.height)/height,width:row.width/width,height:row.height/height,confidence:row.confidence/100}));
          for(const block of result.data.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[])for(let start=0;start<(line.words||[]).length;start++)for(let count=1;count<=4&&start+count<=line.words.length;count++) {
            const words=line.words.slice(start,start+count),left=Math.min(...words.map((w:any)=>w.bbox.x0)),right=Math.max(...words.map((w:any)=>w.bbox.x1)),top=Math.min(...words.map((w:any)=>w.bbox.y0)),bottom=Math.max(...words.map((w:any)=>w.bbox.y1));
            items.push({text:words.map((w:any)=>w.text).join(' '),x:left/scale/width,y:top/scale/height,width:(right-left)/scale/width,height:(bottom-top)/scale/height,confidence:Math.min(...words.map((w:any)=>Number(w.confidence??w.conf??100)))/100});
          }
        } catch {onProgress?.('Zona de firma pendiente de encuadrar manualmente. El PDF original se conserva.');}
      }
      textPages.push({manualOnly:Number(page.rotate||0)!==0||Number(view[0])!==0||Number(view[1])!==0,items});
    }
    const anchors:MandatoryWorkerAnchor[]=workers.map((worker,index)=>{
      const suggestion=suggestWorkerSignatureAnchor(textPages,worker.apellidosNombre,workers.length===1);
      const found=suggestion.status==='SUGGESTED'?suggestion.anchor:null;
      const meta=found?pages[found.page-1]:pages[0];
      // Rotated/cropped pages stay manual: no guessing of coordinate systems.
      const safe=found && !textPages[found.page-1].manualOnly;
      return {workerId:Number(worker.id),workerName:worker.apellidosNombre,dni:worker.dni||'',page:safe?found.page:1,order:index,
        nameX:safe&&found.nameX!=null?round(found.nameX*meta.width):null,nameY:safe&&found.nameY!=null?round((1-found.nameY-found.nameHeight)*meta.height):null,
        nameWidth:safe&&found.nameWidth!=null?round(found.nameWidth*meta.width):null,nameHeight:safe&&found.nameHeight!=null?round(found.nameHeight*meta.height):null,rowHeight:null,
        signatureX:safe?round(found.x*meta.width):null,signatureY:safe?round((1-found.y-found.height)*meta.height):null,
        signatureWidth:safe?round(found.width*meta.width):null,signatureHeight:safe?round(found.height*meta.height):null,
        confidence:safe?0.9:0,resolved:false,reason:safe?'Zona sugerida debajo del nombre. El supervisor debe revisarla y guardar la posición.':suggestion.reason||'Revisa y encuadra la firma manualmente.'};
    });
    return {pageCount:pages.length,pages,anchors,orderedWorkerIds:workers.map(w=>Number(w.id)),unresolvedWorkerIds:workers.map(w=>Number(w.id))};
  } finally {try{await employmentOcr?.terminate();}finally{await loadingTask.destroy?.();}}
}

export async function analyzeMandatoryOriginalPdf(
  file: File,
  workers: Person[],
  onProgress?: (message:string)=>void,
  fallbackText = '',
): Promise<MandatoryPdfAnalysis> {
  const pdfjs = await setupPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask=pdfjs.getDocument({data,useSystemFonts:true});
  try {
  const pdf=await loadingTask.promise;
  const pages: MandatoryPdfPageMeta[] = [];
  const pageLines: {
    page:number;
    width:number;
    height:number;
    signatureHeaderX:number|null;
    lines:ReturnType<typeof groupLines>;
    allItems:any[];
  }[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.(`Localizando nombres reales en el PDF original · página ${pageNumber}/${pdf.numPages}…`);
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await readPdfTextContent(page);
    const width = Number(viewport.width);
    const height = Number(viewport.height);
    pages.push({ page: pageNumber, width, height, rotation: Number(page.rotate || 0) });
    pageLines.push({
      page: pageNumber,
      width,
      height,
      signatureHeaderX: signatureHeaderXForPage(content.items),
      lines: groupLines(content.items),
      allItems: content.items,
    });
  }

  const usedVisualBlocks = new Set<string>();
  const preliminary: MandatoryWorkerAnchor[] = [];
  const spanByWorker=new Map<number,WorkerNameSpan>();

  for (const [workerIndex,worker] of workers.entries()) {
    let best: {
      pageInfo:(typeof pageLines)[number];
      span:WorkerNameSpan;
      score:number;
    } | null = null;

    for (const pageInfo of pageLines) {
      const spans=candidateNameSpansForWorker(worker,pageInfo.lines);
      for(const span of spans){
        const blockKey=`${pageInfo.page}:${span.lineIndexes.join('-')}:${Math.round(span.x)}:${Math.round(span.right)}`;
        if(usedVisualBlocks.has(blockKey))continue;

        // DNI solo desambigua; nunca sustituye la localización real del nombre.
        const relatedText=span.lineIndexes.map(index=>pageInfo.lines[index]?.text||'').join(' ');
        const dni=compact(worker.dni);
        const dniBonus=dni&&dni.length>=7&&compact(relatedText).includes(dni)?0.03:0;
        const score=Math.min(1,span.score+dniBonus);
        if(!best||score>best.score+0.001){
          best={pageInfo,span,score};
        }
        // Los candidatos están ordenados: el primero libre de esta página es el mejor.
        if(best?.pageInfo.page===pageInfo.page&&best.span===span)break;
      }
    }

    if (!best || best.score < 0.82) {
      preliminary.push({
        workerId: Number(worker.id),
        workerName: String(worker.apellidosNombre || ''),
        dni: String(worker.dni || ''),
        page: 1,
        order: workerIndex,
        nameX: null,
        nameY: null,
        nameWidth:null,
        nameHeight:null,
        nameRightX:null,
        nameCenterY:null,
        rowHeight: null,
        signatureX: null,
        signatureY: null,
        signatureWidth: null,
        signatureHeight: null,
        confidence: best?.score||0,
        resolved: false,
        reason: 'No se ha localizado con suficiente seguridad el nombre completo dentro del PDF original.',
      });
      continue;
    }

    const {pageInfo,span}=best;
    const blockKey=`${pageInfo.page}:${span.lineIndexes.join('-')}:${Math.round(span.x)}:${Math.round(span.right)}`;
    usedVisualBlocks.add(blockKey);
    spanByWorker.set(Number(worker.id),span);
    preliminary.push({
      workerId:Number(worker.id),
      workerName:String(worker.apellidosNombre||''),
      dni:String(worker.dni||''),
      page:pageInfo.page,
      order:workerIndex,
      nameX:span.x,
      nameY:span.y,
      nameWidth:span.width,
      nameHeight:span.height,
      nameRightX:span.right,
      nameCenterY:span.centerY,
      rowHeight:Math.max(12,span.height*1.55),
      signatureX:null,
      signatureY:null,
      signatureWidth:null,
      signatureHeight:null,
      confidence:best.score,
      resolved:true,
      ...(best.score<0.9?{reason:'Nombre localizado mediante coincidencia parcial; posición calculada sobre su caja real.'}:{})
    });
  }

  // Calcula cada firma únicamente desde la caja real del nombre detectado.
  for(const anchor of preliminary){
    if(!anchor.resolved||anchor.nameX==null||anchor.nameY==null||anchor.nameRightX==null||anchor.nameHeight==null)continue;
    const pageInfo=pageLines.find(page=>page.page===anchor.page);
    if(!pageInfo){
      anchor.resolved=false;
      anchor.reason='No se ha podido recuperar la página donde aparece el trabajador.';
      continue;
    }
    const span=spanByWorker.get(Number(anchor.workerId));
    const ownCenter=Number(anchor.nameCenterY??(anchor.nameY+anchor.nameHeight/2));
    const peers=preliminary.filter(other=>other.resolved&&other.page===anchor.page&&other.workerId!==anchor.workerId&&other.nameCenterY!=null);
    const upper=peers.map(peer=>Number(peer.nameCenterY)).filter(y=>y>ownCenter).sort((a,b)=>a-b)[0]??null;
    const lower=peers.map(peer=>Number(peer.nameCenterY)).filter(y=>y<ownCenter).sort((a,b)=>b-a)[0]??null;

    const overlappingText=pageInfo.allItems
      .map(item=>({item,box:itemBox(item)}))
      .filter(entry=>{
        if(span?.itemKeys.has(itemKey(entry.item)))return false;
        const box=entry.box;
        const itemCenterY=box.y+(box.height/2);
        return Math.abs(itemCenterY-ownCenter)<=Math.max(anchor.nameHeight||8,box.height)*0.7
          && box.x>=Number(anchor.nameRightX)-1;
      })
      .sort((a,b)=>a.box.x-b.box.x);
    const nextTextX=overlappingText.find(entry=>entry.box.x>Number(anchor.nameRightX)+2)?.box.x??null;

    const box=computeSignatureBoxFromDetectedName({
      pageWidth:pageInfo.width,
      pageHeight:pageInfo.height,
      nameX:Number(anchor.nameX),
      nameY:Number(anchor.nameY),
      nameRightX:Number(anchor.nameRightX),
      nameHeight:Number(anchor.nameHeight),
      nextTextX,
      signatureColumnX:pageInfo.signatureHeaderX,
      upperWorkerCenterY:upper,
      lowerWorkerCenterY:lower,
    });
    if(!box){
      anchor.resolved=false;
      anchor.signatureX=null;
      anchor.signatureY=null;
      anchor.signatureWidth=null;
      anchor.signatureHeight=null;
      anchor.reason=pageInfo.signatureHeaderX!=null
        ? 'No existe espacio seguro dentro de la columna FIRMA de esta fila.'
        : 'No existe espacio seguro inmediatamente a la derecha del nombre sin invadir texto u otra fila.';
      continue;
    }
    anchor.signatureX=box.x;
    anchor.signatureY=box.y;
    anchor.signatureWidth=box.width;
    anchor.signatureHeight=box.height;
  }

  const placement=validateMandatorySignaturePlacement(preliminary,pages);
  if(!placement.ok){
    const byWorker=new Map<number,MandatorySignaturePlacementIssue[]>();
    for(const issue of blockingMandatorySignatureIssues(placement.issues)){
      if(!byWorker.has(issue.workerId))byWorker.set(issue.workerId,[]);
      byWorker.get(issue.workerId)!.push(issue);
    }
    for(const anchor of preliminary){
      const issues=byWorker.get(anchor.workerId);
      if(!issues?.length)continue;
      anchor.resolved=false;
      anchor.signatureX=null;
      anchor.signatureY=null;
      anchor.signatureWidth=null;
      anchor.signatureHeight=null;
      anchor.reason=issues.map(issue=>issue.message).join(' ');
    }
  }

  const orderedResolved = preliminary
    .filter(anchor => anchor.resolved)
    .sort((a,b) => a.page - b.page || Number(b.nameCenterY || b.nameY || 0) - Number(a.nameCenterY || a.nameY || 0));
  orderedResolved.forEach((anchor,index)=>{anchor.order=index;});

  let nextOrder=orderedResolved.length;
  const normalizedFallback=normalize(fallbackText);
  const compactFallback=compact(fallbackText);
  preliminary
    .filter(anchor=>!anchor.resolved)
    .sort((a,b)=>{
      const indexFor=(anchor:MandatoryWorkerAnchor)=>{
        const dni=compact(anchor.dni);
        if(dni&&compactFallback.includes(dni))return compactFallback.indexOf(dni);
        const tokens=normalize(anchor.workerName).split(' ').filter(token=>token.length>=3);
        const probe=tokens.slice(0,Math.min(3,tokens.length)).join(' ');
        return probe?normalizedFallback.indexOf(probe):Number.MAX_SAFE_INTEGER;
      };
      const ai=indexFor(a),bi=indexFor(b);
      return (ai<0?Number.MAX_SAFE_INTEGER:ai)-(bi<0?Number.MAX_SAFE_INTEGER:bi);
    })
    .forEach(anchor=>{anchor.order=nextOrder++;});

  const ordered=[...preliminary].sort((a,b)=>a.order-b.order);
  return {
    pageCount:pdf.numPages,
    pages,
    anchors:ordered,
    orderedWorkerIds:ordered.map(anchor=>anchor.workerId),
    unresolvedWorkerIds:ordered.filter(anchor=>!anchor.resolved).map(anchor=>anchor.workerId),
  };
  } finally { await loadingTask.destroy?.(); }
}


type OcrWorkerRow = {
  page:number;
  text:string;
  x:number;
  y:number;
  right:number;
  width:number;
  height:number;
  centerY:number;
  confidence:number;
  key:string;
};

const collectTesseractLines=(data:any,scale:number,pageHeight:number,pageNumber:number):OcrWorkerRow[]=>{
  const rows:OcrWorkerRow[]=[];
  const add=(text:string,bbox:any,confidence=0)=>{
    const value=String(text||'').replace(/\s+/g,' ').trim();
    if(!value||!bbox)return;
    const x0=Number(bbox.x0??bbox.left??0);
    const y0=Number(bbox.y0??bbox.top??0);
    const x1=Number(bbox.x1??(x0+Number(bbox.width||0)));
    const y1=Number(bbox.y1??(y0+Number(bbox.height||0)));
    if(!(x1>x0)||!(y1>y0))return;
    const x=x0/scale;
    const width=(x1-x0)/scale;
    const height=(y1-y0)/scale;
    const y=pageHeight-(y1/scale);
    rows.push({
      page:pageNumber,
      text:value,
      x,
      y,
      right:x+width,
      width,
      height,
      centerY:y+(height/2),
      confidence:Number(confidence||0),
      key:`${pageNumber}:${Math.round(x0)}:${Math.round(y0)}:${Math.round(x1)}:${Math.round(y1)}`,
    });
  };

  const blocks=Array.isArray(data?.blocks)?data.blocks:[];
  for(const block of blocks){
    for(const paragraph of Array.isArray(block?.paragraphs)?block.paragraphs:[]){
      for(const line of Array.isArray(paragraph?.lines)?paragraph.lines:[]){
        add(line?.text,line?.bbox,line?.confidence??line?.conf??0);
      }
    }
  }

  if(rows.length)return rows;

  const tsv=String(data?.tsv||'').trim();
  if(!tsv)return rows;
  const lines=tsv.split(/\r?\n/);
  const header=lines.shift()?.split('\t')||[];
  const index=(name:string)=>header.indexOf(name);
  const groups=new Map<string,{words:string[];left:number;top:number;right:number;bottom:number;conf:number[]}>();
  for(const line of lines){
    const cols=line.split('\t');
    if(cols.length<header.length)continue;
    const level=Number(cols[index('level')]);
    if(level!==5)continue;
    const text=String(cols[index('text')]||'').trim();
    if(!text)continue;
    const left=Number(cols[index('left')]||0);
    const top=Number(cols[index('top')]||0);
    const width=Number(cols[index('width')]||0);
    const height=Number(cols[index('height')]||0);
    const key=[cols[index('block_num')],cols[index('par_num')],cols[index('line_num')]].join(':');
    const current=groups.get(key)||{words:[],left,right:left+width,top,bottom:top+height,conf:[]};
    current.words.push(text);
    current.left=Math.min(current.left,left);
    current.top=Math.min(current.top,top);
    current.right=Math.max(current.right,left+width);
    current.bottom=Math.max(current.bottom,top+height);
    current.conf.push(Number(cols[index('conf')]||0));
    groups.set(key,current);
  }
  for(const group of groups.values()){
    add(
      group.words.join(' '),
      {x0:group.left,y0:group.top,x1:group.right,y1:group.bottom},
      group.conf.length?group.conf.reduce((sum,value)=>sum+value,0)/group.conf.length:0,
    );
  }
  return rows;
};

const candidateOcrRowsForWorker=(worker:Person,rows:OcrWorkerRow[])=>{
  const candidates:{row:OcrWorkerRow;score:number}[]=[];
  for(let i=0;i<rows.length;i+=1){
    const row=rows[i];
    const score=scoreMandatoryWorkerNameText(worker,row.text);
    if(score>=0.82)candidates.push({row,score});

    const next=rows[i+1];
    if(next&&next.page===row.page&&Math.abs(next.centerY-row.centerY)<=Math.max(22,row.height*2.8,next.height*2.8)){
      const combined=`${row.text} ${next.text}`;
      const combinedScore=scoreMandatoryWorkerNameText(worker,combined);
      if(combinedScore>=0.84){
        const x=Math.min(row.x,next.x);
        const right=Math.max(row.right,next.right);
        const y=Math.min(row.y,next.y);
        const top=Math.max(row.y+row.height,next.y+next.height);
        candidates.push({
          row:{
            page:row.page,
            text:combined,
            x,
            y,
            right,
            width:right-x,
            height:top-y,
            centerY:(y+top)/2,
            confidence:Math.min(row.confidence,next.confidence),
            key:`${row.key}+${next.key}`,
          },
          score:combinedScore,
        });
      }
    }
  }
  return candidates.sort((a,b)=>b.score-a.score||b.row.confidence-a.row.confidence||b.row.centerY-a.row.centerY);
};

/**
 * Respaldo simple para PDFs escaneados:
 * OCR solo las líneas visuales y usa la franja horizontal de cada nombre.
 * No reconstruye el documento ni intenta interpretar el resto de la página.
 */
export async function resolveMandatoryAnchorsWithOcrRows(
  file:File,
  workers:Person[],
  analysis:MandatoryPdfAnalysis,
  onProgress?: (message:string)=>void,
):Promise<MandatoryPdfAnalysis>{
  if(!analysis.unresolvedWorkerIds.length)return analysis;

  const unresolvedIds=new Set(analysis.unresolvedWorkerIds.map(Number));
  const unresolvedWorkers=workers.filter(worker=>unresolvedIds.has(Number(worker.id)));
  if(!unresolvedWorkers.length)return analysis;

  const pdfjs=await setupPdfJs();
  const data=new Uint8Array(await file.arrayBuffer());
  const loadingTask=pdfjs.getDocument({data,useSystemFonts:true});
  let worker:any=null;
  try {
  const pdf=await loadingTask.promise;
  worker=await createWorker('spa');
  const scale=2.2;
  const ocrRows:OcrWorkerRow[]=[];

  try{
    for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber+=1){
      onProgress?.(`Localizando filas de trabajadores con OCR · página ${pageNumber}/${pdf.numPages}…`);
      const page=await pdf.getPage(pageNumber);
      const base=page.getViewport({scale:1});
      const viewport=page.getViewport({scale});
      const canvas=document.createElement('canvas');
      canvas.width=Math.ceil(viewport.width);
      canvas.height=Math.ceil(viewport.height);
      const context=canvas.getContext('2d',{willReadFrequently:true});
      if(!context)continue;
      await page.render({canvas,canvasContext:context,viewport}).promise;
      const result:any=await (worker as any).recognize(canvas,{}, {blocks:true,tsv:true});
      ocrRows.push(...collectTesseractLines(result?.data,scale,Number(base.height),pageNumber));
    }
  }finally{
    await worker.terminate();worker=null;
  }

  if(!ocrRows.length)return analysis;

  const used=new Set<string>();
  for(const anchor of analysis.anchors){
    if(anchor.resolved&&anchor.nameX!=null&&anchor.nameY!=null){
      const nearest=ocrRows
        .filter(row=>row.page===anchor.page)
        .sort((a,b)=>Math.abs(a.centerY-Number(anchor.nameCenterY??anchor.nameY))-Math.abs(b.centerY-Number(anchor.nameCenterY??anchor.nameY)))[0];
      if(nearest&&scoreMandatoryWorkerNameText({apellidosNombre:anchor.workerName} as Person,nearest.text)>=0.82)used.add(nearest.key);
    }
  }

  const replacements=new Map<number,MandatoryWorkerAnchor>();
  for(const workerItem of unresolvedWorkers){
    const candidates=candidateOcrRowsForWorker(workerItem,ocrRows).filter(item=>!used.has(item.row.key));
    const best=candidates[0];
    if(!best)continue;
    if(candidates[1]&&best.score-candidates[1].score<0.025&&best.row.page===candidates[1].row.page){
      continue;
    }
    used.add(best.row.key);
    const row=best.row;
    replacements.set(Number(workerItem.id),{
      workerId:Number(workerItem.id),
      workerName:String(workerItem.apellidosNombre||row.text),
      dni:String(workerItem.dni||''),
      page:row.page,
      order:0,
      nameX:row.x,
      nameY:row.y,
      nameWidth:row.width,
      nameHeight:row.height,
      nameRightX:row.right,
      nameCenterY:row.centerY,
      rowHeight:Math.max(12,row.height*1.55),
      signatureX:null,
      signatureY:null,
      signatureWidth:null,
      signatureHeight:null,
      confidence:Math.min(0.98,best.score*(row.confidence>0?Math.max(.8,row.confidence/100):.9)),
      resolved:true,
      reason:'Nombre localizado por OCR de su línea visual antes de enviar el documento al portal.',
    });
  }

  const merged=analysis.anchors.map(anchor=>replacements.get(Number(anchor.workerId))||{...anchor});
  for(const anchor of merged){
    if(!anchor.resolved||anchor.nameRightX==null||anchor.nameY==null||anchor.nameHeight==null)continue;
    const peers=merged.filter(other=>other.resolved&&other.page===anchor.page&&other.workerId!==anchor.workerId&&other.nameCenterY!=null);
    const center=Number(anchor.nameCenterY??(anchor.nameY+anchor.nameHeight/2));
    const upper=peers.map(peer=>Number(peer.nameCenterY)).filter(y=>y>center).sort((a,b)=>a-b)[0]??null;
    const lower=peers.map(peer=>Number(peer.nameCenterY)).filter(y=>y<center).sort((a,b)=>b-a)[0]??null;
    const page=analysis.pages.find(meta=>meta.page===anchor.page);
    if(!page)continue;
    const box=computeSignatureBoxFromDetectedName({
      pageWidth:page.width,
      pageHeight:page.height,
      nameX:Number(anchor.nameX),
      nameY:Number(anchor.nameY),
      nameRightX:Number(anchor.nameRightX),
      nameHeight:Number(anchor.nameHeight),
      upperWorkerCenterY:upper,
      lowerWorkerCenterY:lower,
    });
    if(!box){
      anchor.resolved=false;
      anchor.reason='OCR localizó el nombre, pero no existe espacio seguro a su derecha.';
      continue;
    }
    anchor.signatureX=box.x;
    anchor.signatureY=box.y;
    anchor.signatureWidth=box.width;
    anchor.signatureHeight=box.height;
  }

  const validation=validateMandatorySignaturePlacement(merged,analysis.pages);
  const invalidIds=new Set(blockingMandatorySignatureIssues(validation.issues).map(issue=>Number(issue.workerId)));
  for(const anchor of merged){
    if(!invalidIds.has(Number(anchor.workerId)))continue;
    anchor.resolved=false;
    anchor.signatureX=null;
    anchor.signatureY=null;
    anchor.signatureWidth=null;
    anchor.signatureHeight=null;
    const messages=validation.issues.filter(issue=>Number(issue.workerId)===Number(anchor.workerId)).map(issue=>issue.message);
    anchor.reason=messages.join(' ')||'La posición OCR no supera la validación geométrica.';
  }

  const ordered=[...merged].sort((a,b)=>
    a.page-b.page ||
    Number(b.nameCenterY??b.nameY??-Infinity)-Number(a.nameCenterY??a.nameY??-Infinity) ||
    a.order-b.order
  );
  ordered.forEach((anchor,index)=>{anchor.order=index;});

  return {
    ...analysis,
    anchors:ordered,
    orderedWorkerIds:ordered.map(anchor=>anchor.workerId),
    unresolvedWorkerIds:ordered.filter(anchor=>!anchor.resolved).map(anchor=>anchor.workerId),
  };
  } finally { try { await worker?.terminate(); } finally { await loadingTask.destroy?.(); } }
}

export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
};

export const base64ToBytes = (value: string) => {
  const binary = atob(String(value || '').replace(/^data:application\/pdf;base64,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export async function fileToBase64(file: File) {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}

export async function sha256Hex(input: Uint8Array | ArrayBuffer) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2,'0')).join('');
}

let pdfLibPromise: Promise<any> | null = null;
const loadPdfLib = () => {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (pdfLibPromise) return pdfLibPromise;
  pdfLibPromise = new Promise((resolve,reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-pdf-lib="1"]');
    if (existing) {
      existing.addEventListener('load', () => window.PDFLib ? resolve(window.PDFLib) : reject(new Error('No se pudo iniciar el motor PDF.')), { once:true });
      existing.addEventListener('error', () => reject(new Error('No se pudo cargar el motor PDF.')), { once:true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
    script.async = true;
    script.dataset.pdfLib = '1';
    script.onload = () => window.PDFLib ? resolve(window.PDFLib) : reject(new Error('No se pudo iniciar el motor PDF.'));
    script.onerror = () => reject(new Error('No se pudo cargar el motor PDF.'));
    document.head.appendChild(script);
  });
  return pdfLibPromise;
};

const signatureDataToBytes = (value: string) => {
  const match = String(value || '').match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (!match) throw new Error('Formato de firma no válido.');
  return { type: match[1].toLowerCase(), bytes: base64ToBytes(match[2]) };
};

export async function buildSignedMandatoryPdf(input: {
  originalPdfBase64: string;
  anchors: MandatoryWorkerAnchor[];
  signatures: Record<string, { signature?: string } | string>;
}) {
  const PDFLib = await loadPdfLib();
  const originalBytes = base64ToBytes(input.originalPdfBase64);
  const pdfDoc = await PDFLib.PDFDocument.load(originalBytes, { updateMetadata: false });
  const pages = pdfDoc.getPages();
  const signedAnchors=input.anchors.filter(anchor=>{
    const raw=input.signatures[String(anchor.workerId)];
    return Boolean(typeof raw==='string'?raw:raw?.signature);
  });
  const placement=validateMandatorySignaturePlacement(
    signedAnchors,
    pages.map((page:any,index:number)=>{
      const size=page.getSize();
      return {page:index+1,width:Number(size.width),height:Number(size.height),rotation:0};
    }),
  );
  if(!placement.ok){
    const first=blockingMandatorySignatureIssues(placement.issues)[0];
    if(first)throw new Error(first?.message||'La colocación de una firma no supera la validación geométrica.');
  }

  for (const [anchorIndex,anchor] of input.anchors.entries()) {
    const raw = input.signatures[String(anchor.workerId)];
    const signature = typeof raw === 'string' ? raw : raw?.signature;
    if (!signature) continue;
    if(!anchor.resolved||anchor.signatureX==null||anchor.signatureY==null||anchor.signatureWidth==null||anchor.signatureHeight==null){
      throw new Error(`No se puede colocar la firma de ${anchor.workerName}: el nombre no está localizado con seguridad en el PDF original.`);
    }
    const page = pages[anchor.page - 1];
    if (!page) throw new Error(`No existe la página ${anchor.page} para una de las firmas.`);
    const decoded = signatureDataToBytes(signature);
    const image = decoded.type === 'png'
      ? await pdfDoc.embedPng(decoded.bytes)
      : await pdfDoc.embedJpg(decoded.bytes);
    const size=page.getSize();
    const boxWidth = Number(anchor.signatureWidth);
    const boxHeight = Number(anchor.signatureHeight);
    const boxX=Number(anchor.signatureX);
    const boxY=Number(anchor.signatureY);
    if(boxX<0||boxY<0||boxX+boxWidth>size.width||boxY+boxHeight>size.height){
      throw new Error(`La firma de ${anchor.workerName} quedaría fuera de la página y no se ha generado el documento.`);
    }
    const {width,height}=fitSignatureInsideBox({
      imageWidth:image.width,
      imageHeight:image.height,
      boxWidth,
      boxHeight,
    });
    page.drawImage(image, {
      x: boxX + Math.max(0, (boxWidth - width) / 2),
      y: boxY + Math.max(0, (boxHeight - height) / 2),
      width,
      height,
    });
  }

  return new Uint8Array(await pdfDoc.save({ useObjectStreams: false, addDefaultPage: false }));
}

const extractPdfText = async (pdf:any) => {
  const pages:string[] = [];
  for (let pageNumber=1; pageNumber<=pdf.numPages; pageNumber+=1) {
    const page = await pdf.getPage(pageNumber);
    const content = await readPdfTextContent(page);
    pages.push(content.items.map((item:any)=>String(item?.str || '')).join(' '));
  }
  return normalize(pages.join('\n'));
};

const renderPage = async (page:any, scale=0.85) => {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently:true });
  if (!context) throw new Error('No se pudo verificar visualmente el PDF.');
  await page.render({ canvas, canvasContext:context, viewport }).promise;
  return { viewport, image: context.getImageData(0,0,canvas.width,canvas.height) };
};

export async function verifyMandatoryPdfFidelity(
  originalPdfBase64: string,
  signedBytes: Uint8Array,
  anchors: MandatoryWorkerAnchor[],
): Promise<MandatoryFidelityReport> {
  const pdfjs = await setupPdfJs();
  const originalTask=pdfjs.getDocument({data:base64ToBytes(originalPdfBase64),useSystemFonts:true});
  let signedTask:any=null;
  try {
  const original=await originalTask.promise;
  signedTask=pdfjs.getDocument({data:signedBytes.slice(),useSystemFonts:true});
  const signed=await signedTask.promise;
  const pageCountMatches = original.numPages === signed.numPages;
  let dimensionsMatch = pageCountMatches;
  let visualSamples = 0;
  let visualMismatches = 0;

  if (pageCountMatches) {
    for (let pageNumber=1; pageNumber<=original.numPages; pageNumber+=1) {
      const a = await original.getPage(pageNumber);
      const b = await signed.getPage(pageNumber);
      const av = a.getViewport({ scale:1 });
      const bv = b.getViewport({ scale:1 });
      if (Math.abs(av.width-bv.width)>0.05 || Math.abs(av.height-bv.height)>0.05 || Number(a.rotate||0)!==Number(b.rotate||0)) {
        dimensionsMatch = false;
      }

      const originalRender = await renderPage(a);
      const signedRender = await renderPage(b);
      const width = Math.min(originalRender.image.width, signedRender.image.width);
      const height = Math.min(originalRender.image.height, signedRender.image.height);
      const masked = anchors
        .filter(anchor =>
          anchor.page===pageNumber &&
          anchor.resolved &&
          anchor.signatureX!=null &&
          anchor.signatureY!=null &&
          anchor.signatureWidth!=null &&
          anchor.signatureHeight!=null
        )
        .map((anchor,index) => {
          const boxWidth=Number(anchor.signatureWidth||Math.max(72,Math.min(96,av.width*0.16)));
          const boxHeight=Number(anchor.signatureHeight||18);
          const boxX=anchor.signatureX==null?Math.max(12,av.width-Math.max(14,av.width*0.02)-boxWidth):Number(anchor.signatureX);
          const boxY=anchor.signatureY==null?Math.max(18,av.height-118-((Number.isFinite(Number(anchor.order))?Number(anchor.order):index)*24)):Number(anchor.signatureY);
          const transform=Array.isArray(originalRender.viewport?.transform)
            ? originalRender.viewport.transform
            : [1,0,0,1,0,0];
          const mapPoint=(x:number,y:number)=>{
            const [a,b,c,d,e,f]=transform;
            return {
              x:(a*x)+(c*y)+e,
              y:(b*x)+(d*y)+f,
            };
          };
          const corners=[
            mapPoint(boxX,boxY),
            mapPoint(boxX+boxWidth,boxY),
            mapPoint(boxX,boxY+boxHeight),
            mapPoint(boxX+boxWidth,boxY+boxHeight),
          ];
          const xs=corners.map(point=>point.x);
          const ys=corners.map(point=>point.y);
          return {
            left: Math.floor(Math.min(...xs))-3,
            right: Math.ceil(Math.max(...xs))+3,
            top: Math.floor(Math.min(...ys))-3,
            bottom: Math.ceil(Math.max(...ys))+3,
          };
        });

      const aData = originalRender.image.data;
      const bData = signedRender.image.data;
      const stride = 4;
      for (let y=0; y<height; y+=stride) {
        for (let x=0; x<width; x+=stride) {
          if (masked.some(zone => x>=zone.left && x<=zone.right && y>=zone.top && y<=zone.bottom)) continue;
          const index=(y*originalRender.image.width+x)*4;
          const bIndex=(y*signedRender.image.width+x)*4;
          const diff =
            Math.abs(aData[index]-bData[bIndex]) +
            Math.abs(aData[index+1]-bData[bIndex+1]) +
            Math.abs(aData[index+2]-bData[bIndex+2]) +
            Math.abs(aData[index+3]-bData[bIndex+3]);
          visualSamples+=1;
          if (diff>24) visualMismatches+=1;
        }
      }
    }
  }

  const [originalText,signedText] = await Promise.all([extractPdfText(original),extractPdfText(signed)]);
  const textMatches = originalText === signedText;
  const visualMismatchRatio = visualSamples ? visualMismatches/visualSamples : 1;
  const ok = pageCountMatches && dimensionsMatch && textMatches && visualMismatchRatio <= 0.0025;
  return {
    ok,
    pageCountMatches,
    dimensionsMatch,
    textMatches,
    visualMismatchRatio,
    checkedAt:new Date().toISOString(),
  };
  } finally { await Promise.allSettled([originalTask.destroy?.(),signedTask?.destroy?.()]); }

}

export function pdfBlobFromBase64(value:string) {
  return new Blob([base64ToBytes(value)], { type:'application/pdf' });
}

export function pdfBlobFromBytes(value:Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return new Blob([copy.buffer], { type:'application/pdf' });
}



