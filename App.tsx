
import React, { Suspense, lazy, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { auth } from './src/lib/supabaseData';
import { getSessionUser } from './src/lib/supabase';
import {
  getActionHistoryState,
  redoActionHistory,
  subscribeActionHistory,
  undoActionHistory,
} from './src/lib/actionHistory';
import { Header } from './components/Header';
import { PrintHeader } from './components/PrintHeader';
import { Sidebar, ViewMode } from './components/Sidebar';
import { Stats } from './components/Stats';
import { RegistrationForm } from './components/RegistrationForm';
import { PersonList } from './components/PersonList';
import { EditPersonModal } from './components/EditPersonModal';
import { BulkEditModal } from './components/BulkEditModal';
import { PeriodicReportModal } from './components/PeriodicReportModal';
import { CameraScannerModal } from './components/CameraScannerModal';
import { ImportDuplicateModal } from './components/ImportDuplicateModal';
import { PdfViewerModal } from './components/PdfViewerModal';
import { PushNotificationManagerModal } from './components/PushNotificationManagerModal';
import * as pdfjsLib from 'pdfjs-dist';

if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;
}
import { detectImportDuplicates, DuplicateMatch } from './src/lib/duplicateFilter';
import { createDocument, updateDocument, deleteDocument, subscribeToDocuments } from './src/services/databaseService';
import { importWorkersAtomic } from './src/services/workerImportService';
import { persistMedicalRecognition } from './src/services/medicalRecognitionService';
import { loadAppBusinessSettings, saveAppBusinessSettings, clearLegacyBusinessSettings } from './src/services/appSettingsService';
import { Person, StatsData, DeletedPerson } from './types';
import ExcelJS from 'exceljs';
import { CheckCircle, AlertTriangle, Cloud, RefreshCw } from 'lucide-react';
import { 
  preparePRLExcelData, 
  preparePRLPDFData, 
  prepareRRMMExcelData, 
  prepareRRMMPDFData, 
  prepareExcelData, 
  preparePDFData, 
  prepareCalzadoExcelData,
  prepareCalzadoPDFData,
  handleEmailFiles,
  downloadExcel,
  downloadPDF,
  generateWorkerIDCardPDF,
  generateWorkerHistoryOnlyPDF,
  generateObraSummaryPDF,
  generateStatsSummaryPDF,
  getStoredPdfConfig,
  saveStoredPdfConfig
} from './src/lib/exportUtils';
import { checkAndTriggerUpcomingAlerts, getNotificationAlertsSummary } from './src/lib/pushNotifications';
import { 
  loadDriveBackupConfig, 
  saveDriveBackupConfig, 
  buildCompleteSystemBackup, 
  uploadBackupFileToDrive, 
  isBackupDue, 
  sanitizeHistory,
  DriveAutoBackupConfig 
} from './src/lib/driveBackup';
import { compressToGzip } from './src/lib/compression';

const Configuracion = lazy(() => import('./components/Configuracion').then(module => ({ default: module.Configuracion })));
const Papelera = lazy(() => import('./components/Papelera').then(module => ({ default: module.Papelera })));
const GestionCitas = lazy(() => import('./components/GestionCitas').then(module => ({ default: module.GestionCitas })));
const CalendarioIntegrado = lazy(() => import('./components/CalendarioIntegrado').then(module => ({ default: module.CalendarioIntegrado })));
const SubcontratasSection = lazy(() => import('./components/SubcontratasSection').then(module => ({ default: module.SubcontratasSection })));
const SaeSection = lazy(() => import('./components/SaeSection').then(module => ({ default: module.SaeSection })));
const InventorySection = lazy(() => import('./components/InventorySection').then(module => ({ default: module.InventorySection })));
const AdminPanel = lazy(() => import('./components/AdminPanel').then(module => ({ default: module.AdminPanel })));

const ViewLoadingFallback = () => (
  <div className="ui-surface p-8 min-h-48 flex items-center justify-center">
    <div className="flex items-center gap-3 text-sm font-semibold text-[var(--ui-text-muted)]">
      <RefreshCw className="w-4 h-4 animate-spin text-[var(--ui-brand-700)]" />
      Cargando módulo…
    </div>
  </div>
);

const WatermarkLogo = () => (
  <div className="fixed bottom-6 right-8 pointer-events-none select-none z-0">
    <div className="flex flex-col items-end opacity-[0.08] dark:opacity-[0.18] transition-opacity">
      <img 
        src="/logo-diputacion-profea.svg" 
        alt="Watermark Logo" 
        className="dark:hidden h-12 md:h-16 w-auto object-contain"
      />
      <img 
        src="/logo-diputacion-profea-dark.svg" 
        alt="Watermark Logo" 
        className="hidden dark:block h-12 md:h-16 w-auto object-contain"
      />
    </div>
  </div>
);

// Garantiza IDs numéricos únicos durante la compatibilidad con registros históricos
const ensureUniquePersonIds = (list: Person[]): Person[] => {
  if (!Array.isArray(list)) return [];
  const seen = new Set<number>();
  return list.map((p, idx) => {
    let uniqueId = typeof p.id === 'number' ? p.id : Number(p.id);
    if (!uniqueId || isNaN(uniqueId) || seen.has(uniqueId)) {
      uniqueId = Date.now() + idx * 1000 + Math.floor(Math.random() * 999999) + 1;
    }
    seen.add(uniqueId);
    return uniqueId === p.id ? p : { ...p, id: uniqueId };
  });
};

