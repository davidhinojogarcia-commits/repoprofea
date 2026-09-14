import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Clock, FileDown, HardHat, RefreshCw, Save, Users, X, Wrench, GraduationCap, ShieldCheck } from 'lucide-react';
import { Person } from '../types';
import { getDocuments } from '../src/services/databaseService';
import { loadAppBusinessSettings } from '../src/services/appSettingsService';
import { supabase } from '../src/lib/supabase';
import { downloadPDF } from '../src/lib/exportUtils';
import {
  generateEpiDeliveryPdf,
  generateMachineryAuthorizationPdf,
  generateTrainingInformationPdf,
} from '../src/lib/worksiteDocumentsPdf';
import { generateAttendancePeriodsPdf, type AttendancePeriod } from '../src/lib/worksiteAttendancePdf';

type WorkRow = {
  id: string;
  nombre: string;
  empresa?: string;
  cif?: string;
  recurso_preventivo?: string;
};

type EpiKey = 'casco' | 'chaleco' | 'orejeras' | 'gafas' | 'guantes' | 'mascarillas' | 'calzado';
type AttendancePeriodOption = AttendancePeriod & { key: string; label: string };

const DEFAULT_COMPANY = 'AEPSA (Diputación Provincial de Cádiz)';
const DEFAULT_EPIS: Record<EpiKey, boolean> = {
  casco: true,
  chaleco: true,
  orejeras: true,
  gafas: true,
  guantes: true,
  mascarillas: true,
  calzado: true,
};

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const safe = (value: unknown) => String(value ?? '').trim();
const normalize = (value: string) => safe(value).toLocaleLowerCase('es').replace(/\s+/g, ' ');
const pad = (value: number) => String(value).padStart(2, '0');
const todayIso = () => new Date().toISOString().slice(0, 10);
const workIdentity = (value: string): string => {
  const raw = normalize(value).replace(/[._\-/:]+/g, ' ');
  const code = raw.match(/\b(\d{5})\b/)?.[1] || '';
  const compact = raw.replace(/\s+/g, '');
  const type = compact.includes('gr') ? 'GR' : compact.includes('ee') ? 'EE' : '';
  return code && type ? `${code} ${type}` : '';
};
const sameWork = (left: string, right: string) => {
  const a = workIdentity(left); const b = workIdentity(right);
  return a && b ? a === b : normalize(left) === normalize(right);
};
const formatDate = (value: string) => {
  const match = safe(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : safe(value) || '-';
};
const periodLabelFor = (person: Person): string => {
  if (safe(person.quincena)) return safe(person.quincena);
  if (safe(person.periodoInicio) || safe(person.periodoFin)) return `${formatDate(person.periodoInicio)} – ${formatDate(person.periodoFin)}`;
  return 'Sin periodo';
};
const parseIso = (value: unknown) => {
  const match = safe(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), iso: `${match[1]}-${match[2]}-${match[3]}` };
};
const periodKey = (period: AttendancePeriod) => `${period.year}-${pad(period.month)}-${period.fortnight}`;
const periodBounds = (period: AttendancePeriod) => {
  const end = period.fortnight === 1 ? 15 : new Date(period.year, period.month, 0).getDate();
  const start = period.fortnight === 1 ? 1 : 16;
  return {
    start: `${period.year}-${pad(period.month)}-${pad(start)}`,
    end: `${period.year}-${pad(period.month)}-${pad(end)}`,
    startDay: start,
    endDay: end,
  };
};
const attendanceLabel = (period: AttendancePeriod) => {
  const { startDay, endDay } = periodBounds(period);
  return `${pad(startDay)}–${pad(endDay)} ${MONTHS[period.month - 1]} ${period.year}`;
};
const workerOverlapsPeriod = (person: Person, period: AttendancePeriod) => {
  const { start, end } = periodBounds(period);
  const workerStart = safe(person.periodoInicio).slice(0, 10) || start;
  const workerEnd = safe(person.periodoFin).slice(0, 10) || end;
  return workerStart <= end && workerEnd >= start;
};
const buildAttendancePeriods = (people: Person[]): AttendancePeriodOption[] => {
  const map = new Map<string, AttendancePeriodOption>();
  people.forEach(person => {
    const start = parseIso(person.periodoInicio);
    const end = parseIso(person.periodoFin) || start;
    if (!start || !end) return;
    let year = start.year;
    let month = start.month;
    let guard = 0;
    while ((year < end.year || (year === end.year && month <= end.month)) && guard < 36) {
      ([1, 2] as const).forEach(fortnight => {
        const period: AttendancePeriod = { year, month, fortnight };
        if (workerOverlapsPeriod(person, period)) {
          const key = periodKey(period);
          map.set(key, { ...period, key, label: attendanceLabel(period) });
        }
      });
      month += 1;
      if (month > 12) { month = 1; year += 1; }
      guard += 1;
    }
  });
  return Array.from(map.values()).sort((a, b) => a.year - b.year || a.month - b.month || a.fortnight - b.fortnight);
};

