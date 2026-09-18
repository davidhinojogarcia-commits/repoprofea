import { getSessionUser, supabase } from '../lib/supabase';

export interface AppBusinessSettings {
  savedObras: string[];
  savedLugares: string[];
  savedSitios: string[];
  savedTelefonos: string[];
  savedCategorias: string[];
  workStartHour: string;
  workEndHour: string;
}

const DEFAULTS: AppBusinessSettings = {
  savedObras: [],
  savedLugares: [],
  savedSitios: [],
  savedTelefonos: [],
  savedCategorias: ['Peón', 'Oficial de 1ª', 'Encargado'],
  workStartHour: '08:00',
  workEndHour: '15:00',
};

const cleanList = (value: unknown, fallback: string[] = []): string[] => {
  if (!Array.isArray(value)) return [...fallback];
  return Array.from(new Set(value.map(v => String(v || '').trim()).filter(Boolean)));
};

const normalize = (value: any): AppBusinessSettings => ({
  savedObras: cleanList(value?.savedObras),
  savedLugares: cleanList(value?.savedLugares),
  savedSitios: cleanList(value?.savedSitios),
  savedTelefonos: cleanList(value?.savedTelefonos),
  savedCategorias: cleanList(value?.savedCategorias, DEFAULTS.savedCategorias),
  workStartHour: String(value?.workStartHour || DEFAULTS.workStartHour),
  workEndHour: String(value?.workEndHour || DEFAULTS.workEndHour),
});

async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new Error('No hay una sesión autenticada.');
  return user;
}

export async function loadAppBusinessSettings(): Promise<AppBusinessSettings> {
  const user = await requireUser();
  const rows = await supabase.query('user_settings', {
    query: `user_id=eq.${encodeURIComponent(user.id)}&select=settings&limit=1`,
  });
  const remote = rows?.[0]?.settings?.app;
  if (remote && typeof remote === 'object') return normalize(remote);
  const defaults = normalize(DEFAULTS);
  if (typeof navigator === 'undefined' || navigator.onLine) {
    await saveAppBusinessSettings(defaults);
  }
  return defaults;
}

export async function saveAppBusinessSettings(patch: Partial<AppBusinessSettings>): Promise<void> {
  const user = await requireUser();
  const rows = await supabase.query('user_settings', {
    query: `user_id=eq.${encodeURIComponent(user.id)}&select=settings&limit=1`,
  });
  const existing = normalize(rows?.[0]?.settings?.app || DEFAULTS);
  const next = normalize({ ...existing, ...patch });

  await supabase.rpc('patch_user_settings', {
    p_patch: { app: next },
  });
}

export function clearLegacyBusinessSettings(): void {}
