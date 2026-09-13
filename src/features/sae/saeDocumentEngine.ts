import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type {
  SaeCandidate,
  SaeConfidence,
  SaeDocumentExtraction,
  SaeEvidence,
  SaeNeed,
  SaeNeedCategory,
  SaeTextRow,
} from './types';

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

const CATEGORY_HINTS = [
  'oficial 1', 'oficial 2', 'oficial primera', 'oficial segunda', 'peon',
  'gruista', 'encargado', 'capataz', 'albanil', 'electricista', 'fontanero',
  'pintor', 'conductor', 'jardinero', 'administrativo', 'soldador',
];

export const normalizeSearchText = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9]+/g, ' ')
  .trim()
  .toLowerCase();

export const normalizePersonName = (value: string) => value
  .replace(/\s+/g, ' ')
  .replace(/^\s+|\s+$/g, '')
  .replace(/^(.+?),\s*(.+)$/, '$2 $1')
  .toLocaleLowerCase('es-ES')
  .replace(/(^|[\s-])([\p{L}])/gu, (_all, prefix, letter) => `${prefix}${letter.toLocaleUpperCase('es-ES')}`);

const confidenceFor = (score: number): SaeConfidence => score >= 0.82 ? 'alta' : score >= 0.58 ? 'media' : 'baja';
const safeNumber = (value: string | undefined) => value ? Number.parseInt(value, 10) : 0;
const cleanCategory = (value: string) => normalizePersonName(value.replace(/\btrabajadores?\b/gi, '').trim());

const groupItemsIntoRows = (items: any[], page: number, pageWidth: number, pageHeight: number): SaeTextRow[] => {
  const positioned = items
    .filter(item => String(item.str || '').trim())
    .map(item => ({
      text: String(item.str).trim(),
      x: Number(item.transform?.[4] || 0),
      y: pageHeight - Number(item.transform?.[5] || 0),
      width: Math.max(Number(item.width || 0), 1),
      height: Math.max(Math.abs(Number(item.height || item.transform?.[3] || 9)), 5),
    }))
    .sort((a, b) => Math.abs(a.y - b.y) > 3 ? a.y - b.y : a.x - b.x);

  const buckets: Array<typeof positioned> = [];
  positioned.forEach(item => {
    const bucket = buckets.find(row => Math.abs((row[0]?.y || 0) - item.y) <= Math.max(3, item.height * 0.35));
    if (bucket) bucket.push(item); else buckets.push([item]);
  });

  return buckets.map((bucket, rowIndex) => {
    bucket.sort((a, b) => a.x - b.x);
    const minX = Math.min(...bucket.map(item => item.x));
    const minY = Math.min(...bucket.map(item => item.y));
    const maxX = Math.max(...bucket.map(item => item.x + item.width));
    const maxY = Math.max(...bucket.map(item => item.y + item.height));
    return {
      page, rowIndex, text: bucket.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim(),
      x: minX, y: minY, width: maxX - minX, height: maxY - minY, pageWidth, pageHeight,
    };
  }).filter(row => row.text.length > 1);
};

const renderPdfPage = async (page: any, scale = 1.75) => {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('El navegador no permite preparar la página para OCR.');
  await page.render({ canvasContext: context, viewport }).promise;
  return { canvas, viewport, scale };
};

const ocrCanvasRows = async (
  canvas: HTMLCanvasElement,
  page: number,
  pageWidth: number,
  pageHeight: number,
  scale: number,
  onProgress?: (message: string) => void,
): Promise<SaeTextRow[]> => {
  const { recognize } = await import('tesseract.js');
  const result: any = await recognize(canvas, 'spa', {
    logger: (event: any) => {
      if (event?.status === 'recognizing text') {
        onProgress?.(`OCR página ${page}: ${Math.round((event.progress || 0) * 100)} %`);
      }
    },
  });
  const words: any[] = Array.isArray(result?.data?.words) ? result.data.words : [];
  if (words.length) {
    const items = words.filter(word => String(word.text || '').trim()).map(word => ({
      str: word.text,
      transform: [1, 0, 0, 1, Number(word.bbox?.x0 || 0) / scale, pageHeight - (Number(word.bbox?.y0 || 0) / scale)],
      width: Math.max(1, Number(word.bbox?.x1 - word.bbox?.x0 || 0) / scale),
      height: Math.max(5, Number(word.bbox?.y1 - word.bbox?.y0 || 0) / scale),
    }));
    return groupItemsIntoRows(items, page, pageWidth, pageHeight);
  }
  return String(result?.data?.text || '')
    .split(/\r?\n/)
    .map((text, rowIndex) => ({
      page, rowIndex, text: text.trim(), x: 20, y: 20 + rowIndex * 12,
      width: Math.max(pageWidth - 40, 10), height: 10, pageWidth, pageHeight,
    }))
    .filter(row => row.text.length > 1);
};

