import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertOctagon, RefreshCw, X, Database, CloudOff, CloudCheck } from 'lucide-react';

export interface DatabaseSyncPayload {
  status: 'syncing' | 'success' | 'error';
  title?: string;
  message?: string;
  detail?: string;
  timestamp?: number;
  retryAction?: () => void | Promise<void>;
}

export const DatabaseSyncAlert: React.FC = () => {
  const [syncState, setSyncState] = useState<DatabaseSyncPayload | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    const handleSyncNotice = (e: any) => {
      if (e?.detail) {
        setSyncState({
          ...e.detail,
          timestamp: e.detail.timestamp || Date.now()
        });
      }
    };

    window.addEventListener('profea_db_sync_notice', handleSyncNotice);
    return () => window.removeEventListener('profea_db_sync_notice', handleSyncNotice);
  }, []);

  // Auto-dismiss success notification after 4.5 seconds
  useEffect(() => {
    if (syncState?.status === 'success') {
      const timer = setTimeout(() => {
        setSyncState(prev => (prev?.status === 'success' ? null : prev));
      }, 4500);
      return () => clearTimeout(timer);
    }
  }, [syncState]);

  if (!syncState || (syncState.status !== 'success' && syncState.status !== 'error')) return null;

  const handleRetry = async () => {
    if (!syncState.retryAction) return;
    try {
      setIsRetrying(true);
      await syncState.retryAction();
    } catch (err) {
      console.error("Retry failed:", err);
    } finally {
      setIsRetrying(false);
    }
  };

  const handleClose = () => {
    setSyncState(null);
  };

  return (
    <div 
      id="database-sync-notification-window"
      className="fixed bottom-6 right-6 z-[120] max-w-md w-[calc(100vw-3rem)] sm:w-[420px] transition-all duration-300 animate-in slide-in-from-bottom-5 fade-in"
      role="alert"
      aria-live="assertive"
    >
      {syncState.status === 'success' && (
        <div className="bg-emerald-600 dark:bg-emerald-700 text-white p-4 sm:p-5 rounded-2xl shadow-2xl border border-emerald-400/60 flex items-start gap-3.5">
          <div className="p-2 bg-emerald-500/50 rounded-xl shrink-0 mt-0.5 shadow-inner">
            <CheckCircle2 className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
                <Database className="w-4 h-4 text-emerald-200" />
                {syncState.title || 'Operación guardada correctamente en la Base de Datos'}
              </h4>
              <button
                onClick={handleClose}
                className="text-emerald-100 hover:text-white p-1 rounded-lg hover:bg-emerald-500/40 transition-colors"
                aria-label="Cerrar notificación"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-emerald-50 mt-1 leading-relaxed font-medium">
              {syncState.message || 'Los cambios se han actualizado y sincronizado correctamente con la base de datos.'}
            </p>
            {syncState.detail && (
              <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-700/60 rounded-lg text-[11px] text-emerald-100 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse shrink-0"></span>
                <span className="truncate">{syncState.detail}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {syncState.status === 'error' && (
        <div className="bg-rose-600 dark:bg-rose-700 text-white p-4 sm:p-5 rounded-2xl shadow-2xl border-2 border-rose-400 flex items-start gap-3.5">
          <div className="p-2 bg-rose-500/50 rounded-xl shrink-0 mt-0.5 shadow-inner">
            <AlertOctagon className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
                <CloudOff className="w-4 h-4 text-rose-200" />
                {syncState.title || 'Error: No se ha podido guardar en la Base de Datos'}
              </h4>
              <button
                onClick={handleClose}
                className="text-rose-100 hover:text-white p-1 rounded-lg hover:bg-rose-500/40 transition-colors"
                aria-label="Cerrar alerta de error"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-rose-50 mt-1 leading-relaxed font-medium">
              {syncState.message || 'No se han podido subir los cambios a la base de datos en la nube. Los cambios se mantienen guardados localmente.'}
            </p>
            {syncState.detail && (
              <div className="mt-2 text-[11px] text-rose-100 bg-rose-800/60 px-2.5 py-1.5 rounded-lg font-mono">
                {syncState.detail}
              </div>
            )}
            {syncState.retryAction && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={handleRetry}
                  disabled={isRetrying}
                  className="px-3.5 py-1.5 bg-white text-rose-700 hover:bg-rose-50 active:scale-95 rounded-xl text-xs font-bold shadow-md transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                  {isRetrying ? 'Reintentando...' : 'Reintentar Ahora'}
                </button>
                <button
                  onClick={handleClose}
                  className="px-3.5 py-1.5 text-xs text-rose-100 hover:text-white hover:underline transition-all"
                >
                  Entendido
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