function App() {
  useEffect(() => {
    document.title = 'Sistema Gestión Contratación PFEA';
  }, []);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const savedAuto = localStorage.getItem('personasPROFEA_autoThemeByTime');
    const autoEnabled = savedAuto === null ? true : savedAuto === 'true';
    if (autoEnabled) {
      const hour = new Date().getHours();
      if (hour >= 20 || hour < 7) {
        return 'dark';
      }
      return 'light';
    }
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      return 'dark';
    }
    return 'light';
  });

  const [activeView, setActiveView] = useState<ViewMode>('dashboard');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('inventoryItem') || params.has('inventoryInvite')) {
      setActiveView('inventario');
      window.dispatchEvent(new CustomEvent('profea:navigate', { detail: { view: 'inventario' } }));
    }
  }, []);
  const [people, setPeopleRaw] = useState<Person[]>([]);

  const setPeople = useCallback((action: React.SetStateAction<Person[]>) => {
    setPeopleRaw(prev => {
      const next = typeof action === 'function' ? (action as (prev: Person[]) => Person[])(prev) : action;
      return ensureUniquePersonIds(next);
    });
  }, []);

  const [historyState, setHistoryState] = useState(() => getActionHistoryState());
  const peopleRef = useRef<Person[]>(people);
  useEffect(() => {
    peopleRef.current = people;
  }, [people]);

  useEffect(() => subscribeActionHistory(setHistoryState), []);

  const canUndo = historyState.canUndo;
  const canRedo = historyState.canRedo;

  // Conserva la actualización inmediata del Directorio, pero el historial real
  // se registra en la capa de datos para que abarque todos los módulos.
  const setPeopleWithHistory = useCallback((
    value: Person[] | ((prev: Person[]) => Person[]),
    _recordHistory: boolean = true
  ) => {
    setPeopleRaw(prev => {
      const rawNext = typeof value === 'function' ? value(prev) : value;
      return ensureUniquePersonIds(rawNext);
    });
  }, []);

  const handleUndo = useCallback(async () => {
    try {
      const user = await getSessionUser();
      if (!user) {
        setToast({ message: 'Debes iniciar sesión para deshacer cambios.', type: 'error' });
        return;
      }
      const entry = await undoActionHistory(user.id);
      if (!entry) return;
      window.dispatchEvent(new CustomEvent('profea:history-applied', { detail: { direction: 'undo', label: entry.label } }));
      setToast({ message: `Deshecho: ${entry.label}`, type: 'success' });
    } catch (error) {
      console.error('Error deshaciendo la operación:', error);
      setToast({ message: 'No se pudo deshacer la última operación.', type: 'error' });
    }
  }, []);

  const handleRedo = useCallback(async () => {
    try {
      const user = await getSessionUser();
      if (!user) {
        setToast({ message: 'Debes iniciar sesión para rehacer cambios.', type: 'error' });
        return;
      }
      const entry = await redoActionHistory(user.id);
      if (!entry) return;
      window.dispatchEvent(new CustomEvent('profea:history-applied', { detail: { direction: 'redo', label: entry.label } }));
      setToast({ message: `Rehecho: ${entry.label}`, type: 'success' });
    } catch (error) {
      console.error('Error rehaciendo la operación:', error);
      setToast({ message: 'No se pudo rehacer la última operación.', type: 'error' });
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 3500); return () => window.clearTimeout(timer); }, [toast]);
  const [pendingPdfDni, setPendingPdfDni] = useState<string | null>(null);
  const [viewingWorkerPdf, setViewingWorkerPdf] = useState<string | null>(null);
  const [viewingWorkerName, setViewingWorkerName] = useState<string>('');
  const [activePdfViewerModal, setActivePdfViewerModal] = useState<{
    isOpen: boolean;
    url: string | null;
    title: string;
    downloadFilename: string;
  }>({
    isOpen: false,
    url: null,
    title: 'Visualizador PDF PROFEA',
    downloadFilename: 'Documento_PROFEA.pdf'
  });

  // Duplicate import warning modal state
  const [pendingImportModal, setPendingImportModal] = useState<{
    totalCount: number;
    uniqueWorkers: Omit<Person, 'id' | 'fechaRegistro'>[];
    duplicates: DuplicateMatch[];
    allWorkers: Omit<Person, 'id' | 'fechaRegistro'>[];
  } | null>(null);

  const [googleUser, setGoogleUser] = useState<any>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const handleGoogleLogin = async () => {
    setToast({ message: 'La conexión directa con Google Drive está deshabilitada en esta versión.', type: 'error' });
  };
  const handleGoogleLogout = async () => {
    setGoogleUser(null);
    setGoogleToken(null);
  };
  const [autoSaveToDrive, setAutoSaveToDrive] = useState<boolean>(() => {
    return localStorage.getItem('personasPROFEA_autoSaveToDrive') === 'true';
  });

  // Google Drive Scheduled Automatic Backups state
  const [driveBackupConfig, setDriveBackupConfig] = useState<DriveAutoBackupConfig>(() => loadDriveBackupConfig());
  const [isBackingUpToDrive, setIsBackingUpToDrive] = useState<boolean>(false);
  const isAutoBackupRunningRef = useRef<boolean>(false);

  const [autoThemeByTime, setAutoThemeByTime] = useState<boolean>(() => {
    const saved = localStorage.getItem('personasPROFEA_autoThemeByTime');
    return saved === null ? true : saved === 'true';
  });

  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);

  const notificationAlertsCount = useMemo(() => {
    if (!people || people.length === 0) return 0;
    return getNotificationAlertsSummary(people).totalAlertas;
  }, [people]);

  const supervisoresDisponibles = useMemo(() => {
    const set = new Set<string>();
    people.forEach(p => {
      if (p.supervisorResponsable && p.supervisorResponsable.trim()) {
        set.add(p.supervisorResponsable.trim());
      }
    });
    if (set.size === 0) {
      set.add('David Hinojo García');
    }
    return Array.from(set);
  }, [people]);

  useEffect(() => {
    localStorage.setItem('personasPROFEA_autoSaveToDrive', String(autoSaveToDrive));
  }, [autoSaveToDrive]);

  // Check for upcoming medical appointments and contract ends to trigger background SW alerts
  useEffect(() => {
    if (people && people.length > 0) {
      checkAndTriggerUpcomingAlerts(people);
    }
  }, [people]);

  useEffect(() => {
    localStorage.setItem('personasPROFEA_autoThemeByTime', String(autoThemeByTime));
  }, [autoThemeByTime]);

  const getExpectedTheme = (): 'light' | 'dark' => {
    const hour = new Date().getHours();
    if (hour >= 20 || hour < 7) {
      return 'dark';
    }
    return 'light';
  };

  useEffect(() => {
    if (!autoThemeByTime) return;

    const checkAndApplyTheme = () => {
      const expected = getExpectedTheme();
      setTheme(expected);
    };

    checkAndApplyTheme();

    const intervalId = setInterval(checkAndApplyTheme, 10000);
    return () => clearInterval(intervalId);
  }, [autoThemeByTime]);






  const uploadToGoogleDrive = async (blob: Blob, filename: string, showToastOnSuccess = true) => {
    if (!googleToken || !autoSaveToDrive) {
      return;
    }
    
    try {
      let folderId = '';
      const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='PROFEA_Cádiz' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      const searchRes = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${googleToken}` }
      });
      const searchData = await searchRes.json();
      
      if (searchData.files && searchData.files.length > 0) {
        folderId = searchData.files[0].id;
      } else {
        const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${googleToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: 'PROFEA_Cádiz',
            mimeType: 'application/vnd.google-apps.folder'
          })
        });
        const createData = await createRes.json();
        folderId = createData.id;
      }

      const metadata = {
        name: filename,
        parents: [folderId]
      };

      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', blob);

      const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { Authorization: `Bearer ${googleToken}` },
        body: form
      });

      if (!uploadRes.ok) {
        throw new Error('La subida de archivos a Google Drive falló.');
      }

      if (showToastOnSuccess) {
        setToast({ 
          message: `¡Copia guardada en Google Drive ("PROFEA_Cádiz/${filename}")!`, 
          type: 'success' 
        });
      }
    } catch (err: any) {
      console.error('Error auto-saving to Google Drive:', err);
      setToast({ 
        message: 'Error al subir copia a Google Drive: ' + (err.message || err), 
        type: 'error' 
      });
    }
  };



  // Effect to generate the worker PDF once the data is populated
  useEffect(() => {
    if (!pendingPdfDni) return;

    // Search for the worker in the people list
    const worker = people.find(p => p.dni.trim().toUpperCase().replace(/[\s-]/g, '') === pendingPdfDni);
    if (worker) {
      setToast({ message: `¡Ficha de ${worker.apellidosNombre} cargada! Generando vista en PDF...`, type: 'success' });
      
      const timer = setTimeout(async () => {
        try {
          const { doc } = await generateWorkerIDCardPDF(worker, people);
          const pdfBlob = doc.output('blob');
          const pdfUrl = URL.createObjectURL(pdfBlob);
          setViewingWorkerPdf(pdfUrl);
          setViewingWorkerName(worker.apellidosNombre);
        } catch (error) {
          console.error('Error generating QR target PDF:', error);
          setToast({ message: 'Error al generar la credencial en PDF', type: 'error' });
        }
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [people, pendingPdfDni]);

  // Supabase es la única fuente de verdad de trabajadores.
  useEffect(() => {
    if (!auth.currentUser?.uid) return;
    const unsubscribe = subscribeToDocuments<Person>('trabajadores', workers => {
      setPeople(workers.map(worker => ({ ...worker, sincronizadoEnNube: true })));
    }, { includeShared: true }, error => {
      console.error('Error leyendo trabajadores de Supabase:', error);
      setToast({ message: 'Error al leer los trabajadores desde Supabase.', type: 'error' });
    });
    return () => unsubscribe();
  }, []);

  // La papelera también se lee automáticamente desde Supabase.
  useEffect(() => {
    if (!auth.currentUser?.uid) return;
    const unsubscribe = subscribeToDocuments<DeletedPerson>('trash', items => {
      setDeletedPeople(items);
    }, { includeShared: true }, error => {
      console.error('Error leyendo la papelera de Supabase:', error);
      setToast({ message: 'Error al leer la papelera desde Supabase.', type: 'error' });
    });
    return () => unsubscribe();
  }, []);


  const [searchTerm, setSearchTerm] = useState('');
  const [selectedObraFilter, setSelectedObraFilter] = useState<string[]>(() => {
    const saved = localStorage.getItem('selectedObraFilter');
    try {
      return saved ? JSON.parse(saved) : ['Todas'];
    } catch {
      return saved ? [saved] : ['Todas'];
    }
  });
  const [selectedQuincenaFilter, setSelectedQuincenaFilter] = useState<string[]>(() => {
    const saved = localStorage.getItem('selectedQuincenaFilter');
    try {
      return saved ? JSON.parse(saved) : ['Todas'];
    } catch {
      return saved ? [saved] : ['Todas'];
    }
  });

  const [deletedPeople, setDeletedPeople] = useState<DeletedPerson[]>([]);

  const visiblePeople = people;
  const visibleDeletedPeople = deletedPeople;

  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [bulkEditingPeople, setBulkEditingPeople] = useState<Person[] | null>(null);
  const [savedObras, setSavedObras] = useState<string[]>([]);
  
  // Estados para filtros de resumen/estadísticas
  const [statsFilterMode, setStatsFilterMode] = useState<'origen' | 'fechas' | 'mes_actual' | 'ano_actual'>('origen');
  const [statsStartDate, setStatsStartDate] = useState('');
  const [statsEndDate, setStatsEndDate] = useState('');
  const [statsObraFilter, setStatsObraFilter] = useState<string[]>(['Todas']);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  const [savedLugares, setSavedLugares] = useState<string[]>([]);
  const [savedSitios, setSavedSitios] = useState<string[]>([]);
  const [savedTelefonos, setSavedTelefonos] = useState<string[]>([]);
  const [savedCategorias, setSavedCategorias] = useState<string[]>(['Peón', 'Oficial de 1ª', 'Encargado']);

  const [workStartHour, setWorkStartHour] = useState<string>('08:00');
  const [workEndHour, setWorkEndHour] = useState<string>('15:00');

  const businessSettingsHydratedRef = useRef(false);
  const businessSettingsSaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadAppBusinessSettings().then(settings => {
      if (cancelled) return;
      setSavedObras(settings.savedObras);
      setSavedLugares(settings.savedLugares);
      setSavedSitios(settings.savedSitios);
      setSavedTelefonos(settings.savedTelefonos);
      setSavedCategorias(settings.savedCategorias);
      setWorkStartHour(settings.workStartHour);
      setWorkEndHour(settings.workEndHour);
      businessSettingsHydratedRef.current = true;
      clearLegacyBusinessSettings();
    }).catch(error => {
      console.error('Error cargando configuración empresarial desde Supabase:', error);
      setToast({ message: 'No se pudo cargar la configuración desde Supabase.', type: 'error' });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const normalizedObras = new Set((savedObras || []).map(obra => String(obra || '').trim().toLocaleLowerCase('es-ES')).filter(Boolean));

    setStatsObraFilter(current => {
      if (current.includes('Todas')) return current;
      const valid = current.filter(obra => normalizedObras.has(String(obra || '').trim().toLocaleLowerCase('es-ES')));
      return valid.length ? valid : ['Todas'];
    });

    setSelectedObraFilter(current => {
      if (current.includes('Todas')) return current;
      const valid = current.filter(obra => normalizedObras.has(String(obra || '').trim().toLocaleLowerCase('es-ES')));
      return valid.length ? valid : ['Todas'];
    });
  }, [savedObras]);

  useEffect(() => {
    if (!businessSettingsHydratedRef.current) return;
    if (businessSettingsSaveTimerRef.current) window.clearTimeout(businessSettingsSaveTimerRef.current);
    businessSettingsSaveTimerRef.current = window.setTimeout(() => {
      void saveAppBusinessSettings({
        savedObras, savedLugares, savedSitios, savedTelefonos, savedCategorias,
        workStartHour, workEndHour,
      }).catch(error => {
        console.error('Error guardando configuración empresarial en Supabase:', error);
        setToast({ message: 'No se pudo guardar la configuración en Supabase.', type: 'error' });
      });
    }, 250);
    return () => {
      if (businessSettingsSaveTimerRef.current) window.clearTimeout(businessSettingsSaveTimerRef.current);
    };
  }, [savedObras, savedLugares, savedSitios, savedTelefonos, savedCategorias, workStartHour, workEndHour]);

  useEffect(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const expiredIds = deletedPeople
      .filter(item => new Date(item.fechaEliminacion).getTime() < cutoff)
      .map(item => item.person.id);
    if (!expiredIds.length) return;
    void Promise.all(expiredIds.map(id => deleteDocument('trash', id))).catch(error => {
      console.error('Error purgando papelera caducada en Supabase:', error);
    });
  }, [deletedPeople]);

  /**
   * Ejecuta una copia de seguridad íntegra de todos los datos a la cuenta de Google Drive configurada
   */
  const executeDriveBackupNow = async (isManual = false) => {
    if (isAutoBackupRunningRef.current) return;
    if (!googleToken) {
      if (isManual) {
        setToast({ message: '⚠️ Debe iniciar sesión con Google en Configuración para autorizar el respaldo.', type: 'error' });
      }
      return;
    }

    // Si hay un correo específico de destino, verificar que coincida con el usuario autenticado
    if (driveBackupConfig.targetAccountEmail) {
      const currentEmail = (googleUser?.email || '').trim().toLowerCase();
      const targetEmail = driveBackupConfig.targetAccountEmail.trim().toLowerCase();
      if (currentEmail && targetEmail && currentEmail !== targetEmail) {
        if (isManual) {
          setToast({ 
            message: `⚠️ La sesión activa (${currentEmail}) no coincide con la cuenta destino (${targetEmail}). Conecte esa cuenta en Configuración.`, 
            type: 'error' 
          });
        }
        return;
      }
    }

    try {
      isAutoBackupRunningRef.current = true;
      setIsBackingUpToDrive(true);

      const backupData = await buildCompleteSystemBackup({
        people,
        deletedPeople,
        savedObras,
        savedLugares,
        savedSitios,
        savedTelefonos,
        savedCategorias,
        workStartHour,
        workEndHour,
        accountEmail: googleUser?.email || driveBackupConfig.targetAccountEmail
      });

      const jsonStr = JSON.stringify(backupData, null, 2);
      const now = new Date();
      const datePart = now.toISOString().split('T')[0];
      const timePart = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
      
      let blob: Blob;
      let fileName: string;

      if (driveBackupConfig.compressGzip) {
        blob = await compressToGzip(jsonStr);
        fileName = `copia_completa_profea_${datePart}_${timePart}.json.gz`;
      } else {
        blob = new Blob([jsonStr], { type: 'application/json' });
        fileName = `copia_completa_profea_${datePart}_${timePart}.json`;
      }

      const uploadRes = await uploadBackupFileToDrive(
        googleToken,
        blob,
        fileName,
        driveBackupConfig.targetAccountEmail || googleUser?.email || ''
      );

      const nowIso = now.toISOString();
      const newHistoryItem = {
        id: `drive_bak_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        date: nowIso,
        fileName,
        fileSize: uploadRes.size,
        accountEmail: googleUser?.email || driveBackupConfig.targetAccountEmail || '',
        status: 'success' as const,
        driveFileId: uploadRes.fileId
      };

      const updatedConfig: DriveAutoBackupConfig = {
        ...driveBackupConfig,
        lastBackupDate: nowIso,
        lastBackupFileName: fileName,
        lastBackupSize: uploadRes.size,
        lastBackupStatus: 'success',
        lastBackupMessage: `Completada con éxito (${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })})`,
        history: sanitizeHistory([newHistoryItem, ...(driveBackupConfig.history || [])])
      };

      setDriveBackupConfig(updatedConfig);
      saveDriveBackupConfig(updatedConfig);

      if (isManual || driveBackupConfig.showNotificationToast) {
        setToast({ 
          message: `✓ Copia de seguridad guardada en Google Drive (PROFEA_Cádiz/Copias_Seguridad/${fileName})`, 
          type: 'success' 
        });
      }
    } catch (err: any) {
      console.error('Error durante la copia de seguridad a Google Drive:', err);
      const nowIso = new Date().toISOString();
      const newHistoryItem = {
        id: `drive_bak_err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        date: nowIso,
        fileName: 'Fallo al generar copia',
        fileSize: 0,
        accountEmail: googleUser?.email || driveBackupConfig.targetAccountEmail || '',
        status: 'error' as const,
        errorMessage: err?.message || 'Error de subida a Google Drive'
      };

      const updatedConfig: DriveAutoBackupConfig = {
        ...driveBackupConfig,
        lastBackupStatus: 'error',
        lastBackupMessage: `Error: ${err?.message || 'Error de conexión'}`,
        history: sanitizeHistory([newHistoryItem, ...(driveBackupConfig.history || [])])
      };

      setDriveBackupConfig(updatedConfig);
      saveDriveBackupConfig(updatedConfig);

      if (isManual) {
        setToast({ 
          message: `⚠️ Error al realizar la copia en Google Drive: ${err?.message || 'Error desconocido'}`, 
          type: 'error' 
        });
      }
    } finally {
      isAutoBackupRunningRef.current = false;
      setIsBackingUpToDrive(false);
    }
  };

  // Temporizador en segundo plano para verificar y ejecutar copias programadas a Google Drive
  useEffect(() => {
    if (!driveBackupConfig.enabled || !googleToken) return;

    const checkAndRun = async () => {
      if (isAutoBackupRunningRef.current) return;
      if (isBackupDue(driveBackupConfig)) {
        await executeDriveBackupNow(false);
      }
    };

    // Comprobación inicial pasados unos segundos
    const initialTimer = setTimeout(checkAndRun, 7000);
    // Intervalo de revisión cada 60 segundos
    const intervalTimer = setInterval(checkAndRun, 60000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [
    driveBackupConfig, 
    googleToken, 
    googleUser, 
    people, 
    deletedPeople, 
    savedObras, 
    savedLugares, 
    savedSitios, 
    savedTelefonos, 
    savedCategorias, 
    workStartHour, 
    workEndHour
  ]);



  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [theme]);

  const handleThemeToggle = () => {
    if (autoThemeByTime) {
      setAutoThemeByTime(false);
      setToast({ 
        message: 'Modo automático desactivado al cambiar el tema manualmente.', 
        type: 'success' 
      });
    }
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };





  useEffect(() => {
    localStorage.setItem('selectedObraFilter', JSON.stringify(selectedObraFilter));
  }, [selectedObraFilter]);

  useEffect(() => {
    localStorage.setItem('selectedQuincenaFilter', JSON.stringify(selectedQuincenaFilter));
  }, [selectedQuincenaFilter]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const updateAutocompleteLists = (person: Omit<Person, 'id' | 'fechaRegistro'> | Person) => {
    const normalize = (s?: string) => s?.trim() || '';
    
    const obra = normalize(person.obra);
    if (obra) {
      setSavedObras(prev => {
        if (prev.some(o => o.toLowerCase() === obra.toLowerCase())) return prev;
        return [...prev, obra].sort((a, b) => a.localeCompare(b));
      });
    }
    
    const lugar = normalize(person.lugarFormacion);
    if (lugar) {
      setSavedLugares(prev => {
        if (prev.some(l => l.toLowerCase() === lugar.toLowerCase())) return prev;
        return [...prev, lugar].sort((a, b) => a.localeCompare(b));
      });
    }
    
    const sitio = normalize(person.sitioReconocimiento);
    if (sitio) {
      setSavedSitios(prev => {
        if (prev.some(s => s.toLowerCase() === sitio.toLowerCase())) return prev;
        return [...prev, sitio].sort((a, b) => a.localeCompare(b));
      });
    }

    const telefono = normalize(person.telefono);
    if (telefono) {
      setSavedTelefonos(prev => {
        if (prev.some(t => t === telefono)) return prev;
        return [...prev, telefono].sort((a, b) => a.localeCompare(b));
      });
    }

    const categoria = normalize(person.categoria);
    if (categoria) {
      setSavedCategorias(prev => {
        if (prev.some(c => c.toLowerCase() === categoria.toLowerCase())) return prev;
        return [...prev, categoria].sort((a, b) => a.localeCompare(b));
      });
    }
  };

  const handleRegister = async (personData: Omit<Person, 'id' | 'fechaRegistro'>) => {
    // Si la persona ya estuvo registrada anteriormente sin formación, se actualiza a 'Sí'
    const cleanDni = personData.dni ? personData.dni.trim().toUpperCase().replace(/[\s-]/g, '') : '';
    const cleanName = personData.apellidosNombre ? personData.apellidosNombre.trim().toLowerCase() : '';
    const hadPreviousNoFormacion = people.some(p => {
      const pDni = p.dni ? p.dni.trim().toUpperCase().replace(/[\s-]/g, '') : '';
      const pName = p.apellidosNombre ? p.apellidosNombre.trim().toLowerCase() : '';
      const match = (cleanDni && pDni === cleanDni) || (cleanName && pName === cleanName);
      return match && (p.formacion === 'No' || p.formacion === 'Sin formación' || !p.formacion);
    });

    const finalPersonData = hadPreviousNoFormacion ? { ...personData, formacion: 'Sí' } : personData;
    const newPerson: Person = {
      ...finalPersonData,
      id: Date.now() + Math.floor(Math.random() * 100000) + 1,
      fechaRegistro: new Date().toISOString(),
      sincronizadoEnNube: true
    };

    try {
      await createDocument('trabajadores', newPerson.id, newPerson as any);
    } catch (error) {
      console.error('Error guardando trabajador en Supabase:', error);
      setToast({ message: 'No se ha podido guardar el trabajador en la base de datos.', type: 'error' });
      return;
    }

    setPeopleWithHistory(prev => [...prev, newPerson]);
    updateAutocompleteLists(finalPersonData);
    setToast({ message: 'Registro guardado correctamente', type: 'success' });
  };

  const commitAddMultipleWorkers = async (
    workersToAdd: Omit<Person, 'id' | 'fechaRegistro'>[],
    skippedCount: number = 0
  ) => {
    const baseId = Date.now();
    const formattedWorkers: Person[] = workersToAdd.map((w, index) => {
      const cleanDni = w.dni ? w.dni.trim().toUpperCase().replace(/[\s-]/g, '') : '';
      const cleanName = w.apellidosNombre ? w.apellidosNombre.trim().toLowerCase() : '';
      const hadPreviousNoFormacion = people.some(p => {
        const pDni = p.dni ? p.dni.trim().toUpperCase().replace(/[\s-]/g, '') : '';
        const pName = p.apellidosNombre ? p.apellidosNombre.trim().toLowerCase() : '';
        const match = (cleanDni && pDni === cleanDni) || (cleanName && pName === cleanName);
        return match && (p.formacion === 'No' || p.formacion === 'Sin formación' || !p.formacion);
      });

      const updatedW = hadPreviousNoFormacion ? { ...w, formacion: 'Sí' } : w;

      const person: Person = {
        ...updatedW,
        id: baseId + index * 1000 + Math.floor(Math.random() * 999) + 1,
        fechaRegistro: new Date().toISOString(),
        sincronizadoEnNube: true
      };
      updateAutocompleteLists(person);
      return person;
    });

    try {
      await importWorkersAtomic(formattedWorkers);
    } catch (error) {
      console.error('Error persistiendo trabajadores importados en Supabase:', error);
      setToast({ message: 'La importación no se ha guardado en la base de datos. No se han aplicado cambios.', type: 'error' });
      return;
    }

    setPeopleWithHistory(prev => [...prev, ...formattedWorkers]);

    if (skippedCount > 0) {
      setToast({
        message: `Se han importado ${formattedWorkers.length} trabajadores correctamente. Se omitieron ${skippedCount} duplicado(s) en el mismo periodo/quincena.`,
        type: 'success'
      });
    } else {
      setToast({ message: `Se han importado ${formattedWorkers.length} trabajadores correctamente`, type: 'success' });
    }


  };

  const handleAddMultipleWorkers = async (
    newWorkers: Omit<Person, 'id' | 'fechaRegistro'>[],
    skipDuplicateCheck: boolean = false
  ) => {
    if (!newWorkers || newWorkers.length === 0) return;

    if (!skipDuplicateCheck) {
      const { uniqueWorkers, duplicates } = detectImportDuplicates(newWorkers, people);

      if (duplicates.length > 0) {
        setPendingImportModal({
          totalCount: newWorkers.length,
          uniqueWorkers,
          duplicates,
          allWorkers: newWorkers
        });
        return;
      }
    }

    await commitAddMultipleWorkers(newWorkers, 0);
  };

  const handleDelete = async (id: number) => {
    const personToDelete = people.find(p => p.id === id);
    if (!personToDelete) return;
    if (!window.confirm(`¿Está seguro de que desea enviar a la Papelera el registro de ${personToDelete.apellidosNombre}? Se almacenará allí durante 30 días.`)) return;

    const deletedObj: DeletedPerson = { person: personToDelete, fechaEliminacion: new Date().toISOString() };
    try {
      await createDocument('trash', id, deletedObj as any);
      await deleteDocument('trabajadores', id);
      setToast({ message: 'Registro enviado a la Papelera correctamente', type: 'success' });
    } catch (error) {
      console.error('Error enviando trabajador a papelera en Supabase:', error);
      setToast({ message: 'No se pudo enviar el registro a la Papelera.', type: 'error' });
    }
  };

  const handleDeleteMultiple = async (ids: number[]) => {
    if (!ids?.length) return;
    if (!window.confirm(`¿Está seguro de que desea enviar ${ids.length} registros a la Papelera? Se almacenarán allí durante 30 días.`)) return;
    const peopleToDelete = people.filter(p => ids.includes(p.id));
    const fechaEliminacion = new Date().toISOString();
    try {
      for (const person of peopleToDelete) {
        await createDocument('trash', person.id, { person, fechaEliminacion } as any);
        await deleteDocument('trabajadores', person.id);
      }
      setToast({ message: `${peopleToDelete.length} registros enviados a la Papelera correctamente`, type: 'success' });
    } catch (error) {
      console.error('Error en baja múltiple de Supabase:', error);
      setToast({ message: 'No se pudieron enviar todos los registros a la Papelera.', type: 'error' });
    }
  };

  const handleRestorePerson = async (id: number) => {
    const foundDeleted = deletedPeople.find(dp => dp.person.id === id);
    if (!foundDeleted) return;
    try {
      await createDocument('trabajadores', id, foundDeleted.person as any);
      await deleteDocument('trash', id);
      setToast({ message: `Registro de ${foundDeleted.person.apellidosNombre} restaurado correctamente`, type: 'success' });
    } catch (error) {
      console.error('Error restaurando trabajador desde Supabase:', error);
      setToast({ message: 'No se pudo restaurar el registro.', type: 'error' });
    }
  };

  const handlePermanentDelete = async (id: number) => {
    const foundDeleted = deletedPeople.find(dp => dp.person.id === id);
    if (!foundDeleted) return;
    if (!window.confirm(`¿Está seguro de que desea eliminar permanentemente el registro de ${foundDeleted.person.apellidosNombre}? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteDocument('trash', id);
      setToast({ message: 'Registro eliminado definitivamente', type: 'success' });
    } catch (error) {
      console.error('Error eliminando definitivamente en Supabase:', error);
      setToast({ message: 'No se pudo eliminar definitivamente el registro.', type: 'error' });
    }
  };

  const handleEmptyTrash = async () => {
    if (!deletedPeople.length) return;
    if (!window.confirm(`¿Está seguro de que desea vaciar la Papelera? Se eliminarán definitivamente ${deletedPeople.length} registros.`)) return;
    try {
      for (const item of deletedPeople) await deleteDocument('trash', item.person.id);
      setToast({ message: 'Papelera vaciada correctamente', type: 'success' });
    } catch (error) {
      console.error('Error vaciando la papelera en Supabase:', error);
      setToast({ message: 'No se pudo vaciar completamente la Papelera.', type: 'error' });
    }
  };

  const handleEdit = (person: Person) => {
    setEditingPerson(person);
  };

  const handleUpdatePerson = async (updatedPerson: Person) => {
    try {
      await updateDocument('trabajadores', updatedPerson.id, updatedPerson as any);
      updateAutocompleteLists(updatedPerson);
      setEditingPerson(null);
      setToast({ message: 'Registro actualizado correctamente', type: 'success' });
    } catch (error) {
      console.error('Error actualizando trabajador en Supabase:', error);
      setToast({ message: 'No se pudo actualizar el registro.', type: 'error' });
    }
  };

  const handleBulkEditStart = (selectedPeople: Person[]) => {
    setBulkEditingPeople(selectedPeople);
  };

  const handleUpdateMultiplePeople = async (updates: Partial<Person>, selectedIds: number[]) => {
    const selected = people.filter(p => selectedIds.includes(p.id));
    try {
      const updated = selected.map(p => ({ ...p, ...updates }));
      await Promise.all(updated.map(person => updateDocument('trabajadores', person.id, person as any)));
      const samplePerson = updated[0];
      if (samplePerson) updateAutocompleteLists(samplePerson);
      setBulkEditingPeople(null);
      setToast({ message: `${updated.length} registros actualizados correctamente`, type: 'success' });
    } catch (error) {
      console.error('Error en edición masiva en Supabase:', error);
      setToast({ message: 'No se pudieron actualizar todos los registros.', type: 'error' });
    }
  };

  const handleTogglePersonSync = async (_id: number) => {
    setToast({ message: 'La compartición de registros se gestiona desde Administración > Permisos.', type: 'success' });
  };

  const stats: StatsData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const normalizeWorkName = (value: unknown) => String(value || '').trim().toLocaleLowerCase('es-ES');
    const canonicalObras: string[] = Array.from(new Map<string, string>(
      (savedObras || [])
        .map(obra => String(obra || '').trim())
        .filter(Boolean)
        .map(obra => [normalizeWorkName(obra), obra] as [string, string])
    ).values());
    const canonicalObraByKey = new Map<string, string>(
      canonicalObras.map(obra => [normalizeWorkName(obra), obra] as [string, string]),
    );
    const activeObraKeys = new Set(canonicalObraByKey.keys());

    let filteredPeople = [...visiblePeople];

    // La configuración de obras es la fuente de verdad de los proyectos activos.
    // Los registros históricos de trabajadores pueden conservar obras antiguas,
    // pero no deben volver a contarlas como proyectos activos del Centro de Control.
    if (!statsObraFilter.includes('Todas')) {
      const selectedKeys = new Set(statsObraFilter.map(normalizeWorkName));
      filteredPeople = filteredPeople.filter(p => selectedKeys.has(normalizeWorkName(p.obra)));
    }

    // Filtro por fechas (Accesos Rápidos y Rango Personalizado)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    if (statsFilterMode === 'mes_actual') {
      const startOfMonth = new Date(currentYear, currentMonth, 1, 0, 0, 0, 0);
      const endOfMonth = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);

      filteredPeople = filteredPeople.filter(p => {
        const pStartStr = p.periodoInicio || p.fechaRegistro;
        const pEndStr = p.periodoFin || p.periodoInicio || p.fechaRegistro;
        if (!pStartStr) return true;

        const pStart = new Date(pStartStr);
        const pEnd = pEndStr ? new Date(pEndStr) : pStart;
        return pEnd >= startOfMonth && pStart <= endOfMonth;
      });
    } else if (statsFilterMode === 'ano_actual') {
      const startOfYear = new Date(currentYear, 0, 1, 0, 0, 0, 0);
      const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59, 999);

      filteredPeople = filteredPeople.filter(p => {
        const pStartStr = p.periodoInicio || p.fechaRegistro;
        const pEndStr = p.periodoFin || p.periodoInicio || p.fechaRegistro;
        if (!pStartStr) return true;

        const pStart = new Date(pStartStr);
        const pEnd = pEndStr ? new Date(pEndStr) : pStart;
        return pEnd >= startOfYear && pStart <= endOfYear;
      });
    } else if (statsFilterMode === 'fechas') {
      if (statsStartDate) {
        const startLimit = new Date(statsStartDate);
        startLimit.setHours(0, 0, 0, 0);
        filteredPeople = filteredPeople.filter(p => {
          const pEndStr = p.periodoFin || p.periodoInicio || p.fechaRegistro;
          if (!pEndStr) return true;
          return new Date(pEndStr) >= startLimit;
        });
      }
      if (statsEndDate) {
        const endLimit = new Date(statsEndDate);
        endLimit.setHours(23, 59, 59, 999);
        filteredPeople = filteredPeople.filter(p => {
          const pStartStr = p.periodoInicio || p.fechaRegistro;
          if (!pStartStr) return true;
          return new Date(pStartStr) <= endLimit;
        });
      }
    }

    const desgloseQuincena: { [key: string]: number } = {};
    const dniCounts: { [key: string]: number } = {};
    const desgloseObra: { [key: string]: number } = {};
    
    filteredPeople.forEach(p => {
       if (p.quincena) desgloseQuincena[p.quincena] = (desgloseQuincena[p.quincena] || 0) + 1;

       const obraKey = normalizeWorkName(p.obra);
       const canonicalObra = canonicalObraByKey.get(obraKey);
       if (canonicalObra && activeObraKeys.has(obraKey)) {
         desgloseObra[canonicalObra] = (desgloseObra[canonicalObra] || 0) + 1;
       }

       const dni = p.dni ? p.dni.trim().toUpperCase() : '';
       if (dni) {
         dniCounts[dni] = (dniCounts[dni] || 0) + 1;
       }
    });

    // Contar formaciones por re-incorporación (personas registradas con Sí que anteriormente tuvieron un contrato con No)
    const formacionesReincorporacion = filteredPeople.filter(p => {
      if (p.formacion !== 'Sí') return false;
      const cleanDni = p.dni ? p.dni.trim().toUpperCase().replace(/[\s-]/g, '') : '';
      const cleanName = p.apellidosNombre ? p.apellidosNombre.trim().toLowerCase() : '';
      return people.some(prevP => {
        if (prevP.id === p.id) return false;
        const prevDni = prevP.dni ? prevP.dni.trim().toUpperCase().replace(/[\s-]/g, '') : '';
        const prevName = prevP.apellidosNombre ? prevP.apellidosNombre.trim().toLowerCase() : '';
        const isMatch = (cleanDni && prevDni === cleanDni) || (cleanName && prevName === cleanName);
        return isMatch && (prevP.formacion === 'No' || prevP.formacion === 'Sin formación' || !prevP.formacion);
      });
    }).length;

    return {
      total: filteredPeople.length,
      conFormacion: filteredPeople.filter(p => p.formacion === 'Sí').length,
      formacionesReincorporacion,
      citasPendientes: filteredPeople.filter(p => new Date(p.citaDia) >= today).length,
      totalObras: statsObraFilter.includes('Todas')
        ? canonicalObras.length
        : canonicalObras.filter(obra => statsObraFilter.some(selected => normalizeWorkName(selected) === normalizeWorkName(obra))).length,
      trabajadoresRepetidos: Object.values(dniCounts).filter(count => count > 1).length,
      desgloseQuincena,
      desgloseObra
    };
  }, [visiblePeople, savedObras, statsFilterMode, statsStartDate, statsEndDate, statsObraFilter]);

  const uniqueQuincenas = useMemo(() => Array.from(new Set(visiblePeople.map(p => p.quincena))).sort(), [visiblePeople]);

  const handleExportPRLExcel = async (dataToExport: Person[]) => {
    const filteredData = dataToExport.filter(p => p.formacion === 'No');
    if (filteredData.length === 0) return alert('No hay trabajadores sin formación para exportar');
    
    const { buffer, filename } = await preparePRLExcelData(filteredData);
    downloadExcel(buffer, filename);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    uploadToGoogleDrive(blob, filename);
  };

  const handleExportPRLPDF = (dataToExport: Person[]) => {
    const filteredData = dataToExport.filter(p => p.formacion === 'No');
    if (filteredData.length === 0) return alert('No hay trabajadores sin formación para exportar');

    const { doc, filename } = preparePRLPDFData(filteredData);
    downloadPDF(doc, filename);
    const blob = doc.output('blob');
    uploadToGoogleDrive(blob, filename);
  };

  const handleExportRRMMExcel = async (dataToExport: Person[]) => {
    if (dataToExport.length === 0) return alert('No hay datos para exportar');
    const { buffer, filename } = await prepareRRMMExcelData(dataToExport);
    downloadExcel(buffer, filename);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    uploadToGoogleDrive(blob, filename);
  };

  const handleExportRRMMPDF = (dataToExport: Person[]) => {
    if (dataToExport.length === 0) return alert('No hay datos para exportar');
    const { doc, filename } = prepareRRMMPDFData(dataToExport);
    downloadPDF(doc, filename);
    const blob = doc.output('blob');
    uploadToGoogleDrive(blob, filename);
  };

  const handleExportExcel = async (dataToExport: Person[]) => {
    if (dataToExport.length === 0) return alert('No hay datos para exportar');
    const { buffer, filename } = await prepareExcelData(dataToExport, people);
    downloadExcel(buffer, filename);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    uploadToGoogleDrive(blob, filename);
    return filename;
  };

  const handleExportPDF = (dataToExport: Person[]) => {
    if (dataToExport.length === 0) return alert('No hay datos para exportar');
    const { doc, filename } = preparePDFData(dataToExport, people);
    downloadPDF(doc, filename);
    const blob = doc.output('blob');
    uploadToGoogleDrive(blob, filename);
    return filename;
  };

  const handleEmailFilesWrapped = (dataToExport: Person[]) => {
    return handleEmailFiles(dataToExport, people);
  };

  const handleExportObraSummary = async () => {
    const selectedObras = statsObraFilter.filter(o => o !== 'Todas');
    
    if (selectedObras.length === 0) {
      alert('Por favor, selecciona una obra específica en el filtro de obra para exportar su resumen a pie de obra.');
      return;
    }
    
    if (selectedObras.length > 1) {
      alert('Por favor, selecciona solo una obra para generar el resumen consolidado a pie de obra.');
      return;
    }

    const targetObra = selectedObras[0];
    let targetWorkers = people.filter(p => p.obra === targetObra);
    
    const now = new Date();
    if (statsFilterMode === 'mes_actual') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      targetWorkers = targetWorkers.filter(p => {
        const pStartStr = p.periodoInicio || p.fechaRegistro;
        const pEndStr = p.periodoFin || p.periodoInicio || p.fechaRegistro;
        if (!pStartStr) return true;
        const pStart = new Date(pStartStr);
        const pEnd = pEndStr ? new Date(pEndStr) : pStart;
        return pEnd >= startOfMonth && pStart <= endOfMonth;
      });
    } else if (statsFilterMode === 'ano_actual') {
      const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      targetWorkers = targetWorkers.filter(p => {
        const pStartStr = p.periodoInicio || p.fechaRegistro;
        const pEndStr = p.periodoFin || p.periodoInicio || p.fechaRegistro;
        if (!pStartStr) return true;
        const pStart = new Date(pStartStr);
        const pEnd = pEndStr ? new Date(pEndStr) : pStart;
        return pEnd >= startOfYear && pStart <= endOfYear;
      });
    } else if (statsFilterMode === 'fechas') {
      if (statsStartDate) {
        const startLimit = new Date(statsStartDate);
        startLimit.setHours(0, 0, 0, 0);
        targetWorkers = targetWorkers.filter(p => {
          const pEndStr = p.periodoFin || p.periodoInicio || p.fechaRegistro;
          if (!pEndStr) return true;
          return new Date(pEndStr) >= startLimit;
        });
      }
      if (statsEndDate) {
        const endLimit = new Date(statsEndDate);
        endLimit.setHours(23, 59, 59, 999);
        targetWorkers = targetWorkers.filter(p => {
          const pStartStr = p.periodoInicio || p.fechaRegistro;
          if (!pStartStr) return true;
          return new Date(pStartStr) <= endLimit;
        });
      }
    }
    
    if (targetWorkers.length === 0) {
      alert(`No se encontraron trabajadores asignados a la obra "${targetObra}" con los filtros actuales.`);
      return;
    }
    
    try {
      const { doc, filename } = await generateObraSummaryPDF(targetObra, targetWorkers);
      downloadPDF(doc, filename);
      setToast({ message: `Dossier de pie de obra para "${targetObra}" generado correctamente`, type: 'success' });
      const blob = doc.output('blob');
      uploadToGoogleDrive(blob, filename);
    } catch (err) {
      console.error('Error generating summary PDF:', err);
      alert('Ocurrió un error al generar el PDF del resumen de obra.');
    }
  };

  const handleExportStatsPDF = async () => {
    // Obtener los trabajadores filtrados según la selección actual en Stats
    let filteredPeople = [...people];

    if (!statsObraFilter.includes('Todas')) {
      filteredPeople = filteredPeople.filter(p => statsObraFilter.includes(p.obra));
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    if (statsFilterMode === 'mes_actual') {
      const startOfMonth = new Date(currentYear, currentMonth, 1, 0, 0, 0, 0);
      const endOfMonth = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
      filteredPeople = filteredPeople.filter(p => {
        const pStartStr = p.periodoInicio || p.fechaRegistro;
        const pEndStr = p.periodoFin || p.periodoInicio || p.fechaRegistro;
        if (!pStartStr) return true;
        const pStart = new Date(pStartStr);
        const pEnd = pEndStr ? new Date(pEndStr) : pStart;
        return pEnd >= startOfMonth && pStart <= endOfMonth;
      });
    } else if (statsFilterMode === 'ano_actual') {
      const startOfYear = new Date(currentYear, 0, 1, 0, 0, 0, 0);
      const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59, 999);
      filteredPeople = filteredPeople.filter(p => {
        const pStartStr = p.periodoInicio || p.fechaRegistro;
        const pEndStr = p.periodoFin || p.periodoInicio || p.fechaRegistro;
        if (!pStartStr) return true;
        const pStart = new Date(pStartStr);
        const pEnd = pEndStr ? new Date(pEndStr) : pStart;
        return pEnd >= startOfYear && pStart <= endOfYear;
      });
    } else if (statsFilterMode === 'fechas') {
      if (statsStartDate) {
        const startLimit = new Date(statsStartDate);
        startLimit.setHours(0, 0, 0, 0);
        filteredPeople = filteredPeople.filter(p => {
          const pEndStr = p.periodoFin || p.periodoInicio || p.fechaRegistro;
          if (!pEndStr) return true;
          return new Date(pEndStr) >= startLimit;
        });
      }
      if (statsEndDate) {
        const endLimit = new Date(statsEndDate);
        endLimit.setHours(23, 59, 59, 999);
        filteredPeople = filteredPeople.filter(p => {
          const pStartStr = p.periodoInicio || p.fechaRegistro;
          if (!pStartStr) return true;
          return new Date(pStartStr) <= endLimit;
        });
      }
    }

    if (filteredPeople.length === 0) {
      alert('No hay contrataciones que coincidan con los filtros seleccionados para generar el resumen estadístico.');
      return;
    }

    try {
      const { doc, filename } = await generateStatsSummaryPDF({
        stats,
        filterMode: statsFilterMode,
        startDate: statsStartDate,
        endDate: statsEndDate,
        obraFilter: statsObraFilter,
        people: filteredPeople
      });
      downloadPDF(doc, filename);
      setToast({ message: 'Resumen estadístico exportado a PDF correctamente', type: 'success' });
      const blob = doc.output('blob');
      uploadToGoogleDrive(blob, filename);
    } catch (err) {
      console.error('Error generating stats summary PDF:', err);
      alert('Ocurrió un error al generar el PDF del resumen de estadísticas.');
    }
  };

  const handleGenerateIDCard = async (person: Person) => {
    try {
      const { doc, filename } = await generateWorkerIDCardPDF(person, people);
      downloadPDF(doc, filename);
      const blob = doc.output('blob');
      uploadToGoogleDrive(blob, filename);
      return filename;
    } catch (error) {
      console.error('Error al generar carné:', error);
      alert('Error al generar la credencial en PDF');
    }
  };

  const handleGenerateWorkerHistoryPDF = async (person: Person) => {
    try {
      const { doc, filename } = await generateWorkerHistoryOnlyPDF(person, people);
      downloadPDF(doc, filename);
      const blob = doc.output('blob');
      uploadToGoogleDrive(blob, filename);
      return filename;
    } catch (error) {
      console.error('Error al generar historial de contratos:', error);
      alert('Error al generar el historial de contratación en PDF');
    }
  };

  const handleExportCalzadoExcel = async (dataToExport: Person[]) => {
    if (dataToExport.length === 0) return alert('No hay datos para exportar');
    const { buffer, filename } = await prepareCalzadoExcelData(dataToExport);
    downloadExcel(buffer, filename);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    uploadToGoogleDrive(blob, filename);
  };

  const handleExportCalzadoPDF = (dataToExport: Person[]) => {
    if (dataToExport.length === 0) return alert('No hay datos para exportar');
    const { doc, filename } = prepareCalzadoPDFData(dataToExport);
    downloadPDF(doc, filename);
    const blob = doc.output('blob');
    uploadToGoogleDrive(blob, filename);
  };

  const handleImportExcel = async (file: File) => {
    try {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      const newPeople: Person[] = [];

      if (fileExtension === 'json') {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const candidates = Array.isArray(parsed) ? parsed : [parsed];
        
        candidates.forEach((item: any) => {
          if (item && typeof item === 'object' && (item.apellidosNombre || item.nombre) && (item.dni || item.nif)) {
            newPeople.push({
              id: Number(item.id) || (Date.now() + Math.random()),
              fechaRegistro: item.fechaRegistro || new Date().toISOString(),
              supervisorResponsable: item.supervisorResponsable || '',
              numOferta: item.numOferta || '',
              obra: item.obra || '',
              categoria: item.categoria || '',
              quincena: item.quincena || '',
              apellidosNombre: item.apellidosNombre || item.nombre || '',
              dni: item.dni || item.nif || '',
              fechaNacimiento: item.fechaNacimiento || '',
              periodoInicio: item.periodoInicio || '',
              periodoFin: item.periodoFin || '',
              telefono: item.telefono || '',
              calzado: item.calzado || '',
              formacion: item.formacion === 'Sí' || item.formacion === 'No' ? item.formacion : 'No',
              lugarFormacion: item.lugarFormacion || '',
              citaDia: item.citaDia || '',
              citaHora: item.citaHora || '',
              sitioReconocimiento: item.sitioReconocimiento || '',
              documentacionCompleta: item.documentacionCompleta === 'Sí' || item.documentacionCompleta === 'No' ? item.documentacionCompleta : 'No',
              observaciones: item.observaciones || '',
              sincronizadoEnNube: item.sincronizadoEnNube || false,
              necesitaReconocimiento: item.necesitaReconocimiento || 'No'
            });
          }
        });
      } else if (fileExtension === 'pdf') {
        setToast({ message: 'Procesando PDF...', type: 'success' });

        let extracted: any[] = [];
        try {
          const getBase64 = (f: File): Promise<string> => {
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.readAsDataURL(f);
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = error => reject(error);
            });
          };

          const fileBase64 = await getBase64(file);
          const res = await fetch('/api/parse-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileBase64 })
          });
          if (res.ok) {
            const responseData = await res.json();
            if (responseData.success && Array.isArray(responseData.workers)) {
              extracted = responseData.workers;
            }
          }
        } catch (apiErr) {
          console.warn('API parse-pdf failed, falling back to client-side extraction:', apiErr);
        }

        if (extracted.length > 0) {
          extracted.forEach((item: any) => {
            if (item && typeof item === 'object' && item.apellidosNombre && item.dni) {
              newPeople.push({
                id: Number(item.id) || (Date.now() + Math.random()),
                fechaRegistro: item.fechaRegistro || new Date().toISOString(),
                supervisorResponsable: item.supervisorResponsable || '',
                numOferta: item.numOferta || '',
                obra: item.obra || '',
                categoria: item.categoria || '',
                quincena: item.quincena || '',
                apellidosNombre: item.apellidosNombre || '',
                dni: item.dni || '',
                fechaNacimiento: item.fechaNacimiento || '',
                periodoInicio: item.periodoInicio || '',
                periodoFin: item.periodoFin || '',
                telefono: item.telefono || '',
                calzado: item.calzado || '',
                formacion: item.formacion === 'Sí' || item.formacion === 'No' ? item.formacion : 'No',
                lugarFormacion: item.lugarFormacion || '',
                citaDia: item.citaDia || '',
                citaHora: item.citaHora || '',
                sitioReconocimiento: item.sitioReconocimiento || '',
                documentacionCompleta: item.documentacionCompleta === 'Sí' || item.documentacionCompleta === 'No' ? item.documentacionCompleta : 'No',
                observaciones: item.observaciones || '',
                sincronizadoEnNube: false,
                necesitaReconocimiento: item.necesitaReconocimiento || 'No'
              });
            }
          });
        } else {
          // Client-side PDF text parsing fallback using pdfjs
          try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            let fullText = '';
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
              const page = await pdf.getPage(pageNum);
              const textContent = await page.getTextContent();
              const pageText = textContent.items.map((item: any) => item.str || '').join(' ');
              fullText += pageText + '\n';
            }

            const dniRegex = /\b(\d{8}[A-Za-z]|[X-Z]\d{7}[A-Za-z])\b/g;
            const matches = Array.from(new Set(fullText.match(dniRegex) || []));

            matches.forEach((dni, idx) => {
              newPeople.push({
                id: Date.now() + idx + Math.random(),
                fechaRegistro: new Date().toISOString(),
                supervisorResponsable: '',
                numOferta: '',
                obra: 'BORNOS',
                categoria: 'Peón',
                quincena: '1ª Quincena',
                apellidosNombre: `Trabajador PDF ${idx + 1}`,
                dni: dni.toUpperCase(),
                fechaNacimiento: '',
                periodoInicio: '',
                periodoFin: '',
                telefono: '',
                calzado: 'No indicado',
                formacion: 'No',
                lugarFormacion: '',
                citaDia: '',
                citaHora: '',
                sitioReconocimiento: '',
                documentacionCompleta: 'No',
                observaciones: 'Extraído de PDF',
                sincronizadoEnNube: false,
                necesitaReconocimiento: 'No'
              });
            });
          } catch (pdfJsErr) {
            console.error('Client-side PDF text extraction error:', pdfJsErr);
          }
        }
      } else {
        let parsedWithExcel = false;
        try {
          const arrayBuffer = await file.arrayBuffer();
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(arrayBuffer);
          const worksheet = workbook.getWorksheet(1);
          
          if (worksheet) {
            const supervisorCell = worksheet.getCell('G1').text || worksheet.getCell('E1').text || '';
            const supervisorMatch = supervisorCell.match(/SUPERVISOR RESPONSABLE:\s*(.+)/i);
            const supervisorResponsable = supervisorMatch ? supervisorMatch[1].trim() : '';

            const parseDate = (cellValue: any): string => {
              if (!cellValue || cellValue === '-') return '';
              if (cellValue instanceof Date) {
                const year = cellValue.getFullYear();
                const month = String(cellValue.getMonth() + 1).padStart(2, '0');
                const day = String(cellValue.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
              }
              
              let dateStr = '';
              if (typeof cellValue === 'object' && cellValue !== null) {
                dateStr = (cellValue.result || cellValue.text || '').toString().trim();
              } else {
                dateStr = cellValue.toString().trim();
              }

              if (!dateStr || dateStr === '-') return '';

              const parts = dateStr.split('/');
              if (parts.length === 3) {
                const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
                return `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
              }
              return dateStr;
            };

            const parseFormacionLugar = (text: string) => {
              let formacion: 'Sí' | 'No' = 'No';
              let lugarFormacion = '';
              
              const cleanText = text.trim();
              if (cleanText === 'Sí' || cleanText === 'No') {
                return { formacion: cleanText as 'Sí' | 'No', lugarFormacion: '' };
              }

              const lines = cleanText.replace(/\r\n/g, '\n').split('\n');
              lines.forEach(line => {
                const lowerLine = line.toLowerCase().trim();
                if (lowerLine.startsWith('formación:') || lowerLine.startsWith('formacion:')) {
                  const val = line.substring(line.indexOf(':') + 1).trim();
                  formacion = (val.toLowerCase() === 'sí' || val.toLowerCase() === 'si') ? 'Sí' : 'No';
                } else if (lowerLine.startsWith('lugar:')) {
                  const val = line.substring(line.indexOf(':') + 1).trim();
                  lugarFormacion = val === '-' ? '' : val;
                }
              });

              if (formacion === 'No' && cleanText.toLowerCase().includes('formación: sí')) {
                formacion = 'Sí';
              }
              
              return { formacion, lugarFormacion };
            };

            const parseCitaMedica = (text: string) => {
              let citaDia = '';
              let citaHora = '';
              let sitioReconocimiento = '';

              const lines = text.trim().replace(/\r\n/g, '\n').split('\n');
              lines.forEach(line => {
                const lowerLine = line.toLowerCase().trim();
                if (lowerLine.startsWith('cita:')) {
                  const val = line.substring(line.indexOf(':') + 1).trim();
                  if (val && val !== '-') {
                    const parts = val.split(/\s+/);
                    if (parts[0] && parts[0] !== '-') {
                      citaDia = parseDate(parts[0]);
                    }
                    if (parts[1]) {
                      citaHora = parts[1].trim();
                    }
                  }
                } else if (lowerLine.startsWith('centro:')) {
                  const val = line.substring(line.indexOf(':') + 1).trim();
                  sitioReconocimiento = val === '-' ? '' : val;
                }
              });

              return { citaDia, citaHora, sitioReconocimiento };
            };

            const parseDocObs = (text: string) => {
              let documentacionCompleta: 'Sí' | 'No' = 'No';
              let notesLines: string[] = [];
              let inNotas = false;

              const lines = text.trim().replace(/\r\n/g, '\n').split('\n');
              lines.forEach(line => {
                const trimmedLine = line.trim();
                const lowerLine = trimmedLine.toLowerCase();
                
                if (lowerLine.startsWith('expediente:')) {
                  inNotas = false;
                  const val = trimmedLine.substring(trimmedLine.indexOf(':') + 1).trim();
                  documentacionCompleta = (val === 'COMPLETO' || val.toLowerCase() === 'sí' || val.toLowerCase() === 'si') ? 'Sí' : 'No';
                } else if (lowerLine.startsWith('notas:')) {
                  inNotas = true;
                  const val = trimmedLine.substring(trimmedLine.indexOf(':') + 1).trim();
                  if (val && val !== '-') {
                    notesLines.push(val);
                  }
                } else if (inNotas) {
                  notesLines.push(trimmedLine);
                }
              });

              let observaciones = notesLines.join('\n').trim();
              if (observaciones === '-') {
                observaciones = '';
              }

              return { documentacionCompleta, observaciones };
            };

            worksheet.eachRow((row, rowNumber) => {
              if (rowNumber > 6) {
                const numOferta = row.getCell(1).text?.trim() || '';
                const obra = row.getCell(2).text?.trim() || '';
                const categoria = row.getCell(3).text?.trim() || '';
                const quincena = row.getCell(4).text?.trim() || '';
                const apellidosNombre = row.getCell(5).text?.trim() || '';
                const dni = row.getCell(6).text?.trim() || '';
                
                const fechaNacimiento = parseDate(row.getCell(7).value);
                const periodoInicio = parseDate(row.getCell(8).value);
                const periodoFin = parseDate(row.getCell(9).value);
                const telefono = row.getCell(10).text?.trim() || '';
                const calzado = row.getCell(11).text?.trim() || '';
                
                const formacionLugar = row.getCell(12).text || '';
                const { formacion, lugarFormacion } = parseFormacionLugar(formacionLugar);

                const citaMedica = row.getCell(13).text || '';
                const { citaDia, citaHora, sitioReconocimiento } = parseCitaMedica(citaMedica);

                const docObs = row.getCell(14).text || '';
                const { documentacionCompleta, observaciones } = parseDocObs(docObs);

                if (apellidosNombre && dni) {
                  newPeople.push({
                    id: Date.now() + Math.random(),
                    fechaRegistro: new Date().toISOString(),
                    supervisorResponsable,
                    numOferta,
                    obra,
                    categoria,
                    quincena,
                    apellidosNombre,
                    dni,
                    fechaNacimiento,
                    periodoInicio,
                    periodoFin,
                    telefono,
                    calzado,
                    formacion,
                    lugarFormacion,
                    citaDia,
                    citaHora,
                    sitioReconocimiento,
                    documentacionCompleta,
                    observaciones
                  });
                }
              }
            });

            if (newPeople.length > 0) {
              parsedWithExcel = true;
            }
          }
        } catch (excelErr) {
          console.warn('Excel parsing failed, trying text/CSV/JSON fallback:', excelErr);
        }

        if (!parsedWithExcel) {
          // Fallback text parsing (JSON or CSV)
          try {
            const text = await file.text();
            let parsedJson: any = null;
            try {
              parsedJson = JSON.parse(text);
            } catch {
              parsedJson = null;
            }

            if (parsedJson) {
              const candidates = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
              candidates.forEach((item: any) => {
                if (item && typeof item === 'object' && (item.apellidosNombre || item.nombre) && (item.dni || item.nif)) {
                  newPeople.push({
                    id: Number(item.id) || (Date.now() + Math.random()),
                    fechaRegistro: item.fechaRegistro || new Date().toISOString(),
                    supervisorResponsable: item.supervisorResponsable || '',
                    numOferta: item.numOferta || '',
                    obra: item.obra || '',
                    categoria: item.categoria || '',
                    quincena: item.quincena || '',
                    apellidosNombre: item.apellidosNombre || item.nombre || '',
                    dni: item.dni || item.nif || '',
                    fechaNacimiento: item.fechaNacimiento || '',
                    periodoInicio: item.periodoInicio || '',
                    periodoFin: item.periodoFin || '',
                    telefono: item.telefono || '',
                    calzado: item.calzado || '',
                    formacion: item.formacion === 'Sí' || item.formacion === 'No' ? item.formacion : 'No',
                    lugarFormacion: item.lugarFormacion || '',
                    citaDia: item.citaDia || '',
                    citaHora: item.citaHora || '',
                    sitioReconocimiento: item.sitioReconocimiento || '',
                    documentacionCompleta: item.documentacionCompleta === 'Sí' || item.documentacionCompleta === 'No' ? item.documentacionCompleta : 'No',
                    observaciones: item.observaciones || '',
                    sincronizadoEnNube: false,
                    necesitaReconocimiento: item.necesitaReconocimiento || 'No'
                  });
                }
              });
            } else {
              // Parse CSV / delimited text lines
              const parseCSVLine = (lineStr: string): string[] => {
                const res: string[] = [];
                let curr = '';
                let inQ = false;
                for (let i = 0; i < lineStr.length; i++) {
                  const ch = lineStr[i];
                  if (ch === '"') inQ = !inQ;
                  else if ((ch === ',' || ch === ';' || ch === '\t') && !inQ) {
                    res.push(curr.trim());
                    curr = '';
                  } else {
                    curr += ch;
                  }
                }
                res.push(curr.trim());
                return res;
              };

              const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
              if (lines.length > 0) {
                const firstRow = parseCSVLine(lines[0]);
                const headers = firstRow.map(h => h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
                
                const nameIdx = headers.findIndex(h => h.includes('nombre') || h.includes('apellidos') || h.includes('trabajador'));
                const dniIdx = headers.findIndex(h => h.includes('dni') || h.includes('nie') || h.includes('documento') || h.includes('identificacion'));
                const obraIdx = headers.findIndex(h => h.includes('obra') || h.includes('proyecto') || h.includes('localidad'));
                const quincenaIdx = headers.findIndex(h => h.includes('quincena') || h.includes('periodo'));
                const catIdx = headers.findIndex(h => h.includes('categoria') || h.includes('puesto'));
                const telIdx = headers.findIndex(h => h.includes('telefono') || h.includes('movil'));

                const startLine = (nameIdx >= 0 || dniIdx >= 0) ? 1 : 0;
                for (let i = startLine; i < lines.length; i++) {
                  const cols = parseCSVLine(lines[i]);
                  if (cols.length < 2) continue;
                  
                  const getVal = (idx: number, fallback = '') => {
                    if (idx >= 0 && idx < cols.length) {
                      return cols[idx].replace(/^"|"$/g, '').trim() || fallback;
                    }
                    return fallback;
                  };

                  const apellidosNombre = nameIdx >= 0 ? getVal(nameIdx) : getVal(0);
                  const dni = dniIdx >= 0 ? getVal(dniIdx) : getVal(1);

                  if (apellidosNombre && dni && !apellidosNombre.toLowerCase().includes('nombre') && !dni.toLowerCase().includes('dni')) {
                    newPeople.push({
                      id: Date.now() + i + Math.random(),
                      fechaRegistro: new Date().toISOString(),
                      supervisorResponsable: '',
                      numOferta: '',
                      obra: obraIdx >= 0 ? getVal(obraIdx, 'BORNOS') : getVal(2, 'BORNOS'),
                      categoria: catIdx >= 0 ? getVal(catIdx, 'Peón') : getVal(3, 'Peón'),
                      quincena: quincenaIdx >= 0 ? getVal(quincenaIdx, '1ª Quincena') : getVal(4, '1ª Quincena'),
                      apellidosNombre,
                      dni: dni.toUpperCase(),
                      fechaNacimiento: '',
                      periodoInicio: '',
                      periodoFin: '',
                      telefono: telIdx >= 0 ? getVal(telIdx) : getVal(5),
                      calzado: 'No indicado',
                      formacion: 'No',
                      lugarFormacion: '',
                      citaDia: '',
                      citaHora: '',
                      sitioReconocimiento: '',
                      documentacionCompleta: 'No',
                      observaciones: '',
                      sincronizadoEnNube: false,
                      necesitaReconocimiento: 'No'
                    });
                  }
                }
              }
            }
          } catch (textErr) {
            console.error('Fallback text parsing failed:', textErr);
          }
        }
      }

      if (newPeople.length > 0) {
        handleAddMultipleWorkers(newPeople);
      } else {
        setToast({ message: 'No se encontraron datos válidos para importar. Asegúrese de usar el formato Excel, CSV, JSON o PDF.', type: 'error' });
      }
    } catch (error: any) {
      console.error('Error al importar archivo:', error);
      const friendlyMsg = error?.message && error.message !== 'Load failed'
        ? error.message
        : 'No se pudo leer el archivo. Compruebe que no está dañado o pruebe con otro formato (Excel, CSV, JSON o PDF).';
      setToast({ message: friendlyMsg, type: 'error' });
    }
  };

  if (pendingPdfDni) {
    const worker = people.find(p => p.dni.trim().toUpperCase().replace(/[\s-]/g, '') === pendingPdfDni);
    
    if (viewingWorkerPdf) {
      return (
        <PdfViewerModal
          isOpen={true}
          pdfUrl={viewingWorkerPdf}
          title={`Expediente Oficial PDF · ${viewingWorkerName}`}
          downloadFilename={`FICHA_PROFEA_${viewingWorkerName.replace(/[\s,]+/g, '_')}.pdf`}
          onClose={() => {
            setViewingWorkerPdf(null);
            setPendingPdfDni(null);
            const newUrl = window.location.origin + window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
          }}
        />
      );
    }

    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 z-[100] text-center font-sans select-none">
        <div className="space-y-6 max-w-sm w-full animate-in fade-in zoom-in-95 duration-300">
          <div className="w-16 h-16 rounded-full bg-[#00548E]/10 border border-[#00548E]/20 text-[#00548E] dark:text-blue-400 flex items-center justify-center mx-auto animate-pulse">
            <Cloud className="w-8 h-8 animate-bounce text-blue-400" />
          </div>
          
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white tracking-tight">Expediente Digital PROFEA</h2>
            <p className="text-xs text-slate-400">
              Buscando y generando ficha para DNI: <span className="font-mono font-bold text-slate-200">{pendingPdfDni}</span>
            </p>
          </div>
          
          {worker ? (
            <div className="text-xs text-emerald-400 font-semibold flex items-center justify-center gap-1.5 animate-pulse bg-emerald-500/5 py-3 px-4 rounded-xl border border-emerald-500/10">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>¡Localizado! Generando vista completa del PDF...</span>
            </div>
          ) : (
            <div className="space-y-3 bg-slate-900/40 p-4 rounded-2xl border border-slate-800/80">
              <div className="text-xs text-slate-300 animate-pulse flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                <span>Buscando el registro en Supabase...</span>
              </div>
            </div>
          )}
          
          <button
            onClick={() => {
              setPendingPdfDni(null);
              const newUrl = window.location.origin + window.location.pathname;
              window.history.replaceState({}, document.title, newUrl);
            }}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors underline pt-4 cursor-pointer block mx-auto animate-pulse"
          >
            Cancelar y volver a la aplicación
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0f7ff] dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans relative overflow-x-clip selection:bg-[#00548E]/10 selection:text-[#00548E] dark:selection:bg-blue-600/20 dark:selection:text-blue-400 flex transition-colors duration-300">
      {/* Subtle background pattern */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.02] dark:opacity-[0.04] z-0">
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(#00548E 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
      </div>

      <Sidebar 
        activeView={activeView} 
        setActiveView={setActiveView} 
        isCollapsed={isSidebarCollapsed} 
        setIsCollapsed={setIsSidebarCollapsed}
        isMobileOpen={isMobileMenuOpen}
        setIsMobileOpen={setIsMobileMenuOpen}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        selectedObraFilter={selectedObraFilter}
        setSelectedObraFilter={setSelectedObraFilter}
        selectedQuincenaFilter={selectedQuincenaFilter}
        setSelectedQuincenaFilter={setSelectedQuincenaFilter}
        savedObras={savedObras}
        uniqueQuincenas={uniqueQuincenas}
        onOpenScanner={() => setIsScannerOpen(true)}
      />

      <WatermarkLogo />
      
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-6 py-4 rounded-2xl shadow-xl flex items-center gap-3 transition-all duration-300 animate-in slide-in-from-bottom-5 ${
          toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
          <span className="font-medium">{toast.message}</span>
        </div>
      )}

      <div className="relative z-10 flex-1 transition-all duration-300 min-w-0">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-8 py-8 pb-12">
          <PrintHeader 
            title="SISTEMA DE CONTRATACIÓN Y GESTIÓN PROFEA" 
            subtitle="DIPUTACIÓN PROVINCIAL DE CÁDIZ · REGISTRO ADMINISTRATIVO" 
          />
          <Header 
            onMenuClick={() => setIsMobileMenuOpen(true)} 
            theme={theme} 
            onThemeToggle={handleThemeToggle} 
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={canUndo}
            canRedo={canRedo}
            onOpenNotificationManager={() => setIsNotificationModalOpen(true)}
            alertsCount={notificationAlertsCount}
          />
          
          {activeView === 'dashboard' && (
            <div className="max-w-7xl mx-auto">
              <Stats
                stats={stats}
                filterMode={statsFilterMode}
                setFilterMode={setStatsFilterMode}
                startDate={statsStartDate}
                setStartDate={setStatsStartDate}
                endDate={statsEndDate}
                setEndDate={setStatsEndDate}
                obraFilter={statsObraFilter}
                setObraFilter={setStatsObraFilter}
                savedObras={savedObras}
                onOpenReportModal={() => setIsReportModalOpen(true)}
                onExportObraSummary={handleExportObraSummary}
                onExportStatsSummaryPDF={handleExportStatsPDF}
              />
            </div>
          )}

          {activeView === 'registro' && (
            <div className="max-w-3xl mx-auto">
               <RegistrationForm 
                 onRegister={handleRegister} 
                 savedObras={savedObras} 
                 savedLugares={savedLugares} 
                 savedSitios={savedSitios} 
                 savedTelefonos={savedTelefonos}
                 savedCategorias={savedCategorias}
                 people={visiblePeople}
               />
            </div>
          )}

          {activeView === 'directorio' && (
            <div className="max-w-6xl mx-auto">
              <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-800/80 overflow-hidden">
                <PersonList 
                  people={visiblePeople} 
                  onDelete={handleDelete} 
                  onEdit={handleEdit} 
                  onDeleteMultiple={handleDeleteMultiple}
                  onEditMultiple={handleBulkEditStart}
                  onExport={handleExportExcel} 
                  onExportPDF={handleExportPDF} 
                  onExportRRMMExcel={handleExportRRMMExcel}
                  onExportRRMMPDF={handleExportRRMMPDF}
                  onExportPRLExcel={handleExportPRLExcel}
                  onExportPRLPDF={handleExportPRLPDF}
                  onExportCalzadoExcel={handleExportCalzadoExcel}
                  onExportCalzadoPDF={handleExportCalzadoPDF}
                  onEmail={handleEmailFiles}
                  onImport={handleImportExcel}
                  onGenerateIDCard={handleGenerateIDCard}
                  onExportHistoryPDF={handleGenerateWorkerHistoryPDF}
                  savedObras={savedObras}
                  searchTerm={searchTerm}
                  setSearchTerm={setSearchTerm}
                  selectedObraFilter={selectedObraFilter}
                  setSelectedObraFilter={setSelectedObraFilter}
                  selectedQuincenaFilter={selectedQuincenaFilter}
                  setSelectedQuincenaFilter={setSelectedQuincenaFilter}
                  googleToken={googleToken}
                  onGoogleLogin={handleGoogleLogin}
                  onToast={(message, type) => setToast({ message, type })}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  canUndo={canUndo}
                  canRedo={canRedo}
                />
              </div>
            </div>
          )}

          {activeView === 'estadisticas' && (
            <div className="max-w-6xl mx-auto">
              <Stats 
                stats={stats} 
                filterMode={statsFilterMode}
                setFilterMode={setStatsFilterMode}
                startDate={statsStartDate}
                setStartDate={setStatsStartDate}
                endDate={statsEndDate}
                setEndDate={setStatsEndDate}
                obraFilter={statsObraFilter}
                setObraFilter={setStatsObraFilter}
                savedObras={savedObras}
                onOpenReportModal={() => setIsReportModalOpen(true)}
                onExportObraSummary={handleExportObraSummary}
                onExportStatsSummaryPDF={handleExportStatsPDF}
              />
            </div>
          )}

          {activeView === 'inventario' && (
            <Suspense fallback={<ViewLoadingFallback />}>
              <InventorySection savedObras={savedObras} />
            </Suspense>
          )}

          {activeView === 'configuracion' && (
            <Suspense fallback={<ViewLoadingFallback />}>
            <Configuracion 
              onImportWorkers={handleImportExcel}
              savedObras={savedObras}
              setSavedObras={setSavedObras}
              savedLugares={savedLugares}
              setSavedLugares={setSavedLugares}
              savedSitios={savedSitios}
              setSavedSitios={setSavedSitios}
              savedTelefonos={savedTelefonos}
              setSavedTelefonos={setSavedTelefonos}
              savedCategorias={savedCategorias}
              setSavedCategorias={setSavedCategorias}
              people={people}
              deletedPeople={deletedPeople}
              setPeople={setPeople}
              setDeletedPeople={setDeletedPeople}
              workStartHour={workStartHour}
              setWorkStartHour={setWorkStartHour}
              workEndHour={workEndHour}
              setWorkEndHour={setWorkEndHour}
              googleUser={googleUser}
              googleToken={googleToken}
              autoSaveToDrive={autoSaveToDrive}
              setAutoSaveToDrive={setAutoSaveToDrive}
              onGoogleLogin={handleGoogleLogin}
              onGoogleLogout={handleGoogleLogout}
              autoThemeByTime={autoThemeByTime}
              setAutoThemeByTime={setAutoThemeByTime}
              driveBackupConfig={driveBackupConfig}
              setDriveBackupConfig={setDriveBackupConfig}
              onExecuteDriveBackupNow={() => executeDriveBackupNow(true)}
              isBackingUpToDrive={isBackingUpToDrive}
              setToast={setToast}
            />
            </Suspense>
          )}

          {activeView === 'administracion' && (
            <Suspense fallback={<ViewLoadingFallback />}>
            <div className="max-w-7xl mx-auto">
              <AdminPanel onClose={() => setActiveView('dashboard')} />
            </div>
            </Suspense>
          )}

          {activeView === 'papelera' && (
            <Suspense fallback={<ViewLoadingFallback />}>
            <div className="max-w-6xl mx-auto">
              <Papelera
                deletedPeople={visibleDeletedPeople}
                onRestore={handleRestorePerson}
                onPermanentDelete={handlePermanentDelete}
                onEmptyTrash={handleEmptyTrash}
              />
            </div>
            </Suspense>
          )}

          {activeView === 'calendario' && (
            <Suspense fallback={<ViewLoadingFallback />}>
            <div className="max-w-7xl mx-auto">
              <CalendarioIntegrado
                people={visiblePeople}
                savedObras={savedObras}
                onEditPerson={(p) => setEditingPerson(p)}
                onToast={(message, type) => setToast({ message, type })}
                googleToken={googleToken}
                onOpenNotificationManager={() => setIsNotificationModalOpen(true)}
              />
            </div>
            </Suspense>
          )}

          {activeView === 'citas' && (
            <Suspense fallback={<ViewLoadingFallback />}>
            <div className="max-w-6xl mx-auto">
              <GestionCitas
                people={visiblePeople}
                savedSitios={savedSitios}
                savedTelefonos={savedTelefonos}
                onUpdateSavedTelefonos={setSavedTelefonos}
                workStartHour={workStartHour}
                workEndHour={workEndHour}
                onUpdateWorkStartHour={setWorkStartHour}
                onUpdatePeople={(updatedPeople) => {
                  const changed = updatedPeople.filter(p => {
                    const original = people.find(o => o.id === p.id);
                    return !original || JSON.stringify(original) !== JSON.stringify(p);
                  });
                  void Promise.all(changed.map(async p => {
                    await updateDocument('trabajadores', p.id, { ...p, sincronizadoEnNube: true } as any);
                    await persistMedicalRecognition(p);
                  })).then(() => {
                    setPeople(updatedPeople.map(p => ({ ...p, sincronizadoEnNube: true })));
                  }).catch(error => {
                    console.error('Error guardando reconocimientos en Supabase:', error);
                    setToast({ message: 'No se han podido guardar los cambios médicos en la base de datos.', type: 'error' });
                  });
                }}
                onToast={(message, type) => setToast({ message, type })}
              />
            </div>
            </Suspense>
          )}

          {activeView === 'subcontratas' && (
            <Suspense fallback={<ViewLoadingFallback />}>
            <div className="w-full max-w-[1600px] mx-auto min-w-0">
              <SubcontratasSection
                savedObras={savedObras}
                onUpdateSavedObras={setSavedObras}
                supervisoresDisponibles={supervisoresDisponibles}
                onToast={(message, type) => setToast({ message, type })}
              />
            </div>
            </Suspense>
          )}

          {activeView === 'sae' && (
            <Suspense fallback={<ViewLoadingFallback />}>
            <div className="w-full max-w-[1600px] mx-auto min-w-0">
              <SaeSection
                people={visiblePeople}
                onToast={(message, type) => setToast({ message, type })}
              />
            </div>
            </Suspense>
          )}

          {editingPerson && (
            <EditPersonModal 
              key={editingPerson.id}
              person={editingPerson} 
              isOpen={!!editingPerson} 
              onClose={() => setEditingPerson(null)} 
              onSave={handleUpdatePerson} 
              savedObras={savedObras} 
              savedLugares={savedLugares} 
              savedSitios={savedSitios} 
              savedTelefonos={savedTelefonos}
              savedCategorias={savedCategorias}
              allPeople={people}
            />
          )}

          {bulkEditingPeople && (
            <BulkEditModal
              selectedPeople={bulkEditingPeople}
              isOpen={!!bulkEditingPeople}
              onClose={() => setBulkEditingPeople(null)}
              onSave={handleUpdateMultiplePeople}
              savedObras={savedObras}
              savedLugares={savedLugares}
              savedSitios={savedSitios}
              savedTelefonos={savedTelefonos}
              savedCategorias={savedCategorias}
            />
          )}

          {isReportModalOpen && (
            <PeriodicReportModal
              isOpen={isReportModalOpen}
              onClose={() => setIsReportModalOpen(false)}
              people={people}
            />
          )}

          {pendingImportModal && (
            <ImportDuplicateModal
              isOpen={!!pendingImportModal}
              onClose={() => {
                setPendingImportModal(null);
                setToast({ message: 'Importación cancelada.', type: 'error' });
              }}
              totalCount={pendingImportModal.totalCount}
              uniqueCount={pendingImportModal.uniqueWorkers.length}
              duplicates={pendingImportModal.duplicates}
              onConfirmFilter={() => {
                const unique = pendingImportModal.uniqueWorkers;
                const skipped = pendingImportModal.duplicates.length;
                setPendingImportModal(null);
                void commitAddMultipleWorkers(unique, skipped);
              }}
              onConfirmImportAll={() => {
                const all = pendingImportModal.allWorkers;
                setPendingImportModal(null);
                void commitAddMultipleWorkers(all, 0);
              }}
            />
          )}

          <CameraScannerModal
            isOpen={isScannerOpen}
            onClose={() => setIsScannerOpen(false)}
            onToast={(msg, type) => setToast({ message: msg, type })}
            onAddWorkers={handleAddMultipleWorkers}
            workers={people.map(person => ({
              id: person.id,
              apellidosNombre: person.apellidosNombre,
              dni: person.dni,
              obra: person.obra,
              categoria: person.categoria,
            }))}
            onApplyAdministrativeData={async (workerId, data) => {
              const target = peopleRef.current.find(person => person.id === workerId);
              if (!target) throw new Error('No se ha encontrado el trabajador seleccionado.');

              const updated: Person = {
                ...target,
                ...(data.dni ? { dni: data.dni } : {}),
                ...(data.birthDate ? { fechaNacimiento: data.birthDate } : {}),
                ...(data.nuss ? { numeroSeguridadSocial: data.nuss } : {}),
                ...(data.iban ? { iban: data.iban } : {}),
                sincronizadoEnNube: true,
              };

              await updateDocument('trabajadores', updated.id, updated as any);
              updateAutocompleteLists(updated);
              setPeople(current => current.map(person => person.id === updated.id ? updated : person));
            }}
          />

          <PdfViewerModal
            isOpen={activePdfViewerModal.isOpen}
            onClose={() => setActivePdfViewerModal(prev => ({ ...prev, isOpen: false }))}
            pdfUrl={activePdfViewerModal.url}
            title={activePdfViewerModal.title}
            downloadFilename={activePdfViewerModal.downloadFilename}
          />

          <PushNotificationManagerModal
            isOpen={isNotificationModalOpen}
            onClose={() => setIsNotificationModalOpen(false)}
            people={visiblePeople}
            onToast={(msg, type) => setToast({ message: msg, type })}
          />

          {/* Persistencia directa en Supabase */}

          {toast && (
            <div aria-live="polite" role="status" className={`fixed top-5 right-5 z-[200] max-w-sm rounded-xl px-4 py-3 shadow-xl border text-sm font-semibold ${toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-950/40 dark:border-green-900 dark:text-green-200' : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200'}`}>
              {toast.type === 'success' ? '✓' : '✕'} {toast.message}
            </div>
          )}

          {/* Footer Copyright */}
          <footer className="mt-16 text-center border-t border-slate-200 dark:border-slate-800/85 pt-6 text-xs text-slate-400 dark:text-slate-500 font-medium">
            <p>© {new Date().getFullYear()} David Hinojo García. Todos los derechos reservados. | Sistema de Gestión</p>
          </footer>
        </div>
      </div>
    </div>
  );
}

export default App;
