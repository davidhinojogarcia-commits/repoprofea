import React, { useEffect, useRef, useState } from 'react';
import ModalPortal from './ModalPortal';
import SaePdfPages from './SaePdfPages';

const parseOffset = (value: string) => /^[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value.trim()) ? Number(value.replace(',', '.')) : NaN;
const rounded = (value: number) => Math.round(value * 100) / 100;
type Point = { x: number; y: number; revision: number };

export default function SaeReportPreview({ title, url, initialX, initialY, onPreview, onSave, onClose }: {
  title: string; url: string; initialX: number; initialY: number;
  onPreview: (x: number, y: number) => Promise<void>;
  onSave: (x: number, y: number) => Promise<void>;
  onClose: () => void;
}) {
  const [x, setX] = useState(String(initialX));
  const [y, setY] = useState(String(initialY));
  const [status, setStatus] = useState('Posición guardada');
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const desired = useRef<Point>({ x: initialX, y: initialY, revision: 0 });
  const saved = useRef(0);
  const revision = useRef(0);
  const valid = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const running = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(true);
  // Serialize writes: an older request can never overwrite the last movement.
  const flush = (): Promise<boolean> => {
    clearTimeout(timer.current);
    if (!valid.current) { setError('Complete X e Y con números válidos antes de cerrar.'); return Promise.resolve(false); }
    if (running.current) return running.current;
    if (saved.current >= desired.current.revision) return Promise.resolve(true);
    running.current = (async () => {
      try {
        while (saved.current < desired.current.revision) {
          const point = { ...desired.current };
          if (mounted.current) { setStatus('Guardando…'); setError(''); }
          await onSave(point.x, point.y);
          saved.current = point.revision;
        }
        if (mounted.current) setStatus('Posición guardada y verificada');
        return true;
      } catch (e) {
        if (mounted.current) { setStatus('Cambios sin guardar'); setError(e instanceof Error ? e.message : 'No se pudo guardar. Reintente.'); }
        return false;
      } finally { running.current = null; }
    })();
    return running.current;
  };
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => {
    mounted.current = true;
    const saveOnHide = () => { if (document.visibilityState === 'hidden') void flushRef.current(); };
    const warnOnLeave = (event: BeforeUnloadEvent) => {
      if (!valid.current || saved.current < desired.current.revision) { event.preventDefault(); event.returnValue = ''; }
    };
    document.addEventListener('visibilitychange', saveOnHide);
    window.addEventListener('beforeunload', warnOnLeave);
    return () => { mounted.current = false; clearTimeout(timer.current); document.removeEventListener('visibilitychange', saveOnHide); window.removeEventListener('beforeunload', warnOnLeave); };
  }, []);
  const change = (nextX: string, nextY: string) => {
    setX(nextX); setY(nextY); setError(''); clearTimeout(timer.current);
    const px = parseOffset(nextX), py = parseOffset(nextY);
    valid.current = Number.isFinite(px) && Number.isFinite(py);
    if (!valid.current) { setStatus('Complete las coordenadas'); return; }
    desired.current = { x: rounded(px), y: rounded(py), revision: ++revision.current };
    setStatus('Cambios pendientes de guardar');
    void onPreview(rounded(px), rounded(py)).catch(e => setError(e instanceof Error ? e.message : 'No se pudo actualizar el PDF.'));
    timer.current = setTimeout(() => void flushRef.current(), 500);
  };
  const close = async () => {
    if (closing) return;
    setClosing(true);
    if (await flush()) onClose();
    else setClosing(false);
  };
  const step = (axis: 'X' | 'Y', delta: number) => {
    const value = parseOffset(axis === 'X' ? x : y);
    if (!Number.isFinite(value)) { setError('Complete la coordenada antes de moverla.'); return; }
    const next = String(rounded(value + delta));
    change(axis === 'X' ? next : x, axis === 'Y' ? next : y);
  };
  return <ModalPortal label="SaeSection"><div className="fixed inset-0 z-[180] bg-slate-950/70 p-2 sm:p-4 flex items-center justify-center">
    <section role="dialog" aria-modal="true" aria-label="Vista previa SAE" className="w-full max-w-6xl bg-white dark:bg-slate-950 rounded-xl overflow-hidden flex flex-col" style={{ height: '94dvh', maxHeight: '100%' }}>
      <div className="shrink-0 max-h-[48dvh] overflow-auto border-b p-3">
        <h2 className="font-bold break-words">Vista previa SAE · {title}</h2>
        <p className="text-xs">Ajuste X/Y en milímetros, incluidos negativos. Guardado automático por informe hasta que vuelva a cambiar la posición.</p>
        <div className="flex flex-wrap items-end gap-3 mt-2">
          {(['X', 'Y'] as const).map(axis => <div key={axis} className="flex items-end gap-1">
            <button type="button" aria-label={`Disminuir ${axis}`} disabled={closing} onClick={() => step(axis, -0.5)} className="min-h-11 min-w-11 rounded border">−</button>
            <label className="text-xs font-bold">{axis} (mm)<input type="text" inputMode="decimal" autoComplete="off" disabled={closing} aria-label={`Desplazamiento ${axis}`} value={axis === 'X' ? x : y} onChange={e => change(axis === 'X' ? e.target.value : x, axis === 'Y' ? e.target.value : y)} className="ui-input block !w-24 min-h-11" /></label>
            <button type="button" aria-label={`Aumentar ${axis}`} disabled={closing} onClick={() => step(axis, 0.5)} className="min-h-11 min-w-11 rounded border">+</button>
          </div>)}
          <button type="button" onClick={() => void flush()} disabled={closing} className="min-h-11 rounded bg-[#00548E] px-3 text-white">Guardar posición</button>
          <button type="button" onClick={() => void close()} disabled={closing} className="min-h-11 rounded border px-3">{closing ? 'Guardando antes de cerrar…' : 'Cerrar'}</button>
        </div>
        <p role="status" className="text-xs mt-2">{status}</p>
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      </div>
      <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-900">{url ? <SaePdfPages url={url} /> : <p role="status">Preparando…</p>}</div>
    </section>
  </div></ModalPortal>;
}
