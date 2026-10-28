import React, { useEffect, useRef, useState } from 'react';
import type { VisitContent, VisitPoint } from '../src/lib/visitMinutes';
import { applyWritingPoints, mergeWritingPoints, pointSource, writingInput, writingProposal, WRITING_INPUT_LIMIT, type WritingInput, type WritingProposal } from '../src/lib/visitWriting';
import { visitRequest } from '../src/services/visitMinutesService';
import { visitInput } from './VisitContactsPanel';

const button = 'min-h-[44px] rounded-xl border px-3 py-2 font-bold disabled:opacity-50';
type Proposal = { input: WritingInput; value: WritingProposal; source?: { id: string; snapshot: string } };
export function VisitPointsEditor({ content, onChange, onCreateOrder, recordId, dictation = '', onDictationChange, onPending }: {
  content: VisitContent; onChange: (content: VisitContent) => void; onCreateOrder: (point: VisitPoint) => void;
  recordId?: string; dictation?: string; onDictationChange?: (text: string) => void; onPending?: (pending: boolean) => void;
}) {
  const points = content.points || [];
  const [dictating, setDictating] = useState(!!dictation), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [notice, setNotice] = useState('');
  const guard = useRef(false), controller = useRef<AbortController | null>(null);
  const reviewRef = useRef<HTMLElement>(null), dictationRef = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ content, dictation }); latest.current = { content, dictation };
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => { onPending?.(busy || !!proposal || !!dictation.trim()); }, [busy, proposal, dictation, onPending]);
  useEffect(() => { if (proposal) reviewRef.current?.focus({ preventScroll: true }); }, [proposal?.input]);
  const update = (id: string, patch: Partial<VisitPoint>) => onChange({ ...content, points: points.map(p => p.id === id ? { ...p, ...patch } : p) });
  const move = (index: number, delta: number) => { const next = [...points]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; onChange({ ...content, points: next }); };
  async function improve(point?: VisitPoint) {
    if (guard.current || proposal) return;
    setError(''); setNotice('');
    if (!navigator.onLine) { setError('Sin conexión. Tu texto se conserva; puedes seguir editando.'); return; }
    let input: WritingInput;
    try { input = writingInput({ mode: point ? 'written' : 'dictated', text: point?.description ?? dictation, title: point?.title || '' }); }
    catch (e: any) { setError(e.message); return; }
    guard.current = true; setBusy(true);
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 30000);
    try {
      const result = await visitRequest({ action: 'assist-writing', id: recordId, worksiteId: content.worksiteId, ...input }, { signal: abort.signal });
      if (!abort.signal.aborted) setProposal({ input, value: writingProposal(result.proposal, input), source: point ? { id: point.id, snapshot: pointSource(point) } : undefined });
    } catch (e: any) {
      if (controller.current === abort) setError(abort.signal.aborted ? 'La petición se ha interrumpido. El original sigue disponible; no se reintentará automáticamente.' : e.message);
    } finally { window.clearTimeout(timeout); guard.current = false; setBusy(false); }
  }
  function apply() {
    if (!proposal) return;
    setError('');
    try {
      // The provider response was checked before display. Human edits may correct source data.
      const value = writingProposal(proposal.value, proposal.input, false);
      if (!proposal.source && latest.current.dictation.trim() !== proposal.input.text) throw new Error('El dictado ha cambiado. Descarta esta propuesta y organiza el texto actualizado.');
      const next = applyWritingPoints(latest.current.content.points || [], value.points, proposal.source);
      onChange({ ...latest.current.content, points: next });
      if (!proposal.source) { onDictationChange?.(''); setDictating(false); }
      setProposal(null); setNotice('Propuesta aplicada. Revisa el contenido antes de pasar a firmas.');
    } catch (e: any) { setError(e.message); }
  }
  const stale = proposal && (proposal.source ? !points.some(p => p.id === proposal.source!.id && pointSource(p) === proposal.source!.snapshot) : dictation.trim() !== proposal.input.text);
  const editProposal = (index: number, patch: {title?: string; description?: string}) => {
    if (proposal) setProposal({...proposal, value: {...proposal.value, points: proposal.value.points.map((p,i) => i === index ? {...p,...patch} : p)}});
  };
  return <section aria-label="Puntos de la visita" className="min-w-0 space-y-3">
    <h3 className="text-lg font-black">Contenido de la visita</h3>
    <p className="text-sm">Escribe tus notas y pulsa «Mejorar redacción». Revisa el resultado y decide si lo incorporas al acta. También puedes dictar con el teclado.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={points.length >= 100} onClick={() => onChange({ ...content, points: [...points, { id: crypto.randomUUID(), title: '', description: '', attachmentIds: [] }] })}>+ Añadir asunto</button>
      <button type="button" className={button} onClick={() => { setDictating(true); window.setTimeout(() => dictationRef.current?.focus(), 0); }}>Dictar visita</button>
    </div>
    {dictating && <div className="rounded-xl border p-3 space-y-3">
      <p id="visit-dictation-help" className="text-sm">Usa el micrófono del teclado del móvil en este campo. Cuando termines, pulsa «Organizar dictado». GestionProfea recibe texto, no graba audio. También puedes escribir o pegar aquí.</p>
      <label className="block font-bold">Dictado de la visita<textarea aria-label="Dictado de la visita" ref={dictationRef} aria-describedby="visit-dictation-help" className={visitInput} rows={6} maxLength={WRITING_INPUT_LIMIT} value={dictation} onChange={e => onDictationChange?.(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || !!proposal || !dictation.trim() || !content.worksiteId} onClick={() => void improve()}>Organizar dictado</button><button type="button" className={button} disabled={busy} onClick={() => { onDictationChange?.(''); setDictating(false); if (!proposal?.source) setProposal(null); }}>Descartar dictado</button></div>
      {!!dictation.trim() && <p className="text-sm">Este texto está pendiente de incorporar al acta. Su copia local no equivale a guardado en el servidor.</p>}
    </div>}
    {busy && <p role="status">Preparando propuesta… Puedes seguir editando.</p>}
    {error && <p role="alert" className="rounded-xl border border-red-300 p-3">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {proposal && <section ref={reviewRef} tabIndex={-1} aria-label="Propuesta de redacción" className="min-w-0 rounded-xl border-2 border-blue-500 p-3 space-y-3">
      <h4 className="font-black">Revisar redacción propuesta</h4><p className="text-sm">Comprueba nombres, cifras, unidades y sentido. Esta propuesta no aprueba ni crea órdenes.</p>
      <details><summary className="min-h-[44px] font-bold">Ver texto original</summary><p className="whitespace-pre-wrap break-words">{proposal.input.title}{proposal.input.title ? '\n' : ''}{proposal.input.text}</p></details>
      {proposal.value.warnings.map((w, i) => <p key={i} className="text-sm font-bold">Revisar: {w}</p>)}
      {proposal.value.points.map((p, i) => <div key={i} className="space-y-2"><label className="block">Título propuesto {i + 1}<input aria-label={'Título propuesto '+(i+1)} className={visitInput} maxLength={200} value={p.title} onChange={e => editProposal(i,{title:e.target.value})} /></label><label className="block">Contenido propuesto {i + 1}<textarea aria-label={'Contenido propuesto '+(i+1)} className={visitInput} rows={5} maxLength={20000} value={p.description} onChange={e => editProposal(i,{description:e.target.value})} /></label></div>)}
      {stale && <p role="alert">El original ha cambiado. Conservamos tus cambios; descarta la propuesta y solicita otra.</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className={button + ' bg-blue-700 text-white'} disabled={!!stale} onClick={apply}>Aplicar propuesta</button><button type="button" className={button} onClick={() => { setProposal(null); setError(''); }}>Descartar propuesta</button></div>
    </section>}
    {points.map((p, i) => <fieldset key={p.id} className="min-w-0 rounded-xl border p-3 space-y-3"><legend className="font-bold">Punto {i + 1}</legend>
      <label className="block">Título (opcional)<input className={visitInput} value={p.title} maxLength={200} onChange={e => update(p.id, { title: e.target.value })} /></label>
      <label className="block font-bold">Descripción del punto {i + 1}<textarea aria-label={'Descripción del punto ' + (i + 1)} className={visitInput} rows={4} value={p.description} maxLength={20000} onChange={e => update(p.id, { description: e.target.value })} /></label>
      <button type="button" className={button} disabled={busy || !!proposal || !p.description.trim() || !content.worksiteId} onClick={() => void improve(p)}>Mejorar redacción</button>
      {i > 0 && <button type="button" className={button} onClick={() => { try { onChange({...content,points:mergeWritingPoints(points,i)}); } catch(e:any) {setError(e.message);} }}>Unir punto {i + 1} con el anterior</button>}
      {!!content.attachments.length && <details><summary className="min-h-[44px] font-bold">Fotografías o anexos de este punto</summary>{content.attachments.map(a => <label key={a.id} className="flex min-h-[44px] items-center gap-2 break-words"><input type="checkbox" checked={p.attachmentIds.includes(a.id)} onChange={e => update(p.id, { attachmentIds: e.target.checked ? [...p.attachmentIds, a.id] : p.attachmentIds.filter(id => id !== a.id) })} />{a.name}</label>)}</details>}
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={i === 0} onClick={() => move(i, -1)} aria-label={'Subir punto ' + (i + 1)}>Subir</button><button type="button" className={button} disabled={i === points.length - 1} onClick={() => move(i, 1)} aria-label={'Bajar punto ' + (i + 1)}>Bajar</button><button type="button" className={button} onClick={() => onChange({ ...content, points: points.filter(x => x.id !== p.id) })}>Eliminar punto {i + 1}</button><button type="button" className={button} disabled={!p.description.trim()} onClick={() => onCreateOrder(p)}>Crear orden desde este punto</button></div>
    </fieldset>)}
  </section>;
}
