import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthGate } from './components/AuthGate';
import { AppToastHost } from './components/AppToastHost';
import { AppDialogHost } from './components/AppDialogHost';
import { AppInstallPromo } from './components/AppInstallPromo';
import { DeferredAppEnhancements } from './components/DeferredAppEnhancements';
import { installModalRuntime } from './src/lib/modalRuntime';
import { installAppDialogRuntime } from './src/lib/appDialog';
import { installButtonSounds } from './src/lib/uiSounds';
import { installSidebarSwipe } from './src/lib/sidebarSwipe';
import { initializeOfflineSync } from './src/lib/supabase';
import './src/styles/design-system.css';
import './notification-modal-layout.css';
import './subcontratas-mobile.css';
import './institutional-polish.css';
import './dark-mode-hardening.css';
import './medical-citations-contrast.css';
import './guided-mobile-accessibility.css';
import './accessibility-contrast.css';
import './visit-minutes.css';

if (typeof globalThis !== 'undefined') {
  const runtime = globalThis as any;
  runtime['handle' + 'GoogleLogin'] ??= async () => { window.alert('La conexión con Google Drive está deshabilitada en esta versión.'); };
  runtime['handle' + 'GoogleLogout'] ??= async () => undefined;
}

const CHUNK_RECOVERY_KEY = 'profea_chunk_recovery_v1';
const isRecoverableChunkError = (value: unknown) =>
  /chunkloaderror|loading chunk|failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i
    .test(String((value as any)?.message || value || ''));

const recoverFromStaleChunkOnce = (error: unknown) => {
  if (!isRecoverableChunkError(error)) return false;
  try {
    if (sessionStorage.getItem(CHUNK_RECOVERY_KEY) === '1') return false;
    sessionStorage.setItem(CHUNK_RECOVERY_KEY, '1');
  } catch {
    return false;
  }
  window.location.reload();
  return true;
};

window.addEventListener('unhandledrejection', (event) => {
  if (recoverFromStaleChunkOnce(event.reason)) event.preventDefault();
});
window.setTimeout(() => {
  try { sessionStorage.removeItem(CHUNK_RECOVERY_KEY); } catch {}
}, 30_000);

type RootErrorBoundaryProps = { children: React.ReactNode };
type RootErrorBoundaryState = { error: Error | null };
class RootErrorBoundary extends React.Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  declare props: Readonly<RootErrorBoundaryProps>;
  state: RootErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): RootErrorBoundaryState { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Error fatal de la aplicación', error, info);
    recoverFromStaleChunkOnce(error);
  }
  render() {
    if (this.state.error) {
      const diagnostic = `${this.state.error.name || 'Error'}: ${this.state.error.message || 'Error desconocido'}`.slice(0, 300);
      return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4"><div className="w-full max-w-lg rounded-2xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 p-8 shadow-xl"><h1 className="text-xl font-bold text-slate-900 dark:text-white">No se ha podido cargar la aplicación</h1><p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Se ha producido un error al iniciar PROFEA. Recarga la página. Si continúa, comunica el problema al administrador.</p><div className="mt-4 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs font-mono break-words text-slate-700 dark:text-slate-200">{diagnostic}</div><button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-xl bg-brand-primary hover:bg-brand-secondary text-white px-4 py-2.5 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2">Recargar</button></div></div>;
    }
    return this.props.children;
  }
}

const App = React.lazy(() => import('./App'));
const MedicalAppointmentConfirmationPortal = React.lazy(() => import('./components/MedicalAppointmentConfirmationPortal').then(module => ({ default: module.MedicalAppointmentConfirmationPortal })));
const WorkerQrPortal = React.lazy(() => import('./components/WorkerQrPortal').then(module => ({ default: module.WorkerQrPortal })));
const RemoteScannerPortal = React.lazy(() => import('./components/RemoteScannerPortal').then(module => ({ default: module.RemoteScannerPortal })));
const ForemanMobilePortal = React.lazy(() => import('./components/ForemanMobilePortal').then(module => ({ default: module.ForemanMobilePortal })));
const VisitMinutesPortal = React.lazy(() => import('./components/VisitMinutesPortal').then(module => ({ default: module.VisitMinutesPortal })));
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element to mount to');
const normalizeLegacyLoginRoute = () => {
  if (window.location.pathname === '/login' || window.location.pathname === '/login/') window.history.replaceState(window.history.state, '', `/${window.location.search}${window.location.hash}`);
};
normalizeLegacyLoginRoute();
window.addEventListener('popstate', normalizeLegacyLoginRoute);
installModalRuntime();
installAppDialogRuntime();
installButtonSounds();
installSidebarSwipe();
initializeOfflineSync();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    navigator.serviceWorker
      .register('/service-worker.js', { updateViaCache: 'none' })
      .then(async (registration) => {
        await registration.update().catch(() => undefined);
        if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      })
      .catch((error) => { console.warn('No se pudo registrar el service worker de PROFEA:', error); });
  });
}
const initialSearchParams = new URLSearchParams(window.location.search);
const visitToken = new URLSearchParams(window.location.hash.slice(1)).get('visit') || '';
const isMedicalConfirmation = initialSearchParams.get('confirmacion_reconocimiento') === '1';
const remoteScannerToken = initialSearchParams.get('remote-scanner')?.trim() || '';
const workerQrToken = initialSearchParams.get('worker-qr')?.trim() || '';
const workerQrDni = initialSearchParams.get('view-worker-pdf')?.trim() || '';
const FOREMAN_DEVICE_TOKEN_KEY = 'pfea_foreman_device_token_v1';
const FOREMAN_DEVICE_COOKIE_KEY = 'pfea_foreman_device_token_v1';

