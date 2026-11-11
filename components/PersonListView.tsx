import { reportOperationalError } from '../src/lib/operationalLog';

import React, { useState, useRef, useEffect, useMemo, useDeferredValue } from 'react';
import ModalPortal from './ModalPortal';
import { Person } from '../types';
import { Trash2, User, Calendar, MapPin, Download, Clock, Search, FileText, Pencil, Mail, MessageCircle, Upload, History, Cloud, Loader2, AlertTriangle, Table as TableIcon, LayoutGrid, Smartphone, ScanLine, ChevronDown } from 'lucide-react';
import { MultiSearchableDropdown } from './MultiSearchableDropdown';
import { InstitutionalSelect } from './InstitutionalSelect';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleCalendarModal } from './GoogleCalendarModal';
import { CalendarEventInput } from '../src/lib/googleCalendar';
import { VirtualPersonList } from './VirtualPersonList';
import { PersonTable } from './PersonTable';
import { CompactPersonCard } from './CompactPersonCard';
import { BulkShareButton } from './BulkShareButton';
import { sendDirectoryCommunication } from '../src/lib/directoryCommunications';
import { directoryContractYear, matchesDirectoryTraining, type DirectoryTrainingFilter } from '../src/lib/directoryTrainingFilter';

interface PersonListProps {
  people: Person[];
  onDelete: (id: number) => void;
  onEdit: (person: Person) => void;
  onDeleteMultiple?: (ids: number[]) => void;
  onEditMultiple?: (selectedPeople: Person[]) => void;
  onExport: (dataToExport: Person[]) => void;
  onExportPDF: (dataToExport: Person[]) => void;
  onExportRRMMExcel: (dataToExport: Person[]) => void;
  onExportRRMMPDF: (dataToExport: Person[]) => void;
  onExportPRLExcel: (dataToExport: Person[]) => void;
  onExportPRLPDF: (dataToExport: Person[]) => void;
  onExportCalzadoExcel: (dataToExport: Person[]) => void;
  onExportCalzadoPDF: (dataToExport: Person[]) => void;
  onEmail: (dataToExport: Person[]) => void;
  onImport: (file: File) => void;
  onGenerateIDCard: (person: Person) => void;
  onScanWorkerCard?: () => void;
  onPairWorkerCard?: () => void;
  onExportHistoryPDF: (person: Person) => void;
  renderPartsAction?: (person: Person) => React.ReactNode;
  renderPartsFilter?: React.ReactNode;
  renderMedicalFilter?: React.ReactNode;
  showMedicalWarning?: boolean;
  onClearExtendedFilters?: () => void;
  extendedFiltersActive?: boolean;
  savedObras: string[];
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  selectedObraFilter: string[];
  setSelectedObraFilter: (obras: string[]) => void;
  selectedQuincenaFilter: string[];
  setSelectedQuincenaFilter: (quincenas: string[]) => void;
  googleToken?: string | null;
  onGoogleLogin?: () => void;
  onToast?: (message: string, type: 'success' | 'error') => void;
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 15, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 140,
      damping: 16,
    },
  },
};

