import React, { useState } from 'react';
import { 
  Database, 
  RefreshCw, 
  CheckCircle2, 
  Cloud, 
  CloudCheck, 
  X, 
  Users, 
  Trash2, 
  Building2, 
  ShieldCheck, 
  ArrowDownCircle, 
  UploadCloud,
  AlertCircle,
  ExternalLink
} from 'lucide-react';
import { Person, DeletedPerson } from '../types';

interface FirebaseSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  workersCount: number;
  trashCount: number;
  activeWorkspaceId: string;
  lastSyncTime: Date | null;
  onPerformSync: () => Promise<number>;
  onForceSaveAllToCloud?: () => Promise<void>;
  userEmail?: string;
}

export const FirebaseSyncModal: React.FC<FirebaseSyncModalProps> = ({
  isOpen,
  onClose,
  workersCount,
  trashCount,
  activeWorkspaceId,
  lastSyncTime,
  onPerformSync,
  onForceSaveAllToCloud,
  userEmail = 'davidhinojogarcia@gmail.com'
}) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  if (!isOpen) return null;

  const handleSyncNow = async () => {
    try {
      setIsSyncing(true);
      setFeedback(null);
      const count = await onPerformSync();
      setFeedback({
        type: 'success',
        message: `¡Sincronización completada con éxito! Se han cargado ${count} trabajadores desde la base de datos de Firebase Firestore.`
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Error al sincronizar con la base de datos de Firestore.'
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSaveAll = async () => {
    if (!onForceSaveAllToCloud) return;
    try {
      setIsSaving(true);
      setFeedback(null);
      await onForceSaveAllToCloud();
      setFeedback({
        type: 'success',
        message: `¡Datos consolidados y guardados en la base de datos de Firebase Firestore!`
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Error al guardar los datos en Firestore.'
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="firebase-sync-modal-title"
    >
      <div 
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 p-6 text-white relative">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 rounded-full bg-black/20 hover:bg-black/30 transition-colors text-white cursor-pointer"
            aria-label="Cerrar modal"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-white/20 rounded-2xl backdrop-blur-xs shadow-inner">
              <Database className="w-6 h-6 text-white animate-pulse" />
            </div>
            <div>
              <span className="text-[11px] font-extrabold uppercase tracking-wider bg-white/25 px-2 py-0.5 rounded-full text-white">
                Base de Datos en Tiempo Real
              </span>
              <h2 id="firebase-sync-modal-title" className="text-xl font-black text-white mt-1">
                Firebase Firestore &amp; Auth
              </h2>
            </div>
          </div>
          <p className="text-amber-100 text-xs mt-1 leading-relaxed">
            Gestión de persistencia y lectura directa de trabajadores, papelera y configuraciones de PROFEA.
          </p>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Status Alert Banner */}
          <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-2xl p-4 flex items-start gap-3">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/50 rounded-xl shrink-0 mt-0.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                  Conexión Activa con Firestore Database
                </h4>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100/80 dark:bg-emerald-900/80 px-2 py-0.5 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                  En línea
                </span>
              </div>
              <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                La aplicación lee y escribe exclusivamente contra la base de datos de Firebase Firestore.
              </p>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 text-center">
              <div className="flex items-center justify-center text-blue-600 dark:text-blue-400 mb-1.5">
                <Users className="w-5 h-5" />
              </div>
              <span className="text-2xl font-black text-slate-800 dark:text-white block font-mono">
                {workersCount}
              </span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Trabajadores en BD
              </span>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 text-center">
              <div className="flex items-center justify-center text-rose-500 mb-1.5">
                <Trash2 className="w-5 h-5" />
              </div>
              <span className="text-2xl font-black text-slate-800 dark:text-white block font-mono">
                {trashCount}
              </span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                En Papelera
              </span>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 text-center col-span-2 sm:col-span-1">
              <div className="flex items-center justify-center text-amber-500 mb-1.5">
                <Cloud className="w-5 h-5" />
              </div>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block truncate">
                {lastSyncTime ? lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Recién sincronizado'}
              </span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Última Lectura
              </span>
            </div>
          </div>

          {/* Database Details */}
          <div className="bg-slate-50 dark:bg-slate-800/40 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/80 space-y-2.5 text-xs">
            <div className="flex justify-between items-center py-1 border-b border-slate-200/60 dark:border-slate-700/60">
              <span className="text-slate-500 dark:text-slate-400 font-medium">Base de Datos Firestore:</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                ai-studio-sistemacontratac-...
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-slate-200/60 dark:border-slate-700/60">
              <span className="text-slate-500 dark:text-slate-400 font-medium">Espacio / Bóveda Activa:</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                {activeWorkspaceId}
              </span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-slate-500 dark:text-slate-400 font-medium">Usuario / Cuenta de Sync:</span>
              <span className="font-bold text-blue-600 dark:text-blue-400">
                {userEmail}
              </span>
            </div>
          </div>

          {/* Feedback Message */}
          {feedback && (
            <div className={`p-4 rounded-2xl text-xs font-semibold flex items-start gap-2.5 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border border-rose-300 dark:border-rose-800'
            }`}>
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2.5 pt-2">
            <button
              onClick={handleSyncNow}
              disabled={isSyncing}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-600 hover:to-orange-700 text-white rounded-2xl font-bold text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Leyendo desde Firebase Firestore...' : 'Sincronizar y Leer desde Firebase Firestore Ahora'}</span>
            </button>

            {onForceSaveAllToCloud && (
              <button
                onClick={handleSaveAll}
                disabled={isSaving || isSyncing}
                className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-2xl font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 border border-slate-200 dark:border-slate-700"
              >
                <UploadCloud className={`w-4 h-4 text-blue-500 ${isSaving ? 'animate-bounce' : ''}`} />
                <span>{isSaving ? 'Guardando en Firestore...' : 'Guardar y Consolidar todo en Firestore'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200/80 dark:border-slate-700/80 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl transition-all cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
