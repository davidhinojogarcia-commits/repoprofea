import type { SubcontrataDocItem } from '../../types';

export type CaeDateFile = { name: string; extractedText?: string };

const toIso = (raw: string) => {
  const value = String(raw || '').trim();
  let m = value.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    const month = Number(m[2]);
    const day = Number(m[1]);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  m = value.match(/\b(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/);
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
};

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const addMonths = (iso: string, months: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};

const extractLabelled = (text: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const iso = toIso(match[1]);
    if (iso) return iso;
  }
  return '';
};

const DATE = '(\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}|20\\d{2}[\\/.-]\\d{1,2}[\\/.-]\\d{1,2})';
const issuePatterns = [
  new RegExp(`fecha\\s+de\\s+(?:emisi[oó]n|expedici[oó]n|firma|registro|inscripci[oó]n|alta|renovaci[oó]n|reconocimiento|formaci[oó]n|entrega)\\s*[:\\-]?\\s*${DATE}`, 'i'),
  new RegExp(`fecha\\s+(?:emisi[oó]n|expedici[oó]n|firma|registro|inscripci[oó]n|alta|renovaci[oó]n|reconocimiento|formaci[oó]n|entrega)\\s*[:\\-]?\\s*${DATE}`, 'i'),
  new RegExp(`(?:emitido|expedido|firmado|registrado|inscrito|realizado|entregado)\\s+(?:el|en fecha)?\\s*[:\\-]?\\s*${DATE}`, 'i'),
  new RegExp(`(?:fecha del documento|fecha documento|fecha certificado)\\s*[:\\-]?\\s*${DATE}`, 'i'),
];
const expiryPatterns = [
  new RegExp(`(?:vigente hasta|validez hasta|v[aá]lido hasta|caduca(?: el)?|vence(?: el)?|fecha de caducidad|fecha de vencimiento)\\s*[:\\-]?\\s*${DATE}`, 'i'),
];

const excludedDateContext = /\b(ley|real decreto|rd\s*\d|boe|convenio|nacimiento|fecha de nacimiento|expedicion del dni|constitucion de la empresa)\b/i;
const allPlausibleDates = (text: string) => {
  const result: string[] = [];
  const re = /\b(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const context = text.slice(Math.max(0, m.index - 80), Math.min(text.length, m.index + m[0].length + 80));
    if (excludedDateContext.test(context)) continue;
    const iso = toIso(m[0]);
    if (iso && !result.includes(iso)) result.push(iso);
  }
  return result;
};

const inferDates = (text: string, item?: SubcontrataDocItem) => {
  let issued = extractLabelled(text, issuePatterns);
  let expiry = extractLabelled(text, expiryPatterns);
  const candidates = allPlausibleDates(text);
  const today = new Date().toISOString().slice(0, 10);

  if (!issued) {
    const pastOrToday = candidates.filter(d => d <= today).sort().reverse();
    if (pastOrToday.length === 1) issued = pastOrToday[0];
  }
  if (!expiry) {
    const future = candidates.filter(d => d > today).sort();
    if (future.length === 1) expiry = future[0];
  }

  if (!expiry && issued && item?.mesesValidez) expiry = addMonths(issued, Number(item.mesesValidez));
  if (!expiry && issued && item?.diasValidez) expiry = addDays(issued, Number(item.diasValidez));
  return { issued, expiry };
};

export const fillCaeDocumentDates = (documents: any[], files: CaeDateFile[], checklist: SubcontrataDocItem[]) => {
  const fileMap = new Map(files.map(file => [file.name, file]));
  const checklistMap = new Map(checklist.map(item => [item.id, item]));
  return (Array.isArray(documents) ? documents : []).map(doc => {
    const file = fileMap.get(String(doc?.archivoOrigen || doc?.fileName || ''));
    if (!file) return doc;
    const inferred = inferDates(String(file.extractedText || ''), checklistMap.get(String(doc?.docId || '')));
    return {
      ...doc,
      fechaEmision: doc?.fechaEmision || inferred.issued,
      fechaCaducidad: doc?.fechaCaducidad || inferred.expiry,
    };
  });
};
