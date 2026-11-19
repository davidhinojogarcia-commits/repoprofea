import React, { useEffect, useRef, useState } from 'react';
import { BriefcaseBusiness, Clock3, HardHat, HeartPulse, ShieldCheck } from 'lucide-react';
import {
  closeWorkerQrVisit, getWorkerQrVisitSession, isWorkerQrVisitCode, readWorkerQrVisit, redeemWorkerQrVisit, storeWorkerQrVisitSession,
  workerQrVisitFragmentKey, workerQrVisitStorageKey, type WorkerQrVisitResult, type WorkerQrVisitSession,
} from '../src/services/workerQrVisitService';

import { workerQrAptitude } from '../src/lib/workerQrAptitude';

type VisitDetails = Extract<WorkerQrVisitResult, { status: 'ok' }>;
const messages = {
  visit_closed: 'La autorización de visita ha finalizado o se ha revocado.',
  card_expired: 'La consulta de este carnet ha caducado.',
  not_available: 'No consta una contratación vigente vinculada a este carnet en la obra autorizada.',
};

export function useWorkerQrVisit(card: string | null) {
  const [session, setSession] = useState(getWorkerQrVisitSession);
  const [view, setView] = useState<{ card: string; session: string; data: VisitDetails; deadline: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [submitting, setSubmitting] = useState(() => new URLSearchParams(location.hash.slice(1)).has(workerQrVisitFragmentKey));
  const redemption = useRef<Promise<WorkerQrVisitSession | null> | null>(null);

  useEffect(() => {
    if (!card) return;
    let active = true;
    const redeemLink = () => {
      const url = new URL(location.href);
      const fragment = new URLSearchParams(url.hash.slice(1));
      const code = fragment.get(workerQrVisitFragmentKey);
      if (code !== null) {
        fragment.delete(workerQrVisitFragmentKey);
        url.hash = fragment.toString();
        history.replaceState(history.state, '', url);
        if (!isWorkerQrVisitCode(code)) {
          redemption.current = null;
          setSubmitting(false);
          setError('El enlace de visita no es válido.');
          return;
        }
        setError('');
        setSubmitting(true);
        redemption.current = redeemWorkerQrVisit(code);
      }
      const pending = redemption.current;
      if (!pending) return;
      const isCurrent = () => active && redemption.current === pending;
      void pending.then(next => {
        if (!isCurrent()) return;
        if (!next) { setError('El enlace de visita ya se ha usado o ha caducado.'); return; }
        storeWorkerQrVisitSession(next);
        setSession(next);
      }).catch(() => {
        if (isCurrent()) setError('No se ha podido iniciar la visita. Comprueba la conexión.');
      }).finally(() => {
        if (!isCurrent()) return;
        redemption.current = null;
        setSubmitting(false);
      });
    };
    redeemLink();
    window.addEventListener('hashchange', redeemLink);
    return () => {
      active = false;
      window.removeEventListener('hashchange', redeemLink);
    };
  }, [card]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === workerQrVisitStorageKey || event.key === null) setSession(getWorkerQrVisitSession());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  useEffect(() => {
    setView(null);
    setRemaining(0);
    if (!session || !card || submitting) { setLoading(false); return; }
    let current = true;
    let request = 0;
    const refresh = () => {
      const run = ++request;
      setView(null);
      if (document.visibilityState === 'hidden') return;
      setLoading(true);
      setError('');
      const started = performance.now();
      void readWorkerQrVisit(session.token, card).then(data => {
        if (!current || run !== request) return;
        if (data.status !== 'ok') { setError(messages[data.status]); return; }
        const deadline = started + data.remainingMs;
        const seconds = Math.ceil((deadline - performance.now()) / 1000);
        if (seconds <= 0) { setError(messages.card_expired); return; }
        setRemaining(seconds);
        setView({ card, session: session.token, data, deadline });
      }).catch(() => {
        if (current && run === request) setError('No se ha podido abrir la consulta. Comprueba la conexión y vuelve a escanear.');
      }).finally(() => {
        if (current && run === request) setLoading(false);
      });
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    const restore = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    window.addEventListener('pageshow', restore);
    return () => {
      current = false;
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pageshow', restore);
    };
  }, [card, session, submitting]);

  useEffect(() => {
    if (!view) return;
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((view.deadline - performance.now()) / 1000));
      setRemaining(seconds);
      if (!seconds) {
        setView(null);
        setError(messages.card_expired);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [view]);

  const close = () => {
    storeWorkerQrVisitSession(null);
    setSession(null);
    setView(null);
    setError('');
    if (session) void closeWorkerQrVisit(session.token).catch(() => {
      setError('La ficha se ha cerrado en este navegador. El código caducará a la hora prevista.');
    });
  };

  return {
    active: session !== null, close, error, loading, remaining, submitting,
    details: view && view.card === card && view.session === session?.token ? view.data : null,
  };
}

const date = (value: string) => value.split('-').reverse().join('/');
const badge = {
  Apto: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-100',
  'Apto con limitación': 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/70 dark:text-amber-100',
};

export function WorkerQrVisit({ visit }: { visit: ReturnType<typeof useWorkerQrVisit> }) {
  const d = visit.details;
  const aptitude = workerQrAptitude(d?.aptitudeConclusion);
  const minutes = Math.floor(visit.remaining / 60);
  const seconds = String(visit.remaining % 60).padStart(2, '0');

  if (visit.submitting) return <p role="status" className="text-sm">Abriendo la ficha…</p>;
  if (!visit.active) return visit.error ? <p role="alert" className="text-sm text-red-800 dark:text-red-200">{visit.error}</p> : null;

  return <section className="space-y-4 print:hidden" aria-label="Ficha temporal del trabajador">
    {visit.loading && <p role="status" className="text-sm">Consultando el carnet…</p>}
    {visit.error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950 dark:border-amber-800 dark:bg-amber-950/70 dark:text-amber-100">{visit.error}</p>}
    {d && <>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-700">
        <div>
          <h2 className="text-xl font-black tracking-tight">Ficha del trabajador</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">DNI/NIE <strong className="font-mono text-slate-900 dark:text-white">{d.maskedDni}</strong></p>
        </div>
        <span role="timer" aria-label="Tiempo restante" className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1.5 text-sm font-bold tabular-nums text-[#00548E] dark:bg-sky-950 dark:text-sky-200"><Clock3 className="h-4 w-4" /> {minutes}:{seconds}</span>
      </div>

      <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#00548E] dark:text-sky-300"><BriefcaseBusiness className="h-4 w-4" /> Contratación vigente</h3>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div className="col-span-2"><dt className="text-xs font-semibold text-slate-600 dark:text-slate-300">Obra asignada</dt><dd className="mt-1 break-words font-bold">{d.worksite}</dd></div>
          <div><dt className="text-xs font-semibold text-slate-600 dark:text-slate-300">Desde</dt><dd className="mt-1 text-sm font-semibold"><time dateTime={d.periodStart}>{date(d.periodStart)}</time></dd></div>
          <div><dt className="text-xs font-semibold text-slate-600 dark:text-slate-300">Hasta</dt><dd className="mt-1 text-sm font-semibold"><time dateTime={d.periodEnd}>{date(d.periodEnd)}</time></dd></div>
        </dl>
      </section>

      <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#00548E] dark:text-sky-300"><ShieldCheck className="h-4 w-4" /> Prevención de riesgos laborales</h3>
        <dl className="mt-3 space-y-3">
          <div className="flex items-start gap-2 text-sm">
            <HardHat className="mt-0.5 h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" />
            <div><dt className="font-semibold">Formación PRL de 20 horas</dt><dd className="text-slate-700 dark:text-slate-200">{d.trainingRecord}</dd></div>
          </div>
          {aptitude && <div className="flex items-start gap-2 text-sm">
            <HeartPulse className="mt-0.5 h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" />
            <div className="min-w-0"><dt className="font-semibold">Aptitud médica</dt>
              <dd className="mt-1"><span className={`inline-flex rounded-full border px-2.5 py-1 font-bold ${badge[aptitude]}`}>{aptitude}</span></dd>
              {aptitude === 'Apto con limitación' && d.workRestrictions && <dd className="mt-2 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">
                {d.workRestrictions}
              </dd>}
            </div>
          </div>}
        </dl>
      </section>
    </>}
    <button type="button" onClick={visit.close} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold dark:border-slate-600">Cerrar visita</button>
  </section>;
}
