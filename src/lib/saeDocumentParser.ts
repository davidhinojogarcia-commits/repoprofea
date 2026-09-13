import { extractClientDocumentText, readPdfTextContent } from './clientDocumentText';

export type SaeNeedCategoryDraft = { categoria: string; cantidad: number };
export type SaeNeedUnitDraft = {
  obra: string;
  codigoObra: string;
  mes: string;
  ano: number | null;
  categorias: SaeNeedCategoryDraft[];
  notas?: string;
};
export type SaeNeedDraft = SaeNeedUnitDraft & {
  sourceText: string;
  source: string;
  detectedNeeds: SaeNeedUnitDraft[];
};

export type SaeCandidateDraft = {
  orderNumber: number;
  fullNameOriginal: string;
  normalizedName: string;
  apellidos: string;
  nombre: string;
  pageNumber: number;
  overlayX: number;
  overlayY: number;
  confidence: 'Alta' | 'Media' | 'Baja';
};

export type SaeReportDraft = {
  offerNumber: string;
  obra: string;
  codigoObra: string;
  mes: string;
  quincena: string;
  categoria: string;
  candidates: SaeCandidateDraft[];
  sourceText: string;
  source: string;
};

const MONTHS = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
const ACCENT_RE = /[\u0300-\u036f]/g;

export const normalizeSaeText = (value: string) => String(value || '')
  .normalize('NFD').replace(ACCENT_RE, '')
  .replace(/\s+/g, ' ').trim().toUpperCase();

export const titleCaseSpanish = (value: string) => String(value || '')
  .toLocaleLowerCase('es-ES')
  .replace(/(^|[\s-])([a-záéíóúüñ])/g, (_m, sep, ch) => sep + ch.toLocaleUpperCase('es-ES'));

function inferNameParts(raw: string) {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return { apellidos: raw.trim(), nombre: '' };
  if (tokens.length === 2) return { apellidos: tokens[0], nombre: tokens[1] };
  return { apellidos: tokens.slice(0, 2).join(' '), nombre: tokens.slice(2).join(' ') };
}

function detectMonth(text: string): string {
  const norm = normalizeSaeText(text);
  return MONTHS.find(m => norm.includes(m)) || '';
}

function detectYear(text: string): number | null {
  const m = text.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function detectWork(text: string) {
  const norm = normalizeSaeText(text);
  const explicitCode = norm.match(/\b(\d{5})\s*(G\.?\s*R\.?|E\.?\s*E\.?)\b/i);
  const normalizedCode = explicitCode
    ? `${explicitCode[1]} ${explicitCode[2].replace(/\./g, '').replace(/\s+/g, '').toUpperCase()}`
    : '';
  const obraMatch = norm.match(/\bOBRA\s+([0-9A-Z.-]+(?:\s+[A-Z.]{1,5})?)/i);
  const codigoObra = normalizedCode || obraMatch?.[1]?.trim() || '';
  const explicit = text.match(/(?:OBRA|PROYECTO)\s*[:\-]?\s*([^\n\r]{3,80})/i);
  return { codigoObra, obra: explicit?.[1]?.trim() || codigoObra };
}

const compact = (value: string) => String(value || '').replace(/\s+/g, ' ').trim();

function extractOfficialCategories(block: string): SaeNeedCategoryDraft[] {
  const categories: SaeNeedCategoryDraft[] = [];
  const regex = /(\d{1,3})\s+([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9 .ºª/\-]{2,80}?)\s*\(\s*CN\s*:\s*(\d{5,10})\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(block))) {
    let role = compact(match[2])
      .replace(/^OFICIAL\s*1[ªºA]?\s*:\s*/i, '')
      .replace(/^[-–•]+\s*/, '')
      .trim();
    if (!role) continue;
    categories.push({
      categoria: `Oficial 1ª · ${titleCaseSpanish(role)} · CN ${match[3]}`,
      cantidad: Number(match[1]),
    });
  }
  return categories;
}

function extractNeedNotes(block: string): string {
  const notes: string[] = [];
  const sentences = block.split(/(?<=\.)\s+|\n+/).map(compact).filter(Boolean);
  for (const sentence of sentences) {
    if (/\b(termina|pr[oó]rroga|posible\s+cambio|pendiente)\b/i.test(sentence) && !/quincena\s*:\s*pendiente/i.test(sentence)) {
      notes.push(sentence.replace(/^[-–•]+\s*/, ''));
    }
  }
  return notes.join(' · ');
}

