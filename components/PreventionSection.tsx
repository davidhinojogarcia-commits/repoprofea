import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ClipboardCheck, Pencil, Plus, RefreshCw, Share2, ShieldCheck, Trash2 } from 'lucide-react';
import { PREVENTION_CATEGORIES, PREVENTION_CHECKS, PREVENTION_STATUS_LABELS, filterPreventionRecords, preventionSummary, preventionToday, type PreventionDraft, type PreventionRecord, type PreventionStatus } from '../src/lib/prevention';
import { createPreventionRecord, deletePreventionRecord, editPreventionRecord, followUpPreventionRecord, getPreventionRecordDetails, loadPreventionActHistory, loadPreventionActPhotos, loadPreventionRecords } from '../src/services/preventionService';
import { appConfirm } from '../src/lib/appDialog';
import { createPreventionCommunicationActPdf, shareOrDownloadPreventionAct } from '../src/services/preventionActPdf';

const inputClass = 'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 outline-none transition focus:border-[#00548E] focus:ring-2 focus:ring-[#00548E]/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
const buttonClass = 'min-h-12 rounded-xl border border-slate-300 bg-white px-4 py-3 font-bold text-slate-900 disabled:opacity-50 inline-flex items-center justify-center gap-1.5 active:scale-[0.99] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
const primaryClass = 'min-h-12 rounded-xl bg-[#00548E] px-4 py-3 font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5 active:scale-[0.99]';
const freshDraft = (obra: string, kind: PreventionDraft['kind']): PreventionDraft => ({ obra, kind, work_date: preventionToday(), category: 'Otros', severity: 'medium', title: kind === 'precheck' ? 'Comprobación antes de empezar' : '', task: '', description: '', measures: '', responsible: '', deadline: '', checks: {}, photo: null });

async function readPhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Utiliza una fotografía JPG, PNG o WebP.');
  // Input size and persisted payload are different limits: large camera originals
  // should be reduced before storing them with the incident.
  if (file.size > 30 * 1024 * 1024) throw new Error('La fotografía original supera 30 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la fotografía.');
    const maxDataUrlLength = 400000;
    let maxDimension = 1200;
    // Try lower JPEG quality at each resolution before reducing dimensions.
    // Never submit a photo whose encoded size exceeds the storage limit.
    for (let attempt = 0; attempt < 6; attempt++) {
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.75, 0.6, 0.45]) {
        const result = canvas.toDataURL('image/jpeg', quality);
        if (result.startsWith('data:image/jpeg;base64,') && result.length <= maxDataUrlLength) return result;
      }
      maxDimension = Math.round(maxDimension * 0.75);
    }
    throw new Error('No se pudo comprimir la fotografía al tamaño permitido. Prueba con otra imagen.');
  } finally { bitmap.close(); }
}

function RecordDetails({ record, token }: { record: PreventionRecord; token?: string }) {
  const [details, setDetails] = useState<Awaited<ReturnType<typeof getPreventionRecordDetails>> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  return <details className="mt-3" onToggle={async e => {
    if (!e.currentTarget.open || details || inFlight.current) return;
    inFlight.current = true; setLoading(true); setError('');
    try { setDetails(await getPreventionRecordDetails(record.id, token)); }
    catch (e: any) { setError(e?.message || 'No se pudo cargar el historial. Cierra y vuelve a abrir para reintentar.'); }
    finally { inFlight.current = false; setLoading(false); }
  }}>
    <summary className="min-h-12 cursor-pointer font-semibold">Ver historial{record.has_photo || record.photo ? ' y fotografía' : ''}</summary>
    {loading && <p role="status">Cargando historial…</p>}
    {error && <p role="alert">{error}</p>}
    {details?.photo && <img src={details.photo} alt="Fotografía adjunta al registro" className="max-h-80 max-w-full rounded-xl" />}
    <ol className="mt-3 space-y-3">{details?.events.map(event => <li key={event.id} className="rounded-xl border p-3 text-sm">
      <b>{event.action === 'created' ? 'Registro inicial' : 'Seguimiento'} · {event.actor}</b>
      <p>{new Date(event.created_at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })} · {PREVENTION_STATUS_LABELS[event.snapshot.status]}</p>
      <p className="whitespace-pre-wrap break-words">{event.snapshot.measures || 'Sin medidas registradas'}</p>
      <p>Responsable: {event.snapshot.responsible || 'Pendiente'} · Plazo: {event.snapshot.deadline || 'Sin plazo'}</p>
    </li>)}</ol>
    {details && details.events.length === 100 && <p className="text-sm">Se muestran los últimos 100 cambios.</p>}
  </details>;
}

