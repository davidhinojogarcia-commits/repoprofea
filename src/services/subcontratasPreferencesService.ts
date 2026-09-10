import { supabase } from '../lib/supabase';

export interface SubcontratasPreferences {
  checklistTemplate?: any[];
  reporteTecnicoConfig?: Record<string, any>;
  obrasRecursosPreventivos?: Record<string, any>;
}

async function requireUser() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('No hay una sesión autenticada.');
  return data.user;
}

export async function loadSubcontratasPreferences(): Promise<SubcontratasPreferences> {
  const user = await requireUser();
  const rows = await supabase.query('user_settings', {
    query: `user_id=eq.${encodeURIComponent(user.id)}&select=settings&limit=1`,
  });
  const value = rows?.[0]?.settings?.subcontratasPreferences;
  return value && typeof value === 'object' ? value : {};
}

export async function saveSubcontratasPreferences(patch: SubcontratasPreferences): Promise<SubcontratasPreferences> {
  const current = await loadSubcontratasPreferences();
  const next = { ...current, ...patch };
  await supabase.rpc('patch_user_settings', {
    p_patch: { subcontratasPreferences: next },
  });
  return next;
}