export async function extractSaeDocument(
  file: File,
  onProgress?: (message: string) => void,
): Promise<SaeDocumentExtraction> {
  const lowerName = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
  const imageMime = file.type || (lowerName.endsWith('.png') ? 'image/png' : /\.jpe?g$/.test(lowerName) ? 'image/jpeg' : '');
  if (!isPdf && !/^image\/(jpeg|png)$/.test(imageMime)) {
    throw new Error('Formato no admitido. Utiliza PDF, JPG, JPEG o PNG.');
  }

  if (!isPdf) {
    onProgress?.('Preparando imagen para OCR…');
    const image = new Image();
    const url = URL.createObjectURL(file);
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('No se pudo leer la imagen.'));
        image.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      const rows = await ocrCanvasRows(canvas, 1, image.naturalWidth, image.naturalHeight, 1, onProgress);
      return { file, method: 'ocr', rows, fullText: rows.map(row => row.text).join('\n'), pageCount: 1,
        pageImages: [{ page: 1, dataUrl: canvas.toDataURL(imageMime || 'image/png'), width: image.naturalWidth, height: image.naturalHeight }] };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const rows: SaeTextRow[] = [];
  let usedNative = false;
  let usedOcr = false;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.(`Leyendo página ${pageNumber} de ${pdf.numPages}…`);
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const nativeRows = groupItemsIntoRows(content.items as any[], pageNumber, viewport.width, viewport.height);
    const nativeQuality = nativeRows.map(row => row.text).join(' ').replace(/\s/g, '').length;
    if (nativeQuality >= 40) {
      rows.push(...nativeRows);
      usedNative = true;
      continue;
    }
    const rendered = await renderPdfPage(page);
    rows.push(...await ocrCanvasRows(rendered.canvas, pageNumber, viewport.width, viewport.height, rendered.scale, onProgress));
    usedOcr = true;
  }
  const method = usedNative && usedOcr ? 'hybrid' : usedOcr ? 'ocr' : 'native';
  return { file, method, rows, fullText: rows.map(row => row.text).join('\n'), pageCount: pdf.numPages };
}

