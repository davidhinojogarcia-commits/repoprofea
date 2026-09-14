import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BriefcaseBusiness, CalendarDays, FileCheck2, HardHat, HeartPulse, History, IdCard, Loader2, Phone, ShieldCheck, UserRound } from 'lucide-react';
import type { Person } from '../types';
import { getDocuments } from '../src/services/databaseService';

interface WorkerQrPortalProps {
  dni: string;
}

const normalizeDni = (value: unknown) => String(value || '').trim().toUpperCase().replace(/[\s-]/g, '');
const display = (value: unknown, fallback = '—') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};
const formatDate = (value: unknown) => {
  const text = String(value || '').trim();
  if (!text) return '—';
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : text;
};

const Section: React.FC<{ title: string; icon: React.ElementType; children: React.ReactNode }> = ({ title, icon: Icon, children }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-[0.12em] text-brand-primary dark:text-blue-300">
      <Icon className="h-4 w-4" /> {title}
    </h2>
    {children}
  </section>
);

const Field: React.FC<{ label: string; value: React.ReactNode; wide?: boolean }> = ({ label, value, wide = false }) => (
  <div className={wide ? 'sm:col-span-2' : ''}>
    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
    <div className="mt-1 break-words text-sm font-semibold text-slate-800 dark:text-slate-100">{value}</div>
  </div>
);

