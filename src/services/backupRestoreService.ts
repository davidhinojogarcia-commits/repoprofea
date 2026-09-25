import type { DeletedPerson, Person } from '../../types';
import { supabase } from '../lib/supabase';
import { createDocument } from './databaseService';
import { loadAppBusinessSettings, saveAppBusinessSettings } from './appSettingsService';
import { loadSubcontratasPreferences, saveSubcontratasPreferences } from './subcontratasPreferencesService';

export type RestoreMode = 'replace' | 'merge';

export interface ProfeaBackupPayload {
  people?: Person[];
  deletedPeople?: DeletedPerson[];
  workers?: Person[];
  trabajadores?: Person[];
  personas?: Person[];
  trash?: DeletedPerson[];
  personasEliminadas?: DeletedPerson[];
  citas?: any[];
  subcontratas?: any[];
  reconocimientos?: any[];
  contrataciones?: any[];
  obras?: any[];
  database?: Record<string, any[]>;
  settings?: Record<string, any>;
  config?: Record<string, any>;
  type?: string;
  version?: string;
  schema?: string;
}

const collectionTable: Record<string, string> = {
  citas: 'citas',
  subcontratas: 'subcontratas',
  reconocimientos: 'reconocimientos',
  contrataciones: 'contrataciones',
};

const RAW_RESTORE_TABLES = [
  'subcontrata_documentos',
  'inventory_parks',
  'inventory_items',
  'inventory_movements',
  'inventory_maintenance',
  'inventory_documents',
  'inventory_park_members',
] as const;

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Debes iniciar sesión para restaurar una copia de seguridad.');
  return data.user.id;
}

async function deleteOwnedRows(table: string, ownerId: string): Promise<void> {
  await supabase.query(table, {
    method: 'DELETE',
    prefer: 'return=minimal',
    query: `owner_id=eq.${encodeURIComponent(ownerId)}`,
  });
}

function firstArray<T>(...values: unknown[]): T[] {
  for (const value of values) if (Array.isArray(value)) return value as T[];
  return [];
}

export function normalizeBackupPayload(payload: ProfeaBackupPayload): ProfeaBackupPayload {
  const source = payload || {};
  const db = source.database || {};
  return {
    ...source,
    people: firstArray<Person>(db.trabajadores, source.people, source.workers, source.trabajadores, source.personas),
    deletedPeople: firstArray<DeletedPerson>(db.trash, source.deletedPeople, source.trash, source.personasEliminadas),
    citas: firstArray(db.citas, source.citas),
    subcontratas: firstArray(db.subcontratas, source.subcontratas, source.config?.subcontratas),
    reconocimientos: firstArray(db.reconocimientos, source.reconocimientos),
    contrataciones: firstArray(db.contrataciones, source.contrataciones),
    obras: firstArray(db.obras, source.obras),
    database: db,
    settings: source.settings && typeof source.settings === 'object' ? source.settings : {},
    config: source.config && typeof source.config === 'object' ? source.config : {},
  };
}

function backupCollection(payload: ProfeaBackupPayload, key: keyof ProfeaBackupPayload): any[] {
  const direct = payload[key];
  if (Array.isArray(direct)) return direct;
  if (key === 'subcontratas' && Array.isArray(payload.config?.subcontratas)) return payload.config!.subcontratas;
  return [];
}

const mergeList = (current: string[], incoming: unknown): string[] => {
  if (!Array.isArray(incoming)) return current;
  const map = new Map(current.map(item => [item.trim().toLocaleLowerCase('es'), item]));
  for (const raw of incoming) {
    const item = String(raw || '').trim();
    if (item && !map.has(item.toLocaleLowerCase('es'))) map.set(item.toLocaleLowerCase('es'), item);
  }
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'es'));
};

async function restoreCollection(collection: 'citas' | 'subcontratas' | 'reconocimientos' | 'contrataciones', rows: any[]) {
  const concurrency = collection === 'subcontratas' ? 1 : 10;
  for (let start = 0; start < rows.length; start += concurrency) {
    const batch = rows.slice(start, start + concurrency);
    await Promise.all(batch.map(async (raw, offset) => {
      const row = raw || {};
      const index = start + offset;
      const id = row.id ?? `${collection}_${Date.now()}_${index}`;
      await createDocument(collection, id, row);
    }));
  }
}

async function restoreWorks(rows: any[]) {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {};
    const id = row.id ?? `obra_backup_${Date.now()}_${i}`;
    await createDocument('obras', id, row);
  }
}

async function restoreRawTables(payload: ProfeaBackupPayload, ownerId: string) {
  const db = payload.database || {};
  let restored = 0;
  for (const table of RAW_RESTORE_TABLES) {
    const rows = Array.isArray(db[table]) ? db[table] : [];
    for (const original of rows) {
      if (!original || typeof original !== 'object') continue;
      const row: Record<string, any> = { ...original };
      if ('owner_id' in row) row.owner_id = ownerId;
      if ('created_by' in row) row.created_by = ownerId;
      if (table === 'inventory_park_members' && 'user_id' in row) row.user_id = ownerId;
      await supabase.query(table, {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: row,
      });
      restored += 1;
    }
  }
  return restored;
}

async function restoreCompleteSettings(payload: ProfeaBackupPayload) {
  if (!payload.settings || typeof payload.settings !== 'object' || !Object.keys(payload.settings).length) return false;
  await supabase.rpc('patch_user_settings', { p_patch: payload.settings });
  return true;
}

