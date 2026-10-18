import { getSessionUser, supabase } from '../lib/supabase';

export interface SubcontratasPreferences {
  checklistTemplate?: any[];
  reporteTecnicoConfig?: Record<string, any>;
  obrasRecursosPreventivos?: Record<string, any>;
}

async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new Error('No hay una sesión autenticada.');
  return user;
}

export async function loadSubcontratasPreferences(): Promise<SubcontratasPreferences> {
  const user = await requireUser();
  const rows = await supabase.query('user_settings', {
    query: `user_id=eq.${encodeURIComponent(user.id)}&select=preferences:settings->subcontratasPreferences&limit=1`,
  });
  const value = rows?.[0]?.preferences;
  return value && typeof value === 'object' ? value : {};
}

export async function loadObrasRecursosPreventivos(): Promise<Record<string, any>> {
  const user = await requireUser();
  const rows = await supabase.query('user_settings', {
    query: `user_id=eq.${encodeURIComponent(user.id)}&select=resources:settings->subcontratasPreferences->obrasRecursosPreventivos&limit=1`,
  });
  const value = rows?.[0]?.resources;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export async function saveSubcontratasPreferences(patch: SubcontratasPreferences): Promise<SubcontratasPreferences> {
  const current = await loadSubcontratasPreferences();
  const next = { ...current, ...patch };
  await supabase.rpc('patch_user_settings', {
    p_patch: { subcontratasPreferences: next },
  });
  return next;
}
