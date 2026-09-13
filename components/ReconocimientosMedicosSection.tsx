import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, HeartPulse, Loader2, Search, ShieldAlert, UserCheck } from 'lucide-react';
import { Person, MedicalRecordImportItem, getAptitudMedicaInfo } from '../types';
import { extractClientDocumentText } from '../src/lib/clientDocumentText';
import { analyzeMedicalDocumentText } from '../src/lib/medicalDocumentAnalyzer';
import { updateDocument } from '../src/services/databaseService';
import { persistMedicalRecognition } from '../src/services/medicalRecognitionService';

interface Props {
  people: Person[];
  onUpdatePeople: (updatedPeople: Person[]) => void;
  onToast: (message: string, type: 'success' | 'error') => void;
}

interface ReviewItem extends MedicalRecordImportItem { id: string; selected: boolean; }

const patchPerson = (person: Person, item: MedicalRecordImportItem): Person => {
  const limited = item.resultado === 'Apto con Limitación';
  const limitations = limited ? (item.limitaciones || '') : '';
  return {
    ...person,
    reconocimientoEstado: item.resultado,
    aptitudMedica: limited ? 'Apto con limitaciones' : item.resultado,
    limitacionesAptitud: limitations,
    reconocimientoLimitaciones: limitations,
    reconocimientoFecha: item.fechaReconocimiento || person.reconocimientoFecha || '',
    reconocimientoValidez: item.validez || person.reconocimientoValidez || '',
    reconocimientoObservaciones: item.observaciones || `Reconocimiento importado desde ${item.archivoOrigen || 'documento médico'}.`,
    documentacionCompleta: item.resultado === 'No Apto' ? 'No' : person.documentacionCompleta,
  };
};