function EditPreventionRecord({ record, works, onSave, onCancel, busy }: {
  record: PreventionRecord;
  works: string[];
  onSave: (record: PreventionRecord, patch: Partial<PreventionRecord>) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState({
    obra: record.obra,
    work_date: record.work_date,
    category: record.category,
    severity: record.severity,
    title: record.title,
    task: record.task,
    description: record.description,
    measures: record.measures,
    responsible: record.responsible,
    deadline: record.deadline || '',
    checks: { ...record.checks },
    status: record.status,
  });

  return <form className="mt-4 grid gap-3 rounded-xl border p-3 sm:p-4" onSubmit={e => {
    e.preventDefault();
    void onSave(record, draft);
  }}>
    <h3 className="font-black">Editar registro preventivo</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="font-semibold">Obra<select className={inputClass} value={draft.obra} onChange={e => setDraft(d => ({ ...d, obra: e.target.value }))}>{works.map(w => <option key={w}>{w}</option>)}</select></label>
      <label className="font-semibold">Fecha<input required type="date" max={preventionToday()} className={inputClass} value={draft.work_date} onChange={e => setDraft(d => ({ ...d, work_date: e.target.value }))} /></label>
      <label className="font-semibold">Título<input required maxLength={200} className={inputClass} value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} /></label>
      <label className="font-semibold">Tarea<input required maxLength={300} className={inputClass} value={draft.task} onChange={e => setDraft(d => ({ ...d, task: e.target.value }))} /></label>
      <label className="font-semibold">Tipo de riesgo<select className={inputClass} value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}>{PREVENTION_CATEGORIES.map(item => <option key={item}>{item}</option>)}</select></label>
      <label className="font-semibold">Prioridad<select className={inputClass} value={draft.severity} onChange={e => setDraft(d => ({ ...d, severity: e.target.value as PreventionRecord['severity'] }))}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option></select></label>
      <label className="font-semibold">Estado<select className={inputClass} value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value as PreventionStatus }))}>{Object.entries(PREVENTION_STATUS_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="font-semibold">Responsable<input maxLength={200} className={inputClass} value={draft.responsible} onChange={e => setDraft(d => ({ ...d, responsible: e.target.value }))} /></label>
      <label className="font-semibold sm:col-span-2">Descripción<textarea rows={4} required={record.kind === 'incident'} maxLength={4000} className={inputClass} value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} /></label>
      <label className="font-semibold sm:col-span-2">Medidas<textarea rows={4} required={draft.status === 'closed'} maxLength={4000} className={inputClass} value={draft.measures} onChange={e => setDraft(d => ({ ...d, measures: e.target.value }))} /></label>
      <label className="font-semibold">Plazo<input type="date" className={inputClass} value={draft.deadline} onChange={e => setDraft(d => ({ ...d, deadline: e.target.value }))} /></label>
    </div>
    {record.kind === 'precheck' && <fieldset className="space-y-2">
      <legend className="font-black">Comprobaciones</legend>
      {PREVENTION_CHECKS.map(check => <label key={check.id} className="block rounded-xl border p-3 font-semibold">{check.label}<select className={`${inputClass} mt-2`} value={draft.checks[check.id] || 'na'} onChange={e => setDraft(d => ({ ...d, checks: { ...d.checks, [check.id]: e.target.value as any } }))}><option value="yes">Comprobado</option><option value="no">Pendiente / problema detectado</option><option value="na">No aplica</option></select></label>)}
    </fieldset>}
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
      <button className={`${primaryClass} w-full sm:w-auto`} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
      <button type="button" className={`${buttonClass} w-full sm:w-auto`} disabled={busy} onClick={onCancel}>Cancelar</button>
    </div>
  </form>;
}

