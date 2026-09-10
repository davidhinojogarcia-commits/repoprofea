import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthGate } from './components/AuthGate';

// Puente de arranque temporal mientras se elimina el código legacy de sincronización.
// Estos valores NO reactivan Firebase ni sincronización manual. Las operaciones que aún
// pasan por executeDatabaseSync se ejecutan directamente y terminan en los servicios Supabase.
Object.assign(globalThis as any, {
  useCallback: React.useCallback,
  isOffline: false,
  isSyncing: false,
  groupId: '',
  syncMode: 'supabase',
  currentEffectiveWorkspaceId: 'supabase',
  setIsOffline: () => undefined,
  executeDatabaseSync: async (_label: unknown, operation?: unknown) => {
    if (typeof operation === 'function') return await (operation as () => unknown)();
    return undefined;
  },
  handleSyncPendingToCloud: async () => undefined,
  handleGoogleLogin: async () => { throw new Error('El acceso con Google está deshabilitado.'); },
  handleGoogleLogout: async () => undefined,
});

const App = React.lazy(() => import('./App'));

type RootErrorBoundaryProps = { children: React.ReactNode };
type RootErrorBoundaryState = { error: Error | null };

class RootErrorBoundary extends React.Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  declare props: Readonly<RootErrorBoundaryProps>;
  state: RootErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): RootErrorBoundaryState { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('Error fatal de la aplicación', error, info); }
  render() {
    if (this.state.error) {
      const diagnostic = `${this.state.error.name || 'Error'}: ${this.state.error.message || 'Error desconocido'}`.slice(0, 300);
      return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4"><div className="w-full max-w-lg rounded-2xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 p-8 shadow-xl"><h1 className="text-xl font-bold text-slate-900 dark:text-white">No se ha podido cargar la aplicación</h1><p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Se ha producido un error al iniciar PROFEA. Recarga la página. Si continúa, comunica el problema al administrador.</p><div className="mt-4 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs font-mono break-words text-slate-700 dark:text-slate-200">{diagnostic}</div><button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2.5 font-semibold">Recargar</button></div></div>;
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element to mount to');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <AuthGate>
        <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950"><div className="text-sm text-slate-500">Cargando aplicación…</div></div>}>
          <App />
        </React.Suspense>
      </AuthGate>
    </RootErrorBoundary>
  </React.StrictMode>
);