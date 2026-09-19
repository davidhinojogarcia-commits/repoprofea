import React from 'react';
import {
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  CalendarCheck2,
  CheckCircle2,
  Compass,
  FileCheck2,
  HardHat,
  Settings2,
  UserPlus,
  Users,
  Wrench,
} from 'lucide-react';
import type { ViewMode } from './Sidebar';

interface GuidedHomeProps {
  workersCount: number;
  worksCount: number;
  alertsCount: number;
  onNavigate: (view: ViewMode) => void;
  onOpenAlerts: () => void;
  onShowCompleteView: () => void;
}

type GuidedStep = {
  step: number;
  title: string;
  description: string;
  view: ViewMode;
  icon: React.ElementType;
};

const guidedSteps: GuidedStep[] = [
  { step: 1, title: 'Selección SAE', description: 'Empieza aquí para seleccionar y contratar trabajadores.', view: 'sae', icon: BriefcaseBusiness },
  { step: 2, title: 'Trabajadores', description: 'Revisa sus datos, documentación e historial.', view: 'directorio', icon: Users },
  { step: 3, title: 'Reconocimientos médicos', description: 'Comprueba citas, aptitud y fechas de vigencia.', view: 'citas', icon: CalendarCheck2 },
  { step: 4, title: 'Documentación de obra', description: 'Completa, revisa y firma los documentos de la obra.', view: 'documentacion_obra', icon: FileCheck2 },
  { step: 5, title: 'CAE', description: 'Revisa la coordinación y documentación de empresas.', view: 'subcontratas', icon: HardHat },
  { step: 6, title: 'Maquinaria y herramientas', description: 'Consulta equipos disponibles, asignados o averiados.', view: 'inventario', icon: Wrench },
];

export const GuidedHome: React.FC<GuidedHomeProps> = ({
  workersCount, worksCount, alertsCount, onNavigate, onOpenAlerts, onShowCompleteView,
}) => {
  const firstStep = guidedSteps[0];
  const FirstStepIcon = firstStep.icon;

  return (
    <div className="guided-home space-y-6">
      <section className="guided-hero ui-surface overflow-hidden">
        <div className="p-5 sm:p-7">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-black text-brand-primary dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
              <Compass className="h-5 w-5" aria-hidden="true" />
              Vista guiada
            </div>
            <h1 className="mt-4 text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">Te ayudamos paso a paso</h1>
            <p className="mt-2 max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-300">
              Si tienes dudas, empieza por el primer paso y sigue el orden. Siempre puedes volver a Resumen.
            </p>
          </div>
        </div>
      </section>

      <section className="guided-start-card rounded-2xl border-2 border-blue-300 bg-blue-50/80 p-5 sm:p-6 dark:border-blue-800 dark:bg-blue-950/30" aria-labelledby="guided-start-title">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="guided-start-icon flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-brand-primary text-white shadow-lg">
            <FirstStepIcon className="h-8 w-8" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black uppercase tracking-[0.12em] text-brand-primary dark:text-blue-300">Empieza aquí · Paso 1</p>
            <h2 id="guided-start-title" className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{firstStep.title}</h2>
            <p className="mt-2 text-base leading-6 text-slate-700 dark:text-slate-200">{firstStep.description}</p>
          </div>
          <button type="button" onClick={() => onNavigate(firstStep.view)} className="guided-start-button inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-brand-primary px-6 py-3 text-base font-black text-white shadow-lg" aria-label="Ir al paso 1: Selección SAE">
            Empezar <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </section>

      <section aria-labelledby="guided-route-title">
        <div className="mb-4">
          <h2 id="guided-route-title" className="text-xl font-black text-slate-900 dark:text-white">Sigue estos pasos</h2>
          <p className="mt-1 text-base leading-6 text-slate-600 dark:text-slate-300">Están colocados en el orden habitual de trabajo.</p>
        </div>
        <div className="guided-route grid grid-cols-1 gap-3 lg:grid-cols-2">
          {guidedSteps.slice(1).map((action) => {
            const Icon = action.icon;
            return (
              <button
                type="button"
                key={action.view}
                onClick={() => onNavigate(action.view)}
                className="guided-step-card ui-surface group flex min-h-[112px] items-center gap-4 p-4 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/30"
                aria-label={'Paso ' + action.step + '. ' + action.title + '. ' + action.description}
              >
                <span className="guided-step-number flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-primary text-lg font-black text-white">{action.step}</span>
                <span className="guided-action-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-brand-primary dark:bg-blue-950/40 dark:text-blue-300">
                  <Icon className="h-7 w-7" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="guided-action-title block text-base font-black leading-6 text-slate-900 dark:text-white">{action.title}</span>
                  <span className="guided-action-description mt-1 block text-sm leading-5 text-slate-600 dark:text-slate-300">{action.description}</span>
                </span>
                <ArrowRight className="h-6 w-6 shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-brand-primary dark:text-slate-500 dark:group-hover:text-blue-300" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="guided-help-title" className="guided-help-panel ui-surface p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <div>
            <h2 id="guided-help-title" className="text-lg font-black text-slate-900 dark:text-white">No pasa nada si no recuerdas dónde está algo</h2>
            <p className="mt-1 text-base leading-6 text-slate-600 dark:text-slate-300">
              Vuelve a <strong>Resumen</strong> y sigue de nuevo los pasos. Los botones indican claramente qué hace cada opción.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="guided-other-title">
        <div className="mb-3"><h2 id="guided-other-title" className="text-lg font-black text-slate-900 dark:text-white">Otras opciones</h2></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <button type="button" onClick={() => onNavigate('registro')} className="guided-secondary-action ui-surface flex min-h-[104px] items-center gap-4 p-4 text-left">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-brand-primary dark:bg-blue-950/40 dark:text-blue-300"><UserPlus className="h-6 w-6" aria-hidden="true" /></span>
            <span><span className="block font-black text-slate-900 dark:text-white">Añadir trabajador</span><span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">Alta manual paso a paso.</span></span>
          </button>
          <button type="button" onClick={onOpenAlerts} className="guided-secondary-action ui-surface flex min-h-[104px] items-center gap-4 p-4 text-left">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"><Bell className="h-6 w-6" aria-hidden="true" /></span>
            <span><span className="block font-black text-slate-900 dark:text-white">Avisos pendientes</span><span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">{alertsCount} aviso(s) por revisar.</span></span>
          </button>
          <div className="guided-status-card ui-surface min-h-[104px] p-4">
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">Estado rápido</p>
            <p className="mt-2 text-base font-black text-slate-900 dark:text-white">{workersCount} trabajadores</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{worksCount} obras configuradas</p>
          </div>
          <button type="button" onClick={onShowCompleteView} className="guided-complete-button ui-button-secondary flex min-h-[104px] items-center justify-center gap-3 px-4 text-left">
            <Settings2 className="h-6 w-6 shrink-0" aria-hidden="true" />
            <span><span className="block font-black">Vista completa</span><span className="mt-1 block text-sm font-medium">Opciones avanzadas.</span></span>
          </button>
        </div>
      </section>
    </div>
  );
};
