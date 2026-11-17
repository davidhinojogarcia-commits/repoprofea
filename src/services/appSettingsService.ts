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

export interface AdministrativeSettings {
  nombreApellidos: string;
  telefono: string;
  email: string;
  numeroTrabajador: string;
}

export interface MedicalProviderSettings {
  empresa: string;
  nombreApellidos: string;
  telefono: string;
  email: string;
}

export interface FootwearProviderSettings {
  empresa: string;
  nombreApellidos: string;
  telefono: string;
  email: string;
}

export interface TrainingProviderSettings {
  empresa: string;
  nombreApellidos: string;
  telefono: string;
  email: string;
}

export interface TrainingProviderEntry extends TrainingProviderSettings {
  id: string;
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
  administrative: AdministrativeSettings;
  medicalProvider: MedicalProviderSettings;
  footwearProvider: FootwearProviderSettings;
  trainingProvider: TrainingProviderSettings;
  trainingProviders: TrainingProviderEntry[];
  activeTrainingProviderId: string;
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

export const DEFAULT_ADMINISTRATIVE_SETTINGS: AdministrativeSettings = {
  nombreApellidos: '',
  telefono: '',
  email: '',
  numeroTrabajador: '',
};

export const DEFAULT_MEDICAL_PROVIDER_SETTINGS: MedicalProviderSettings = {
  empresa: '',
  nombreApellidos: '',
  telefono: '',
  email: '',
};

export const DEFAULT_FOOTWEAR_PROVIDER_SETTINGS: FootwearProviderSettings = {
  empresa: '',
  nombreApellidos: '',
  telefono: '',
  email: '',
};

export const DEFAULT_TRAINING_PROVIDER_SETTINGS: TrainingProviderSettings = {
  empresa: '',
  nombreApellidos: '',
  telefono: '',
  email: '',
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
let cacheGeneration = 0;
export function resetCachedBusinessSettings() {
  cacheGeneration++;
  supervisorCache = { ...DEFAULT_SUPERVISOR_SETTINGS };
  technicianCache = { ...DEFAULT_TECHNICIAN_SETTINGS };
}

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
  administrative: DEFAULT_ADMINISTRATIVE_SETTINGS,
  medicalProvider: DEFAULT_MEDICAL_PROVIDER_SETTINGS,
  footwearProvider: DEFAULT_FOOTWEAR_PROVIDER_SETTINGS,
  trainingProvider: DEFAULT_TRAINING_PROVIDER_SETTINGS,
  trainingProviders: [],
  activeTrainingProviderId: '',
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

const cleanContact = <T extends { nombreApellidos: string; telefono: string; email: string }>(
  value: any,
  defaults: T,
): T => ({
  ...defaults,
  ...value,
  nombreApellidos: String(value?.nombreApellidos || '').trim(),
  telefono: String(value?.telefono || '').trim(),
  email: String(value?.email || '').trim(),
});

const cleanAdministrative = (value: any): AdministrativeSettings => ({
  ...cleanContact(value, DEFAULT_ADMINISTRATIVE_SETTINGS),
  numeroTrabajador: String(value?.numeroTrabajador || '').trim(),
});

const cleanMedicalProvider = (value: any): MedicalProviderSettings => ({
  ...cleanContact(value, DEFAULT_MEDICAL_PROVIDER_SETTINGS),
  empresa: String(value?.empresa || '').trim(),
});

const cleanFootwearProvider = (value: any): FootwearProviderSettings => ({
  ...cleanContact(value, DEFAULT_FOOTWEAR_PROVIDER_SETTINGS),
  empresa: String(value?.empresa || '').trim(),
});

const cleanTrainingProvider = (value: any): TrainingProviderSettings => ({
  ...cleanContact(value, DEFAULT_TRAINING_PROVIDER_SETTINGS),
  empresa: String(value?.empresa || '').trim(),
});

const makeTrainingProviderId = (value: any, index: number) => {
  const explicit = String(value?.id || '').trim();
  if (explicit) return explicit;
  const base = [value?.empresa, value?.email, value?.nombreApellidos]
    .map(item => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .join('-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base ? `training-${base}` : `training-provider-${index + 1}`;
};

const cleanTrainingProviders = (value: any, legacy?: any): TrainingProviderEntry[] => {
  const source = Array.isArray(value)
    ? value
    : legacy && (legacy.empresa || legacy.nombreApellidos || legacy.telefono || legacy.email)
      ? [legacy]
      : [];
  const seen = new Set<string>();
  return source.map((item, index) => {
    let id = makeTrainingProviderId(item, index);
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    return { id, ...cleanTrainingProvider(item) };
  });
};

const cleanSupervisor = (value: any): SupervisorSettings => ({
  nombreApellidos: String(value?.nombreApellidos || '').trim(),
  telefono: String(value?.telefono || '').trim(),
  zona: String(value?.zona || '').trim(),
  cargo: String(value?.cargo || DEFAULT_SUPERVISOR_SETTINGS.cargo).trim(),
  email: String(value?.email || '').trim(),
  identificacionInterna: String(value?.identificacionInterna || '').trim(),
  usarPorDefecto: value?.usarPorDefecto !== false,
});

const normalize = (value: any): AppBusinessSettings => {
  const trainingProviders = cleanTrainingProviders(value?.trainingProviders, value?.trainingProvider);
  const requestedActive = String(value?.activeTrainingProviderId || '').trim();
  const activeTrainingProviderId = trainingProviders.some(item => item.id === requestedActive)
    ? requestedActive
    : (trainingProviders[0]?.id || '');
  const activeTrainingProvider =
    trainingProviders.find(item => item.id === activeTrainingProviderId) ||
    cleanTrainingProvider(value?.trainingProvider);

  return {
    savedObras: cleanList(value?.savedObras),
    savedLugares: cleanList(value?.savedLugares),
    savedSitios: cleanList(value?.savedSitios),
    savedTelefonos: cleanList(value?.savedTelefonos),
    savedCategorias: cleanList(value?.savedCategorias, DEFAULTS.savedCategorias),
    workStartHour: String(value?.workStartHour || DEFAULTS.workStartHour),
    workEndHour: String(value?.workEndHour || DEFAULTS.workEndHour),
    supervisor: cleanSupervisor(value?.supervisor),
    technician: cleanTechnician(value?.technician),
    administrative: cleanAdministrative(value?.administrative),
    medicalProvider: cleanMedicalProvider(value?.medicalProvider),
    footwearProvider: cleanFootwearProvider(value?.footwearProvider),
    trainingProvider: cleanTrainingProvider(activeTrainingProvider),
    trainingProviders,
    activeTrainingProviderId,
  };
};

async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new Error('No hay una sesión autenticada.');
  return user;
}

export async function loadAppBusinessSettings(): Promise<AppBusinessSettings> {
  const generation = cacheGeneration;
  const user = await requireUser();
  const rows = await supabase.query('user_settings', {
    query: `user_id=eq.${encodeURIComponent(user.id)}&select=settings&limit=1`,
  });
  const remote = rows?.[0]?.settings?.app;
  if (remote && typeof remote === 'object') {
    const normalized = normalize(remote);
    if (generation === cacheGeneration) {
      supervisorCache = normalized.supervisor;
      technicianCache = normalized.technician;
    }
    return normalized;
  }
  const defaults = normalize(DEFAULTS);
  if (generation !== cacheGeneration) return defaults;
  supervisorCache = defaults.supervisor;
  technicianCache = defaults.technician;
  if (typeof navigator === 'undefined' || navigator.onLine) {
    await saveAppBusinessSettings(defaults);
  }
  return defaults;
}

export async function saveAppBusinessSettings(patch: Partial<AppBusinessSettings>): Promise<void> {
  const generation = cacheGeneration;
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
  const mergedAdministrative = patch.administrative
    ? { ...(existingRaw?.administrative || DEFAULT_ADMINISTRATIVE_SETTINGS), ...patch.administrative }
    : existingRaw?.administrative;
  const mergedMedicalProvider = patch.medicalProvider
    ? { ...(existingRaw?.medicalProvider || DEFAULT_MEDICAL_PROVIDER_SETTINGS), ...patch.medicalProvider }
    : existingRaw?.medicalProvider;
  const mergedFootwearProvider = patch.footwearProvider
    ? { ...(existingRaw?.footwearProvider || DEFAULT_FOOTWEAR_PROVIDER_SETTINGS), ...patch.footwearProvider }
    : existingRaw?.footwearProvider;
  const mergedTrainingProvider = patch.trainingProvider
    ? { ...(existingRaw?.trainingProvider || DEFAULT_TRAINING_PROVIDER_SETTINGS), ...patch.trainingProvider }
    : existingRaw?.trainingProvider;
  const next = normalize({
    ...existingRaw,
    ...patch,
    supervisor: mergedSupervisor,
    technician: mergedTechnician,
    administrative: mergedAdministrative,
    medicalProvider: mergedMedicalProvider,
    footwearProvider: mergedFootwearProvider,
    trainingProvider: mergedTrainingProvider,
    trainingProviders: patch.trainingProviders ?? existingRaw?.trainingProviders,
    activeTrainingProviderId: patch.activeTrainingProviderId ?? existingRaw?.activeTrainingProviderId,
  });

  if (generation !== cacheGeneration) throw new Error('La cuenta ha cambiado. Vuelve a abrir la configuración antes de guardar.');
  await supabase.rpc('patch_user_settings', {
    p_patch: { app: next },
  });
  if (generation === cacheGeneration) {
    supervisorCache = next.supervisor;
    technicianCache = next.technician;
  }
}

export function clearLegacyBusinessSettings(): void {}
