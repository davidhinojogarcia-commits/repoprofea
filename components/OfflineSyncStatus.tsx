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
    ? 'border-amber-200/80 bg-amber-50/70 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300'
    : state.lastError
      ? 'border-red-200/80 bg-red-50/70 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300'
      : state.syncing
        ? 'border-blue-200/80 bg-blue-50/70 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-300'
        : state.pending > 0
          ? 'border-amber-200/80 bg-amber-50/70 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300'
          : 'border-emerald-200/70 bg-emerald-50/55 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300';

  const label = !state.online
    ? `Sin conexión${state.pending > 0 ? ` · ${state.pending}` : ''}`
    : state.syncing
      ? `Sincronizando${state.pending > 0 ? ` · ${state.pending}` : ''}`
      : state.lastError && state.pending > 0
        ? `Error sync · ${state.pending}`
        : state.pending > 0
          ? `${state.pending} pendiente${state.pending === 1 ? '' : 's'}`
          : 'Sincronizado';

  const Icon = !state.online
    ? WifiOff
    : state.syncing
      ? RefreshCw
      : state.lastError && state.pending > 0
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
        state.lastError && state.pending > 0
          ? `${state.lastError}. Toca para reintentar (${state.pending} pendiente${state.pending === 1 ? '' : 's'}).`
          : state.pending > 0
            ? 'Los cambios están guardados en este dispositivo. Toca para intentar sincronizarlos.'
            : 'El trabajo del dispositivo está sincronizado con el servidor.'
      }
      className={`h-8 max-w-[132px] rounded-lg border px-2 text-[10px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shadow-none opacity-80 hover:opacity-100 transition-all shrink-0 ${tone}`}
      aria-live="polite"
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${state.syncing ? 'animate-spin' : ''}`} />
      <span className="truncate">{label}</span>
    </button>
  );
};
