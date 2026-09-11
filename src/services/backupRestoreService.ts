import type { DeletedPerson, Person } from '../../types';
import { supabase } from '../lib/supabase';
import { createDocument } from './databaseService';
import { loadAppBusinessSettings, saveAppBusinessSettings } from './appSettingsService';
import { loadSubcontratasPreferences, saveSubcontratasPreferences } from './subcontratasPreferencesService';

export type RestoreMode = 'replace' | 'merge';

export interface ProfeaBackupPayload {
  people?: Person[];
  deletedPeople?: DeletedPerson[];
  // Alias históricos admitidos para que copias antiguas no se interpreten como vacías.
  workers?: Person[];
  trabajadores?: Person[];
  personas?: Person[];
  trash?: DeletedPerson[];
  personasEliminadas?: DeletedPerson[];
  citas?: any[];
  subcontratas?: any[];
  reconocimientos?: any[];
  contrataciones?: any[];
  config?: Record<string, any>;
  type?: string;
}

const collectionTable: Record<string, string> = {
  citas: 'citas',
  subcontratas: 'subcontratas',
  reconocimientos: 'reconocimientos',
  contrataciones: 'contrataciones',
};

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
  return {
    ...source,
    people: firstArray<Person>(source.people, source.workers, source.trabajadores, source.personas),
    deletedPeople: firstArray<DeletedPerson>(source.deletedPeople, source.trash, source.personasEliminadas),
    citas: firstArray(source.citas),
    subcontratas: firstArray(source.subcontratas, source.config?.subcontratas),
    reconocimientos: firstArray(source.reconocimientos),
    contrataciones: firstArray(source.contrataciones),
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
  // Las subcontratas sincronizan además su checklist; se mantienen secuenciales para no
  // competir por los mismos documentos. El resto se restaura en lotes concurrentes.
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

export async function restoreBackupToSupabase(rawPayload: ProfeaBackupPayload, mode: RestoreMode) {
  const payload = normalizeBackupPayload(rawPayload);
  const ownerId = await currentUserId();
  const workers = Array.isArray(payload.people) ? payload.people : [];
  const trash = Array.isArray(payload.deletedPeople) ? payload.deletedPeople : [];

  if (mode === 'replace' && workers.length === 0) {
    const existing = await supabase.query('trabajadores', {
      query: `select=id&owner_id=eq.${encodeURIComponent(ownerId)}&limit=1`,
    });
    if (existing?.length) {
      throw new Error('La copia no contiene trabajadores reconocibles. Se ha cancelado el reemplazo para evitar borrar los datos actuales.');
    }
  }

  // Trabajadores + papelera se restauran en una única transacción de PostgreSQL.
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

  const config = payload.config || {};
  const current = await loadAppBusinessSettings();
  const settings = mode === 'merge' ? {
    savedObras: mergeList(current.savedObras, config.obras),
    savedLugares: mergeList(current.savedLugares, config.lugares),
    savedSitios: mergeList(current.savedSitios, config.sitios),
    savedTelefonos: mergeList(current.savedTelefonos, config.telefonos),
    savedCategorias: mergeList(current.savedCategorias, config.categorias),
    workStartHour: current.workStartHour,
    workEndHour: current.workEndHour,
  } : {
    savedObras: Array.isArray(config.obras) ? config.obras : [],
    savedLugares: Array.isArray(config.lugares) ? config.lugares : [],
    savedSitios: Array.isArray(config.sitios) ? config.sitios : [],
    savedTelefonos: Array.isArray(config.telefonos) ? config.telefonos : [],
    savedCategorias: Array.isArray(config.categorias) ? config.categorias : current.savedCategorias,
    workStartHour: config.workStartHour || '08:00',
    workEndHour: config.workEndHour || '15:00',
  };
  await saveAppBusinessSettings(settings);

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
  if (Object.keys(prefPatch).length) await saveSubcontratasPreferences(prefPatch);

  return { restored, settings, normalized: payload };
}
