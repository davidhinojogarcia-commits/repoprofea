import { createWorker } from 'tesseract.js';
import { rememberPdfPageOcr } from './pdfOcrCache';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

export type ClientExtractedDocument = {
  text: string;
  source: 'pdf-native' | 'pdf-local-ocr' | 'image-local-ocr' | 'none';
};

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const setupPdfJs = async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }
  return pdfjs;
};

const canvasForPage = async (page: any, scale = 1.7) => {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No se pudo crear el lienzo de OCR.');
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas;
};

// PDF.js 6 recorre ReadableStream con for-await dentro de getTextContent().
// Safari/WebKit 26 implementa getReader(), pero no el iterador asíncrono del stream.
// Consumir el reader directamente evita "undefined is not a function" en iPhone/iPad.
export const readPdfTextContent = async (page: any) => {
  const stream = page.streamTextContent();
  const reader = stream.getReader();
  const content = {
    items: [] as any[],
    styles: Object.create(null) as Record<string, unknown>,
    lang: null as string | null,
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (!content.lang && value.lang) content.lang = value.lang;
      if (value.styles) Object.assign(content.styles, value.styles);
      if (Array.isArray(value.items)) content.items.push(...value.items);
    }
  } finally {
    if (typeof reader.releaseLock === 'function') reader.releaseLock();
  }

  return content;
};

const textItemsToLines = (items: any[]) => {
  let text = '';
  for (const item of items) {
    const value = typeof item?.str === 'string' ? item.str.trim() : '';
    if (!value) continue;
    text += value;
    text += item?.hasEOL ? '\n' : ' ';
  }
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
};

export async function extractClientDocumentText(
  file: File,
  onProgress?: (message: string) => void,
  options: { forceOcr?: boolean; ocrScale?: number } = {},
): Promise<ClientExtractedDocument> {
  const lower = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || lower.endsWith('.pdf');
  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(lower);
  if (!isPdf && !isImage) return { text: '', source: 'none' };

  if (isPdf) {
    const pdfjs = await setupPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true });
    try {
    const pdf = await loadingTask.promise;
    const nativePages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress?.(`Leyendo texto del PDF · página ${pageNumber}/${pdf.numPages}…`);
      const page = await pdf.getPage(pageNumber);
      const content = await readPdfTextContent(page);
      const text = textItemsToLines(content.items);
      if (text) nativePages.push(`[PÁGINA ${pageNumber}]\n${text}`);
    }

    const nativeText = nativePages.join('\n\n');
    if (!options.forceOcr && normalize(nativeText).length >= 80) {
      return { text: nativeText, source: 'pdf-native' };
    }

    onProgress?.(
      options.forceOcr
        ? 'Reforzando reconocimiento del PDF con OCR de alta resolución…'
        : 'PDF escaneado detectado · iniciando OCR local de respaldo…',
    );
    const worker = await createWorker('spa');
    try {
      const ocrPages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        onProgress?.(`OCR local · página ${pageNumber}/${pdf.numPages}…`);
        const page = await pdf.getPage(pageNumber);
        const canvas = await canvasForPage(page, options.ocrScale || (options.forceOcr ? 2.4 : 2));
        const result = await worker.recognize(canvas,{}, {blocks:true,text:true});
        rememberPdfPageOcr(file,pageNumber,result.data,options.ocrScale || (options.forceOcr ? 2.4 : 2));
        canvas.width=0;canvas.height=0;
        const text = String(result?.data?.text || '').trim();
        if (text) ocrPages.push(`[PÁGINA ${pageNumber}]\n${text}`);
      }
      const ocrText = ocrPages.join('\n\n');
      const combined = options.forceOcr && nativeText
        ? `${nativeText}\n\n[LECTURA OCR REFORZADA]\n${ocrText}`
        : ocrText;
      return { text: combined, source: ocrPages.length ? 'pdf-local-ocr' : (nativeText ? 'pdf-native' : 'none') };
    } finally {
      await worker.terminate();
    }
    } finally { await loadingTask.destroy?.(); }
  }

  onProgress?.('Ejecutando OCR local sobre la imagen…');
  const worker = await createWorker('spa');
  try {
    const result = await worker.recognize(file);
    const text = String(result?.data?.text || '').trim();
    return { text, source: text ? 'image-local-ocr' : 'none' };
  } finally {
    await worker.terminate();
  }
}

