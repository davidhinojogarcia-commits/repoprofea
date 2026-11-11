import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type InstitutionalOption = { value: string; label: string };

type Props = {
  label: string;
  value: string;
  options: InstitutionalOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

/** Single-select owned by the app: never invokes the iOS/Android native picker. */
export const InstitutionalSelect: React.FC<Props> = ({ label, value, options, onChange, disabled = false, className = '' }) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const selected = options.find(option => option.value === value);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div ref={root} className={`relative min-w-0 w-full ${className}`}>
    <button type="button" disabled={disabled} aria-label={label} aria-expanded={open} aria-controls={uid}
      onClick={() => setOpen(previous => !previous)}
      className="flex min-h-12 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3 text-left text-base font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00548E] disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
      <span className="min-w-0 truncate">{selected?.label ?? 'Seleccionar…'}</span>
      <ChevronDown aria-hidden="true" className={`h-5 w-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id={uid} role="group" aria-label={label}
      className="absolute inset-x-0 top-full z-[90] mt-1 max-h-60 overflow-y-auto overscroll-contain rounded-xl border border-slate-300 bg-white p-1 shadow-xl dark:border-slate-600 dark:bg-slate-900">
      {options.map((option, index) => <button key={option.value} ref={index === 0 ? first : undefined} type="button"
        aria-pressed={value === option.value}
        onClick={() => { onChange(option.value); setOpen(false); }}
        className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00548E] ${value === option.value ? 'bg-blue-50 font-bold text-[#00548E] dark:bg-blue-950 dark:text-blue-200' : 'text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800'}`}>
        <span>{option.label}</span>{value === option.value && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
      </button>)}
    </div>}
  </div>;
};
