import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileCheck,
  FileText,
  Sparkles,
  X,
} from 'lucide-react';
import {
  Subcontratista,
  SubcontrataDocEstado,
  SubcontrataDocCategoria,
} from '../types';

export interface ProposedChecklistChange {
  docId: string;
  nombre: string;
  categoria: SubcontrataDocCategoria;
  normativa: string;
  obligatorio: boolean;
  estadoActual: SubcontrataDocEstado;
  estadoPropuesto: SubcontrataDocEstado;
  fechaEntregaActual?: string;
  fechaEntregaPropuesta: string;
  fechaCaducidadActual?: string;
  fechaCaducidadPropuesta: string;
  observacionesActuales?: string;
  observacionesPropuestas: string;
  archivoOrigen?: string;
  estaCaducado?: boolean;
  diasCaducado?: number;
  diasRestantes?: number;
  esProximaCaducidad?: boolean;
  motivoCaducidad?: string;
  motivoIlegible?: string;
  esLegible?: boolean;
  validezIA?: string;
  confianza?: string;
  selected: boolean;
}

export interface ReviewSource {
  name: string;
  type: string;
  extractedText: string;
  extractionSource: string;
  file?: File;
}

interface ChecklistReviewModalProps {
  isOpen: boolean;
  subcontrata: Subcontratista;
  proposedChanges: ProposedChecklistChange[];
  sourceFiles: File[];
  reviewSources: ReviewSource[];
  onClose: () => void;
  onApplyChanges: (confirmedChanges: ProposedChecklistChange[]) => void;
}

const normalizeSourceName = (value?: string) =>
  String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.trim()
    .toLowerCase() || '';

const isVisualFile = (file?: File) =>
  Boolean(
    file &&
      (file.type === 'application/pdf' ||
        file.type.startsWith('image/') ||
        /\.(pdf|png|jpe?g|webp)$/i.test(file.name)),
  );

