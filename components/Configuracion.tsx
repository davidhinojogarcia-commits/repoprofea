
import React, { useState, useRef } from 'react';
import { 
  Trash2, Plus, Settings, MapPin, GraduationCap, Stethoscope, Phone, 
  Briefcase, Search, AlertCircle, Database, Download, FileJson, 
  Clock, CheckCircle, LogIn, LogOut, ExternalLink, 
  Upload, FileArchive, Layers, ShieldAlert, RefreshCw, Loader2,
  FileText, Check, Edit3, Save, X, Building2, UserCheck
} from 'lucide-react';
import { Person, DeletedPerson } from '../types';
import { compressToGzip, decompressFromGzip, isCompressionSupported } from '../src/lib/compression';
import { restoreBackupToSupabase } from '../src/services/backupRestoreService';
import { getDocuments } from '../src/services/databaseService';
import { loadAppBusinessSettings } from '../src/services/appSettingsService';
import { downloadPDF } from '../src/lib/exportUtils';
import { PageHeader } from './ui/PageHeader';
import {
  getStoredReporteTecnicoConfig,
  saveStoredReporteTecnicoConfig,
  getStoredObrasRecursosPreventivos,
  saveStoredObraRecursoPreventivo,
  deleteStoredObraRecursoPreventivo,
  replaceStoredObrasRecursosPreventivos,
  ObraRecursoPreventivo
} from '../src/lib/subcontratasDefaults';

interface ConfiguracionProps {
  savedObras: string[];
  setSavedObras: React.Dispatch<React.SetStateAction<string[]>>;
  savedLugares: string[];
  setSavedLugares: React.Dispatch<React.SetStateAction<string[]>>;
  savedSitios: string[];
  setSavedSitios: React.Dispatch<React.SetStateAction<string[]>>;
  savedTelefonos: string[];
  setSavedTelefonos: React.Dispatch<React.SetStateAction<string[]>>;
  savedCategorias: string[];
  setSavedCategorias: React.Dispatch<React.SetStateAction<string[]>>;
  people: Person[];
  deletedPeople: DeletedPerson[];
  setPeople: React.Dispatch<React.SetStateAction<Person[]>>;
  setDeletedPeople: React.Dispatch<React.SetStateAction<DeletedPerson[]>>;
  workStartHour: string;
  setWorkStartHour: React.Dispatch<React.SetStateAction<string>>;
  workEndHour: string;
  setWorkEndHour: React.Dispatch<React.SetStateAction<string>>;
  googleUser?: any;
  googleToken?: string | null;
  autoSaveToDrive?: boolean;
  setAutoSaveToDrive?: (val: boolean) => void;
  onGoogleLogin?: () => void;
  onGoogleLogout?: () => void;
  autoThemeByTime: boolean;
  setAutoThemeByTime: (val: boolean) => void;
  driveBackupConfig?: any;
  setDriveBackupConfig?: (config: any) => void;
  onExecuteDriveBackupNow?: () => Promise<void>;
  isBackingUpToDrive?: boolean;
  setToast?: React.Dispatch<React.SetStateAction<{ message: string; type: 'success' | 'error' } | null>>;
}