function FollowUp({ record, onSave, busy }: { record: PreventionRecord; onSave: (r: PreventionRecord, status: PreventionStatus, measures: string, responsible: string, deadline: string) => Promise<void>; busy: boolean }) {
  const [status, setStatus] = useState(record.status);
  const [measures, setMeasures] = useState(record.measures);
  const [responsible, setResponsible] = useState(record.responsible);
  const [deadline, setDeadline] = useState(record.deadline || '');
  return <form className="mt-4 grid gap-3 rounded-xl border border-slate-200 p-3 sm:p-4 dark:border-slate-700" onSubmit={e => { e.preventDefault(); void onSave(record, status, measures, responsible, deadline); }}>
    <label className="font-semibold">Estado<select className={inputClass} value={status} onChange={e => setStatus(e.target.value as PreventionStatus)}>{Object.entries(PREVENTION_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="font-semibold">Responsable<input required maxLength={200} className={inputClass} value={responsible} onChange={e => setResponsible(e.target.value)} /></label>
    <label className="font-semibold">Plazo de actuación<input type="date" className={inputClass} value={deadline} onChange={e => setDeadline(e.target.value)} /></label>
    <label className="font-semibold">Medidas adoptadas<textarea rows={4} required={status === 'closed'} maxLength={4000} className={inputClass} value={measures} onChange={e => setMeasures(e.target.value)} /></label>
    <button className={`${primaryClass} w-full sm:w-auto sm:justify-self-start`} disabled={busy}>{busy ? 'Guardando…' : 'Guardar seguimiento'}</button>
  </form>;
}

export function PreventionSection({ savedObras, token, foremanName, supervisorName, supervisorEmail }: { savedObras: string[]; token?: string; foremanName?: string; supervisorName?: string; supervisorEmail?: string }) {
  const [records, setRecords] = useState<PreventionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [draft, setDraft] = useState<PreventionDraft | null>(null);
  const draftId = useRef('');
  const requestVersion = useRef(0);
  const mutationLock = useRef(false);
  const [obra, setObra] = useState(token ? savedObras[0] || '' : '');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [actBusy, setActBusy] = useState(false);

  async function reload() {
    const version = ++requestVersion.current;
    setLoading(true); setError('');
    try {
      const result = await loadPreventionRecords(token);
      if (version !== requestVersion.current) return;
      setRecords(result.records); setTruncated(result.truncated);
    } catch (e: any) {
      if (version !== requestVersion.current) return;
      setError(e?.message || 'No se pudieron cargar las incidencias.');
    } finally { if (version === requestVersion.current) setLoading(false); }
  }
  useEffect(() => { setRecords([]); setDraft(null); void reload(); return () => { requestVersion.current++; }; }, [token]);
  const works = [...new Set([...savedObras, ...records.map(r => r.obra)])].sort();
  const filtered = useMemo(() => filterPreventionRecords(records, obra, status, from, to), [records, obra, status, from, to]);
  const summary = useMemo(() => preventionSummary(filtered), [filtered]);
  const urgent = records.filter(r => (!obra || r.obra === obra) && r.status !== 'closed' && (r.severity === 'high' || (r.deadline && r.deadline < preventionToday())));
  const patchDraft = (patch: Partial<PreventionDraft>) => setDraft(d => d ? { ...d, ...patch } : d);
  const begin = (kind: PreventionDraft['kind']) => {
    draftId.current = crypto.randomUUID(); setError(''); setFeedback('');
    setDraft({ ...freshDraft(obra || savedObras[0] || '', kind), responsible: foremanName || '' });
  };
  async function saveDraft(e: React.FormEvent) {
    e.preventDefault(); if (!draft || mutationLock.current || photoBusy) return;
    mutationLock.current = true; setBusy(true); setError(''); setFeedback('');
    try {
      const saved = await createPreventionRecord(draft, draftId.current, token);
      setRecords(rs => [saved, ...rs.filter(r => r.id !== saved.id)]); setDraft(null);
      setFeedback('Registro guardado. Queda disponible para el seguimiento del supervisor.');
    } catch (e: any) { setError(e?.message || 'No se pudo guardar. Tus datos siguen en el formulario.'); }
    finally { mutationLock.current = false; setBusy(false); }
  }
  async function saveFollowUp(record: PreventionRecord, nextStatus: PreventionStatus, measures: string, responsible: string, deadline: string) {
    if (mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setError(''); setFeedback('');
    try {
      const saved = await followUpPreventionRecord(record, nextStatus, measures, responsible, deadline);
      setRecords(rs => rs.map(r => r.id === saved.id ? saved : r)); setEditingId(null); setFeedback('Seguimiento guardado.');
    } catch (e: any) { setError(e?.message || 'No se pudo guardar el seguimiento.'); }
    finally { mutationLock.current = false; setBusy(false); }
  }

  async function saveRecordEdit(record: PreventionRecord, patch: Partial<PreventionRecord>) {
    if (mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setError(''); setFeedback('');
    try {
      const saved = await editPreventionRecord(record, patch);
      setRecords(current => current.map(item => item.id === saved.id ? saved : item));
      setEditingRecordId(null);
      setFeedback('Registro preventivo actualizado.');
    } catch (e: any) {
      setError(e?.message || 'No se pudo actualizar el registro.');
    } finally {
      mutationLock.current = false; setBusy(false);
    }
  }

  async function removeRecord(record: PreventionRecord) {
    const ok = await appConfirm(
      `¿Eliminar definitivamente "${record.title}"? Esta acción elimina también su historial preventivo asociado.`,
      { title: 'Eliminar registro preventivo', confirmLabel: 'Eliminar' },
    );
    if (!ok) return;
    setBusy(true); setError(''); setFeedback('');
    try {
      await deletePreventionRecord(record.id);
      setRecords(current => current.filter(item => item.id !== record.id));
      if (editingId === record.id) setEditingId(null);
      if (editingRecordId === record.id) setEditingRecordId(null);
      setFeedback('Registro preventivo eliminado.');
    } catch (e: any) {
      setError(e?.message || 'No se pudo eliminar el registro.');
    } finally {
      setBusy(false);
    }
  }

  async function sharePreventiveAct() {
    if (!filtered.length || actBusy) return;
    if (filtered.length > 200) {
      setError('Aplica filtros antes de generar el acta. El máximo es de 200 registros por PDF.');
      return;
    }
    setActBusy(true); setError(''); setFeedback('');
    try {
      const history = await loadPreventionActHistory(filtered.map(record => record.id), token);
      const reportRecords = await loadPreventionActPhotos(filtered, token);
      const { blob, fileName } = await createPreventionCommunicationActPdf(
        reportRecords,
        history,
        { obra, status, from, to },
        { supervisorName, supervisorEmail },
      );
      const result = await shareOrDownloadPreventionAct(blob, fileName);
      setFeedback(result === 'shared'
        ? 'Acta de comunicación preventiva preparada para compartir.'
        : 'Acta de comunicación preventiva generada en PDF.');
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(e?.message || 'No se pudo generar el acta de comunicación preventiva.');
    } finally {
      setActBusy(false);
    }
  }

  return <section className="space-y-4 sm:space-y-5 text-slate-900 dark:text-slate-100 pb-4" aria-labelledby="prevention-title">
    <header className="ui-surface rounded-2xl p-4 sm:p-6">
      <h1 id="prevention-title" className="flex items-center gap-2 text-xl sm:text-2xl font-black"><ShieldCheck className="h-6 w-6 shrink-0" aria-hidden="true" />Incidencias y alertas</h1>
      <p className="mt-2 text-sm sm:text-base">Registra situaciones peligrosas, revisa la tarea y deja constancia de las medidas.</p>
      <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-300">Apoyo a la gestión preventiva. Aplica la evaluación de riesgos y los protocolos aprobados de la obra.</p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
        <button className={`${primaryClass} w-full sm:w-auto`} disabled={busy || loading || Boolean(draft) || !savedObras.length} onClick={() => begin('incident')}><Plus className="h-5 w-5 shrink-0" aria-hidden="true" /><span>Comunicar incidencia</span></button>
        <button className={`${buttonClass} w-full sm:w-auto`} disabled={busy || loading || Boolean(draft) || !savedObras.length} onClick={() => begin('precheck')}><ClipboardCheck className="h-5 w-5 shrink-0" aria-hidden="true" /><span>Comprobación antes de empezar</span></button>
        <button className={`${buttonClass} w-full sm:w-auto`} disabled={busy || loading} onClick={() => void reload()}><RefreshCw className="h-5 w-5 shrink-0" aria-hidden="true" />Actualizar</button>
        <button className={`${buttonClass} w-full sm:w-auto`} disabled={busy || loading || actBusy || !filtered.length} onClick={() => void sharePreventiveAct()}><Share2 className="h-5 w-5 shrink-0" aria-hidden="true" /><span>{actBusy ? 'Preparando…' : 'Compartir PDF'}</span></button>
      </div>
      {!savedObras.length && <p className="mt-3">Añade una obra en Configuración para registrar incidencias.</p>}
    </header>
    {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-700 dark:bg-red-950/70 dark:text-red-100">{error}</p>}
    {feedback && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">{feedback}</p>}
    {urgent.length > 0 && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 font-bold text-amber-950 dark:border-amber-600 dark:bg-amber-950/80 dark:text-amber-100"><AlertTriangle className="mr-2 inline h-5 w-5" aria-hidden="true" />{urgent.length} registros con prioridad alta o plazo vencido en las obras seleccionadas.</p>}
    <aside className="ui-surface rounded-xl p-4 text-sm">
      <b>Avisos meteorológicos:</b> consulta manual en <a className="underline" href="https://www.aemet.es/es/eltiempo/prediccion/avisos" target="_blank" rel="noopener noreferrer">AEMET</a>. La consulta automática y los recordatorios de hidratación quedan para la siguiente fase. La ausencia de avisos no garantiza seguridad.
    </aside>
    {draft && <form className="ui-surface grid gap-4 rounded-2xl p-4 sm:p-6 scroll-mt-3" onSubmit={saveDraft}>
      <h2 className="text-lg font-black">{draft.kind === 'incident' ? 'Nueva incidencia o situación peligrosa' : 'Comprobación previa de la tarea'}</h2>
      <fieldset disabled={busy || photoBusy} className="grid gap-4 sm:grid-cols-2">
        <label className="font-semibold">Obra<select required disabled={Boolean(token)} className={inputClass} value={draft.obra} onChange={e => patchDraft({ obra: e.target.value })}><option value="">Selecciona obra</option>{savedObras.map(w => <option key={w}>{w}</option>)}</select></label>
        <label className="font-semibold">Fecha<input required type="date" max={preventionToday()} className={inputClass} value={draft.work_date} onChange={e => patchDraft({ work_date: e.target.value })} /></label>
        <label className="font-semibold">Título<input required maxLength={200} className={inputClass} value={draft.title} onChange={e => patchDraft({ title: e.target.value })} /></label>
        <label className="font-semibold">Tarea prevista<input required maxLength={300} className={inputClass} value={draft.task} onChange={e => patchDraft({ task: e.target.value })} /></label>
        <label className="font-semibold">Tipo de riesgo<select className={inputClass} value={draft.category} onChange={e => patchDraft({ category: e.target.value })}>{PREVENTION_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="font-semibold">Prioridad comunicada<select className={inputClass} value={draft.severity} onChange={e => patchDraft({ severity: e.target.value as PreventionDraft['severity'] })}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option></select></label>
        {draft.kind === 'precheck' && <fieldset className="sm:col-span-2 space-y-3"><legend className="font-black">Responde todas las comprobaciones</legend>{PREVENTION_CHECKS.map(c => <label key={c.id} className="block rounded-xl border p-3 font-semibold">{c.label}<select required className={`${inputClass} mt-2`} value={draft.checks[c.id] || ''} onChange={e => patchDraft({ checks: { ...draft.checks, [c.id]: e.target.value as any } })}><option value="">Selecciona respuesta</option><option value="yes">Comprobado</option><option value="no">Pendiente / problema detectado</option><option value="na">No aplica</option></select></label>)}<p className="text-sm">Registrar esta comprobación no autoriza por sí solo el inicio de los trabajos.</p></fieldset>}
        <label className="font-semibold sm:col-span-2">Descripción del riesgo<textarea required={draft.kind === 'incident'} rows={4} maxLength={4000} className={inputClass} value={draft.description} onChange={e => patchDraft({ description: e.target.value })} /></label>
        <label className="font-semibold sm:col-span-2">Medidas adoptadas o propuestas<textarea rows={4} maxLength={4000} className={inputClass} value={draft.measures} onChange={e => patchDraft({ measures: e.target.value })} /></label>
        <label className="font-semibold">Responsable de actuación<input maxLength={200} className={inputClass} value={draft.responsible} onChange={e => patchDraft({ responsible: e.target.value })} /></label>
        <label className="font-semibold">Plazo de actuación<input type="date" className={inputClass} value={draft.deadline} onChange={e => patchDraft({ deadline: e.target.value })} /></label>
        <label className="font-semibold sm:col-span-2">Fotografía opcional<input type="file" accept="image/jpeg,image/png,image/webp" className={`${inputClass} mt-2`} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; setPhotoBusy(true); setError(''); try { patchDraft({ photo: await readPhoto(file) }); } catch (error: any) { setError(error.message); } finally { setPhotoBusy(false); } }} /></label>
        {draft.photo && <div><img src={draft.photo} alt="Fotografía de la incidencia" className="max-h-48 rounded-xl" /><button type="button" className={`${buttonClass} mt-2`} onClick={() => patchDraft({ photo: null })}>Quitar fotografía</button></div>}
      </fieldset>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3"><button className={`${primaryClass} w-full sm:w-auto`} disabled={busy || photoBusy}>{busy ? 'Guardando…' : photoBusy ? 'Preparando…' : 'Guardar registro'}</button><button type="button" className={`${buttonClass} w-full sm:w-auto`} disabled={busy || photoBusy} onClick={() => setDraft(null)}>Cancelar</button></div>
    </form>}
    <details className="ui-surface rounded-2xl p-4 sm:hidden">
      <summary className="min-h-10 cursor-pointer font-black flex items-center justify-between">Filtros <span className="text-sm font-semibold text-slate-500">{filtered.length} registros</span></summary>
      <div className="mt-3 grid gap-3">
        <label className="font-semibold">Obra<select className={inputClass} disabled={Boolean(token)} value={obra} onChange={e => setObra(e.target.value)}><option value="">Todas mis obras</option>{works.map(w => <option key={w}>{w}</option>)}</select></label>
        <label className="font-semibold">Estado<select className={inputClass} value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos los estados</option>{Object.entries(PREVENTION_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="font-semibold">Desde<input type="date" className={inputClass} value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="font-semibold">Hasta<input type="date" className={inputClass} min={from || undefined} value={to} onChange={e => setTo(e.target.value)} /></label>
        </div>
      </div>
    </details>
    <div className="ui-surface hidden gap-3 rounded-2xl p-4 sm:grid sm:grid-cols-4">
      <label>Obra<select className={inputClass} disabled={Boolean(token)} value={obra} onChange={e => setObra(e.target.value)}><option value="">Todas mis obras</option>{works.map(w => <option key={w}>{w}</option>)}</select></label>
      <label>Estado<select className={inputClass} value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos los estados</option>{Object.entries(PREVENTION_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Desde<input type="date" className={inputClass} value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>Hasta<input type="date" className={inputClass} min={from || undefined} value={to} onChange={e => setTo(e.target.value)} /></label>
    </div>
    <p className="text-sm text-slate-600 dark:text-slate-300">El acta PDF respeta estos filtros e incluye incidencias, fotografías, comprobaciones y su historial de seguimiento. Se genera localmente y no se guarda en Supabase.</p>
    {truncated && <p role="status">Se muestran los 500 registros más recientes. Los recuentos corresponden únicamente a esos registros.</p>}
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">{[['Incidencias', summary.incidents], ['Pendientes', summary.pending], ['Prioridad alta', summary.high], ['Comprobaciones', summary.prechecks]].map(([label, count]) => <div key={label} className="ui-surface rounded-xl p-3 sm:p-4"><p className="text-xs sm:text-sm">{label}</p><b className="text-xl sm:text-2xl">{count}</b></div>)}</div>
    <p className="text-sm">Recuentos según los filtros. No representan una tasa de accidentes ni una comparación de seguridad entre obras.</p>
    {!token && summary.byWork.length > 1 && <div className="ui-surface overflow-x-auto rounded-xl p-4">
      <table className="w-full text-left text-sm"><caption className="mb-3 text-left font-black">Registros por obra según los filtros</caption><thead><tr><th scope="col" className="p-2">Obra</th><th scope="col" className="p-2">Incidencias</th><th scope="col" className="p-2">Pendientes</th></tr></thead><tbody>{summary.byWork.map(row => <tr key={row.obra}><th scope="row" className="p-2 font-semibold">{row.obra}</th><td className="p-2">{row.incidents}</td><td className="p-2">{row.pending}</td></tr>)}</tbody></table>
    </div>}
    {loading ? <p role="status">Cargando registros…</p> : !filtered.length && !error ? <p className="ui-surface rounded-xl p-4">No hay registros para estos filtros.</p> : null}
    <div className="space-y-3">{filtered.map(record => <article key={record.id} className="ui-surface rounded-2xl p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><h2 className="text-base sm:text-lg font-black break-words">{record.title}</h2><span className="self-start rounded-lg border px-3 py-1 text-xs sm:text-sm font-bold">{record.kind === 'precheck' && record.status === 'closed' ? 'Comprobación registrada' : PREVENTION_STATUS_LABELS[record.status]}</span></div>
      <p className="mt-2 break-words text-sm">{record.obra} · {record.work_date} · {record.category} · Prioridad {record.severity === 'high' ? 'alta' : record.severity === 'medium' ? 'media' : 'baja'}</p>
      <p className="mt-2"><b>Tarea:</b> {record.task}</p>
      <p className="mt-2 whitespace-pre-wrap break-words">{record.description}</p>
      {record.measures && <p className="mt-2 whitespace-pre-wrap break-words"><b>Medidas:</b> {record.measures}</p>}
      <p className="mt-2 text-sm"><b>Responsable:</b> {record.responsible || 'Pendiente de asignar'}{record.deadline ? ` · Plazo: ${record.deadline}` : ''}</p>
      <p className="mt-1 text-sm">Registrado por {record.actor} · Actualizado {new Date(record.updated_at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</p>
      {record.kind === 'precheck' && <details className="mt-3"><summary className="cursor-pointer min-h-12 font-semibold">Ver comprobaciones</summary><ul className="mt-2 space-y-2">{PREVENTION_CHECKS.map(c => <li key={c.id}>{c.label}: <b>{record.checks[c.id] === 'yes' ? 'Comprobado' : record.checks[c.id] === 'no' ? 'Problema detectado' : 'No aplica'}</b></li>)}</ul></details>}
      <div key={`details:${record.updated_at}`}><RecordDetails record={record} token={token} /></div>
      {!token && <div className="mt-4 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
        <button className={`${buttonClass} min-w-0 px-2 sm:px-4`} disabled={busy} onClick={() => setEditingId(editingId === record.id ? null : record.id)}><ClipboardCheck className="h-4 w-4 shrink-0 sm:hidden" aria-hidden="true" /><span className="text-center leading-tight">{editingId === record.id ? 'Cerrar seguimiento' : 'Gestionar seguimiento'}</span></button>
        <button className={`${buttonClass} min-w-0 px-2 sm:px-4`} disabled={busy} onClick={() => setEditingRecordId(editingRecordId === record.id ? null : record.id)}><Pencil className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="text-center leading-tight">{editingRecordId === record.id ? 'Cerrar edición' : 'Editar'}</span></button>
        <button className={`${buttonClass} min-w-0 px-2 sm:px-4 text-red-700 dark:text-red-300`} disabled={busy} onClick={() => void removeRecord(record)}><Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">Eliminar</span></button>
      </div>}
      {editingId === record.id && !token && <div key={`followup:${record.updated_at}`}><FollowUp record={record} onSave={saveFollowUp} busy={busy} /></div>}
      {editingRecordId === record.id && !token && <EditPreventionRecord record={record} works={works} onSave={saveRecordEdit} onCancel={() => setEditingRecordId(null)} busy={busy} />}
    </article>)}</div>
  </section>;
}
