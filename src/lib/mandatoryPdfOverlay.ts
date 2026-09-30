import { readPdfTextContent } from './clientDocumentText';
import type { Person } from '../../types';

declare global {
  interface Window {
    PDFLib?: any;
  }
}

export type MandatoryWorkerAnchor = {
  workerId: number;
  workerName: string;
  dni: string;
  page: number;
  order: number;
  nameX: number | null;
  nameY: number | null;
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

const tokenEquivalent = (workerToken: string, lineToken: string) => {
  if (workerToken === lineToken) return true;
  const minLength = Math.min(workerToken.length, lineToken.length);
  if (minLength < 3) return false;
  return workerToken.startsWith(lineToken) || lineToken.startsWith(workerToken);
};

const scoreLineForWorker = (worker: Person, lineText: string) => {
  const lineNorm = normalize(lineText);
  const lineCompact = compact(lineText);
  const dni = compact(worker.dni);
  if (dni && dni.length >= 7 && lineCompact.includes(dni)) return 1;

  const fullName = cleanWorkerName(worker.apellidosNombre);
  if (!fullName) return 0;
  if (lineNorm === fullName) return 0.99;
  if (lineNorm.includes(fullName)) return 0.96;

  const tokens = workerNameTokens(worker);
  if (tokens.length < 2) return 0;
  const lineTokens = lineNorm.split(' ').filter(Boolean);
  const matched = tokens.filter(token => lineTokens.some(lineToken => tokenEquivalent(token, lineToken)));
  if (matched.length === tokens.length) return 0.93;

  // En listados reales es frecuente encontrar "APELLIDOS, N.", nombres abreviados
  // o pequeñas diferencias de escritura. Los dos primeros tokens suelen ser los
  // apellidos y permiten una coincidencia fuerte aunque el nombre venga abreviado.
  const surnameTokens = tokens.slice(0, Math.min(2, tokens.length));
  if (surnameTokens.length === 2 && surnameTokens.every(token => matched.includes(token))) return 0.91;

  const coverage = matched.length / tokens.length;
  if (matched.length >= 3 && coverage >= 0.75) return 0.89;
  if (matched.length >= 2 && coverage >= 0.6) return 0.84;
  return 0;
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

export async function analyzeMandatoryOriginalPdf(
  file: File,
  workers: Person[],
  onProgress?: (message:string)=>void,
  fallbackText = '',
): Promise<MandatoryPdfAnalysis> {
  const pdfjs = await setupPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pages: MandatoryPdfPageMeta[] = [];
  const pageLines: { page:number; width:number; height:number; signatureHeaderX:number|null; lines:ReturnType<typeof groupLines> }[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.(`Localizando trabajadores en el PDF original · página ${pageNumber}/${pdf.numPages}…`);
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
    });
  }

  const used = new Set<string>();
  const anchors: MandatoryWorkerAnchor[] = [];

  for (const worker of workers) {
    let best: {
      page:number;
      width:number;
      height:number;
      signatureHeaderX:number|null;
      line:any;
      lineIndex:number;
      score:number;
    } | null = null;
    let secondBestScore = 0;

    for (const pageInfo of pageLines) {
      for (let lineIndex=0; lineIndex<pageInfo.lines.length; lineIndex+=1) {
        const line=pageInfo.lines[lineIndex];
        const score = scoreLineForWorker(worker, line.text);
        if (score <= 0) continue;
        const key = `${pageInfo.page}:${lineIndex}`;
        if (used.has(key)) continue;
        if (!best || score > best.score) {
          if (best) secondBestScore = Math.max(secondBestScore, best.score);
          best = { ...pageInfo, line, lineIndex, score };
        } else {
          secondBestScore = Math.max(secondBestScore, score);
        }
      }
    }

    if (!best) {
      anchors.push({
        workerId: Number(worker.id),
        workerName: String(worker.apellidosNombre || ''),
        dni: String(worker.dni || ''),
        page: 1,
        order: Number.MAX_SAFE_INTEGER,
        nameX: null,
        nameY: null,
        rowHeight: null,
        signatureX: null,
        signatureY: null,
        signatureWidth: null,
        signatureHeight: null,
        confidence: 0,
        resolved: false,
        reason: 'No se pudo localizar con seguridad la fila del trabajador en el PDF original.',
      });
      continue;
    }

    used.add(`${best.page}:${best.lineIndex}`);
    const line = best.line;
    const rowHeight = Math.max(18, Math.min(42, line.height * 2.2));
    const dynamicHeaderX = best.signatureHeaderX != null && best.signatureHeaderX > line.maxX + 6
      ? best.signatureHeaderX
      : null;
    // Si el original no trae una cabecera "FIRMA", coloca la firma a la derecha
    // de la línea real del trabajador, sin reconstruir ni modificar el PDF.
    const rightMargin = Math.max(16, best.width * 0.025);
    const fallbackX = Math.max(line.maxX + 18, best.width * 0.66);
    const candidateX = dynamicHeaderX ?? Math.min(fallbackX, best.width - rightMargin - 82);
    const availableWidth = Math.max(0, best.width - rightMargin - candidateX);
    const fallbackSignatureWidth = Math.max(58, Math.min(92, best.width * 0.16));
    const safeCandidateX = availableWidth >= 58
      ? candidateX
      : Math.max(line.maxX + 8, best.width - rightMargin - fallbackSignatureWidth);
    const safeAvailableWidth = Math.max(0, best.width - rightMargin - safeCandidateX);
    const signatureWidth = Math.min(Math.max(58, safeAvailableWidth), 132);
    const signatureHeight = Math.min(38, Math.max(24, rowHeight * 1.15));
    const uniqueEnough = best.score >= 0.9 || (best.score >= 0.84 && (best.score - secondBestScore >= 0.08 || secondBestScore === 0));
    const resolved = uniqueEnough && safeAvailableWidth >= 54 && safeCandidateX < best.width - 50;
    const signatureY = Math.max(6, line.y - signatureHeight * 0.38);

    anchors.push({
      workerId: Number(worker.id),
      workerName: String(worker.apellidosNombre || ''),
      dni: String(worker.dni || ''),
      page: best.page,
      order: 0,
      nameX: line.minX,
      nameY: line.y,
      rowHeight,
      signatureX: resolved ? Number(safeCandidateX) : null,
      signatureY: resolved ? signatureY : null,
      signatureWidth: resolved ? signatureWidth : null,
      signatureHeight: resolved ? signatureHeight : null,
      confidence: best.score,
      resolved,
      ...(resolved ? {} : { reason: 'La coincidencia existe, pero no es suficientemente única para colocar la firma automáticamente.' }),
    });
  }

  // Si una fila concreta no se pudo leer con suficiente confianza, intentamos
  // reconstruir su posición a partir del orden real del documento y de las filas
  // vecinas ya localizadas. Esto evita bloquear la firma por una coma, abreviatura
  // o texto fragmentado por el PDF sin reconstruir el documento original.
  const workerIndex = new Map(workers.map((worker,index) => [Number(worker.id), index]));
  const resolvedByWorkerOrder = anchors
    .filter(anchor => anchor.resolved && anchor.nameY != null && anchor.signatureY != null)
    .sort((a,b) => Number(workerIndex.get(a.workerId) ?? Number.MAX_SAFE_INTEGER) - Number(workerIndex.get(b.workerId) ?? Number.MAX_SAFE_INTEGER));

  const rowSteps:number[] = [];
  for (let index=1; index<resolvedByWorkerOrder.length; index+=1) {
    const prev=resolvedByWorkerOrder[index-1];
    const next=resolvedByWorkerOrder[index];
    const prevIndex=workerIndex.get(prev.workerId);
    const nextIndex=workerIndex.get(next.workerId);
    if (prev.page!==next.page || prevIndex==null || nextIndex==null || nextIndex<=prevIndex) continue;
    const step=(Number(prev.nameY)-Number(next.nameY))/(nextIndex-prevIndex);
    if (step>=8 && step<=60) rowSteps.push(step);
  }
  rowSteps.sort((a,b)=>a-b);
  const medianRowStep=rowSteps.length ? rowSteps[Math.floor(rowSteps.length/2)] : 0;

  for (const anchor of anchors.filter(item => !item.resolved)) {
    const index=workerIndex.get(anchor.workerId);
    if (index==null) continue;
    const previous=[...resolvedByWorkerOrder].reverse().find(item => Number(workerIndex.get(item.workerId)) < index);
    const next=resolvedByWorkerOrder.find(item => Number(workerIndex.get(item.workerId)) > index);
    let template:MandatoryWorkerAnchor|null=null;
    let inferredNameY:number|null=null;

    if (previous && next && previous.page===next.page) {
      const previousIndex=Number(workerIndex.get(previous.workerId));
      const nextIndex=Number(workerIndex.get(next.workerId));
      const ratio=(index-previousIndex)/Math.max(1,nextIndex-previousIndex);
      inferredNameY=Number(previous.nameY)+(Number(next.nameY)-Number(previous.nameY))*ratio;
      template=Math.abs(index-previousIndex)<=Math.abs(nextIndex-index)?previous:next;
    } else if (medianRowStep && previous) {
      const previousIndex=Number(workerIndex.get(previous.workerId));
      if (index-previousIndex<=4) {
        inferredNameY=Number(previous.nameY)-medianRowStep*(index-previousIndex);
        template=previous;
      }
    } else if (medianRowStep && next) {
      const nextIndex=Number(workerIndex.get(next.workerId));
      if (nextIndex-index<=4) {
        inferredNameY=Number(next.nameY)+medianRowStep*(nextIndex-index);
        template=next;
      }
    }

    if (!template || inferredNameY==null) continue;
    const pageMeta=pages.find(page=>page.page===template!.page);
    if (!pageMeta || inferredNameY<8 || inferredNameY>pageMeta.height-8) continue;
    const signatureHeight=Number(template.signatureHeight||28);
    anchor.page=template.page;
    anchor.nameX=template.nameX;
    anchor.nameY=inferredNameY;
    anchor.rowHeight=template.rowHeight;
    anchor.signatureX=template.signatureX;
    anchor.signatureY=Math.max(6,inferredNameY-signatureHeight*0.38);
    anchor.signatureWidth=template.signatureWidth;
    anchor.signatureHeight=template.signatureHeight;
    anchor.confidence=Math.max(anchor.confidence,0.76);
    anchor.resolved=true;
    anchor.reason='Zona de firma inferida automáticamente a partir de las filas vecinas del documento original.';
  }

  const orderedResolved = anchors
    .filter(anchor => anchor.resolved)
    .sort((a,b) => a.page - b.page || Number(b.nameY || 0) - Number(a.nameY || 0));

  orderedResolved.forEach((anchor,index) => { anchor.order = index; });
  let nextOrder = orderedResolved.length;
  const normalizedFallback = normalize(fallbackText);
  const compactFallback = compact(fallbackText);
  anchors
    .filter(anchor => !anchor.resolved)
    .sort((a,b) => {
      const indexFor = (anchor:MandatoryWorkerAnchor) => {
        const dni=compact(anchor.dni);
        if(dni&&compactFallback.includes(dni))return compactFallback.indexOf(dni);
        const tokens=normalize(anchor.workerName).split(' ').filter(token=>token.length>=3);
        const probe=tokens.slice(0,Math.min(3,tokens.length)).join(' ');
        return probe ? normalizedFallback.indexOf(probe) : Number.MAX_SAFE_INTEGER;
      };
      const ai=indexFor(a), bi=indexFor(b);
      return (ai<0?Number.MAX_SAFE_INTEGER:ai)-(bi<0?Number.MAX_SAFE_INTEGER:bi);
    })
    .forEach(anchor => { anchor.order = nextOrder++; });

  const ordered = [...anchors].sort((a,b) => a.order - b.order);
  return {
    pageCount: pdf.numPages,
    pages,
    anchors: ordered,
    orderedWorkerIds: ordered.map(anchor => anchor.workerId),
    unresolvedWorkerIds: ordered.filter(anchor => !anchor.resolved).map(anchor => anchor.workerId),
  };
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

  for (const anchor of input.anchors) {
    if (!anchor.resolved) continue;
    const raw = input.signatures[String(anchor.workerId)];
    const signature = typeof raw === 'string' ? raw : raw?.signature;
    if (!signature) continue;
    const page = pages[anchor.page - 1];
    if (!page) throw new Error(`No existe la página ${anchor.page} para una de las firmas.`);
    const decoded = signatureDataToBytes(signature);
    const image = decoded.type === 'png'
      ? await pdfDoc.embedPng(decoded.bytes)
      : await pdfDoc.embedJpg(decoded.bytes);
    const boxWidth = Number(anchor.signatureWidth || 0);
    const boxHeight = Number(anchor.signatureHeight || 0);
    if (!boxWidth || !boxHeight || anchor.signatureX == null || anchor.signatureY == null) {
      throw new Error(`La posición de firma de ${anchor.workerName} no está confirmada.`);
    }
    const ratio = image.width / Math.max(1, image.height);
    let width = boxWidth;
    let height = width / ratio;
    if (height > boxHeight) {
      height = boxHeight;
      width = height * ratio;
    }
    page.drawImage(image, {
      x: Number(anchor.signatureX) + Math.max(0, (boxWidth - width) / 2),
      y: Number(anchor.signatureY) + Math.max(0, (boxHeight - height) / 2),
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
  const original = await pdfjs.getDocument({ data: base64ToBytes(originalPdfBase64), useSystemFonts:true }).promise;
  const signed = await pdfjs.getDocument({ data: signedBytes.slice(), useSystemFonts:true }).promise;
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
        .filter(anchor => anchor.resolved && anchor.page===pageNumber && anchor.signatureX!=null && anchor.signatureY!=null)
        .map(anchor => {
          const rect = originalRender.viewport.convertToViewportRectangle([
            Number(anchor.signatureX),
            Number(anchor.signatureY),
            Number(anchor.signatureX)+Number(anchor.signatureWidth||0),
            Number(anchor.signatureY)+Number(anchor.signatureHeight||0),
          ]);
          return {
            left: Math.floor(Math.min(rect[0],rect[2]))-3,
            right: Math.ceil(Math.max(rect[0],rect[2]))+3,
            top: Math.floor(Math.min(rect[1],rect[3]))-3,
            bottom: Math.ceil(Math.max(rect[1],rect[3]))+3,
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
}

export function pdfBlobFromBase64(value:string) {
  return new Blob([base64ToBytes(value)], { type:'application/pdf' });
}

export function pdfBlobFromBytes(value:Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return new Blob([copy.buffer], { type:'application/pdf' });
}
