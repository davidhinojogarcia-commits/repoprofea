import React, { useCallback, useRef, useState } from 'react';
import {
  CheckCircle2,
  FileCheck,
  FileText,
  Info,
  RefreshCw,
  Sparkles,
  Trash2,
  UploadCloud,
  X
} from 'lucide-react';
import {
  Subcontratista,
  SubcontrataDocAnalysisResult,
  SubcontrataDocEstado,
  SubcontrataDocItem,
  SubcontrataEstadoExpediente
} from '../types';
import { getSubcontrataCompliance } from '../src/lib/subcontratasDefaults';
import { ChecklistReviewModal, ProposedChecklistChange } from './ChecklistReviewModal';
import { extractClientDocumentText } from '../src/lib/clientDocumentText';

interface FileUploaderIAProps {
  subcontrata: Subcontratista;
  onChecklistUpdate: (
    updatedChecklist: SubcontrataDocItem[],
    newEstadoExpediente: SubcontrataEstadoExpediente,
    summaryText: string
  ) => void;
  onToast: (message: string, type: 'success' | 'error') => void;
  onFilterMissingInRed?: () => void;
  onOpenRequerimiento?: () => void;
}

type ConvertedFile = {
  name: string;
  type: string;
  base64: string;
  extractedText: string;
  extractionSource: string;
};

const stateRank: Record<SubcontrataDocEstado, number> = {
  entregado: 5,
  no_aplica: 4,
  incompleto: 3,
  caducado: 2,
  pendiente: 1
};

const confidenceRank = (value?: string) => value === 'alta' ? 0.4 : value === 'media' ? 0.2 : 0;

