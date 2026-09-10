import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  HardHat, FileCheck, AlertTriangle, CheckCircle2, XCircle, Clock,
  Sparkles, UploadCloud, FileText, Download, Copy, Trash2, Plus,
  Search, Filter, Building2, Calendar, UserCheck, FileWarning,
  ShieldCheck, MessageSquare, Edit3, Save, RefreshCw, ChevronRight,
  AlertCircle, Phone, Mail, Check, X, Info, BarChart3, SlidersHorizontal,
  FileSignature, Eye, Briefcase
} from 'lucide-react';
import { Subcontratista, SubcontrataDocItem, SubcontrataDocEstado, SubcontrataEstadoExpediente, Person, ReporteTecnicoConfig } from '../types';
import { 
  createNewSubcontratista, 
  getSubcontrataCompliance, 
  generateRequerimientoText, 
  generateSubcontrataReportPDF,
  generateObraConsolidatedReportPDF,
  DEFAULT_SUBCONTRATA_CHECKLIST,
  getStoredChecklistTemplate,
  saveStoredChecklistTemplate,
  syncSubcontrataChecklistWithTemplate,
  getStoredReporteTecnicoConfig,
  saveStoredReporteTecnicoConfig,
  getStoredObrasRecursosPreventivos,
  saveStoredObraRecursoPreventivo,
  deleteStoredObraRecursoPreventivo,
  updateStoredObraNameInRecursos
} from '../src/lib/subcontratasDefaults';
import { formatDate } from '../src/lib/exportUtils';
import { FileUploaderIA } from './FileUploaderIA';
import { ChecklistConfigModal } from './ChecklistConfigModal';
import { auth } from '../src/lib/firebase';
import { createDocument, deleteDocument, updateDocument, subscribeToDocuments } from '../src/services/firestoreService';
import type { Unsubscribe } from 'firebase/firestore';

interface SubcontratasSectionProps {
  savedObras: string[];
  supervisoresDisponibles?: string[];
  workers?: Person[];
  onToast: (message: string, type: 'success' | 'error') => void;
  onUpdateSavedObras?: (newObras: string[]) => void;
}

const STORAGE_KEY = 'profea_subcontratas_v1';

