import type { Person } from '../../types';
import type { WorksiteDocumentContext } from './worksiteDocumentsPdf';
import * as base from './worksiteAttendancePdfBase';

export type AttendancePeriod = base.AttendancePeriod;
export const getFortnightDays = base.getFortnightDays;
export const workerOverlapsAttendancePeriod = base.workerOverlapsAttendancePeriod;

const safe = (value: unknown) => String(value ?? '').trim();
const municipalityFor = (obra: string) => {
  try {
    const map = JSON.parse(localStorage.getItem('profea:worksite-municipalities:v1') || '{}');
    const exact = safe(map[obra]);
    if (exact) return exact;
    const normalized = safe(obra).toLowerCase();
    const key = Object.keys(map).find(k => safe(k).toLowerCase() === normalized);
    return key ? safe(map[key]) : '';
  } catch { return ''; }
};
const fmt = (value: unknown) => {
  const m = safe(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : safe(value) || '-';
};

const redrawAlignedIdentityRow = (doc: any, workers: Person[], context: any) => {
  const pages = doc.getNumberOfPages();
  for (let pageNo = 1; pageNo <= pages; pageNo++) {
    doc.setPage(pageNo);
    const worker = workers[Math.min(pageNo - 1, Math.max(0, workers.length - 1))];
    if (!worker) continue;
    const x = 10, y = 47, gap = 3, first = 137, second = 67, third = 67, h = 5.7;
    doc.setFillColor(255,255,255); doc.rect(x, y - 0.2, 277, h + 0.4, 'F');
    const draw = (label:string,value:string,fx:number,width:number,labelWidth:number) => {
      doc.setDrawColor(166,193,216); doc.setLineWidth(0.18); doc.setFillColor(235,244,251); doc.rect(fx,y,labelWidth,h,'FD');
      doc.setFillColor(255,255,255); doc.rect(fx+labelWidth,y,width-labelWidth,h,'FD');
      doc.setFont('helvetica','bold'); doc.setFontSize(5.8); doc.setTextColor(0,84,142); doc.text(label,fx+2,y+3.8);
      doc.setFont('helvetica','normal'); doc.setFontSize(5.9); doc.setTextColor(30,41,59); const lines=doc.splitTextToSize(value||'-',Math.max(8,width-labelWidth-4)); doc.text(lines[0]||'-',fx+labelWidth+2,y+3.8);
    };
    const period = `${fmt((worker as any).periodoInicio)} – ${fmt((worker as any).periodoFin)}`;
    draw('Periodo contratado', period, x, first, 32);
    draw('Nº oferta', safe((worker as any).numOferta), x + first + gap, second, 24);
    draw('Empresa', safe(context.empresa), x + first + gap + second + gap, third, 22);
  }
};

export const generateContractAttendancePdf = (workers: Person[], context: WorksiteDocumentContext & { codigoObra?: string; municipio?: string }) => {
  const enriched = { ...context, municipio: safe(context.municipio) || municipalityFor(context.obra) };
  const result = base.generateContractAttendancePdf(workers, enriched as any);
  redrawAlignedIdentityRow(result.doc, workers, enriched);
  return result;
};
export const generateAttendancePeriodsPdf = (workers: Person[], context: WorksiteDocumentContext & { codigoObra?: string; municipio?: string }, periods: AttendancePeriod[]) => generateContractAttendancePdf(workers, context);
export const generateFortnightAttendancePdf = (workers: Person[], context: WorksiteDocumentContext & { codigoObra?: string; municipio?: string }, _fortnight: 1 | 2) => generateContractAttendancePdf(workers, context);
