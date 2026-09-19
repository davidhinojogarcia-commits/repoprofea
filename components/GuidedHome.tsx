import React from 'react';
import {
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  CalendarCheck2,
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

type GuidedAction = {
  title: string;
  description: string;
  view: ViewMode;
  icon: React.ElementType;
};

const actions: GuidedAction[] = [
  {
    title: 'Añadir trabajador',
    description: 'Dar de alta a una persona paso a paso.',
    view: 'registro',
    icon: UserPlus,
  },
  {
    title: 'Ver trabajadores',
    description: 'Consultar fichas, documentos e historial.',
    view: 'directorio',
    icon: Users,
  },
  {
    title: 'Documentación de obra',
    description: 'Ver, completar y firmar documentos de la obra.',
    view: 'documentacion_obra',
    icon: FileCheck2,
  },
  {
    title: 'Revisar CAE',
    description: 'Comprobar la documentación y los requisitos de coordinación.',
    view: 'subcontratas',
    icon: HardHat,
  },
  {
    title: 'Reconocimientos médicos',
    description: 'Consultar citas, aptitudes y fechas de vigencia.',
    view: 'citas',
    icon: CalendarCheck2,
  },
  {
    title: 'Maquinaria y herramientas',
    description: 'Ver equipos disponibles, asignados o averiados.',
    view: 'inventario',
    icon: Wrench,
  },
  {
    title: 'Selección SAE',
    description: 'Entrar en el proceso de selección y contratación.',
    view: 'sae',
    icon: BriefcaseBusiness,
  },
];

export const GuidedHome: React.FC<GuidedHomeProps> = ({
  workersCount,
  worksCount,
  alertsCount,
  onNavigate,
  onOpenAlerts,
  onShowCompleteView,
}) => {
  return (
    <div className="guided-home space-y-6">
      <section className="guided-hero ui-surface overflow-hidden">
        <div className="p-5 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-black text-brand-primary dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
                <Compass className="h-5 w-5" aria-hidden="true" />
                Vista guiada activa
              </div>
              <h1 className="mt-4 text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                ¿Qué quieres hacer ahora?
              </h1>
              <p className="mt-2 max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-300">
                Pulsa una de las opciones de abajo. La aplicación te llevará directamente al lugar correcto.
              </p>
            </div>
            <button
              type="button"
              onClick={onShowCompleteView}
              className="guided-complete-button ui-button-secondary flex min-h-12 items-center justify-center gap-2 px-4"
            >
              <Settings2 className="h-5 w-5" aria-hidden="true" />
              Cambiar a Vista completa
            </button>
          </div>
        </div>
      </section>

      <section aria-labelledby="guided-actions-title">
        <div className="mb-4">
          <h2 id="guided-actions-title" className="text-xl font-black text-slate-900 dark:text-white">
            Tareas habituales
          </h2>
          <p className="mt-1 text-base leading-6 text-slate-600 dark:text-slate-300">
            Elige solo lo que necesitas hacer.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                type="button"
                key={action.view}
                onClick={() => onNavigate(action.view)}
                className="guided-action-card ui-surface group flex min-h-[124px] items-center gap-4 p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/30"
                aria-label={`${action.title}. ${action.description}`}
              >
                <span className="guided-action-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-brand-primary dark:bg-blue-950/40 dark:text-blue-300">
                  <Icon className="h-7 w-7" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="guided-action-title block text-base font-black leading-6 text-slate-900 dark:text-white">
                    {action.title}
                  </span>
                  <span className="guided-action-description mt-1 block text-sm leading-5 text-slate-600 dark:text-slate-300">
                    {action.description}
                  </span>
                </span>
                <ArrowRight className="h-6 w-6 shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-brand-primary dark:text-slate-500 dark:group-hover:text-blue-300" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="guided-summary-title">
        <div className="mb-3">
          <h2 id="guided-summary-title" className="text-lg font-black text-slate-900 dark:text-white">
            Resumen rápido
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="guided-summary-card ui-surface p-5">
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">Obras configuradas</p>
            <p className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{worksCount}</p>
            <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">Obras disponibles para trabajar.</p>
          </div>
          <div className="guided-summary-card ui-surface p-5">
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">Trabajadores</p>
            <p className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{workersCount}</p>
            <button
              type="button"
              onClick={() => onNavigate('directorio')}
              className="mt-3 inline-flex items-center gap-2 text-sm font-black text-brand-primary hover:underline dark:text-blue-300"
            >
              Ver trabajadores <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            onClick={onOpenAlerts}
            className="guided-summary-card ui-surface p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/30"
          >
            <p className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
              <Bell className="h-5 w-5 text-amber-500" aria-hidden="true" />
              Avisos pendientes
            </p>
            <p className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{alertsCount}</p>
            <p className="mt-2 text-sm font-black text-brand-primary dark:text-blue-300">Revisar avisos</p>
          </button>
        </div>
      </section>
    </div>
  );
};
