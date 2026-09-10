import React, { useState, useRef, useCallback } from 'react';
import { 
  UploadCloud, FileText, Sparkles, CheckCircle2, AlertTriangle, 
  XCircle, RefreshCw, X, FileCheck, ShieldAlert, ArrowRight,
  Clock, Check, AlertCircle, Eye, Trash2, Users, UserCheck, 
  UserX, Calendar, ShieldCheck, HelpCircle, Info, ExternalLink,
  ChevronRight, BadgeAlert, ScanLine, RotateCcw, FileWarning
} from 'lucide-react';
import { 
  Subcontratista, 
  SubcontrataDocItem, 
  SubcontrataDocEstado, 
  SubcontrataEstadoExpediente, 
  SubcontrataDocAnalysisResult,
  Person,
  WorkerObraComparisonSummary,
  WorkerComparisonItem,
  DocumentoIlegibleAlerta
} from '../types';
import { getSubcontrataCompliance } from '../src/lib/subcontratasDefaults';
import { ChecklistReviewModal, ProposedChecklistChange } from './ChecklistReviewModal';
import { notifyDatabaseSync } from '../src/lib/syncNotifier';

interface FileUploaderIAProps {
  subcontrata: Subcontratista;
  currentObraWorkers?: Person[];
  onChecklistUpdate: (
    updatedChecklist: SubcontrataDocItem[],
    newEstadoExpediente: SubcontrataEstadoExpediente,
    summaryText: string
  ) => void;
  onToast: (message: string, type: 'success' | 'error') => void;
  onFilterMissingInRed?: () => void;
  onOpenRequerimiento?: () => void;
}

