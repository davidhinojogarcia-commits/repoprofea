import React, { useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import { flushOfflineQueue } from '../src/lib/supabase';
import {
  getOfflineSyncState,
  subscribeOfflineState,
  type OfflineSyncState,
} from '../src/lib/offlineStore';

const initialState: OfflineSyncState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0,
  syncing: false,
  lastError: '',
  lastSyncedAt: null,
};

export const OfflineSyncStatus: React.FC = () => {
  const [state, setState] = useState<OfflineSyncState>(initialState);

  useEffect(() => subscribeOfflineState(setState), []);

  useEffect(() => {
    void getOfflineSyncState().then(setState);
  }, []);

  const tone = !state.online
    ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/90 dark:text-amber-200'
    : state.lastError
      ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/90 dark:text-red-200'
      : state.syncing
        ? 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/90 dark:text-blue-200'
        : state.pending > 0
          ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/90 dark:text-amber-200'
          : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/90 dark:text-emerald-200';

  const label = !state.online
    ? `Sin conexión · ${state.pending} pendiente${state.pending === 1 ? '' : 's'}`
    : state.syncing
      ? `Sincronizando ${state.pending} cambio${state.pending === 1 ? '' : 's'}…`
      : state.lastError
        ? 'Error de sincronización'
        : state.pending > 0
          ? `${state.pending} cambio${state.pending === 1 ? '' : 's'} pendiente${state.pending === 1 ? '' : 's'}`
          : 'En línea · Todo sincronizado';

  const Icon = !state.online
    ? WifiOff
    : state.syncing
      ? RefreshCw
      : state.lastError
        ? AlertTriangle
        : state.pending > 0
          ? Wifi
          : CheckCircle2;

  return (
    <button
      type="button"
      onClick={() => {
        if (state.online && !state.syncing && state.pending > 0) void flushOfflineQueue();
      }}
      title={
        state.lastError
          ? `${state.lastError}. Toca para reintentar cuando tengas conexión.`
          : state.pending > 0
            ? 'Los cambios están guardados en este dispositivo. Toca para intentar sincronizarlos.'
            : 'El trabajo del dispositivo está sincronizado con el servidor.'
      }
      className={`fixed bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] right-3 sm:right-5 z-[220] max-w-[calc(100vw-1.5rem)] rounded-full border px-3 py-2 shadow-lg backdrop-blur-md text-[11px] sm:text-xs font-black inline-flex items-center gap-2 transition-colors ${tone}`}
      aria-live="polite"
    >
      <Icon className={`w-4 h-4 shrink-0 ${state.syncing ? 'animate-spin' : ''}`} />
      <span className="truncate">{label}</span>
    </button>
  );
};