const readForemanTokenCookie = () => {
  try {
    const prefix = FOREMAN_DEVICE_COOKIE_KEY + '=';
    const item = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
    return item ? decodeURIComponent(item.slice(prefix.length)).trim() : '';
  } catch {
    return '';
  }
};

const persistForemanDeviceToken = (token: string) => {
  const clean = String(token || '').trim();
  if (!clean) return;
  try { localStorage.setItem(FOREMAN_DEVICE_TOKEN_KEY, clean); } catch {}
  try {
    document.cookie = `${FOREMAN_DEVICE_COOKIE_KEY}=${encodeURIComponent(clean)}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;
  } catch {}
};

const foremanTokenFromUrl = initialSearchParams.get('encargado')?.trim() || '';
if (foremanTokenFromUrl) persistForemanDeviceToken(foremanTokenFromUrl);

const isForemanAppRoute = window.location.pathname === '/encargados' || window.location.pathname === '/encargados/';
const foremanToken = foremanTokenFromUrl || (isForemanAppRoute ? (() => {
  try {
    const stored = localStorage.getItem(FOREMAN_DEVICE_TOKEN_KEY)?.trim() || '';
    if (stored) return stored;
  } catch {}
  const cookieToken = readForemanTokenCookie();
  if (cookieToken) {
    try { localStorage.setItem(FOREMAN_DEVICE_TOKEN_KEY, cookieToken); } catch {}
    return cookieToken;
  }
  return '';
})() : '');

const RouteLoadingFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
    <div className="text-center">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-[#00548E]" />
      <p className="mt-3 text-sm font-semibold text-slate-600 dark:text-slate-300">Cargando…</p>
    </div>
  </div>
);

const ForemanUnlinkedScreen = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
    <div className="w-full max-w-md rounded-3xl border border-blue-100 bg-white p-7 text-center shadow-xl">
      <div className="text-xs font-black uppercase tracking-[.15em] text-[#00548E]">PFEA Encargados</div>
      <h1 className="mt-3 text-xl font-black text-slate-900">Este dispositivo no está vinculado</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">Abre una vez el enlace de acceso que te facilite el supervisor. Después, el icono PFEA Encargados abrirá directamente tu portal.</p>
      <button type="button" onClick={() => window.location.href = '/'} className="mt-5 min-h-[52px] w-full rounded-2xl bg-[#00548E] px-4 py-3 text-base font-black text-white">Volver a GestionProfea</button>
    </div>
  </div>
);

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <>
        <AppDialogHost />
        {visitToken ? (
        <React.Suspense fallback={<RouteLoadingFallback />}><VisitMinutesPortal token={visitToken}/></React.Suspense>
      ) : isMedicalConfirmation ? (
        <React.Suspense fallback={<RouteLoadingFallback />}><MedicalAppointmentConfirmationPortal /></React.Suspense>
      ) : foremanToken ? (
        <React.Suspense fallback={<RouteLoadingFallback />}><ForemanMobilePortal token={foremanToken} /></React.Suspense>
      ) : isForemanAppRoute ? (
        <ForemanUnlinkedScreen />
      ) : workerQrToken ? (
        <React.Suspense fallback={<RouteLoadingFallback />}><WorkerQrPortal token={workerQrToken} /></React.Suspense>
      ) : remoteScannerToken ? (
        <React.Suspense fallback={<RouteLoadingFallback />}><RemoteScannerPortal token={remoteScannerToken} /></React.Suspense>
      ) : (
        <AuthGate>
          {workerQrDni ? (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
              <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-7 text-center shadow-xl">
                <h1 className="text-lg font-black text-slate-900">Código QR antiguo</h1>
                <p className="mt-2 text-sm text-slate-600">Genera de nuevo la ficha del trabajador para sustituir este QR por el nuevo acceso independiente.</p>
              </div>
            </div>
          ) : (
            <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950"><div className="text-sm text-slate-500">Cargando aplicación…</div></div>}>
              <App />
              <AppToastHost />
              <AppInstallPromo />
              <DeferredAppEnhancements />
            </React.Suspense>
          )}
        </AuthGate>
      )}
      </>
    </RootErrorBoundary>
  </React.StrictMode>
);
