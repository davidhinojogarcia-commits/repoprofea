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

export interface MedicalCompanySettings {
  empresa: string;
  nombreContacto: string;
  telefono: string;
  email: string;
}

export interface ShoeProviderSettings {
  nombreContacto: string;
  telefono: string;
  email: string;
}

export interface TrainingCompanySettings {
  empresa: string;
  nombreContacto: string;
  telefono: string;
  email: string;
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
  medicalCompany: MedicalCompanySettings;
  shoeProvider: ShoeProviderSettings;
  trainingCompany: TrainingCompanySettings;
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

export const DEFAULT_MEDICAL_COMPANY_SETTINGS: MedicalCompanySettings = {
  empresa: '',
  nombreContacto: '',
  telefono: '',
  email: '',
};

export const DEFAULT_SHOE_PROVIDER_SETTINGS: ShoeProviderSettings = {
  nombreContacto: '',
  telefono: '',
  email: '',
};

export const DEFAULT_TRAINING_COMPANY_SETTINGS: TrainingCompanySettings = {
  empresa: '',
  nombreContacto: '',
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
  medicalCompany: DEFAULT_MEDICAL_COMPANY_SETTINGS,
  shoeProvider: DEFAULT_SHOE_PROVIDER_SETTINGS,
  trainingCompany: DEFAULT_TRAINING_COMPANY_SETTINGS,
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

const cleanAdministrative = (value: any): AdministrativeSettings => ({
  nombreApellidos: String(value?.nombreApellidos || '').trim(),
  telefono: String(value?.telefono || '').trim(),
  email: String(value?.email || '').trim(),
  numeroTrabajador: String(value?.numeroTrabajador || '').trim(),
});

const cleanMedicalCompany = (value: any): MedicalCompanySettings => ({
  empresa: String(value?.empresa || '').trim(),
  nombreContacto: String(value?.nombreContacto || '').trim(),
  telefono: String(value?.telefono || '').trim(),
  email: String(value?.email || '').trim(),
});

const cleanShoeProvider = (value: any): ShoeProviderSettings => ({
  nombreContacto: String(value?.nombreContacto || '').trim(),
  telefono: String(value?.telefono || '').trim(),
  email: String(value?.email || '').trim(),
});

const cleanTrainingCompany = (value: any): TrainingCompanySettings => ({
  empresa: String(value?.empresa || '').trim(),
  nombreContacto: String(value?.nombreContacto || '').trim(),
  telefono: String(value?.telefono || '').trim(),
  email: String(value?.email || '').trim(),
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
  administrative: cleanAdministrative(value?.administrative),
  medicalCompany: cleanMedicalCompany(value?.medicalCompany),
  shoeProvider: cleanShoeProvider(value?.shoeProvider),
  trainingCompany: cleanTrainingCompany(value?.trainingCompany),
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
  const mergedAdministrative = patch.administrative
    ? { ...(existingRaw?.administrative || DEFAULT_ADMINISTRATIVE_SETTINGS), ...patch.administrative }
    : existingRaw?.administrative;
  const mergedMedicalCompany = patch.medicalCompany
    ? { ...(existingRaw?.medicalCompany || DEFAULT_MEDICAL_COMPANY_SETTINGS), ...patch.medicalCompany }
    : existingRaw?.medicalCompany;
  const mergedShoeProvider = patch.shoeProvider
    ? { ...(existingRaw?.shoeProvider || DEFAULT_SHOE_PROVIDER_SETTINGS), ...patch.shoeProvider }
    : existingRaw?.shoeProvider;
  const mergedTrainingCompany = patch.trainingCompany
    ? { ...(existingRaw?.trainingCompany || DEFAULT_TRAINING_COMPANY_SETTINGS), ...patch.trainingCompany }
    : existingRaw?.trainingCompany;
  const next = normalize({
    ...existingRaw,
    ...patch,
    supervisor: mergedSupervisor,
    technician: mergedTechnician,
    administrative: mergedAdministrative,
    medicalCompany: mergedMedicalCompany,
    shoeProvider: mergedShoeProvider,
    trainingCompany: mergedTrainingCompany,
  });

  await supabase.rpc('patch_user_settings', {
    p_patch: { app: next },
  });
  supervisorCache = next.supervisor;
  technicianCache = next.technician;
}

export function clearLegacyBusinessSettings(): void {}
