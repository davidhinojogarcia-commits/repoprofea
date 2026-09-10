
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { PrintHeader } from './components/PrintHeader';
import { Sidebar, ViewMode } from './components/Sidebar';
import { Stats } from './components/Stats';
import { RegistrationForm } from './components/RegistrationForm';
import { PersonList } from './components/PersonList';
import { EditPersonModal } from './components/EditPersonModal';
import { BulkEditModal } from './components/BulkEditModal';
import { Configuracion } from './components/Configuracion';
import { PeriodicReportModal } from './components/PeriodicReportModal';
import { Papelera } from './components/Papelera';
import { CameraScannerModal } from './components/CameraScannerModal';
import { GestionCitas } from './components/GestionCitas';
import { CalendarioIntegrado } from './components/CalendarioIntegrado';
import { SubcontratasSection } from './components/SubcontratasSection';
import { AdminPanel } from './components/AdminPanel';
import { ImportDuplicateModal } from './components/ImportDuplicateModal';
import { PdfViewerModal } from './components/PdfViewerModal';
import { PushNotificationManagerModal } from './components/PushNotificationManagerModal';
import {
  createFirestoreWorker,
  updateFirestoreWorker,
  deleteFirestoreWorker,
  restoreFirestoreWorker,
  permanentDeleteFirestoreWorker,
} from './src/lib/firebase';
import * as pdfjsLib from 'pdfjs-dist';

if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;
}
import { detectImportDuplicates, DuplicateMatch } from './src/lib/duplicateFilter';
import { createDocument, updateDocument, deleteDocument, subscribeToDocuments } from './src/services/databaseService';
import { importWorkersAtomic } from './src/services/workerImportService';
import { persistMedicalRecognition } from './src/services/medicalRecognitionService';
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
import { 
  syncWorkerToAccount, 
  deleteWorkerFromAccount, 
  syncDeletedWorkerToAccount, 
  deleteFromAccountTrash, 
  fetchAccountData, 
  subscribeToAccountWorkers, 
  subscribeToAccountTrash,
  syncAccountSettings,
  subscribeToAccountSettings,
  initAuth,
  googleSignIn,
  logoutGoogle,
  registerAccountSession,
  unregisterAccountSession,
  subscribeToAccountSessions,
  DeviceSession,
  Workspace,
  WorkspaceMember,
  getOrCreateUserWorkspace,
  addMemberToWorkspace,
  updateMemberRoleInWorkspace,
  removeMemberFromWorkspace,
  getWorkspaceByIdOrEmail,
  findWorkspaceByAccessCode,
  fetchSharedWorkspacesForEmail,
  subscribeToWorkspaceMeta,
  syncWorkerToWorkspace,
  deleteWorkerFromWorkspace,
  syncDeletedWorkerToWorkspace,
  deleteFromWorkspaceTrash,
  fetchWorkspaceData,
  subscribeToWorkspaceWorkers,
  subscribeToWorkspaceTrash,
  subscribeToWorkspaceSettings,
  syncWorkspaceSettings,
  registerWorkspaceSession,
  unregisterWorkspaceSession,
  subscribeToWorkspaceSessions,
  canonicalizeEmailKey,
  DEFAULT_WORKSPACE_ID,
  isQuotaExceeded,
  getOrCreateSyncGroup, 
  syncWorkerToCloud, 
  deleteWorkerFromCloud, 
  syncDeletedWorkerToCloud, 
  deleteFromCloudTrash, 
  fetchGroupData, 
  subscribeToWorkers, 
  subscribeToTrash,
  registerSession,
  unregisterSession,
  subscribeToSessions,
  checkGroupExists
} from './src/lib/firebase';
import { registerServiceWorker, checkAndTriggerUpcomingAlerts, getNotificationAlertsSummary } from './src/lib/pushNotifications';
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
import { auth } from './src/lib/firebase';

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

