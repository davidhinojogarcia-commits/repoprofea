import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { closeCardPairing, createCardPairing, watchCardPairing } from '../src/services/workerCardPairing';

export default function WorkerCardPairing({ onClose, onWorker }: { onClose: () => void; onWorker: (id: number) => boolean }) {
  const [qr, setQr] = useState('');
  const [message, setMessage] = useState('Pulsa Crear vinculación para mostrar el QR.');
  const [busy, setBusy] = useState(false);
  const current = useRef<{ id: string; unsubscribe: () => void; timeout: number } | null>(null);
  const active = useRef(true);
  const workerCallback = useRef(onWorker);
  const newest = useRef(0);
  useEffect(() => { workerCallback.current = onWorker; }, [onWorker]);
  useEffect(() => { active.current = true; return () => { active.current = false; const s = current.current; if (s) { s.unsubscribe(); clearTimeout(s.timeout); void closeCardPairing(s.id).catch(() => {}); current.current = null; } }; }, []);
  const start = async () => {
    if (busy || current.current) return;
    setBusy(true);
    try {
      const session = await createCardPairing();
      if (!active.current) { await closeCardPairing(session.id); return; }
      const subscription = watchCardPairing(session.id, (id, event) => {
        if (event <= newest.current) return;
        newest.current = event;
        setMessage(workerCallback.current(id) ? 'Trabajador localizado. Puedes seguir escaneando desde el móvil.' : 'La ficha no está disponible en este directorio.');
      }, status => {
        if (!active.current) return;
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED' || status === 'RECONCILE_ERROR') setMessage('Se ha perdido la conexión. Al recuperarse se comprobará la última lectura; si no vuelve, cierra y crea una nueva vinculación.');
        if (status === 'SUBSCRIBED' && current.current) setMessage('Conexión recuperada. Puedes continuar escaneando.');
      });
      const unsubscribe = subscription.unsubscribe;
      const timeout = window.setTimeout(() => {
        unsubscribe(); void closeCardPairing(session.id).catch(() => {}); current.current = null;
        if (active.current) { setQr(''); setMessage('La vinculación ha caducado. Crea otra para continuar.'); }
      }, Math.max(0, new Date(session.expiresAt).getTime() - Date.now()));
      current.current = { id: session.id, unsubscribe, timeout };
      await Promise.race([subscription.ready, new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), 10000))]);
      const image = await QRCode.toDataURL(session.url, { width: 260, margin: 1 });
      if (active.current && current.current?.id === session.id) { setQr(image); setMessage('Escanea el QR con el móvil e inicia sesión con la misma cuenta. Válido durante cinco minutos.'); }
    } catch { const s = current.current; if (s) { s.unsubscribe(); clearTimeout(s.timeout); current.current = null; void closeCardPairing(s.id).catch(() => {}); } if (active.current) setMessage('No se ha podido crear la vinculación. Comprueba la conexión y vuelve a intentarlo.'); }
    finally { if (active.current) setBusy(false); }
  };
  return <section className="m-3 rounded-xl border bg-white p-4 dark:bg-slate-900" aria-label="Vinculación de cámara móvil">
    <div className="flex justify-between gap-2"><h2 className="font-bold">Vincular cámara del móvil</h2><button type="button" onClick={onClose} className="min-h-11 rounded-xl border px-3">Cerrar y desvincular</button></div>
    <p role="status" className="mt-2 text-sm">{message}</p>
    {qr && <img src={qr} alt="QR temporal para vincular el móvil" className="mt-3 h-52 w-52 bg-white p-2" />}
    {!qr && <button type="button" onClick={() => void start()} disabled={busy} className="mt-3 min-h-11 rounded-xl bg-[#00548E] px-4 py-2 font-bold text-white">{busy ? 'Preparando…' : 'Crear vinculación'}</button>}
  </section>;
}
