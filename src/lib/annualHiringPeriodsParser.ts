import { extractClientDocumentText } from './clientDocumentText';

export type ParsedAnnualHiringMonth = {
  month: number;
  monthName: string;
  period1Start: string;
  period1End: string;
  period2Start: string;
  period2End: string;
  warnings?: string[];
};

export type ParsedAnnualHiringPeriods = {
  year: number;
  months: ParsedAnnualHiringMonth[];
  source: string;
  sourceText: string;
};

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const norm = (v: string) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

const parseDate = (value: string) => {
  const m = value.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
  if (!m) return '';
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  return `${year}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
};

function detectYear(text: string) {
  const title = norm(text).match(/PERIODOS?\s+DE\s+CONTRATACION[^\n]{0,80}\b(20\d{2})\b/)?.[1];
  if (title) return Number(title);
  const years = Array.from(text.matchAll(/\b(20\d{2})\b/g)).map((m) => Number(m[1]));
  const counts = new Map<number, number>();
  years.forEach((y) => counts.set(y, (counts.get(y) || 0) + 1));
  return [...counts.entries()].sort((a,b) => b[1] - a[1])[0]?.[0] || new Date().getFullYear();
}

type Range = { start: string; end: string; month: number; explicitPeriod?: 1 | 2; raw: string };

function collectRanges(text: string): Range[] {
  const n = norm(text).replace(/\r/g, '\n').replace(/[ \t]+/g, ' ');
  const ranges: Range[] = [];
  const re = /(?:(PERIODO\s*([12]))\s*)?DEL\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s+AL\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(n))) {
    const start = parseDate(m[3]);
    const end = parseDate(m[4]);
    if (!start || !end) continue;
    const month = Number(start.slice(5,7));
    const explicit = m[2] === '1' ? 1 : m[2] === '2' ? 2 : undefined;
    ranges.push({ start, end, month, explicitPeriod: explicit, raw: m[0] });
  }
  return ranges;
}

function parseMonths(text: string, year: number): ParsedAnnualHiringMonth[] {
  const ranges = collectRanges(text);
  const result: ParsedAnnualHiringMonth[] = [];

  for (let month = 1; month <= 12; month += 1) {
    const monthRanges = ranges
      .filter((r) => r.month === month)
      .sort((a,b) => a.start.localeCompare(b.start));
    if (!monthRanges.length) continue;

    const warnings: string[] = [];
    let p1 = monthRanges.find((r) => r.explicitPeriod === 1);
    let p2 = monthRanges.find((r) => r.explicitPeriod === 2);

    if (!p1) p1 = monthRanges[0];
    if (!p2) p2 = monthRanges.find((r) => r !== p1) || undefined;

    const validate = (label: string, r?: Range) => {
      if (!r) return;
      const startYear = Number(r.start.slice(0,4));
      const endYear = Number(r.end.slice(0,4));
      if (startYear !== year || endYear !== year) warnings.push(`${label}: alguna fecha no coincide con la anualidad ${year}. Revísala antes de guardar.`);
      if (Number(r.end.slice(5,7)) !== month) warnings.push(`${label}: la fecha fin no pertenece al mes ${MONTHS[month-1]}.`);
      if (r.end < r.start) warnings.push(`${label}: la fecha fin es anterior a la fecha inicio.`);
    };
    validate('Periodo 1', p1);
    validate('Periodo 2', p2);

    result.push({
      month,
      monthName: MONTHS[month - 1],
      period1Start: p1?.start || '',
      period1End: p1?.end || '',
      period2Start: p2?.start || '',
      period2End: p2?.end || '',
      warnings,
    });
  }

  return result;
}

export async function parseAnnualHiringPeriodsPdf(file: File, onProgress?: (message: string) => void): Promise<ParsedAnnualHiringPeriods> {
  if (!(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
    throw new Error('Seleccione un documento PDF.');
  }
  const extracted = await extractClientDocumentText(file, onProgress);
  const text = extracted.text || '';
  if (!text.trim()) throw new Error('No se ha podido extraer texto del PDF.');
  const year = detectYear(text);
  const months = parseMonths(text, year);
  if (!months.length) throw new Error('No se han reconocido periodos de contratación en el PDF.');
  return { year, months, source: extracted.source, sourceText: text };
}