// Guarantee collision-free worker IDs across local state and cloud sync
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
  const [people, setPeopleRaw] = useState<Person[]>([]);

  const setPeople = useCallback((action: React.SetStateAction<Person[]>) => {
    setPeopleRaw(prev => {
      const next = typeof action === 'function' ? (action as (prev: Person[]) => Person[])(prev) : action;
      return ensureUniquePersonIds(next);
    });
  }, []);

  const [past, setPast] = useState<Person[][]>([]);
  const [future, setFuture] = useState<Person[][]>([]);
  const peopleRef = useRef<Person[]>(people);
  useEffect(() => {
    peopleRef.current = people;
  }, [people]);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const setPeopleWithHistory = useCallback((
    value: Person[] | ((prev: Person[]) => Person[]),
    recordHistory: boolean = true
  ) => {
    setPeopleRaw(prev => {
      const rawNext = typeof value === 'function' ? value(prev) : value;
      const next = ensureUniquePersonIds(rawNext);
      if (recordHistory && JSON.stringify(prev) !== JSON.stringify(next)) {
        setPast(pStack => [...pStack.slice(-29), prev]);
        setFuture([]);
      }
      return next;
    });
  }, []);

  const handleUndo = useCallback(() => {
    setPast(pastStack => {
      if (pastStack.length === 0) return pastStack;
      const previous = pastStack[pastStack.length - 1];
      const newPast = pastStack.slice(0, pastStack.length - 1);
      
      setPeople(currentPeople => {
        setFuture(futureStack => [currentPeople, ...futureStack]);
        return previous;
      });

      setToast({ message: 'Acción deshecha (Deshacer)', type: 'success' });
      return newPast;
    });
  }, []);

  const handleRedo = useCallback(() => {
    setFuture(futureStack => {
      if (futureStack.length === 0) return futureStack;
      const next = futureStack[0];
      const newFuture = futureStack.slice(1);

      setPeople(currentPeople => {
        setPast(pastStack => [...pastStack, currentPeople]);
        return next;
      });

      setToast({ message: 'Acción rehecha (Rehacer)', type: 'success' });
      return newFuture;
    });
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

  // Register Service Worker on startup
  useEffect(() => {
    registerServiceWorker();
  }, []);

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
    const unsubscribe = subscribeToDocuments<Person>('workers', workers => {
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
  const [savedObras, setSavedObras] = useState<string[]>(() => JSON.parse(localStorage.getItem('obrasGuardadas') || '[]'));
  
  // Estados para filtros de resumen/estadísticas
  const [statsFilterMode, setStatsFilterMode] = useState<'origen' | 'fechas' | 'mes_actual' | 'ano_actual'>('origen');
  const [statsStartDate, setStatsStartDate] = useState('');
  const [statsEndDate, setStatsEndDate] = useState('');
  const [statsObraFilter, setStatsObraFilter] = useState<string[]>(['Todas']);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  const [savedLugares, setSavedLugares] = useState<string[]>(() => JSON.parse(localStorage.getItem('lugaresFormacion') || '[]'));
  const [savedSitios, setSavedSitios] = useState<string[]>(() => JSON.parse(localStorage.getItem('sitiosReconocimiento') || '[]'));
  const [savedTelefonos, setSavedTelefonos] = useState<string[]>(() => JSON.parse(localStorage.getItem('telefonosGuardados') || '[]'));
  const [savedCategorias, setSavedCategorias] = useState<string[]>(() => {
    const saved = localStorage.getItem('categoriasGuardadas');
    return saved ? JSON.parse(saved) : ['Peón', 'Oficial de 1ª', 'Encargado'];
  });

  const [workStartHour, setWorkStartHour] = useState<string>(() => localStorage.getItem('workStartHour') || '08:00');
  const [workEndHour, setWorkEndHour] = useState<string>(() => localStorage.getItem('workEndHour') || '15:00');

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

      const backupData = buildCompleteSystemBackup({
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



  // Limpieza automática de registros de papelera que lleven más de 30 días
  useEffect(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    setDeletedPeople(prev => {
      const active = prev.filter(p => new Date(p.fechaEliminacion) >= thirtyDaysAgo);
      if (active.length !== prev.length) {
        return active;
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    localStorage.setItem('obrasGuardadas', JSON.stringify(savedObras));
    localStorage.setItem('lugaresFormacion', JSON.stringify(savedLugares));
    localStorage.setItem('sitiosReconocimiento', JSON.stringify(savedSitios));
    localStorage.setItem('telefonosGuardados', JSON.stringify(savedTelefonos));
    localStorage.setItem('categoriasGuardadas', JSON.stringify(savedCategorias));
  }, [savedObras, savedLugares, savedSitios, savedTelefonos, savedCategorias]);

  useEffect(() => {
    localStorage.setItem('workStartHour', workStartHour);
    localStorage.setItem('workEndHour', workEndHour);
  }, [workStartHour, workEndHour]);

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
      await createDocument('workers', newPerson.id, newPerson as any);
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
      await deleteDocument('workers', id);
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
        await deleteDocument('workers', person.id);
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
      await createDocument('workers', id, foundDeleted.person as any);
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

  const handleEdit = (person: Person) => {
    setEditingPerson(person);
  };

  const handleUpdatePerson = (updatedPerson: Person) => {
    const isAutoSync = (isSyncing || !!googleUser?.uid || !!currentEffectiveWorkspaceId) && syncMode === 'auto' && !isOffline;
    const finalSyncStatus = (updatedPerson.sincronizadoEnNube && !isOffline) || isAutoSync;
    const finalPerson = { ...updatedPerson, sincronizadoEnNube: finalSyncStatus };

    setPeopleWithHistory(prev => prev.map(p => (p.id === updatedPerson.id ? finalPerson : p)));
    updateAutocompleteLists(finalPerson);
    setEditingPerson(null);
    setToast({ message: 'Registro actualizado correctamente', type: 'success' });

    const targetWsId = (currentEffectiveWorkspaceId || DEFAULT_WORKSPACE_ID).trim();
    if (targetWsId && !isOffline) {
      executeDatabaseSync(`Actualización: ${finalPerson.apellidosNombre}`, async () => {
        await syncWorkerToWorkspace(targetWsId, finalPerson);
        if (googleUser?.uid) await syncWorkerToAccount(googleUser.uid, finalPerson);
      }, {
        detail: `${finalPerson.apellidosNombre} actualizado en Firebase Firestore.`
      }).catch(err => console.error(err));
    } else if (googleUser?.uid && !isOffline) {
      syncWorkerToAccount(googleUser.uid, finalPerson).catch(err => {
        console.error(err);
      });
    } else if (isSyncing && groupId.trim() && finalSyncStatus) {
      syncWorkerToCloud(groupId, finalPerson).catch(err => {
        console.error(err);
        setPeople(prev => prev.map(p => p.id === finalPerson.id ? { ...p, sincronizadoEnNube: false } : p));
      });
    } else if (isSyncing && groupId.trim() && !finalSyncStatus && updatedPerson.sincronizadoEnNube && !isOffline) {
      deleteWorkerFromCloud(groupId, updatedPerson.id).catch(err => console.error(err));
    }
  };

  const handleBulkEditStart = (selectedPeople: Person[]) => {
    setBulkEditingPeople(selectedPeople);
  };

  const handleUpdateMultiplePeople = (updates: Partial<Person>, selectedIds: number[]) => {
    const isAutoSync = (isSyncing || !!googleUser?.uid || !!currentEffectiveWorkspaceId) && syncMode === 'auto' && !isOffline;

    const updatedPeople = people.map(p => {
      if (selectedIds.includes(p.id)) {
        const updated = { ...p, ...updates };
        const finalSyncStatus = (updated.sincronizadoEnNube && !isOffline) || isAutoSync;
        const finalPerson = { ...updated, sincronizadoEnNube: finalSyncStatus };

        return finalPerson;
      }
      return p;
    });

    setPeopleWithHistory(updatedPeople);

    const samplePerson = updatedPeople.find(p => selectedIds.includes(p.id));
    if (samplePerson) {
      updateAutocompleteLists(samplePerson);
    }

    setBulkEditingPeople(null);
    setToast({ message: `${selectedIds.length} registros actualizados correctamente`, type: 'success' });

    const targetWsId = (currentEffectiveWorkspaceId || DEFAULT_WORKSPACE_ID).trim();
    if (targetWsId && !isOffline) {
      executeDatabaseSync(`Edición masiva (${selectedIds.length} trabajadores)`, async () => {
        for (const pid of selectedIds) {
          const personObj = updatedPeople.find(p => p.id === pid);
          if (personObj) {
            await syncWorkerToWorkspace(targetWsId, personObj);
            if (googleUser?.uid) await syncWorkerToAccount(googleUser.uid, personObj);
          }
        }
      }, {
        detail: `${selectedIds.length} trabajadores actualizados en Firestore.`
      }).catch(err => {
        console.error("Error syncing worker to workspace during bulk update:", err);
      });
    } else if (googleUser?.uid && !isOffline) {
      selectedIds.forEach(pid => {
        const personObj = updatedPeople.find(p => p.id === pid);
        if (personObj) syncWorkerToAccount(googleUser.uid, personObj).catch(err => console.error(err));
      });
    }
  };

  const handleTogglePersonSync = async (id: number) => {
    if (isOffline) {
      setToast({ message: 'No se puede cambiar la configuración de compartición en la nube mientras estés sin conexión.', type: 'error' });
      return;
    }

    const updated = people.map(p => {
      if (p.id === id) {
        const newSyncStatus = !p.sincronizadoEnNube;
        
        if (isSyncing && groupId.trim()) {
          if (newSyncStatus) {
            syncWorkerToCloud(groupId, { ...p, sincronizadoEnNube: true })
              .then(() => setToast({ message: `Registro de ${p.apellidosNombre} compartido en la nube`, type: 'success' }))
              .catch(() => setToast({ message: 'Error al sincronizar con la nube', type: 'error' }));
          } else {
            deleteWorkerFromCloud(groupId, p.id)
              .then(() => setToast({ message: `Registro de ${p.apellidosNombre} guardado solo en local`, type: 'success' }))
              .catch(() => setToast({ message: 'Error al eliminar de la nube', type: 'error' }));
          }
        } else {
          setToast({ message: 'Sin conexión o cuenta para guardar en la base de datos en la nube', type: 'error' });
        }
        
        return { ...p, sincronizadoEnNube: newSyncStatus };
      }
      return p;
    });
    setPeople(updated);
  };

  const handleSyncAllToCloud = async () => {
    if (!isSyncing || !groupId.trim()) return;
    
    // Mark everyone as synced and upload them
    const updated = people.map(p => ({ ...p, sincronizadoEnNube: true }));
    setPeople(updated);
    
    for (const p of updated) {
      await syncWorkerToCloud(groupId, p);
    }
    
    // Sync trash too
    for (const dp of deletedPeople) {
      await syncDeletedWorkerToCloud(groupId, {
        ...dp,
        person: { ...dp.person, sincronizadoEnNube: true }
      });
    }
  };

  const handleSyncAllFromCloud = async () => {
    if (!isSyncing || !groupId.trim()) return;
    
    const { workers: cloudWorkers, trash: cloudTrash } = await fetchGroupData(groupId);
    
    // Merge workers
    setPeople(prev => {
      const localOnly = prev.filter(p => !p.sincronizadoEnNube);
      const cloudMerged = cloudWorkers.map(cw => ({ ...cw, sincronizadoEnNube: true }));
      const combined = [...localOnly];
      
      cloudMerged.forEach(cw => {
        const idx = combined.findIndex(p => p.id === cw.id);
        if (idx !== -1) {
          combined[idx] = cw;
        } else {
          combined.push(cw);
        }
      });
      return combined;
    });

    // Merge trash
    setDeletedPeople(prev => {
      const localOnly = prev.filter(dp => !dp.person.sincronizadoEnNube);
      const cloudTrashMerged = cloudTrash.map(ct => ({
        person: { ...ct.person, sincronizadoEnNube: true },
        fechaEliminacion: ct.fechaEliminacion
      }));
      const combined = [...localOnly];
      
      cloudTrashMerged.forEach(ct => {
        const idx = combined.findIndex(dp => dp.person.id === ct.person.id);
        if (idx !== -1) {
          combined[idx] = ct;
        } else {
          combined.push(ct);
        }
      });
      return combined;
    });
  };

  const stats: StatsData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let filteredPeople = [...visiblePeople];

    // Filtro por obra
    if (!statsObraFilter.includes('Todas')) {
      filteredPeople = filteredPeople.filter(p => statsObraFilter.includes(p.obra));
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
       if (p.obra) desgloseObra[p.obra] = (desgloseObra[p.obra] || 0) + 1;
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
      totalObras: Object.keys(desgloseObra).length,
      trabajadoresRepetidos: Object.values(dniCounts).filter(count => count > 1).length,
      desgloseQuincena,
      desgloseObra
    };
  }, [visiblePeople, statsFilterMode, statsStartDate, statsEndDate, statsObraFilter]);

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
                <span>Sincronizando registros en la nube...</span>
              </div>
              {isOffline && (
                <p className="text-[10px] text-amber-400 font-medium">
                  ⚠️ Sin conexión a internet para sincronizar en tiempo real.
                </p>
              )}
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
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
              {/* Left Column: Form */}
              <div className="xl:col-span-5">
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

              {/* Right Column: Stats & List */}
              <div className="xl:col-span-7 space-y-8 xl:sticky xl:top-8 xl:max-h-[calc(100vh-4rem)] xl:overflow-y-auto custom-scrollbar xl:pr-2 self-start">
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
                    onEmail={handleEmailFilesWrapped}
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

          {activeView === 'configuracion' && (
            <Configuracion 
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
          )}

          {activeView === 'administracion' && (
            <div className="max-w-7xl mx-auto">
              <AdminPanel onClose={() => setActiveView('dashboard')} />
            </div>
          )}

          {activeView === 'papelera' && (
            <div className="max-w-6xl mx-auto">
              <Papelera
                deletedPeople={visibleDeletedPeople}
                onRestore={handleRestorePerson}
                onPermanentDelete={handlePermanentDelete}
                onEmptyTrash={handleEmptyTrash}
              />
            </div>
          )}

          {activeView === 'calendario' && (
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
          )}

          {activeView === 'citas' && (
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
                    await updateDocument('workers', p.id, { ...p, sincronizadoEnNube: true } as any);
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
          )}

          {activeView === 'subcontratas' && (
            <div className="w-full max-w-[1600px] mx-auto min-w-0">
              <SubcontratasSection
                savedObras={savedObras}
                onUpdateSavedObras={setSavedObras}
                supervisoresDisponibles={supervisoresDisponibles}
                workers={visiblePeople}
                onToast={(message, type) => setToast({ message, type })}
              />
            </div>
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

          {/* Database synchronization feedback alert (green for success, red for error) */}

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
