import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Ban, CheckCircle2, Copy, Loader2, QrCode, RefreshCw, X } from 'lucide-react';
import QRCode from 'qrcode';
import {
  createForemanPortalAccess,
  getForemanPortalAccessStatus,
  revokeForemanPortalAccess,
} from '../src/services/foremanPortalService';

type AccessState = {
  loaded: boolean;
  exists: boolean;
  active: boolean;
  lastUsedAt?: string | null;
};

const storageKeyFor = (obra: string) =>
  `profea:foreman-access-url:${String(obra || '').trim().toLocaleLowerCase('es')}`;

const qrDataUrl = (accessUrl: string) =>
  QRCode.toDataURL(accessUrl, {
    errorCorrectionLevel: 'H',
    width: 768,
    margin: 2,
  });

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export const ForemanAccessButton: React.FC<{
  obra: string;
  foremanName: string;
  phone?: string;
  display?: 'icon' | 'card';
}> = ({ obra, foremanName, display = 'icon' }) => {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [access, setAccess] = useState<AccessState>({
    loaded: false,
    exists: false,
    active: false,
  });

  const storageKey = useMemo(() => storageKeyFor(obra), [obra]);

  const loadStatus = async () => {
    if (!obra.trim()) return;
    setError('');
    try {
      const status = await getForemanPortalAccessStatus(obra);
      setAccess({
        loaded: true,
        exists: status.exists,
        active: status.active,
        lastUsedAt: status.lastUsedAt,
      });

      if (!status.active) {
        setUrl('');
        setQr('');
        window.localStorage.removeItem(storageKey);
        return;
      }

      const storedUrl = window.localStorage.getItem(storageKey) || '';
      if (storedUrl) {
        setUrl(storedUrl);
        setQr(await qrDataUrl(storedUrl));
      }
    } catch (caught) {
      console.error('No se pudo comprobar el acceso del encargado:', caught);
      setError(errorMessage(caught, 'No se pudo comprobar el estado del acceso.'));
      setAccess((current) => ({ ...current, loaded: true }));
    }
  };

  useEffect(() => {
    void loadStatus();
  }, [obra, storageKey]);

  const generateAccess = async (openModal = true) => {
    if (!foremanName.trim()) {
      setError('Asigna primero un encargado o recurso preventivo a esta obra.');
      return '';
    }

    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const token = await createForemanPortalAccess(obra, foremanName);
      const next = `${window.location.origin}/?encargado=${encodeURIComponent(token)}`;
      const nextQr = await qrDataUrl(next);
      setUrl(next);
      setQr(nextQr);
      window.localStorage.setItem(storageKey, next);
      setAccess({ loaded: true, exists: true, active: true, lastUsedAt: null });
      if (openModal) setOpen(true);
      return next;
    } catch (caught) {
      console.error('No se pudo generar el acceso del encargado:', caught);
      setError(errorMessage(caught, 'No se pudo generar el código QR. Inténtalo de nuevo.'));
      return '';
    } finally {
      setBusy(false);
    }
  };

  const confirmNewAccess = () =>
    window.confirm(
      access.exists
        ? 'Se generará un acceso nuevo. El código QR y el enlace anteriores dejarán de funcionar. ¿Continuar?'
        : 'Se generará el acceso móvil del encargado para esta obra. ¿Continuar?',
    );

  const ensureShareableUrl = async (openModal: boolean) => {
    if (url) {
      if (!qr) setQr(await qrDataUrl(url));
      if (openModal) setOpen(true);
      return url;
    }

    if (!confirmNewAccess()) return '';
    return generateAccess(openModal);
  };

  const showQr = async () => {
    setError('');
    try {
      await ensureShareableUrl(true);
    } catch (caught) {
      console.error('No se pudo mostrar el código QR:', caught);
      setError(errorMessage(caught, 'No se pudo mostrar el código QR. Inténtalo de nuevo.'));
    }
  };

  const writeToClipboard = async (value: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copiedWithFallback = document.execCommand('copy');
    textarea.remove();
    if (!copiedWithFallback) throw new Error('El navegador no permitió copiar el enlace.');
  };

  const copyAccessLink = async () => {
    setError('');
    setCopied(false);
    try {
      const accessUrl = await ensureShareableUrl(false);
      if (!accessUrl) return;
      await writeToClipboard(accessUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch (caught) {
      console.error('No se pudo copiar el enlace:', caught);
      setError(errorMessage(caught, 'No se pudo copiar el enlace.'));
    }
  };

  const revokeAccess = async () => {
    if (!access.active) return;
    const ok = window.confirm(
      '¿Desautorizar este acceso? El enlace y el código QR dejarán de funcionar inmediatamente.',
    );
    if (!ok) return;

    setBusy(true);
    setError('');
    try {
      await revokeForemanPortalAccess(obra);
      setAccess((current) => ({ ...current, loaded: true, exists: true, active: false }));
      setUrl('');
      setQr('');
      setCopied(false);
      window.localStorage.removeItem(storageKey);
      setOpen(false);
    } catch (caught) {
      console.error('No se pudo desautorizar el acceso:', caught);
      setError(errorMessage(caught, 'No se pudo desautorizar el acceso. Inténtalo de nuevo.'));
    } finally {
      setBusy(false);
    }
  };

  if (display !== 'card') {
    return (
      <button
        type="button"
        onClick={() => void showQr()}
        disabled={busy || !foremanName}
        className="p-1.5 text-slate-400 hover:text-[#00548E] hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg"
        title={access.active ? 'Mostrar código QR' : 'Generar código QR'}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
      </button>
    );
  }

  return (
    <>
      <div className={`rounded-xl border p-3 ${
        access.active
          ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/20'
          : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/30'
      }`}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <QrCode className="w-4 h-4 text-[#00548E] dark:text-blue-300 shrink-0" />
                <span className="text-xs font-black text-slate-900 dark:text-white">
                  Acceso a documentación del encargado
                </span>
                {!access.loaded ? (
                  <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black text-slate-500">
                    <Loader2 className="w-3 h-3 animate-spin" /> Comprobando
                  </span>
                ) : access.active ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-white px-2 py-1 text-[10px] font-black text-emerald-700">
                    <CheckCircle2 className="w-3 h-3" /> ACCESO ACTIVO
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-white px-2 py-1 text-[10px] font-black text-rose-700">
                    <Ban className="w-3 h-3" /> DESAUTORIZADO
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                {!foremanName
                  ? 'Falta asignar un encargado/recurso preventivo.'
                  : access.active
                    ? 'El encargado puede acceder a esta obra hasta que pulses Desautorizar acceso.'
                    : 'Genera un QR nuevo para autorizar el acceso a la documentación de esta obra.'}
              </p>
              {access.active && access.lastUsedAt && (
                <p className="mt-1 text-[10px] font-semibold text-slate-500">
                  Último acceso registrado: {new Date(access.lastUsedAt).toLocaleString('es-ES')}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => void loadStatus()}
              disabled={busy}
              className="self-start inline-flex items-center gap-1.5 rounded-lg border bg-white dark:bg-slate-900 px-2.5 py-2 text-[11px] font-bold"
              title="Actualizar estado del acceso"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Actualizar
            </button>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {foremanName && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => void showQr()}
                disabled={busy}
                className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] text-white px-3 py-2.5 text-xs font-black disabled:opacity-60"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                Generar QR
              </button>
              <button
                type="button"
                onClick={() => void copyAccessLink()}
                disabled={busy}
                className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border border-blue-300 bg-white px-3 py-2.5 text-xs font-black text-[#00548E] disabled:opacity-60"
              >
                {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Enlace copiado' : 'Copiar enlace'}
              </button>
              <button
                type="button"
                onClick={() => void revokeAccess()}
                disabled={busy || !access.active}
                className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border-2 border-rose-300 bg-white text-rose-700 px-3 py-2.5 text-xs font-black disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:opacity-70"
              >
                <Ban className="w-4 h-4" />
                Desautorizar acceso
              </button>
            </div>
          )}
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 sm:p-4">
          <div className="flex h-full w-full flex-col overflow-y-auto bg-white p-4 shadow-2xl dark:bg-slate-900 sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:max-w-xl sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-black sm:text-lg">Código QR del encargado</h3>
                <p className="mt-1 text-sm text-slate-500 sm:text-xs">{obra} · {foremanName}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="p-3 rounded-xl border" aria-label="Cerrar código QR">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 inline-flex self-start items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">
              <CheckCircle2 className="w-4 h-4" /> Acceso activo hasta que lo desautorices
            </div>

            <p className="mx-auto mt-4 max-w-md text-center text-sm font-semibold text-slate-700 dark:text-slate-200">
              Muéstrale este código al encargado para que lo escanee con la cámara de su móvil.
            </p>

            {qr && (
              <img
                src={qr}
                alt={`Código QR de acceso a la obra ${obra}`}
                className="mx-auto my-4 aspect-square w-[min(88vw,440px)] rounded-2xl border-4 border-white bg-white p-2 shadow-lg"
              />
            )}

            <div className="rounded-xl bg-slate-50 p-3 text-xs break-all dark:bg-slate-800">{url}</div>
            <div className="grid grid-cols-1 gap-2 mt-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void copyAccessLink()}
                className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-black"
              >
                {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Enlace copiado' : 'Copiar enlace'}
              </button>
              <button
                type="button"
                onClick={() => void revokeAccess()}
                disabled={busy}
                className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-xl border-2 border-rose-300 px-3 py-3 text-sm font-black text-rose-700 disabled:opacity-60"
              >
                <Ban className="w-4 h-4" /> Desautorizar acceso
              </button>
            </div>
            {error && (
              <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <p className="mt-4 text-[11px] text-slate-500">
              Al desautorizar, este enlace y este código QR dejan de funcionar inmediatamente. Si generas otro acceso, se creará un código nuevo.
            </p>
          </div>
        </div>
      )}
    </>
  );
};
