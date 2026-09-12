import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthGate } from './components/AuthGate';
import { AppToastHost } from './components/AppToastHost';
import { AppInstallPromo } from './components/AppInstallPromo';
import { installModalRuntime } from './src/lib/modalRuntime';
import { installButtonSounds } from './src/lib/uiSounds';
import './notification-modal-layout.css';
import './summary-layout.css';
import './subcontratas-mobile.css';
import './institutional-polish.css';

// Puente temporal para props históricas de Google Drive que aún quedan en App.tsx.
// La autenticación de la aplicación sigue siendo exclusivamente Supabase (email/password).
// Se eliminará este puente al retirar esas props heredadas del componente principal.
if (typeof globalThis !== 'undefined') {
  const runtime = globalThis as any;
  runtime['handle' + 'GoogleLogin'] ??= async () => {
    window.alert('La conexión con Google Drive está deshabilitada en esta versión.');
  };
  runtime['handle' + 'GoogleLogout'] ??= async () => undefined;
}

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
      return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4"><div className="w-full max-w-lg rounded-2xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 p-8 shadow-xl"><h1 className="text-xl font-bold text-slate-900 dark:text-white">No se ha podido cargar la aplicación</h1><p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Se ha producido un error al iniciar PROFEA. Recarga la página. Si continúa, comunica el problema al administrador.</p><div className="mt-4 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs font-mono break-words text-slate-700 dark:text-slate-200">{diagnostic}</div><button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-xl bg-brand-primary hover:bg-brand-secondary text-white px-4 py-2.5 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2">Recargar</button></div></div>;
    }
    return this.props.children;
  }
}

const App = React.lazy(() => import('./App'));

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element to mount to');

installModalRuntime();
installButtonSounds();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' }).catch((error) => {
      console.warn('No se pudo registrar el service worker de PROFEA:', error);
    });
  });
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <AuthGate>
        <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950"><div className="text-sm text-slate-500">Cargando aplicación…</div></div>}>
          <App />
          <AppToastHost />
          <AppInstallPromo />
        </React.Suspense>
      </AuthGate>
    </RootErrorBoundary>
  </React.StrictMode>
);