export const FileUploaderIA: React.FC<FileUploaderIAProps> = ({
  subcontrata,
  onChecklistUpdate,
  onToast
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [proposedChanges, setProposedChanges] = useState<ProposedChecklistChange[]>([]);
  const [analysisSummary, setAnalysisSummary] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: File[]) => {
    const accepted = incoming.filter(file => {
      const name = file.name.toLowerCase();
      return file.type === 'application/pdf'
        || file.type.startsWith('image/')
        || name.endsWith('.pdf')
        || name.endsWith('.png')
        || name.endsWith('.jpg')
        || name.endsWith('.jpeg')
        || name.endsWith('.doc')
        || name.endsWith('.docx')
        || name.endsWith('.xls')
        || name.endsWith('.xlsx');
    });

    if (!accepted.length) {
      onToast('Seleccione archivos PDF, Word, Excel o imágenes.', 'error');
      return;
    }

    setSelectedFiles(previous => {
      const existing = new Set(previous.map(file => file.name));
      return [...previous, ...accepted.filter(file => !existing.has(file.name))];
    });
  }, [onToast]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    addFiles(Array.from(event.dataTransfer.files) as File[]);
  }, [addFiles]);

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) addFiles(Array.from(event.target.files) as File[]);
    event.target.value = '';
  };

  const convertFile = async (file: File): Promise<ConvertedFile> => {
    let extractedText = '';
    let extractionSource = 'none';
    try {
      const extracted = await extractClientDocumentText(
        file,
        message => setAnalysisProgress(`${file.name}: ${message}`)
      );
      extractedText = extracted.text;
      extractionSource = extracted.source;
    } catch (error) {
      console.warn(`[CAE] Extracción local no disponible para ${file.name}:`, error);
    }

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    return {
      name: file.name,
      type: file.type || 'application/octet-stream',
      base64,
      extractedText,
      extractionSource
    };
  };

  const analyzeFile = async (file: ConvertedFile) => {
    const response = await fetch('/api/analyze-subcontractor-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [file],
        subcontrata: {
          nombreEmpresa: subcontrata.nombreEmpresa,
          cif: subcontrata.cif,
          obra: subcontrata.obra,
          supervisorResponsable: subcontrata.supervisorResponsable
        },
        currentChecklist: subcontrata.checklist
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.error || `No se pudo analizar ${file.name}.`);
    }
    return data;
  };

  const buildProposal = (
    item: SubcontrataDocItem,
    doc: SubcontrataDocAnalysisResult
  ): ProposedChecklistChange => {
    let estado: SubcontrataDocEstado = doc.estaCaducado
      ? 'caducado'
      : (doc.estado || 'entregado');

    if (doc.esLegible === false || doc.solicitarReintento) estado = 'incompleto';

    let observaciones = String(doc.observaciones || '').trim();
    if (doc.estaCaducado) {
      observaciones = doc.motivoCaducidad || observaciones || 'Documento caducado.';
    } else if (doc.esLegible === false || doc.solicitarReintento) {
      observaciones = doc.motivoIlegible || observaciones || 'Documento incompleto o no legible.';
    } else if (doc.esProximaCaducidad) {
      observaciones = doc.motivoCaducidad || observaciones;
    }

    const validezIA = doc.estaCaducado
      ? `CADUCADO${doc.diasCaducado ? ` (${doc.diasCaducado} días)` : ''}`
      : doc.esLegible === false || doc.solicitarReintento
        ? 'REQUIERE REVISIÓN'
        : doc.esProximaCaducidad
          ? `PRÓXIMA CADUCIDAD${doc.diasRestantes != null ? ` (${doc.diasRestantes} días)` : ''}`
          : `VERIFICADO (${doc.confianza || 'media'})`;

    return {
      docId: item.id,
      nombre: item.nombre,
      categoria: item.categoria,
      normativa: item.normativa,
      obligatorio: item.obligatorio,
      estadoActual: item.estado,
      estadoPropuesto: estado,
      fechaEntregaActual: item.fechaEntrega,
      fechaEntregaPropuesta: doc.fechaEmision || item.fechaEntrega || '',
      fechaCaducidadActual: item.fechaCaducidad,
      fechaCaducidadPropuesta: doc.fechaCaducidad || item.fechaCaducidad || '',
      observacionesActuales: item.observaciones,
      observacionesPropuestas: observaciones || item.observaciones || '',
      archivoOrigen: doc.archivoOrigen || '',
      estaCaducado: doc.estaCaducado,
      diasCaducado: doc.diasCaducado,
      diasRestantes: doc.diasRestantes,
      esProximaCaducidad: doc.esProximaCaducidad,
      motivoCaducidad: doc.motivoCaducidad,
      motivoIlegible: doc.motivoIlegible,
      esLegible: doc.esLegible !== false,
      validezIA,
      confianza: doc.confianza,
      selected: true
    } as ProposedChecklistChange;
  };

  const handleExecuteAnalysis = async () => {
    if (!selectedFiles.length) {
      onToast('Seleccione al menos un documento para comprobar el checklist.', 'error');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisSummary('');

    try {
      const convertedFiles: ConvertedFile[] = [];
      for (let index = 0; index < selectedFiles.length; index += 1) {
        setAnalysisProgress(`Preparando ${index + 1}/${selectedFiles.length}: ${selectedFiles[index].name}`);
        convertedFiles.push(await convertFile(selectedFiles[index]));
      }

      const detectedDocuments: SubcontrataDocAnalysisResult[] = [];
      for (let index = 0; index < convertedFiles.length; index += 1) {
        const file = convertedFiles[index];
        setAnalysisProgress(`Comprobando checklist ${index + 1}/${convertedFiles.length}: ${file.name}`);
        const result = await analyzeFile(file);
        detectedDocuments.push(...(
          Array.isArray(result.documentosAnalizados)
            ? result.documentosAnalizados
            : []
        ));
      }

      const bestEvidence = new Map<string, SubcontrataDocAnalysisResult>();
      for (const doc of detectedDocuments) {
        if (!doc?.docId) continue;
        const previous = bestEvidence.get(doc.docId);
        const nextScore = (stateRank[doc.estado] || 0) + confidenceRank(doc.confianza);
        const previousScore = previous
          ? (stateRank[previous.estado] || 0) + confidenceRank(previous.confianza)
          : -1;
        if (!previous || nextScore > previousScore) bestEvidence.set(doc.docId, doc);
      }

      // El checklist configurado es la única fuente de verdad. Solo se crean propuestas
      // para puntos del checklist que tengan evidencia documental real en esta carga.
      const proposals = subcontrata.checklist.flatMap(item => {
        const evidence = bestEvidence.get(item.id);
        if (!evidence) return [];
        return [buildProposal(item, evidence)];
      });

      setProposedChanges(proposals);
      const summary = proposals.length
        ? `${convertedFiles.length} archivo(s) comprobados. Se ha encontrado evidencia para ${proposals.length} punto(s) del checklist. Los demás puntos permanecen sin cambios.`
        : `${convertedFiles.length} archivo(s) comprobados. No se ha encontrado evidencia suficiente para modificar ningún punto del checklist.`;
      setAnalysisSummary(summary);

      if (!proposals.length) {
        onToast('Análisis completado: no hay cambios que proponer al checklist.', 'success');
        return;
      }

      setIsReviewModalOpen(true);
      onToast(`Checklist analizado: ${proposals.length} punto(s) con evidencia preparados para revisión.`, 'success');
    } catch (error: any) {
      console.error('[CAE checklist]', error);
      onToast(error?.message || 'Error al comprobar los documentos contra el checklist.', 'error');
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress('');
    }
  };

  const handleApplyReviewedChanges = (confirmedChanges: ProposedChecklistChange[]) => {
    if (!confirmedChanges.length) {
      setIsReviewModalOpen(false);
      onToast('No se aplicó ningún cambio al checklist.', 'error');
      return;
    }

    const updatedChecklist = subcontrata.checklist.map(item => {
      const confirmed = confirmedChanges.find(change => change.docId === item.id);
      if (!confirmed) return item;

      return {
        ...item,
        estado: confirmed.estadoPropuesto,
        fechaEntrega: confirmed.fechaEntregaPropuesta || item.fechaEntrega,
        fechaCaducidad: confirmed.fechaCaducidadPropuesta || item.fechaCaducidad,
        observaciones: confirmed.observacionesPropuestas || item.observaciones,
        detectadoPorIA: !!confirmed.archivoOrigen,
        validezIA: confirmed.validezIA || (
          confirmed.estadoPropuesto === 'caducado'
            ? 'CADUCADO'
            : confirmed.estadoPropuesto === 'pendiente'
              ? 'PENDIENTE'
              : 'VERIFICADO'
        ),
        esLegible: confirmed.esLegible !== undefined ? confirmed.esLegible : true,
        solicitarReintento: confirmed.estadoPropuesto === 'incompleto' || confirmed.esLegible === false
      };
    });

    const compliance = getSubcontrataCompliance({ ...subcontrata, checklist: updatedChecklist });
    const hasBlockingIssues = updatedChecklist.some(item =>
      item.obligatorio && ['pendiente', 'caducado', 'incompleto'].includes(item.estado)
    );
    const newEstado: SubcontrataEstadoExpediente = hasBlockingIssues
      ? 'condicionado'
      : (compliance.estadoSugerido || 'apto');

    onChecklistUpdate(
      updatedChecklist,
      newEstado,
      analysisSummary || `Checklist actualizado con ${confirmedChanges.length} evidencia(s) confirmada(s).`
    );

    setIsReviewModalOpen(false);
    setSelectedFiles([]);
    setProposedChanges([]);
    onToast(`Se han aplicado ${confirmedChanges.length} cambio(s) confirmados al checklist.`, 'success');
  };

  return (
    <div id="file-uploader-ia-root" className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 p-5 text-white">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/10 rounded-lg border border-white/20">
            <FileCheck className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <h3 className="text-base font-bold">Comprobación documental del checklist</h3>
            <p className="text-xs text-blue-100/90 mt-0.5">
              Los documentos se cotejan exclusivamente contra los puntos configurados en el checklist.
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            El OCR/IA solo busca evidencia para cada punto del checklist. Si un punto no aparece en los documentos aportados, se deja exactamente como estaba y no se genera ninguna observación automática.
          </span>
        </div>

        <div
          onDragOver={event => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={event => {
            event.preventDefault();
            setIsDragging(false);
          }}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40'
              : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,application/pdf,image/*,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
            onChange={handleFileInput}
          />
          <UploadCloud className="w-8 h-8 mx-auto text-indigo-600 dark:text-indigo-400 mb-2" />
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
            Arrastre documentos aquí o haga clic para seleccionarlos
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            PDF, Word, Excel e imágenes
          </p>
        </div>

        {selectedFiles.length > 0 && (
          <div className="space-y-3 p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {selectedFiles.length} documento(s) preparados
              </span>
              <button
                type="button"
                onClick={() => setSelectedFiles([])}
                className="text-xs text-slate-500 hover:text-rose-600 flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpiar
              </button>
            </div>

            <div className="space-y-2 max-h-44 overflow-y-auto">
              {selectedFiles.map((file, index) => (
                <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
                  <div className="min-w-0 flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                    <FileText className="w-4 h-4 shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      setSelectedFiles(files => files.filter((_, current) => current !== index));
                    }}
                    className="text-slate-400 hover:text-rose-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleExecuteAnalysis}
              disabled={isAnalyzing}
              className="w-full sm:w-auto px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2"
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Comprobando checklist...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  Comprobar Checklist
                </>
              )}
            </button>

            {isAnalyzing && analysisProgress && (
              <div className="text-xs text-indigo-800 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3">
                {analysisProgress}
              </div>
            )}
          </div>
        )}

        {analysisSummary && !isReviewModalOpen && (
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{analysisSummary}</span>
          </div>
        )}
      </div>

      <ChecklistReviewModal
        isOpen={isReviewModalOpen}
        subcontrata={subcontrata}
        proposedChanges={proposedChanges}
        onClose={() => {
          setIsReviewModalOpen(false);
          onToast('Revisión cerrada. El checklist no ha sido modificado.', 'error');
        }}
        onApplyChanges={handleApplyReviewedChanges}
      />
    </div>
  );
};
