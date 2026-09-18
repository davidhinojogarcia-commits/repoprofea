import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronDown, Stethoscope, X } from 'lucide-react';

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

export const DirectoryStatusFilter: React.FC<Props> = ({ value, onChange, counts }) => {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mount: HTMLSpanElement | null = null;
    let observer: MutationObserver | null = null;

    const install = () => {
      const section = document.getElementById('directorio-section');
      if (!section) return false;

      const buttons = Array.from(section.querySelectorAll('button'));
      const repeaters = buttons.find(button => button.textContent?.trim().includes('Repetidores'));
      if (!repeaters?.parentElement) return false;

      const oldNoAptos = section.querySelector('button[title="Filtrar trabajadores con reconocimiento No Apto"]') as HTMLButtonElement | null;
      if (oldNoAptos) oldNoAptos.style.display = 'none';

      const existing = repeaters.parentElement.querySelector('[data-directory-medical-filter="true"]') as HTMLSpanElement | null;
      mount = existing || document.createElement('span');
      if (!existing) {
        mount.dataset.directoryMedicalFilter = 'true';
        mount.className = 'relative flex items-stretch shrink-0';
        repeaters.insertAdjacentElement('afterend', mount);
      }
      setHost(mount);
      return true;
    };

    if (!install()) {
      observer = new MutationObserver(() => {
        if (install()) observer?.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      observer?.disconnect();
      if (mount?.parentElement) mount.parentElement.removeChild(mount);
      const oldNoAptos = document.querySelector('#directorio-section button[title="Filtrar trabajadores con reconocimiento No Apto"]') as HTMLButtonElement | null;
      if (oldNoAptos) oldNoAptos.style.display = '';
    };
  }, []);

  useEffect(() => {
    const oldNoAptos = document.querySelector('#directorio-section button[title="Filtrar trabajadores con reconocimiento No Apto"]') as HTMLButtonElement | null;
    if (oldNoAptos) oldNoAptos.style.display = 'none';
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const activeLabel = useMemo(() => {
    if (value.length === 0) return 'Aptitud médica';
    if (value.length === 1) {
      const option = OPTIONS.find(item => item.value === value[0]);
      return `${option?.label || 'Aptitud'} (${counts[value[0]] || 0})`;
    }
    return `Aptitud médica (${value.length})`;
  }, [value, counts]);

  const toggle = (status: DirectoryStatusValue) => {
    onChange(value.includes(status) ? value.filter(item => item !== status) : [...value, status]);
  };

  if (!host) return null;

  return createPortal(
    <div ref={panelRef} className="relative h-full shrink-0">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        className={`h-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer whitespace-nowrap ${
          value.length > 0
            ? 'bg-red-600 text-white border-red-700 shadow-sm ring-2 ring-red-500/20'
            : 'bg-red-50 hover:bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:hover:bg-red-900/50 dark:text-red-300 dark:border-red-800/80'
        }`}
        title="Filtrar por aptitud médica"
        aria-expanded={open}
      >
        {value.includes('no_apto') ? <AlertTriangle className="w-3.5 h-3.5" /> : <Stethoscope className="w-3.5 h-3.5" />}
        <span>{activeLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-[80] w-64 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-2 text-slate-800 dark:text-slate-100">
          <div className="flex items-center justify-between px-2 py-2 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="text-xs font-black uppercase tracking-wide">Aptitud médica</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Puede seleccionar varias opciones</div>
            </div>
            {value.length > 0 && (
              <button type="button" onClick={() => onChange([])} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" title="Quitar filtros de aptitud">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="py-1">
            {OPTIONS.map(option => {
              const checked = value.includes(option.value);
              return (
                <label key={option.value} className="flex items-center gap-3 px-2.5 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(option.value)}
                    className="h-4 w-4 rounded border-slate-300 text-[#00548E] focus:ring-[#00548E]"
                  />
                  <span className="flex-1 text-xs font-bold">{option.label}</span>
                  <span className="text-[11px] font-black text-slate-500">{counts[option.value] || 0}</span>
                </label>
              );
            })}
          </div>

          <div className="px-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-500">
            Sin opciones marcadas se muestran todas las aptitudes.
          </div>
        </div>
      )}
    </div>,
    host,
  );
};
