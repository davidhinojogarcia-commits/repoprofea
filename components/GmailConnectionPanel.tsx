import React, { useEffect, useState } from 'react';
import { CheckCircle2, Link2, Loader2, Mail, ShieldCheck, Unplug } from 'lucide-react';
import {
  beginGmailOAuth,
  disconnectGmail,
  getGmailConnectionStatus,
  type GmailConnectionStatus,
} from '../src/lib/gmailConnection';

interface Props {
  email: string;
}

export const GmailConnectionPanel: React.FC<Props> = ({ email }) => {
  const [status, setStatus] = useState<GmailConnectionStatus>({ connected: false, email: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const next = await getGmailConnectionStatus();
      setStatus(next);
    } catch (error: any) {
      setMessage(error?.message || 'No se pudo consultar Gmail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const params = new URLSearchParams(window.location.search);
    const gmailState = params.get('gmail');
    const gmailMessage = params.get('gmail_message');
    if (gmailState && gmailMessage) {
      setMessage(gmailMessage);
      params.delete('gmail');
      params.delete('gmail_message');
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', next);
    }
  }, []);

  const configuredEmail = String(email || '').trim().toLowerCase();
  const emailMatches = !status.connected || !configuredEmail || status.email.toLowerCase() === configuredEmail;

  return (
    <div className="rounded-2xl border border-sky-200 dark:border-sky-900/70 bg-sky-50/60 dark:bg-sky-950/20 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-[#00548E] dark:text-sky-300" />
            <h3 className="text-sm font-black text-slate-900 dark:text-white">Cuenta Gmail del supervisor</h3>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            Autoriza la cuenta institucional. GestionProfea usará Gmail para enviar correos y, si lo autorizas, leer únicamente los mensajes necesarios para detectar automáticamente la documentación enviada por la administrativa.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {loading ? (
              <span className="inline-flex items-center gap-1.5 font-bold text-slate-500 dark:text-slate-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Comprobando conexión…
              </span>
            ) : status.connected ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 font-black text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" /> Gmail conectado · {status.email}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 font-black text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                {status.reconnectRequired ? 'Gmail necesita renovar el permiso' : 'Gmail sin conectar'}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" /> Sin almacenar la contraseña de Google
            </span>
          </div>
          {!emailMatches && (
            <p className="mt-2 text-xs font-bold text-rose-700 dark:text-rose-300">
              La cuenta conectada no coincide con el correo configurado del supervisor. Desconéctala y autoriza {configuredEmail}.
            </p>
          )}
          {status.connected && !status.canRead && (
            <p className="mt-2 text-xs font-bold text-amber-700 dark:text-amber-300">
              Falta autorizar la lectura de Gmail necesaria para detectar automáticamente los correos de la administrativa.
            </p>
          )}
          {message && <p className="mt-2 text-xs font-semibold text-slate-700 dark:text-slate-200">{message}</p>}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {!status.connected ? (
            <button
              type="button"
              disabled={busy || loading || !(configuredEmail || status.email)}
              onClick={async () => {
                if (!(configuredEmail || status.email)) {
                  setMessage('Guarda primero el correo profesional del supervisor.');
                  return;
                }
                setBusy(true);
                setMessage('');
                try {
                  await beginGmailOAuth(configuredEmail || status.email);
                } catch (error: any) {
                  setMessage(error?.message || 'No se pudo iniciar la conexión con Gmail.');
                  setBusy(false);
                }
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] px-4 py-2.5 text-xs font-black text-white hover:bg-[#00436f] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {status.reconnectRequired ? 'Volver a autorizar Gmail' : 'Conectar con Gmail'}
            </button>
          ) : (
            <>
              {!status.canRead && (
                <button
                  type="button"
                  disabled={busy || loading || !(configuredEmail || status.email)}
                  onClick={async () => {
                    setBusy(true);
                    setMessage('');
                    try {
                      await beginGmailOAuth(configuredEmail || status.email);
                    } catch (error: any) {
                      setMessage(error?.message || 'No se pudo ampliar la autorización de Gmail.');
                      setBusy(false);
                    }
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] px-4 py-2.5 text-xs font-black text-white hover:bg-[#00436f] disabled:opacity-50"
                >
                  <Link2 className="h-4 w-4" />
                  Autorizar detección automática
                </button>
              )}
              <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm(`¿Desconectar la cuenta Gmail ${status.email} de GestionProfea?`)) return;
                setBusy(true);
                setMessage('');
                try {
                  await disconnectGmail();
                  setStatus({ connected: false, email: '' });
                  setMessage('Cuenta Gmail desconectada.');
                } catch (error: any) {
                  setMessage(error?.message || 'No se pudo desconectar Gmail.');
                } finally {
                  setBusy(false);
                }
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-xs font-black text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
              Desconectar Gmail
            </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
