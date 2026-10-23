import React, { useRef, useState } from 'react';
import type { SaeCodeState } from '../src/services/saeFortnightService';

export default function SaeCodeNotice({ state, currentCode, onDecision }: {
  state?: SaeCodeState;
  currentCode: string;
  onDecision: (apply: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  if (!state) return null;
  const decide = async (apply: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError('');
    try { await onDecision(apply); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar la decisión. El código actual se conserva.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  if (state.issue === 'manual_confirmation' && state.pendingCode) return (
    <div role="alert" className="w-full rounded-xl border border-amber-400 bg-amber-50 p-3 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); void decide(false); } }}>
      <p>Se ha detectado un cambio en la contratación de la primera quincena. El código actual fue modificado manualmente. ¿Quieres mantenerlo o sustituirlo por el nuevo código propuesto?</p>
      <p className="mt-1 font-bold">Actual: {currentCode || 'sin asignar'} · Propuesto: {state.pendingCode}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void decide(false)} className="rounded-lg border px-3 py-2 font-bold">Mantener código actual</button>
        <button type="button" disabled={busy} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
          onClick={() => void decide(true)} className="rounded-lg bg-[#00548E] px-3 py-2 font-bold text-white">Aplicar nuevo código</button>
      </div>
      {busy && <p role="status">Guardando decisión…</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
  if (state.issue) return <p role="alert" className="w-full rounded-lg border border-amber-400 p-2 text-xs">{state.issue}</p>;
  if (!state.manual && state.automaticCode === currentCode) return (
    <p className="w-full text-xs text-slate-600 dark:text-slate-300" title={`Contratación confirmada de la primera quincena: código ${state.sourceCode}`}>
      Código {currentCode === '2500' ? '2500' : `${currentCode} · Otros motivos`} asignado automáticamente por contratación en la primera quincena.
    </p>
  );
  return null;
}
