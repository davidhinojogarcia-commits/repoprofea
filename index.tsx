import React from 'react';
import ReactDOM from 'react-dom/client';
import { jsPDF } from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';
import { AuthGate } from './components/AuthGate';
import { AppToastHost } from './components/AppToastHost';
import { AppDialogHost } from './components/AppDialogHost';
import { AppInstallPromo } from './components/AppInstallPromo';
import { AnnualHiringPeriodsPanel } from './components/AnnualHiringPeriodsPanel';
import { UiWorkflowEnhancements } from './components/UiWorkflowEnhancements';
import { ExportRenunciationEnhancer } from './components/ExportRenunciationEnhancer';
import { AdministrativeDataAssignmentBridge } from './components/AdministrativeDataAssignmentBridge';
import { DirectoryAdministrativeExportBridge } from './components/DirectoryAdministrativeExportBridge';
import { CompleteBackupDownloadBridge } from './components/CompleteBackupDownloadBridge';
import { PrlTrainingScheduleBridge } from './components/PrlTrainingScheduleBridge';
import { MedicalAppointmentConfirmationPortal } from './components/MedicalAppointmentConfirmationPortal';
import { WorkerQrPortal } from './components/WorkerQrPortal';
import { RemoteScannerPortal } from './components/RemoteScannerPortal';
import { ForemanMobilePortal } from './components/ForemanMobilePortal';
import { SaeRenunciationBridge } from './components/SaeRenunciationBridge';
import { installModalRuntime } from './src/lib/modalRuntime';
import { installAppDialogRuntime } from './src/lib/appDialog';
import { installButtonSounds } from './src/lib/uiSounds';
import { installSidebarSwipe } from './src/lib/sidebarSwipe';
import { initializeOfflineSync } from './src/lib/supabase';
import './src/lib/worksiteAdditionalDocumentsLegalBodies';
import './src/styles/design-system.css';
import './notification-modal-layout.css';
import './subcontratas-mobile.css';
import './institutional-polish.css';
import './dark-mode-hardening.css';
import './medical-citations-contrast.css';
import './guided-mobile-accessibility.css';
import './accessibility-contrast.css';

applyPlugin(jsPDF);
(jsPDF as any).autoTableSetDefaults?.({
  didParseCell: (data: any) => {
    if (data?.section !== 'head' || !data?.cell) return;
    const original = Array.isArray(data.cell.text) ? data.cell.text.join(' ').trim() : String(data.cell.text || '').trim();
    const normalized = original.toUpperCase().replace(/\s+/g, ' ');
    const replacements: Record<string, string> = {
      'CONF.': 'CONFIRMACIÓN',
      'CONF': 'CONFIRMACIÓN',
      'TRABAJADOR / DNI / NAC.': 'TRABAJADOR / DNI / NACIMIENTO',
      'TRABAJADOR/DNI/NAC.': 'TRABAJADOR / DNI / NACIMIENTO',
      'SITIO RECONOCIMIENTO': 'SITIO RECONOCIMIENTO MÉDICO',
    };
    const completeText = replacements[normalized] || original;
    data.cell.text = [completeText];
    const words = completeText.split(/\s+/).filter(Boolean);
    const longestWord = words.reduce((max: number, word: string) => Math.max(max, word.length), 0);
    data.cell.styles.overflow = 'linebreak';
    data.cell.styles.halign = 'center';
    data.cell.styles.valign = 'middle';
    data.cell.styles.fontStyle = 'bold';
    data.cell.styles.cellPadding = 1.15;
    data.cell.styles.minCellHeight = Math.max(Number(data.cell.styles.minCellHeight || 0), 9);
    if (completeText.length >= 30 || longestWord >= 16) data.cell.styles.fontSize = 5.6;
    else if (completeText.length >= 20 || longestWord >= 12) data.cell.styles.fontSize = 6.0;
    else data.cell.styles.fontSize = 6.5;
  },
});

if (typeof globalThis !== 'undefined') {
  const runtime = globalThis as any;
  runtime['handle' + 'GoogleLogin'] ??= async () => { window.alert('La conexión con Google Drive está deshabilitada en esta versión.'); };
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
    navigator.serviceWorker
      .register('/service-worker.js', { updateViaCache: 'none' })
      .then((registration) => registration.update().catch(() => undefined))
      .catch((error) => { console.warn('No se pudo registrar el service worker de PROFEA:', error); });
  });
}
const initialSearchParams = new URLSearchParams(window.location.search);
const isMedicalConfirmation = initialSearchParams.get('confirmacion_reconocimiento') === '1';
const remoteScannerToken = initialSearchParams.get('remote-scanner')?.trim() || '';
const workerQrToken = initialSearchParams.get('worker-qr')?.trim() || '';
const workerQrDni = initialSearchParams.get('view-worker-pdf')?.trim() || '';
const FOREMAN_DEVICE_TOKEN_KEY = 'pfea_foreman_device_token_v1';
const foremanTokenFromUrl = initialSearchParams.get('encargado')?.trim() || '';
if (foremanTokenFromUrl) {
  try { localStorage.setItem(FOREMAN_DEVICE_TOKEN_KEY, foremanTokenFromUrl); } catch {}
}
const isForemanAppRoute = window.location.pathname === '/encargados' || window.location.pathname === '/encargados/';
const foremanToken = foremanTokenFromUrl || (isForemanAppRoute ? (() => {
  try { return localStorage.getItem(FOREMAN_DEVICE_TOKEN_KEY)?.trim() || ''; } catch { return ''; }
})() : '');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <>
        <AppDialogHost />
        {isMedicalConfirmation ? (
        <MedicalAppointmentConfirmationPortal />
      ) : (foremanToken || isForemanAppRoute) ? (
        <ForemanMobilePortal token={foremanToken} />
      ) : workerQrToken ? (
        <WorkerQrPortal token={workerQrToken} />
      ) : remoteScannerToken ? (
        <RemoteScannerPortal token={remoteScannerToken} />
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
              <AnnualHiringPeriodsPanel />
              <UiWorkflowEnhancements />
              <ExportRenunciationEnhancer />
              <AdministrativeDataAssignmentBridge />
              <DirectoryAdministrativeExportBridge />
              <CompleteBackupDownloadBridge />
              <PrlTrainingScheduleBridge />
              <SaeRenunciationBridge />
              <AppToastHost />
              <AppInstallPromo />
            </React.Suspense>
          )}
        </AuthGate>
      )}
      </>
    </RootErrorBoundary>
  </React.StrictMode>
);