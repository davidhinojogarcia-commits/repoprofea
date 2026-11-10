import React from 'react';
import { ChevronDown, Stethoscope } from 'lucide-react';

export type DirectoryStatusValue = 'apto' | 'limitaciones' | 'no_apto' | 'pendiente';

type Props = {
  value: DirectoryStatusValue[];
  onChange: (value: DirectoryStatusValue[]) => void;
  counts: Record<DirectoryStatusValue, number>;
};

const OPTIONS: Array<{ value: DirectoryStatusValue; label: string }> = [
  { value: 'apto', label: 'Aptos' },
  { value: 'limitaciones', label: 'Aptos con limitaciones' },
  { value: 'no_apto', label: 'No aptos' },
  { value: 'pendiente', label: 'Pendientes' },
];

// This filter belongs to the regular directory grid. Avoid DOM observers,
// portals and imperative insertion after unrelated buttons.
export const DirectoryStatusFilter: React.FC<Props> = ({ value, onChange, counts }) => {
  const activeLabel = value.length === 0
    ? 'Todas las aptitudes'
    : value.length === 1
      ? OPTIONS.find(option => option.value === value[0])?.label || 'Una aptitud'
      : `${value.length} aptitudes seleccionadas`;

  const toggle = (status: DirectoryStatusValue) => {
    onChange(value.includes(status) ? value.filter(item => item !== status) : [...value, status]);
  };

  return (
    <div className="min-w-0">
      <span className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-200">Aptitud médica</span>
      <details className="group relative min-w-0">
        <summary aria-label="Aptitud médica" className="flex min-h-11 w-full min-w-0 cursor-pointer list-none items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00548E] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-2">
            <Stethoscope aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
            <span className="truncate">{activeLabel}</span>
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 rounded-xl border border-slate-300 bg-white p-2 shadow-xl dark:border-slate-600 dark:bg-slate-900">
          <p className="px-2 py-1 text-xs text-slate-500 dark:text-slate-400">Puedes seleccionar varias aptitudes.</p>
          {OPTIONS.map(option => (
            <label key={option.value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-slate-50 dark:hover:bg-slate-800">
              <input type="checkbox" checked={value.includes(option.value)} onChange={() => toggle(option.value)}
                className="h-4 w-4 rounded border-slate-300 accent-[#00548E]" />
              <span className="min-w-0 flex-1 text-sm text-slate-800 dark:text-slate-100">{option.label}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{counts[option.value] || 0}</span>
            </label>
          ))}
          <button type="button" onClick={() => onChange([])} disabled={value.length === 0}
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 text-sm font-semibold text-[#00548E] disabled:opacity-50 dark:border-slate-700 dark:text-blue-200">Todas las aptitudes</button>
        </div>
      </details>
    </div>
  );
};
