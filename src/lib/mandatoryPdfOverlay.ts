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

const workerNameTokens = (worker: Person) =>
  normalize(worker.apellidosNombre)
    .split(' ')
    .filter(token => token.length >= 3 && !['DE','DEL','LA','LAS','LOS','Y'].includes(token));

const scoreLineForWorker = (worker: Person, lineText: string) => {
  const lineNorm = normalize(lineText);
  const lineCompact = compact(lineText);
  const dni = compact(worker.dni);
  if (dni && dni.length >= 7 && lineCompact.includes(dni)) return 1;

  const tokens = workerNameTokens(worker);
  if (!tokens.length) return 0;
  const hits = tokens.filter(token => lineNorm.includes(token)).length;
  if (hits >= Math.max(2, Math.ceil(tokens.length * 0.75))) return 0.92;
  if (hits >= Math.max(2, Math.ceil(tokens.length * 0.55))) return 0.78;
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

    for (const pageInfo of pageLines) {
      for (let lineIndex=0; lineIndex<pageInfo.lines.length; lineIndex+=1) {
        const line=pageInfo.lines[lineIndex];
        const score = scoreLineForWorker(worker, line.text);
        if (score <= 0) continue;
        const key = `${pageInfo.page}:${lineIndex}`;
        if (used.has(key)) continue;
        if (!best || score > best.score) {
          best = { ...pageInfo, line, lineIndex, score };
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
    const dynamicHeaderX = best.signatureHeaderX != null && best.signatureHeaderX > line.minX + 30
      ? best.signatureHeaderX
      : null;
    const candidateX = dynamicHeaderX != null
      ? dynamicHeaderX
      : Math.max(line.maxX + 10, line.minX + Math.max(160, (best.width - line.minX) * 0.58));
    const rightMargin = Math.max(16, best.width * 0.025);
    const availableWidth = best.width - rightMargin - candidateX;
    const signatureWidth = Math.min(Math.max(78, availableWidth), 132);
    const signatureHeight = Math.min(38, Math.max(24, rowHeight * 1.15));
    const resolved = best.score >= 0.78 && availableWidth >= 70 && candidateX < best.width - 70;
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
      signatureX: resolved ? candidateX : null,
      signatureY: resolved ? signatureY : null,
      signatureWidth: resolved ? signatureWidth : null,
      signatureHeight: resolved ? signatureHeight : null,
      confidence: best.score,
      resolved,
      ...(resolved ? {} : { reason: 'La fila se ha reconocido, pero no hay una zona de firma suficientemente segura.' }),
    });
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
  const digest = await crypto.subtle.digest('SHA-256', bytes);
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
  return new Blob([value], { type:'application/pdf' });
}
