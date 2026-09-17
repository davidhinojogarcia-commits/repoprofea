import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, FileUp, Save, X } from 'lucide-react';
import { loadAppBusinessSettings } from '../src/services/appSettingsService';
import { parseAnnualHiringPeriodsPdf, type ParsedAnnualHiringPeriod } from '../src/lib/annualHiringPeriodsParser';
import { listAnnualHiringPeriods, saveAnnualHiringPeriods, type AnnualHiringPeriodsRecord } from '../src/services/annualHiringPeriodsService';

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const safe = (v: unknown) => String(v ?? '').trim();

export const AnnualHiringPeriodsPanel: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [works, setWorks] = useState<string[]>([]);
  const [obra, setObra] = useState('');
  const [codigoObra, setCodigoObra] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [periods, setPeriods] = useState<ParsedAnnualHiringPeriod[]>([]);
  const [sourceName, setSourceName] = useState('');
  const [sourceKind, setSourceKind] = useState('');
  const [saved, setSaved] = useState<AnnualHiringPeriodsRecord[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: Event) => {
      const view = (e as CustomEvent<{view?: string}>).detail?.view || '';
      const on = view === 'sae';
      setVisible(on);
      if (!on) setOpen(false);
    };
    window.addEventListener('profea:navigate', h as EventListener);
    return () => window.removeEventListener('profea:navigate', h as EventListener);
  }, []);

  const refresh = async () => {
    const [settings, records] = await Promise.all([loadAppBusinessSettings(), listAnnualHiringPeriods()]);
    setWorks(settings.savedObras || []);
    setSaved(records);
    if (!obra && settings.savedObras?.length) setObra(settings.savedObras[0]);
  };
  useEffect(() => { if (visible) void refresh(); }, [visible]);

  const existing = useMemo(() => saved.find((r) => r.year === year && (r.obra === obra || (!!codigoObra && r.codigoObra === codigoObra))), [saved, year, obra, codigoObra]);

  const handleFile = async (file?: File) => {
    if (!file) return;
    setBusy(true); setProgress('Analizando PDF de periodos anuales…');
    try {
      const parsed = await parseAnnualHiringPeriodsPdf(file, setProgress);
      setSourceName(file.name); setSourceKind(parsed.source);
      if (parsed.obra) setObra(parsed.obra);
      if (parsed.codigoObra) setCodigoObra(parsed.codigoObra);
      setYear(parsed.year);
      setPeriods(parsed.periods);
    } catch (e: any) {
      window.alert(e?.message || 'No se pudo analizar el PDF.');
    } finally { setBusy(false); setProgress(''); }
  };

  const setPeriod = (month: number, key: 'startDate'|'endDate', value: string) => {
    setPeriods((prev) => {
      const current = prev.find((p) => p.month === month);
      const base = current || { month, monthName: MONTHS[month - 1], startDate: '', endDate: '' };
      return [...prev.filter((p) => p.month !== month), { ...base, [key]: value }].sort((a,b) => a.month-b.month);
    });
  };

  const save = async () => {
    if (!obra.trim()) return window.alert('Indica la obra.');
    const valid = periods.filter((p) => p.startDate && p.endDate);
    if (!valid.length) return window.alert('No hay periodos completos para guardar.');
    const record: AnnualHiringPeriodsRecord = {
      id: existing?.id || `${year}-${Date.now()}`,
      obra: obra.trim(), codigoObra: codigoObra.trim(), year,
      periods: valid.map((p) => ({ ...p, source: 'imported', updatedAt: new Date().toISOString() })),
      sourceFileName: sourceName, sourceKind, importedAt: new Date().toISOString(),
    };
    setBusy(true);
    try { await saveAnnualHiringPeriods(record); await refresh(); window.alert('Periodos anuales guardados correctamente.'); }
    catch (e: any) { window.alert(e?.message || 'No se pudieron guardar los periodos.'); }
    finally { setBusy(false); }
  };

  if (!visible) return null;
  return <>
    <button type="button" onClick={() => setOpen(true)} className="fixed z-[44] right-5 bottom-20 inline-flex items-center gap-2 rounded-2xl bg-emerald-700 text-white px-4 py-3 font-black shadow-xl hover:bg-emerald-800">
      <CalendarRange className="w-5 h-5"/>Periodos anuales
    </button>
    {open && <div className="fixed inset-0 z-[140] bg-slate-950/65 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center">
      <div className="w-full max-w-5xl max-h-[94vh] overflow-y-auto rounded-3xl bg-white dark:bg-slate-950 border dark:border-slate-800 shadow-2xl">
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-950 border-b dark:border-slate-800 px-5 py-4 flex items-center justify-between">
          <div><h2 className="font-black text-xl">Periodos anuales de contratación</h2><p className="text-xs text-slate-500 mt-1">Importa el PDF antes de las necesidades SAE. Los periodos se usarán por defecto en Nueva contratación.</p></div>
          <button onClick={() => setOpen(false)} className="p-2 rounded-xl border"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-5 sm:p-6 space-y-5">
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="text-sm font-bold">Obra<input list="annual-work-list" value={obra} onChange={e=>setObra(e.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-900"/><datalist id="annual-work-list">{works.map(w=><option key={w} value={w}/>)}</datalist></label>
            <label className="text-sm font-bold">Código obra<input value={codigoObra} onChange={e=>setCodigoObra(e.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-900" placeholder="12345 GR"/></label>
            <label className="text-sm font-bold">Anualidad<input type="number" value={year} onChange={e=>setYear(Number(e.target.value)||new Date().getFullYear())} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-900"/></label>
          </div>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={e=>void handleFile(e.target.files?.[0])}/>
          <button type="button" disabled={busy} onClick={()=>fileRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl bg-[#00548E] text-white px-4 py-3 font-bold disabled:opacity-50"><FileUp className="w-4 h-4"/>{busy ? (progress || 'Analizando…') : 'Importar PDF de periodos'}</button>
          {sourceName && <div className="text-xs text-slate-500">Documento: <b>{sourceName}</b> · lectura: {sourceKind || 'detectada'}</div>}
          <div className="overflow-x-auto rounded-2xl border dark:border-slate-800"><table className="w-full text-sm"><thead className="bg-slate-50 dark:bg-slate-900"><tr><th className="text-left p-3">Mes</th><th className="text-left p-3">Inicio</th><th className="text-left p-3">Fin</th></tr></thead><tbody>{MONTHS.map((m,i)=>{const p=periods.find(x=>x.month===i+1);return <tr key={m} className="border-t dark:border-slate-800"><td className="p-3 font-bold">{m}</td><td className="p-2"><input type="date" value={p?.startDate||''} onChange={e=>setPeriod(i+1,'startDate',e.target.value)} className="w-full rounded-lg border px-2 py-2 bg-white dark:bg-slate-900"/></td><td className="p-2"><input type="date" value={p?.endDate||''} onChange={e=>setPeriod(i+1,'endDate',e.target.value)} className="w-full rounded-lg border px-2 py-2 bg-white dark:bg-slate-900"/></td></tr>})}</tbody></table></div>
          <div className="flex justify-end"><button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 text-white px-5 py-3 font-black disabled:opacity-50"><Save className="w-4 h-4"/>Guardar periodos</button></div>
        </div>
      </div>
    </div>}
  </>;
};
