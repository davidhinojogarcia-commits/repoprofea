import React, { useEffect, useMemo, useState } from 'react';
import { Share, X } from 'lucide-react';

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const DISMISS_KEY = 'profea_install_promo_dismissed_at';
const DISMISS_TTL = 14 * 24 * 60 * 60 * 1000;

export function AppInstallPromo() {
  const [installPrompt, setInstallPrompt] = useState<DeferredInstallPrompt | null>(null);
  const [visible, setVisible] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  const isIos = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }, []);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    const isMobileLike = window.matchMedia('(max-width: 900px)').matches || window.matchMedia('(pointer: coarse)').matches;
    if (isStandalone || !isMobileLike) return;

    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || '0');
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL) return;

    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as DeferredInstallPrompt);
      window.setTimeout(() => setVisible(true), 1800);
    };

    window.addEventListener('beforeinstallprompt', beforeInstall);

    let iosTimer: number | undefined;
    if (isIos) {
      iosTimer = window.setTimeout(() => setVisible(true), 2500);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      if (iosTimer) window.clearTimeout(iosTimer);
    };
  }, [isIos]);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  const handleInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setVisible(false);
      }
      setInstallPrompt(null);
      return;
    }

    if (isIos) {
      setShowIosHelp(true);
    }
  };

  if (!visible) return null;

  return (
    <aside className="profea-install-promo no-print" aria-label="Instalar aplicación PROFEA">
      <div className="profea-install-promo__icon" aria-hidden="true">
        <img src="/favicon.png" alt="" />
      </div>
      <div className="profea-install-promo__copy">
        <span className="profea-install-promo__title">Lleva PROFEA a tu pantalla de inicio</span>
        <span className="profea-install-promo__text">
          {showIosHelp
            ? 'En Safari pulsa Compartir y después “Añadir a pantalla de inicio”.'
            : 'Acceso más directo y una experiencia integrada, con la imagen corporativa de Diputación de Cádiz.'}
        </span>
      </div>
      <div className="profea-install-promo__actions">
        {(installPrompt || isIos) && (
          <button type="button" className="profea-install-promo__button" onClick={handleInstall}>
            {isIos && !installPrompt ? <Share size={14} className="inline mr-1" /> : null}
            {showIosHelp ? 'Entendido' : 'Instalar'}
          </button>
        )}
        <button type="button" className="profea-install-promo__dismiss" onClick={dismiss} aria-label="Ocultar promoción de instalación">
          <X size={16} />
        </button>
      </div>
    </aside>
  );
}
