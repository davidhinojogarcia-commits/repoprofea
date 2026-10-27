import { reportOperationalError } from '../src/lib/operationalLog';

import React, { useState, useRef, useEffect, useMemo, useDeferredValue } from 'react';
import ModalPortal from './ModalPortal';
import { Person } from '../types';
import { Trash2, User, Calendar, MapPin, Download, Clock, Search, FileText, Pencil, Mail, MessageCircle, Upload, History, Cloud, Loader2, AlertTriangle, Table as TableIcon, LayoutGrid, Smartphone } from 'lucide-react';
import { MultiSearchableDropdown } from './MultiSearchableDropdown';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleCalendarModal } from './GoogleCalendarModal';
import { CalendarEventInput } from '../src/lib/googleCalendar';
import { VirtualPersonList } from './VirtualPersonList';
import { PersonTable } from './PersonTable';
import { CompactPersonCard } from './CompactPersonCard';
import { BulkShareButton } from './BulkShareButton';
import { sendDirectoryCommunication } from '../src/lib/directoryCommunications';

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
  const [showOnlyNoAptos, setShowOnlyNoAptos] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
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
      const matchesNoApto = !showOnlyNoAptos || person.reconocimientoEstado === 'No Apto';
      
      return matchesSearch && matchesObra && matchesQuincena && matchesRepeater && matchesNoApto;
    });
  }, [people, deferredSearchTerm, selectedObraSet, selectedQuincenaSet, showOnlyRepeaters, repeaterDniSet, showOnlyNoAptos]);

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
    <div id="directorio-section" className="ui-surface p-4 sm:p-6 lg:p-8 text-slate-800 dark:text-slate-100">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 pb-4 border-b border-slate-200 dark:border-slate-800 gap-4">
        <h2 className="text-[var(--ui-text)] text-xl sm:text-2xl font-black tracking-tight flex items-center">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--ui-gradient-brand)] text-white mr-3"><User className="w-5 h-5" /></span> Directorio ({people.length})
        </h2>
        <div className="flex flex-col gap-2 w-full md:w-auto">
          <div className="directorio-primary-actions flex flex-wrap gap-2 justify-end items-center">
               {onPairWorkerCard && <button type="button" onClick={onPairWorkerCard} className="min-h-11 rounded-xl border px-4 py-2 text-sm font-bold">Vincular cámara del móvil</button>}
               {onScanWorkerCard && <button type="button" onClick={onScanWorkerCard} className="min-h-11 rounded-xl bg-[#00548E] px-4 py-2 text-sm font-bold text-white">Escanear carnet con este dispositivo</button>}
               <input 
                 type="file" 
                 ref={fileInputRef} 
                 onChange={handleFileChange} 
                 accept=".xlsx, .xls, .json, .pdf" 
                 className="hidden" 
               />



          </div>
          <div className="text-right text-[11px] font-black uppercase tracking-[0.16em] text-slate-700 dark:text-slate-200">Acciones informativas rápidas</div>
          <div className="directorio-export-groups flex flex-wrap gap-2 justify-end">
               <div className="flex flex-col gap-2 w-full sm:w-auto">
                 <div data-encargados-relation-row="1" className="directorio-export-row flex items-center justify-end gap-2">
                   <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center mr-2">Relación de trabajadores para encargados:</span>
                   <button onClick={() => onExportPDF(peopleToExport)} className={`w-[112px] flex-none flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:hover:bg-red-900/50 dark:text-red-300 dark:border-red-800/80 px-4 py-1.5 rounded-lg transition-colors text-[11px] font-bold shadow-sm uppercase border ${isSelectionActive ? 'ring-2 ring-red-500/20' : ''}`}>
                      <FileText className="w-3 h-3 mr-1.5" /> PDF{isSelectionActive ? ` (${peopleToExport.length})` : ''}
                   </button>
                   <button onClick={() => onExport(peopleToExport)} className={`w-[112px] flex-none flex items-center justify-center bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800/80 px-4 py-1.5 rounded-lg transition-colors text-[11px] font-bold shadow-sm uppercase border ${isSelectionActive ? 'ring-2 ring-emerald-500/20' : ''}`}>
                      <Download className="w-3 h-3 mr-1.5" /> Excel{isSelectionActive ? ` (${peopleToExport.length})` : ''}
                   </button>
                   <button
                     type="button"
                     onClick={() => void sendDirectoryCommunication('encargados', peopleToExport, people).catch((error) => onToast?.(error?.message || 'No se pudo preparar el envío por WhatsApp.', 'error'))}
                     className="w-[112px] flex-none flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-slate-950 dark:border-emerald-300 px-3 py-1.5 rounded-lg transition-colors text-[11px] font-black shadow-sm uppercase"
                     title="Generar el PDF y compartirlo con el recurso preventivo configurado"
                   >
                     <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                   </button>
                 </div>
                 <div className="directorio-export-row flex items-center justify-end gap-2">
                   <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center mr-2">Reconocimientos Médicos:</span>
                   <button onClick={() => onExportRRMMPDF(peopleToExport)} className="w-[112px] flex-none flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:hover:bg-red-900/50 dark:text-red-300 dark:border-red-800/80 px-4 py-1.5 rounded-lg transition-colors text-[11px] font-bold shadow-sm uppercase border">
                      <FileText className="w-3 h-3 mr-1.5" /> PDF
                   </button>
                   <button onClick={() => onExportRRMMExcel(peopleToExport)} className="w-[112px] flex-none flex items-center justify-center bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800/80 px-4 py-1.5 rounded-lg transition-colors text-[11px] font-bold shadow-sm uppercase border">
                      <Download className="w-3 h-3 mr-1.5" /> Excel
                   </button>
                   <button
                     type="button"
                     onClick={() => void sendDirectoryCommunication('medical' as any, peopleToExport, people).catch((error) => onToast?.(error?.message || 'No se pudo preparar el correo.', 'error'))}
                     className="w-[112px] flex-none flex items-center justify-center gap-1.5 bg-sky-100 hover:bg-sky-200 text-sky-950 border border-sky-300 dark:bg-sky-700 dark:hover:bg-sky-600 dark:text-white dark:border-sky-500 px-3 py-1.5 rounded-lg transition-colors text-[11px] font-black shadow-sm uppercase"
                     title="Generar PDF y preparar el envío al contacto configurado"
                   >
                     <Mail className="w-3.5 h-3.5" /> Mail
                   </button>
                 </div>
                 <div className="directorio-export-row flex items-center justify-end gap-2">
                   <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center mr-2">Resumen Calzado:</span>
                   <button onClick={() => onExportCalzadoPDF(peopleToExport)} className="w-[112px] flex-none flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:hover:bg-red-900/50 dark:text-red-300 dark:border-red-800/80 px-4 py-1.5 rounded-lg transition-colors text-[11px] font-bold shadow-sm uppercase border">
                      <FileText className="w-3 h-3 mr-1.5" /> PDF
                   </button>
                   <button onClick={() => onExportCalzadoExcel(peopleToExport)} className="w-[112px] flex-none flex items-center justify-center bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800/80 px-4 py-1.5 rounded-lg transition-colors text-[11px] font-bold shadow-sm uppercase border">
                      <Download className="w-3 h-3 mr-1.5" /> Excel
                   </button>
                   <button
                     type="button"
                     onClick={() => void sendDirectoryCommunication('footwear' as any, peopleToExport, people).catch((error) => onToast?.(error?.message || 'No se pudo preparar el correo.', 'error'))}
                     className="w-[112px] flex-none flex items-center justify-center gap-1.5 bg-sky-100 hover:bg-sky-200 text-sky-950 border border-sky-300 dark:bg-sky-700 dark:hover:bg-sky-600 dark:text-white dark:border-sky-500 px-3 py-1.5 rounded-lg transition-colors text-[11px] font-black shadow-sm uppercase"
                     title="Generar PDF y preparar el envío al contacto configurado"
                   >
                     <Mail className="w-3.5 h-3.5" /> Mail
                   </button>
                 </div>
                 <div className="directorio-export-row flex items-center justify-end gap-2">
                   <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center mr-2">Formación PRL 20h:</span>
                   <button onClick={() => onExportPRLPDF(peopleToExport)} className="w-[112px] flex-none flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:hover:bg-red-900/50 dark:text-red-300 dark:border-red-800/80 px-4 py-1.5 rounded-lg transition-colors text-[11px] font-bold shadow-sm uppercase border">
                      <FileText className="w-3 h-3 mr-1.5" /> PDF
                   </button>
                   <button onClick={() => onExportPRLExcel(peopleToExport)} className="w-[112px] flex-none flex items-center justify-center bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800/80 px-4 py-1.5 rounded-lg transition-colors text-[11px] font-bold shadow-sm uppercase border">
                      <Download className="w-3 h-3 mr-1.5" /> Excel
                   </button>
                   <button
                     type="button"
                     onClick={() => void sendDirectoryCommunication('training' as any, peopleToExport, people).catch((error) => onToast?.(error?.message || 'No se pudo preparar el correo.', 'error'))}
                     className="w-[112px] flex-none flex items-center justify-center gap-1.5 bg-sky-100 hover:bg-sky-200 text-sky-950 border border-sky-300 dark:bg-sky-700 dark:hover:bg-sky-600 dark:text-white dark:border-sky-500 px-3 py-1.5 rounded-lg transition-colors text-[11px] font-black shadow-sm uppercase"
                     title="Generar PDF y preparar el envío al contacto configurado"
                   >
                     <Mail className="w-3.5 h-3.5" /> Mail
                   </button>
                 </div>
               </div>
          </div>
        </div>
      </div>

      <div className="mb-6 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 rounded-xl flex flex-col xl:flex-row items-stretch overflow-visible z-20 relative focus-within:ring-2 focus-within:ring-[#00548E]/20 dark:focus-within:ring-blue-500/30 focus-within:border-[#00548E] dark:focus-within:border-blue-500 transition-all">
        <div className="relative flex-1 flex items-center min-h-[52px]">
          <div className="pl-4 pr-2 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-slate-400 dark:text-slate-500" />
          </div>
          <input
            type="text"
            placeholder="Buscar por nombre, DNI, oferta, obra o categoría..."
            className="w-full py-3 pr-4 bg-transparent border-none focus:outline-none focus:ring-0 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="hidden xl:block w-px bg-slate-200 dark:bg-slate-700 my-2"></div>
        <div className="block xl:hidden h-px bg-slate-200 dark:bg-slate-700 mx-4"></div>

        <div className="flex flex-col sm:flex-row sm:flex-wrap xl:flex-nowrap items-stretch p-1.5 gap-1.5 xl:w-auto min-w-0">
          <MultiSearchableDropdown
            options={savedObras}
            selectedValues={selectedObraFilter}
            onChange={setSelectedObraFilter}
            placeholder="Obra: Todas"
            allLabel="Todas las obras"
            icon={<MapPin className="w-4 h-4" />}
            className="!w-full sm:!w-48 xl:!w-60"
            buttonClassName="!bg-transparent !border-none hover:!bg-slate-100 dark:hover:!bg-slate-700/60 !shadow-none !h-full"
          />
          <div className="hidden sm:block w-px bg-slate-200 dark:bg-slate-700 my-1"></div>
          <div className="block sm:hidden h-px bg-slate-200 dark:bg-slate-700 mx-2"></div>
          <MultiSearchableDropdown
            options={uniqueQuincenas}
            selectedValues={selectedQuincenaFilter}
            onChange={setSelectedQuincenaFilter}
            placeholder="Quincena: Todas"
            allLabel="Todas las quincenas"
            icon={<Clock className="w-4 h-4" />}
            className="!w-full sm:!w-48 xl:!w-60"
            buttonClassName="!bg-transparent !border-none hover:!bg-slate-100 dark:hover:!bg-slate-700/60 !shadow-none !h-full"
          />
          <div className="hidden sm:block w-px bg-slate-200 dark:bg-slate-700 my-1"></div>
          <div className="block sm:hidden h-px bg-slate-200 dark:bg-slate-700 mx-2"></div>
          <button
            onClick={() => setShowOnlyRepeaters(!showOnlyRepeaters)}
            className={`flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer whitespace-nowrap ${
              showOnlyRepeaters 
                ? 'bg-purple-100 hover:bg-purple-200 text-purple-700 border-purple-300 dark:bg-purple-950/60 dark:hover:bg-purple-900/60 dark:text-purple-300 dark:border-purple-800 shadow-sm ring-2 ring-purple-500/20' 
                : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200 hover:border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700'
            }`}
          >
            <History className={`w-3.5 h-3.5 ${showOnlyRepeaters ? 'text-purple-600 dark:text-purple-400 animate-pulse' : 'text-slate-500 dark:text-slate-400'}`} />
            <span>Repetidores</span>
          </button>

          {noAptosCount > 0 && (
            <button
              onClick={() => setShowOnlyNoAptos(!showOnlyNoAptos)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                showOnlyNoAptos 
                  ? 'bg-red-600 text-white border-red-700 shadow-sm ring-2 ring-red-500/20' 
                  : 'bg-red-50 hover:bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:hover:bg-red-900/50 dark:text-red-300 dark:border-red-800/80'
              }`}
              title="Filtrar trabajadores con reconocimiento No Apto"
            >
              <AlertTriangle className={`w-3.5 h-3.5 ${showOnlyNoAptos ? 'text-white' : 'text-red-600 dark:text-red-400 animate-pulse'}`} />
              <span>No Aptos ({noAptosCount})</span>
            </button>
          )}
        </div>
      </div>

      {noAptosCount > 0 && (
        <div className="mb-5 p-3.5 bg-red-50/90 dark:bg-red-950/40 border-2 border-red-400 dark:border-red-800/80 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-red-900 dark:text-red-200 shadow-sm">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 animate-bounce" />
            <div>
              <span className="font-extrabold uppercase tracking-wide mr-1.5 text-red-700 dark:text-red-300">
                Alerta de Prevención de Contratación:
              </span>
              <span>
                Hay <strong>{noAptosCount} trabajador(es) con Reconocimiento Médico "No Apto"</strong> {noAptoDocIncompleteCount > 0 && `(${noAptoDocIncompleteCount} con Documentación bloqueada en 'No')`}. Sus fichas cuentan con indicador de advertencia persistente y resaltado en rojo para evitar contrataciones erróneas.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowOnlyNoAptos(!showOnlyNoAptos)}
            className={`px-3 py-1.5 rounded-xl font-bold text-xs shrink-0 transition-all border cursor-pointer ${
              showOnlyNoAptos
                ? 'bg-red-600 text-white border-red-700 shadow-sm'
                : 'bg-white hover:bg-red-100 text-red-700 border-red-300 dark:bg-slate-900 dark:hover:bg-red-950/80'
            }`}
          >
            {showOnlyNoAptos ? 'Mostrar todos' : `Filtrar No Aptos (${noAptosCount})`}
          </button>
        </div>
      )}

      {filteredPeople.length === 0 ? (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400 bg-slate-100/30 dark:bg-slate-800/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
           <Search className="w-10 h-10 mx-auto mb-3 opacity-20" />
           <p className="text-sm font-medium">No se encontraron resultados para "{searchTerm}"</p>
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

              <div className="profea-directory-view-switcher grid grid-cols-[0.78fr_1.42fr_1fr] sm:flex items-center gap-1 w-full sm:w-auto bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs">
                <button
                  type="button"
                  id="btn-view-table"
                  onClick={() => handleSetViewLayout('table')}
                  className={`min-w-0 w-full sm:w-auto flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
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
                  className={`min-w-0 w-full sm:w-auto flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
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
                  className={`min-w-0 w-full sm:w-auto flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
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
                
                <div className="flex flex-wrap items-center gap-2">
                  {onEditMultiple && (
                    <button 
                      onClick={handleBulkEdit}
                      className="flex items-center justify-center bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 text-[#00548E] dark:text-blue-300 px-3 py-1.5 rounded-lg transition-colors text-xs font-bold shadow-sm border border-blue-200 dark:border-blue-800/80 cursor-pointer"
                      title="Editar trabajadores seleccionados"
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1.5" /> Editar Masivo
                    </button>
                  )}
                  <BulkShareButton resourceType="trabajadores" resourceIds={selectedIds} />
                  <button 
                    onClick={handleOpenCalendarForSelected}
                    className="flex items-center justify-center bg-[#00548E]/10 hover:bg-[#00548E]/20 text-[#00548E] dark:text-blue-300 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 px-3 py-1.5 rounded-lg transition-colors text-xs font-bold shadow-sm border border-[#00548E]/20 dark:border-blue-800/80 cursor-pointer"
                    title="Añadir a Google Calendar los seleccionados"
                  >
                    <Calendar className="w-3.5 h-3.5 mr-1.5 text-[#00548E] dark:text-blue-400" /> Google Calendar
                  </button>
                  {onDeleteMultiple && (
                    <button 
                      onClick={handleBulkDelete}
                      className="flex items-center justify-center bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 text-red-600 dark:text-red-300 px-3 py-1.5 rounded-lg transition-colors text-xs font-bold shadow-sm border border-red-200 dark:border-red-900/60 cursor-pointer"
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