function extractStructuredProfeaNeeds(text: string): SaeNeedUnitDraft[] {
  const flat = text
    .replace(/\[P[ÁA]GINA\s+\d+\]/gi, ' ')
    .replace(/\r/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const month = titleCaseSpanish(detectMonth(text));
  const year = detectYear(text);
  const out: SaeNeedUnitDraft[] = [];
  const blockRegex = /\b(\d{5})\s*(GR|EE)\s*[-–]\s*([\s\S]*?)(?=\b\d{5}\s*(?:GR|EE)\s*[-–]|T[ÉE]CNICO\s+DE\s+EJECUCI[ÓO]N|Fdo\.|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(flat))) {
    const codigoObra = `${match[1]} ${String(match[2]).toUpperCase()}`;
    const block = compact(match[3]);
    const obraRaw = block.match(/^([\s\S]*?)(?=(?:[-–]\s*)?1[ªºA]?\s*QUINCENA\s*:)/i)?.[1] || '';
    const obra = titleCaseSpanish(compact(obraRaw).replace(/[-–\s]+$/, ''));
    const categorias: SaeNeedCategoryDraft[] = [];

    const q1 = block.match(/1[ªºA]?\s*QUINCENA\s*:\s*(\d{1,3})\s*PEONES?/i);
    if (q1) categorias.push({ categoria: 'Peones · 1ª Quincena', cantidad: Number(q1[1]) });
    const q2 = block.match(/2[ªºA]?\s*QUINCENA\s*:\s*(\d{1,3})\s*PEONES?/i);
    if (q2) categorias.push({ categoria: 'Peones · 2ª Quincena', cantidad: Number(q2[1]) });
    categorias.push(...extractOfficialCategories(block));

    const pending1 = /1[ªºA]?\s*QUINCENA\s*:\s*PENDIENTE/i.test(block);
    const pending2 = /2[ªºA]?\s*QUINCENA\s*:\s*PENDIENTE/i.test(block);
    if (pending1) categorias.push({ categoria: 'Peones · 1ª Quincena · PENDIENTE', cantidad: 0 });
    if (pending2) categorias.push({ categoria: 'Peones · 2ª Quincena · PENDIENTE', cantidad: 0 });

    out.push({
      obra: obra || codigoObra,
      codigoObra,
      mes: month,
      ano: year,
      categorias,
      notas: extractNeedNotes(block),
    });
  }
  return out;
}

