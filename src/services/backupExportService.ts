import { supabase } from '../lib/supabase';
import { getDocuments } from './databaseService';
import { loadAppBusinessSettings } from './appSettingsService';
import { loadSubcontratasPreferences } from './subcontratasPreferencesService';

const safeRawTable = async (table: string) => {
  try {
    return await supabase.query(table, { query: 'select=*&limit=10000', fresh: true }) || [];
  } catch (error) {
    console.warn(`No se pudo incluir la tabla ${table} en la copia`, error);
    return [];
  }
};

export async function buildSupabaseSystemBackup(accountEmail = '') {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Debes iniciar sesión para generar una copia de seguridad.');

  const [
    people,
    deletedPeople,
    citas,
    subcontratas,
    reconocimientos,
    contrataciones,
    obras,
    settings,
    subPrefs,
    userSettingsRows,
    inventoryParks,
    inventoryItems,
    inventoryMovements,
    inventoryMaintenance,
    inventoryDocuments,
    inventoryParkMembers,
    subcontrataDocumentos,
  ] = await Promise.all([
    getDocuments<any>('trabajadores', { limitCount: 10000, fresh: true }),
    getDocuments<any>('trash', { limitCount: 10000, fresh: true }),
    getDocuments<any>('citas', { limitCount: 10000, fresh: true }),
    getDocuments<any>('subcontratas', { limitCount: 10000, fresh: true }),
    getDocuments<any>('reconocimientos', { limitCount: 10000, fresh: true }),
    getDocuments<any>('contrataciones', { limitCount: 10000, fresh: true }),
    getDocuments<any>('obras', { limitCount: 10000, fresh: true }),
    loadAppBusinessSettings(),
    loadSubcontratasPreferences(),
    supabase.query('user_settings', { query: `user_id=eq.${encodeURIComponent(data.user.id)}&select=settings&limit=1`, fresh: true }).catch(() => []),
    safeRawTable('inventory_parks'),
    safeRawTable('inventory_items'),
    safeRawTable('inventory_movements'),
    safeRawTable('inventory_maintenance'),
    safeRawTable('inventory_documents'),
    safeRawTable('inventory_park_members'),
    safeRawTable('subcontrata_documentos'),
  ]);

  const exportDate = new Date().toISOString();
  const completeSettings = userSettingsRows?.[0]?.settings && typeof userSettingsRows[0].settings === 'object'
    ? userSettingsRows[0].settings
    : {};

  const database = {
    obras,
    trabajadores: people,
    trash: deletedPeople,
    citas,
    subcontratas,
    reconocimientos,
    contrataciones,
    subcontrata_documentos: subcontrataDocumentos,
    inventory_parks: inventoryParks,
    inventory_items: inventoryItems,
    inventory_movements: inventoryMovements,
    inventory_maintenance: inventoryMaintenance,
    inventory_documents: inventoryDocuments,
    inventory_park_members: inventoryParkMembers,
  };

  return {
    type: 'profea_complete_backup',
    system: 'Sistema de Gestión PROFEA',
    version: '4.0.0',
    schema: 'profea-complete-backup-v4',
    source: 'supabase',
    exportDate,
    accountEmail: accountEmail || data.user.email || '',
    integrity: {
      reversible: true,
      format: 'json',
      generatedFromSourceOfTruth: true,
      includesCompleteSettings: true,
      includesInventory: true,
    },
    totals: Object.fromEntries(Object.entries(database).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])),
    database,
    settings: completeSettings,

    // Alias v3 conservados para que versiones anteriores puedan seguir leyendo la copia.
    totalActiveWorkers: people.length,
    totalTrashWorkers: deletedPeople.length,
    totalCitas: citas.length,
    totalSubcontratas: subcontratas.length,
    totalReconocimientos: reconocimientos.length,
    totalContrataciones: contrataciones.length,
    people,
    deletedPeople,
    citas,
    subcontratas,
    reconocimientos,
    contrataciones,
    obras,
    config: {
      obras: settings.savedObras,
      lugares: settings.savedLugares,
      sitios: settings.savedSitios,
      telefonos: settings.savedTelefonos,
      categorias: settings.savedCategorias,
      workStartHour: settings.workStartHour,
      workEndHour: settings.workEndHour,
      reporteTecnicoConfig: subPrefs.reporteTecnicoConfig,
      obrasRecursosPreventivos: subPrefs.obrasRecursosPreventivos,
      checklistTemplate: subPrefs.checklistTemplate,
      annualHiringPeriods: completeSettings.annualHiringPeriods,
    },
    metadata: {
      exportedAt: exportDate,
      timestamp: Date.now(),
      database: 'Supabase PostgreSQL',
      userId: data.user.id,
    },
  };
}