export const WorkerQrPortal: React.FC<WorkerQrPortalProps> = ({ dni }) => {
  const normalizedDni = useMemo(() => normalizeDni(dni), [dni]);
  const [history, setHistory] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const workers = await getDocuments<Person>('trabajadores', { includeShared: true });
        if (!active) return;
        const matches = workers
          .filter(worker => normalizeDni(worker.dni) === normalizedDni)
          .sort((a, b) => {
            const aDate = String(a.periodoInicio || a.fechaRegistro || '');
            const bDate = String(b.periodoInicio || b.fechaRegistro || '');
            return bDate.localeCompare(aDate);
          });
        setHistory(matches);
        if (!matches.length) {
          setError('No se ha encontrado este trabajador o tu cuenta no tiene permiso para consultar su ficha.');
        }
      } catch (e: any) {
        if (!active) return;
        setError(e?.message || 'No se ha podido cargar la ficha del trabajador.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [normalizedDni]);

  const worker = history[0];
  const medicalState = display(worker?.reconocimientoEstado || worker?.aptitudMedica, 'Pendiente');

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center px-4">
        <div className="flex items-center gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300"><Loader2 className="h-5 w-5 animate-spin text-brand-primary" /> Cargando ficha del trabajador…</div>
      </div>
    );
  }

  if (!worker) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center px-4">
        <div className="w-full max-w-lg rounded-2xl border border-amber-200 bg-white p-7 text-center shadow-xl dark:border-amber-900 dark:bg-slate-900">
          <ShieldCheck className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">Ficha no disponible</h1>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{error}</p>
          <button type="button" onClick={() => window.location.assign('/')} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-secondary"><ArrowLeft className="h-4 w-4" /> Volver a PROFEA</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-brand-primary dark:text-blue-300">Expediente digital PROFEA</div>
            <div className="truncate text-sm font-bold">{display(worker.apellidosNombre)}</div>
          </div>
          <button type="button" onClick={() => window.location.assign('/')} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"><ArrowLeft className="h-4 w-4" /> PROFEA</button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:py-8">
        <div className="rounded-3xl bg-gradient-to-br from-[#00548E] to-blue-800 p-6 text-white shadow-xl">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-100"><IdCard className="h-4 w-4" /> Trabajador</div>
              <h1 className="mt-2 text-2xl font-black sm:text-3xl">{display(worker.apellidosNombre)}</h1>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-blue-50">
                <span className="font-mono font-bold">DNI/NIE: {display(worker.dni)}</span>
                <span>{display(worker.categoria, 'Sin categoría')}</span>
                <span>{display(worker.obra, 'Sin obra')}</span>
              </div>
            </div>
            <div className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
              <div className="text-[10px] font-bold uppercase tracking-wider text-blue-100">Estado médico</div>
              <div className="mt-1 text-lg font-black">{medicalState}</div>
              {worker.reconocimientoValidez && <div className="mt-1 text-xs text-blue-100">Válido hasta {formatDate(worker.reconocimientoValidez)}</div>}
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Datos personales" icon={UserRound}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Nombre y apellidos" value={display(worker.apellidosNombre)} wide />
              <Field label="DNI / NIE" value={display(worker.dni)} />
              <Field label="Fecha de nacimiento" value={formatDate(worker.fechaNacimiento)} />
              <Field label="Teléfono" value={<span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-400" />{display(worker.telefono)}</span>} />
              <Field label="Talla de calzado" value={display(worker.calzado)} />
            </div>
          </Section>

          <Section title="Contratación actual" icon={BriefcaseBusiness}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Obra" value={display(worker.obra)} wide />
              <Field label="Categoría" value={display(worker.categoria)} />
              <Field label="Quincena" value={display(worker.quincena)} />
              <Field label="Nº de oferta" value={display(worker.numOferta)} />
              <Field label="Supervisor" value={display(worker.supervisorResponsable)} />
              <Field label="Inicio" value={formatDate(worker.periodoInicio)} />
              <Field label="Fin" value={formatDate(worker.periodoFin)} />
            </div>
          </Section>

          <Section title="Prevención y formación" icon={HardHat}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Formación" value={display(worker.formacion)} />
              <Field label="Lugar de formación" value={display(worker.lugarFormacion)} />
              <Field label="Necesita reconocimiento" value={display(worker.necesitaReconocimiento)} />
              <Field label="Cita médica" value={`${formatDate(worker.citaDia)}${worker.citaHora ? ` · ${worker.citaHora}` : ''}`} />
              <Field label="Centro / lugar" value={display(worker.sitioReconocimiento)} wide />
            </div>
          </Section>

          <Section title="Reconocimiento médico" icon={HeartPulse}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Resultado" value={medicalState} />
              <Field label="Fecha" value={formatDate(worker.reconocimientoFecha)} />
              <Field label="Validez" value={formatDate(worker.reconocimientoValidez)} />
              <Field label="Limitaciones" value={display(worker.reconocimientoLimitaciones || worker.limitacionesAptitud, 'Sin limitaciones registradas')} wide />
              <Field label="Observaciones médicas" value={display(worker.reconocimientoObservaciones, 'Sin observaciones')} wide />
            </div>
          </Section>

          <Section title="Documentación" icon={FileCheck2}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Documentación completa" value={display(worker.documentacionCompleta)} />
              <Field label="Fecha de registro" value={formatDate(worker.fechaRegistro)} />
              <Field label="Observaciones" value={display(worker.observaciones, 'Sin observaciones')} wide />
            </div>
          </Section>

          <Section title="Resumen del expediente" icon={CalendarDays}>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-slate-50 p-4 text-center dark:bg-slate-800/60"><div className="text-2xl font-black text-brand-primary dark:text-blue-300">{history.length}</div><div className="mt-1 text-xs font-semibold text-slate-500">registros históricos</div></div>
              <div className="rounded-xl bg-slate-50 p-4 text-center dark:bg-slate-800/60"><div className="text-2xl font-black text-brand-primary dark:text-blue-300">{new Set(history.map(item => item.obra).filter(Boolean)).size}</div><div className="mt-1 text-xs font-semibold text-slate-500">obras distintas</div></div>
            </div>
          </Section>
        </div>

        <Section title="Historial del trabajador" icon={History}>
          <div className="space-y-3">
            {history.map((item, index) => (
              <article key={item.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-xs font-black uppercase tracking-wider text-brand-primary dark:text-blue-300">Registro {history.length - index}</div>
                    <div className="mt-1 font-bold text-slate-900 dark:text-white">{display(item.obra, 'Obra no indicada')}</div>
                    <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{display(item.categoria, 'Categoría no indicada')} · Oferta {display(item.numOferta)}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{formatDate(item.periodoInicio)} → {formatDate(item.periodoFin)}</div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-3">
                  <div><span className="font-bold">Quincena:</span> {display(item.quincena)}</div>
                  <div><span className="font-bold">Supervisor:</span> {display(item.supervisorResponsable)}</div>
                  <div><span className="font-bold">Médico:</span> {display(item.reconocimientoEstado || item.aptitudMedica, 'Pendiente')}</div>
                </div>
              </article>
            ))}
          </div>
        </Section>

        <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> Esta ficha solo se muestra a usuarios autenticados que sean propietarios del trabajador, administradores o tengan el trabajador compartido explícitamente.
        </div>
      </main>
    </div>
  );
};
