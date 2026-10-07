import type { ObraRecursoPreventivo, ReporteTecnicoConfig, SubcontrataDocItem } from '../../types';
import { getSessionUser, supabase } from '../lib/supabase';

export interface SubcontrataSettings {
  checklistTemplate?: SubcontrataDocItem[];
  reporteConfig?: ReporteTecnicoConfig;
  obrasRecursos?: Record<string, ObraRecursoPreventivo>;
}

const normalizeChecklistTemplate = (template?: SubcontrataDocItem[]): SubcontrataDocItem[] | undefined => {
  if (!Array.isArray(template)) return template;
  return template.map(item => item.id !== 'recurso_preventivo' ? item : {
    ...item,
    nombre: 'Responsable de coordinación de la subcontrata (encargado o interlocutor)',
    descripcion: 'Identificación de la persona designada por la empresa subcontratista como encargado o interlocutor responsable de la coordinación, comunicación y seguimiento de sus trabajos en la obra. No supone la designación de un recurso preventivo propio, salvo cuando resulte legal o preventivamente exigible.',
    normativa: 'Art. 24 Ley 31/1995 y RD 171/2004 (CAE). Art. 32 bis Ley 31/1995 cuando proceda recurso preventivo.',
    obligatorio: false,
    estado: item.estado === 'entregado' ? 'entregado' : 'no_aplica',
  });
};

const readSettings = async (): Promise<Record<string, any>> => {
  const user = await getSessionUser();
  if (!user) throw new Error('Debes iniciar sesión para cargar la configuración.');
  const rows = await supabase.query('user_settings', {
    query: `select=subcontratas:settings->subcontratas&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
  });
  return { subcontratas: rows?.[0]?.subcontratas || {} };
};

export async function loadSubcontrataSettings(): Promise<SubcontrataSettings> {
  const settings = await readSettings();
  const current = settings.subcontratas || {};
  return {
    ...current,
    checklistTemplate: normalizeChecklistTemplate(current.checklistTemplate),
  };
}

export async function saveSubcontrataSettings(patch: Partial<SubcontrataSettings>): Promise<SubcontrataSettings> {
  const current = await loadSubcontrataSettings();
  const normalizedPatch = {
    ...patch,
    ...(patch.checklistTemplate ? { checklistTemplate: normalizeChecklistTemplate(patch.checklistTemplate) } : {}),
  };
  const next = { ...current, ...normalizedPatch };
  await supabase.rpc('patch_user_settings', { p_patch: { subcontratas: next } });
  return next;
}
