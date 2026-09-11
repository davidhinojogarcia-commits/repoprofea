import type { DeletedPerson, Person } from '../../types';
import { supabase } from '../lib/supabase';
import { createDocument } from './databaseService';
import { loadAppBusinessSettings, saveAppBusinessSettings } from './appSettingsService';
import { loadSubcontratasPreferences, saveSubcontratasPreferences } from './subcontratasPreferencesService';

export type RestoreMode = 'replace' | 'merge';

export interface ProfeaBackupPayload {
  people?: Person[];
  deletedPeople?: DeletedPerson[];
  citas?: any[];
  subcontratas?: any[];
  reconocimientos?: any[];
  contrataciones?: any[];
  config?: Record<string, any>;
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

export async function restoreBackupToSupabase(payload: ProfeaBackupPayload, mode: RestoreMode) {
  const ownerId = await currentUserId();
  const workers = Array.isArray(payload.people) ? payload.people : [];
  const trash = Array.isArray(payload.deletedPeople) ? payload.deletedPeople : [];

  const restored = await supabase.rpc('restore_workers_trash_backup', {
    p_workers: workers,
    p_trash: trash,
    p_replace: mode === 'replace',
  });

  for (const collection of ['citas', 'subcontratas', 'reconocimientos', 'contrataciones'] as const) {
    const rows = backupCollection(payload, collection);
    if (mode === 'replace') await deleteOwnedRows(collectionTable[collection], ownerId);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {};
      const id = row.id ?? `${collection}_${Date.now()}_${i}`;
      await createDocument(collection, id, row);
    }
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

  return { restored, settings };
}
