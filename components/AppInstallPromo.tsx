import React, { useEffect, useMemo, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const DISMISS_KEY = 'profea_install_promo_dismissed_at';
const DISMISS_TTL = 14 * 24 * 60 * 60 * 1000;

export function AppInstallPromo() {
  const [installPrompt, setInstallPrompt] = useState<DeferredInstallPrompt | null>(null);
  const [visible, setVisible] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const isIos = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }, []);

  const isDesktop = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(min-width: 901px)').matches && window.matchMedia('(pointer: fine)').matches;
  }, []);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    if (isStandalone) return;

    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || '0');
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL) return;

    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as DeferredInstallPrompt);
      window.setTimeout(() => setVisible(true), 900);
    };

    const installed = () => {
      setInstallPrompt(null);
      setVisible(false);
    };

    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', installed);

    // En iOS no existe beforeinstallprompt. En escritorio mostramos igualmente
    // el acceso para que el usuario pueda instalar o ver las instrucciones del navegador.
    let fallbackTimer: number | undefined;
    if (isIos || isDesktop) {
      fallbackTimer = window.setTimeout(() => setVisible(true), 1800);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', installed);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
    };
  }, [isDesktop, isIos]);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  const handleInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setVisible(false);
      setInstallPrompt(null);
      return;
    }
    setShowHelp(true);
  };

  if (!visible) return null;

  const helpText = isIos
    ? 'En Safari pulsa Compartir y después “Añadir a pantalla de inicio”.'
    : 'En Windows abre PROFEA con Edge o Chrome y usa el icono Instalar de la barra de direcciones. Si no aparece, abre el menú ⋮ y selecciona “Aplicaciones” o “Instalar PROFEA”.';

  return (
    <aside className="profea-install-promo no-print" aria-label="Instalar aplicación PROFEA">
      <div className="profea-install-promo__icon" aria-hidden="true">
        <img src="/logo-diputacion-profea.png" alt="" />
      </div>
      <div className="profea-install-promo__copy">
        <span className="profea-install-promo__title">Instalar PROFEA</span>
        <span className="profea-install-promo__text">
          {showHelp ? helpText : 'Añade PROFEA a tu dispositivo con el icono oficial de Diputación de Cádiz y ábrela como una aplicación.'}
        </span>
      </div>
      <div className="profea-install-promo__actions">
        <button type="button" className="profea-install-promo__button" onClick={handleInstall}>
          {isIos && !installPrompt ? <Share size={14} className="inline mr-1" /> : <Download size={14} className="inline mr-1" />}
          {showHelp ? 'Ver cómo instalar' : 'Instalar'}
        </button>
        <button type="button" className="profea-install-promo__dismiss" onClick={dismiss} aria-label="Ocultar instalación de PROFEA">
          <X size={16} />
        </button>
      </div>
    </aside>
  );
}
