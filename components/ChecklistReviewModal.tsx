import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, AlertTriangle, XCircle, Sparkles, FileCheck, 
  X, Check, Calendar, FileText, AlertCircle, ShieldAlert, ArrowRight
} from 'lucide-react';
import { 
  Subcontratista, 
  SubcontrataDocItem, 
  SubcontrataDocEstado, 
  SubcontrataDocCategoria 
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

interface ChecklistReviewModalProps {
  isOpen: boolean;
  subcontrata: Subcontratista;
  proposedChanges: ProposedChecklistChange[];
  onClose: () => void;
  onApplyChanges: (confirmedChanges: ProposedChecklistChange[]) => void;
}

export const ChecklistReviewModal: React.FC<ChecklistReviewModalProps> = ({
  isOpen,
  subcontrata,
  proposedChanges: initialChanges,
  onClose,
  onApplyChanges
}) => {
  const [items, setItems] = useState<ProposedChecklistChange[]>([]);
  const [activeCategory, setActiveCategory] = useState<SubcontrataDocCategoria>('empresa');

  useEffect(() => {
    if (isOpen) {
      setItems(initialChanges.map(i => ({ ...i })));
    }
  }, [isOpen, initialChanges]);

  if (!isOpen) return null;

  const handleToggleSelectAll = (select: boolean) => {
    setItems(prev => prev.map(item => ({ ...item, selected: select })));
  };

  const handleToggleItem = (index: number) => {
    setItems(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], selected: !copy[index].selected };
      return copy;
    });
  };

  const handleUpdateItemField = (index: number, field: keyof ProposedChecklistChange, value: any) => {
    setItems(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const categoryMeta: { id: SubcontrataDocCategoria; label: string; description: string }[] = [
    { id: 'empresa', label: '1. Empresa', description: 'REA, seguros, certificados, prevención y documentación societaria' },
    { id: 'trabajadores', label: '2. Personal', description: 'Altas, formación, aptitud médica, EPIs y acreditaciones nominales' },
    { id: 'maquinaria', label: '3. Maquinaria y equipos', description: 'Marcado CE, seguros, ITV, revisiones y documentación técnica' }
  ];
  const visibleItems = items.map((item, index) => ({ item, index })).filter(({ item }) => item.categoria === activeCategory);
  const selectedCount = items.filter(i => i.selected).length;
  const expiredCount = items.filter(i => i.estaCaducado || i.estadoPropuesto === 'caducado').length;
  const deliveredCount = items.filter(i => i.estadoPropuesto === 'entregado').length;
  const illegibleCount = items.filter(i => i.esLegible === false || i.estadoPropuesto === 'incompleto').length;

  const handleConfirm = () => {
    const selected = items.filter(i => i.selected);
    onApplyChanges(selected);
  };

  return (
    <div 
      id="modal-review-ia-checklist-changes"
      className="fixed inset-0 z-[130] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-[var(--ui-gradient-brand)] p-5 text-white shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="p-2.5 bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-bold tracking-tight text-white">
                    Notificación de Cambios Propuestos por IA (Checklist CAE)
                  </h3>
                  <span className="px-2 py-0.5 text-xs font-bold bg-white/15 text-white border border-white/20 rounded-full">
                    Revisión Previa Requerida
                  </span>
                </div>
                <p className="text-xs text-blue-100/90 mt-1">
                  Empresa: <strong className="text-white">{subcontrata.nombreEmpresa}</strong> (CIF: {subcontrata.cif || 'No asignado'}) · Obra: {subcontrata.obra}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              aria-label="Cerrar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Metrics Bar */}
          <div className="flex flex-wrap items-center gap-2.5 mt-4 pt-3 border-t border-white/15 text-xs">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/10 rounded-lg">
              <FileCheck className="w-4 h-4 text-blue-300" />
              <span>Detectados: <strong>{items.length}</strong></span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-emerald-300" />
              <span>Conformes / Vigor: <strong>{deliveredCount}</strong></span>
            </div>
            {expiredCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-500/20 text-rose-200 border border-rose-400/30 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-rose-300" />
                <span>Caducados / Incidencias: <strong>{expiredCount}</strong></span>
              </div>
            )}
            {illegibleCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-500/20 text-purple-200 border border-purple-400/30 rounded-lg">
                <AlertCircle className="w-4 h-4 text-purple-300" />
                <span>Ilegibles / Incompletos: <strong>{illegibleCount}</strong></span>
              </div>
            )}
          </div>
        </div>

        {/* Toolbar Notice */}
        <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200/60 dark:border-amber-900/40 px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200 shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              Comprueba y modifica libremente los <strong>estados</strong>, <strong>fechas</strong> u <strong>observaciones técnicas</strong> antes de aplicarlos.
            </span>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            <button
              onClick={() => handleToggleSelectAll(true)}
              className="px-2.5 py-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Seleccionar todos
            </button>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <button
              onClick={() => handleToggleSelectAll(false)}
              className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:underline cursor-pointer"
            >
              Deseleccionar todos
            </button>
          </div>
        </div>

        {/* Revisión por bloques CAE */}
        <div className="px-4 sm:px-6 pt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 shrink-0">
          {categoryMeta.map(category => {
            const count = items.filter(item => item.categoria === category.id).length;
            const incidents = items.filter(item => item.categoria === category.id && !['entregado', 'no_aplica'].includes(item.estadoPropuesto)).length;
            const active = activeCategory === category.id;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setActiveCategory(category.id)}
                className={`text-left rounded-xl border p-3 transition-all ${active ? 'border-[var(--ui-brand-400)] bg-[var(--ui-brand-50)] shadow-sm' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-black ${active ? 'text-[var(--ui-brand-800)]' : 'text-slate-800 dark:text-slate-100'}`}>{category.label}</span>
                  <span className={incidents ? 'ui-status ui-status--warn' : 'ui-status ui-status--ok'}>{incidents ? `${incidents} revisar` : `${count} revisados`}</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-4">{category.description}</p>
              </button>
            );
          })}
        </div>

        {/* List of Proposed Changes */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {visibleItems.map(({ item, index }) => {
            const isIncidence = item.estadoPropuesto === 'caducado' || item.estadoPropuesto === 'incompleto' || item.estaCaducado;

            return (
              <div 
                key={item.docId || index}
                className={`border rounded-xl p-4 transition-all ${
                  item.selected 
                    ? isIncidence 
                      ? 'border-rose-300 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20' 
                      : 'border-blue-300 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40 opacity-70'
                }`}
              >
                {/* Item Top Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200/80 dark:border-slate-800">
                  <div className="flex items-center gap-3 min-w-0">
                    <input 
                      type="checkbox"
                      id={`chk-item-${index}`}
                      checked={item.selected}
                      onChange={() => handleToggleItem(index)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                    />
                    <div className="min-w-0">
                      <label 
                        htmlFor={`chk-item-${index}`}
                        className="font-bold text-sm text-slate-900 dark:text-slate-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 truncate block"
                      >
                        {item.nombre}
                      </label>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] font-semibold px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded">
                          {item.categoria === 'empresa' ? 'Empresa' : item.categoria === 'trabajadores' ? 'Trabajadores' : 'Maquinaria'}
                        </span>
                        {item.obligatorio && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 rounded">
                            Obligatorio
                          </span>
                        )}
                        {item.normativa && (
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            {item.normativa}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* AI Diagnosis Tag */}
                  <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
                    {item.archivoOrigen && (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md font-mono" title={item.archivoOrigen}>
                        <FileText className="w-3 h-3 text-slate-400" />
                        <span className="max-w-[140px] truncate">{item.archivoOrigen}</span>
                      </span>
                    )}

                    {item.estaCaducado ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 bg-red-600 text-white rounded-lg shadow-xs">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Caducado {item.diasCaducado ? `hace ${item.diasCaducado} d` : ''}
                      </span>
                    ) : item.esProximaCaducidad ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 bg-amber-500 text-slate-950 rounded-lg">
                        <Calendar className="w-3.5 h-3.5" />
                        Vence en {item.diasRestantes ?? 0} d
                      </span>
                    ) : item.esLegible === false ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 bg-purple-600 text-white rounded-lg">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Ilegible / Incompleto
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 bg-emerald-600 text-white rounded-lg">
                        <Check className="w-3.5 h-3.5" />
                        Conforme / En Vigor
                      </span>
                    )}
                  </div>
                </div>

                {/* Form Fields for Manual Adjustment */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3">
                  {/* Estado Field */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Estado Propuesto:
                    </label>
                    <select
                      value={item.estadoPropuesto}
                      disabled={!item.selected}
                      onChange={(e) => handleUpdateItemField(index, 'estadoPropuesto', e.target.value as SubcontrataDocEstado)}
                      className={`w-full text-xs font-semibold rounded-lg border px-3 py-2 transition-colors ${
                        item.estadoPropuesto === 'entregado'
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                          : item.estadoPropuesto === 'caducado'
                          ? 'border-red-500 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 font-bold'
                          : item.estadoPropuesto === 'incompleto'
                          ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200'
                          : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      <option value="entregado">✓ Entregado (Conforme)</option>
                      <option value="caducado">⚠️ Caducado / Con Incidencia</option>
                      <option value="incompleto">⏳ Incompleto / Subsanación</option>
                      <option value="pendiente">○ Pendiente de Entrega</option>
                      <option value="no_aplica">— Exento / No Aplica</option>
                    </select>
                  </div>

                  {/* Fecha de Emisión / Entrega */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Fecha Entrega / Emisión:
                    </label>
                    <input 
                      type="date"
                      value={item.fechaEntregaPropuesta || ''}
                      disabled={!item.selected}
                      onChange={(e) => handleUpdateItemField(index, 'fechaEntregaPropuesta', e.target.value)}
                      className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-2 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  {/* Fecha de Caducidad / Validez */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Fecha Caducidad / Validez:
                    </label>
                    <input 
                      type="date"
                      value={item.fechaCaducidadPropuesta || ''}
                      disabled={!item.selected}
                      onChange={(e) => handleUpdateItemField(index, 'fechaCaducidadPropuesta', e.target.value)}
                      className={`w-full text-xs rounded-lg border px-3 py-2 focus:ring-1 focus:ring-blue-500 ${
                        item.estaCaducado || item.estadoPropuesto === 'caducado'
                          ? 'border-red-400 bg-red-50/50 dark:bg-red-950/30 text-red-900 dark:text-red-200 font-bold'
                          : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                      }`}
                    />
                  </div>
                </div>

                {/* Observaciones Técnicas (Editable textarea) */}
                <div className="mt-3">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Observaciones Técnicas / Detalle de la Incidencia:
                  </label>
                  <textarea 
                    rows={2}
                    value={item.observacionesPropuestas || ''}
                    disabled={!item.selected}
                    onChange={(e) => handleUpdateItemField(index, 'observacionesPropuestas', e.target.value)}
                    placeholder="Detalles técnicos, motivo de la caducidad o incidencia detectada..."
                    className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 p-2.5 focus:ring-1 focus:ring-blue-500 resize-none font-sans"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
          <div className="text-xs text-slate-600 dark:text-slate-300">
            <span>
              Documentos a actualizar: <strong className="text-blue-600 dark:text-blue-400">{selectedCount}</strong> de {items.length}
            </span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer"
            >
              Cancelar / Descartar
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedCount === 0}
              className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-4 h-4" />
              Aplicar Cambios al Checklist ({selectedCount})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