export const ReconocimientosMedicosSection: React.FC<Props> = ({ people, onUpdatePeople, onToast }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [search, setSearch] = useState('');

  const stats = useMemo(() => ({
    total: people.length,
    aptos: people.filter(p => getAptitudMedicaInfo(p).estado === 'Apto').length,
    limitados: people.filter(p => getAptitudMedicaInfo(p).estado === 'Apto con limitaciones').length,
    noAptos: people.filter(p => getAptitudMedicaInfo(p).estado === 'No Apto').length,
    pendientes: people.filter(p => getAptitudMedicaInfo(p).estado === 'Pendiente').length,
  }), [people]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter(p => `${p.apellidosNombre} ${p.dni} ${p.obra}`.toLowerCase().includes(q));
  }, [people, search]);

  const persist = async (items: MedicalRecordImportItem[]) => {
    const replacements = new Map<number, Person>();
    let failed = 0;
    for (const item of items) {
      if (!item.matchedPersonId || !item.resultado || item.resultado === 'Pendiente') continue;
      const original = people.find(p => p.id === item.matchedPersonId);
      if (!original) continue;
      const updated = patchPerson(original, item);
      try {
        await updateDocument('trabajadores', updated.id, updated as any);
        await persistMedicalRecognition(updated);
        replacements.set(updated.id, updated);
      } catch (error) {
        failed += 1;
        console.error('[medical-v2] persist', error);
      }
    }
    if (replacements.size) onUpdatePeople(people.map(p => replacements.get(p.id) || p));
    return { applied: replacements.size, failed };
  };

  const processFiles = async (files: FileList) => {
    const list = Array.from(files).filter(f => f.type === 'application/pdf' || f.type.startsWith('image/') || /\.(pdf|png|jpe?g|webp)$/i.test(f.name));
    if (!list.length) return onToast('Seleccione PDF o imágenes de reconocimientos médicos.', 'error');
    setBusy(true); setReview([]);
    try {
      const detected: ReviewItem[] = [];
      const unreadable: string[] = [];
      for (let i = 0; i < list.length; i += 1) {
        const file = list[i];
        const extracted = await extractClientDocumentText(file, msg => setProgress(`Documento ${i + 1}/${list.length} · ${msg}`));
        if (!extracted.text.trim()) { unreadable.push(file.name); continue; }
        setProgress(`Documento ${i + 1}/${list.length} · identificando trabajadores y aptitud…`);
        analyzeMedicalDocumentText(extracted.text, people, file.name).forEach((row, j) => detected.push({
          ...row,
          id: `${Date.now()}_${i}_${j}_${row.matchedPersonId || 'x'}`,
          selected: true,
        }));
      }
      if (!detected.length) {
        onToast(`No se reconocieron resultados médicos vinculables a trabajadores registrados.${unreadable.length ? ` No se pudo leer: ${unreadable.join(', ')}.` : ''}`, 'error');
        return;
      }

      const byWorker = new Map<number, Set<string>>();
      detected.forEach(item => {
        if (!item.matchedPersonId) return;
        const set = byWorker.get(item.matchedPersonId) || new Set<string>();
        set.add(item.resultado); byWorker.set(item.matchedPersonId, set);
      });
      const conflicts = new Set(Array.from(byWorker.entries()).filter(([, s]) => s.size > 1).map(([id]) => id));
      const normalized = detected.map(item => conflicts.has(item.matchedPersonId || -1) ? {
        ...item,
        confianza: 'baja' as const,
        selected: false,
        inconsistencias: [...(item.inconsistencias || []), 'Resultados contradictorios. Revisar manualmente.'],
      } : item);

      const automatic = normalized.filter(i => i.matchedPersonId && i.confianza === 'alta' && i.resultado !== 'Pendiente');
      const pending = normalized.filter(i => !automatic.some(a => a.id === i.id));
      const saved = await persist(automatic);
      setReview(pending);
      const aptos = automatic.filter(i => i.resultado === 'Apto').length;
      const limited = automatic.filter(i => i.resultado === 'Apto con Limitación').length;
      const noAptos = automatic.filter(i => i.resultado === 'No Apto').length;
      const msg = `${saved.applied} aplicados automáticamente: ${aptos} aptos, ${limited} aptos con limitaciones y ${noAptos} no aptos.${pending.length ? ` ${pending.length} para revisión.` : ''}${saved.failed ? ` ${saved.failed} no pudieron guardarse.` : ''}`;
      onToast(msg, noAptos || saved.failed ? 'error' : 'success');
    } catch (error: any) {
      onToast(error?.message || 'No se pudieron analizar los reconocimientos médicos.', 'error');
    } finally {
      setBusy(false); setProgress(''); if (inputRef.current) inputRef.current.value = '';
    }
  };

  const applyReviewed = async () => {
    const selected = review.filter(i => i.selected && i.matchedPersonId && i.resultado !== 'Pendiente');
    if (!selected.length) return onToast('No hay resultados revisados seleccionados.', 'error');
    setBusy(true); setProgress('Guardando resultados revisados…');
    try {
      const result = await persist(selected);
      const ids = new Set(selected.map(i => i.id));
      setReview(prev => prev.filter(i => !ids.has(i.id)));
      onToast(`${result.applied} reconocimientos aplicados a las fichas.`, result.failed ? 'error' : 'success');
    } finally { setBusy(false); setProgress(''); }
  };

  return <div className="space-y-6 min-w-0">
    <div className="ui-surface p-5 sm:p-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[#00548E] dark:text-blue-400 mb-1"><HeartPulse className="w-5 h-5"/><span className="text-xs font-black uppercase tracking-[0.14em]">Reconocimientos médicos</span></div>
          <h1 className="text-2xl sm:text-3xl font-black">Motor de aptitud médica V2</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-3xl">Extracción de texto + OCR local. Identifica trabajadores registrados y aplica Apto, Apto con limitaciones o No apto sin depender de proveedores de IA.</p>
        </div>
        <label className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#00548E] text-white font-bold text-sm cursor-pointer"><FileUp className="w-4 h-4"/> Analizar documentos<input ref={inputRef} type="file" multiple accept=".pdf,image/*" className="hidden" disabled={busy} onChange={e => e.target.files && void processFiles(e.target.files)}/></label>
      </div>
    </div>

    {busy && <div className="ui-surface p-4 flex items-center gap-3 text-sm font-semibold"><Loader2 className="w-4 h-4 animate-spin text-[#00548E]"/>{progress || 'Procesando…'}</div>}

    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {([['Trabajadores',stats.total],['Aptos',stats.aptos],['Con limitaciones',stats.limitados],['No aptos',stats.noAptos],['Pendientes',stats.pendientes]] as const).map(([label,value]) => <div key={label} className="ui-surface p-4"><div className="text-2xl font-black">{value}</div><div className="text-xs text-slate-500 mt-1">{label}</div></div>)}
    </div>

    {!!review.length && <div className="ui-surface p-4 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><h2 className="font-black text-lg">Casos para revisión</h2><p className="text-xs text-slate-500">Solo aparecen coincidencias medias/bajas o resultados contradictorios.</p></div><button onClick={() => void applyReviewed()} className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold inline-flex items-center gap-2 justify-center"><UserCheck className="w-4 h-4"/> Aplicar seleccionados</button></div>
      <div className="space-y-3">{review.map(item => <div key={item.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center"><label className="flex items-start gap-3 flex-1"><input type="checkbox" checked={item.selected} onChange={e => setReview(prev => prev.map(x => x.id === item.id ? {...x,selected:e.target.checked}:x))} className="mt-1"/><div><div className="font-black text-sm">{item.matchedPersonName || item.apellidosNombre}</div><div className="text-xs text-slate-500 mt-1">{item.archivoOrigen} · confianza {item.confianza}</div>{!!item.inconsistencias?.length && <div className="text-xs text-amber-700 mt-1">{item.inconsistencias.join(' · ')}</div>}</div></label>
        <div className="grid sm:grid-cols-2 gap-2 lg:w-[520px]"><select value={item.resultado} onChange={e => setReview(prev => prev.map(x => x.id===item.id?{...x,resultado:e.target.value}:x))} className="ui-input text-sm"><option>Apto</option><option value="Apto con Limitación">Apto con limitaciones</option><option value="No Apto">No apto</option><option>Pendiente</option></select><input value={item.limitaciones || ''} disabled={item.resultado !== 'Apto con Limitación'} onChange={e=>setReview(prev=>prev.map(x=>x.id===item.id?{...x,limitaciones:e.target.value}:x))} className="ui-input text-sm" placeholder="Limitaciones"/></div></div>
      </div>)}</div>
    </div>}

    <div className="ui-surface p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4"><div><h2 className="font-black text-lg">Aptitud actual</h2><p className="text-xs text-slate-500">La ficha del trabajador es la fuente de verdad para los informes generados.</p></div><div className="relative sm:w-80"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} className="ui-input pl-9 text-sm" placeholder="Buscar trabajador, DNI u obra…"/></div></div>
      <div className="space-y-2">{filtered.map(person => { const info=getAptitudMedicaInfo(person); const cls=info.estado==='Apto'?'bg-emerald-100 text-emerald-700':info.estado==='Apto con limitaciones'?'bg-amber-100 text-amber-700':info.estado==='No Apto'?'bg-red-100 text-red-700':'bg-slate-100 text-slate-600'; return <div key={person.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between"><div><div className="font-bold text-sm">{person.apellidosNombre}</div><div className="text-xs text-slate-500">{person.dni || 'Sin DNI'} · {person.obra || 'Sin obra'}{person.reconocimientoFecha?` · ${person.reconocimientoFecha}`:''}</div>{info.limitaciones && <div className="text-xs text-amber-700 mt-1">Limitaciones: {info.limitaciones}</div>}</div><span className={`text-xs font-black px-3 py-1.5 rounded-full ${cls}`}>{info.estado}</span></div>; })}</div>
    </div>

    <div className="ui-surface p-4 text-xs text-slate-500 flex gap-2 items-start"><ShieldAlert className="w-4 h-4 text-[#00548E] shrink-0 mt-0.5"/><span>El motor no realiza diagnósticos: únicamente identifica al trabajador y transcribe su aptitud y limitaciones. Las coincidencias dudosas nunca se aplican automáticamente.</span></div>
    {stats.noAptos>0 && <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 flex gap-3"><AlertTriangle className="w-5 h-5 text-red-600 shrink-0"/><div className="text-sm"><strong>{stats.noAptos} trabajador(es) constan como No apto.</strong> Su documentación queda marcada como incompleta.</div></div>}
    {stats.aptos+stats.limitados>0 && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-4 flex gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0"/><div className="text-sm">Los resultados quedan guardados en la ficha y se reflejan en los informes que utilizan los datos actuales del trabajador.</div></div>}
  </div>;
};
