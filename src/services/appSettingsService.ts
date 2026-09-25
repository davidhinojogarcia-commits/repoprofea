import { getSessionUser, supabase } from '../lib/supabase';

export interface SupervisorSettings {
  nombreApellidos: string;
  telefono: string;
  zona: string;
  cargo: string;
  email: string;
  identificacionInterna: string;
  usarPorDefecto: boolean;
}

export interface TechnicianSettings {
  nombreApellidos: string;
  telefono: string;
  zona: string;
  cargo: string;
  email: string;
  numeroTrabajador: string;
  titulacion: string;
  usarPorDefecto: boolean;
}

export interface AppBusinessSettings {
  savedObras: string[];
  savedLugares: string[];
  savedSitios: string[];
  savedTelefonos: string[];
  savedCategorias: string[];
  workStartHour: string;
  workEndHour: string;
  supervisor: SupervisorSettings;
  technician: TechnicianSettings;
}

export const DEFAULT_TECHNICIAN_SETTINGS: TechnicianSettings = {
  nombreApellidos: '',
  telefono: '',
  zona: '',
  cargo: 'Técnico responsable',
  email: '',
  numeroTrabajador: '',
  titulacion: '',
  usarPorDefecto: true,
};

export const DEFAULT_SUPERVISOR_SETTINGS: SupervisorSettings = {
  nombreApellidos: '',
  telefono: '',
  zona: '',
  cargo: 'Supervisor PROFEA',
  email: '',
  identificacionInterna: '',
  usarPorDefecto: true,
};

let supervisorCache: SupervisorSettings = { ...DEFAULT_SUPERVISOR_SETTINGS };
let technicianCache: TechnicianSettings = { ...DEFAULT_TECHNICIAN_SETTINGS };

export const getCachedSupervisorSettings = (): SupervisorSettings => ({ ...supervisorCache });
export const getCachedTechnicianSettings = (): TechnicianSettings => ({ ...technicianCache });

const DEFAULTS: AppBusinessSettings = {
  savedObras: [],
  savedLugares: [],
  savedSitios: [],
  savedTelefonos: [],
  savedCategorias: ['Peón', 'Oficial de 1ª', 'Encargado'],
  workStartHour: '08:00',
  workEndHour: '15:00',
  supervisor: DEFAULT_SUPERVISOR_SETTINGS,
  technician: DEFAULT_TECHNICIAN_SETTINGS,
};

const cleanList = (value: unknown, fallback: string[] = []): string[] => {
  if (!Array.isArray(value)) return [...fallback];
  return Array.from(new Set(value.map(v => String(v || '').trim()).filter(Boolean)));
};

const cleanTechnician = (value: any): TechnicianSettings => ({
  nombreApellidos: String(value?.nombreApellidos || '').trim(),
  telefono: String(value?.telefono || '').trim(),
  zona: String(value?.zona || '').trim(),
  cargo: String(value?.cargo || DEFAULT_TECHNICIAN_SETTINGS.cargo).trim(),
  email: String(value?.email || '').trim(),
  numeroTrabajador: String(value?.numeroTrabajador || '').trim(),
  titulacion: String(value?.titulacion || '').trim(),
  usarPorDefecto: value?.usarPorDefecto !== false,
});

const cleanSupervisor = (value: any): SupervisorSettings => ({
  nombreApellidos: String(value?.nombreApellidos || '').trim(),
  telefono: String(value?.telefono || '').trim(),
  zona: String(value?.zona || '').trim(),
  cargo: String(value?.cargo || DEFAULT_SUPERVISOR_SETTINGS.cargo).trim(),
  email: String(value?.email || '').trim(),
  identificacionInterna: String(value?.identificacionInterna || '').trim(),
  usarPorDefecto: value?.usarPorDefecto !== false,
});

const normalize = (value: any): AppBusinessSettings => ({
  savedObras: cleanList(value?.savedObras),
  savedLugares: cleanList(value?.savedLugares),
  savedSitios: cleanList(value?.savedSitios),
  savedTelefonos: cleanList(value?.savedTelefonos),
  savedCategorias: cleanList(value?.savedCategorias, DEFAULTS.savedCategorias),
  workStartHour: String(value?.workStartHour || DEFAULTS.workStartHour),
  workEndHour: String(value?.workEndHour || DEFAULTS.workEndHour),
  supervisor: cleanSupervisor(value?.supervisor),
  technician: cleanTechnician(value?.technician),
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
  if (remote && typeof remote === 'object') {
    const normalized = normalize(remote);
    supervisorCache = normalized.supervisor;
    technicianCache = normalized.technician;
    return normalized;
  }
  const defaults = normalize(DEFAULTS);
  supervisorCache = defaults.supervisor;
  technicianCache = defaults.technician;
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
  const existingRaw = rows?.[0]?.settings?.app || DEFAULTS;
  const mergedSupervisor = patch.supervisor
    ? { ...(existingRaw?.supervisor || DEFAULT_SUPERVISOR_SETTINGS), ...patch.supervisor }
    : existingRaw?.supervisor;
  const mergedTechnician = patch.technician
    ? { ...(existingRaw?.technician || DEFAULT_TECHNICIAN_SETTINGS), ...patch.technician }
    : existingRaw?.technician;
  const next = normalize({ ...existingRaw, ...patch, supervisor: mergedSupervisor, technician: mergedTechnician });

  await supabase.rpc('patch_user_settings', {
    p_patch: { app: next },
  });
  supervisorCache = next.supervisor;
  technicianCache = next.technician;
}

export function clearLegacyBusinessSettings(): void {}
