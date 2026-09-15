import React, { useEffect, useMemo, useState } from "react";
import { Download, Share, X } from "lucide-react";

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type DeviceKind = "ios" | "android" | "windows" | "mac" | "other";

const DISMISS_KEY = "profea_install_promo_v2_dismissed_at";
const DISMISS_TTL = 14 * 24 * 60 * 60 * 1000;

const detectDevice = (): DeviceKind => {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent.toLowerCase();
  const platform = String(
    (navigator as any).userAgentData?.platform || navigator.platform || "",
  ).toLowerCase();
  if (
    /iphone|ipad|ipod/.test(ua) ||
    (platform.includes("mac") && navigator.maxTouchPoints > 1)
  )
    return "ios";
  if (ua.includes("android")) return "android";
  if (ua.includes("windows") || platform.includes("win")) return "windows";
  if (ua.includes("macintosh") || platform.includes("mac")) return "mac";
  return "other";
};

export function AppInstallPromo() {
  const [installPrompt, setInstallPrompt] =
    useState<DeferredInstallPrompt | null>(null);
  const [visible, setVisible] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const device = useMemo(detectDevice, []);

  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true;
    if (isStandalone) return;

    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || "0");
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL) return;

    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as DeferredInstallPrompt);
      window.setTimeout(() => setVisible(true), 500);
    };
    const installed = () => {
      setInstallPrompt(null);
      setVisible(false);
      localStorage.removeItem(DISMISS_KEY);
    };

    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    const fallbackTimer = window.setTimeout(() => setVisible(true), 1500);

    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  const handleInstall = async () => {
    // Chromium on Windows/Android/macOS exposes the real native PWA installer here.
    if (installPrompt) {
      try {
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        if (choice.outcome === "accepted") setVisible(false);
        setInstallPrompt(null);
      } catch {
        setShowHelp(true);
      }
      return;
    }

    // iOS/Safari does not expose a programmatic install API; show the exact native path.
    setShowHelp(true);
  };

  if (!visible) return null;

  const helpText: Record<DeviceKind, string> = {
    ios: "En iPhone/iPad: pulsa Compartir en Safari y después “Añadir a pantalla de inicio”. iOS exige esta confirmación manual.",
    android:
      "En Android: abre PROFEA en Chrome y pulsa ⋮ → “Instalar aplicación” o “Añadir a pantalla de inicio”.",
    windows:
      "En Windows: abre PROFEA en Edge o Chrome y pulsa el icono Instalar de la barra de direcciones; también puedes usar ⋮ → Aplicaciones → Instalar PROFEA.",
    mac: "En Mac: usa Chrome/Edge y pulsa Instalar en la barra de direcciones. En Safari compatible usa Archivo → Añadir al Dock.",
    other:
      "Usa la opción “Instalar aplicación” o “Añadir a pantalla de inicio” de tu navegador.",
  };

  const deviceLabel: Record<DeviceKind, string> = {
    ios: "iPhone/iPad",
    android: "Android",
    windows: "Windows",
    mac: "Mac",
    other: "este dispositivo",
  };

  return (
    <aside
      className="profea-install-promo no-print"
      aria-label="Instalar aplicación PROFEA"
    >
      <div className="profea-install-promo__icon" aria-hidden="true">
        <img src="/logo-diputacion-profea.svg" alt="" />
      </div>
      <div className="profea-install-promo__copy">
        <span className="profea-install-promo__title">Instalar PROFEA</span>
        <span className="profea-install-promo__text">
          {showHelp
            ? helpText[device]
            : `Dispositivo detectado: ${deviceLabel[device]}. Instala PROFEA con el icono oficial de Diputación de Cádiz.`}
        </span>
      </div>
      <div className="profea-install-promo__actions">
        <button
          type="button"
          className="profea-install-promo__button"
          onClick={handleInstall}
        >
          {device === "ios" && !installPrompt ? (
            <Share size={14} className="inline mr-1" />
          ) : (
            <Download size={14} className="inline mr-1" />
          )}
          {installPrompt ? "Instalar" : "Cómo instalar"}
        </button>
        <button
          type="button"
          className="profea-install-promo__dismiss"
          onClick={dismiss}
          aria-label="Ocultar instalación de PROFEA"
        >
          <X size={16} />
        </button>
      </div>
    </aside>
  );
}