export function parseNeedExtraction(extraction: SaeDocumentExtraction): Partial<SaeNeed> & { categories: SaeNeedCategory[] } {
  const text = extraction.fullText;
  const evidence: SaeEvidence[] = [];
  const findRow = (regex: RegExp) => extraction.rows.find(row => regex.test(row.text));
  const workRow = findRow(/\b(?:obra|centro\s+de\s+trabajo)\s*[:\-]/i);
  const workMatch = workRow?.text.match(/\b(?:obra|centro\s+de\s+trabajo)\s*[:\-]\s*(.+)$/i);
  const codeRow = findRow(/\b(?:c[oó]digo|c[oó]d\.?|expediente)\s*(?:de\s+obra)?\s*[:\-]/i);
  const codeMatch = codeRow?.text.match(/\b(?:c[oó]digo|c[oó]d\.?|expediente)\s*(?:de\s+obra)?\s*[:\-]\s*([\w./-]+)/i);
  const monthMatch = normalizeSearchText(text).match(new RegExp(`\\b(${Object.keys(MONTHS).join('|')})\\b`));
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const categories = new Map<string, SaeNeedCategory>();

  extraction.rows.forEach(row => {
    const normalized = normalizeSearchText(row.text);
    const countAtEnd = row.text.match(/(?:^|\s)(\d{1,3})\s*(?:trabajador(?:es)?|persona(?:s)?|puesto(?:s)?)?\s*$/i);
    const countAtStart = row.text.match(/^\s*(\d{1,3})\s+(?:x\s+)?(.+)$/i);
    let count = safeNumber(countAtEnd?.[1]);
    let label = countAtEnd ? row.text.slice(0, countAtEnd.index).replace(/[:;.-]+$/g, '').trim() : '';
    if (!count && countAtStart) { count = safeNumber(countAtStart[1]); label = countAtStart[2].trim(); }
    const looksLikeCategory = CATEGORY_HINTS.some(hint => normalized.includes(hint)) || /categor[ií]a/i.test(row.text);
    if (!looksLikeCategory || !count || count > 999 || label.length < 2) return;
    label = label.replace(/categor[ií]a\s*[:\-]?/i, '').trim();
    const category = cleanCategory(label);
    const key = normalizeSearchText(category);
    if (!key || /total/.test(key)) return;
    categories.set(key, { category, requestedCount: count });
    evidence.push({ field: `category:${category}`, value: String(count), page: row.page, text: row.text, confidence: 'alta' });
  });

  const workName = workMatch?.[1]?.trim() || '';
  if (workRow && workName) evidence.push({ field: 'workName', value: workName, page: workRow.page, text: workRow.text, confidence: 'alta' });
  if (codeRow && codeMatch?.[1]) evidence.push({ field: 'workCode', value: codeMatch[1], page: codeRow.page, text: codeRow.text, confidence: 'media' });
  return {
    workName,
    workCode: codeMatch?.[1] || '',
    month: monthMatch ? MONTHS[monthMatch[1]] : new Date().getMonth() + 1,
    year: yearMatch ? Number(yearMatch[1]) : new Date().getFullYear(),
    categories: Array.from(categories.values()),
    totalRequested: Array.from(categories.values()).reduce((sum, item) => sum + item.requestedCount, 0),
    extractionEvidence: evidence,
    sourceFileName: extraction.file.name,
  };
}

const detectCategory = (row: string, knownCategories: string[]) => {
  const normalized = normalizeSearchText(row);
  const match = knownCategories.find(category => normalized.includes(normalizeSearchText(category)));
  if (match) return { value: match, confidence: 'alta' as SaeConfidence };
  const generic = CATEGORY_HINTS.find(hint => normalized.includes(hint));
  return generic ? { value: cleanCategory(generic), confidence: 'media' as SaeConfidence } : { value: '', confidence: 'baja' as SaeConfidence };
};

export const detectSaeLegend = (text: string) => {
  const result: Record<string, string> = {};
  text.split(/\r?\n/).forEach(line => {
    const match = line.match(/\b(\d{3,6})\b\s*(?:[-:=]|\.{2,})\s*(contratad[oa]|no\s+contratad[oa]|rechazad[oa]|seleccionad[oa])/i);
    if (match) result[normalizeSearchText(match[2])] = match[1];
  });
  return result;
};

