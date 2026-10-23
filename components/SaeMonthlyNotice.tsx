import React, { useEffect, useRef, useState } from 'react';
import type { SaeMonthlyMatch, SaeMonthlyState } from '../src/services/saeMonthlyService';

const dateLabel = (value: string | null) => value ? value.split('-').reverse().join('/') : 'pendiente';

export default function SaeMonthlyNotice({ state, onConsult, onApply }: {
  state?: SaeMonthlyState;
  onConsult: (match: SaeMonthlyMatch) => void;
  onApply: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  useEffect(() => { setError(''); }, [state?.signature]);
  if (!state) return null;
  const apply = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await onApply(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo aplicar 2500. Actualice y revise la coincidencia.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <div role={state.ambiguous ? 'alert' : 'status'} className="w-full min-w-0 rounded-xl border border-blue-300 bg-blue-50 p-3 text-xs text-slate-900 dark:border-blue-800 dark:bg-slate-950 dark:text-slate-100">
    <p className="font-bold">Coincidencia por apellidos y nombre · {String(state.month).padStart(2, '0')}/{state.year}</p>
    <p className="mt-1">Periodo previsto: {dateLabel(state.start)} — {dateLabel(state.end)}.</p>
    {state.matches.map(match => <div key={match.id} className="mt-2 border-t border-blue-200 pt-2 dark:border-blue-900">
      <p><strong>{match.status === 'registered' ? 'Contratación registrada' : 'Previsto para contratar · 2001'}</strong></p>
      <p className="break-words">{match.workCode} · {match.workName} · {match.category || 'Categoría pendiente'}</p>
      <p>{dateLabel(match.start)} — {dateLabel(match.end)}.</p>
      {match.overlap === false && <p>Antecedente del mismo mes: las fechas no se solapan.</p>}
      {match.overlap === null && <p>Fechas pendientes o incoherentes. Revise el periodo antes de aplicar un resultado.</p>}
      {match.reportId && match.needId ? <button type="button" onClick={() => onConsult(match)} className="mt-1 rounded-lg border border-blue-400 px-3 py-2 font-bold">Consultar contratación de origen</button>
        : <details className="mt-1"><summary className="cursor-pointer py-2 font-bold">Consultar ficha de origen</summary>
          <p>Directorio de trabajadores · {match.fullName}</p>
          <p>Contratación registrada en {match.workName}, como {match.category || 'categoría pendiente'}, del {dateLabel(match.start)} al {dateLabel(match.end)}.</p>
        </details>}
    </div>)}
    {state.ambiguous && <p className="mt-2 font-semibold">Hay varias entradas con el mismo nombre completo. Compruebe la identidad antes de asignar un código.</p>}
    {state.locked && <p className="mt-2">El destino está confirmado o emitido. Requiere revisión o rectificación.</p>}
    {state.currentCode === '2500' ? <p className="mt-2 font-bold">Resultado 2500 guardado.</p> : state.canApply && <div className="mt-2">
      <p>Actual: {state.currentCode || 'sin asignar'} · Propuesto: 2500. Al aplicar se sustituye el resultado actual.</p>
      <button type="button" disabled={busy} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
        onClick={() => void apply()} className="mt-2 rounded-lg bg-[#00548E] px-3 py-2 font-bold text-white disabled:opacity-50">Aplicar 2500 por coincidencia mensual</button>
    </div>}
    {busy && <p>Guardando resultado…</p>}
    {error && <p role="alert" className="mt-2">{error}</p>}
  </div>;
}
