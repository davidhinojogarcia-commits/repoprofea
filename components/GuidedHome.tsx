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
    description: 'Alta guiada de un nuevo trabajador.',
    view: 'registro',
    icon: UserPlus,
  },
  {
    title: 'Ver trabajadores',
    description: 'Consulta fichas, documentación e historial.',
    view: 'directorio',
    icon: Users,
  },
  {
    title: 'Documentación de obra',
    description: 'Completa, firma y revisa documentos.',
    view: 'documentacion_obra',
    icon: FileCheck2,
  },
  {
    title: 'Revisar CAE',
    description: 'Comprueba la coordinación y los requisitos.',
    view: 'subcontratas',
    icon: HardHat,
  },
  {
    title: 'Reconocimientos médicos',
    description: 'Revisa citas, aptitudes y vigencias.',
    view: 'citas',
    icon: CalendarCheck2,
  },
  {
    title: 'Maquinaria y herramientas',
    description: 'Consulta disponibilidad, asignaciones y averías.',
    view: 'inventario',
    icon: Wrench,
  },
  {
    title: 'Selección SAE',
    description: 'Accede al proceso de selección y contratación.',
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
    <div className="space-y-6">
      <section className="ui-surface overflow-hidden">
        <div className="p-5 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-brand-primary dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
                <Compass className="h-4 w-4" />
                Vista guiada activa
              </div>
              <h1 className="mt-4 text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                ¿Qué necesitas hacer?
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300 sm:text-base">
                Elige una tarea y la aplicación te llevará directamente al lugar correcto. Las opciones avanzadas siguen disponibles en Vista completa.
              </p>
            </div>
            <button
              type="button"
              onClick={onShowCompleteView}
              className="ui-button-secondary flex min-h-12 items-center justify-center gap-2 px-4"
            >
              <Settings2 className="h-5 w-5" />
              Vista completa
            </button>
          </div>
        </div>
      </section>

      <section aria-label="Resumen rápido" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="ui-surface p-4 sm:p-5">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Obras configuradas</p>
          <p className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{worksCount}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Disponibles para trabajar en la aplicación.</p>
        </div>
        <div className="ui-surface p-4 sm:p-5">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Trabajadores</p>
          <p className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{workersCount}</p>
          <button
            type="button"
            onClick={() => onNavigate('directorio')}
            className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-brand-primary hover:underline dark:text-blue-300"
          >
            Ver directorio <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={onOpenAlerts}
          className="ui-surface p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md sm:p-5"
        >
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            <Bell className="h-4 w-4 text-amber-500" />
            Avisos pendientes
          </p>
          <p className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{alertsCount}</p>
          <p className="mt-1 text-xs font-bold text-brand-primary dark:text-blue-300">Revisar avisos</p>
        </button>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-black text-slate-900 dark:text-white">Accesos de trabajo diario</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Botones grandes y directos para las tareas más habituales.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                type="button"
                key={action.view}
                onClick={() => onNavigate(action.view)}
                className="ui-surface group flex min-h-[116px] items-center gap-4 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md sm:p-5"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-brand-primary dark:bg-blue-950/40 dark:text-blue-300">
                  <Icon className="h-6 w-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-black text-slate-900 dark:text-white">{action.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{action.description}</span>
                </span>
                <ArrowRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-brand-primary dark:text-slate-600 dark:group-hover:text-blue-300" />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};
