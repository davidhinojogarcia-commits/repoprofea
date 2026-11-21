import React, { useEffect, useState } from 'react';
import { Clipboard, KeyRound, ShieldCheck } from 'lucide-react';
import type { Person } from '../types';
import {
  getWorkerQrRestrictions, issueWorkerQrVisit, listWorkerQrVisits, revokeWorkerQrVisit, saveWorkerQrRestrictions, workerQrVisitUrl, type WorkerQrVisitGrant,
} from '../src/services/workerQrVisitService';

const control = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

export default function WorkerQrVisitManager({ person, cardUrl }: { person: Person; cardUrl: string }) {
  const [recipient, setRecipient] = useState('');
  const [verified, setVerified] = useState(false);
  const [restrictions, setRestrictions] = useState('');
  const [loadedRestrictions, setLoadedRestrictions] = useState(false);
  const [grants, setGrants] = useState<WorkerQrVisitGrant[]>([]);
  const [invitation, setInvitation] = useState<{ id: string; code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const workerId = Number(person.id);
  const limited = [person.aptitudMedica, person.reconocimientoEstado].some(value => /^apto con limitaci/i.test(value?.trim() || ''));

  useEffect(() => {
    let active = true;
    void listWorkerQrVisits(workerId).then(items => { if (active) setGrants(items); }).catch(() => {
      if (active) setError('No se han podido consultar las visitas activas.');
    });
    return () => { active = false; };
  }, [workerId]);

  const loadRestrictions = async () => {
    if (!limited) return;
    await run(async () => {
      setRestrictions(await getWorkerQrRestrictions(workerId) || '');
      setLoadedRestrictions(true);
    });
  };

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch { setError('No se ha podido completar la acción. Comprueba tus permisos y la conexión.'); }
    finally { setBusy(false); }
  };

  return <section aria-label="Enlaces de visita para carnets QR" className="space-y-4 rounded-xl border border-[#00548E]/25 bg-blue-50/40 p-4 dark:border-blue-800 dark:bg-slate-800/60">
    <h3 className="flex items-center gap-2 font-black text-[#00548E] dark:text-blue-300"><KeyRound className="h-5 w-5" /> Enlace de visita para carnets QR</h3>
    <p className="text-sm leading-relaxed">Obra autorizada <strong>{person.obra || 'Sin obra asignada'}</strong>. El visitante abre el enlace una vez en su móvil. Después, al escanear los carnets de esta obra, cada ficha se abre directamente durante un máximo de 10 minutos.</p>
    <form className="space-y-3" onSubmit={event => {
      event.preventDefault();
      if (!verified) return;
      void run(async () => {
        const next = await issueWorkerQrVisit(workerId, recipient.trim());
        if (!next) throw new Error('Autorización no disponible');
        setInvitation(next);
        setRecipient('');
        setVerified(false);
        setGrants(await listWorkerQrVisits(workerId));
      });
    }}>
      <label className="block space-y-1 text-sm font-bold">Identificación de la persona habilitada
        <input required minLength={8} maxLength={150} autoComplete="off" value={recipient} onChange={event => setRecipient(event.target.value)}
          placeholder="Nombre y organismo o referencia de visita" className={control} />
      </label>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" required checked={verified} onChange={event => setVerified(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#00548E]" />
        <span>He comprobado presencialmente la identidad y la habilitación de esta persona para consultar los datos preventivos y de contratación de la obra.</span>
      </label>
      <button type="submit" disabled={busy || !person.obra?.trim()} className="min-h-11 w-full rounded-xl bg-[#00548E] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Crear enlace de un solo uso</button>
    </form>
    {invitation && <div className="space-y-2 rounded-xl border border-sky-200 bg-white p-3 dark:border-sky-800 dark:bg-slate-900">
      <label className="block space-y-1 text-sm font-bold">Enlace para la persona presente
        <input readOnly value={workerQrVisitUrl(cardUrl, invitation.code)} onFocus={event => event.target.select()} className={control} />
      </label>
      <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-bold" onClick={() => void run(async () => {
        await navigator.clipboard.writeText(workerQrVisitUrl(cardUrl, invitation.code));
        setMessage('Enlace copiado. Compártelo con la persona verificada.');
      })}><Clipboard className="h-4 w-4" /> Copiar enlace</button>
    </div>}
    {grants.map(grant => <div key={grant.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <div className="min-w-0 break-words"><p className="font-bold">{grant.recipient}</p><p>{grant.redeemed ? 'En uso' : 'Por utilizar'} · {new Date(grant.expiresAt).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })}</p></div>
      <button type="button" disabled={busy} className="min-h-11 rounded-lg border px-3 font-bold" onClick={() => void run(async () => {
        if (!await revokeWorkerQrVisit(grant.id)) throw new Error('Revocación no confirmada');
        if (invitation?.id === grant.id) setInvitation(null);
        setGrants(previous => previous.filter(item => item.id !== grant.id));
        setMessage('Visita revocada.');
      })}>Revocar visita</button>
    </div>)}
    {limited && <details onToggle={event => { if (event.currentTarget.open && !loadedRestrictions) void loadRestrictions(); }} className="rounded-xl border bg-white p-3 dark:bg-slate-900">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold"><ShieldCheck className="mr-2 inline h-4 w-4" /> Limitaciones visibles en la ficha</summary>
      <label className="block space-y-2 text-sm">Transcribe únicamente las restricciones de trabajo indicadas en el dictamen, por ejemplo, «No realizar trabajos en altura».
        <textarea disabled={!loadedRestrictions} value={restrictions} onChange={event => setRestrictions(event.target.value)} rows={3} maxLength={600} className={control} />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !loadedRestrictions || !restrictions.trim()} className="min-h-11 rounded-lg border px-3 text-sm font-bold" onClick={() => void run(async () => {
          if (!await saveWorkerQrRestrictions(workerId, restrictions.trim())) throw new Error('Limitaciones no confirmadas');
          setMessage('Limitaciones revisadas guardadas para la consulta temporal.');
        })}>Guardar limitaciones revisadas</button>
        <button type="button" disabled={busy || !loadedRestrictions} className="min-h-11 rounded-lg border px-3 text-sm font-bold" onClick={() => void run(async () => {
          if (!await saveWorkerQrRestrictions(workerId, '')) throw new Error('Retirada no confirmada');
          setRestrictions('');
          setMessage('Detalle retirado de la consulta temporal.');
        })}>Retirar detalle</button>
      </div>
    </details>}
    {error && <p role="alert" className="text-sm font-bold text-red-700 dark:text-red-300">{error}</p>}
    {message && <p role="status" className="text-sm font-bold text-emerald-800 dark:text-emerald-300">{message}</p>}
  </section>;
}
