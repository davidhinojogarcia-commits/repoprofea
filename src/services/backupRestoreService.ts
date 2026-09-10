import type { DeletedPerson, Person } from '../../types';
import { supabase } from '../lib/supabase';
import { createDocument } from './databaseService';
import { saveAppBusinessSettings } from './appSettingsService';

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
  await saveAppBusinessSettings({
    savedObras: Array.isArray(config.obras) ? config.obras : undefined,
    savedLugares: Array.isArray(config.lugares) ? config.lugares : undefined,
    savedSitios: Array.isArray(config.sitios) ? config.sitios : undefined,
    savedTelefonos: Array.isArray(config.telefonos) ? config.telefonos : undefined,
    savedCategorias: Array.isArray(config.categorias) ? config.categorias : undefined,
    workStartHour: config.workStartHour || undefined,
    workEndHour: config.workEndHour || undefined,
  });

  return restored;
}