export async function restoreBackupToSupabase(rawPayload: ProfeaBackupPayload, mode: RestoreMode) {
  const payload = normalizeBackupPayload(rawPayload);
  const ownerId = await currentUserId();
  const workers = Array.isArray(payload.people) ? payload.people : [];
  const trash = Array.isArray(payload.deletedPeople) ? payload.deletedPeople : [];
  const obras = Array.isArray(payload.obras) ? payload.obras : [];

  if (mode === 'replace' && workers.length === 0) {
    const existing = await supabase.query('trabajadores', {
      query: `select=id&owner_id=eq.${encodeURIComponent(ownerId)}&limit=1`,
    });
    if (existing?.length) {
      throw new Error('La copia no contiene trabajadores reconocibles. Se ha cancelado el reemplazo para evitar borrar los datos actuales.');
    }
  }

  await restoreWorks(obras);

  const restored = await supabase.rpc('restore_workers_trash_backup', {
    p_workers: workers,
    p_trash: trash,
    p_replace: mode === 'replace',
  });

  for (const collection of ['citas', 'subcontratas', 'reconocimientos', 'contrataciones'] as const) {
    const rows = backupCollection(payload, collection);
    if (mode === 'replace') await deleteOwnedRows(collectionTable[collection], ownerId);
    await restoreCollection(collection, rows);
  }

  const rawRowsRestored = await restoreRawTables(payload, ownerId);
  const restoredFullSettings = await restoreCompleteSettings(payload);

  const config = payload.config || {};
  const current = await loadAppBusinessSettings();
  const settings = restoredFullSettings
    ? await loadAppBusinessSettings()
    : mode === 'merge' ? {
        savedObras: mergeList(current.savedObras, config.obras),
        savedLugares: mergeList(current.savedLugares, config.lugares),
        savedSitios: mergeList(current.savedSitios, config.sitios),
        savedTelefonos: mergeList(current.savedTelefonos, config.telefonos),
        savedCategorias: mergeList(current.savedCategorias, config.categorias),
        workStartHour: current.workStartHour,
        workEndHour: current.workEndHour,
        supervisor: config.supervisor && typeof config.supervisor === 'object'
          ? { ...current.supervisor, ...config.supervisor }
          : current.supervisor,
        technician: config.technician && typeof config.technician === 'object'
          ? { ...current.technician, ...config.technician }
          : current.technician,
        administrative: config.administrative && typeof config.administrative === 'object'
          ? { ...current.administrative, ...config.administrative }
          : current.administrative,
        medicalCompany: config.medicalCompany && typeof config.medicalCompany === 'object'
          ? { ...current.medicalCompany, ...config.medicalCompany }
          : current.medicalCompany,
        footwearProvider: config.footwearProvider && typeof config.footwearProvider === 'object'
          ? { ...current.footwearProvider, ...config.footwearProvider }
          : current.footwearProvider,
        trainingCompany: config.trainingCompany && typeof config.trainingCompany === 'object'
          ? { ...current.trainingCompany, ...config.trainingCompany }
          : current.trainingCompany,
        administrative: config.administrative && typeof config.administrative === 'object'
          ? { ...current.administrative, ...config.administrative }
          : current.administrative,
        medicalCompany: config.medicalCompany && typeof config.medicalCompany === 'object'
          ? { ...current.medicalCompany, ...config.medicalCompany }
          : current.medicalCompany,
        footwearProvider: config.footwearProvider && typeof config.footwearProvider === 'object'
          ? { ...current.footwearProvider, ...config.footwearProvider }
          : current.footwearProvider,
        trainingCompany: config.trainingCompany && typeof config.trainingCompany === 'object'
          ? { ...current.trainingCompany, ...config.trainingCompany }
          : current.trainingCompany,
      } : {
        savedObras: Array.isArray(config.obras) ? config.obras : [],
        savedLugares: Array.isArray(config.lugares) ? config.lugares : [],
        savedSitios: Array.isArray(config.sitios) ? config.sitios : [],
        savedTelefonos: Array.isArray(config.telefonos) ? config.telefonos : [],
        savedCategorias: Array.isArray(config.categorias) ? config.categorias : current.savedCategorias,
        workStartHour: config.workStartHour || '08:00',
        workEndHour: config.workEndHour || '15:00',
        supervisor: config.supervisor && typeof config.supervisor === 'object'
          ? { ...current.supervisor, ...config.supervisor }
          : current.supervisor,
        technician: config.technician && typeof config.technician === 'object'
          ? { ...current.technician, ...config.technician }
          : current.technician,
      };
  if (!restoredFullSettings) await saveAppBusinessSettings(settings);

  const currentSubPrefs = await loadSubcontratasPreferences();
  const prefPatch: Record<string, any> = {};
  if (config.reporteTecnicoConfig && typeof config.reporteTecnicoConfig === 'object') {
    prefPatch.reporteTecnicoConfig = mode === 'merge'
      ? { ...(currentSubPrefs.reporteTecnicoConfig || {}), ...config.reporteTecnicoConfig }
      : config.reporteTecnicoConfig;
  }
  if (config.obrasRecursosPreventivos && typeof config.obrasRecursosPreventivos === 'object') {
    prefPatch.obrasRecursosPreventivos = mode === 'merge'
      ? { ...(currentSubPrefs.obrasRecursosPreventivos || {}), ...config.obrasRecursosPreventivos }
      : config.obrasRecursosPreventivos;
  }
  if (config.checklistTemplate) prefPatch.checklistTemplate = config.checklistTemplate;
  if (Object.keys(prefPatch).length) await saveSubcontratasPreferences(prefPatch);

  return {
    restored,
    rawRowsRestored,
    settings,
    normalized: payload,
    version: payload.version || 'legacy',
    completeFormat: Boolean(payload.database && Object.keys(payload.database).length),
  };
}
