import React, { useEffect, useMemo, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};
type DeviceKind = 'ios' | 'android' | 'windows' | 'mac' | 'linux' | 'other';
type BrowserKind = 'edge' | 'chrome' | 'safari' | 'firefox' | 'other';

declare global {
  interface Window {
    __profeaInstallPrompt?: DeferredInstallPrompt;
    __profeaInstallCaptureReady?: boolean;
  }
}

const DISMISS_KEY = 'profea_install_promo_v4_dismissed_at';
const DISMISS_TTL = 7 * 24 * 60 * 60 * 1000;
const PROMPT_READY_EVENT = 'profea:install-prompt-ready';
const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

// Captura el evento al importar el módulo, antes de montar React, para no perder el
// diálogo nativo si Chromium determina pronto que la PWA ya es instalable.
if (typeof window !== 'undefined' && !window.__profeaInstallCaptureReady) {
  window.__profeaInstallCaptureReady = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    window.__profeaInstallPrompt = event as DeferredInstallPrompt;
    window.dispatchEvent(new Event(PROMPT_READY_EVENT));
  });
  window.addEventListener('appinstalled', () => {
    delete window.__profeaInstallPrompt;
  });
}

const detectEnvironment = () => {
  const userAgent = navigator.userAgent.toLowerCase();
  const platform = String(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      navigator.platform ||
      '',
  ).toLowerCase();
  let device: DeviceKind = 'other';
  if (/iphone|ipad|ipod/.test(userAgent) || (platform.includes('mac') && navigator.maxTouchPoints > 1)) device = 'ios';
  else if (userAgent.includes('android')) device = 'android';
  else if (userAgent.includes('windows') || platform.includes('win')) device = 'windows';
  else if (userAgent.includes('mac')) device = 'mac';
  else if (userAgent.includes('linux')) device = 'linux';

  let browser: BrowserKind = 'other';
  if (userAgent.includes('edg/')) browser = 'edge';
  else if (userAgent.includes('firefox')) browser = 'firefox';
  else if (userAgent.includes('chrome') || userAgent.includes('crios')) browser = 'chrome';
  else if (userAgent.includes('safari')) browser = 'safari';
  return { device, browser };
};

export function AppInstallPromo() {
  const [installPrompt, setInstallPrompt] = useState<DeferredInstallPrompt | null>(() => window.__profeaInstallPrompt ?? null);
  const [visible, setVisible] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const environment = useMemo(detectEnvironment, []);

  useEffect(() => {
    if (isStandalone()) return;
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
    const canShowAutomatically = !dismissedAt || Date.now() - dismissedAt >= DISMISS_TTL;
    const promptReady = () => {
      setInstallPrompt(window.__profeaInstallPrompt ?? null);
      if (canShowAutomatically) window.setTimeout(() => setVisible(true), 300);
    };
    const installed = () => {
      setInstallPrompt(null);
      setVisible(false);
      localStorage.removeItem(DISMISS_KEY);
    };
    const open = () => {
      if (!isStandalone()) {
        setInstallPrompt(window.__profeaInstallPrompt ?? null);
        setVisible(true);
        setShowHelp(false);
      }
    };
    window.addEventListener(PROMPT_READY_EVENT, promptReady);
    window.addEventListener('appinstalled', installed);
    window.addEventListener('profea:open-install', open);
    const timer = canShowAutomatically ? window.setTimeout(() => setVisible(true), 1400) : 0;
    return () => {
      window.removeEventListener(PROMPT_READY_EVENT, promptReady);
      window.removeEventListener('appinstalled', installed);
      window.removeEventListener('profea:open-install', open);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const install = async () => {
    const nativePrompt = installPrompt ?? window.__profeaInstallPrompt ?? null;
    if (!nativePrompt) {
      setShowHelp(true);
      return;
    }
    try {
      // Debe ejecutarse directamente desde el clic: es el gesto exigido por el navegador.
      await nativePrompt.prompt();
      const choice = await nativePrompt.userChoice;
      delete window.__profeaInstallPrompt;
      setInstallPrompt(null);
      if (choice.outcome === 'accepted') setVisible(false);
    } catch {
      setShowHelp(true);
    }
  };

  if (!visible || isStandalone()) return null;
  const helpText: Record<DeviceKind, string> = {
    ios: 'En iPhone/iPad: abre PROFEA en Safari, pulsa Compartir → Añadir a pantalla de inicio → Añadir.',
    android: 'En Android: usa Chrome o Edge y pulsa ⋮ → Instalar aplicación o Añadir a pantalla de inicio.',
    windows: 'En Windows: usa Edge o Chrome y pulsa Instalar en la barra de direcciones; también puedes usar ⋮ → Aplicaciones → Instalar PROFEA.',
    mac: environment.browser === 'safari' ? 'En Safari: Archivo → Añadir al Dock. En Chrome o Edge usa Instalar en la barra de direcciones.' : 'En Mac: usa Instalar en Chrome o Edge. En Safari compatible: Archivo → Añadir al Dock.',
    linux: 'En Chrome, Edge o Chromium usa Instalar desde la barra de direcciones o el menú.',
    other: 'Usa Instalar aplicación o Añadir a pantalla de inicio desde el menú del navegador.',
  };
  const deviceLabel: Record<DeviceKind, string> = { ios: 'iPhone/iPad', android: 'Android', windows: 'Windows', mac: 'Mac', linux: 'Linux', other: 'este dispositivo' };

  return (
    <aside className="profea-install-promo no-print" aria-label="Instalar PROFEA">
      <div className="profea-install-promo__icon" aria-hidden="true"><img src="/icons/profea-icon-v4-192.png" alt="" /></div>
      <div className="profea-install-promo__copy">
        <span className="profea-install-promo__title">Instala PROFEA</span>
        <span className="profea-install-promo__text">{showHelp ? helpText[environment.device] : `Dispositivo detectado: ${deviceLabel[environment.device]}. Instala PROFEA con el nuevo icono.`}</span>
      </div>
      <div className="profea-install-promo__actions">
        <button type="button" className="profea-install-promo__button" onClick={install}>
          {environment.device === 'ios' && !installPrompt ? <Share size={14} className="inline mr-1" /> : <Download size={14} className="inline mr-1" />}
          {installPrompt ? 'Instalar PROFEA' : 'Cómo instalar'}
        </button>
        <button type="button" className="profea-install-promo__dismiss" onClick={() => { localStorage.setItem(DISMISS_KEY, String(Date.now())); setVisible(false); }} aria-label="Ahora no"><X size={16} /></button>
      </div>
    </aside>
  );
}
