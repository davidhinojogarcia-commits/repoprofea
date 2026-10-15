import React, { useRef, useState } from 'react';
import { sendInventoryParkInvitationEmail } from '../src/services/inventoryService';
import { sendInventoryInvitationWithConnectedGmail } from '../src/lib/gmailConnection';

// The identifier is a locator, never an access token. Acceptance is checked by the RPC.
export function inventoryInvitationUrl(invitationId: string, origin: string) {
  const url = new URL('/', origin);
  url.searchParams.set('inventoryInvite', invitationId);
  return url.toString();
}

export const InventoryInvitationLink: React.FC<{ invitationId: string; email: string; disabled?: boolean }> = ({ invitationId, email, disabled = false }) => {
  const input = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [channel, setChannel] = useState<'automatic' | 'gmail'>('automatic');
  const url = inventoryInvitationUrl(invitationId, window.location.origin);

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setMessage('Enlace copiado. Compártelo con el compañero invitado.');
    } catch {
      input.current?.focus();
      input.current?.select();
      setMessage('Selecciona y copia el enlace del campo para compartirlo.');
    }
  };
  const retry = async (via: 'automatic' | 'gmail' = 'automatic') => {
    if (disabled || sending.current) return;
    sending.current = true;
    setBusy(true);
    setChannel(via);
    setMessage('');
    try {
      if (via === 'gmail') {
        const result = await sendInventoryInvitationWithConnectedGmail(invitationId);
        setMessage(`Invitación enviada por Gmail desde ${result.from}. El compañero todavía debe aceptarla.`);
      } else {
        await sendInventoryParkInvitationEmail(invitationId);
        setMessage('Correo enviado. El compañero todavía debe aceptar la invitación.');
      }
    } catch (error: any) {
      setMessage(via === 'gmail' ? `${error?.message || 'No se pudo confirmar el envío por Gmail.'} La invitación sigue guardada; también puedes copiar el enlace.` : 'No se pudo enviar el correo. La invitación sigue pendiente: puedes enviarla por Gmail, compartir el enlace o pedir al compañero que entre en Herramientas y maquinaria.');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return <div className="rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/20 p-3 space-y-2 text-xs">
    <p>Invitación pendiente para <b>{email}</b>. El compañero puede abrir este enlace o entrar en <b>Herramientas y maquinaria</b> con su cuenta corporativa y pulsar <b>Aceptar y compartir</b>.</p>
    <label className="block">Enlace de invitación
      <input ref={input} readOnly value={url} onFocus={event => event.currentTarget.select()} className="mt-1 w-full rounded-lg border border-slate-300 bg-white text-slate-900 p-2" />
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => void copy()} className="rounded-lg border border-blue-300 px-3 py-2 font-bold">Copiar enlace</button>
      <button type="button" disabled={busy || disabled} onClick={() => void retry('gmail')} className="rounded-lg bg-blue-700 text-white px-3 py-2 font-bold">{busy && channel === 'gmail' ? 'Enviando por Gmail…' : 'Enviar invitación por Gmail'}</button>
      <button type="button" disabled={busy || disabled} onClick={() => void retry()} className="rounded-lg border border-blue-300 px-3 py-2 font-bold">{busy && channel === 'automatic' ? 'Enviando correo…' : 'Reintentar correo'}</button>
    </div>
    <p className="text-slate-600 dark:text-slate-300">Gmail utiliza la cuenta del supervisor conectada en Configuración. El envío no concede acceso hasta que el compañero acepte.</p>
    {message && <p role="status">{message}</p>}
  </div>;
};
