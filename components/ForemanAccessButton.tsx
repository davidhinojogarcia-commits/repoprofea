import React, { useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle2, Copy, Loader2, MessageCircle, QrCode, RefreshCw, X } from 'lucide-react';
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

export const ForemanAccessButton: React.FC<{
  obra: string;
  foremanName: string;
  phone?: string;
  display?: 'icon' | 'card';
}> = ({ obra, foremanName, phone, display = 'icon' }) => {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [qr, setQr] = useState('');
  const [access, setAccess] = useState<AccessState>({
    loaded: false,
    exists: false,
    active: false,
  });

  const storageKey = useMemo(() => storageKeyFor(obra), [obra]);

  const loadStatus = async () => {
    if (!obra.trim()) return;
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
        setQr(await QRCode.toDataURL(storedUrl, { width: 320, margin: 1 }));
      }
    } catch (error) {
      console.error('No se pudo comprobar el acceso del encargado:', error);
      setAccess((current) => ({ ...current, loaded: true }));
    }
  };

  useEffect(() => {
    void loadStatus();
  }, [obra, storageKey]);

  const generateAccess = async (openModal = true) => {
    if (!foremanName.trim()) {
      window.alert('Asigna primero un encargado o recurso preventivo a esta obra.');
      return '';
    }
    setBusy(true);
    try {
      const token = await createForemanPortalAccess(obra, foremanName);
      const next = `${window.location.origin}/?encargado=${encodeURIComponent(token)}`;
      const nextQr = await QRCode.toDataURL(next, { width: 320, margin: 1 });
      setUrl(next);
      setQr(nextQr);
      window.localStorage.setItem(storageKey, next);
      setAccess({ loaded: true, exists: true, active: true, lastUsedAt: null });
      if (openModal) setOpen(true);
      return next;
    } finally {
      setBusy(false);
    }
  };

  const authorizeAgain = async () => {
    if (!foremanName.trim()) {
      window.alert('Asigna primero un encargado o recurso preventivo a esta obra.');
      return;
    }
    const ok = window.confirm(
      access.exists
        ? 'Se generará un acceso nuevo para este encargado. Cualquier enlace o QR anterior seguirá desautorizado. ¿Continuar?'
        : 'Se generará el acceso móvil del encargado para esta obra. ¿Continuar?',
    );
    if (!ok) return;
    await generateAccess(true);
  };

  const revokeAccess = async () => {
    if (!access.active) return;
    const ok = window.confirm(
      '¿Desautorizar el acceso del encargado a la documentación de esta obra? El enlace y QR actuales dejarán de funcionar inmediatamente.',
    );
    if (!ok) return;

    setBusy(true);
    try {
      await revokeForemanPortalAccess(obra);
      setAccess((current) => ({ ...current, loaded: true, exists: true, active: false }));
      setUrl('');
      setQr('');
      window.localStorage.removeItem(storageKey);
      setOpen(false);
    } catch (error) {
      console.error('No se pudo desautorizar el acceso:', error);
      window.alert('No se pudo desautorizar el acceso. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const whatsappUrl = (accessUrl: string) => {
    const digits = String(phone || '').replace(/\D/g, '');
    const normalized = digits.length === 9 ? `34${digits}` : digits;
    const text = [
      `Hola ${foremanName || ''},`,
      '',
      `te envío el acceso móvil a la documentación de la obra ${obra}.`,
      'El acceso permanecerá activo hasta que el supervisor lo desautorice.',
      accessUrl,
    ].join('\n');
    return normalized
      ? `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
  };

  const ensureShareableUrl = async () => {
    if (url) return url;
    if (access.active) {
      const ok = window.confirm(
        'El acceso está activo, pero este dispositivo no conserva el enlace original. Para volver a compartirlo hay que generar un acceso nuevo, lo que inutilizará el enlace anterior. ¿Continuar?',
      );
      if (!ok) return '';
    }
    return generateAccess(false);
  };

  const sendByWhatsApp = async () => {
    if (!foremanName.trim()) {
      window.alert('Asigna primero un encargado o recurso preventivo a esta obra.');
      return;
    }

    const popup = window.open('about:blank', '_blank');
    try {
      const accessUrl = await ensureShareableUrl();
      if (!accessUrl) {
        popup?.close();
        return;
      }
      const target = whatsappUrl(accessUrl);
      if (popup) popup.location.href = target;
      else window.location.href = target;
    } catch (error) {
      popup?.close();
      console.error('No se pudo preparar el acceso del encargado:', error);
      window.alert('No se pudo generar el acceso móvil del encargado. Inténtalo de nuevo.');
    }
  };

  const openAccess = async () => {
    if (url) {
      if (!qr) setQr(await QRCode.toDataURL(url, { width: 320, margin: 1 }));
      setOpen(true);
      return;
    }
    await authorizeAgain();
  };

  if (display !== 'card') {
    return (
      <button
        type="button"
        onClick={() => void sendByWhatsApp()}
        disabled={busy || !foremanName}
        className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg"
        title={access.active ? 'Enviar acceso móvil por WhatsApp' : 'Autorizar y enviar acceso móvil'}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
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
                    ? 'El encargado puede acceder a esta obra hasta que el supervisor pulse Desautorizar acceso.'
                    : 'El encargado no puede abrir la documentación de esta obra. Puedes autorizarlo de nuevo cuando quieras.'}
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

          {foremanName && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {access.active ? (
                <>
                  <button
                    type="button"
                    onClick={() => void openAccess()}
                    disabled={busy}
                    className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-white px-3 py-2.5 text-xs font-black text-emerald-800"
                  >
                    <QrCode className="w-4 h-4" />
                    {url ? 'Ver QR / enlace' : 'Generar nuevo QR'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void sendByWhatsApp()}
                    disabled={busy}
                    className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white px-3 py-2.5 text-xs font-black"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                    Enviar por WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => void revokeAccess()}
                    disabled={busy}
                    className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border-2 border-rose-300 bg-white text-rose-700 px-3 py-2.5 text-xs font-black"
                  >
                    <Ban className="w-4 h-4" />
                    Desautorizar acceso
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void authorizeAgain()}
                  disabled={busy}
                  className="sm:col-span-2 xl:col-span-3 min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] text-white px-4 py-3 text-sm font-black"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {access.exists ? 'Autorizar de nuevo' : 'Autorizar acceso'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[120] bg-slate-950/60 p-4 flex items-center justify-center">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black">Acceso móvil del encargado</h3>
                <p className="text-xs text-slate-500 mt-1">{obra} · {foremanName}</p>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 rounded-xl border">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">
              <CheckCircle2 className="w-4 h-4" /> Acceso activo hasta que lo desautorices
            </div>

            {qr && <img src={qr} alt="QR acceso encargado" className="mx-auto my-5 w-64 h-64 rounded-2xl border bg-white p-2" />}
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-xs break-all">{url}</div>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                onClick={() => navigator.clipboard?.writeText(url)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-black"
              >
                <Copy className="w-4 h-4" /> Copiar enlace
              </button>
              <button
                onClick={() => void sendByWhatsApp()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white px-3 py-3 text-sm font-black"
              >
                <MessageCircle className="w-4 h-4" /> WhatsApp
              </button>
              <button
                onClick={() => void revokeAccess()}
                className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border-2 border-rose-300 text-rose-700 px-3 py-3 text-sm font-black"
              >
                <Ban className="w-4 h-4" /> Desautorizar acceso
              </button>
            </div>
            <p className="mt-4 text-[11px] text-slate-500">
              Al desautorizar, este enlace y este QR dejan de funcionar. Si vuelves a autorizar al encargado se generará un acceso nuevo.
            </p>
          </div>
        </div>
      )}
    </>
  );
};