export const FileUploaderIA: React.FC<FileUploaderIAProps> = ({
  subcontrata,
  currentObraWorkers = [],
  onChecklistUpdate,
  onToast,
  onFilterMissingInRed,
  onOpenRequerimiento
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<string>('');
  const [activeResultTab, setActiveResultTab] = useState<'resumen' | 'caducidades' | 'operarios' | 'legibilidad'>('resumen');
  
  const [lastAnalysisResults, setLastAnalysisResults] = useState<{
    resumen: string;
    veredicto: 'APTO' | 'DENEGADO' | 'CONDICIONADO';
    faltantes: string[];
    analizados: SubcontrataDocAnalysisResult[];
    comparativaTrabajadores?: WorkerObraComparisonSummary;
    alertasCaducidad?: string[];
    documentosIlegibles?: DocumentoIlegibleAlerta[];
  } | null>(null);

  // Review & Confirmation Modal States
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [proposedChanges, setProposedChanges] = useState<ProposedChecklistChange[]>([]);
  const [pendingAnalysisData, setPendingAnalysisData] = useState<any>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag and Drop handlers
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  }, [isDragging]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = (Array.from(e.dataTransfer.files) as File[]).filter(file => {
      const name = file.name.toLowerCase();
      return file.type === 'application/pdf' || 
             name.endsWith('.pdf') ||
             file.type.startsWith('image/') ||
             name.endsWith('.png') ||
             name.endsWith('.jpg') ||
             name.endsWith('.jpeg') ||
             name.endsWith('.docx') ||
             name.endsWith('.doc') ||
             name.endsWith('.xlsx') ||
             name.endsWith('.xls');
    });

    if (droppedFiles.length === 0) {
      onToast('Por favor, arrastre archivos en formato PDF, Word (.docx/.doc), Excel (.xlsx/.xls) o imágenes.', 'error');
      return;
    }

    setSelectedFiles(prev => {
      const existingNames = new Set(prev.map((f: File) => f.name));
      const newUnique = droppedFiles.filter(f => !existingNames.has(f.name));
      return [...prev, ...newUnique];
    });

    onToast(`${droppedFiles.length} documento(s) listos para análisis.`, 'success');
  }, [onToast]);

  const handleManualFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const added = Array.from(e.target.files) as File[];
      setSelectedFiles(prev => {
        const existingNames = new Set(prev.map((f: File) => f.name));
        const newUnique = added.filter(f => !existingNames.has(f.name));
        return [...prev, ...newUnique];
      });
      onToast(`${added.length} documento(s) añadidos a la cola.`, 'success');
    }
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleClearAllFiles = () => {
    setSelectedFiles([]);
  };

  // Convert files to base64 and execute AI verification
  const handleExecuteAIAnalysis = async () => {
    if (selectedFiles.length === 0) {
      onToast('Seleccione o arrastre al menos un documento PDF para cotejar.', 'error');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisProgress('Leyendo y convirtiendo documentos PDF...');
    setLastAnalysisResults(null);

    try {
      // Convert all files to base64
      const filePromises = selectedFiles.map(file => {
        return new Promise<{ name: string; type: string; base64: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve({
              name: file.name,
              type: file.type || 'application/pdf',
              base64: reader.result as string
            });
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      });

      const convertedFiles = await Promise.all(filePromises);

      setAnalysisProgress('Analizando documentos con IA y aplicando validación estricta de caducidades...');

      const response = await fetch('/api/analyze-subcontractor-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: convertedFiles,
          subcontrata: {
            nombreEmpresa: subcontrata.nombreEmpresa,
            cif: subcontrata.cif,
            obra: subcontrata.obra,
            supervisorResponsable: subcontrata.supervisorResponsable
          },
          currentChecklist: subcontrata.checklist,
          currentObraWorkers: (currentObraWorkers || []).map(w => ({
            id: w.id,
            name: w.name,
            apellidosNombre: w.name,
            dni: w.dni,
            category: w.category,
            role: w.role,
            obra: w.obra
          })),
          trabajadoresEmpresaPrincipal: (currentObraWorkers || []).map(w => ({
            id: w.id,
            name: w.name,
            apellidosNombre: w.name,
            dni: w.dni,
            categoria: w.category,
            role: w.role,
            obra: w.obra
          }))
        })
      });

      if (!response.ok) {
        throw new Error(`Error en el servidor de verificación (${response.status})`);
      }

      setAnalysisProgress('Cotejando operarios detectados contra la lista de la obra y evaluando vigencias...');

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'No se pudo completar el análisis de los documentos.');
      }

      // Match recognized documents against the legal checklist and prepare proposal
      const analyzedDocs: SubcontrataDocAnalysisResult[] = data.documentosAnalizados || [];
      const illegibleDocs: DocumentoIlegibleAlerta[] = data.documentosIlegibles || [];
      const proposedList: ProposedChecklistChange[] = [];

      analyzedDocs.forEach((doc) => {
        const item = subcontrata.checklist.find(i => i.id === doc.docId);
        if (item) {
          let finalEstado: SubcontrataDocEstado = doc.estaCaducado ? 'caducado' : (doc.estado || 'entregado');
          if (doc.esLegible === false || doc.solicitarReintento) {
            finalEstado = 'incompleto';
          }

          let observaciones = '';
          if (doc.estaCaducado) {
            observaciones = `[INCIDENCIA / CADUCADO]: ${doc.motivoCaducidad || 'Documento vencido según normativa'}. Archivo: '${doc.archivoOrigen || ''}'. Requiere subsanación o renovación urgente.`;
          } else if (doc.esLegible === false || doc.solicitarReintento) {
            observaciones = `[INCIDENCIA / ILEGIBLE]: ${doc.motivoIlegible || 'Documento ilegible o con datos incompletos'}. Archivo: '${doc.archivoOrigen || ''}'. Requiere subsanación.`;
          } else if (doc.esProximaCaducidad) {
            observaciones = `[PRÓXIMA CADUCIDAD]: ${doc.motivoCaducidad || 'Vence en menos de 30 días'}. Archivo: '${doc.archivoOrigen || ''}'.`;
          } else {
            observaciones = doc.observaciones || `[VERIFICADO CONFORME]: Documento en vigor y conforme a normativa. Archivo: '${doc.archivoOrigen || ''}'.`;
          }

          const fechaEntrega = doc.fechaEmision || item.fechaEntrega || new Date().toISOString().slice(0, 10);
          const fechaCaducidad = doc.fechaCaducidad || item.fechaCaducidad || '';

          let validezText = 'Verificado por IA';
          if (doc.esLegible === false || doc.solicitarReintento) {
            validezText = 'ILEGIBLE / SOLICITAR REINTENTO';
          } else if (doc.estaCaducado) {
            validezText = `CADUCADO (Vencido hace ${doc.diasCaducado ?? 0} días)`;
          } else if (doc.esProximaCaducidad) {
            validezText = `PRÓXIMA CADUCIDAD (${doc.diasRestantes ?? 0} días restantes)`;
          } else if (doc.confianza) {
            validezText = `Cotejado por IA (${doc.confianza})`;
          }

          proposedList.push({
            docId: item.id,
            nombre: item.nombre,
            categoria: item.categoria,
            normativa: item.normativa,
            obligatorio: item.obligatorio,
            estadoActual: item.estado,
            estadoPropuesto: finalEstado,
            fechaEntregaActual: item.fechaEntrega,
            fechaEntregaPropuesta: fechaEntrega,
            fechaCaducidadActual: item.fechaCaducidad,
            fechaCaducidadPropuesta: fechaCaducidad,
            observacionesActuales: item.observaciones,
            observacionesPropuestas: observaciones,
            archivoOrigen: doc.archivoOrigen,
            estaCaducado: doc.estaCaducado,
            diasCaducado: doc.diasCaducado,
            diasRestantes: doc.diasRestantes,
            esProximaCaducidad: doc.esProximaCaducidad,
            motivoCaducidad: doc.motivoCaducidad,
            motivoIlegible: doc.motivoIlegible,
            esLegible: doc.esLegible !== undefined ? doc.esLegible : true,
            validezIA: validezText,
            confianza: doc.confianza,
            selected: true
          });
        }
      });

      // Update diagnostic display tabs
      setLastAnalysisResults({
        resumen: data.resumenDiagnostico || 'Cotejo documental completado con éxito.',
        veredicto: data.veredictoAcceso || 'CONDICIONADO',
        faltantes: data.relacionFaltantes || [],
        analizados: analyzedDocs,
        comparativaTrabajadores: data.comparativaTrabajadores,
        alertasCaducidad: data.alertasCaducidad,
        documentosIlegibles: illegibleDocs
      });

      // Select diagnostic tab based on issues found
      if (illegibleDocs.length > 0) {
        setActiveResultTab('legibilidad');
      } else if (data.comparativaTrabajadores && data.comparativaTrabajadores.noRegistradosEnObra?.length > 0) {
        setActiveResultTab('operarios');
      } else if (proposedList.some(p => p.estaCaducado)) {
        setActiveResultTab('caducidades');
      } else {
        setActiveResultTab('resumen');
      }

      // Check if we have proposed changes to show for user review
      if (proposedList.length > 0) {
        setProposedChanges(proposedList);
        setPendingAnalysisData(data);
        setIsReviewModalOpen(true);
        onToast(`Análisis completado: Revisa los cambios propuestos en el checklist para ${subcontrata.nombreEmpresa}.`, 'success');
      } else {
        onToast('Análisis finalizado, pero no se identificaron documentos aplicables al checklist legal.', 'error');
      }
    } catch (err: any) {
      console.error('Error during AI verification:', err);
      onToast(err.message || 'Error al cotejar los documentos con IA.', 'error');
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress('');
    }
  };

  const handleApplyReviewedChanges = (confirmedChanges: ProposedChecklistChange[]) => {
    if (confirmedChanges.length === 0) {
      setIsReviewModalOpen(false);
      onToast('No se aplicó ningún cambio al checklist.', 'error');
      return;
    }

    const updatedChecklist = subcontrata.checklist.map(item => {
      const confirmed = confirmedChanges.find(c => c.docId === item.id);
      if (!confirmed) return item;

      return {
        ...item,
        estado: confirmed.estadoPropuesto,
        fechaEntrega: confirmed.fechaEntregaPropuesta || item.fechaEntrega || new Date().toISOString().slice(0, 10),
        fechaCaducidad: confirmed.fechaCaducidadPropuesta || item.fechaCaducidad,
        observaciones: confirmed.observacionesPropuestas || item.observaciones,
        detectadoPorIA: true,
        validezIA: confirmed.validezIA || (confirmed.estadoPropuesto === 'caducado' ? 'CADUCADO' : 'Verificado por IA'),
        esLegible: confirmed.esLegible !== undefined ? confirmed.esLegible : true,
        solicitarReintento: !!(confirmed.estadoPropuesto === 'incompleto' || confirmed.esLegible === false)
      };
    });

    // Recalculate status
    const tempSub = { ...subcontrata, checklist: updatedChecklist };
    const comp = getSubcontrataCompliance(tempSub);

    const hasExpiredOrIncomplete = updatedChecklist.some(
      it => it.obligatorio && (it.estado === 'caducado' || it.estado === 'incompleto' || it.estado === 'pendiente')
    );

    const newEstadoExpediente: SubcontrataEstadoExpediente = hasExpiredOrIncomplete
      ? (pendingAnalysisData?.veredictoAcceso === 'DENEGADO' ? 'denegado' : 'condicionado')
      : (comp.estadoSugerido || 'apto');

    // Save to parent and trigger auto-sync
    onChecklistUpdate(
      updatedChecklist,
      newEstadoExpediente,
      pendingAnalysisData?.resumenDiagnostico || 'Cotejo y cambios confirmados por el usuario.'
    );

    setIsReviewModalOpen(false);
    setSelectedFiles([]); // Clear queue upon successful apply
    onToast(`Checklist de ${subcontrata.nombreEmpresa} actualizado con ${confirmedChanges.length} documento(s).`, 'success');
  };

  const expiredDocsCount = lastAnalysisResults?.analizados.filter(d => d.estaCaducado).length || 0;
  const unauthorizedWorkersCount = lastAnalysisResults?.comparativaTrabajadores?.noRegistradosEnObra.length || 0;

  return (
    <div id="file-uploader-ia-root" className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 p-5 text-white">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 backdrop-blur-md rounded-lg border border-white/20">
              <Sparkles className="w-5 h-5 text-amber-300 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold tracking-tight">
                  Verificador Inteligente de Documentación (CAE con IA)
                </h3>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-400 text-slate-950 rounded-full">
                  Ley 32/2006 & RD 1627/97
                </span>
              </div>
              <p className="text-xs text-blue-100/90 mt-0.5">
                Arrastre PDFs para extraer datos, validar vigencias reales (TGSS, AEAT, REA) y comparar automáticamente la lista de operarios contra la obra actual.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Drag and Drop Area */}
      <div className="p-5 space-y-4">
        <div
          id="drop-zone-pdf-ia"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200 ${
            isDragging
              ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/40 scale-[1.008] shadow-md'
              : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            multiple
            accept=".pdf,application/pdf,image/*,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,application/vnd.ms-excel"
            onChange={handleManualFileInput}
            className="hidden"
          />

          <div className="flex flex-col items-center justify-center space-y-2">
            <div className={`p-3 rounded-full transition-transform ${isDragging ? 'bg-indigo-600 text-white scale-110' : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400'}`}>
              <UploadCloud className="w-7 h-7" />
            </div>

            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                {isDragging ? '¡Suelte los documentos aquí!' : 'Arrastre y suelte los documentos de la subcontrata aquí'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                o haga clic para <span className="text-indigo-600 dark:text-indigo-400 font-semibold underline">explorar sus archivos</span> (PDF, Word, Excel o imágenes escaneadas)
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-700 dark:text-slate-300">✓ PDF, Word & Excel</span>
              <span>•</span>
              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-700 dark:text-slate-300">✓ REA (3 años)</span>
              <span>•</span>
              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-700 dark:text-slate-300">✓ Altas SS / ITA</span>
              <span>•</span>
              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-700 dark:text-slate-300">✓ TGSS (3 meses)</span>
              <span>•</span>
              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-700 dark:text-slate-300">✓ AEAT (1 año)</span>
              <span>•</span>
              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-700 dark:text-slate-300">✓ Aptitud Médica (1 año)</span>
              <span>•</span>
              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-700 dark:text-slate-300">✓ Filtro Anti-Personal Propio</span>
            </div>
          </div>
        </div>

        {/* Selected Files Staging Area */}
        {selectedFiles.length > 0 && (
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Documentos Preparados para Análisis ({selectedFiles.length})
              </span>
              <button
                onClick={handleClearAllFiles}
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpiar lista
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
              {selectedFiles.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  className="flex items-center justify-between gap-2 p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 text-xs shadow-2xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileText className="w-4 h-4 text-rose-500 shrink-0" />
                    <span className="truncate font-medium text-slate-700 dark:text-slate-300" title={file.name}>
                      {file.name}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveFile(idx);
                    }}
                    className="text-slate-400 hover:text-rose-600 p-0.5 rounded transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                La IA comprobará validez de fechas legales y cotejará la lista de operarios con la obra '{subcontrata.obra}'.
              </span>

              <button
                id="btn-ejecutar-analisis-ia"
                onClick={handleExecuteAIAnalysis}
                disabled={isAnalyzing}
                className="w-full sm:w-auto px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-bold rounded-lg shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isAnalyzing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                    <span>Analizando y Cotejando...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <span>Verificar Documentos contra el Checklist Legal</span>
                  </>
                )}
              </button>
            </div>

            {isAnalyzing && analysisProgress && (
              <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 rounded-lg flex items-center gap-3 text-xs text-indigo-950 dark:text-indigo-200 animate-pulse">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-600 shrink-0" />
                <span className="font-medium">{analysisProgress}</span>
              </div>
            )}
          </div>
        )}

        {/* Real-Time Highlight Section: AI Diagnostic Results & Comparative Reports */}
        {lastAnalysisResults && (
          <div className="space-y-4 pt-2">
            {/* Main AI Verdict Alert */}
            <div className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 ${
              lastAnalysisResults.veredicto === 'APTO'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200'
                : lastAnalysisResults.veredicto === 'DENEGADO'
                ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-950 dark:text-rose-200'
                : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-200'
            }`}>
              <div className="flex items-start gap-3">
                {lastAnalysisResults.veredicto === 'APTO' ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                ) : lastAnalysisResults.veredicto === 'DENEGADO' ? (
                  <XCircle className="w-6 h-6 text-rose-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider">
                      Veredicto CAE de Acceso a Obra:
                    </span>
                    <strong className="text-sm uppercase font-black tracking-wide">
                      {lastAnalysisResults.veredicto === 'APTO'
                        ? 'AUTORIZADO (APTO)'
                        : lastAnalysisResults.veredicto === 'DENEGADO'
                        ? 'DENEGADO / ACCESO PROHIBIDO'
                        : 'CONDICIONADO A SUBSANACIÓN'}
                    </strong>
                  </div>
                  <p className="text-xs mt-1 leading-relaxed text-slate-800 dark:text-slate-200 font-normal">
                    {lastAnalysisResults.resumen}
                  </p>
                </div>
              </div>

              {lastAnalysisResults.veredicto !== 'APTO' && onOpenRequerimiento && (
                <button
                  onClick={onOpenRequerimiento}
                  className="px-3 py-1.5 bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold rounded-lg shrink-0 transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>Redactar Requerimiento Formal</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Banner for Illegible/Blurry Documents Alert */}
            {lastAnalysisResults.documentosIlegibles && lastAnalysisResults.documentosIlegibles.length > 0 && (
              <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-400 dark:border-amber-700 rounded-xl text-xs space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="text-sm font-black tracking-tight">
                      ALERTA DE CALIDAD: ARCHIVO NO LEGIBLE O BORROSO DETECTADO
                    </span>
                  </div>
                  <span className="px-2.5 py-0.5 bg-amber-600 text-white font-bold rounded-full text-[10px] uppercase shrink-0">
                    Reintento Solicitado por IA
                  </span>
                </div>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                  Se ha detectado que {lastAnalysisResults.documentosIlegibles.length} archivo(s) no presentan la resolución o nitidez suficiente para certificar las fechas de vigencia legal con nivel de confianza alto. Por normativa preventiva (RD 1627/1997), el documento queda marcado como incompleto y se solicita el reintento con una copia nítida o escaneo de alta resolución.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={() => setActiveResultTab('legibilidad')}
                    className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <ScanLine className="w-3.5 h-3.5" />
                    <span>Ver Incidencia y Solicitar Reintento</span>
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-slate-700 text-amber-900 dark:text-amber-200 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                    <span>Subir Documento de Sustitución</span>
                  </button>
                </div>
              </div>
            )}

            {/* Diagnostic Tabs */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
              <button
                onClick={() => setActiveResultTab('resumen')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeResultTab === 'resumen'
                    ? 'bg-slate-900 dark:bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <FileCheck className="w-3.5 h-3.5" />
                <span>Documentos Faltantes</span>
                {lastAnalysisResults.faltantes.length > 0 && (
                  <span className="px-1.5 py-0.2 bg-rose-500 text-white text-[10px] rounded-full">
                    {lastAnalysisResults.faltantes.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveResultTab('caducidades')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeResultTab === 'caducidades'
                    ? 'bg-slate-900 dark:bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Vigencias y Caducidades Reales</span>
                {expiredDocsCount > 0 && (
                  <span className="px-1.5 py-0.2 bg-rose-600 text-white text-[10px] rounded-full animate-pulse">
                    {expiredDocsCount} caducado(s)
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveResultTab('operarios')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeResultTab === 'operarios'
                    ? 'bg-slate-900 dark:bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Cotejo de Operarios vs Obra Actual</span>
                {unauthorizedWorkersCount > 0 ? (
                  <span className="px-1.5 py-0.2 bg-rose-600 text-white text-[10px] rounded-full animate-pulse">
                    {unauthorizedWorkersCount} no autorizado(s)
                  </span>
                ) : lastAnalysisResults.comparativaTrabajadores ? (
                  <span className="px-1.5 py-0.2 bg-emerald-600 text-white text-[10px] rounded-full">
                    ✓ Verificado
                  </span>
                ) : null}
              </button>

              <button
                onClick={() => setActiveResultTab('legibilidad')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeResultTab === 'legibilidad'
                    ? 'bg-slate-900 dark:bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <ScanLine className="w-3.5 h-3.5" />
                <span>Nitidez y Reintentos</span>
                {(lastAnalysisResults.documentosIlegibles?.length || 0) > 0 && (
                  <span className="px-1.5 py-0.2 bg-amber-600 text-white text-[10px] rounded-full animate-pulse">
                    {lastAnalysisResults.documentosIlegibles?.length} a reintentar
                  </span>
                )}
              </button>
            </div>

            {/* TAB 1: Resumen y Faltantes en ROJO */}
            {activeResultTab === 'resumen' && (
              <div className="space-y-3">
                {lastAnalysisResults.faltantes && lastAnalysisResults.faltantes.length > 0 ? (
                  <div className="bg-rose-50/90 dark:bg-rose-950/40 border-2 border-rose-400/80 dark:border-rose-800 rounded-xl p-4 text-xs space-y-2.5 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-rose-900 dark:text-rose-200 font-bold">
                        <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                        <span>
                          DOCUMENTACIÓN OBLIGATORIA AUSENTE O CADUCADA (RESALTADA EN ROJO):
                        </span>
                      </div>
                      {onFilterMissingInRed && (
                        <button
                          onClick={onFilterMissingInRed}
                          className="text-[11px] font-bold text-rose-700 dark:text-rose-300 hover:text-rose-900 dark:hover:text-rose-100 underline flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3 h-3" />
                          Filtrar Checklist a Faltantes
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                      {lastAnalysisResults.faltantes.map((docName, index) => (
                        <div
                          key={index}
                          className="flex items-start gap-2 p-2.5 bg-white/95 dark:bg-slate-900 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 shadow-2xs font-medium"
                        >
                          <span className="w-2 h-2 rounded-full bg-rose-600 dark:bg-rose-500 shrink-0 mt-1.5" />
                          <span className="leading-tight">{docName}</span>
                        </div>
                      ))}
                    </div>

                    <p className="text-[11px] text-rose-800 dark:text-rose-300 italic pt-1">
                      ⚠️ Estos documentos se han marcado automáticamente en rojo en el Checklist legal inferior para bloquear el acceso de la subcontrata hasta su subsanación.
                    </p>
                  </div>
                ) : (
                  <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div>
                      <p className="font-bold">¡Todos los documentos obligatorios reglamentarios han sido verificados!</p>
                      <p className="text-emerald-700 dark:text-emerald-300 mt-0.5">No se detectan ausencias en el Checklist legal para la actividad y obra declaradas.</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: Control Estricto de Caducidades Reales */}
            {activeResultTab === 'caducidades' && (
              <div className="space-y-3">
                {lastAnalysisResults.analizados.length > 0 ? (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                      <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-bold">
                        <Clock className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                        <span>Análisis Detallado de Vigencia Legal por Documento Aportado</span>
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Criterios: TGSS (3 meses) • AEAT (1 año) • REA (3 años) • Aptitud Médica (1 año)
                      </span>
                    </div>

                    <div className="space-y-2">
                      {lastAnalysisResults.analizados.map((doc, idx) => {
                        const isExpired = doc.estaCaducado;
                        const isSoon = doc.esProximaCaducidad;

                        return (
                          <div
                            key={idx}
                            className={`p-3 rounded-lg border flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                              isExpired
                                ? 'bg-rose-50/80 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-950 dark:text-rose-200'
                                : isSoon
                                ? 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-200'
                                : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                                  {doc.nombreDetectado || doc.docId}
                                </span>
                                {isExpired ? (
                                  <span className="px-2 py-0.5 bg-rose-600 text-white font-bold text-[10px] rounded-full uppercase">
                                    CADUCADO ({doc.diasCaducado} días vencido)
                                  </span>
                                ) : isSoon ? (
                                  <span className="px-2 py-0.5 bg-amber-500 text-white font-bold text-[10px] rounded-full uppercase">
                                    PRÓXIMA CADUCIDAD ({doc.diasRestantes} días)
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-emerald-600 text-white font-bold text-[10px] rounded-full uppercase">
                                    VIGENTE
                                  </span>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 dark:text-slate-400">
                                <span><strong>Archivo:</strong> {doc.archivoOrigen || 'N/D'}</span>
                                {doc.fechaEmision && (
                                  <span><strong>Emisión:</strong> {doc.fechaEmision}</span>
                                )}
                                {doc.fechaCaducidad && (
                                  <span><strong>Caducidad:</strong> {doc.fechaCaducidad}</span>
                                )}
                              </div>

                              {doc.motivoCaducidad && (
                                <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300 italic">
                                  ℹ️ {doc.motivoCaducidad}
                                </p>
                              )}
                            </div>

                            <div className="shrink-0 text-right">
                              <span className={`text-[10px] font-semibold px-2 py-1 rounded ${
                                isExpired ? 'bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                              }`}>
                                {isExpired ? 'No Apto para Acceso' : 'Válido para CAE'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                    No se dispone de análisis de vigencia documental todavía.
                  </p>
                )}
              </div>
            )}

            {/* TAB 3: Cotejo de Operarios vs Obra Actual */}
            {activeResultTab === 'operarios' && (
              <div className="space-y-3">
                {lastAnalysisResults.comparativaTrabajadores ? (
                  <div className="space-y-3">
                    {/* Comparative Summary Metrics */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-xl">
                        <span className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400 block">
                          Operarios de la Obra '{subcontrata.obra}'
                        </span>
                        <span className="text-xl font-black text-slate-800 dark:text-slate-100">
                          {lastAnalysisResults.comparativaTrabajadores.totalTrabajadoresObra}
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                          registrados en la base de datos
                        </span>
                      </div>

                      <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                        <span className="text-[11px] font-bold uppercase text-emerald-700 dark:text-emerald-400 block">
                          Operarios Acreditados y Coincidentes
                        </span>
                        <span className="text-xl font-black text-emerald-800 dark:text-emerald-200">
                          {lastAnalysisResults.comparativaTrabajadores.coincidentes.length}
                        </span>
                        <span className="text-[11px] text-emerald-700 dark:text-emerald-400 block mt-0.5">
                          reconocidos en la documentación
                        </span>
                      </div>

                      <div className={`p-3 rounded-xl border ${
                        lastAnalysisResults.comparativaTrabajadores.noRegistradosEnObra.length > 0
                          ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800'
                          : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-800'
                      }`}>
                        <span className={`text-[11px] font-bold uppercase block ${
                          lastAnalysisResults.comparativaTrabajadores.noRegistradosEnObra.length > 0
                            ? 'text-rose-700 dark:text-rose-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}>
                          Operarios No Registrados en la Obra
                        </span>
                        <span className={`text-xl font-black ${
                          lastAnalysisResults.comparativaTrabajadores.noRegistradosEnObra.length > 0
                            ? 'text-rose-800 dark:text-rose-200'
                            : 'text-slate-800 dark:text-slate-100'
                        }`}>
                          {lastAnalysisResults.comparativaTrabajadores.noRegistradosEnObra.length}
                        </span>
                        <span className={`text-[11px] block mt-0.5 ${
                          lastAnalysisResults.comparativaTrabajadores.noRegistradosEnObra.length > 0
                            ? 'text-rose-700 dark:text-rose-400 font-bold'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}>
                          {lastAnalysisResults.comparativaTrabajadores.noRegistradosEnObra.length > 0
                            ? '¡Acceso a obra Prohibido!'
                            : 'Sin anomalías externas'}
                        </span>
                      </div>
                    </div>

                    {/* CRITICAL ALERT: Company workers mistakenly recognized in subcontrata documentation */}
                    {((lastAnalysisResults.comparativaTrabajadores.trabajadoresEmpresaPrincipalDetectados && 
                       lastAnalysisResults.comparativaTrabajadores.trabajadoresEmpresaPrincipalDetectados.length > 0) ||
                      lastAnalysisResults.comparativaTrabajadores.noRegistradosEnObra.some(w => w.esTrabajadorEmpresaPrincipal || w.prohibidoEnSubcontrata)) && (
                      <div className="p-4 bg-red-100 dark:bg-red-950/80 border-2 border-red-600 dark:border-red-500 rounded-xl text-xs space-y-2.5 shadow-sm">
                        <div className="flex items-center gap-2 text-red-950 dark:text-red-100 font-black text-sm">
                          <ShieldAlert className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0" />
                          <span>⛔ PROHIBICIÓN TERMINANTE: PERSONAL PROPIO DE SU EMPRESA DETECTADO EN LA SUBCONTRATA</span>
                        </div>
                        <p className="text-red-900 dark:text-red-200 leading-relaxed font-medium">
                          La IA ha detectado trabajadores pertenecientes a la <strong>plantilla propia de la entidad principal contratante (PROFEA)</strong> en la documentación aportada. 
                          Por estricta directiva legal y normativa de contratación, <strong>los trabajadores de su propia empresa NO deben figurar en el control de subcontratas</strong>. Han sido excluidos y bloqueados de la acreditación de la subcontrata.
                        </p>
                        <div className="space-y-1.5 pt-1">
                          {(lastAnalysisResults.comparativaTrabajadores.trabajadoresEmpresaPrincipalDetectados || 
                            lastAnalysisResults.comparativaTrabajadores.noRegistradosEnObra.filter(w => w.esTrabajadorEmpresaPrincipal || w.prohibidoEnSubcontrata)
                          ).map((worker, index) => (
                            <div
                              key={index}
                              className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border-2 border-red-400 dark:border-red-700 flex items-center justify-between text-xs"
                            >
                              <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                  <span className="w-2.5 h-2.5 rounded-full bg-red-600 dark:bg-red-500" />
                                  <strong className="text-slate-900 dark:text-slate-100 font-bold text-sm">{worker.nombreDetectado}</strong>
                                  {(worker.dniDetectado || worker.dniEnObra) && (
                                    <span className="text-slate-600 dark:text-slate-400 font-mono font-semibold">DNI: {worker.dniDetectado || worker.dniEnObra}</span>
                                  )}
                                  {worker.archivoOrigen && (
                                    <span className="text-slate-400 dark:text-slate-500 text-[11px]">(Doc: {worker.archivoOrigen})</span>
                                  )}
                                </div>
                                <span className="text-red-700 dark:text-red-400 font-semibold text-[11px] mt-0.5">
                                  {worker.detalles || 'Trabajador de la plantilla propia PROFEA. Prohibida su inclusión en la subcontrata.'}
                                </span>
                              </div>
                              <span className="px-2.5 py-1 bg-red-600 text-white font-black text-[10px] rounded uppercase tracking-wide">
                                Prohibido en Subcontrata
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Alert for Unauthorized External Workers */}
                    {lastAnalysisResults.comparativaTrabajadores.noRegistradosEnObra.filter(w => !w.esTrabajadorEmpresaPrincipal && !w.prohibidoEnSubcontrata).length > 0 && (
                      <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-400 dark:border-rose-800 rounded-xl text-xs space-y-2">
                        <div className="flex items-center gap-2 text-rose-900 dark:text-rose-200 font-bold text-sm">
                          <UserX className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
                          <span>¡ALERTA CAE! OPERARIOS EXTERNOS NO AUTORIZADOS EN LA OBRA '{subcontrata.obra}':</span>
                        </div>
                        <p className="text-rose-800 dark:text-rose-300 leading-relaxed">
                          La IA ha identificado personas en los documentos aportados que no constan en la lista de trabajadores autorizados para esta obra. Por exigencia de la Ley 32/2006 y RD 1627/1997, estas personas <strong>tienen expresamente prohibido el acceso al centro de trabajo</strong> hasta ser inscritas en el libro de subcontratación y validadas por el Coordinador de Seguridad.
                        </p>

                        <div className="space-y-1.5 pt-1">
                          {lastAnalysisResults.comparativaTrabajadores.noRegistradosEnObra
                            .filter(w => !w.esTrabajadorEmpresaPrincipal && !w.prohibidoEnSubcontrata)
                            .map((worker, index) => (
                            <div
                              key={index}
                              className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-rose-300 dark:border-rose-800 flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-rose-600 dark:bg-rose-500" />
                                <strong className="text-slate-900 dark:text-slate-100 font-bold">{worker.nombreDetectado}</strong>
                                {worker.dniDetectado && (
                                  <span className="text-slate-500 dark:text-slate-400 font-mono">DNI: {worker.dniDetectado}</span>
                                )}
                                {worker.archivoOrigen && (
                                  <span className="text-slate-400 dark:text-slate-500 text-[11px]">(Doc: {worker.archivoOrigen})</span>
                                )}
                              </div>
                              <span className="px-2 py-0.5 bg-rose-600 text-white font-bold text-[10px] rounded uppercase">
                                No Autorizado
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Coincident Workers */}
                    {lastAnalysisResults.comparativaTrabajadores.coincidentes.length > 0 && (
                      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs space-y-2.5">
                        <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-bold">
                          <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          <span>Operarios Verificados y Acreditados en la Obra Actual</span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {lastAnalysisResults.comparativaTrabajadores.coincidentes.map((worker, index) => (
                            <div
                              key={index}
                              className="p-2.5 bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center justify-between"
                            >
                              <div>
                                <span className="font-bold text-slate-900 dark:text-slate-100 block">
                                  {worker.nombreEnObra || worker.nombreDetectado}
                                </span>
                                <span className="text-[11px] text-slate-600 dark:text-slate-400 block">
                                  DNI: {worker.dniEnObra || worker.dniDetectado || 'N/D'} • Categoría: {worker.categoriaEnObra || 'Operario'}
                                </span>
                                {worker.archivoOrigen && (
                                  <span className="text-[10px] text-emerald-800 dark:text-emerald-300 block mt-0.5">
                                    Verificado en: {worker.archivoOrigen}
                                  </span>
                                )}
                              </div>
                              <span className="px-2 py-0.5 bg-emerald-600 text-white font-bold text-[10px] rounded uppercase">
                                Autorizado
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Obra workers pending documentation */}
                    {lastAnalysisResults.comparativaTrabajadores.pendientesDeAcreditar && 
                     lastAnalysisResults.comparativaTrabajadores.pendientesDeAcreditar.length > 0 && (
                      <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs space-y-2">
                        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-bold">
                          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                          <span>Operarios de la obra pendientes de acreditar en los documentos subidos ({lastAnalysisResults.comparativaTrabajadores.pendientesDeAcreditar.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {lastAnalysisResults.comparativaTrabajadores.pendientesDeAcreditar.map((p, pIdx) => (
                            <span
                              key={`pend_operario_${p.id || ''}_${pIdx}`}
                              className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-slate-700 dark:text-slate-300 text-[11px]"
                            >
                              {p.apellidosNombre} ({p.dni || 'Sin DNI'}) - {p.categoria}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                    Cotejo de operarios no ejecutado todavía. Arrastre los PDFs del personal (ITA, Aptitudes Médicas) para comparar automáticamente.
                  </p>
                )}
              </div>
            )}

            {/* TAB 4: Legibilidad, Detección de Borrosidad y Solicitud de Reintentos */}
            {activeResultTab === 'legibilidad' && (
              <div className="space-y-3">
                {lastAnalysisResults.documentosIlegibles && lastAnalysisResults.documentosIlegibles.length > 0 ? (
                  <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-xl p-4 text-xs space-y-3 shadow-2xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                      <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-bold">
                        <ScanLine className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span>Documentos no legibles o con extracción de fechas sin confianza alta ({lastAnalysisResults.documentosIlegibles.length})</span>
                      </div>
                      <span className="text-[11px] text-amber-800 dark:text-amber-300 font-medium bg-amber-50 dark:bg-amber-950/60 px-2.5 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                        Criterio Legal: RD 1627/1997
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {lastAnalysisResults.documentosIlegibles.map((doc, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 rounded-xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/40 flex flex-col md:flex-row md:items-center justify-between gap-3 text-slate-900 dark:text-slate-100 shadow-2xs"
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <FileWarning className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                              <span className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                                {doc.archivo}
                              </span>
                              <span className="px-2 py-0.5 bg-amber-600 text-white font-black text-[10px] rounded-full uppercase">
                                ILEGIBLE / BORROSO
                              </span>
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                                (Confianza: {doc.confianza || 'baja'})
                              </span>
                            </div>

                            <p className="text-xs text-amber-950 dark:text-amber-200 font-medium">
                              <strong>Motivo detectado:</strong> {doc.motivo}
                            </p>

                            {doc.docRelacionado && (
                              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                                <strong>Checklist afectado:</strong> {doc.docRelacionado} (marcado como Incompleto / Reintento requerido)
                              </p>
                            )}

                            <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                              ℹ️ La IA no pudo certificar las fechas de validez con nivel de confianza alto debido a desenfoque o resolución insuficiente.
                            </p>
                          </div>

                          <div className="shrink-0 flex items-center gap-2">
                            <button
                              onClick={() => fileInputRef.current?.click()}
                              className="px-3.5 py-2 bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                              title="Subir un nuevo archivo escaneado con mayor resolución para sustituir este documento"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Reintentar con Copia Nítida</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed border border-slate-200 dark:border-slate-800">
                      <strong className="text-slate-800 dark:text-slate-200">Recomendaciones para el reintento documental:</strong>
                      <ul className="list-disc list-inside mt-1.5 space-y-0.5 text-slate-600 dark:text-slate-400">
                        <li>Suba el PDF electrónico original descargado de la sede oficial (Seguridad Social, Agencia Tributaria o Junta de Andalucía).</li>
                        <li>Si el documento proviene de escaneo físico, asegure una resolución mínima de 300 DPI y buena iluminación sin sombras.</li>
                        <li>Verifique que los dígitos numéricos del Código Seguro de Verificación (CSV) y las fechas de expedición no estén pixelados.</li>
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div>
                      <p className="font-bold">¡Todos los documentos cotejados presentan una nitidez adecuada!</p>
                      <p className="text-emerald-700 dark:text-emerald-300 mt-0.5">
                        La IA ha analizado el contenido y extraído las fechas de vigencia con confianza alta, sin detectar imágenes borrosas ni problemas de resolución.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirmation & Manual Review Modal for AI Proposed Checklist Changes */}
      <ChecklistReviewModal
        isOpen={isReviewModalOpen}
        subcontrata={subcontrata}
        proposedChanges={proposedChanges}
        onClose={() => {
          setIsReviewModalOpen(false);
          onToast('Cambios descartados. El checklist no ha sido modificado.', 'error');
        }}
        onApplyChanges={handleApplyReviewedChanges}
      />
    </div>
  );
};