export function parseCandidateRows(extraction: SaeDocumentExtraction, need: Pick<SaeNeed, 'id' | 'workName' | 'workCode' | 'month' | 'categories'>, reportId: string): SaeCandidate[] {
  const knownCategories = need.categories.map(item => item.category);
  const documentOffer = extraction.fullText.match(/(?:oferta|of\.)\s*(?:sae\s*)?(?:n[ºo°]\s*)?([A-Z0-9/-]{3,})/i)?.[1];
  const candidates: SaeCandidate[] = [];
  extraction.rows.forEach(row => {
    const dni = row.text.match(/\b(?:[XYZ]\d{7}[A-Z]|\d{8}[A-Z])\b/i)?.[0]?.toUpperCase();
    const commaName = row.text.match(/\b([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ' -]{2,}),\s*([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ' -]{1,})\b/);
    const columnParts = row.text.split(/\s{2,}|\t|\.{3,}/).map(part => part.trim()).filter(Boolean);
    const likelyPart = columnParts.find(part => {
      const words = part.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]+/g) || [];
      return words.length >= 2 && words.length <= 7 && !/oferta|categor|resultado|codigo|obra/i.test(part);
    });
    let originalName = commaName ? `${commaName[1]}, ${commaName[2]}` : likelyPart || '';
    if (!originalName && dni) {
      originalName = row.text.slice(0, row.text.indexOf(dni)).replace(/^\s*\d+\s*/, '').trim();
    }
    const normalizedName = normalizePersonName(originalName);
    const nameWords = normalizedName.split(/\s+/).filter(Boolean);
    const category = detectCategory(row.text, knownCategories);
    const hasCandidateShape = Boolean(dni || commaName || (category.value && nameWords.length >= 2));
    if (!hasCandidateShape || nameWords.length < 2 || /apellidos|nombre\s+completo|candidato/i.test(originalName)) return;
    const offerNumber = row.text.match(/(?:oferta|of\.)\s*(?:sae\s*)?(?:n[ºo°]\s*)?([A-Z0-9/-]{3,})/i)?.[1] || documentOffer;
    const date = row.text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
    const fortnight = /(?:1[ªa]|primera)\s*quincena/i.test(row.text) ? 1 : /(?:2[ªa]|segunda)\s*quincena/i.test(row.text) ? 2 : null;
    const score = (dni ? 0.4 : 0) + (commaName ? 0.32 : likelyPart ? 0.2 : 0) + (category.value ? 0.28 : 0);
    const confidence = confidenceFor(score);
    const evidence: SaeEvidence[] = [
      { field: 'name', value: originalName, page: row.page, text: row.text, confidence: commaName ? 'alta' : 'media' },
      { field: 'category', value: category.value, page: row.page, text: row.text, confidence: category.confidence },
    ];
    if (dni) evidence.push({ field: 'dniNie', value: dni, page: row.page, text: row.text, confidence: 'alta' });
    candidates.push({
      id: crypto.randomUUID(), needId: need.id, sourceReportId: reportId,
      originalFullName: originalName, normalizedFullName: normalizedName,
      firstName: commaName?.[2] ? normalizePersonName(commaName[2]) : undefined,
      surnames: commaName?.[1] ? normalizePersonName(commaName[1]) : undefined,
      dniNie: dni, category: category.value, offerNumber,
      workName: need.workName, workCode: need.workCode, month: need.month, fortnight,
      expectedHireDate: date ? `${date[3]}-${date[2].padStart(2, '0')}-${date[1].padStart(2, '0')}` : undefined,
      sourcePage: row.page, sourceRowText: row.text,
      sourcePosition: {
        page: row.page, rowIndex: row.rowIndex, x: row.x, y: row.y, width: row.width,
        height: row.height, pageWidth: row.pageWidth, pageHeight: row.pageHeight,
        resultX: Math.min(Math.max(row.x + row.width + 8, row.pageWidth * 0.72), row.pageWidth - 46),
      },
      confidence, evidence, status: fortnight === 1 ? 'primera_quincena' : fortnight === 2 ? 'segunda_quincena' : category.value ? 'sin_asignar' : 'pendiente_datos',
      selectedForHire: false,
    });
  });

  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${candidate.sourceReportId}:${candidate.sourcePage}:${candidate.sourcePosition.rowIndex}:${normalizeSearchText(candidate.originalFullName)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function generateCompletedSaePdf(
  original: ArrayBuffer,
  mimeType: string,
  candidates: SaeCandidate[],
): Promise<Uint8Array> {
  let pdf: PDFDocument;
  if (mimeType === 'application/pdf') {
    pdf = await PDFDocument.load(original);
  } else {
    pdf = await PDFDocument.create();
    const bytes = new Uint8Array(original);
    const image = mimeType === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  candidates.filter(candidate => candidate.resultCode).forEach(candidate => {
    const position = candidate.sourcePosition;
    const page = pdf.getPages()[Math.max(0, Math.min(pdf.getPageCount() - 1, position.page - 1))];
    const pageHeight = page.getHeight();
    const scaleX = page.getWidth() / Math.max(position.pageWidth, 1);
    const scaleY = pageHeight / Math.max(position.pageHeight, 1);
    const x = (position.resultX + (candidate.alignmentOffsetX || 0)) * scaleX;
    const y = pageHeight - (position.y + position.height + (candidate.alignmentOffsetY || 0)) * scaleY;
    page.drawText(String(candidate.resultCode), { x, y: Math.max(2, y), size: Math.max(7, Math.min(11, position.height * scaleY)), font, color: rgb(0, 0, 0) });
  });
  return pdf.save();
}