export const ChecklistReviewModal: React.FC<ChecklistReviewModalProps> = ({
  isOpen,
  subcontrata,
  proposedChanges: initialChanges,
  sourceFiles,
  reviewSources,
  onClose,
  onApplyChanges,
}) => {
  const [items, setItems] = useState<ProposedChecklistChange[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reviewedIndexes, setReviewedIndexes] = useState<Set<number>>(new Set());
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setItems(initialChanges.map(item => ({ ...item })));
    setActiveIndex(0);
    setReviewedIndexes(new Set());
  }, [isOpen, initialChanges]);

  const currentItem = items[activeIndex];

  const findSourceFile = (sourceName?: string) => {
    const normalized = normalizeSourceName(sourceName);
    if (!normalized) return undefined;

    return (
      sourceFiles.find(file => normalizeSourceName(file.name) === normalized) ||
      sourceFiles.find(
        file =>
          normalizeSourceName(file.name).includes(normalized) ||
          normalized.includes(normalizeSourceName(file.name)),
      )
    );
  };

  const currentFile = useMemo(
    () => findSourceFile(currentItem?.archivoOrigen),
    [currentItem?.archivoOrigen, sourceFiles],
  );

  const currentSource = useMemo(() => {
    const normalized = normalizeSourceName(currentItem?.archivoOrigen);
    if (!normalized) return undefined;
    return (
      reviewSources.find(source => normalizeSourceName(source.name) === normalized) ||
      reviewSources.find(
        source =>
          normalizeSourceName(source.name).includes(normalized) ||
          normalized.includes(normalizeSourceName(source.name)),
      )
    );
  }, [currentItem?.archivoOrigen, reviewSources]);

  useEffect(() => {
    if (!isOpen || !currentFile || !isVisualFile(currentFile)) {
      setPreviewUrl('');
      return;
    }

    const url = URL.createObjectURL(currentFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [isOpen, currentFile]);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;

    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !currentItem || typeof document === 'undefined') return null;

  const updateCurrent = (field: keyof ProposedChecklistChange, value: any) => {
    setItems(previous => {
      const copy = [...previous];
      copy[activeIndex] = { ...copy[activeIndex], [field]: value };
      return copy;
    });
  };

  const markCurrentReviewed = () => {
    setReviewedIndexes(previous => {
      const next = new Set(previous);
      next.add(activeIndex);
      return next;
    });
  };

  const goPrevious = () => {
    markCurrentReviewed();
    setActiveIndex(index => Math.max(0, index - 1));
  };

  const goNext = () => {
    markCurrentReviewed();
    setActiveIndex(index => Math.min(items.length - 1, index + 1));
  };

  const handleConfirm = () => {
    markCurrentReviewed();
    onApplyChanges(items.filter(item => item.selected));
  };

  const selectedCount = items.filter(item => item.selected).length;
  const expiredCount = items.filter(
    item => item.estaCaducado || item.estadoPropuesto === 'caducado',
  ).length;
  const deliveredCount = items.filter(item => item.estadoPropuesto === 'entregado').length;
  const illegibleCount = items.filter(
    item => item.esLegible === false || item.estadoPropuesto === 'incompleto',
  ).length;
  const isIncidence =
    currentItem.estadoPropuesto === 'caducado' ||
    currentItem.estadoPropuesto === 'incompleto' ||
    currentItem.estaCaducado;
  const currentText = currentSource?.extractedText?.trim() || '';
  const categoryLabel =
    currentItem.categoria === 'empresa'
      ? 'Empresa'
      : currentItem.categoria === 'trabajadores'
        ? 'Trabajadores'
        : 'Maquinaria y equipos';

  return createPortal(
    <div
      id="modal-review-checklist-changes"
      className="fixed !inset-0 z-[2147482200] m-0 flex h-[100dvh] w-[100vw] max-h-none max-w-none items-stretch justify-stretch overflow-hidden bg-white p-0 dark:bg-slate-950"
      style={{ width: '100vw', height: '100dvh', inset: 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cae-review-title"
    >
      <div className="m-0 flex h-full w-full min-h-0 min-w-0 max-h-none max-w-none flex-col overflow-hidden rounded-none border-0 bg-white shadow-none dark:bg-slate-900">
        <div className="profea-cae-review-header bg-[var(--ui-gradient-brand)] px-4 py-3 sm:px-5 sm:py-4 text-white shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2.5 bg-white/10 rounded-xl border border-white/20 shrink-0">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="cae-review-title" className="text-lg font-bold text-white">
                    Revisión documental CAE
                  </h3>
                  <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wide bg-sky-400/20 border border-sky-200/30 rounded-full">
                    Pantalla completa
                  </span>
                  <span className="px-2 py-0.5 text-xs font-bold bg-white/15 border border-white/20 rounded-full">
                    Documento {activeIndex + 1} de {items.length}
                  </span>
                </div>
                <p className="text-xs text-blue-100/90 mt-1 truncate">
                  {subcontrata.nombreEmpresa} · {subcontrata.obra} · Revise el documento original y
                  corrija el resultado antes de aplicarlo.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-xl border-2 border-white bg-slate-950 text-white shadow-lg transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-white/50"
              aria-label="Cerrar revisión"
              title="Cerrar revisión"
            >
              <X className="w-6 h-6" strokeWidth={3} aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-white/15 text-xs">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/10 rounded-lg">
              <FileCheck className="w-4 h-4 text-blue-200" />
              <span>
                Detectados: <strong>{items.length}</strong>
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/20 border border-emerald-400/30 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-emerald-300" />
              <span>
                Conformes: <strong>{deliveredCount}</strong>
              </span>
            </div>
            {expiredCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-500/20 border border-rose-400/30 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-rose-300" />
                <span>
                  Caducados/incidencias: <strong>{expiredCount}</strong>
                </span>
              </div>
            )}
            {illegibleCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-500/20 border border-purple-400/30 rounded-lg">
                <AlertCircle className="w-4 h-4 text-purple-200" />
                <span>
                  Incompletos/ilegibles: <strong>{illegibleCount}</strong>
                </span>
              </div>
            )}
            <div className="ml-auto">
              Revisados: <strong>{reviewedIndexes.size}</strong> / {items.length}
            </div>
          </div>
        </div>

        <div className="shrink-0 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/50 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          El análisis ya ha terminado. Ningún cambio se aplicará al checklist hasta que finalice
          esta revisión.
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(400px,0.75fr)] xl:grid-cols-[minmax(0,1.7fr)_minmax(440px,0.8fr)]">
          <section className="min-h-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="shrink-0 px-4 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">
                    Documento correspondiente
                  </p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {currentItem.archivoOrigen || 'Documento no asociado por el análisis'}
                  </p>
                </div>

                <select
                  value={currentItem.archivoOrigen || ''}
                  onChange={event => updateCurrent('archivoOrigen', event.target.value)}
                  className="max-w-full sm:max-w-[360px] text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-3 py-2"
                  aria-label="Cambiar documento correspondiente"
                >
                  <option value="">Seleccionar documento…</option>
                  {sourceFiles.map(file => (
                    <option key={`${file.name}-${file.size}`} value={file.name}>
                      {file.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto bg-slate-100 dark:bg-slate-950 p-2">
              {currentFile && previewUrl && currentFile.type.startsWith('image/') ? (
                <img
                  src={previewUrl}
                  alt={currentFile.name}
                  className="max-w-full mx-auto rounded-lg bg-white shadow"
                />
              ) : currentFile && previewUrl ? (
                <iframe
                  src={previewUrl}
                  title={currentFile.name}
                  className="w-full h-full min-h-[420px] bg-white"
                />
              ) : currentText ? (
                <div className="h-full min-h-[360px]">
                  <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <Eye className="w-4 h-4" />
                    Vista textual extraída del archivo
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                    {currentText}
                  </pre>
                </div>
              ) : (
                <div className="h-full min-h-[360px] flex items-center justify-center text-center p-6">
                  <div>
                    <FileText className="w-11 h-11 mx-auto mb-3 text-slate-400" />
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                      {currentItem.archivoOrigen
                        ? 'No se ha podido generar la previsualización de este archivo.'
                        : 'El análisis no ha asociado todavía un archivo a este requisito.'}
                    </p>
                    <p className="text-xs text-slate-500 mt-2">
                      Puede elegir manualmente el documento correcto en el selector superior.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="min-h-0 overflow-y-auto p-4 sm:p-5">
            <div
              className={`rounded-xl border p-4 mb-4 ${
                isIncidence
                  ? 'border-rose-300 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20'
                  : 'border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Resultado automático
                  </p>
                  <h4 className="text-base font-black text-slate-900 dark:text-white mt-1">
                    {currentItem.nombre}
                  </h4>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800">
                      {categoryLabel}
                    </span>
                    {currentItem.obligatorio && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300">
                        Obligatorio
                      </span>
                    )}
                    {currentItem.confianza && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300">
                        Confianza: {currentItem.confianza}
                      </span>
                    )}
                  </div>
                </div>

                {currentItem.estaCaducado ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 bg-red-600 text-white rounded-lg">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Caducado
                  </span>
                ) : currentItem.esProximaCaducidad ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 bg-amber-500 text-slate-950 rounded-lg">
                    <Calendar className="w-3.5 h-3.5" />
                    Vence en {currentItem.diasRestantes ?? 0} d
                  </span>
                ) : currentItem.esLegible === false ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 bg-purple-600 text-white rounded-lg">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Incompleto
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 bg-emerald-600 text-white rounded-lg">
                    <Check className="w-3.5 h-3.5" />
                    Conforme
                  </span>
                )}
              </div>

              {currentItem.normativa && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3">
                  {currentItem.normativa}
                </p>
              )}
            </div>

            <label className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 p-3 mb-4 bg-white dark:bg-slate-900 cursor-pointer">
              <input
                type="checkbox"
                checked={currentItem.selected}
                onChange={event => updateCurrent('selected', event.target.checked)}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-xs font-bold text-slate-900 dark:text-white">
                  Aplicar este resultado al checklist
                </span>
                <span className="block text-[11px] text-slate-500 mt-0.5">
                  Desmárquelo si prefiere descartar este resultado automático.
                </span>
              </span>
            </label>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Estado
                </label>
                <select
                  value={currentItem.estadoPropuesto}
                  disabled={!currentItem.selected}
                  onChange={event =>
                    updateCurrent('estadoPropuesto', event.target.value as SubcontrataDocEstado)
                  }
                  className="w-full text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-3 py-2.5"
                >
                  <option value="entregado">✓ Entregado / Conforme</option>
                  <option value="caducado">⚠️ Caducado / Con incidencia</option>
                  <option value="incompleto">⏳ Incompleto / Subsanación</option>
                  <option value="pendiente">○ Pendiente de entrega</option>
                  <option value="no_aplica">— Exento / No aplica</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Fecha emisión / entrega
                  </label>
                  <input
                    type="date"
                    value={currentItem.fechaEntregaPropuesta || ''}
                    disabled={!currentItem.selected}
                    onChange={event => updateCurrent('fechaEntregaPropuesta', event.target.value)}
                    className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-3 py-2.5"
                  />
                  {currentItem.fechaEntregaActual && (
                    <p className="text-[10px] text-slate-500 mt-1">
                      Anterior: {currentItem.fechaEntregaActual}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Fecha caducidad / validez
                  </label>
                  <input
                    type="date"
                    value={currentItem.fechaCaducidadPropuesta || ''}
                    disabled={!currentItem.selected}
                    onChange={event => updateCurrent('fechaCaducidadPropuesta', event.target.value)}
                    className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-3 py-2.5"
                  />
                  {currentItem.fechaCaducidadActual && (
                    <p className="text-[10px] text-slate-500 mt-1">
                      Anterior: {currentItem.fechaCaducidadActual}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Observaciones / incidencia detectada
                </label>
                <textarea
                  rows={6}
                  value={currentItem.observacionesPropuestas || ''}
                  disabled={!currentItem.selected}
                  onChange={event => updateCurrent('observacionesPropuestas', event.target.value)}
                  placeholder="Corrija aquí cualquier dato que el análisis no haya reconocido correctamente."
                  className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 p-3 resize-y"
                />
              </div>
            </div>
          </section>
        </div>

        <div className="shrink-0 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 p-3 sm:p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-600 dark:text-slate-300">
            Resultado {activeIndex + 1} de {items.length} · Se aplicarán{' '}
            <strong className="text-blue-600 dark:text-blue-400">{selectedCount}</strong> cambios
            seleccionados.
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={goPrevious}
              disabled={activeIndex === 0}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs font-bold disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
              Anterior
            </button>

            {activeIndex < items.length - 1 ? (
              <button
                type="button"
                onClick={goNext}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#00548E] text-white text-xs font-bold"
              >
                Guardar revisión y siguiente
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={selectedCount === 0}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                Finalizar revisión y aplicar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
