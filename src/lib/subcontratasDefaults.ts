import type { SubcontrataDocItem, Subcontratista } from '../../types';
import * as base from './subcontratasDefaultsBase';
import { generateSubcontrataReportPDF as generateReportWithPersonnel } from './subcontrataReportWithPersonnel';

export * from './subcontratasDefaultsBase';

const INTERLOCUTOR_METADATA = {
  nombre: 'Responsable de coordinación de la subcontrata (encargado o interlocutor)',
  descripcion: 'Identificación de la persona designada por la empresa subcontratista como encargado o interlocutor responsable de la coordinación, comunicación y seguimiento de sus trabajos en la obra. No supone la designación de un recurso preventivo propio, salvo cuando resulte legal o preventivamente exigible.',
  normativa: 'Art. 24 Ley 31/1995 y RD 171/2004 (CAE). Art. 32 bis Ley 31/1995 cuando proceda recurso preventivo.',
};

/**
 * Normaliza expedientes CAE antiguos para evitar que el requisito legado de
 * recurso preventivo propio de la subcontrata siga bloqueando el acceso.
 * Se conserva cualquier evidencia ya entregada; en otro caso queda como N/A.
 */
export const normalizeSubcontrataChecklist = (
  checklist: SubcontrataDocItem[] = [],
): SubcontrataDocItem[] => checklist.map(item => {
  if (item.id !== 'recurso_preventivo') return { ...item };
  return {
    ...item,
    ...INTERLOCUTOR_METADATA,
    obligatorio: false,
    estado: item.estado === 'entregado' ? 'entregado' : 'no_aplica',
  };
});

/**
 * Plantilla por defecto expuesta ya corregida para que el configurador CAE y
 * las nuevas subcontratas no recuperen el texto legado de recurso preventivo.
 */
export const DEFAULT_SUBCONTRATA_CHECKLIST: SubcontrataDocItem[] =
  normalizeSubcontrataChecklist(base.DEFAULT_SUBCONTRATA_CHECKLIST);

export const createNewSubcontratista = (
  ...args: Parameters<typeof base.createNewSubcontratista>
): ReturnType<typeof base.createNewSubcontratista> => {
  const created = base.createNewSubcontratista(...args);
  return {
    ...created,
    recursoPreventivo: '',
    checklist: normalizeSubcontrataChecklist(created.checklist),
  };
};

export const getSubcontrataCompliance = (sub: Subcontratista) =>
  base.getSubcontrataCompliance({
    ...sub,
    checklist: normalizeSubcontrataChecklist(sub.checklist),
  });

export const syncSubcontrataChecklistWithTemplate = (
  currentChecklist: SubcontrataDocItem[],
  template: SubcontrataDocItem[],
): SubcontrataDocItem[] => base.syncSubcontrataChecklistWithTemplate(
  normalizeSubcontrataChecklist(currentChecklist),
  normalizeSubcontrataChecklist(template),
).map(item => item.obligatorio ? item : {
  ...item,
  estado: item.estado === 'entregado' ? 'entregado' : 'no_aplica',
});

export const generateRequerimientoText = (
  sub: Subcontratista,
  obraNombre: string,
  supervisorNombre: string,
): string => base.generateRequerimientoText(
  { ...sub, checklist: normalizeSubcontrataChecklist(sub.checklist) },
  obraNombre,
  supervisorNombre,
);

export const generateSubcontrataReportPDF = (
  sub: Subcontratista,
  ...args: Parameters<typeof generateReportWithPersonnel> extends [any, ...infer Rest] ? Rest : never
) => generateReportWithPersonnel(
  { ...sub, checklist: normalizeSubcontrataChecklist(sub.checklist) },
  ...args,
);
