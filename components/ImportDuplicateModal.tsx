import React from 'react';
import ModalPortal from './ModalPortal';
import { AlertTriangle, Filter, Users, X, Check, ArrowRight, FileCheck2, Trash2 } from 'lucide-react';
import { DuplicateMatch } from '../src/lib/duplicateFilter';

interface ImportDuplicateModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalCount: number;
  uniqueCount: number;
  duplicates: DuplicateMatch[];
  onConfirmFilter: () => void;
  onConfirmImportAll: () => void;
}

export const ImportDuplicateModal: React.FC<ImportDuplicateModalProps> = ({
  isOpen,
  onClose,
  totalCount,
  uniqueCount,
  duplicates,
  onConfirmFilter,
  onConfirmImportAll
}) => {
  if (!isOpen) return null;

  return (
    <ModalPortal label="ImportDuplicateModal"><div className="fixed inset-0 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-amber-200 dark:border-amber-900/60 p-6 md:p-8 max-w-2xl w-full shadow-2xl space-y-6 animate-in zoom-in-95 duration-200 relative overflow-hidden">
        
        {/* Top Decorative Amber Accent Line */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600" />

        {/* Header Section */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
          <div className="flex items-start gap-3.5">
            <div className="p-3 bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 rounded-2xl shrink-0 shadow-sm">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300">
                  {duplicates.length} Duplicado(s) Detectados
                </span>
              </div>
              <h3 className="text-lg md:text-xl font-extrabold text-slate-800 dark:text-slate-100 leading-snug">
                Detectados trabajadores repetidos en el mismo periodo
              </h3>
              <p className="text-xs md:text-sm text-slate-600 dark:text-slate-300">
                Se han encontrado personas que coinciden en <strong>DNI o Nombre</strong> dentro de la <strong>misma quincena o fechas de contrato</strong>.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Cancelar importación"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary Metric Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 rounded-2xl text-center">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total en Lote</div>
            <div className="text-lg md:text-2xl font-black text-slate-800 dark:text-slate-100">{totalCount}</div>
            <div className="text-[10px] text-slate-500">Trabajadores</div>
          </div>

          <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl text-center">
            <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Únicos a Importar</div>
            <div className="text-lg md:text-2xl font-black text-emerald-700 dark:text-emerald-300">{uniqueCount}</div>
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">Nuevos registros</div>
          </div>

          <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-2xl text-center">
            <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">A Omitir/Eliminar</div>
            <div className="text-lg md:text-2xl font-black text-amber-700 dark:text-amber-300">{duplicates.length}</div>
            <div className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">Repetidos</div>
          </div>
        </div>

        {/* List of Detected Duplicates */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
            <span>Detalle de los registros duplicados ({duplicates.length}):</span>
            <span className="text-[11px] font-normal text-amber-600 dark:text-amber-400 font-medium">Misma persona y periodo/quincena</span>
          </div>

          <div className="max-h-52 overflow-y-auto pr-1 space-y-2 custom-scrollbar">
            {duplicates.map((dup, idx) => (
              <div 
                key={idx}
                className="p-3 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/50 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <span>{dup.workerName}</span>
                    <span className="px-1.5 py-0.2 rounded bg-amber-200/70 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 text-[10px]">
                      {dup.workerDni || 'Sin DNI'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-3">
                    <span>Obra: <strong>{dup.obra}</strong></span>
                    <span>Quincena: <strong>{dup.quincena}</strong></span>
                    {dup.periodo !== 'No especificado' && <span>Fechas: <strong>{dup.periodo}</strong></span>}
                  </div>
                </div>

                <div className="shrink-0 text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50 px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-800">
                  {dup.matchedWith}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
          >
            <X className="w-4 h-4 text-slate-400" />
            <span>Cancelar</span>
          </button>

          <button
            type="button"
            onClick={onConfirmImportAll}
            className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 border border-slate-300/60 dark:border-slate-700"
          >
            <span>Importar Todos ({totalCount})</span>
          </button>

          <button
            type="button"
            onClick={onConfirmFilter}
            className="flex-1 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-extrabold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Filter className="w-4 h-4" />
            <span>Filtrar y Omitir Duplicados ({uniqueCount})</span>
          </button>
        </div>

      </div>
    </div></ModalPortal>
  );
};