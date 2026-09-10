from pathlib import Path

# --- Configuracion: restore into Supabase first, then update UI state ---
p = Path('components/Configuracion.tsx')
s = p.read_text()
anchor = "import { compressToGzip, decompressFromGzip, isCompressionSupported } from '../src/lib/compression';"
imp = "import { restoreBackupToSupabase } from '../src/services/backupRestoreService';"
if imp not in s:
    if anchor not in s:
        raise SystemExit('No se encontró import de compression en Configuracion')
    s = s.replace(anchor, anchor + "\n" + imp, 1)

start_marker = "  // 4. Confirm and Execute Restore\n"
end_marker = "\n  const tabs = ["
start = s.find(start_marker)
end = s.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('No se encontró bloque executeRestore')

new_block = r'''  // 4. Confirm and Execute Restore. Supabase is the source of truth:
  // nothing is applied to React state until the database restore succeeds.
  const executeRestore = async (mode: 'replace' | 'merge') => {
    if (!loadedBackup) return;

    const backupPeople: Person[] = Array.isArray(loadedBackup.people) ? loadedBackup.people : [];
    const backupDeletedPeople: DeletedPerson[] = Array.isArray(loadedBackup.deletedPeople) ? loadedBackup.deletedPeople : [];
    const backupConfig = loadedBackup.config || {};

    const mergePeopleByDni = (current: Person[], incoming: Person[]) => {
      const merged = [...current];
      incoming.forEach(bp => {
        const dni = String(bp?.dni || '').trim().toLowerCase();
        const idx = dni ? merged.findIndex(p => String(p?.dni || '').trim().toLowerCase() === dni) : -1;
        if (idx !== -1) merged[idx] = bp;
        else merged.push(bp);
      });
      return merged;
    };

    const mergeTrashByDni = (current: DeletedPerson[], incoming: DeletedPerson[]) => {
      const merged = [...current];
      incoming.forEach(bdp => {
        const dni = String(bdp?.person?.dni || '').trim().toLowerCase();
        const idx = dni ? merged.findIndex(dp => String(dp?.person?.dni || '').trim().toLowerCase() === dni) : -1;
        if (idx !== -1) merged[idx] = bdp;
        else merged.push(bdp);
      });
      return merged;
    };

    try {
      const result = await restoreBackupToSupabase(loadedBackup, mode);

      if (mode === 'replace') {
        setPeople(backupPeople);
        setDeletedPeople(backupDeletedPeople);
      } else {
        setPeople(prev => mergePeopleByDni(prev, backupPeople));
        setDeletedPeople(prev => mergeTrashByDni(prev, backupDeletedPeople));
      }

      // Reflect exactly what was persisted in Supabase.
      setSavedObras(result.settings.savedObras);
      setSavedLugares(result.settings.savedLugares);
      setSavedSitios(result.settings.savedSitios);
      setSavedTelefonos(result.settings.savedTelefonos);
      setSavedCategorias(result.settings.savedCategorias);
      setWorkStartHour(result.settings.workStartHour);
      setWorkEndHour(result.settings.workEndHour);

      // These report-only preferences are still migrated separately; keep compatibility
      // without using them as business-data storage.
      if (backupConfig.reporteTecnicoConfig) {
        saveStoredReporteTecnicoConfig(backupConfig.reporteTecnicoConfig);
      }
      if (backupConfig.obrasRecursosPreventivos) {
        try {
          localStorage.setItem('profea_obras_recursos_preventivos', JSON.stringify(backupConfig.obrasRecursosPreventivos));
          setObrasRecursos(backupConfig.obrasRecursosPreventivos);
        } catch {}
      }

      setLoadedBackup(null);
      if (setToast) {
        setToast({
          message: mode === 'replace'
            ? 'Copia restaurada y persistida en Supabase correctamente.'
            : 'Copia combinada y persistida en Supabase correctamente.',
          type: 'success'
        });
      }
    } catch (error: any) {
      console.error('Error restaurando copia en Supabase:', error);
      if (setToast) {
        setToast({ message: `No se pudo restaurar la copia en la base de datos: ${error?.message || 'error desconocido'}`, type: 'error' });
      } else {
        alert('No se pudo restaurar la copia en la base de datos.');
      }
    }
  };
'''
s = s[:start] + new_block + s[end:]
p.write_text(s)

# --- AdminPanel: blue primary controls and no redundant back button ---
p = Path('components/AdminPanel.tsx')
s = p.read_text()
s = s.replace(',ArrowLeft,Filter', ',Filter')
s = s.replace(',ArrowLeft', '')
back = '<button onClick={onClose} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2.5 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"><ArrowLeft size={17}/> Volver a la aplicación</button>'
if back not in s:
    raise SystemExit('No se encontró botón Volver a la aplicación')
s = s.replace(back, '', 1)
primary_old = 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
primary_new = 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:text-white dark:hover:bg-blue-500'
if primary_old not in s:
    raise SystemExit('No se encontraron estilos primarios slate en AdminPanel')
s = s.replace(primary_old, primary_new)
p.write_text(s)