export const PersonList: React.FC<PersonListProps> = ({ 
  people, 
  onDelete, 
  onEdit, 
  onDeleteMultiple,
  onEditMultiple,
  onExport, 
  onExportPDF, 
  onExportRRMMExcel,
  onExportRRMMPDF,
  onExportPRLExcel,
  onExportPRLPDF,
  onExportCalzadoExcel,
  onExportCalzadoPDF,
  onEmail,
  onImport,
  onGenerateIDCard,
  onScanWorkerCard,
  onPairWorkerCard,
  onExportHistoryPDF,
  renderPartsAction,
  renderPartsFilter,
  renderMedicalFilter,
  showMedicalWarning = false,
  onClearExtendedFilters,
  extendedFiltersActive,
  savedObras,
  searchTerm,
  setSearchTerm,
  selectedObraFilter,
  setSelectedObraFilter,
  selectedQuincenaFilter,
  setSelectedQuincenaFilter,
  googleToken,
  onGoogleLogin,
  onToast
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showOnlyRepeaters, setShowOnlyRepeaters] = useState(false);
  const [trainingFilter, setTrainingFilter] = useState<DirectoryTrainingFilter>('all');
  const [contractYearFilter, setContractYearFilter] = useState('all');
  const [showImportModal, setShowImportModal] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [reportType, setReportType] = useState<'encargados' | 'medical' | 'footwear' | 'training'>('encargados');
  const [isDriveLoading, setIsDriveLoading] = useState(false);
  const [viewLayout, setViewLayout] = useState<'table' | 'compact' | 'cards'>(() => {
    try {
      const saved = localStorage.getItem('profea_personlist_view');
      if (saved === 'compact' || saved === 'cards' || saved === 'table') return saved;
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        return 'compact';
      }
      return 'table';
    } catch {
      return 'table';
    }
  });

  const handleSetViewLayout = (layout: 'table' | 'compact' | 'cards') => {
    setViewLayout(layout);
    try {
      localStorage.setItem('profea_personlist_view', layout);
    } catch (e) {
      reportOperationalError("components/PersonListView.tsx:129", e);
    }
  };

  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);
  const [modalCalendarEvents, setModalCalendarEvents] = useState<CalendarEventInput[]>([]);
  const [modalTitle, setModalTitle] = useState("Añadir a Google Calendar");

  const buildWorkerCalendarEvents = (person: Person): CalendarEventInput[] => {
    const events: CalendarEventInput[] = [];

    if (person.periodoInicio) {
      events.push({
        summary: `Contrato PROFEA: ${person.apellidosNombre} (${person.obra || 'Obra'})`,
        description: `Trabajador: ${person.apellidosNombre}\nDNI: ${person.dni || '-'}\nTeléfono: ${person.telefono || '-'}\nCategoría: ${person.categoria || 'Peón'}\nObra: ${person.obra || '-'}\nNº Oferta: ${person.numOferta || '-'}\nQuincena: ${person.quincena || '-'}\nSupervisor: ${person.supervisorResponsable || '-'}`,
        location: person.obra || 'Diputación de Cádiz',
        startIsoDate: person.periodoInicio,
        endIsoDate: person.periodoFin || person.periodoInicio,
      });
    }

    if (person.citaDia && person.necesitaReconocimiento !== 'No') {
      events.push({
        summary: `Cita Reconocimiento Médico PROFEA: ${person.apellidosNombre}`,
        description: `Reconocimiento Médico del trabajador ${person.apellidosNombre}\nDNI: ${person.dni || '-'}\nTeléfono: ${person.telefono || '-'}\nObra: ${person.obra || '-'}`,
        location: person.sitioReconocimiento || 'Centro de Prevención Diputación de Cádiz',
        startIsoDate: person.citaDia,
        time: person.citaHora || '08:00',
        durationMinutes: 30
      });
    }

    return events;
  };

  const handleOpenCalendarForWorker = (person: Person) => {
    const events = buildWorkerCalendarEvents(person);
    if (events.length === 0) {
      alert(`El trabajador ${person.apellidosNombre} no tiene fechas de contrato ni citas de Reconocimientos Médicos asignadas.`);
      return;
    }
    setModalCalendarEvents(events);
    setModalTitle(`Google Calendar: ${person.apellidosNombre}`);
    setIsCalendarModalOpen(true);
  };

  const handleOpenCalendarForSelected = () => {
    const selectedPeople = people.filter(p => selectedIds.includes(p.id));
    if (selectedPeople.length === 0) return;

    const noAptoSelected = selectedPeople.filter(p => p.reconocimientoEstado === 'No Apto' && p.documentacionCompleta === 'No');
    if (noAptoSelected.length > 0) {
      const names = noAptoSelected.map(p => `• ${p.apellidosNombre} (DNI: ${p.dni || 'N/A'})`).join('\n');
      const proceed = window.confirm(
        `⚠️ ADVERTENCIA DE RIESGO DE CONTRATACIÓN:\n\n` +
        `Entre los trabajadores seleccionados se encuentran ${noAptoSelected.length} con resultado médico "No Apto" y documentación en "No":\n\n` +
        `${names}\n\n` +
        `¿Desea continuar agregando los eventos al calendario a pesar del riesgo detectado?`
      );
      if (!proceed) return;
    }

    let allEvents: CalendarEventInput[] = [];
    selectedPeople.forEach(p => {
      allEvents = [...allEvents, ...buildWorkerCalendarEvents(p)];
    });

    if (allEvents.length === 0) {
      alert('Ninguno de los trabajadores seleccionados tiene fechas de contrato o citas asignadas.');
      return;
    }

    setModalCalendarEvents(allEvents);
    setModalTitle(`Google Calendar: ${selectedPeople.length} Trabajadores Seleccionados`);
    setIsCalendarModalOpen(true);
  };

  useEffect(() => {
    if (!(window as any).gapi) {
      const scriptGapi = document.createElement('script');
      scriptGapi.src = 'https://apis.google.com/js/api.js';
      scriptGapi.async = true;
      scriptGapi.defer = true;
      document.body.appendChild(scriptGapi);
    }

    if (!(window as any).google?.accounts) {
      const scriptGis = document.createElement('script');
      scriptGis.src = 'https://accounts.google.com/gsi/client';
      scriptGis.async = true;
      scriptGis.defer = true;
      document.body.appendChild(scriptGis);
    }
  }, []);

  const handleOpenGooglePicker = () => {
    if (!googleToken) {
      if (onGoogleLogin) {
        onGoogleLogin();
      } else {
        alert('Por favor, inicie sesión en Google para usar el selector.');
      }
      return;
    }

    setIsDriveLoading(true);

    try {
      (window as any).gapi.load('picker', {
        callback: () => {
          const view = new (window as any).google.picker.DocsView((window as any).google.picker.ViewId.DOCS)
            .setMimeTypes([
              'application/vnd.google-apps.spreadsheet',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-excel',
              'application/json',
              'application/pdf',
              'text/csv'
            ].join(','))
            .setIncludeFolders(true)
            .setSelectFolderEnabled(false);

          const picker = new (window as any).google.picker.PickerBuilder()
            .addView(view)
            .setOAuthToken(googleToken)
            .setDeveloperKey('AIzaSyCoLiLZXdWWYQklXwsWnf1LDjzbKxPST2g')
            .setCallback(async (data: any) => {
              if (data[(window as any).google.picker.Response.ACTION] === (window as any).google.picker.Action.PICKED) {
                const docItem = data[(window as any).google.picker.Response.DOCUMENTS][0];
                const fileId = docItem[(window as any).google.picker.Document.ID];
                const fileName = docItem[(window as any).google.picker.Document.NAME];
                const mimeType = docItem[(window as any).google.picker.Document.MIME_TYPE];

                await handleImportFileFromDrive(fileId, fileName, mimeType);
              }
            })
            .build();
          picker.setVisible(true);
          setIsDriveLoading(false);
          setShowImportModal(false);
        }
      });
    } catch (err) {
      reportOperationalError('Error loading Google Picker:', err);
      setIsDriveLoading(false);
      alert('Error al abrir el selector de Google Drive.');
    }
  };

  const handleImportFileFromDrive = async (fileId: string, fileName: string, mimeType: string) => {
    if (!googleToken) return;
    setIsDriveLoading(true);

    try {
      const url = mimeType.includes('google-apps.spreadsheet')
        ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
        : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${googleToken}` }
      });

      if (!response.ok) {
        throw new Error('No se pudo descargar el archivo de Google Drive.');
      }

      const blob = await response.blob();
      const finalMime = mimeType.includes('google-apps.spreadsheet')
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : mimeType;
      
      const finalName = mimeType.includes('google-apps.spreadsheet') && !fileName.toLowerCase().endsWith('.xlsx')
        ? `${fileName}.xlsx`
        : fileName;

      const file = new File([blob], finalName, { type: finalMime });
      onImport(file);
    } catch (err: any) {
      reportOperationalError("components/PersonListView.tsx:307", err);
      alert('Error al descargar archivo de Google Drive: ' + (err.message || err));
    } finally {
      setIsDriveLoading(false);
    }
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = () => {
    if (onDeleteMultiple && selectedIds.length > 0) {
      onDeleteMultiple(selectedIds);
      setSelectedIds([]);
    }
  };

  const handleBulkEdit = () => {
    if (onEditMultiple && selectedIds.length > 0) {
      const selectedPeople = people.filter(p => selectedIds.includes(p.id));
      onEditMultiple(selectedPeople);
      setSelectedIds([]);
    }
  };

  const handleImportClick = () => {
    setShowImportModal(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImport(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const uniqueQuincenas = useMemo(() => Array.from(new Set((people || []).map(p => p.quincena))).sort(), [people]);
  const contractYears = useMemo(() => Array.from(new Set([
    String(new Date().getFullYear()),
    ...people.map(directoryContractYear).filter((year): year is string => year !== null),
  ])).sort((a, b) => Number(b) - Number(a)), [people]);

  const sameDniWorkersMap = useMemo(() => {
    const map = new Map<string, Person[]>();
    for (const p of people || []) {
      if (!p.dni) continue;
      const cleanDni = p.dni.trim().toUpperCase().replace(/[\s-]/g, '');
      if (cleanDni) {
        const existing = map.get(cleanDni);
        if (existing) {
          existing.push(p);
        } else {
          map.set(cleanDni, [p]);
        }
      }
    }
    return map;
  }, [people]);

  const repeaterDniSet = useMemo(() => {
    const repeaters = new Set<string>();
    for (const [dni, workers] of sameDniWorkersMap.entries()) {
      if (workers.length > 1) repeaters.add(dni);
    }
    return repeaters;
  }, [sameDniWorkersMap]);

  const deferredSearchTerm = useDeferredValue(searchTerm);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedObraSet = useMemo(() => new Set(selectedObraFilter), [selectedObraFilter]);
  const selectedQuincenaSet = useMemo(() => new Set(selectedQuincenaFilter), [selectedQuincenaFilter]);

  const noAptosCount = useMemo(() => {
    return (people || []).filter(p => p.reconocimientoEstado === 'No Apto').length;
  }, [people]);

  const noAptoDocIncompleteCount = useMemo(() => {
    return (people || []).filter(p => p.reconocimientoEstado === 'No Apto' && p.documentacionCompleta === 'No').length;
  }, [people]);

  const selectedNoAptoCount = useMemo(() => {
    return (people || []).filter(p => selectedIdSet.has(p.id) && p.reconocimientoEstado === 'No Apto' && p.documentacionCompleta === 'No').length;
  }, [people, selectedIdSet]);

  const filteredPeople = useMemo(() => {
    const term = deferredSearchTerm.toLowerCase().trim();
    return (people || []).filter(person => {
      const matchesSearch = !term || (
        person.apellidosNombre.toLowerCase().includes(term) ||
        person.dni.toLowerCase().includes(term) ||
        person.numOferta.toLowerCase().includes(term) ||
        person.obra.toLowerCase().includes(term) ||
        (person.categoria && person.categoria.toLowerCase().includes(term))
      );
      
      const matchesObra = selectedObraSet.has('Todas') || selectedObraSet.has(person.obra);
      const matchesQuincena = selectedQuincenaSet.has('Todas') || selectedQuincenaSet.has(person.quincena);
      
      const cleanDni = person.dni ? person.dni.trim().toUpperCase().replace(/[\s-]/g, '') : '';
      const isRepeaterWorker = cleanDni ? repeaterDniSet.has(cleanDni) : false;
      const matchesRepeater = !showOnlyRepeaters || isRepeaterWorker;
      
      return matchesSearch && matchesObra && matchesQuincena && matchesRepeater && matchesDirectoryTraining(person, trainingFilter, contractYearFilter);
    });
  }, [people, deferredSearchTerm, selectedObraSet, selectedQuincenaSet, showOnlyRepeaters, repeaterDniSet, trainingFilter, contractYearFilter]);

  const isSelectionActive = selectedIds.length > 0;
  const peopleToExport = useMemo(
    () => isSelectionActive ? people.filter(p => selectedIdSet.has(p.id)) : filteredPeople,
    [isSelectionActive, people, selectedIdSet, filteredPeople],
  );

  const administrativeExportScopeIds = useMemo(
    () => peopleToExport.map(person => person.id),
    [peopleToExport],
  );

  const filteredIdSet = useMemo(() => new Set(filteredPeople.map(person => person.id)), [filteredPeople]);

  useEffect(() => {
    const scope = {
      ids: administrativeExportScopeIds,
      filteredIds: filteredPeople.map(person => person.id),
      selectedIds: selectedIds.filter(id => filteredIdSet.has(id)),
      hasSelection: isSelectionActive,
      updatedAt: Date.now(),
    };
    // Fuente síncrona para que la relación administrativa use exactamente
    // el mismo conjunto que el resto de exportaciones del Directorio.
    (window as any).__profeaDirectoryExportScope = scope;
    window.dispatchEvent(new CustomEvent('profea:directory-export-scope', {
      detail: scope,
    }));
    return () => {
      const current = (window as any).__profeaDirectoryExportScope;
      if (current?.updatedAt === scope.updatedAt) delete (window as any).__profeaDirectoryExportScope;
    };
  }, [administrativeExportScopeIds, filteredPeople, selectedIds, isSelectionActive]);

  const visibleSelectedCount = filteredPeople.reduce((count, person) => count + (selectedIdSet.has(person.id) ? 1 : 0), 0);
  const isAllVisibleSelected = filteredPeople.length > 0 && visibleSelectedCount === filteredPeople.length;
  const isSomeVisibleSelected = visibleSelectedCount > 0 && visibleSelectedCount < filteredPeople.length;

  const handleSelectAllVisible = () => {
    if (isAllVisibleSelected) {
      const filteredIds = filteredPeople.map(p => p.id);
      setSelectedIds(prev => prev.filter(id => !filteredIds.includes(id)));
    } else {
      const filteredIds = filteredPeople.map(p => p.id);
      setSelectedIds(prev => {
        const union = new Set([...prev, ...filteredIds]);
        return Array.from(union);
      });
    }
  };
  
  const scanActions = (onScanWorkerCard || onPairWorkerCard) && (
    <div role="group" aria-label="Lectura de carnet" className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
      {onScanWorkerCard && <button type="button" onClick={onScanWorkerCard} className="inline-flex min-h-12 min-w-0 w-full items-center justify-center gap-2 rounded-xl bg-[#00548E] px-3 py-3 text-center text-sm font-bold text-white"><ScanLine className="h-5 w-5 shrink-0" />Escanear carnet con este dispositivo</button>}
      {onPairWorkerCard && <button type="button" onClick={onPairWorkerCard} className="min-h-12 min-w-0 w-full rounded-xl border border-slate-300 px-3 py-3 text-center text-sm font-bold dark:border-slate-600">Vincular cámara del móvil</button>}
    </div>
  );

  if (people.length === 0) {
    return (
      <div className="ui-surface p-8 h-full flex flex-col items-center justify-center text-center text-slate-800 dark:text-slate-100">
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          accept=".xlsx, .xls, .json, .pdf" 
          className="hidden" 
        />
        <div className="bg-blue-50 dark:bg-blue-950/40 p-6 rounded-full mb-6 text-blue-600 dark:text-blue-400">
           <User className="w-16 h-16" />
        </div>
        <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">No hay personas registradas</h3>
        <p className="text-slate-500 dark:text-slate-400 mt-2 max-w-md">
          Complete el formulario para agregar registros o utilice la importación para cargar un archivo con listado de trabajadores.
        </p>
        <div className="mt-4">{scanActions}</div>

        <AnimatePresence>
          {showImportModal && (
            <ModalPortal label="PersonListView"><div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm text-left">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-bold flex items-center gap-2 text-brand-primary dark:text-blue-400">
                      <Upload className="w-6 h-6" /> Importación de trabajadores
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Seleccione un método para importar el listado de trabajadores (Excel, JSON o PDF).
                    </p>
                  </div>
                  <button 
                    onClick={() => setShowImportModal(false)}
                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-600"
                  >
                    &times;
                  </button>
                </div>

                <div className="space-y-4 mt-6">
                  <button
                    onClick={() => {
                      setShowImportModal(false);
                      fileInputRef.current?.click();
                    }}
                    className="w-full text-left p-4 rounded-2xl border-2 border-slate-100 dark:border-slate-800/80 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-slate-850/40 transition-all flex items-center gap-4 group cursor-pointer"
                  >
                    <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm">Dispositivo Local</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Sube un archivo desde tu ordenador (.xlsx, .json, .pdf)</p>
                    </div>
                  </button>

                  <button
                    onClick={handleOpenGooglePicker}
                    className="w-full text-left p-4 rounded-2xl border-2 border-slate-100 dark:border-slate-800/80 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-slate-850/40 transition-all flex items-center gap-4 group relative cursor-pointer"
                    disabled={isDriveLoading}
                  >
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 group-hover:scale-110 transition-transform">
                      <Cloud className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-sm flex items-center gap-1.5">
                        Google Drive
                        {googleToken && (
                          <span className="w-2 h-2 rounded-full bg-emerald-500" title="Conectado" />
                        )}
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {googleToken 
                          ? 'Navega por tus carpetas y selecciona tus archivos directamente' 
                          : 'Inicia sesión con Google para buscar tus archivos en Drive'}
                      </p>
                    </div>
                  </button>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/60 flex justify-end">
                  <button
                    onClick={() => setShowImportModal(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              </motion.div>
            </div></ModalPortal>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div id="directorio-section" className="ui-surface min-w-0 p-3 sm:p-5 lg:p-7 text-slate-800 dark:text-slate-100">
      <div className="mb-4 min-w-0 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:gap-4">
          <h2 className="flex min-w-0 items-center gap-2 text-lg font-black tracking-tight text-slate-900 dark:text-slate-100 sm:text-2xl">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--ui-gradient-brand)] text-white"><User className="h-5 w-5" /></span>
            <span className="min-w-0 truncate">Directorio <span className="text-slate-500 dark:text-slate-400">({people.length})</span></span>
          </h2>
          <button type="button" aria-expanded={showReports} aria-controls="directory-reports-panel"
            onClick={() => setShowReports(value => !value)}
            className="inline-flex min-h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#00548E] px-3 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#003f70] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00548E] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 sm:gap-2 sm:px-4">
            <FileText className="h-4 w-4 shrink-0" /><span>Informes</span><ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${showReports ? 'rotate-180' : ''}`}/>
          </button>
        </div>
        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls, .json, .pdf" className="hidden" />
        {showReports && (
          <section id="directory-reports-panel" aria-label="Informes y comunicaciones del Directorio"
            className="mt-3 min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800/60 sm:p-4">
            <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2 lg:items-end">
              <div className="flex min-w-0 flex-col gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                <span>Seleccionar informe</span>
                <InstitutionalSelect label="Seleccionar informe del Directorio" value={reportType} onChange={next => setReportType(next as typeof reportType)} options={[{value:'encargados',label:'Relación de trabajadores para encargados'},{value:'medical',label:'Reconocimientos médicos'},{value:'footwear',label:'Resumen de calzado'},{value:'training',label:'Formación PRL 20 horas'}]} />
              </div>
              <div className="min-w-0">
                <div className="mb-2 text-xs font-bold text-slate-700 dark:text-slate-200">Exportar o compartir</div>
                <div data-encargados-relation-row={reportType === 'encargados' ? '1' : undefined} className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
                  <button type="button" onClick={() => {
                    if(reportType === 'encargados') onExportPDF(peopleToExport);
                    else if(reportType === 'medical') onExportRRMMPDF(peopleToExport);
                    else if(reportType === 'footwear') onExportCalzadoPDF(peopleToExport);
                    else onExportPRLPDF(peopleToExport);
                  }} className="inline-flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white px-2 py-3 text-sm font-bold text-red-800 hover:bg-red-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/30">
                    <FileText className="h-4 w-4 shrink-0" /> PDF
                  </button>
                  <button type="button" onClick={() => {
                    if(reportType === 'encargados') onExport(peopleToExport);
                    else if(reportType === 'medical') onExportRRMMExcel(peopleToExport);
                    else if(reportType === 'footwear') onExportCalzadoExcel(peopleToExport);
                    else onExportPRLExcel(peopleToExport);
                  }} className="inline-flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-2 py-3 text-sm font-bold text-emerald-800 hover:bg-emerald-50 dark:border-emerald-900 dark:bg-slate-900 dark:text-emerald-300 dark:hover:bg-emerald-950/30">
                    <Download className="h-4 w-4 shrink-0" /> Excel
                  </button>
                  {reportType === 'encargados' ? (
                    <button type="button" onClick={() => void sendDirectoryCommunication('encargados', peopleToExport, people).catch(error => onToast?.(error?.message || 'No se pudo preparar el envío por WhatsApp.', 'error'))}
                      className="col-span-2 inline-flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-2 py-3 text-sm font-bold text-white hover:bg-emerald-800 sm:col-span-1">
                      <MessageCircle className="h-4 w-4 shrink-0" /> WhatsApp
                    </button>
                  ) : (
                    <button type="button" onClick={() => void sendDirectoryCommunication(reportType as 'medical' | 'footwear' | 'training', peopleToExport, people).catch(error => onToast?.(error?.message || 'No se pudo preparar el correo.', 'error'))}
                      className="col-span-2 inline-flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-2 py-3 text-sm font-bold text-sky-900 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200 sm:col-span-1">
                      <Mail className="h-4 w-4 shrink-0" /> Mail
                    </button>
                  )}
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400" role="status">
              {isSelectionActive ? `Se aplicará a ${peopleToExport.length} trabajadores seleccionados.` : `Se aplicará a los ${peopleToExport.length} trabajadores del ámbito visible según los filtros.`}
            </p>
          </section>
        )}
      </div>

      <div className="mb-4 flex min-h-[52px] min-w-0 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 focus-within:border-[#00548E] focus-within:ring-2 focus-within:ring-[#00548E]/20 dark:border-slate-600 dark:bg-slate-900">
        <Search aria-hidden="true" className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" />
        <input type="search" aria-label="Buscar trabajadores" placeholder="Buscar por nombre, DNI, oferta, obra o categoría..."
          value={searchTerm} onChange={event => setSearchTerm(event.target.value)}
          className="min-h-11 w-full min-w-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-500 dark:text-slate-100 dark:placeholder:text-slate-400" />
      </div>

      <section aria-labelledby="directory-filters-title" data-directory-filters="true" className="relative z-20 mb-5 min-w-0 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-800/50 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id="directory-filters-title" className="text-sm font-extrabold">Filtros del directorio</h3>
          <button type="button" onClick={() => {setSearchTerm('');setSelectedObraFilter(['Todas']);setSelectedQuincenaFilter(['Todas']);setTrainingFilter('all');setContractYearFilter('all');setShowOnlyRepeaters(false);setSelectedIds([]);onClearExtendedFilters?.();}} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-[#00548E] focus-visible:ring-2 focus-visible:ring-[#00548E] dark:border-slate-600 dark:bg-slate-900 dark:text-blue-200">Limpiar filtros</button>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0"><span className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-200">Obra</span><MultiSearchableDropdown options={savedObras} selectedValues={selectedObraFilter} onChange={value => { setSelectedObraFilter(value); setSelectedIds([]); }} placeholder="Todas" allLabel="Todas" icon={<MapPin className="w-4 h-4" />} className="!w-full !min-w-0" buttonClassName="!min-h-11 !rounded-xl !border-slate-300 !bg-white !shadow-none dark:!border-slate-600 dark:!bg-slate-900"/></div>
          <div className="min-w-0"><span className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-200">Periodo / quincena</span><MultiSearchableDropdown options={uniqueQuincenas} selectedValues={selectedQuincenaFilter} onChange={value => { setSelectedQuincenaFilter(value); setSelectedIds([]); }} placeholder="Todas" allLabel="Todas" icon={<Clock className="w-4 h-4" />} className="!w-full !min-w-0" buttonClassName="!min-h-11 !rounded-xl !border-slate-300 !bg-white !shadow-none dark:!border-slate-600 dark:!bg-slate-900"/></div>
          <div className="flex min-w-0 flex-col gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200"><span>Año de contratación</span><InstitutionalSelect label="Año de contratación" value={contractYearFilter} onChange={next => {setContractYearFilter(next);setSelectedIds([]);}} options={[{value:'all',label:'Todos los años'}, ...contractYears.map(year => ({value:String(year),label:String(year)})), {value:'unknown',label:'Sin año registrado'}]} /></div>
          {renderMedicalFilter && <div className="min-w-0">{renderMedicalFilter}</div>}
        </div>
        <details className="group mt-3 min-w-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-[#00548E] focus-visible:ring-2 focus-visible:ring-[#00548E] dark:border-slate-600 dark:bg-slate-900 dark:text-blue-200 [&::-webkit-details-marker]:hidden"><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180"/> Más filtros</summary>
          <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex min-w-0 flex-col gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200"><span>Formación</span><InstitutionalSelect label="Formación" value={trainingFilter} onChange={next => {setTrainingFilter(next as DirectoryTrainingFilter);setSelectedIds([]);}} options={[{value:'all',label:'Todos los estados'},{value:'trained',label:'Con formación'},{value:'pending',label:'Sin formación / pendiente'}]} /></div>
            {renderPartsFilter && <div className="min-w-0">{renderPartsFilter}</div>}
            <div className="flex min-w-0 flex-col gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200"><span>Repetidores</span><InstitutionalSelect label="Repetidores" value={showOnlyRepeaters ? 'only' : 'all'} onChange={next => {setShowOnlyRepeaters(next==='only');setSelectedIds([]);}} options={[{value:'all',label:'Todos'},{value:'only',label:'Solo repetidores'}]} /></div>
          </div>
        </details>
        {(trainingFilter !== 'all' || contractYearFilter !== 'all' || showOnlyRepeaters || extendedFiltersActive) && <p role="status" className="mt-3 text-xs text-slate-600 dark:text-slate-300">Hay filtros activos. Usa «Limpiar filtros» para restablecer el Directorio.</p>}
      </section>
      {showMedicalWarning && noAptosCount > 0 && (
        <div role="alert" className="mb-5 p-3.5 bg-red-50/90 dark:bg-red-950/40 border-2 border-red-400 dark:border-red-800/80 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-red-900 dark:text-red-200 shadow-sm">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 animate-bounce" />
            <div>
              <span className="font-extrabold uppercase tracking-wide mr-1.5 text-red-700 dark:text-red-300">
                Alerta de Prevención de Contratación:
              </span>
              <span>
                ⚠️ ⛔️ Hay <strong>{noAptosCount} trabajador(es) con Reconocimiento Médico "No Apto"</strong> {noAptoDocIncompleteCount > 0 && `(${noAptoDocIncompleteCount} con Documentación bloqueada en 'No')`}. Sus fichas cuentan con indicador de advertencia persistente y resaltado en rojo para evitar contrataciones erróneas.
              </span>
            </div>
          </div>

        </div>
      )}

      {filteredPeople.length === 0 && <div className="mb-4">{scanActions}</div>}
      {filteredPeople.length === 0 ? (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400 bg-slate-100/30 dark:bg-slate-800/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
           <Search className="w-10 h-10 mx-auto mb-3 opacity-20" />
           <p className="text-sm font-medium">No se encontraron trabajadores con los filtros seleccionados{searchTerm ? ` para "${searchTerm}"` : ''}.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl text-sm text-slate-700 dark:text-slate-200">
            <div className="flex flex-wrap items-center justify-between w-full md:w-auto gap-3">
              <div className="flex items-center gap-3 font-semibold">
                <input 
                  type="checkbox"
                  id="selectAllVisible"
                  checked={isAllVisibleSelected}
                  ref={el => {
                    if (el) {
                      el.indeterminate = isSomeVisibleSelected;
                    }
                  }}
                  onChange={handleSelectAllVisible}
                  className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-[#00548E] focus:ring-[#00548E]/20 dark:focus:ring-blue-500/30 cursor-pointer accent-[#00548E]"
                />
                <label htmlFor="selectAllVisible" className="cursor-pointer select-none text-xs sm:text-sm text-slate-700 dark:text-slate-200">
                  {isAllVisibleSelected 
                    ? 'Desmarcar todos los visibles' 
                    : `Seleccionar todos los visibles (${filteredPeople.length})`
                  }
                </label>
              </div>

              <div className="profea-directory-view-switcher grid min-w-0 w-full grid-cols-3 items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-2xs dark:border-slate-700 dark:bg-slate-900 sm:w-auto sm:flex">
                <button
                  type="button"
                  id="btn-view-table"
                  onClick={() => handleSetViewLayout('table')}
                  className={`min-w-0 w-full sm:w-auto flex items-center justify-center gap-1 sm:gap-1.5 px-1 sm:px-3 min-h-11 py-2 rounded-lg text-[11px] sm:text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                    viewLayout === 'table'
                      ? 'bg-[#00548E] dark:bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Vista Tabla con columna Aptitud Médica"
                >
                  <TableIcon className="w-3.5 h-3.5 shrink-0" />
                  <span className="whitespace-nowrap">Tabla</span>
                </button>
                <button
                  type="button"
                  id="btn-view-compact"
                  onClick={() => handleSetViewLayout('compact')}
                  className={`min-w-0 w-full sm:w-auto flex items-center justify-center gap-1 sm:gap-1.5 px-1 sm:px-3 min-h-11 py-2 rounded-lg text-[11px] sm:text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                    viewLayout === 'compact'
                      ? 'bg-[#00548E] dark:bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Vista Tarjeta Compacta (diseñada para alta legibilidad en pantallas pequeñas y móviles)"
                >
                  <Smartphone className="w-3.5 h-3.5 shrink-0" />
                  <span className="whitespace-nowrap">Tarjeta compacta</span>
                </button>
                <button
                  type="button"
                  id="btn-view-cards"
                  onClick={() => handleSetViewLayout('cards')}
                  className={`min-w-0 w-full sm:w-auto flex items-center justify-center gap-1 sm:gap-1.5 px-1 sm:px-3 min-h-11 py-2 rounded-lg text-[11px] sm:text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                    viewLayout === 'cards'
                      ? 'bg-[#00548E] dark:bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Vista Tarjetas Detalladas"
                >
                  <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline whitespace-nowrap">Tarjetas completas</span>
                  <span className="sm:hidden whitespace-nowrap">Completas</span>
                </button>
              </div>
            </div>
            
            {isSelectionActive && (
              <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-between md:justify-end animate-in fade-in duration-200">
                <span className="text-xs bg-[#00548E]/10 text-[#00548E] dark:bg-blue-950/60 dark:text-blue-300 font-bold px-3 py-1 rounded-full border border-[#00548E]/20 dark:border-blue-800/60">
                  {selectedIds.length} seleccionados
                </span>

                {selectedNoAptoCount > 0 && (
                  <span 
                    className="text-xs bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-300 font-bold px-3 py-1 rounded-full border border-red-300 dark:border-red-800 flex items-center gap-1.5 animate-pulse"
                    title={`${selectedNoAptoCount} de los trabajadores seleccionados tienen Reconocimiento No Apto y Documentación en 'No'`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
                    <span>{selectedNoAptoCount} con Riesgo No Apto</span>
                  </span>
                )}
                
                <div className="grid w-full grid-cols-2 items-stretch gap-2 sm:flex sm:w-auto sm:flex-wrap">
                  {onEditMultiple && (
                    <button 
                      onClick={handleBulkEdit}
                      className="flex min-h-11 min-w-0 items-center justify-center bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 text-[#00548E] dark:text-blue-300 px-3 py-1.5 rounded-lg transition-colors text-xs font-bold shadow-sm border border-blue-200 dark:border-blue-800/80 cursor-pointer"
                      title="Editar trabajadores seleccionados"
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1.5" /> Editar Masivo
                    </button>
                  )}
                  <BulkShareButton resourceType="trabajadores" resourceIds={selectedIds} />
                  <button 
                    onClick={handleOpenCalendarForSelected}
                    className="flex min-h-11 min-w-0 items-center justify-center bg-[#00548E]/10 hover:bg-[#00548E]/20 text-[#00548E] dark:text-blue-300 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 px-3 py-1.5 rounded-lg transition-colors text-xs font-bold shadow-sm border border-[#00548E]/20 dark:border-blue-800/80 cursor-pointer"
                    title="Añadir a Google Calendar los seleccionados"
                  >
                    <Calendar className="w-3.5 h-3.5 mr-1.5 text-[#00548E] dark:text-blue-400" /> Google Calendar
                  </button>
                  {onDeleteMultiple && (
                    <button 
                      onClick={handleBulkDelete}
                      className="flex min-h-11 min-w-0 items-center justify-center bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 text-red-600 dark:text-red-300 px-3 py-1.5 rounded-lg transition-colors text-xs font-bold shadow-sm border border-red-200 dark:border-red-900/60 cursor-pointer"
                      title="Eliminar trabajadores seleccionados"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Eliminar Masivo
                    </button>
                  )}
                </div>

                <button 
                  onClick={() => setSelectedIds([])}
                  className="text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:underline cursor-pointer"
                >
                  Limpiar selección
                </button>
              </div>
            )}
          </div>

          {scanActions}
          {viewLayout === 'table' ? (
            <PersonTable
              people={filteredPeople}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onSelectAllVisible={handleSelectAllVisible}
              isAllVisibleSelected={isAllVisibleSelected}
              isSomeVisibleSelected={isSomeVisibleSelected}
              onDelete={onDelete}
              onEdit={onEdit}
              onGenerateIDCard={onGenerateIDCard}
              onExportHistoryPDF={onExportHistoryPDF}
              renderPartsAction={renderPartsAction}
              onOpenCalendar={handleOpenCalendarForWorker}
              sameDniWorkersMap={sameDniWorkersMap}
            />
          ) : viewLayout === 'compact' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
              {filteredPeople.map((person, personIdx) => {
                const cleanDni = person.dni ? person.dni.trim().toUpperCase().replace(/[\s-]/g, '') : '';
                const sameDniWorkers = cleanDni && sameDniWorkersMap.has(cleanDni)
                  ? sameDniWorkersMap.get(cleanDni)!
                  : [];
                return (
                  <CompactPersonCard
                    key={`compact_person_${person.id}_${personIdx}`}
                    person={person}
                    isSelected={selectedIds.includes(person.id)}
                    onToggleSelect={handleToggleSelect}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    onGenerateIDCard={onGenerateIDCard}
                    onExportHistoryPDF={onExportHistoryPDF}
                    renderPartsAction={renderPartsAction}
                    onOpenCalendar={handleOpenCalendarForWorker}
                    sameDniWorkers={sameDniWorkers}
                  />
                );
              })}
            </div>
          ) : (
            <VirtualPersonList
              people={filteredPeople}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onDelete={onDelete}
              onEdit={onEdit}
              onGenerateIDCard={onGenerateIDCard}
              onExportHistoryPDF={onExportHistoryPDF}
              renderPartsAction={renderPartsAction}
              onOpenCalendar={handleOpenCalendarForWorker}
              sameDniWorkersMap={sameDniWorkersMap}
            />
          )}
        </div>
      )}

      <AnimatePresence>
        {showImportModal && (
          <ModalPortal label="PersonListView"><div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-xl font-bold flex items-center gap-2 text-brand-primary dark:text-blue-400">
                    <Upload className="w-6 h-6" /> Importar Trabajadores
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Seleccione un método para importar el listado de trabajadores (Excel, JSON o PDF).
                  </p>
                </div>
                <button 
                  onClick={() => setShowImportModal(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-600"
                >
                  &times;
                </button>
              </div>

              <div className="space-y-4 mt-6">
                <button
                  onClick={() => {
                    setShowImportModal(false);
                    fileInputRef.current?.click();
                  }}
                  className="w-full text-left p-4 rounded-2xl border-2 border-slate-100 dark:border-slate-800/80 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-slate-850/40 transition-all flex items-center gap-4 group"
                >
                  <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm">Dispositivo Local</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Sube un archivo desde tu ordenador (.xlsx, .json, .pdf)</p>
                  </div>
                </button>

                <button
                  onClick={handleOpenGooglePicker}
                  className="w-full text-left p-4 rounded-2xl border-2 border-slate-100 dark:border-slate-800/80 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-slate-850/40 transition-all flex items-center gap-4 group relative"
                  disabled={isDriveLoading}
                >
                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 group-hover:scale-110 transition-transform">
                    <Cloud className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-sm flex items-center gap-1.5">
                      Google Drive
                      {googleToken && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500" title="Conectado" />
                      )}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {googleToken 
                        ? 'Navega por tus carpetas y selecciona tus archivos directamente' 
                        : 'Inicia sesión con Google para buscar tus archivos en Drive'}
                    </p>
                  </div>
                </button>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/60 flex justify-end">
                <button
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl text-xs font-semibold transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div></ModalPortal>
        )}
      </AnimatePresence>

      {isDriveLoading && (
        <ModalPortal label="PersonListView"><div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-sm text-white">
          <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
          <p className="mt-4 text-sm font-semibold">Procesando archivo de Google Drive...</p>
        </div></ModalPortal>
      )}

      <GoogleCalendarModal
        isOpen={isCalendarModalOpen}
        onClose={() => setIsCalendarModalOpen(false)}
        events={modalCalendarEvents}
        title={modalTitle}
        onToast={(msg, type) => {
          if (onToast) onToast(msg, type);
          else alert(msg);
        }}
      />
    </div>
  );
};
