import { supabase } from '../lib/supabase';
import { getDocuments } from './databaseService';
import { loadAppBusinessSettings } from './appSettingsService';
import { loadSubcontratasPreferences } from './subcontratasPreferencesService';

export async function buildSupabaseSystemBackup(accountEmail = '') {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Debes iniciar sesión para generar una copia de seguridad.');

  const [people, deletedPeople, citas, subcontratas, reconocimientos, contrataciones, settings, subPrefs] = await Promise.all([
    getDocuments<any>('workers'),
    getDocuments<any>('trash'),
    getDocuments<any>('citas'),
    getDocuments<any>('subcontratas'),
    getDocuments<any>('reconocimientos'),
    getDocuments<any>('contrataciones'),
    loadAppBusinessSettings(),
    loadSubcontratasPreferences(),
  ]);

  const exportDate = new Date().toISOString();
  return {
    type: 'profea_complete_backup',
    system: 'Sistema de Gestión PROFEA',
    version: '3.0.0',
    source: 'supabase',
    exportDate,
    accountEmail: accountEmail || data.user.email || '',
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
    },
    metadata: {
      exportedAt: exportDate,
      timestamp: Date.now(),
      database: 'Supabase PostgreSQL',
    },
  };
}
