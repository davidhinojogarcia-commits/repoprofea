import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarRange, FileUp, Save, X } from 'lucide-react';
import { parseAnnualHiringPeriodsPdf, type ParsedAnnualHiringMonth } from '../src/lib/annualHiringPeriodsParser';
import { listAnnualHiringPeriods, saveAnnualHiringPeriods, type AnnualHiringPeriodsRecord } from '../src/services/annualHiringPeriodsService';

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

export const AnnualHiringPeriodsPanel: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [months, setMonths] = useState<ParsedAnnualHiringMonth[]>([]);
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

  const refresh = async () => setSaved(await listAnnualHiringPeriods());
  useEffect(() => { if (visible) void refresh(); }, [visible]);

  const existing = useMemo(() => saved.find((r) => r.year === year), [saved, year]);

  const handleFile = async (file?: File) => {
    if (!file) return;
    setBusy(true); setProgress('Analizando PDF de periodos anuales…');
    try {
      const parsed = await parseAnnualHiringPeriodsPdf(file, setProgress);
      setSourceName(file.name);
      setSourceKind(parsed.source);
      setYear(parsed.year);
      setMonths(parsed.months);
    } catch (e: any) {
      window.alert(e?.message || 'No se pudo analizar el PDF.');
    } finally { setBusy(false); setProgress(''); }
  };

  const setDate = (month: number, key: 'period1Start'|'period1End'|'period2Start'|'period2End', value: string) => {
    setMonths((prev) => {
      const current = prev.find((m) => m.month === month);
      const base: ParsedAnnualHiringMonth = current || {
        month,
        monthName: MONTHS[month - 1],
        period1Start: '', period1End: '', period2Start: '', period2End: '', warnings: [],
      };
      return [...prev.filter((m) => m.month !== month), { ...base, [key]: value }].sort((a,b) => a.month - b.month);
    });
  };

  const save = async () => {
    const valid = months.filter((m) => m.period1Start || m.period1End || m.period2Start || m.period2End);
    if (!valid.length) return window.alert('No hay periodos para guardar.');
    const incomplete = valid.flatMap((m) => {
      const errors: string[] = [];
      if (!!m.period1Start !== !!m.period1End) errors.push(`${m.monthName}: Periodo 1 incompleto`);
      if (!!m.period2Start !== !!m.period2End) errors.push(`${m.monthName}: Periodo 2 incompleto`);
      return errors;
    });
    if (incomplete.length) return window.alert(`Revise antes de guardar:\n${incomplete.join('\n')}`);

    const record: AnnualHiringPeriodsRecord = {
      id: existing?.id || `annual-${year}`,
      year,
      months: valid.map((m) => ({
        ...m,
        source: 'imported',
        updatedAt: new Date().toISOString(),
      })),
      sourceFileName: sourceName,
      sourceKind,
      importedAt: new Date().toISOString(),
    };
    setBusy(true);
    try {
      await saveAnnualHiringPeriods(record);
      await refresh();
      window.alert(`Anualidad ${year} guardada. Se aplicará a todas las obras.`);
    } catch (e: any) {
      window.alert(e?.message || 'No se pudieron guardar los periodos.');
    } finally { setBusy(false); }
  };

  const warningCount = months.reduce((n, m) => n + (m.warnings?.length || 0), 0);

  if (!visible) return null;
  return <>
    <button type="button" onClick={() => setOpen(true)} className="fixed z-[44] right-5 bottom-20 inline-flex items-center gap-2 rounded-2xl bg-emerald-700 text-white px-4 py-3 font-black shadow-xl hover:bg-emerald-800">
      <CalendarRange className="w-5 h-5"/>Periodos anuales
    </button>
    {open && <div className="fixed inset-0 z-[140] bg-slate-950/65 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center">
      <div className="w-full max-w-6xl max-h-[94vh] overflow-y-auto rounded-3xl bg-white dark:bg-slate-950 border dark:border-slate-800 shadow-2xl">
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-950 border-b dark:border-slate-800 px-5 py-4 flex items-center justify-between">
          <div><h2 className="font-black text-xl">Periodos anuales generales de contratación</h2><p className="text-xs text-slate-500 mt-1">Una sola anualidad para todas las obras. Cada mes puede tener Periodo 1 y Periodo 2.</p></div>
          <button onClick={() => setOpen(false)} className="p-2 rounded-xl border"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-5 sm:p-6 space-y-5">
          <div className="grid sm:grid-cols-[220px_1fr] gap-3 items-end">
            <label className="text-sm font-bold">Anualidad<input type="number" value={year} onChange={e=>setYear(Number(e.target.value)||new Date().getFullYear())} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-900"/></label>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-3 text-sm text-emerald-900 dark:text-emerald-200"><b>Aplicación global:</b> estos periodos se aplican por igual a todas las obras de la anualidad seleccionada.</div>
          </div>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={e=>void handleFile(e.target.files?.[0])}/>
          <button type="button" disabled={busy} onClick={()=>fileRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl bg-[#00548E] text-white px-4 py-3 font-bold disabled:opacity-50"><FileUp className="w-4 h-4"/>{busy ? (progress || 'Analizando…') : 'Importar PDF de periodos'}</button>
          {sourceName && <div className="text-xs text-slate-500">Documento: <b>{sourceName}</b> · lectura: {sourceKind || 'detectada'}</div>}
          {warningCount > 0 && <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 flex gap-3"><AlertTriangle className="w-5 h-5 text-amber-600 shrink-0"/><div><div className="font-black text-sm">Hay {warningCount} dato(s) que conviene revisar.</div><div className="text-xs text-slate-600 dark:text-slate-300 mt-1">La aplicación conserva las fechas leídas del PDF y no corrige automáticamente posibles erratas del documento.</div></div></div>}
          <div className="overflow-x-auto rounded-2xl border dark:border-slate-800"><table className="w-full text-sm min-w-[900px]"><thead className="bg-slate-50 dark:bg-slate-900"><tr><th className="text-left p-3">Mes</th><th className="text-left p-3">P1 inicio</th><th className="text-left p-3">P1 fin</th><th className="text-left p-3">P2 inicio</th><th className="text-left p-3">P2 fin</th><th className="text-left p-3">Revisión</th></tr></thead><tbody>{MONTHS.map((name,i)=>{const m=months.find(x=>x.month===i+1);return <tr key={name} className="border-t dark:border-slate-800"><td className="p-3 font-bold">{name}</td>{(['period1Start','period1End','period2Start','period2End'] as const).map(key=><td key={key} className="p-2"><input type="date" value={m?.[key]||''} onChange={e=>setDate(i+1,key,e.target.value)} className="w-full rounded-lg border px-2 py-2 bg-white dark:bg-slate-900"/></td>)}<td className="p-3 text-xs">{m?.warnings?.length ? <span className="text-amber-700 dark:text-amber-300 font-semibold">{m.warnings.join(' · ')}</span> : <span className="text-emerald-700 dark:text-emerald-400">OK</span>}</td></tr>})}</tbody></table></div>
          <div className="flex justify-end"><button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 text-white px-5 py-3 font-black disabled:opacity-50"><Save className="w-4 h-4"/>Guardar anualidad general</button></div>
        </div>
      </div>
    </div>}
  </>;
};
