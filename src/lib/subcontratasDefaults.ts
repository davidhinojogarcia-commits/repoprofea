import type { SubcontrataDocItem, Subcontratista } from '../../types';
import * as base from './subcontratasDefaultsBase';
import { generateSubcontrataReportPDF as generateReportWithPersonnel } from './subcontrataReportWithPersonnel';

export * from './subcontratasDefaultsBase';

const INTERLOCUTOR_METADATA = {
  nombre: 'Encargado / interlocutor de coordinación (cuando proceda)',
  descripcion: 'Identificación del encargado o interlocutor de la subcontrata para coordinación. La designación propia de recurso preventivo solo se solicitará cuando legal o preventivamente corresponda.',
  normativa: 'Art. 32 bis Ley 31/1995, RD 171/2004 y DA 4ª Ley 32/2006',
};

/**
 * Normaliza expedientes CAE antiguos para que la antigua exigencia de recurso
 * preventivo propio de la subcontrata no siga bloqueando el acceso a obra.
 * Si ya existe evidencia entregada se conserva; en caso contrario pasa a N/A.
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

export const createNewSubcontratista = (
  ...args: Parameters<typeof base.createNewSubcontratista>
): ReturnType<typeof base.createNewSubcontratista> => {
  const created = base.createNewSubcontratista(...args);
  return {
    ...created,
    // Campo legado: el recurso preventivo se gestiona por obra/contratista.
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
  ...args: any[]
) => generateReportWithPersonnel(
  { ...sub, checklist: normalizeSubcontrataChecklist(sub.checklist) },
  ...args,
);
