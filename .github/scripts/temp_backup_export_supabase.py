from pathlib import Path

p = Path('components/Configuracion.tsx')
s = p.read_text()

# Extend imports for authoritative backup reads.
old = "import { restoreBackupToSupabase } from '../src/services/backupRestoreService';"
new = old + "\nimport { getDocuments } from '../src/services/databaseService';\nimport { loadAppBusinessSettings } from '../src/services/appSettingsService';"
if "import { getDocuments } from '../src/services/databaseService';" not in s:
    if old not in s: raise SystemExit('restoreBackupToSupabase import not found')
    s = s.replace(old, new, 1)

start_marker = "  // Helper to format a backup object with all local tables and trash\n"
end_marker = "\n  // 1. Download Compressed Backup (GZIP)"
start = s.find(start_marker)
end = s.find(end_marker, start)
if start < 0 or end < 0: raise SystemExit('backup helper block not found')

block = r'''  // Build a complete backup from Supabase, the application's source of truth.
  // UI state is deliberately not used for business records so a stale render can never
  // produce a backup that differs from the database.
  const createBackupData = async () => {
    const [dbPeople, dbTrash, citas, subcontratas, reconocimientos, contrataciones, appSettings] = await Promise.all([
      getDocuments<Person>('workers', { limitCount: 10000 }),
      getDocuments<DeletedPerson>('trash', { limitCount: 10000 }),
      getDocuments<any>('citas', { limitCount: 10000 }),
      getDocuments<any>('subcontratas', { limitCount: 10000 }),
      getDocuments<any>('reconocimientos', { limitCount: 10000 }),
      getDocuments<any>('contrataciones', { limitCount: 10000 }),
      loadAppBusinessSettings(),
    ]);

    return {
      type: "profea_complete_backup",
      system: "Sistema de Gestión PROFEA",
      version: "3.0.0",
      storage: "supabase",
      exportDate: new Date().toISOString(),
      totalRecords: dbPeople.length,
      totalTrashRecords: dbTrash.length,
      people: dbPeople,
      deletedPeople: dbTrash,
      citas,
      subcontratas,
      reconocimientos,
      contrataciones,
      config: {
        obras: appSettings.savedObras,
        lugares: appSettings.savedLugares,
        sitios: appSettings.savedSitios,
        telefonos: appSettings.savedTelefonos,
        categorias: appSettings.savedCategorias,
        workStartHour: appSettings.workStartHour,
        workEndHour: appSettings.workEndHour,
        // Backward compatibility for backups created before v3.
        subcontratas,
        reporteTecnicoConfig: getStoredReporteTecnicoConfig(),
        obrasRecursosPreventivos: getStoredObrasRecursosPreventivos()
      }
    };
  };
'''
s = s[:start] + block + s[end:]

# Both download paths must await the database snapshot.
s = s.replace("      const backupObj = createBackupData();", "      const backupObj = await createBackupData();")
s = s.replace("  const handleDownloadBackupNormal = () => {", "  const handleDownloadBackupNormal = async () => {")
# Fallback from gzip should await too, avoiding an unhandled promise rejection.
s = s.replace("        handleDownloadBackupNormal();\n        return;", "        await handleDownloadBackupNormal();\n        return;")

# Ensure no legacy subcontratas localStorage read remains in backup creation.
if "localStorage.getItem('profea_subcontratas_v1')" in s:
    raise SystemExit('legacy subcontratas localStorage read still present')

p.write_text(s)