export const SubcontratasSection: React.FC<SubcontratasSectionProps> = ({
  savedObras,
  supervisoresDisponibles = [],
  workers = [],
  onToast,
  onUpdateSavedObras
}) => {
  // Selected obra filter
  const [selectedObra, setSelectedObra] = useState<string>('todas');
  // Selected subcontractor for details view
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  
  // List of subcontractors
  const [subcontratistas, setSubcontratistasState] = useState<Subcontratista[]>([]);
  const suppressSubPersistenceRef = useRef(false);
  const hydratedSubcontratasRef = useRef(false);

  const persistSubcontratas = async (previous: Subcontratista[], next: Subcontratista[]) => {
    if (!auth.currentUser || suppressSubPersistenceRef.current || !hydratedSubcontratasRef.current) return;
    const previousById = new Map(previous.map(item => [item.id, item]));
    const nextById = new Map(next.map(item => [item.id, item]));
    try {
      for (const item of next) {
        const old = previousById.get(item.id);
        if (!old) await createDocument('subcontractors', item.id, item as any);
        else if (JSON.stringify(old) !== JSON.stringify(item)) await updateDocument('subcontractors', item.id, item as any);
      }
      for (const old of previous) {
        if (!nextById.has(old.id)) await deleteDocument('subcontractors', old.id);
      }
    } catch (error) {
      console.error('Error guardando subcontratas en Firestore:', error);
      onToast('No se pudieron guardar los cambios de subcontratas en Firebase.', 'error');
    }
  };

  const setSubcontratistas = useCallback((action: React.SetStateAction<Subcontratista[]>) => {
    setSubcontratistasState(previous => {
      const next = typeof action === 'function' ? (action as (prev: Subcontratista[]) => Subcontratista[])(previous) : action;
      void persistSubcontratas(previous, next);
      return next;
    });
  }, []);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unsubscribe: Unsubscribe = subscribeToDocuments<Subcontratista>('subcontractors', items => {
      suppressSubPersistenceRef.current = true;
      setSubcontratistasState(items);
      hydratedSubcontratasRef.current = true;
      queueMicrotask(() => { suppressSubPersistenceRef.current = false; });
    }, { includeShared: true }, error => {
      console.error('Error leyendo subcontratas de Firestore:', error);
      onToast('No se pudieron cargar las subcontratas desde Firebase.', 'error');
    });
    return () => unsubscribe();
  }, []);


  // Modals & UI States
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isRequerimientoModalOpen, setIsRequerimientoModalOpen] = useState(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isFirmasModalOpen, setIsFirmasModalOpen] = useState(false);
  const [reporteConfig, setReporteConfig] = useState<ReporteTecnicoConfig>(() => getStoredReporteTecnicoConfig());
  const [checklistTemplate, setChecklistTemplate] = useState<SubcontrataDocItem[]>(() => getStoredChecklistTemplate());
  const [aiAnalysisSummary, setAiAnalysisSummary] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [checklistCategoryFilter, setChecklistCategoryFilter] = useState<'todos' | 'empresa' | 'trabajadores' | 'maquinaria'>('todos');
  const [checklistStatusFilter, setChecklistStatusFilter] = useState<'todos' | 'rojos' | 'entregados'>('todos');

  // Obra Management States
  const [isManageObrasModalOpen, setIsManageObrasModalOpen] = useState(false);
  const [obrasRecursos, setObrasRecursos] = useState(() => getStoredObrasRecursosPreventivos());
  const [editingObraState, setEditingObraState] = useState<{
    oldName: string;
    newName: string;
    recurso: string;
    categoria: string;
  } | null>(null);
  const [deletingObraState, setDeletingObraState] = useState<{
    obraName: string;
    subcontratasCount: number;
    action: 'reassign' | 'delete_all';
    targetObra: string;
  } | null>(null);
  const [newObraInput, setNewObraInput] = useState('');
  const [newObraRecurso, setNewObraRecurso] = useState('');
  const [newObraCategoria, setNewObraCategoria] = useState('Encargado de Obra');

  // Keep obrasRecursos in sync whenever ManageObrasModal is opened
  useEffect(() => {
    if (isManageObrasModalOpen) {
      setObrasRecursos(getStoredObrasRecursosPreventivos());
    }
  }, [isManageObrasModalOpen]);

  // Form states for new subcontrata
  const [newForm, setNewForm] = useState({
    nombreEmpresa: '',
    cif: '',
    obra: savedObras[0] || '',
    municipio: '',
    personaContacto: '',
    telefono: '',
    email: '',
    actividadGremio: 'Albañilería y Revestimientos',
    fechaInicioPrevista: '',
    supervisorResponsable: supervisoresDisponibles[0] || '',
    recursoPreventivo: '',
    numeroTrabajadoresPrevistos: 2,
    notas: ''
  });

  // Currently active subcontractor
  const activeSubcontrata = useMemo(() => {
    if (!selectedSubId) return null;
    return subcontratistas.find(s => s.id === selectedSubId) || null;
  }, [subcontratistas, selectedSubId]);

  // Workers belonging to the active subcontractor's obra
  const activeObraWorkers = useMemo(() => {
    const allWorkers = workers || [];
    if (!activeSubcontrata?.obra) return allWorkers;
    const cleanSubObra = activeSubcontrata.obra.trim().toLowerCase();
    const matched = allWorkers.filter(w => (w.obra || '').trim().toLowerCase() === cleanSubObra);
    return matched.length > 0 ? matched : allWorkers;
  }, [workers, activeSubcontrata?.obra]);

  // Filtered subcontractors by Obra & Search
  const filteredSubcontratistas = useMemo(() => {
    return subcontratistas.filter(sub => {
      const matchesObra = selectedObra === 'todas' || sub.obra === selectedObra;
      const term = searchTerm.toLowerCase().trim();
      const matchesSearch = !term || 
        sub.nombreEmpresa.toLowerCase().includes(term) ||
        sub.cif.toLowerCase().includes(term) ||
        sub.actividadGremio.toLowerCase().includes(term) ||
        sub.obra.toLowerCase().includes(term);
      return matchesObra && matchesSearch;
    });
  }, [subcontratistas, selectedObra, searchTerm]);

  // Available obras for selector
  const allObrasList = useMemo(() => {
    const set = new Set<string>(savedObras);
    subcontratistas.forEach(s => {
      if (s.obra) set.add(s.obra);
    });
    return Array.from(set);
  }, [savedObras, subcontratistas]);

  // Compliance statistics by Obra based on uploaded documents
  const obrasComplianceStats = useMemo(() => {
    return allObrasList.map(obraName => {
      const subsInObra = subcontratistas.filter(s => s.obra === obraName);
      let totalDocs = 0;
      let entregadosDocs = 0;
      let faltantesDocs = 0;
      let aptasCount = 0;
      let condicionadasCount = 0;
      let denegadasCount = 0;

      subsInObra.forEach(sub => {
        if (sub.estadoExpediente === 'apto') aptasCount++;
        else if (sub.estadoExpediente === 'condicionado') condicionadasCount++;
        else if (sub.estadoExpediente === 'denegado') denegadasCount++;

        sub.checklist.forEach(item => {
          if (item.estado !== 'no_aplica') {
            totalDocs++;
            if (item.estado === 'entregado') {
              entregadosDocs++;
            } else {
              faltantesDocs++;
            }
          }
        });
      });

      const porcentaje = totalDocs > 0 ? Math.round((entregadosDocs / totalDocs) * 100) : 0;

      return {
        obra: obraName,
        totalSubcontratas: subsInObra.length,
        aptasCount,
        condicionadasCount,
        denegadasCount,
        totalDocs,
        entregadosDocs,
        faltantesDocs,
        porcentaje
      };
    });
  }, [allObrasList, subcontratistas]);

  // Global compliance across all registered subcontractors
  const globalObraStats = useMemo(() => {
    let totalDocs = 0;
    let entregadosDocs = 0;
    let faltantesDocs = 0;
    let aptasCount = 0;

    subcontratistas.forEach(sub => {
      if (sub.estadoExpediente === 'apto') aptasCount++;
      sub.checklist.forEach(item => {
        if (item.estado !== 'no_aplica') {
          totalDocs++;
          if (item.estado === 'entregado') {
            entregadosDocs++;
          } else {
            faltantesDocs++;
          }
        }
      });
    });

    const porcentaje = totalDocs > 0 ? Math.round((entregadosDocs / totalDocs) * 100) : 0;

    return {
      totalSubcontratas: subcontratistas.length,
      aptasCount,
      totalDocs,
      entregadosDocs,
      faltantesDocs,
      porcentaje
    };
  }, [subcontratistas]);

  // Handle adding a new subcontrata
  const handleCreateSubcontrata = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newForm.nombreEmpresa.trim()) {
      onToast('Introduzca la Razón Social de la empresa', 'error');
      return;
    }
    if (!newForm.cif.trim()) {
      onToast('Introduzca el CIF de la subcontrata', 'error');
      return;
    }

    const created = createNewSubcontratista(newForm.obra, newForm.supervisorResponsable, {
      ...newForm
    });

    setSubcontratistas(prev => [created, ...prev]);
    setSelectedSubId(created.id);
    setIsNewModalOpen(false);
    onToast(`Subcontrata "${created.nombreEmpresa}" registrada correctamente`, 'success');

    // Reset form
    setNewForm({
      nombreEmpresa: '',
      cif: '',
      obra: savedObras[0] || '',
      municipio: '',
      personaContacto: '',
      telefono: '',
      email: '',
      actividadGremio: 'Albañilería y Revestimientos',
      fechaInicioPrevista: '',
      supervisorResponsable: supervisoresDisponibles[0] || '',
      recursoPreventivo: '',
      numeroTrabajadoresPrevistos: 2,
      notas: ''
    });
  };

  // Handle manual update of single checklist item
  const handleUpdateChecklistItem = (
    subId: string,
    itemId: string,
    updates: Partial<SubcontrataDocItem>
  ) => {
    setSubcontratistas(prev => prev.map(sub => {
      if (sub.id !== subId) return sub;
      const updatedChecklist = sub.checklist.map(item => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          ...updates,
          fechaEntrega: updates.estado === 'entregado' && !item.fechaEntrega 
            ? new Date().toISOString().slice(0, 10) 
            : updates.fechaEntrega !== undefined ? updates.fechaEntrega : item.fechaEntrega
        };
      });

      // Recalculate suggested state
      const tempSub = { ...sub, checklist: updatedChecklist };
      const comp = getSubcontrataCompliance(tempSub);

      return {
        ...sub,
        checklist: updatedChecklist,
        estadoExpediente: comp.estadoSugerido,
        fechaActualizacion: new Date().toISOString()
      };
    }));
  };

  // Quick toggle status for checklist item
  const handleToggleStatus = (subId: string, itemId: string, newStatus: SubcontrataDocEstado) => {
    handleUpdateChecklistItem(subId, itemId, { estado: newStatus });
  };

  // Delete subcontractor
  const handleDeleteSubcontrata = (subId: string, nombre: string) => {
    if (!window.confirm(`¿Está seguro de eliminar el registro de la subcontrata "${nombre}"?`)) return;
    setSubcontratistas(prev => prev.filter(s => s.id !== subId));
    if (selectedSubId === subId) setSelectedSubId(null);
    onToast(`Subcontrata "${nombre}" eliminada.`, 'success');
  };

  // Save and propagate legal checklist configuration
  const handleSaveChecklistTemplate = (
    newTemplate: SubcontrataDocItem[],
    applyToActive: boolean,
    applyToAll: boolean
  ) => {
    saveStoredChecklistTemplate(newTemplate);
    setChecklistTemplate(newTemplate);

    if (applyToAll) {
      setSubcontratistas(prev => prev.map(sub => {
        const syncedChecklist = syncSubcontrataChecklistWithTemplate(sub.checklist, newTemplate);
        const compliance = getSubcontrataCompliance({ ...sub, checklist: syncedChecklist });
        return {
          ...sub,
          checklist: syncedChecklist,
          estadoExpediente: compliance.estadoSugerido,
          fechaActualizacion: new Date().toISOString()
        };
      }));
      onToast(`Checklist legal configurado y aplicado a las ${subcontratistas.length} subcontratas registradas.`, 'success');
    } else if (applyToActive && activeSubcontrata) {
      setSubcontratistas(prev => prev.map(sub => {
        if (sub.id !== activeSubcontrata.id) return sub;
        const syncedChecklist = syncSubcontrataChecklistWithTemplate(sub.checklist, newTemplate);
        const compliance = getSubcontrataCompliance({ ...sub, checklist: syncedChecklist });
        return {
          ...sub,
          checklist: syncedChecklist,
          estadoExpediente: compliance.estadoSugerido,
          fechaActualizacion: new Date().toISOString()
        };
      }));
      onToast(`Checklist legal actualizado para "${activeSubcontrata.nombreEmpresa}".`, 'success');
    } else {
      onToast('Checklist legal guardado como plantilla predeterminada para nuevas subcontratas.', 'success');
    }
  };

  // Update whole subcontractor profile
  const handleUpdateSubDetails = (subId: string, field: keyof Subcontratista, val: any) => {
    setSubcontratistas(prev => prev.map(s => {
      if (s.id !== subId) return s;
      return {
        ...s,
        [field]: val,
        fechaActualizacion: new Date().toISOString()
      };
    }));
  };

  // Copy formal requirement text to clipboard
  const handleCopyRequerimiento = () => {
    if (!activeSubcontrata) return;
    const text = generateRequerimientoText(
      activeSubcontrata,
      activeSubcontrata.obra,
      activeSubcontrata.supervisorResponsable || ''
    );
    navigator.clipboard.writeText(text);
    onToast('Texto de requerimiento formal copiado al portapapeles.', 'success');
  };

  // PDF Export
  const handleExportPDF = async () => {
    if (!activeSubcontrata) return;
    try {
      await generateSubcontrataReportPDF(
        activeSubcontrata,
        activeSubcontrata.supervisorResponsable
      );
      onToast('Informe oficial en PDF descargado correctamente.', 'success');
    } catch (err) {
      console.error('Error generating PDF:', err);
      onToast('Error al generar el informe en PDF.', 'error');
    }
  };

  // Helper to persist updated obras list
  const persistObrasList = (updatedObras: string[]) => {
    onUpdateSavedObras?.(updatedObras);
  };

  // Add a new obra to the catalog
  const handleAddNewObra = (nameToAdd?: string, recursoToAdd?: string, categoriaToAdd?: string) => {
    const name = (nameToAdd || newObraInput).trim();
    const recurso = (recursoToAdd || newObraRecurso).trim();
    const categoria = (categoriaToAdd || newObraCategoria).trim() || 'Encargado de Obra';
    if (!name) {
      onToast('Introduzca el nombre de la nueva obra.', 'error');
      return;
    }
    if (!recurso) {
      onToast('El campo Recurso Preventivo es obligatorio.', 'error');
      return;
    }
    if (allObrasList.some(o => o.toLowerCase() === name.toLowerCase())) {
      onToast('Ya existe una obra registrada con ese nombre.', 'error');
      return;
    }
    const updated = [...savedObras, name];
    persistObrasList(updated);
    saveStoredObraRecursoPreventivo(name, recurso, categoria);
    setObrasRecursos(getStoredObrasRecursosPreventivos());
    setNewObraInput('');
    setNewObraRecurso('');
    setNewObraCategoria('Encargado de Obra');
    onToast(`Obra "${name}" añadida con recurso preventivo "${recurso}".`, 'success');
  };

  // Open modal to edit obra name and recurso preventivo
  const handleOpenEditObra = (obraName: string) => {
    const currentRec = obrasRecursos[obraName];
    setEditingObraState({ 
      oldName: obraName, 
      newName: obraName,
      recurso: currentRec?.recursoPreventivoNombre || '',
      categoria: currentRec?.recursoPreventivoCategoria || 'Encargado de Obra'
    });
  };

  // Save edited obra name and recurso preventivo across catalog and all subcontractors
  const handleSaveEditObra = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingObraState) return;
    const { oldName, newName, recurso, categoria } = editingObraState;
    const trimmedNew = newName.trim();
    const trimmedRec = recurso.trim();
    if (!trimmedNew) {
      onToast('El nombre de la obra no puede estar vacío.', 'error');
      return;
    }
    if (!trimmedRec) {
      onToast('El nombre del Recurso Preventivo es obligatorio.', 'error');
      return;
    }
    if (trimmedNew !== oldName && allObrasList.some(o => o.toLowerCase() === trimmedNew.toLowerCase())) {
      onToast('Ya existe otra obra con ese nombre.', 'error');
      return;
    }

    // 1. Update saved obras
    const updatedObras = savedObras.map(o => o === oldName ? trimmedNew : o);
    if (!updatedObras.includes(trimmedNew)) {
      updatedObras.push(trimmedNew);
    }
    persistObrasList(updatedObras);

    // 2. Update recurso preventivo and rename if needed
    if (trimmedNew !== oldName) {
      updateStoredObraNameInRecursos(oldName, trimmedNew);
    }
    saveStoredObraRecursoPreventivo(trimmedNew, trimmedRec, categoria.trim());
    setObrasRecursos(getStoredObrasRecursosPreventivos());

    // 3. Update all subcontratas
    setSubcontratistas(prev => prev.map(s => {
      if (s.obra === oldName) {
        return { ...s, obra: trimmedNew, fechaActualizacion: new Date().toISOString() };
      }
      return s;
    }));

    // 4. Update current filter if matching
    if (selectedObra === oldName) {
      setSelectedObra(trimmedNew);
    }

    setEditingObraState(null);
    onToast(`Obra "${trimmedNew}" y su Recurso Preventivo actualizados correctamente.`, 'success');
  };

  // Open modal to delete an obra
  const handleOpenDeleteObra = (obraName: string) => {
    const subsInObra = subcontratistas.filter(s => s.obra === obraName);
    const remainingObras = allObrasList.filter(o => o !== obraName);
    setDeletingObraState({
      obraName,
      subcontratasCount: subsInObra.length,
      action: 'reassign',
      targetObra: remainingObras[0] || ''
    });
  };

  // Confirm delete obra
  const handleConfirmDeleteObra = () => {
    if (!deletingObraState) return;
    const { obraName, subcontratasCount, action, targetObra } = deletingObraState;

    if (action === 'reassign' && subcontratasCount > 0 && !targetObra) {
      onToast('Seleccione una obra de destino para reasignar las subcontratas.', 'error');
      return;
    }

    // 1. Update subcontratistas
    if (action === 'reassign' && subcontratasCount > 0) {
      setSubcontratistas(prev => prev.map(s => {
        if (s.obra === obraName) {
          return { ...s, obra: targetObra, fechaActualizacion: new Date().toISOString() };
        }
        return s;
      }));
      onToast(`Las subcontratas de "${obraName}" han sido reasignadas a "${targetObra}".`, 'success');
    } else {
      setSubcontratistas(prev => prev.filter(s => s.obra !== obraName));
      if (subcontratasCount > 0) {
        onToast(`Se eliminaron las ${subcontratasCount} subcontratas asociadas a "${obraName}".`, 'success');
      }
    }

    // 2. Remove from catalog and delete preventive resource
    const updatedObras = savedObras.filter(o => o !== obraName);
    persistObrasList(updatedObras);
    deleteStoredObraRecursoPreventivo(obraName);
    setObrasRecursos(getStoredObrasRecursosPreventivos());

    // 3. Update filter if matching
    if (selectedObra === obraName) {
      setSelectedObra('todas');
    }

    setDeletingObraState(null);
    onToast(`Obra "${obraName}" eliminada correctamente del catálogo.`, 'success');
  };

  // Export consolidated PDF report by obra
  const handleExportConsolidatedPDF = async (obraName?: string) => {
    const targetObra = obraName || (selectedObra !== 'todas' ? selectedObra : allObrasList[0]);
    if (!targetObra) {
      onToast('Seleccione una obra para generar el reporte consolidado.', 'error');
      return;
    }
    const subsInObra = subcontratistas.filter(s => s.obra === targetObra);
    if (subsInObra.length === 0) {
      onToast(`No hay subcontratas registradas en "${targetObra}". Registre al menos una para emitir el informe consolidado.`, 'error');
      return;
    }

    try {
      const supervisor = subsInObra[0]?.supervisorResponsable || supervisoresDisponibles[0] || 'David Hinojo García';
      await generateObraConsolidatedReportPDF(targetObra, subsInObra, supervisor);
      onToast(`Informe consolidado de "${targetObra}" generado correctamente con diseño oficial de Diputación.`, 'success');
    } catch (err) {
      console.error('Error generating consolidated PDF:', err);
      onToast('Error al exportar el reporte consolidado en PDF.', 'error');
    }
  };

  return (
    <div id="subcontratas-section-container" className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-amber-500/10 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 rounded-xl shrink-0">
            <HardHat className="w-8 h-8" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                Control de Subcontratas de Obra (CAE)
              </h1>
              <span className="px-2.5 py-0.5 text-xs font-semibold bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-full">
                Ley 32/2006 & RD 1627/1997
              </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Checklist legal de documentación obligatoria por obra, cotejo y verificación automática con Inteligencia Artificial, alertas en rojo de faltantes e informe oficial con sello de Diputación.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            id="btn-reporte-consolidado-top"
            type="button"
            onClick={() => handleExportConsolidatedPDF()}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
            title="Exportar reporte técnico consolidado en PDF de la obra con diseño de Diputación"
          >
            <Download className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <span>Reporte Técnico PDF</span>
          </button>

          <button
            id="btn-firmas-reporte-top"
            type="button"
            onClick={() => setIsFirmasModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
            title="Configurar firmas oficiales para el reporte técnico (Técnico, Coordinador CSS, Supervisor de obra)"
          >
            <FileSignature className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <span>Firmas Reporte Técnico</span>
          </button>

          <button
            id="btn-gestionar-obras-top"
            type="button"
            onClick={() => setIsManageObrasModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
            title="Gestionar el catálogo de obras (añadir, editar o eliminar obras)"
          >
            <Building2 className="w-4 h-4 text-slate-600 dark:text-slate-400" />
            <span>Gestionar Obras</span>
          </button>

          <button
            id="btn-configurar-checklist-top"
            type="button"
            onClick={() => setIsConfigModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
            title="Configurar y editar la lista de documentos obligatorios del checklist legal (Seguro RC, TC1, Certificados de estar al corriente...)"
          >
            <SlidersHorizontal className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <span className="hidden sm:inline">Configurar Checklist Legal</span>
            <span className="sm:hidden">Checklist</span>
            <span className="px-1.5 py-0.5 text-[10px] font-black bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 rounded-md">
              {checklistTemplate.filter(i => i.obligatorio).length} obligatorios
            </span>
          </button>

          <button
            id="btn-nueva-subcontrata"
            onClick={() => setIsNewModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva Subcontrata</span>
          </button>
        </div>
      </div>

      {/* Visual Progress Bar Section for Each Obra */}
      <div id="progreso-cumplimiento-obras" className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 rounded-lg">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                  Cumplimiento del Checklist Legal por Obra
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md border border-slate-200 dark:border-slate-700">
                  CAE PROFEA
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Porcentaje de documentación legal subida y verificada conforme a la Ley 32/2006 y RD 1627/1997.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-start sm:self-center">
            <div className="text-right">
              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 block uppercase tracking-wider">
                Total Provincial
              </span>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {globalObraStats.entregadosDocs} de {globalObraStats.totalDocs} docs.
              </span>
            </div>
            <div className={`px-2.5 py-1 rounded-lg text-xs font-extrabold flex items-center gap-1.5 ${
              globalObraStats.porcentaje === 100
                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                : globalObraStats.porcentaje >= 60
                ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300'
                : 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
            }`}>
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{globalObraStats.porcentaje}% Global</span>
            </div>
          </div>
        </div>

        {/* Obra Progress Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {obrasComplianceStats.map((stat) => {
            const isSelected = selectedObra === stat.obra;
            const hasSubcontratas = stat.totalSubcontratas > 0;
            
            // Progress color
            let progressColor = 'bg-rose-500';
            let badgeStyle = 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800';
            if (stat.porcentaje === 100 && hasSubcontratas) {
              progressColor = 'bg-emerald-500';
              badgeStyle = 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
            } else if (stat.porcentaje >= 60) {
              progressColor = 'bg-blue-600';
              badgeStyle = 'bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800';
            } else if (stat.porcentaje >= 30) {
              progressColor = 'bg-amber-500';
              badgeStyle = 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800';
            }

            return (
              <div
                key={stat.obra}
                id={`obra-progress-card-${stat.obra.replace(/\s+/g, '-').toLowerCase()}`}
                onClick={() => setSelectedObra(isSelected ? 'todas' : stat.obra)}
                className={`p-4 rounded-xl border transition-all cursor-pointer text-left relative ${
                  isSelected
                    ? 'border-blue-600 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 ring-2 ring-blue-500/20 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 shadow-2xs'
                }`}
                title={`Haga clic para filtrar por "${stat.obra}"`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <Building2 className={`w-4 h-4 mt-0.5 shrink-0 ${isSelected ? 'text-blue-700 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug truncate" title={stat.obra}>
                      {stat.obra}
                    </h4>
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-bold border rounded-full shrink-0 ${badgeStyle}`}>
                    {stat.porcentaje}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1.5 my-2.5">
                  <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
                      style={{ width: `${stat.porcentaje}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>
                      {stat.entregadosDocs} de {stat.totalDocs} docs. subidos
                    </span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {stat.totalSubcontratas} {stat.totalSubcontratas === 1 ? 'subcontrata' : 'subcontratas'}
                    </span>
                  </div>
                </div>

                {/* Status Badges Row */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]">
                  {hasSubcontratas ? (
                    <>
                      {stat.faltantesDocs > 0 ? (
                        <span className="text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1">
                          <X className="w-3 h-3 text-rose-500 shrink-0" />
                          <span>{stat.faltantesDocs} pendientes/caducados</span>
                        </span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1">
                          <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span>Documentación al 100%</span>
                        </span>
                      )}

                      <span className="text-slate-400 dark:text-slate-500 font-mono text-[10px]">
                        {stat.aptasCount}/{stat.totalSubcontratas} aptas
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-400 dark:text-slate-500 italic text-[11px]">
                      Sin subcontratistas dados de alta
                    </span>
                  )}
                </div>

                {/* Obra Quick Actions Row: Export PDF, Edit, Delete */}
                <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExportConsolidatedPDF(stat.obra);
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-blue-700 dark:text-blue-400 hover:bg-blue-100/80 dark:hover:bg-blue-950/60 rounded-md transition-colors cursor-pointer"
                    title={`Exportar Reporte Técnico PDF de ${stat.obra}`}
                  >
                    <Download className="w-3 h-3" />
                    <span>Reporte Técnico PDF</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEditObra(stat.obra);
                      }}
                      className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-blue-700 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                      title={`Editar nombre de "${stat.obra}"`}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenDeleteObra(stat.obra);
                      }}
                      className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-md transition-colors cursor-pointer"
                      title={`Eliminar obra "${stat.obra}"`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {isSelected && (
                  <div className="absolute top-2 right-2 flex items-center">
                    <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400"></span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Obra Filter & Search Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-4 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mr-1">
            Filtrar por Obra:
          </span>
          <button
            onClick={() => setSelectedObra('todas')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              selectedObra === 'todas'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            Todas las Obras ({subcontratistas.length})
          </button>
          {allObrasList.map(obraName => {
            const count = subcontratistas.filter(s => s.obra === obraName).length;
            const stat = obrasComplianceStats.find(o => o.obra === obraName);
            const pct = stat ? stat.porcentaje : 0;
            return (
              <button
                key={obraName}
                onClick={() => setSelectedObra(obraName)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer truncate max-w-xs flex items-center gap-1.5 ${
                  selectedObra === obraName
                    ? 'bg-blue-700 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <span>{obraName} ({count})</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  selectedObra === obraName
                    ? 'bg-blue-800 text-blue-100'
                    : pct === 100
                    ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300'
                    : pct >= 50
                    ? 'bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}>
                  {pct}%
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por empresa, CIF o gremio..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-900"
          />
        </div>
      </div>

      {/* Main Layout: Master-Detail view */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Subcontractors List */}
        <div className="lg:col-span-4 space-y-3 min-w-0">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 truncate">
              Subcontratistas Registrados ({filteredSubcontratistas.length})
            </h2>
            {selectedObra !== 'todas' && (
              <span className="text-xs text-blue-700 dark:text-blue-400 font-medium truncate ml-2">
                {selectedObra}
              </span>
            )}
          </div>

          {/* Focused Obra Progress Banner when filtering by specific obra */}
          {selectedObra !== 'todas' && (() => {
            const currentObraStat = obrasComplianceStats.find(o => o.obra === selectedObra);
            if (!currentObraStat) return null;
            return (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-2xs space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 truncate pr-2">
                    <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="truncate">Cumplimiento {currentObraStat.obra}</span>
                  </span>
                  <span className={`font-black text-xs px-2 py-0.5 rounded-full shrink-0 ${
                    currentObraStat.porcentaje === 100 ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300' :
                    currentObraStat.porcentaje >= 60 ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300' :
                    currentObraStat.porcentaje >= 30 ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300' :
                    'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                  }`}>
                    {currentObraStat.porcentaje}% ({currentObraStat.entregadosDocs}/{currentObraStat.totalDocs} docs)
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      currentObraStat.porcentaje === 100 ? 'bg-emerald-500' :
                      currentObraStat.porcentaje >= 60 ? 'bg-blue-600' :
                      currentObraStat.porcentaje >= 30 ? 'bg-amber-500' : 'bg-rose-500'
                    }`}
                    style={{ width: `${currentObraStat.porcentaje}%` }}
                  />
                </div>
              </div>
            );
          })()}

          {filteredSubcontratistas.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
              <Building2 className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No hay subcontratistas en esta obra</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 mb-4">
                Comience añadiendo una subcontrata para controlar su documentación obligatoria.
              </p>
              <button
                onClick={() => setIsNewModalOpen(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Registrar Subcontrata
              </button>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[750px] overflow-y-auto pr-1">
              {filteredSubcontratistas.map((sub, sIdx) => {
                const compliance = getSubcontrataCompliance(sub);
                const isSelected = selectedSubId === sub.id;

                let badgeColor = 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
                let badgeLabel = 'Pendiente';
                if (sub.estadoExpediente === 'apto') {
                  badgeColor = 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
                  badgeLabel = 'Autorizado (Apto)';
                } else if (sub.estadoExpediente === 'denegado') {
                  badgeColor = 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800';
                  badgeLabel = 'No Autorizado';
                } else if (sub.estadoExpediente === 'condicionado') {
                  badgeColor = 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
                  badgeLabel = 'Condicionado';
                }

                return (
                  <div
                    key={`sub_${sub.id}_${sIdx}`}
                    id={`sub-card-${sub.id}`}
                    onClick={() => setSelectedSubId(sub.id)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer text-left ${
                      isSelected
                        ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-500 dark:border-blue-500 shadow-xs ring-1 ring-blue-500'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug truncate" title={sub.nombreEmpresa}>
                          {sub.nombreEmpresa}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5 truncate">
                          CIF: {sub.cif} · {sub.actividadGremio}
                        </p>
                      </div>
                      <span className={`px-2 py-0.5 text-[11px] font-semibold border rounded-full shrink-0 ${badgeColor}`}>
                        {badgeLabel}
                      </span>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span className="truncate max-w-[170px]" title={sub.obra}>
                        📍 {sub.obra}
                      </span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {compliance.porcentaje}% ({compliance.entregados}/{compliance.total})
                      </span>
                    </div>

                    {/* Mini Progress Bar */}
                    <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full mt-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          compliance.porcentaje === 100
                            ? 'bg-emerald-500'
                            : compliance.porcentaje > 50
                            ? 'bg-amber-500'
                            : 'bg-rose-500'
                        }`}
                        style={{ width: `${compliance.porcentaje}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Detailed Checklist & AI Verification Panel */}
        <div className="lg:col-span-8 min-w-0">
          {activeSubcontrata ? (
            <div className="space-y-6">
              {/* Profile Card */}
              <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 truncate" title={activeSubcontrata.nombreEmpresa}>
                        {activeSubcontrata.nombreEmpresa}
                      </h2>
                      <span className="px-2.5 py-0.5 text-xs font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md border border-slate-200 dark:border-slate-700">
                        CIF: {activeSubcontrata.cif}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Obra: <strong className="text-slate-800 dark:text-slate-200">{activeSubcontrata.obra}</strong> · Gremio: <strong className="text-slate-800 dark:text-slate-200">{activeSubcontrata.actividadGremio}</strong>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      id="btn-generar-informe-pdf"
                      onClick={handleExportPDF}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
                      title="Generar informe de estado de la subcontrata en PDF con escudo de Diputación"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-300" />
                      <span>Informe estado subcontrata</span>
                    </button>
                    <button
                      id="btn-abrir-requerimiento"
                      onClick={() => setIsRequerimientoModalOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
                      title="Generar requerimiento formal de subsanación para enviar a la subcontrata"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Requerimiento subcontrata</span>
                    </button>
                    <button
                      onClick={() => handleDeleteSubcontrata(activeSubcontrata.id, activeSubcontrata.nombreEmpresa)}
                      className="p-2 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
                      title="Eliminar registro"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Subcontractor Metadata Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 text-xs">
                  <div>
                    <span className="text-slate-400 dark:text-slate-500 block">Supervisor Obra:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {activeSubcontrata.supervisorResponsable || 'No asignado'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 dark:text-slate-500 block">Recurso Preventivo:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {activeSubcontrata.recursoPreventivo || 'Pendiente designación'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 dark:text-slate-500 block">Fecha Inicio Prevista:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {activeSubcontrata.fechaInicioPrevista ? formatDate(activeSubcontrata.fechaInicioPrevista) : 'No definida'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 dark:text-slate-500 block">Personal Previsto:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {activeSubcontrata.numeroTrabajadoresPrevistos || 1} trabajadores
                    </span>
                  </div>
                </div>

                {/* Status Bar / Verdict Selector */}
                <div className="mt-5 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      Estado de Acceso a Obra:
                    </span>
                    <select
                      value={activeSubcontrata.estadoExpediente}
                      onChange={e => handleUpdateSubDetails(activeSubcontrata.id, 'estadoExpediente', e.target.value as SubcontrataEstadoExpediente)}
                      className={`text-xs font-bold px-3 py-1.5 rounded-lg border focus:outline-hidden cursor-pointer ${
                        activeSubcontrata.estadoExpediente === 'apto'
                          ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
                          : activeSubcontrata.estadoExpediente === 'denegado'
                          ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-700'
                          : activeSubcontrata.estadoExpediente === 'condicionado'
                          ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700'
                          : 'bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-200 border-blue-300 dark:border-blue-700'
                      }`}
                    >
                      <option value="apto">✓ AUTORIZADO (APTO PARA ENTRAR A OBRA)</option>
                      <option value="condicionado">⚠️ ACCESO CONDICIONADO A SUBSANACIÓN</option>
                      <option value="denegado">✕ DENEGADO / ACCESO NO PERMITIDO</option>
                      <option value="pendiente">⏳ PENDIENTE DE REVISIÓN DOCUMENTAL</option>
                    </select>
                  </div>

                  {(() => {
                    const comp = getSubcontrataCompliance(activeSubcontrata);
                    return (
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                          ✓ {comp.entregados} entregados
                        </span>
                        <span className="text-rose-700 dark:text-rose-400 font-semibold">
                          ✕ {comp.pendientes} pendientes
                        </span>
                        {comp.caducados > 0 && (
                          <span className="text-amber-700 dark:text-amber-400 font-semibold">
                            ⚠️ {comp.caducados} caducados
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* FileUploaderIA Component: Drag and drop PDFs, AI extraction against legal checklist, and red alert highlighting */}
              <FileUploaderIA
                subcontrata={activeSubcontrata}
                currentObraWorkers={activeObraWorkers}
                onChecklistUpdate={(updatedChecklist, newEstadoExpediente, summaryText) => {
                  setSubcontratistas(prev => prev.map(s => {
                    if (s.id !== activeSubcontrata.id) return s;
                    return {
                      ...s,
                      checklist: updatedChecklist,
                      estadoExpediente: newEstadoExpediente,
                      fechaActualizacion: new Date().toISOString()
                    };
                  }));
                  setAiAnalysisSummary(summaryText);
                }}
                onToast={onToast}
                onFilterMissingInRed={() => setChecklistStatusFilter('rojos')}
                onOpenRequerimiento={() => setIsRequerimientoModalOpen(true)}
              />

              {/* Checklist Legal Controls & Items */}
              <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <FileCheck className="w-5 h-5 text-blue-700 dark:text-blue-400 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                          Checklist Reglamentario Obligatorio
                        </h3>
                        <button
                          type="button"
                          onClick={() => setIsConfigModalOpen(true)}
                          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                          title="Definir o editar los documentos obligatorios del checklist legal (Seguro RC, TC1, Certificados de estar al corriente...)"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                          <span>Configurar Requisitos</span>
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {activeSubcontrata.checklist.filter(i => i.obligatorio && i.estado !== 'no_aplica').length} requisitos obligatorios para acceso a obra conforme a la Ley 32/2006 y RD 1627/1997.
                      </p>
                    </div>
                  </div>

                  {/* Filters by Category */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => setChecklistCategoryFilter('todos')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                        checklistCategoryFilter === 'todos'
                          ? 'bg-slate-800 dark:bg-blue-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      Todos ({activeSubcontrata.checklist.length})
                    </button>
                    <button
                      onClick={() => setChecklistCategoryFilter('empresa')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                        checklistCategoryFilter === 'empresa'
                          ? 'bg-slate-800 dark:bg-blue-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      1. Empresa ({activeSubcontrata.checklist.filter(i => i.categoria === 'empresa').length})
                    </button>
                    <button
                      onClick={() => setChecklistCategoryFilter('trabajadores')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                        checklistCategoryFilter === 'trabajadores'
                          ? 'bg-slate-800 dark:bg-blue-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      2. Personal ({activeSubcontrata.checklist.filter(i => i.categoria === 'trabajadores').length})
                    </button>
                    <button
                      onClick={() => setChecklistCategoryFilter('maquinaria')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                        checklistCategoryFilter === 'maquinaria'
                          ? 'bg-slate-800 dark:bg-blue-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      3. Maquinaria ({activeSubcontrata.checklist.filter(i => i.categoria === 'maquinaria').length})
                    </button>

                    <span className="text-slate-300 dark:text-slate-700 mx-1">|</span>

                    <button
                      onClick={() => setChecklistStatusFilter(checklistStatusFilter === 'rojos' ? 'todos' : 'rojos')}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors flex items-center gap-1 ${
                        checklistStatusFilter === 'rojos'
                          ? 'bg-rose-700 text-white'
                          : 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                      Ver Faltantes en Rojo
                    </button>
                  </div>
                </div>

                {/* Checklist items listing */}
                <div className="space-y-3">
                  {activeSubcontrata.checklist
                    .filter(item => {
                      if (checklistCategoryFilter !== 'todos' && item.categoria !== checklistCategoryFilter) return false;
                      if (checklistStatusFilter === 'rojos') {
                        return item.estado === 'pendiente' || item.estado === 'caducado' || item.estado === 'incompleto';
                      }
                      if (checklistStatusFilter === 'entregados') {
                        return item.estado === 'entregado';
                      }
                      return true;
                    })
                    .map((item, index) => {
                      const isDelivered = item.estado === 'entregado';
                      const isMissing = item.estado === 'pendiente';
                      const isExpiredOrDeficient = item.estado === 'caducado' || item.estado === 'incompleto';
                      const isNotApplicable = item.estado === 'no_aplica';

                      return (
                        <div
                          key={`doc_item_${item.id}_${index}`}
                          id={`doc-item-${item.id}`}
                          className={`p-4 rounded-xl border transition-all ${
                            isMissing
                              ? 'border-2 border-l-4 border-l-rose-600 bg-rose-50/70 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800/80 ring-1 ring-rose-300 dark:ring-rose-800/60 shadow-2xs'
                              : isExpiredOrDeficient
                              ? 'border-2 border-l-4 border-l-amber-500 bg-amber-50/70 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800/80 ring-1 ring-amber-300 dark:ring-amber-800/60 shadow-2xs'
                              : isDelivered
                              ? 'border border-l-4 border-l-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/80'
                              : 'bg-slate-50/60 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 opacity-60'
                          }`}
                        >
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                  #{index + 1}
                                </span>
                                <h4 className={`text-sm font-bold ${isMissing ? 'text-rose-950 dark:text-rose-200 font-black' : isExpiredOrDeficient ? 'text-amber-950 dark:text-amber-200 font-black' : 'text-slate-900 dark:text-slate-100'}`}>
                                  {item.nombre}
                                </h4>
                                {isMissing && (
                                  <span className="px-2 py-0.5 text-[10px] font-extrabold bg-rose-600 text-white rounded-md tracking-wider flex items-center gap-1 shadow-2xs">
                                    <X className="w-3 h-3" />
                                    FALTANTE (EN ROJO)
                                  </span>
                                )}
                                {isExpiredOrDeficient && (
                                  <span className="px-2 py-0.5 text-[10px] font-extrabold bg-amber-600 text-white rounded-md tracking-wider flex items-center gap-1 shadow-2xs">
                                    <AlertTriangle className="w-3 h-3" />
                                    CADUCADO / DEFICIENTE
                                  </span>
                                )}
                                {isDelivered && (
                                  <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 rounded-md flex items-center gap-1 border border-emerald-200 dark:border-emerald-800">
                                    <Check className="w-3 h-3 text-emerald-700 dark:text-emerald-400" />
                                    CONFORME
                                  </span>
                                )}
                                {item.obligatorio ? (
                                  <span className="px-2 py-0.5 text-[10px] font-bold bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 rounded-md border border-rose-200 dark:border-rose-800">
                                    OBLIGATORIO LEY
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md border border-slate-200 dark:border-slate-700">
                                    SI APLICA
                                  </span>
                                )}
                                {item.detectadoPorIA && (
                                  <span className="px-2 py-0.5 text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300 rounded-md flex items-center gap-1 border border-indigo-200 dark:border-indigo-800">
                                    <Sparkles className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                                    Verificado con IA
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {item.descripcion}
                              </p>
                              <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
                                ⚖️ {item.normativa}
                              </p>
                            </div>

                            {/* Status Selector Buttons */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleToggleStatus(activeSubcontrata.id, item.id, 'entregado')}
                                className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-all flex items-center gap-1 cursor-pointer ${
                                  isDelivered
                                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                    : 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50'
                                }`}
                                title="Marcar como entregado y conforme"
                              >
                                <Check className="w-3.5 h-3.5" />
                                Entregado
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleStatus(activeSubcontrata.id, item.id, 'pendiente')}
                                className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-all flex items-center gap-1 cursor-pointer ${
                                  isMissing
                                    ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                                    : 'bg-white dark:bg-slate-800 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50'
                                }`}
                                title="Marcar como pendiente / falta entregar"
                              >
                                <X className="w-3.5 h-3.5" />
                                Pendiente
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleStatus(activeSubcontrata.id, item.id, 'caducado')}
                                className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-all flex items-center gap-1 cursor-pointer ${
                                  isExpiredOrDeficient
                                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                                    : 'bg-white dark:bg-slate-800 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/50'
                                }`}
                                title="Marcar como caducado o incompleto"
                              >
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Caducado / Incidencia
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleStatus(activeSubcontrata.id, item.id, 'no_aplica')}
                                className={`px-2 py-1.5 text-xs font-medium rounded-lg border transition-all cursor-pointer ${
                                  isNotApplicable
                                    ? 'bg-slate-700 dark:bg-slate-600 text-white border-slate-700 dark:border-slate-600'
                                    : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750'
                                }`}
                                title="No aplica a los trabajos de esta subcontrata"
                              >
                                N/A
                              </button>
                            </div>
                          </div>

                          {/* Editable fields: dates and observations */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-800 text-xs">
                            <div>
                              <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block mb-1">
                                Fecha Entrega / Emisión:
                              </label>
                              <input
                                type="date"
                                value={item.fechaEntrega || ''}
                                onChange={e => handleUpdateChecklistItem(activeSubcontrata.id, item.id, { fechaEntrega: e.target.value })}
                                className="w-full px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block mb-1">
                                Fecha Caducidad / Vencimiento:
                              </label>
                              <input
                                type="date"
                                value={item.fechaCaducidad || ''}
                                onChange={e => handleUpdateChecklistItem(activeSubcontrata.id, item.id, { fechaCaducidad: e.target.value })}
                                className="w-full px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block mb-1">
                                Observaciones Técnicas / Incidencias:
                              </label>
                              <input
                                type="text"
                                placeholder="Ej: Válido hasta fin de mes, falta firma..."
                                value={item.observaciones || ''}
                                onChange={e => handleUpdateChecklistItem(activeSubcontrata.id, item.id, { observaciones: e.target.value })}
                                className="w-full px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-12 text-center">
              <HardHat className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">
                Seleccione una subcontrata del listado
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1">
                Elija una subcontrata en el panel lateral para revisar su checklist legal, cargar archivos con inteligencia artificial o generar el informe de estado de la subcontrata.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Nueva Subcontrata */}
      {isNewModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-xl w-full p-6 space-y-5 my-8 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 rounded-lg">
                  <HardHat className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Nueva Subcontrata de Obra
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Registro de empresa para control documental y CAE
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsNewModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubcontrata} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Razón Social de la Empresa Subcontratista *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Construcciones y Excavaciones García S.L."
                    value={newForm.nombreEmpresa}
                    onChange={e => setNewForm({ ...newForm, nombreEmpresa: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    CIF / NIF de la Empresa *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: B11234567"
                    value={newForm.cif}
                    onChange={e => setNewForm({ ...newForm, cif: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Obra de Destino *
                  </label>
                  <select
                    value={newForm.obra}
                    onChange={e => setNewForm({ ...newForm, obra: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-hidden bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    {allObrasList.map(o => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Gremio o Actividad a Desarrollar
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Albañilería, Cerrajería, Pintura..."
                    value={newForm.actividadGremio}
                    onChange={e => setNewForm({ ...newForm, actividadGremio: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Supervisor / Técnico Responsable
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: David Hinojo García"
                    value={newForm.supervisorResponsable}
                    onChange={e => setNewForm({ ...newForm, supervisorResponsable: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Persona de Contacto
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Juan Pérez"
                    value={newForm.personaContacto}
                    onChange={e => setNewForm({ ...newForm, personaContacto: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Teléfono de Contacto
                  </label>
                  <input
                    type="tel"
                    placeholder="Ej: 600 123 456"
                    value={newForm.telefono}
                    onChange={e => setNewForm({ ...newForm, telefono: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Fecha Prevista de Inicio
                  </label>
                  <input
                    type="date"
                    value={newForm.fechaInicioPrevista}
                    onChange={e => setNewForm({ ...newForm, fechaInicioPrevista: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Nº Operarios Previstos
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={newForm.numeroTrabajadoresPrevistos}
                    onChange={e => setNewForm({ ...newForm, numeroTrabajadoresPrevistos: parseInt(e.target.value, 10) || 1 })}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  Crear Subcontrata y Generar Checklist
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Requerimiento Formal Automático */}
      {isRequerimientoModalOpen && activeSubcontrata && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-2xl w-full p-6 space-y-5 my-8 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 rounded-lg">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Requerimiento Formal de Subsanación Documental
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Texto oficial generado automáticamente con la relación de documentación pendiente o caducada
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsRequerimientoModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative">
              <textarea
                readOnly
                rows={14}
                value={generateRequerimientoText(
                  activeSubcontrata,
                  activeSubcontrata.obra,
                  activeSubcontrata.supervisorResponsable || 'Supervisor Responsable'
                )}
                className="w-full p-4 font-mono text-xs text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl leading-relaxed focus:outline-hidden select-all"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                💡 Puede copiar el texto para remitirlo por correo electrónico o WhatsApp a la subcontrata.
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyRequerimiento}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  <Copy className="w-4 h-4" />
                  Copiar al Portapapeles
                </button>
                <button
                  onClick={() => setIsRequerimientoModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Configuración del Checklist Legal de Subcontratas */}
      <ChecklistConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        currentTemplate={activeSubcontrata ? activeSubcontrata.checklist : checklistTemplate}
        activeSubcontrataName={activeSubcontrata?.nombreEmpresa}
        totalSubcontratasCount={subcontratistas.length}
        onSaveTemplate={handleSaveChecklistTemplate}
        onToast={onToast}
      />

      {/* Modal: Gestión del Catálogo de Obras */}
      {isManageObrasModalOpen && (
        <div 
          id="modal-gestionar-obras"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-5 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 rounded-xl">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    Gestión de Obras PROFEA
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Añada nuevas obras, edite nombres o elimine obras del catálogo provincial.
                  </p>
                </div>
              </div>
              <button
                id="btn-close-gestionar-obras"
                onClick={() => setIsManageObrasModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Formulario para añadir nueva obra con Recurso Preventivo */}
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                handleAddNewObra();
              }}
              className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Añadir Nueva Obra al Catálogo
                </label>
                <span className="text-[11px] text-blue-700 dark:text-blue-400 font-medium">
                  Incluye Recurso Preventivo para el Reporte Técnico PDF
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-5">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Nombre de la Obra *
                  </label>
                  <input
                    id="input-nueva-obra-gestion"
                    type="text"
                    required
                    value={newObraInput}
                    onChange={(e) => setNewObraInput(e.target.value)}
                    placeholder="Ej: Obra PFEA Jerez de la Frontera"
                    className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-850 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="md:col-span-4">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Recurso Preventivo (Encargado) *
                  </label>
                  <input
                    id="input-nuevo-recurso-obra"
                    type="text"
                    required
                    value={newObraRecurso}
                    onChange={(e) => setNewObraRecurso(e.target.value)}
                    placeholder="Ej: Manuel Pérez Gómez"
                    className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-850 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Categoría del Puesto
                  </label>
                  <select
                    id="select-nueva-categoria-obra"
                    value={newObraCategoria}
                    onChange={(e) => setNewObraCategoria(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-850 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="Encargado de Obra">Encargado de Obra</option>
                    <option value="Capataz de Obra">Capataz de Obra</option>
                    <option value="Técnico Básico PRL (60h)">Técnico Básico PRL (60h)</option>
                    <option value="Oficial 1ª / Recurso Preventivo">Oficial 1ª / Recurso Preventivo</option>
                    <option value="Jefe de Obra">Jefe de Obra</option>
                    <option value="Personal Designado PRL">Personal Designado PRL</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  id="btn-confirmar-anadir-obra"
                  type="submit"
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Añadir Obra y Recurso</span>
                </button>
              </div>
            </form>

            {/* Listado de Obras registradas */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">
                <span>Obras Registradas ({allObrasList.length})</span>
                <span>Acciones</span>
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900">
                {allObrasList.map((obra) => {
                  const subsCount = subcontratistas.filter(s => s.obra === obra).length;
                  const stat = obrasComplianceStats.find(o => o.obra === obra);
                  const pct = stat ? stat.porcentaje : 0;
                  const recursoInfo = obrasRecursos[obra];
                  return (
                    <div 
                      key={obra}
                      className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0" />
                          <span className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate" title={obra}>
                            {obra}
                          </span>
                          <span className={`px-2 py-0.5 text-[10px] font-extrabold rounded-full border ${
                            pct === 100
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                              : pct >= 50
                              ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                              : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                          }`}>
                            {pct}% legal
                          </span>
                        </div>

                        {/* Recurso Preventivo y Subcontratas Info */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 ml-6 text-xs">
                          <span className="text-slate-500 dark:text-slate-400">
                            {subsCount} {subsCount === 1 ? 'subcontrata' : 'subcontratas'}
                          </span>
                          {recursoInfo?.recursoPreventivoNombre ? (
                            <span className="flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300">
                              <UserCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                              <span className="text-slate-900 dark:text-slate-100">{recursoInfo.recursoPreventivoNombre}</span>
                              <span className="text-slate-400 dark:text-slate-500">·</span>
                              <span className="px-1.5 py-0.5 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded font-medium">
                                {recursoInfo.recursoPreventivoCategoria || 'Encargado de Obra'}
                              </span>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 text-[11px]">
                              <AlertCircle className="w-3 h-3 shrink-0" />
                              <span>Sin recurso preventivo asignado</span>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setIsManageObrasModalOpen(false);
                            handleExportConsolidatedPDF(obra);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/70 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-lg transition-colors cursor-pointer"
                          title={`Descargar reporte técnico PDF de ${obra}`}
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Reporte</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEditObra(obra)}
                          className="p-2 text-slate-600 dark:text-slate-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-lg transition-colors cursor-pointer"
                          title={`Editar obra y recurso preventivo de "${obra}"`}
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenDeleteObra(obra)}
                          className="p-2 text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
                          title={`Eliminar obra "${obra}"`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsManageObrasModalOpen(false)}
                className="px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar Nombre de Obra y Recurso Preventivo */}
      {editingObraState && (
        <div 
          id="modal-editar-obra"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 rounded-lg">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Editar Obra y Recurso Preventivo
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Configuración de firmas y responsables para el Reporte Técnico PDF.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingObraState(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-md cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditObra} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Nombre de la Obra *
                </label>
                <input
                  id="input-editar-nombre-obra"
                  type="text"
                  required
                  value={editingObraState.newName}
                  onChange={(e) => setEditingObraState({ ...editingObraState, newName: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  ℹ️ El nuevo nombre se sincronizará automáticamente en el catálogo y en todas las subcontratas asociadas.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Nombre y Apellidos del Recurso Preventivo *
                </label>
                <input
                  id="input-editar-recurso-obra"
                  type="text"
                  required
                  placeholder="Ej: Manuel Pérez Gómez"
                  value={editingObraState.recurso}
                  onChange={(e) => setEditingObraState({ ...editingObraState, recurso: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Categoría del Puesto de Trabajo
                </label>
                <select
                  id="select-editar-categoria-obra"
                  value={editingObraState.categoria}
                  onChange={(e) => setEditingObraState({ ...editingObraState, categoria: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                >
                  <option value="Encargado de Obra">Encargado de Obra</option>
                  <option value="Capataz de Obra">Capataz de Obra</option>
                  <option value="Técnico Básico PRL (60h)">Técnico Básico PRL (60h)</option>
                  <option value="Oficial 1ª / Recurso Preventivo">Oficial 1ª / Recurso Preventivo</option>
                  <option value="Jefe de Obra">Jefe de Obra</option>
                  <option value="Personal Designado PRL">Personal Designado PRL</option>
                </select>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                  ℹ️ Figura en la casilla de firma "RECURSO PREVENTIVO DE LA OBRA" del Reporte Técnico PDF.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingObraState(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  id="btn-guardar-edicion-obra"
                  type="submit"
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Guardar Cambios</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirmación de Eliminación de Obra */}
      {deletingObraState && (
        <div 
          id="modal-eliminar-obra"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="p-2.5 bg-rose-50 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 rounded-xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  ¿Eliminar Obra "{deletingObraState.obraName}"?
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Esta acción retirará la obra del catálogo provincial de subcontratas.
                </p>
              </div>
            </div>

            {deletingObraState.subcontratasCount > 0 ? (
              <div className="space-y-4">
                <div className="p-3.5 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 rounded-xl text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                  <p className="font-bold mb-1">
                    ⚠️ Esta obra cuenta actualmente con {deletingObraState.subcontratasCount} {deletingObraState.subcontratasCount === 1 ? 'subcontrata registrada' : 'subcontratas registradas'}.
                  </p>
                  <p>
                    Para evitar pérdidas involuntarias de expedientes, seleccione cómo desea proceder:
                  </p>
                </div>

                <div className="space-y-2.5">
                  <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 cursor-pointer hover:bg-slate-100/70 dark:hover:bg-slate-800 transition-colors">
                    <input
                      type="radio"
                      name="delete-action"
                      checked={deletingObraState.action === 'reassign'}
                      onChange={() => setDeletingObraState({ ...deletingObraState, action: 'reassign' })}
                      className="mt-0.5 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="space-y-1.5 flex-1">
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100 block">
                        Reasignar subcontratas a otra obra existente
                      </span>
                      {deletingObraState.action === 'reassign' && (
                        <select
                          id="select-obra-reasignar"
                          value={deletingObraState.targetObra}
                          onChange={(e) => setDeletingObraState({ ...deletingObraState, targetObra: e.target.value })}
                          className="w-full text-xs p-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                        >
                          {allObrasList
                            .filter(o => o !== deletingObraState.obraName)
                            .map(o => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                        </select>
                      )}
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-xl border border-rose-200 dark:border-rose-800/80 bg-rose-50/40 dark:bg-rose-950/30 cursor-pointer hover:bg-rose-50/70 dark:hover:bg-rose-950/50 transition-colors">
                    <input
                      type="radio"
                      name="delete-action"
                      checked={deletingObraState.action === 'delete_all'}
                      onChange={() => setDeletingObraState({ ...deletingObraState, action: 'delete_all' })}
                      className="mt-0.5 text-rose-600 focus:ring-rose-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-rose-900 dark:text-rose-200 block">
                        Eliminar la obra y dar de baja sus {deletingObraState.subcontratasCount} subcontratas
                      </span>
                      <span className="text-[11px] text-rose-700 dark:text-rose-300">
                        Se borrarán los checklists y registros de expedientes de esta obra.
                      </span>
                    </div>
                  </label>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Esta obra no tiene subcontratas vinculadas. Puede eliminarse de forma segura sin afectar a ningún expediente.
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setDeletingObraState(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                id="btn-confirmar-eliminar-obra"
                type="button"
                onClick={handleConfirmDeleteObra}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Confirmar Eliminación</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Firmas y Datos Predeterminados del Reporte Técnico PDF */}
      {isFirmasModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 my-auto">
            {/* Header */}
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 rounded-xl">
                  <FileSignature className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    Firmas y Datos Predeterminados del Reporte Técnico PDF
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Configure el Técnico de Obra, Coordinador de Seguridad y Salud, Empresa de Coordinación y Supervisor de obra.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFirmasModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-6">
              <form
                id="form-firmas-reporte"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveStoredReporteTecnicoConfig(reporteConfig);
                  setIsFirmasModalOpen(false);
                  onToast('Configuración de firmas del Reporte Técnico guardada correctamente.', 'success');
                }}
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
              >
                {/* Nombre y Apellidos del Técnico de Obra */}
                <div className="p-4 rounded-xl border-2 border-blue-300 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-950/20 space-y-2">
                  <label className="flex items-center gap-2 text-xs font-bold text-blue-950 dark:text-blue-200 uppercase tracking-wider">
                    <UserCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    Nombre y Apellidos del Técnico de Obra *
                  </label>
                  <input
                    type="text"
                    required
                    value={reporteConfig.tecnicoNombre}
                    onChange={(e) => setReporteConfig({ ...reporteConfig, tecnicoNombre: e.target.value })}
                    placeholder="Ej: David Hinojo García"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-bold text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                    Este nombre se imprimirá en la casilla <strong>"Por el Técnico"</strong> en todos los Reportes Técnicos oficiales en PDF.
                  </p>
                </div>

                {/* Coordinador de Seguridad y Salud */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 space-y-2">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Coordinador de Seguridad y Salud (CSS)
                  </label>
                  <input
                    type="text"
                    required
                    value={reporteConfig.coordinadorNombre}
                    onChange={(e) => setReporteConfig({ ...reporteConfig, coordinadorNombre: e.target.value })}
                    placeholder="Ej: David Hinojo García"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                    Técnico competente responsable de la coordinación de seguridad y salud en fase de ejecución.
                  </p>
                </div>

                {/* Empresa de Coordinación */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 space-y-2">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    <Building2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    Empresa o Entidad de Coordinación
                  </label>
                  <input
                    type="text"
                    required
                    value={reporteConfig.empresaCoordinacion}
                    onChange={(e) => setReporteConfig({ ...reporteConfig, empresaCoordinacion: e.target.value })}
                    placeholder="Ej: Área de Cooperación - Excma. Diputación Provincial de Cádiz"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                    Razón social de la empresa o administración pública que se imprime junto al coordinador.
                  </p>
                </div>

                {/* Supervisor de obra */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 space-y-2">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    <Briefcase className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    Supervisor de obra
                  </label>
                  <input
                    type="text"
                    value={reporteConfig.supervisorNombre}
                    onChange={(e) => setReporteConfig({ ...reporteConfig, supervisorNombre: e.target.value })}
                    placeholder="Ej: David Hinojo García"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                    Nombre del Supervisor de obra que encabeza la primera casilla oficial en los informes.
                  </p>
                </div>
              </form>

              {/* Live Signature Preview */}
              <div className="border-t border-slate-200 dark:border-slate-800 pt-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <Eye className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    Vista Previa de la Sección de Firmas (Reporte Técnico PDF)
                  </h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                    4 Casillas Oficiales
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-100/70 dark:bg-slate-950/50 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800">
                  {/* Box 1: Supervisor de obra */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg overflow-hidden flex flex-col justify-between shadow-2xs">
                    <div className="bg-[#1a365d] text-white text-[10px] font-extrabold px-2 py-1 text-center tracking-wider uppercase">
                      SUPERVISOR DE OBRA
                    </div>
                    <div className="h-14 flex items-center justify-center text-slate-300 dark:text-slate-600 text-xs italic">
                      [Espacio para Firma]
                    </div>
                    <div className="p-2 border-t border-slate-100 dark:border-slate-800 text-center bg-slate-50/50 dark:bg-slate-800/30">
                      <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 block truncate">
                        Fdo: {reporteConfig.supervisorNombre || 'David Hinojo García'}
                      </span>
                      <span className="text-[9px] text-slate-500 dark:text-slate-400 block truncate">
                        Supervisor de obra
                      </span>
                    </div>
                  </div>

                  {/* Box 2: Recurso Preventivo */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg overflow-hidden flex flex-col justify-between shadow-2xs">
                    <div className="bg-[#1a365d] text-white text-[10px] font-extrabold px-2 py-1 text-center tracking-wider uppercase">
                      RECURSO PREVENTIVO
                    </div>
                    <div className="h-14 flex items-center justify-center text-slate-300 dark:text-slate-600 text-xs italic">
                      [Espacio para Firma]
                    </div>
                    <div className="p-2 border-t border-slate-100 dark:border-slate-800 text-center bg-slate-50/50 dark:bg-slate-800/30">
                      <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 block truncate">
                        Fdo: [Recurso de cada Obra]
                      </span>
                      <span className="text-[9px] text-slate-500 dark:text-slate-400 block truncate">
                        Encargado de Obra
                      </span>
                    </div>
                  </div>

                  {/* Box 3: Por el Técnico */}
                  <div className="bg-white dark:bg-slate-900 border-2 border-blue-500 dark:border-blue-400 rounded-lg overflow-hidden flex flex-col justify-between shadow-xs">
                    <div className="bg-blue-700 text-white text-[10px] font-extrabold px-2 py-1 text-center tracking-wider uppercase flex items-center justify-center gap-1">
                      <UserCheck className="w-3 h-3" />
                      POR EL TÉCNICO
                    </div>
                    <div className="h-14 flex items-center justify-center text-slate-300 dark:text-slate-600 text-xs italic">
                      [Espacio para Firma]
                    </div>
                    <div className="p-2 border-t border-slate-100 dark:border-slate-800 text-center bg-blue-50/50 dark:bg-blue-950/40">
                      <span className="text-[11px] font-bold text-blue-900 dark:text-blue-200 block truncate">
                        Fdo: {reporteConfig.tecnicoNombre || 'David Hinojo García'}
                      </span>
                      <span className="text-[9px] text-blue-600 dark:text-blue-400 block truncate">
                        Técnico de Obra
                      </span>
                    </div>
                  </div>

                  {/* Box 4: Coordinador CSS */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg overflow-hidden flex flex-col justify-between shadow-2xs">
                    <div className="bg-[#1a365d] text-white text-[10px] font-extrabold px-2 py-1 text-center tracking-wider uppercase">
                      COORDINACIÓN SEG. Y SALUD
                    </div>
                    <div className="h-14 flex items-center justify-center text-slate-300 dark:text-slate-600 text-xs italic">
                      [Espacio para Firma]
                    </div>
                    <div className="p-2 border-t border-slate-100 dark:border-slate-800 text-center bg-slate-50/50 dark:bg-slate-800/30">
                      <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 block truncate">
                        Fdo: {reporteConfig.coordinadorNombre || 'David Hinojo García'}
                      </span>
                      <span className="text-[9px] text-slate-500 dark:text-slate-400 block truncate">
                        Coordinador CSS
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsFirmasModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                form="form-firmas-reporte"
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Guardar Configuración</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
