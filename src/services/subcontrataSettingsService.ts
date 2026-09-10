import type { ObraRecursoPreventivo, ReporteTecnicoConfig, SubcontrataDocItem } from '../../types';
import { supabase } from '../lib/supabase';

export interface SubcontrataSettings {
  checklistTemplate?: SubcontrataDocItem[];
  reporteConfig?: ReporteTecnicoConfig;
  obrasRecursos?: Record<string, ObraRecursoPreventivo>;
}

const readSettings = async (): Promise<Record<string, any>> => {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Debes iniciar sesión para cargar la configuración.');
  const rows = await supabase.query('user_settings', {
    query: `select=settings&user_id=eq.${encodeURIComponent(data.user.id)}&limit=1`,
  });
  return rows?.[0]?.settings || {};
};

export async function loadSubcontrataSettings(): Promise<SubcontrataSettings> {
  const settings = await readSettings();
  return settings.subcontratas || {};
}

export async function saveSubcontrataSettings(patch: Partial<SubcontrataSettings>): Promise<void> {
  const current = await loadSubcontrataSettings();
  await supabase.rpc('patch_user_settings', {
    p_patch: {
      subcontratas: {
        ...current,
        ...patch,
      },
    },
  });
}
