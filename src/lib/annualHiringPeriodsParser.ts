import { extractClientDocumentText } from './clientDocumentText';

export type ParsedAnnualHiringPeriod = {
  month: number;
  monthName: string;
  startDate: string;
  endDate: string;
};

export type ParsedAnnualHiringPeriods = {
  obra: string;
  codigoObra: string;
  year: number;
  periods: ParsedAnnualHiringPeriod[];
  source: string;
  sourceText: string;
};

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MONTH_MAP = new Map(MONTHS.map((m, i) => [m.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(), i + 1]));
const norm = (v: string) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const iso = (d: string, fallbackYear: number) => {
  const m = d.match(/\b(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?\b/);
  if (!m) return '';
  const day = String(Number(m[1])).padStart(2, '0');
  const month = String(Number(m[2])).padStart(2, '0');
  let year = m[3] ? Number(m[3]) : fallbackYear;
  if (year < 100) year += 2000;
  return `${year}-${month}-${day}`;
};

const detectWork = (text: string) => {
  const n = norm(text);
  const codeMatch = n.match(/\b(\d{5})\s*[-–/:]?\s*(GR|EE)\b/) || n.match(/\b(GR|EE)\s*[-–/:]?\s*(\d{5})\b/);
  let codigoObra = '';
  if (codeMatch) codigoObra = /^\d/.test(codeMatch[1]) ? `${codeMatch[1]} ${codeMatch[2]}` : `${codeMatch[2]} ${codeMatch[1]}`;
  const explicit = text.match(/(?:OBRA|PROYECTO|DENOMINACI[ÓO]N(?:\s+DE\s+LA\s+OBRA)?)\s*[:\-]?\s*([^\n\r]{3,140})/i);
  const obra = String(explicit?.[1] || codigoObra).replace(/\s+/g, ' ').trim();
  return { obra, codigoObra };
};

function detectYear(text: string) {
  const years = Array.from(text.matchAll(/\b(20\d{2})\b/g)).map((m) => Number(m[1]));
  return years[0] || new Date().getFullYear();
}

function parsePeriods(text: string, year: number): ParsedAnnualHiringPeriod[] {
  const normalized = norm(text).replace(/\r/g, '\n');
  const out: ParsedAnnualHiringPeriod[] = [];
  for (const [monthKey, monthNumber] of MONTH_MAP.entries()) {
    const re = new RegExp(`\\b${monthKey}\\b`, 'g');
    let match: RegExpExecArray | null;
    let best: ParsedAnnualHiringPeriod | null = null;
    while ((match = re.exec(normalized))) {
      const nearby = normalized.slice(Math.max(0, match.index - 80), Math.min(normalized.length, match.index + monthKey.length + 180));
      const dates = Array.from(nearby.matchAll(/\b\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?\b/g)).map((m) => m[0]);
      if (dates.length >= 2) {
        const startDate = iso(dates[0], year);
        const endDate = iso(dates[1], year);
        if (startDate && endDate) {
          best = { month: monthNumber, monthName: MONTHS[monthNumber - 1], startDate, endDate };
          break;
        }
      }
    }
    if (best) out.push(best);
  }

  if (out.length < 3) {
    const flat = normalized.replace(/\n+/g, ' ').replace(/\s+/g, ' ');
    const generic = new RegExp(`(${Array.from(MONTH_MAP.keys()).join('|')})[^0-9]{0,60}(\\d{1,2}[\\/.\\-]\\d{1,2}(?:[\\/.\\-]\\d{2,4})?)[^0-9]{0,30}(\\d{1,2}[\\/.\\-]\\d{1,2}(?:[\\/.\\-]\\d{2,4})?)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = generic.exec(flat))) {
      const mn = MONTH_MAP.get(m[1]);
      if (!mn || out.some((p) => p.month === mn)) continue;
      out.push({ month: mn, monthName: MONTHS[mn - 1], startDate: iso(m[2], year), endDate: iso(m[3], year) });
    }
  }
  return out.sort((a, b) => a.month - b.month);
}

export async function parseAnnualHiringPeriodsPdf(file: File, onProgress?: (message: string) => void): Promise<ParsedAnnualHiringPeriods> {
  if (!(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
    throw new Error('Seleccione un documento PDF.');
  }
  const extracted = await extractClientDocumentText(file, onProgress);
  const text = extracted.text || '';
  if (!text.trim()) throw new Error('No se ha podido extraer texto del PDF.');
  const year = detectYear(text);
  const periods = parsePeriods(text, year);
  if (!periods.length) throw new Error('No se han reconocido periodos mensuales de contratación.');
  const work = detectWork(text);
  return { ...work, year, periods, source: extracted.source, sourceText: text };
}