export const Configuracion: React.FC<ConfiguracionProps> = ({
  savedObras,
  setSavedObras,
  savedLugares,
  setSavedLugares,
  savedSitios,
  setSavedSitios,
  savedTelefonos,
  setSavedTelefonos,
  savedCategorias,
  setSavedCategorias,
  people,
  deletedPeople,
  setPeople,
  setDeletedPeople,
  workStartHour,
  setWorkStartHour,
  workEndHour,
  setWorkEndHour,
  autoThemeByTime,
  setAutoThemeByTime,
  setToast,
}) => {
  const [activeTab, setActiveTab] = useState<'obras' | 'lugares' | 'sitios' | 'telefonos' | 'categorias' | 'backup' | 'jornada'>('lugares');

  const [newItem, setNewItem] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [deletingItem, setDeletingItem] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  // Recursos Preventivos por Obra state
  const [obrasRecursos, setObrasRecursos] = useState<Record<string, ObraRecursoPreventivo>>(() => getStoredObrasRecursosPreventivos());
  const [newObraRecurso, setNewObraRecurso] = useState('');
  const [newObraCategoria, setNewObraCategoria] = useState('Encargado de Obra');
  const [editingObraRecurso, setEditingObraRecurso] = useState<{
    obra: string;
    recurso: string;
    categoria: string;
  } | null>(null);

  // State for parsed backup verification
  const [loadedBackup, setLoadedBackup] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Build a complete backup from Supabase, the application's source of truth.
  // UI state is deliberately not used for business records so a stale render can never
  // produce a backup that differs from the database.
  const createBackupData = async () => {
    const [dbPeople, dbTrash, citas, subcontratas, reconocimientos, contrataciones, appSettings] = await Promise.all([
      getDocuments<Person>('trabajadores', { limitCount: 10000 }),
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

  // 1. Download Compressed Backup (GZIP)
  const handleDownloadBackupGzip = async () => {
    try {
      if (!isCompressionSupported()) {
        // Fallback to standard JSON if CompressionStream is not available
        await handleDownloadBackupNormal();
        return;
      }

      const backupObj = await createBackupData();
      const jsonStr = JSON.stringify(backupObj);
      const blob = await compressToGzip(jsonStr);

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      link.href = url;
      link.download = `copia_completa_profea_${dateStr}.json.gz`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      if (setToast) {
        setToast({ message: 'Copia de seguridad COMPRIMIDA descargada con éxito', type: 'success' });
      }
    } catch (error: any) {
      console.error(error);
      alert('⚠️ Hubo un error al generar la copia de seguridad comprimida: ' + error.message);
    }
  };

  // 2. Download Standard JSON Backup (Uncompressed fallback/alternative)
  const handleDownloadBackupNormal = async () => {
    try {
      const backupObj = await createBackupData();
      const jsonStr = JSON.stringify(backupObj, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      link.href = url;
      link.download = `copia_completa_profea_${dateStr}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      if (setToast) {
        setToast({ message: 'Copia de seguridad estándar descargada con éxito', type: 'success' });
      }
    } catch (error) {
      console.error(error);
      alert('⚠️ Hubo un error al generar la copia de seguridad estándar.');
    }
  };

  // 3. Import backup file
  const handleImportBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let jsonText = '';
      if (file.name.endsWith('.gz')) {
        jsonText = await decompressFromGzip(file);
      } else if (file.name.endsWith('.json')) {
        jsonText = await file.text();
      } else {
        alert('⚠️ Formato de archivo no soportado. Por favor, seleccione un archivo .json o .json.gz');
        return;
      }

      const parsed = JSON.parse(jsonText);
      if (parsed && (parsed.type === "profea_complete_backup" || parsed.people)) {
        setLoadedBackup(parsed);
      } else {
        alert('⚠️ El archivo no parece ser una copia de seguridad válida de esta aplicación.');
      }
    } catch (error: any) {
      console.error(error);
      alert('⚠️ Error al leer o procesar el archivo de copia de seguridad: ' + error.message);
    } finally {
      e.target.value = '';
    }
  };

  // 4. Confirm and Execute Restore. Supabase is the source of truth:
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
        replaceStoredObrasRecursosPreventivos(backupConfig.obrasRecursosPreventivos);
        setObrasRecursos(backupConfig.obrasRecursosPreventivos);
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

  const tabs = [
    { id: 'obras', label: 'Obras', icon: Building2, list: savedObras, setter: setSavedObras },
    { id: 'lugares', label: 'Lugares Formación', icon: GraduationCap, list: savedLugares, setter: setSavedLugares },
    { id: 'sitios', label: 'Sitios Reconocimiento', icon: Stethoscope, list: savedSitios, setter: setSavedSitios },
    { id: 'telefonos', label: 'Teléfonos', icon: Phone, list: savedTelefonos, setter: setSavedTelefonos },
    { id: 'categorias', label: 'Categorías', icon: Briefcase, list: savedCategorias, setter: setSavedCategorias },
  ] as const;

  const currentTab = tabs.find(t => t.id === activeTab);

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentTab) return;
    const trimmed = newItem.trim();
    if (!trimmed) return;

    if (currentTab.list.some(item => item.toLowerCase() === trimmed.toLowerCase())) {
      return;
    }

    currentTab.setter(prev => [...prev, trimmed].sort((a, b) => a.localeCompare(b)));
    setNewItem('');
  };

  const handleDeleteItem = (itemToDelete: string) => {
    if (!currentTab) return;
    currentTab.setter(prev => prev.filter(item => item !== itemToDelete));
    if (activeTab === 'obras') {
      deleteStoredObraRecursoPreventivo(itemToDelete);
      setObrasRecursos(getStoredObrasRecursosPreventivos());
    }
    setDeletingItem(null);
  };

  const handleAddObraWithRecurso = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedObra = newItem.trim();
    const trimmedRecurso = newObraRecurso.trim();
    if (!trimmedObra) {
      if (setToast) setToast({ message: 'Introduzca el nombre de la obra.', type: 'error' });
      return;
    }
    if (!trimmedRecurso) {
      if (setToast) setToast({ message: 'El campo Recurso Preventivo es obligatorio.', type: 'error' });
      return;
    }
    if (savedObras.some(o => o.toLowerCase() === trimmedObra.toLowerCase())) {
      if (setToast) setToast({ message: 'Ya existe una obra registrada con ese nombre.', type: 'error' });
      return;
    }

    setSavedObras(prev => [...prev, trimmedObra].sort((a, b) => a.localeCompare(b)));
    saveStoredObraRecursoPreventivo(trimmedObra, trimmedRecurso, newObraCategoria);
    setObrasRecursos(getStoredObrasRecursosPreventivos());
    setNewItem('');
    setNewObraRecurso('');
    setNewObraCategoria('Encargado de Obra');
    if (setToast) {
      setToast({ message: `Obra "${trimmedObra}" añadida con recurso preventivo "${trimmedRecurso}".`, type: 'success' });
    }
  };

  const handleSaveEditObraRecurso = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingObraRecurso) return;
    const { obra, recurso, categoria } = editingObraRecurso;
    if (!recurso.trim()) {
      if (setToast) setToast({ message: 'El nombre del Recurso Preventivo no puede estar vacío.', type: 'error' });
      return;
    }
    saveStoredObraRecursoPreventivo(obra, recurso.trim(), categoria.trim());
    setObrasRecursos(getStoredObrasRecursosPreventivos());
    setEditingObraRecurso(null);
    if (setToast) {
      setToast({ message: `Recurso Preventivo de "${obra}" actualizado correctamente.`, type: 'success' });
    }
  };

  const handleToggleSelectAll = () => {
    const allFilteredSelected = filteredList.every(item => selectedItems.includes(item));
    if (allFilteredSelected) {
      // Deselect all filtered items
      setSelectedItems(prev => prev.filter(item => !filteredList.includes(item)));
    } else {
      // Select all filtered items
      setSelectedItems(prev => {
        const union = [...prev];
        filteredList.forEach(item => {
          if (!union.includes(item)) {
            union.push(item);
          }
        });
        return union;
      });
    }
  };

  const handleBulkDelete = () => {
    if (!currentTab) return;
    currentTab.setter(prev => prev.filter(item => !selectedItems.includes(item)));
    if (activeTab === 'obras') {
      selectedItems.forEach(item => deleteStoredObraRecursoPreventivo(item));
      setObrasRecursos(getStoredObrasRecursosPreventivos());
    }
    if (setToast) {
      setToast({ 
        message: `Se han eliminado ${selectedItems.length} elementos de la lista de ${currentTab.label.toLowerCase()}`, 
        type: 'success' 
      });
    }
    setSelectedItems([]);
    setShowBulkConfirm(false);
  };

  const filteredList = currentTab
    ? currentTab.list.filter(item => item.toLowerCase().includes(searchTerm.toLowerCase()))
    : [];

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        eyebrow="Sistema"
        title="Configuración"
        description="Catálogos, jornada laboral, recursos de obra y copias de seguridad de PROFEA."
        icon={<Settings className="w-5 h-5" />}
        className="mb-8"
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar Tabs */}
        <div className="lg:col-span-1 space-y-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setSearchTerm('');
                setNewItem('');
                setDeletingItem(null);
                setSelectedItems([]);
                setShowBulkConfirm(false);
              }}
              className={`
                w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-bold
                ${activeTab === tab.id 
                  ? 'profea-sidebar-item--active text-white' 
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
                }
              `}
            >
              <tab.icon className={`w-5 h-5 ${activeTab === tab.id ? 'text-white' : 'text-slate-400 dark:text-slate-500'}`} />
              {tab.label}
              <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] ${activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
                {tab.list.length}
              </span>
            </button>
          ))}

          <div className="border-t border-slate-200 dark:border-slate-800 my-4 pt-4"></div>

          <button
            onClick={() => {
              setActiveTab('jornada');
              setSearchTerm('');
              setNewItem('');
              setDeletingItem(null);
              setSelectedItems([]);
              setShowBulkConfirm(false);
            }}
            className={`
              w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-bold mb-2
              ${activeTab === 'jornada' 
                ? 'profea-sidebar-item--active text-white' 
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
              }
            `}
          >
            <Clock className={`w-5 h-5 ${activeTab === 'jornada' ? 'text-white' : 'text-slate-400 dark:text-slate-500'}`} />
            Jornada Laboral
          </button>

          <button
            onClick={() => {
              setActiveTab('backup');
              setSearchTerm('');
              setNewItem('');
              setDeletingItem(null);
              setSelectedItems([]);
              setShowBulkConfirm(false);
            }}
            className={`
              w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-bold
              ${activeTab === 'backup' 
                ? 'profea-sidebar-item--active text-white' 
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
              }
            `}
          >
            <Database className={`w-5 h-5 ${activeTab === 'backup' ? 'text-white' : 'text-slate-400 dark:text-slate-500'}`} />
            Copia de Seguridad
          </button>
        </div>

        {/* Content Area */}
        <div className="lg:col-span-3">
          {activeTab === 'backup' ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in duration-300">
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 font-bold">
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Database className="w-6 h-6 text-brand-primary animate-pulse" />
                  Copia de Seguridad Completa
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                  Respalde toda la base de datos local de trabajadores activos, el histórico completo de la papelera y la configuración.
                </p>
              </div>

              <div className="p-6 space-y-6">
                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Trabajadores Activos</span>
                    <span className="text-2xl font-black text-slate-800 dark:text-slate-100 block mt-1">
                      {people.length}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 block">
                      En el directorio principal
                    </span>
                  </div>

                  <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">En la Papelera</span>
                    <span className="text-2xl font-black text-slate-800 dark:text-slate-100 block mt-1">
                      {deletedPeople.length}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 block">
                      Histórico recuperable (30d)
                    </span>
                  </div>

                  <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Sugerencias</span>
                    <span className="text-2xl font-black text-slate-800 dark:text-slate-100 block mt-1">
                      {savedObras.length + savedCategorias.length + savedLugares.length + savedSitios.length}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 block">
                      Listas de autocompletado
                    </span>
                  </div>
                </div>

                {/* Main Action Block: Export and Compression Information */}
                <div className="p-5 rounded-2xl border border-emerald-200/60 dark:border-emerald-950 bg-emerald-50/15 dark:bg-emerald-950/10 space-y-4">
                  <div className="flex gap-3 items-start">
                    <div className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
                      <FileArchive className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-emerald-800 dark:text-emerald-400">Compresión GZIP Nativa</h4>
                      <p className="text-xs text-emerald-700/80 dark:text-emerald-500/80 mt-1 leading-relaxed">
                        El modo de exportación comprimida procesa toda la base de datos localmente usando algoritmos de compresión modernos de su navegador. Esto reduce enormemente el tamaño del archivo, ideal para respaldos rápidos y transferencias livianas.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button
                      onClick={handleDownloadBackupGzip}
                      className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-5 rounded-xl shadow-md shadow-emerald-500/10 transition-all text-xs uppercase tracking-wider cursor-pointer"
                    >
                      <FileArchive className="w-4 h-4" />
                      Exportación Completa (.json.gz)
                    </button>
                    <button
                      onClick={handleDownloadBackupNormal}
                      className="flex-1 flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-300 font-bold py-3 px-5 rounded-xl border border-slate-200 dark:border-slate-700 transition-all text-xs uppercase tracking-wider cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      JSON Plano (.json)
                    </button>
                  </div>
                </div>

                {/* Import / Restore Section */}
                <div className="border-t border-slate-200/60 dark:border-slate-850 pt-6 space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                      <Upload className="w-4.5 h-4.5 text-slate-500" />
                      Restaurar Copia de Seguridad
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Seleccione el archivo de respaldo previo (<strong className="font-bold text-slate-600 dark:text-slate-300">.json</strong> o <strong className="font-bold text-slate-600 dark:text-slate-300">.json.gz</strong>) para restaurar en este dispositivo.
                    </p>
                  </div>

                  <div>
                    {/* Drag-n-drop clickable Area */}
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-brand-primary dark:hover:border-blue-500 rounded-2xl p-8 text-center cursor-pointer bg-slate-50/50 dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-850/30 transition-all group flex flex-col justify-center items-center"
                    >
                      <input 
                        type="file" 
                        ref={fileInputRef}
                        onChange={handleImportBackupFile}
                        accept=".json, .json.gz, .gz"
                        className="hidden"
                      />
                      <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                        <Upload className="w-6 h-6 text-slate-500 dark:text-slate-400" />
                      </div>
                      <span className="text-sm font-bold text-slate-750 dark:text-slate-300 block">
                        Seleccionar Archivo de Respaldo Local
                      </span>
                      <span className="text-xs text-slate-400 dark:text-slate-500 block mt-1">
                        Compatible con archivos de exportación .json y copias comprimidas .json.gz
                      </span>
                    </div>
                  </div>
                </div>

                {/* Custom Modal for Restore Confirmation and Options */}
                {loadedBackup && (
                  <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
                      
                      {/* Modal Header */}
                      <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/20">
                        <div className="flex gap-4 items-start">
                          <div className="p-3 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded-2xl shrink-0">
                            <ShieldAlert className="w-6 h-6 animate-pulse" />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Copia de Seguridad Detectada</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              Se ha verificado la integridad de los datos cargados. Por favor, elija cómo desea proceder con la restauración.
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Modal Details */}
                      <div className="p-6 space-y-4">
                        <div className="grid grid-cols-2 gap-3 text-xs p-4 rounded-2xl bg-slate-50 dark:bg-slate-850/50 border border-slate-200/50 dark:border-slate-800">
                          <div>
                            <span className="text-slate-400 dark:text-slate-500 block">Fecha de Exportación</span>
                            <span className="font-extrabold text-slate-700 dark:text-slate-200 mt-0.5 block">
                              {loadedBackup.exportDate ? new Date(loadedBackup.exportDate).toLocaleDateString('es-ES', {
                                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                              }) : 'Fecha desconocida'}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 dark:text-slate-500 block">Versión del Formato</span>
                            <span className="font-mono font-bold text-slate-700 dark:text-slate-200 mt-0.5 block">v{loadedBackup.version || '1.0.0'}</span>
                          </div>
                          <div className="col-span-2 border-t border-slate-200/50 dark:border-slate-700/50 pt-2.5 mt-1">
                            <span className="text-slate-400 dark:text-slate-500 block mb-1">Registros de Trabajadores Incluidos</span>
                            <div className="flex items-center gap-4 text-slate-700 dark:text-slate-200 font-bold">
                              <span>Activos: <strong className="text-brand-primary dark:text-blue-400">{loadedBackup.people?.length || 0}</strong></span>
                              <span>Papelera: <strong className="text-amber-600 dark:text-amber-400">{loadedBackup.deletedPeople?.length || 0}</strong></span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2.5">
                          {/* Option 1: Replace */}
                          <div className="p-3 rounded-xl border border-red-200 dark:border-red-950/40 bg-red-50/10 dark:bg-red-950/10 space-y-1">
                            <span className="text-xs font-bold text-red-600 dark:text-red-400 block">Opción A: Reemplazar Todo (Limpieza completa)</span>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                              Sustituye completamente la base de datos actual, la papelera y el autocompletado por los datos de la copia de seguridad. Los registros locales actuales que no estén en la copia se perderán.
                            </p>
                          </div>

                          {/* Option 2: Merge */}
                          <div className="p-3 rounded-xl border border-blue-200 dark:border-blue-950/40 bg-blue-50/10 dark:bg-blue-950/10 space-y-1">
                            <span className="text-xs font-bold text-blue-600 dark:text-blue-400 block">Opción B: Combinar e Integrar (Seguro)</span>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                              Une los registros del respaldo con los actuales sin duplicados (identifica por DNI). Conserva los nuevos trabajadores y añade los del respaldo que falten.
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Modal Footer */}
                      <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-2.5 justify-end bg-slate-50/50 dark:bg-slate-850/10">
                        <button
                          type="button"
                          onClick={() => setLoadedBackup(null)}
                          className="px-4 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer text-center"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => executeRestore('merge')}
                          className="px-4 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-md shadow-blue-500/10 cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          Combinar Datos
                        </button>
                        <button
                          type="button"
                          onClick={() => executeRestore('replace')}
                          className="px-4 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-md shadow-red-500/10 cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Reemplazar Todo
                        </button>
                      </div>

                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'jornada' ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in duration-300">
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10">
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Clock className="w-6 h-6 text-brand-primary animate-pulse" />
                  Jornada Laboral de Reconocimientos Médicos
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                  Defina el rango de horas habitual en el que se deben agendar los reconocimientos médicos de los trabajadores.
                </p>
              </div>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* Hora de Inicio */}
                  <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/10 space-y-3">
                    <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                      Hora de Inicio de Jornada
                    </label>
                    <div className="flex items-center gap-3">
                      <Clock className="w-5 h-5 text-emerald-500 shrink-0" />
                      <input
                        type="time"
                        value={workStartHour}
                        onChange={(e) => setWorkStartHour(e.target.value)}
                        className="w-full px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all"
                      />
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block leading-relaxed font-medium">
                      Hora de inicio predeterminada para el primer turno del día asignado.
                    </span>
                  </div>

                  {/* Hora de Fin */}
                  <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/10 space-y-3">
                    <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                      Hora de Fin de Jornada
                    </label>
                    <div className="flex items-center gap-3">
                      <Clock className="w-5 h-5 text-red-500 shrink-0" />
                      <input
                        type="time"
                        value={workEndHour}
                        onChange={(e) => setWorkEndHour(e.target.value)}
                        className="w-full px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all"
                      />
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block leading-relaxed font-medium">
                      Hora límite de salida. Las citas se programarán dentro de este límite.
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 text-blue-800 dark:text-blue-300 text-xs leading-relaxed flex gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block mb-1">💡 ¿Cómo utiliza la IA esta configuración?</strong>
                    Al solicitar a la IA la planificación automática ("Gestionar Citas" &gt; "Planificación Inteligente"), la IA organizará y agrupará a los trabajadores partiendo de las <strong>{workStartHour}</strong> de la mañana. Distribuirá las citas secuencialmente y evitará sobrepasar las <strong>{workEndHour}</strong> de la tarde.
                  </div>
                </div>

                {/* Detección Automática de Tema por Horario */}
                <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Detección Automática de Tema (Light/Dark)</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                        Cambia automáticamente al modo oscuro después de las <strong className="font-bold">20:00</strong> y vuelve al modo claro al amanecer (<strong className="font-bold">07:00</strong>). Si cambia el tema manualmente desde la barra superior, el modo automático se desactivará temporalmente.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none shrink-0">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={autoThemeByTime}
                        onChange={(e) => setAutoThemeByTime(e.target.checked)}
                      />
                      <div className="w-11 h-6 bg-slate-200 dark:bg-slate-800 rounded-full peer peer-focus:ring-2 peer-focus:ring-brand-primary/20 dark:peer-focus:ring-brand-primary/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:after:border-slate-600 peer-checked:bg-brand-primary"></div>
                    </label>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    <span className="w-2 h-2 rounded-full bg-brand-primary animate-ping"></span>
                    <span>Estado actual: {autoThemeByTime ? '🟢 Activado y monitorizando la hora' : '🔴 Desactivado (Tema estático)'}</span>
                  </div>
                </div>

                <div className="border-t border-slate-100 dark:border-slate-800 pt-6 space-y-3">
                  <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                    Simulación de Horarios (Intervalos sugeridos)
                  </span>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Así se vería una programación secuencial típica de citas cada 15 minutos con su jornada configurada:
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[0, 15, 30, 45].map((mins) => {
                      const [hStr, mStr] = workStartHour.split(':');
                      const h = parseInt(hStr || '8', 10);
                      const m = parseInt(mStr || '0', 10);
                      const totalMins = h * 60 + m + mins;
                      const simH = Math.floor(totalMins / 60) % 24;
                      const simM = totalMins % 60;
                      const formattedH = simH.toString().padStart(2, '0');
                      const formattedM = simM.toString().padStart(2, '0');
                      return (
                        <div key={mins} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 text-center">
                          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 block">TURNO {mins === 0 ? '1' : mins / 15 + 1}</span>
                          <span className="text-sm font-extrabold text-slate-700 dark:text-slate-300">{formattedH}:{formattedM}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab === 'obras' ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in duration-300">
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                      <MapPin className="w-6 h-6 text-brand-primary" />
                      Configuración de Obras y Recursos Preventivos
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                      Asigne a cada obra su Recurso Preventivo obligatorio y Categoría del puesto (ej. Encargado de Obra) para el cumplimiento de la Ley 32/2006 y su inclusión en las firmas de los reportes técnicos en PDF.
                    </p>
                  </div>
                </div>

                {/* Formulario de Alta con Recurso Preventivo Obligatorio */}
                <form onSubmit={handleAddObraWithRecurso} className="mt-5 p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs space-y-3">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <Plus className="w-4 h-4 text-brand-primary" />
                    <span>Añadir Nueva Obra con Recurso Preventivo Asignado</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-5">
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        Nombre de la Obra *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ej: Obra PFEA Jerez - C/ Larga..."
                        value={newItem}
                        onChange={(e) => setNewItem(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-brand-primary"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        Recurso Preventivo Asignado *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Nombre y Apellidos..."
                        value={newObraRecurso}
                        onChange={(e) => setNewObraRecurso(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-brand-primary"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        Categoría del Puesto
                      </label>
                      <select
                        value={newObraCategoria}
                        onChange={(e) => setNewObraCategoria(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-brand-primary"
                      >
                        <option value="Encargado de Obra">Encargado de Obra</option>
                        <option value="Capataz de Obra">Capataz de Obra</option>
                        <option value="Técnico Básico PRL (60h)">Técnico Básico PRL (60h)</option>
                        <option value="Oficial 1ª / Recurso Preventivo">Oficial 1ª / Recurso</option>
                        <option value="Jefe de Obra">Jefe de Obra</option>
                        <option value="Personal Designado PRL">Personal Designado PRL</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      className="flex items-center gap-1.5 px-4 py-2 bg-brand-primary text-white text-xs font-bold rounded-xl hover:bg-brand-primary/90 transition-colors shadow-md shadow-brand-primary/20 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Añadir Obra y Asignar Recurso</span>
                    </button>
                  </div>
                </form>
              </div>

              <div className="p-6">
                {/* Search Bar */}
                <div className="mb-6 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    placeholder="Filtrar por nombre de obra, recurso preventivo o categoría..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary transition-all placeholder-slate-400"
                  />
                </div>

                {savedObras.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-850 p-4 rounded-2xl mb-6">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="select-all-obras-checkbox"
                        checked={
                          savedObras.filter(o => {
                            const rec = obrasRecursos[o]?.recursoPreventivoNombre || '';
                            const cat = obrasRecursos[o]?.recursoPreventivoCategoria || '';
                            const searchLower = searchTerm.toLowerCase();
                            return o.toLowerCase().includes(searchLower) || rec.toLowerCase().includes(searchLower) || cat.toLowerCase().includes(searchLower);
                          }).length > 0 &&
                          savedObras
                            .filter(o => {
                              const rec = obrasRecursos[o]?.recursoPreventivoNombre || '';
                              const cat = obrasRecursos[o]?.recursoPreventivoCategoria || '';
                              const searchLower = searchTerm.toLowerCase();
                              return o.toLowerCase().includes(searchLower) || rec.toLowerCase().includes(searchLower) || cat.toLowerCase().includes(searchLower);
                            })
                            .every(item => selectedItems.includes(item))
                        }
                        onChange={() => {
                          const filtered = savedObras.filter(o => {
                            const rec = obrasRecursos[o]?.recursoPreventivoNombre || '';
                            const cat = obrasRecursos[o]?.recursoPreventivoCategoria || '';
                            const searchLower = searchTerm.toLowerCase();
                            return o.toLowerCase().includes(searchLower) || rec.toLowerCase().includes(searchLower) || cat.toLowerCase().includes(searchLower);
                          });
                          const allSelected = filtered.every(item => selectedItems.includes(item));
                          if (allSelected) {
                            setSelectedItems(prev => prev.filter(i => !filtered.includes(i)));
                          } else {
                            setSelectedItems(prev => Array.from(new Set([...prev, ...filtered])));
                          }
                        }}
                        className="w-4 h-4 rounded text-brand-primary focus:ring-brand-primary border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer"
                      />
                      <label htmlFor="select-all-obras-checkbox" className="text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                        Seleccionar todas las obras filtradas
                      </label>
                    </div>

                    {selectedItems.length > 0 && (
                      <div className="flex items-center gap-3 animate-in fade-in duration-200">
                        <span className="text-xs font-bold text-brand-primary dark:text-blue-400">
                          {selectedItems.length} seleccionadas
                        </span>
                        
                        {showBulkConfirm ? (
                          <div className="flex items-center gap-1.5 bg-red-500/10 dark:bg-red-950/20 px-2 py-1 rounded-xl border border-red-500/20">
                            <span className="text-[10px] font-black text-red-500 uppercase mr-1">¿Eliminar seleccionadas?</span>
                            <button
                              type="button"
                              onClick={handleBulkDelete}
                              className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-black rounded-lg transition-colors cursor-pointer"
                            >
                              SÍ
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowBulkConfirm(false)}
                              className="px-2.5 py-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold rounded-lg transition-colors cursor-pointer"
                            >
                              NO
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowBulkConfirm(true)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 rounded-xl text-xs font-bold hover:bg-red-100 dark:hover:bg-red-950/30 transition-all cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Borrado Masivo
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedItems([]);
                            setShowBulkConfirm(false);
                          }}
                          className="text-[11px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        >
                          Limpiar
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* List of Obras with Recurso Preventivo cards */}
                {(() => {
                  const filteredObras = savedObras.filter(o => {
                    const rec = obrasRecursos[o]?.recursoPreventivoNombre || '';
                    const cat = obrasRecursos[o]?.recursoPreventivoCategoria || '';
                    const searchLower = searchTerm.toLowerCase();
                    return o.toLowerCase().includes(searchLower) || rec.toLowerCase().includes(searchLower) || cat.toLowerCase().includes(searchLower);
                  });

                  if (filteredObras.length === 0) {
                    return (
                      <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                        <AlertCircle className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                        <p className="text-slate-500 dark:text-slate-400 font-medium">No se encontraron obras registradas</p>
                      </div>
                    );
                  }

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[550px] overflow-y-auto pr-2 custom-scrollbar">
                      {filteredObras.map((obra) => {
                        const recursoData = obrasRecursos[obra];
                        const isSelected = selectedItems.includes(obra);
                        return (
                          <div
                            key={obra}
                            className={`group p-3.5 bg-white dark:bg-slate-800 border rounded-xl hover:border-brand-primary/30 dark:hover:border-blue-500/30 hover:shadow-xs transition-all flex flex-col justify-between gap-3 ${
                              isSelected
                                ? 'border-brand-primary/40 bg-brand-primary/5 dark:bg-brand-primary/10'
                                : 'border-slate-200 dark:border-slate-800'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {
                                    setSelectedItems(prev =>
                                      prev.includes(obra)
                                        ? prev.filter(i => i !== obra)
                                        : [...prev, obra]
                                    );
                                    setShowBulkConfirm(false);
                                  }}
                                  className="w-4 h-4 mt-0.5 rounded text-brand-primary focus:ring-brand-primary/20 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer shrink-0"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate" title={obra}>
                                      {obra}
                                    </h4>
                                  </div>

                                  {/* Recurso Preventivo Badge */}
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    {recursoData?.recursoPreventivoNombre ? (
                                      <>
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                          <UserCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                          <span className="truncate max-w-[150px]">{recursoData.recursoPreventivoNombre}</span>
                                        </span>
                                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                          {recursoData.recursoPreventivoCategoria || 'Encargado de Obra'}
                                        </span>
                                      </>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                        <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
                                        <span>Sin recurso asignado</span>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setEditingObraRecurso({
                                    obra,
                                    recurso: recursoData?.recursoPreventivoNombre || '',
                                    categoria: recursoData?.recursoPreventivoCategoria || 'Encargado de Obra'
                                  })}
                                  className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-lg transition-colors cursor-pointer"
                                  title="Editar Recurso Preventivo"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingItem(obra)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
                                  title="Eliminar obra"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            {deletingItem === obra && (
                              <div className="flex items-center justify-between p-2 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 animate-in fade-in duration-150">
                                <span className="text-[11px] font-bold text-rose-700 dark:text-rose-300">¿Eliminar esta obra?</span>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteItem(obra)}
                                    className="px-2.5 py-1 bg-rose-600 text-white text-[10px] font-black rounded-md hover:bg-rose-700 transition-colors cursor-pointer"
                                  >
                                    SÍ
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeletingItem(null)}
                                    className="px-2.5 py-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold rounded-md hover:bg-slate-300 transition-colors cursor-pointer"
                                  >
                                    NO
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Modal para Editar Recurso Preventivo de Obra */}
              {editingObraRecurso && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                  <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4 animate-in fade-in zoom-in duration-200">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 rounded-lg">
                          <UserCheck className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                            Recurso Preventivo Asignado
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[280px]">
                            {editingObraRecurso.obra}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingObraRecurso(null)}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-md"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <form onSubmit={handleSaveEditObraRecurso} className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                          Nombre y Apellidos del Recurso Preventivo *
                        </label>
                        <input
                          type="text"
                          required
                          value={editingObraRecurso.recurso}
                          onChange={(e) => setEditingObraRecurso({ ...editingObraRecurso, recurso: e.target.value })}
                          placeholder="Ej: Manuel Gómez Serrano"
                          className="w-full px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                          Categoría del Puesto de Trabajo
                        </label>
                        <select
                          value={editingObraRecurso.categoria}
                          onChange={(e) => setEditingObraRecurso({ ...editingObraRecurso, categoria: e.target.value })}
                          className="w-full px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                        >
                          <option value="Encargado de Obra">Encargado de Obra</option>
                          <option value="Capataz de Obra">Capataz de Obra</option>
                          <option value="Técnico Básico PRL (60h)">Técnico Básico PRL (60h)</option>
                          <option value="Oficial 1ª / Recurso Preventivo">Oficial 1ª / Recurso Preventivo</option>
                          <option value="Jefe de Obra">Jefe de Obra</option>
                          <option value="Personal Designado PRL">Personal Designado PRL</option>
                        </select>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                          ℹ️ Esta persona aparecerá en la casilla de Recurso Preventivo del Reporte Técnico PDF de esta obra.
                        </p>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => setEditingObraRecurso(null)}
                          className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>Guardar Recurso</span>
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    {currentTab && <currentTab.icon className="w-6 h-6 text-brand-primary" />}
                    {currentTab?.label}
                  </h2>
                  
                  <form onSubmit={handleAddItem} className="flex w-full sm:w-auto gap-2">
                    <input
                      type="text"
                      placeholder={currentTab ? `Añadir ${currentTab.label.toLowerCase()}...` : ''}
                      value={newItem}
                      onChange={(e) => setNewItem(e.target.value)}
                      className="flex-1 sm:w-64 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all placeholder-slate-400"
                    />
                    <button
                      type="submit"
                      className="bg-brand-primary text-white p-2 rounded-xl hover:bg-brand-primary/90 transition-colors shadow-md shadow-brand-primary/10"
                      title="Añadir"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </form>
                </div>
              </div>

              <div className="p-6">
                <div className="mb-6 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    placeholder="Filtrar lista..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary transition-all placeholder-slate-400"
                  />
                </div>

                {currentTab && currentTab.list.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-850 p-4 rounded-2xl mb-6">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="select-all-checkbox"
                        checked={filteredList.length > 0 && filteredList.every(item => selectedItems.includes(item))}
                        onChange={handleToggleSelectAll}
                        className="w-4 h-4 rounded text-brand-primary focus:ring-brand-primary border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer"
                      />
                      <label htmlFor="select-all-checkbox" className="text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                        Seleccionar todos los filtrados ({filteredList.length})
                      </label>
                    </div>

                    {selectedItems.length > 0 && (
                      <div className="flex items-center gap-3 animate-in fade-in duration-200">
                        <span className="text-xs font-bold text-brand-primary dark:text-blue-400">
                          {selectedItems.length} seleccionados
                        </span>
                        
                        {showBulkConfirm ? (
                          <div className="flex items-center gap-1.5 bg-red-500/10 dark:bg-red-950/20 px-2 py-1 rounded-xl border border-red-500/20">
                            <span className="text-[10px] font-black text-red-500 uppercase mr-1">¿Eliminar seleccionados?</span>
                            <button
                              type="button"
                              onClick={handleBulkDelete}
                              className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-black rounded-lg transition-colors cursor-pointer"
                            >
                              SÍ
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowBulkConfirm(false)}
                              className="px-2.5 py-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold rounded-lg transition-colors cursor-pointer"
                            >
                              NO
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowBulkConfirm(true)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 rounded-xl text-xs font-bold hover:bg-red-100 dark:hover:bg-red-950/30 transition-all cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Borrado Masivo
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedItems([]);
                            setShowBulkConfirm(false);
                          }}
                          className="text-[11px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        >
                          Limpiar
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {filteredList.length === 0 ? (
                  <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                    <AlertCircle className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                    <p className="text-slate-500 dark:text-slate-400 font-medium">No se encontraron elementos</p>
                    {searchTerm && (
                      <button 
                        onClick={() => setSearchTerm('')}
                        className="text-brand-primary text-sm font-bold mt-2 hover:underline"
                      >
                        Limpiar búsqueda
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                    {filteredList.map((item, index) => (
                      <div 
                        key={index}
                        className={`group flex items-center justify-between p-3 bg-white dark:bg-slate-800 border rounded-xl hover:border-brand-primary/30 dark:hover:border-blue-500/30 hover:shadow-sm transition-all ${
                          selectedItems.includes(item) 
                            ? 'border-brand-primary/40 bg-brand-primary/5 dark:bg-brand-primary/10 dark:border-blue-500/40' 
                            : 'border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        {deletingItem === item ? (
                          <div className="flex items-center justify-between w-full animate-in fade-in zoom-in-95 duration-200">
                            <span className="text-xs font-bold text-red-500 uppercase">¿Eliminar?</span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleDeleteItem(item)}
                                className="px-3 py-1 bg-red-500 text-white text-[10px] font-bold rounded-lg hover:bg-red-600 transition-colors"
                              >
                                SÍ
                              </button>
                              <button
                                onClick={() => setDeletingItem(null)}
                                className="px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                              >
                                NO
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-3 truncate pr-4">
                              <input 
                                type="checkbox"
                                checked={selectedItems.includes(item)}
                                onChange={() => {
                                  setSelectedItems(prev => 
                                    prev.includes(item) 
                                      ? prev.filter(i => i !== item) 
                                      : [...prev, item]
                                  );
                                  setShowBulkConfirm(false);
                                }}
                                className="w-4 h-4 rounded text-brand-primary focus:ring-brand-primary/20 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 transition-all cursor-pointer"
                              />
                              <span className="text-sm text-slate-700 dark:text-slate-200 font-medium truncate">
                                {item}
                              </span>
                            </div>
                            <button
                              onClick={() => setDeletingItem(item)}
                              className="p-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-all lg:opacity-0 group-hover:opacity-100"
                              title="Eliminar"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border-t border-amber-100 dark:border-amber-900/40 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                  <strong>Nota:</strong> Eliminar un elemento de esta lista no afectará a los registros ya guardados. 
                  Simplemente dejará de aparecer como sugerencia en los formularios.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
