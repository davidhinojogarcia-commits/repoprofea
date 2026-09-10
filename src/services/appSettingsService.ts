import { supabase } from '../lib/supabase';

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

const readLegacyBrowserSettings = (): Partial<AppBusinessSettings> => {
  if (typeof window === 'undefined') return {};
  const parseList = (key: string): string[] => {
    try { return cleanList(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return []; }
  };
  return {
    savedObras: parseList('obrasGuardadas'),
    savedLugares: parseList('lugaresFormacion'),
    savedSitios: parseList('sitiosReconocimiento'),
    savedTelefonos: parseList('telefonosGuardados'),
    savedCategorias: parseList('categoriasGuardadas'),
    workStartHour: localStorage.getItem('workStartHour') || undefined,
    workEndHour: localStorage.getItem('workEndHour') || undefined,
  };
};

const hasMeaningfulLegacyData = (value: Partial<AppBusinessSettings>) =>
  Boolean(value.savedObras?.length || value.savedLugares?.length || value.savedSitios?.length ||
    value.savedTelefonos?.length || value.savedCategorias?.length || value.workStartHour || value.workEndHour);

async function requireUser() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('No hay una sesión autenticada.');
  return data.user;
}

export async function loadAppBusinessSettings(): Promise<AppBusinessSettings> {
  const user = await requireUser();
  const rows = await supabase.query('user_settings', {
    query: `user_id=eq.${encodeURIComponent(user.id)}&select=data&limit=1`,
  });
  const remote = rows?.[0]?.data?.app;
  if (remote && typeof remote === 'object') return normalize(remote);

  // Migración única: rescata la configuración empresarial que versiones antiguas
  // guardaban en el navegador, la copia a Supabase y deja de usarla como backend.
  const legacy = readLegacyBrowserSettings();
  const migrated = normalize(hasMeaningfulLegacyData(legacy) ? legacy : DEFAULTS);
  await saveAppBusinessSettings(migrated);
  return migrated;
}

export async function saveAppBusinessSettings(patch: Partial<AppBusinessSettings>): Promise<void> {
  const user = await requireUser();
  const rows = await supabase.query('user_settings', {
    query: `user_id=eq.${encodeURIComponent(user.id)}&select=data&limit=1`,
  });
  const existing = normalize(rows?.[0]?.data?.app || DEFAULTS);
  const next = normalize({ ...existing, ...patch });

  await supabase.rpc('patch_user_settings', {
    p_patch: { app: next },
  });
}

export function clearLegacyBusinessSettings(): void {
  if (typeof window === 'undefined') return;
  ['obrasGuardadas', 'lugaresFormacion', 'sitiosReconocimiento', 'telefonosGuardados', 'categoriasGuardadas', 'workStartHour', 'workEndHour']
    .forEach(key => localStorage.removeItem(key));
}
