import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Info, XCircle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { APP_DIALOG_EVENT, type AppDialogRequest } from '../src/lib/appDialog';
import { playMessageSound } from '../src/lib/uiSounds';

const iconFor = (kind: AppDialogRequest['kind']) => {
  if (kind === 'success') return <CheckCircle2 className="h-6 w-6" />;
  if (kind === 'error') return <XCircle className="h-6 w-6" />;
  if (kind === 'warning') return <AlertTriangle className="h-6 w-6" />;
  if (kind === 'confirm' || kind === 'prompt') return <HelpCircle className="h-6 w-6" />;
  return <Info className="h-6 w-6" />;
};

export function AppDialogHost() {
  const [queue, setQueue] = useState<AppDialogRequest[]>([]);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const current = queue[0] || null;

  useEffect(() => {
    const handler = (event: Event) => {
      const request = (event as CustomEvent<AppDialogRequest>).detail;
      if (!request) return;
      if (!dialogRef.current) previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQueue((items) => [...items, request]);
    };
    window.addEventListener(APP_DIALOG_EVENT, handler as EventListener);
    return () => window.removeEventListener(APP_DIALOG_EVENT, handler as EventListener);
  }, []);

  useEffect(() => {
    if (!current) return;
    setInputValue(current.defaultValue || '');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('profea-dialog-open');
    playMessageSound(current.kind === 'error' || current.kind === 'warning' ? 'error' : 'success');
    const id = window.setTimeout(() => {
      const target = current.kind === 'prompt' ? inputRef.current : dialogRef.current?.querySelector<HTMLButtonElement>('button');
      target?.focus();
    }, 30);
    return () => {
      window.clearTimeout(id);
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove('profea-dialog-open');
      previousFocusRef.current?.focus();
    };
  }, [current?.id]);

  const palette = useMemo(() => {
    switch (current?.kind) {
      case 'success': return { ring: 'border-emerald-300 dark:border-emerald-800', icon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300', button: 'bg-emerald-600 hover:bg-emerald-700' };
      case 'error': return { ring: 'border-rose-300 dark:border-rose-800', icon: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300', button: 'bg-rose-600 hover:bg-rose-700' };
      case 'warning': return { ring: 'border-amber-300 dark:border-amber-800', icon: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300', button: 'bg-amber-600 hover:bg-amber-700' };
      default: return { ring: 'border-blue-200 dark:border-slate-700', icon: 'bg-blue-100 text-[#00548E] dark:bg-blue-950 dark:text-blue-300', button: 'bg-[#00548E] hover:bg-[#003f6b]' };
    }
  }, [current?.kind]);

  if (!current || typeof document === 'undefined') return null;

  const finish = (value: boolean | string | null) => {
    current.resolve(value);
    setQueue((items) => items.slice(1));
  };

  const isPrompt = current.kind === 'prompt';
  const isConfirm = current.kind === 'confirm' || isPrompt;

  const onConfirm = () => {
    if (isPrompt) finish(inputValue);
    else finish(true);
  };

  const onCancel = () => finish(isPrompt ? null : false);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (isConfirm) onCancel();
      else finish(true);
      return;
    }
    if (event.key === 'Tab') {
      const selector = 'button:not([disabled]),[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
      const nodes = Array.from((dialogRef.current?.querySelectorAll(selector) ?? []) as NodeListOf<HTMLElement>);
      if (!nodes.length) {
        event.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      if (event.target instanceof HTMLButtonElement || (isPrompt && event.target instanceof HTMLTextAreaElement)) return;
      event.preventDefault();
      onConfirm();
    }
  };

  const title =
    current.title ||
    (current.kind === 'error' ? 'Se ha producido un error' :
      current.kind === 'warning' ? 'Atención' :
      current.kind === 'success' ? 'Operación completada' :
      current.kind === 'confirm' ? 'Confirmar acción' :
      current.kind === 'prompt' ? 'Introduce la información' :
      'Información');

  return createPortal(
    <div
      className="profea-app-dialog-overlay fixed inset-0 z-[2147483600] isolate flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-md sm:p-6"
      role="presentation"
      style={{position:'fixed',inset:0,zIndex:2147483600,isolation:'isolate'}}
      onKeyDown={onKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        data-kind={current.kind}
        aria-labelledby="profea-dialog-title"
        className={`profea-app-dialog-panel w-full max-w-md overflow-hidden rounded-3xl border bg-white shadow-2xl dark:bg-slate-900 ${palette.ring}`}
      >
        <div className="border-b border-slate-200 bg-gradient-to-r from-slate-950 via-[#00548E] to-[#003f6b] px-5 py-4 text-white dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/95 text-slate-900 shadow-sm">
              <span className={palette.icon + ' grid h-9 w-9 place-items-center rounded-xl'}>
                {iconFor(current.kind)}
              </span>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-100">GestionProfea</div>
              <h2 id="profea-dialog-title" className="mt-0.5 text-base font-black leading-tight text-white sm:text-lg">{title}</h2>
            </div>
          </div>
        </div>

        <div className="px-5 py-5 sm:px-6">
          <p className="whitespace-pre-wrap text-sm font-medium leading-6 text-slate-700 dark:text-slate-200">
            {current.message}
          </p>

          {isPrompt && (
            <textarea
              ref={(node) => { inputRef.current = node; }}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder={current.placeholder}
              rows={4}
              className="mt-4 w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-[#00548E] focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950"
            />
          )}

          <div className={`mt-6 grid gap-2 ${isConfirm ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {isConfirm && (
              <button
                type="button"
                onClick={onCancel}
                className="min-h-[50px] rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                {current.cancelLabel || 'Cancelar'}
              </button>
            )}
            <button
              type="button"
              autoFocus={!isPrompt}
              onClick={onConfirm}
              className={`min-h-[50px] rounded-2xl px-4 py-3 text-sm font-black text-white shadow-sm transition ${palette.button}`}
            >
              {current.confirmLabel || (isConfirm ? 'Confirmar' : 'Aceptar')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