export const WorksiteDocumentationPortal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workers, setWorkers] = useState<Person[]>([]);
  const [workRows, setWorkRows] = useState<WorkRow[]>([]);
  const [configuredWorks, setConfiguredWorks] = useState<string[]>([]);
  const [selectedWork, setSelectedWork] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [selectedAttendancePeriodKeys, setSelectedAttendancePeriodKeys] = useState<string[]>([]);
  const [empresa, setEmpresa] = useState(DEFAULT_COMPANY);
  const [cif, setCif] = useState('');
  const [recursoPreventivo, setRecursoPreventivo] = useState('');
  const [documentDate, setDocumentDate] = useState(todayIso());
  const [trainingAction, setTrainingAction] = useState('Información y formación preventiva del puesto de trabajo y de la obra');
  const [trainingDuration, setTrainingDuration] = useState('1 h');
  const [epiSelection, setEpiSelection] = useState<Record<EpiKey, boolean>>(DEFAULT_EPIS);
  const [globalMachinery, setGlobalMachinery] = useState('');
  const [machineryByWorker, setMachineryByWorker] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(0);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [people, obras, settings] = await Promise.all([
        getDocuments<Person>('trabajadores'),
        supabase.query('obras', { query: 'select=id,nombre,empresa,cif,recurso_preventivo&order=nombre.asc' }),
        loadAppBusinessSettings(),
      ]);
      setWorkers(people || []);
      setWorkRows((obras || []) as WorkRow[]);
      setConfiguredWorks((settings.savedObras || []).map(safe).filter(Boolean));
    } catch (error) {
      console.error('No se pudo cargar Documentación de obra:', error);
      showToast('No se han podido cargar las obras y trabajadores.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const handleNavigation = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: string }>).detail;
      const open = detail?.view === 'documentacion_obra';
      setIsOpen(open);
      if (open) void refresh();
    };
    window.addEventListener('profea:navigate', handleNavigation as EventListener);
    return () => window.removeEventListener('profea:navigate', handleNavigation as EventListener);
  }, [refresh]);

  useEffect(() => {
    const updateWidth = () => {
      if (window.innerWidth < 1024) return setSidebarWidth(0);
      const sidebar = document.querySelector('.profea-sidebar-shell') as HTMLElement | null;
      setSidebarWidth(sidebar?.getBoundingClientRect().width || 0);
    };
    updateWidth();
    const sidebar = document.querySelector('.profea-sidebar-shell') as HTMLElement | null;
    const observer = sidebar && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateWidth) : null;
    if (sidebar && observer) observer.observe(sidebar);
    window.addEventListener('resize', updateWidth);
    return () => { observer?.disconnect(); window.removeEventListener('resize', updateWidth); };
  }, [isOpen]);

  const workNames = useMemo(() => {
    const values = new Set<string>(configuredWorks.map(work => workIdentity(work) || safe(work)).filter(Boolean));
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }, [configuredWorks]);

  useEffect(() => {
    if (!selectedWork && workNames.length) setSelectedWork(workNames[0]);
    if (selectedWork && !workNames.includes(selectedWork) && workNames.length) setSelectedWork(workNames[0]);
  }, [selectedWork, workNames]);

  const selectedWorkWorkers = useMemo(() => workers.filter(person => sameWork(person.obra || '', selectedWork)), [workers, selectedWork]);
  const periods = useMemo(() => Array.from(new Set(selectedWorkWorkers.map(periodLabelFor))).sort((a, b) => a.localeCompare(b, 'es', { numeric: true })), [selectedWorkWorkers]);

  useEffect(() => {
    if (!selectedPeriod || !periods.includes(selectedPeriod)) setSelectedPeriod(periods[0] || '');
  }, [periods, selectedPeriod]);

  const periodWorkers = useMemo(() => selectedWorkWorkers.filter(person => !selectedPeriod || periodLabelFor(person) === selectedPeriod), [selectedWorkWorkers, selectedPeriod]);
  const attendancePeriods = useMemo(() => buildAttendancePeriods(selectedWorkWorkers), [selectedWorkWorkers]);
  const selectedAttendancePeriods = useMemo(() => attendancePeriods.filter(period => selectedAttendancePeriodKeys.includes(period.key)), [attendancePeriods, selectedAttendancePeriodKeys]);

  useEffect(() => {
    setSelectedAttendancePeriodKeys(prev => prev.filter(key => attendancePeriods.some(period => period.key === key)));
  }, [attendancePeriods]);

  const attendanceSheetCount = useMemo(() => selectedAttendancePeriods.reduce((sum, period) => sum + selectedWorkWorkers.filter(person => workerOverlapsPeriod(person, period)).length, 0), [selectedAttendancePeriods, selectedWorkWorkers]);

  useEffect(() => {
    const row = workRows.find(item => sameWork(item.nombre, selectedWork));
    setEmpresa(safe(row?.empresa) || DEFAULT_COMPANY);
    setCif(safe(row?.cif));
    setRecursoPreventivo(safe(row?.recurso_preventivo));
  }, [selectedWork, workRows]);

  useEffect(() => {
    const dated = periodWorkers.map(p => safe(p.periodoInicio)).filter(Boolean).sort()[0];
    setDocumentDate(dated && /^\d{4}-\d{2}-\d{2}/.test(dated) ? dated.slice(0, 10) : todayIso());
    const storageKey = `profea:obra-docs:maquinaria:${selectedWork}:${selectedPeriod}`;
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
      setMachineryByWorker(parsed && typeof parsed === 'object' ? parsed : {});
    } catch { setMachineryByWorker({}); }
  }, [selectedWork, selectedPeriod, periodWorkers]);

  useEffect(() => {
    if (!selectedWork || !selectedPeriod) return;
    localStorage.setItem(`profea:obra-docs:maquinaria:${selectedWork}:${selectedPeriod}`, JSON.stringify(machineryByWorker));
  }, [machineryByWorker, selectedWork, selectedPeriod]);

  const saveWorkConfig = async () => {
    if (!selectedWork) return;
    if (!safe(recursoPreventivo)) return showToast('Indica el encargado/recurso preventivo de la obra.', 'error');
    setSaving(true);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error('Sesión no disponible');
      const row = workRows.find(item => sameWork(item.nombre, selectedWork));
      const body = { empresa: safe(empresa) || DEFAULT_COMPANY, cif: safe(cif), recurso_preventivo: safe(recursoPreventivo), updated_by: data.user.id };
      if (row) {
        await supabase.query('obras', { method: 'PATCH', prefer: 'return=minimal', query: `id=eq.${encodeURIComponent(row.id)}`, body });
      } else {
        await supabase.query('obras', { method: 'POST', prefer: 'return=minimal', body: { nombre: selectedWork, codigo: '', municipio: '', descripcion: '', ...body, owner_id: data.user.id, created_by: data.user.id } });
      }
      await refresh();
      showToast('Datos de la obra guardados.');
    } catch (error) {
      console.error('Error guardando configuración de obra:', error);
      showToast('No se ha podido guardar el recurso preventivo de la obra.', 'error');
    } finally { setSaving(false); }
  };

  const ensureReady = () => {
    if (!selectedWork) return showToast('Selecciona una obra.', 'error'), false;
    if (!selectedPeriod) return showToast('Selecciona un periodo.', 'error'), false;
    if (!periodWorkers.length) return showToast('No hay trabajadores contratados en ese periodo.', 'error'), false;
    if (!safe(recursoPreventivo)) return showToast('Indica el encargado/recurso preventivo antes de generar el documento.', 'error'), false;
    return true;
  };

  const context = useMemo(() => ({
    obra: selectedWork,
    empresa: safe(empresa) || DEFAULT_COMPANY,
    cif: safe(cif),
    recursoPreventivo: safe(recursoPreventivo),
    fecha: documentDate,
    periodoLabel: selectedPeriod || 'Sin periodo',
    accionFormativa: trainingAction,
    duracionFormacion: trainingDuration,
    epis: epiSelection,
    maquinariaPorTrabajador: machineryByWorker,
  }), [selectedWork, empresa, cif, recursoPreventivo, documentDate, selectedPeriod, trainingAction, trainingDuration, epiSelection, machineryByWorker]);

  const exportEpis = () => { if (!ensureReady()) return; const { doc, filename } = generateEpiDeliveryPdf(periodWorkers, context); downloadPDF(doc, filename); };
  const exportTraining = () => { if (!ensureReady()) return; const { doc, filename } = generateTrainingInformationPdf(periodWorkers, context); downloadPDF(doc, filename); };
  const exportMachinery = () => {
    if (!ensureReady()) return;
    const missing = periodWorkers.filter(p => !safe(machineryByWorker[String(p.id)]));
    if (missing.length && !window.confirm(`${missing.length} trabajador(es) no tienen maquinaria indicada. ¿Generar el PDF igualmente?`)) return;
    const { doc, filename } = generateMachineryAuthorizationPdf(periodWorkers, context); downloadPDF(doc, filename);
  };
  const exportAttendance = () => {
    if (!selectedWork) return showToast('Selecciona una obra.', 'error');
    if (!safe(recursoPreventivo)) return showToast('Indica el encargado/recurso preventivo antes de generar el control horario.', 'error');
    if (!selectedAttendancePeriods.length) return showToast('Selecciona al menos un periodo de control horario.', 'error');
    if (!attendanceSheetCount) return showToast('No hay trabajadores contratados en los periodos seleccionados.', 'error');
    const attendanceContext = { ...context, periodoLabel: selectedAttendancePeriods.map(period => period.label).join(' · ') };
    const { doc, filename } = generateAttendancePeriodsPdf(selectedWorkWorkers, attendanceContext, selectedAttendancePeriods.map(({ year, month, fortnight }) => ({ year, month, fortnight })));
    downloadPDF(doc, filename);
  };

  const toggleAttendancePeriod = (key: string) => setSelectedAttendancePeriodKeys(prev => prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key]);
  const applyMachineryToAll = () => {
    const value = safe(globalMachinery); if (!value) return;
    setMachineryByWorker(prev => { const next = { ...prev }; periodWorkers.forEach(person => { next[String(person.id)] = value; }); return next; });
  };
  const closeAndGoToSummary = () => {
    const button = document.querySelector('[data-profea-view="dashboard"]') as HTMLButtonElement | null;
    if (button) button.click(); else setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed top-0 right-0 bottom-0 z-[35] overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100" style={{ left: sidebarWidth }}>
      <div className="min-h-full px-4 sm:px-7 lg:px-9 py-6 pb-16">
        <div className="max-w-[1500px] mx-auto space-y-6">
          <header className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-[#003f6b] via-[#00548E] to-[#0876b8] px-6 py-5 text-white flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div><div className="flex items-center gap-3"><ClipboardCheck className="w-7 h-7" /><h1 className="text-2xl font-black tracking-tight">Documentación de obra</h1></div><p className="text-sm text-blue-100 mt-1">Documentos preventivos y de control por obra y periodo. El catálogo de obras se gestiona exclusivamente desde Configuración → Obras.</p></div>
              <div className="flex gap-2"><button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar</button><button type="button" onClick={closeAndGoToSummary} className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"><X className="w-4 h-4" /> Cerrar</button></div>
            </div>
          </header>

          <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6">
            <aside className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm h-fit xl:sticky xl:top-5">
              <div className="flex items-center justify-between mb-3"><h2 className="font-black text-sm uppercase tracking-wider text-slate-600 dark:text-slate-300">Obras</h2><span className="text-xs font-bold rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 px-2.5 py-1">{workNames.length}</span></div>
              <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">{workNames.map(work => { const count = workers.filter(p => sameWork(p.obra || '', work)).length; return <button key={work} type="button" onClick={() => setSelectedWork(work)} className={`w-full text-left rounded-2xl border px-4 py-3 transition ${selectedWork === work ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-100 shadow-sm' : 'border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700'}`}><div className="font-bold text-sm leading-tight">{work}</div><div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{count} registro(s) de trabajadores</div></button>; })}{!workNames.length && <div className="p-4 text-sm text-slate-500">No hay obras registradas en Configuración → Obras.</div>}</div>
            </aside>

            <main className="space-y-6 min-w-0">
              <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-5"><HardHat className="w-5 h-5 text-blue-600" /><h2 className="font-black text-lg">Datos de la obra y periodo</h2></div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <label className="text-sm font-semibold">Obra<input value={selectedWork} readOnly className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3 py-2.5" /></label>
                  <label className="text-sm font-semibold">Periodo para EPIs / formación / maquinaria<select value={selectedPeriod} onChange={e => setSelectedPeriod(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5">{periods.map(period => <option key={period}>{period}</option>)}</select></label>
                  <label className="text-sm font-semibold">Fecha del documento<input type="date" value={documentDate} onChange={e => setDocumentDate(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5" /></label>
                  <label className="text-sm font-semibold">Trabajadores del periodo<input value={periodWorkers.length} readOnly className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3 py-2.5 font-bold" /></label>
                  <label className="text-sm font-semibold sm:col-span-2">Empresa<input value={empresa} onChange={e => setEmpresa(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5" /></label>
                  <label className="text-sm font-semibold">CIF<input value={cif} onChange={e => setCif(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5" /></label>
                  <label className="text-sm font-semibold">Encargado / recurso preventivo<input value={recursoPreventivo} onChange={e => setRecursoPreventivo(e.target.value)} placeholder="Nombre y apellidos" className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5" /></label>
                </div>
                <div className="mt-5 rounded-2xl border border-blue-200 dark:border-blue-900/70 bg-blue-50/60 dark:bg-blue-950/20 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"><div><div className="text-sm font-black text-blue-900 dark:text-blue-100">Periodos de control horario</div><p className="text-xs text-blue-700/80 dark:text-blue-300/80 mt-1">Marca uno o varios periodos. Se generará una ficha por trabajador y por periodo en el que su contrato esté vigente.</p></div>{selectedAttendancePeriodKeys.length > 0 && <button type="button" onClick={() => setSelectedAttendancePeriodKeys([])} className="text-xs font-bold text-blue-700 dark:text-blue-300 hover:underline">Quitar selección</button>}</div>
                  <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{attendancePeriods.map(period => <label key={period.key} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 cursor-pointer transition ${selectedAttendancePeriodKeys.includes(period.key) ? 'border-blue-500 bg-white dark:bg-blue-950/40' : 'border-blue-200 dark:border-blue-900 bg-white/60 dark:bg-slate-900/60'}`}><input type="checkbox" checked={selectedAttendancePeriodKeys.includes(period.key)} onChange={() => toggleAttendancePeriod(period.key)} /><span className="text-sm font-semibold">{period.label}</span></label>)}</div>
                  {!attendancePeriods.length && <div className="mt-3 text-sm text-slate-500">No hay periodos de contratación con fechas válidas para esta obra.</div>}
                </div>
                <div className="mt-4 flex justify-end"><button type="button" disabled={saving} onClick={() => void saveWorkConfig()} className="inline-flex items-center gap-2 rounded-xl bg-[#00548E] hover:bg-[#004270] text-white px-4 py-2.5 font-bold disabled:opacity-60"><Save className="w-4 h-4" /> {saving ? 'Guardando…' : 'Guardar datos de la obra'}</button></div>
              </section>

              <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4"><Users className="w-5 h-5 text-blue-600" /><h2 className="font-black text-lg">Trabajadores del periodo</h2></div>
                <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800"><table className="w-full text-sm min-w-[720px]"><thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"><tr><th className="text-left px-4 py-3">Nombre y apellidos</th><th className="text-left px-4 py-3">DNI/NIE</th><th className="text-left px-4 py-3">Puesto</th><th className="text-left px-4 py-3">Inicio</th><th className="text-left px-4 py-3">Fin</th><th className="text-left px-4 py-3">Calzado</th></tr></thead><tbody>{periodWorkers.map(person => <tr key={person.id} className="border-t border-slate-200 dark:border-slate-800"><td className="px-4 py-3 font-semibold">{person.apellidosNombre}</td><td className="px-4 py-3">{person.dni}</td><td className="px-4 py-3">{person.categoria || '-'}</td><td className="px-4 py-3">{formatDate(person.periodoInicio)}</td><td className="px-4 py-3">{formatDate(person.periodoFin)}</td><td className="px-4 py-3">{person.calzado || '-'}</td></tr>)}</tbody></table></div>
              </section>

              <div className="grid lg:grid-cols-3 gap-5">
                <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex flex-col"><div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-600" /><h3 className="font-black">Entrega de EPIs</h3></div><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Genera la relación nominal con los EPIs y la firma de cada trabajador.</p><div className="mt-4 grid grid-cols-2 gap-2 text-xs">{(Object.keys(DEFAULT_EPIS) as EpiKey[]).map(key => <label key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-2.5 py-2"><input type="checkbox" checked={epiSelection[key]} onChange={e => setEpiSelection(prev => ({ ...prev, [key]: e.target.checked }))} /><span className="capitalize">{key}</span></label>)}</div><button type="button" onClick={exportEpis} className="mt-auto pt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 font-bold"><FileDown className="w-4 h-4" /> Generar PDF EPIs</button></section>
                <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex flex-col"><div className="flex items-center gap-2"><GraduationCap className="w-5 h-5 text-indigo-600" /><h3 className="font-black">Formación e información</h3></div><label className="mt-4 text-xs font-bold">Acción formativa / información<textarea value={trainingAction} onChange={e => setTrainingAction(e.target.value)} rows={3} className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2" /></label><label className="mt-3 text-xs font-bold">Duración<input value={trainingDuration} onChange={e => setTrainingDuration(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2" /></label><button type="button" onClick={exportTraining} className="mt-auto pt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 font-bold"><FileDown className="w-4 h-4" /> Generar PDF Formación</button></section>
                <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex flex-col"><div className="flex items-center gap-2"><Wrench className="w-5 h-5 text-amber-600" /><h3 className="font-black">Autorización de maquinaria</h3></div><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Puedes indicar varias máquinas o equipos a la vez y aplicarlas a todos los trabajadores del periodo.</p><textarea value={globalMachinery} onChange={e => setGlobalMachinery(e.target.value)} rows={3} placeholder="Ej.: Dumper, hormigonera, radial…" className="mt-4 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" /><button type="button" onClick={applyMachineryToAll} className="mt-2 rounded-xl border border-amber-300 dark:border-amber-800 px-3 py-2 text-sm font-bold text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/30">Aplicar a todos</button><button type="button" onClick={exportMachinery} className="mt-auto pt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-4 py-3 font-bold"><FileDown className="w-4 h-4" /> Generar PDF Maquinaria</button></section>
              </div>

              <section className="rounded-3xl border border-blue-200 dark:border-blue-900/70 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
                  <div className="max-w-3xl"><div className="flex items-center gap-2"><Clock className="w-5 h-5 text-[#00548E] dark:text-blue-400" /><h3 className="font-black text-lg">Control horario quincenal</h3></div><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Ya no se generan mediante dos botones. Marca arriba los periodos que necesites y aquí se generará un único PDF con todas las fichas seleccionadas. Cada trabajador aparece únicamente en los periodos en los que su contrato está vigente y los días anteriores al alta o posteriores a la baja quedan fuera de contrato.</p><div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 px-3 py-1.5">Periodos seleccionados: {selectedAttendancePeriods.length}</span><span className="rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 px-3 py-1.5">Fichas a generar: {attendanceSheetCount}</span></div></div>
                  <button type="button" onClick={exportAttendance} disabled={!selectedAttendancePeriods.length} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] hover:bg-[#004270] text-white px-5 py-3 font-bold disabled:opacity-50 disabled:cursor-not-allowed min-w-[260px]"><FileDown className="w-4 h-4" /> Generar periodos seleccionados</button>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm"><div className="flex items-center gap-2 mb-4"><Wrench className="w-5 h-5 text-amber-600" /><h2 className="font-black text-lg">Maquinaria autorizada por trabajador</h2></div><div className="space-y-3">{periodWorkers.map(person => <div key={person.id} className="grid md:grid-cols-[minmax(230px,0.7fr)_minmax(0,1.3fr)] gap-3 items-center rounded-2xl border border-slate-200 dark:border-slate-800 p-3"><div><div className="font-bold text-sm">{person.apellidosNombre}</div><div className="text-xs text-slate-500">{person.dni} · {person.categoria || 'Sin puesto'}</div></div><input value={machineryByWorker[String(person.id)] || ''} onChange={e => setMachineryByWorker(prev => ({ ...prev, [String(person.id)]: e.target.value }))} placeholder="Varias máquinas separadas por coma" className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm" /></div>)}</div></section>
            </main>
          </div>
        </div>
      </div>
      {toast && <div className={`fixed top-5 right-5 z-[80] rounded-xl px-4 py-3 shadow-xl border text-sm font-semibold ${toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-950 dark:text-green-100' : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950 dark:text-red-100'}`}>{toast.message}</div>}
    </div>
  );
};