function extractGenericNeed(text: string): SaeNeedUnitDraft {
  const { obra, codigoObra } = detectWork(text);
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const categories: SaeNeedCategoryDraft[] = [];
  const seen = new Set<string>();
  const categoryKeywords = /(PE[ÓO]N|OFICIAL|ENCARGAD|ALBAÑIL|CONDUCTOR|MAQUINISTA|JARDINER|FONTANER|ELECTRIC|PINTOR|CARPINTER|AUXILIAR|ADMINISTRAT)/i;

  for (const line of lines) {
    if (!categoryKeywords.test(line)) continue;
    const count = line.match(/(?:^|\s)(\d{1,3})(?:\s|$)/)?.[1] || line.match(/(\d{1,3})\s*(?:TRABAJADORES?|PERSONAS?|PUESTOS?)/i)?.[1];
    if (!count) continue;
    const cleanCategory = line
      .replace(/\b\d{1,3}\b/g, ' ')
      .replace(/(?:TRABAJADORES?|PERSONAS?|PUESTOS?|NECESITAMOS?|SOLICITAMOS?)/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    if (!cleanCategory) continue;
    const key = normalizeSaeText(cleanCategory);
    if (seen.has(key)) continue;
    seen.add(key);
    categories.push({ categoria: titleCaseSpanish(cleanCategory), cantidad: Number(count) });
  }

  return {
    obra: titleCaseSpanish(obra),
    codigoObra,
    mes: titleCaseSpanish(detectMonth(text)),
    ano: detectYear(text),
    categorias: categories,
    notas: '',
  };
}

export async function parseSaeNeedFile(file: File, onProgress?: (message: string) => void): Promise<SaeNeedDraft> {
  const extracted = await extractClientDocumentText(file, onProgress);
  const text = extracted.text || '';
  const structured = extractStructuredProfeaNeeds(text);
  const detectedNeeds = structured.length ? structured : [extractGenericNeed(text)];
  const first = detectedNeeds[0];
  return {
    ...first,
    sourceText: text,
    source: extracted.source,
    detectedNeeds,
  };
}

function extractCandidatesFromText(text: string): SaeCandidateDraft[] {
  const flat = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');
  const startMarker = /N[ºO°]?\s*ORDEN\s+PERSONAS\s+CANDIDATAS\s+C[ÓO]DIGO\s+SELECCI[ÓO]N/i;
  const start = startMarker.exec(flat);
  const tail = start ? flat.slice(start.index + start[0].length) : flat;
  const end = tail.search(/EL\s+N[ºO°]?\s+DE\s+ORDEN|INFORME\s+DE\s+RESULTADO\s+DE\s+SELECCI[ÓO]N/i);
  const body = end >= 0 ? tail.slice(0, end) : tail;
  const regex = /(?:^|\s)(\d{1,3})\s+([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ'\- ]{4,}?)(?=\s+\d{1,3}\s+[A-ZÁÉÍÓÚÜÑ]|$)/g;
  const out: SaeCandidateDraft[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body))) {
    const orderNumber = Number(match[1]);
    let fullNameOriginal = match[2].replace(/\s+/g, ' ').trim();
    fullNameOriginal = fullNameOriginal.replace(/\s+(C[ÓO]DIGO|SELECCI[ÓO]N).*$/i, '').trim();
    if (!orderNumber || fullNameOriginal.length < 5) continue;
    const parts = inferNameParts(fullNameOriginal);
    out.push({
      orderNumber,
      fullNameOriginal,
      normalizedName: titleCaseSpanish(fullNameOriginal),
      apellidos: titleCaseSpanish(parts.apellidos),
      nombre: titleCaseSpanish(parts.nombre),
      pageNumber: 2,
      overlayX: 184,
      overlayY: 52 + (orderNumber - 1) * 7.8,
      confidence: 'Media',
    });
  }
  return out;
}

async function enrichCoordinatesFromPdf(file: File, candidates: SaeCandidateDraft[]): Promise<SaeCandidateDraft[]> {
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') return candidates;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    const byOrder = new Map<number, SaeCandidateDraft>();
    candidates.forEach(c => byOrder.set(c.orderNumber, { ...c }));

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await readPdfTextContent(page);
      const items = content.items.filter(i => typeof i?.str === 'string' && i.str.trim());
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const order = Number(String(item.str).trim());
        if (!byOrder.has(order)) continue;
        const nearby = items.slice(i + 1, i + 8).map(x => String(x.str || '').trim()).join(' ');
        const candidate = byOrder.get(order)!;
        const targetNorm = normalizeSaeText(candidate.fullNameOriginal);
        if (!normalizeSaeText(nearby).includes(targetNorm.slice(0, Math.min(14, targetNorm.length)))) continue;
        const yPdf = Number(item.transform?.[5] || 0);
        const yTopPt = viewport.height - yPdf;
        candidate.pageNumber = pageNumber;
        candidate.overlayX = 182;
        candidate.overlayY = Math.max(8, yTopPt * 25.4 / 72 - 1.2);
        candidate.confidence = 'Alta';
      }
    }
    return Array.from(byOrder.values()).sort((a, b) => a.orderNumber - b.orderNumber);
  } catch {
    return candidates;
  }
}

export async function parseSaeReportFile(file: File, onProgress?: (message: string) => void): Promise<SaeReportDraft> {
  const extracted = await extractClientDocumentText(file, onProgress);
  const text = extracted.text || '';
  const norm = normalizeSaeText(text);
  const offerNumber = text.match(/Identificador\s+Oferta\s*:\s*([0-9-]+)/i)?.[1]?.trim() || '';
  const period = norm.match(/([12](?:A|ª|º)?\s*QUINCENA)\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)/i);
  const quincena = period ? `${period[1].replace(/A/i, 'ª')} ${titleCaseSpanish(period[2])}` : '';
  const mes = period ? titleCaseSpanish(period[2]) : titleCaseSpanish(detectMonth(text));
  const { obra, codigoObra } = detectWork(text);
  const denomination = text.match(/Denominaci[oó]n\s+del\s+puesto\s*:\s*([\s\S]{0,240}?)(?=Ubicaci[oó]n\s+del\s+puesto|\[P[AÁ]GINA|Listado\s+de\s+Selecci[oó]n)/i)?.[1]
    ?.replace(/\s+/g, ' ').trim() || '';
  const categoria = denomination
    .replace(/.*?PFEA\s+[^-]+-/i, '')
    .replace(/-\s*[12](?:ª|A|º)?\s*QUINCENA.*$/i, '')
    .trim() || denomination;
  const baseCandidates = extractCandidatesFromText(text);
  const candidates = await enrichCoordinatesFromPdf(file, baseCandidates);
  return {
    offerNumber,
    obra: titleCaseSpanish(obra),
    codigoObra,
    mes,
    quincena,
    categoria: titleCaseSpanish(categoria),
    candidates,
    sourceText: text,
    source: extracted.source,
  };
}

export async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}
