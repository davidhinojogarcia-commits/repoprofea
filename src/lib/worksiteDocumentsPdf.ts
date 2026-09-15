import type { Person } from '../../types';
import * as base from './worksiteDocumentsPdfBase';
import type { WorksiteDocumentContext as BaseContext } from './worksiteDocumentsPdfBase';

export type WorksiteDocumentContext = BaseContext & { municipio?: string };
const safe = (value: unknown) => String(value ?? '').trim();
const municipalityFor = (obra: string) => {
  try {
    const map = JSON.parse(localStorage.getItem('profea:worksite-municipalities:v1') || '{}');
    const exact = safe(map[obra]); if (exact) return exact;
    const key = Object.keys(map).find(k => safe(k).toLowerCase() === safe(obra).toLowerCase());
    return key ? safe(map[key]) : '';
  } catch { return ''; }
};
const addMunicipality = (doc: any, context: WorksiteDocumentContext) => {
  const municipio = safe(context.municipio) || municipalityFor(context.obra);
  const pages = doc.getNumberOfPages();
  for (let pageNo=1; pageNo<=pages; pageNo++) {
    doc.setPage(pageNo);
    doc.setFillColor(247,250,252); doc.rect(103,53.2,46,4.5,'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(30,41,59);
    const text = `Municipio: ${municipio || '-'}`; const lines = doc.splitTextToSize(text,44); doc.text(lines[0] || text,105,56.4);
  }
};
const wrap = (result: any, context: WorksiteDocumentContext) => { addMunicipality(result.doc, context); return result; };
export const generateEpiDeliveryPdf = (workers: Person[], context: WorksiteDocumentContext) => wrap(base.generateEpiDeliveryPdf(workers, context), context);
export const generateTrainingInformationPdf = (workers: Person[], context: WorksiteDocumentContext) => wrap(base.generateTrainingInformationPdf(workers, context), context);
export const generateMachineryAuthorizationPdf = (workers: Person[], context: WorksiteDocumentContext) => wrap(base.generateMachineryAuthorizationPdf(workers, context), context);
