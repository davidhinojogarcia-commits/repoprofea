import { createWorker } from 'tesseract.js';

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
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
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
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
};

export async function extractClientDocumentText(
  file: File,
  onProgress?: (message: string) => void,
): Promise<ClientExtractedDocument> {
  const lower = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || lower.endsWith('.pdf');
  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(lower);
  if (!isPdf && !isImage) return { text: '', source: 'none' };

  if (isPdf) {
    const pdfjs = await setupPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    const nativePages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress?.(`Leyendo texto del PDF · página ${pageNumber}/${pdf.numPages}…`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = (content.items as any[])
        .map(item => typeof item?.str === 'string' ? item.str : '')
        .filter(Boolean)
        .join(' ')
        .trim();
      if (text) nativePages.push(`[PÁGINA ${pageNumber}]\n${text}`);
    }

    const nativeText = nativePages.join('\n\n');
    if (normalize(nativeText).length >= 80) return { text: nativeText, source: 'pdf-native' };

    onProgress?.('PDF escaneado detectado · iniciando OCR local de respaldo…');
    const worker = await createWorker('spa');
    try {
      const ocrPages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        onProgress?.(`OCR local · página ${pageNumber}/${pdf.numPages}…`);
        const page = await pdf.getPage(pageNumber);
        const canvas = await canvasForPage(page, 1.8);
        const result = await worker.recognize(canvas);
        const text = String(result?.data?.text || '').trim();
        if (text) ocrPages.push(`[PÁGINA ${pageNumber}]\n${text}`);
      }
      return { text: ocrPages.join('\n\n'), source: ocrPages.length ? 'pdf-local-ocr' : 'none' };
    } finally {
      await worker.terminate();
    }
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
