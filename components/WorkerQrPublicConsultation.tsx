import { useEffect, useState, type FC } from 'react';
import { readWorkerQrPublicConsultation, type WorkerQrVisitResult } from '../src/services/workerQrVisitService';
import { WorkerQrVisit } from './WorkerQrVisit';

type Details = Extract<WorkerQrVisitResult, { status: 'ok' }>;

export const WorkerQrPublicConsultation: FC<{ card: string }> = ({ card }) => {
  const [closed, setClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<{ details: Details; deadline: number } | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (closed) return;
    const consultation = crypto.randomUUID();
    let started = false;
    let active = true;
    let request = 0;
    const refresh = () => {
      const version = ++request;
      setView(null);
      if (document.visibilityState === 'hidden') return;
      setLoading(true);
      setError('');
      const requestedAt = performance.now();
      void readWorkerQrPublicConsultation(card, consultation, !started).then(result => {
        if (!active || version !== request) return;
        if (result.status === 'ok') {
          started = true;
          const deadline = requestedAt + result.remainingMs;
          setRemaining(Math.max(0, Math.ceil((deadline - performance.now()) / 1000)));
          if (deadline > performance.now()) {
            setView({ details: result, deadline });
            return;
          }
        }
        setError(result.status === 'not_available'
          ? 'La ficha pública de este carnet no está disponible.'
          : 'La consulta ha caducado. Vuelve a escanear el carnet.');
      }).catch(() => {
        if (active && version === request) setError('No se ha podido consultar la ficha. Comprueba la conexión y vuelve a escanear.');
      }).finally(() => {
        if (active && version === request) setLoading(false);
      });
    };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', restore);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pageshow', restore);
    };
  }, [card, closed]);

  useEffect(() => {
    if (!view) return;
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((view.deadline - performance.now()) / 1000));
      setRemaining(seconds);
      if (!seconds) {
        setView(null);
        setError('La consulta ha caducado. Vuelve a escanear el carnet.');
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [view]);

  return <WorkerQrVisit visit={{
    publicConsultation: true, active: !closed, loading, error, remaining, submitting: false, details: view?.details ?? null,
    close: () => { setClosed(true); setView(null); setError('Consulta cerrada. Vuelve a escanear el carnet para abrirla de nuevo.'); },
  }} />;
};
