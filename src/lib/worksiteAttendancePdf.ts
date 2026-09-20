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

export const generateContractAttendancePdf = (
  workers: Person[],
  context: WorksiteDocumentContext & { codigoObra?: string; municipio?: string },
) => {
  const enriched = {
    ...context,
    municipio: safe(context.municipio) || municipalityFor(context.obra),
  };
  return base.generateContractAttendancePdf(workers, enriched as any);
};

export const generateAttendancePeriodsPdf = (
  workers: Person[],
  context: WorksiteDocumentContext & { codigoObra?: string; municipio?: string },
  _periods: AttendancePeriod[],
) => generateContractAttendancePdf(workers, context);

export const generateFortnightAttendancePdf = (
  workers: Person[],
  context: WorksiteDocumentContext & { codigoObra?: string; municipio?: string },
  _fortnight: 1 | 2,
) => generateContractAttendancePdf(workers, context);
