import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { APP_TOAST_EVENT, type AppToastDetail } from '../src/lib/appToast';
import { playMessageSound } from '../src/lib/uiSounds';

export function AppToastHost() {
  const [toast, setToast] = useState<AppToastDetail | null>(null);

  useEffect(() => {
    const handler = (event: Event) => setToast((event as CustomEvent<AppToastDetail>).detail);
    window.addEventListener(APP_TOAST_EVENT, handler as EventListener);
    return () => window.removeEventListener(APP_TOAST_EVENT, handler as EventListener);
  }, []);

  useEffect(() => {
    if (!toast) return;
    playMessageSound(toast.type === 'success' ? 'success' : 'error');
    const id = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(id);
  }, [toast]);

  if (!toast) return null;

  const success = toast.type === 'success';

  return (
    <div
      className={`profea-toast ${success ? 'profea-toast--success' : 'profea-toast--error'}`}
      role={success ? 'status' : 'alert'}
      aria-live={success ? 'polite' : 'assertive'}
    >
      <div className="profea-toast__shine" aria-hidden="true" />
      <div className="profea-toast__icon" aria-hidden="true">
        {success ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
      </div>
      <div className="profea-toast__content">
        <span className="profea-toast__eyebrow">{success ? 'PROFEA' : 'Atención'}</span>
        <span className="profea-toast__message">{toast.message}</span>
      </div>
      <button
        type="button"
        onClick={() => setToast(null)}
        className="profea-toast__close"
        aria-label="Cerrar aviso"
      >
        <X size={16} />
      </button>
    </div>
  );
}
