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
