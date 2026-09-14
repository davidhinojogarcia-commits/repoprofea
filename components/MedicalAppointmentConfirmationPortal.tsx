import React, { useMemo, useState } from 'react';
import { CheckCircle2, HeartPulse, Loader2, XCircle } from 'lucide-react';

type ResponseStatus = 'confirmada' | 'no_puede_asistir';

export const MedicalAppointmentConfirmationPortal: React.FC = () => {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const token = params.get('token') || '';
  const requested = params.get('respuesta') === 'no_puede_asistir' ? 'no_puede_asistir' : 'confirmada';
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const submit = async (status: ResponseStatus) => {
    if (!token) {
      setResult('error');
      setMessage('El enlace de confirmación no es válido.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/confirm-medical-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) throw new Error(data?.message || 'No se pudo registrar la respuesta.');
      setResult('success');
      setMessage(status === 'confirmada'
        ? 'Tu asistencia al reconocimiento médico ha quedado confirmada correctamente.'
        : 'Hemos registrado que no puedes asistir. La persona responsable podrá gestionar una nueva cita.');
    } catch (error: any) {
      setResult('error');
      setMessage(error?.message || 'No se pudo registrar la respuesta. El enlace puede haber caducado o la cita puede haber cambiado.');
    } finally {
      setBusy(false);
    }
  };

  const isConfirm = requested === 'confirmada';
  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center px-4 py-8">
    <div className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl p-6 sm:p-8 text-center">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-[#00548E] dark:text-blue-300">
        <HeartPulse className="w-7 h-7" />
      </div>
      <h1 className="mt-4 text-2xl font-black text-slate-900 dark:text-white">Reconocimiento médico PROFEA</h1>
      {result === 'idle' ? <>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          {isConfirm ? 'Confirma que asistirás a la cita indicada en el mensaje recibido.' : 'Indica que no puedes asistir a la cita indicada en el mensaje recibido.'}
        </p>
        <button type="button" disabled={busy} onClick={() => void submit(requested)} className={`mt-6 w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-bold text-white disabled:opacity-60 ${isConfirm ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}>
          {busy ? <Loader2 className="w-5 h-5 animate-spin"/> : isConfirm ? <CheckCircle2 className="w-5 h-5"/> : <XCircle className="w-5 h-5"/>}
          {isConfirm ? 'Confirmar asistencia' : 'No puedo asistir'}
        </button>
      </> : <div className="mt-6">
        {result === 'success' ? <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-600"/> : <XCircle className="w-12 h-12 mx-auto text-red-600"/>}
        <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{message}</p>
      </div>}
      <p className="mt-6 text-xs text-slate-400">Este enlace solo permite responder a la cita para la que fue generado.</p>
    </div>
  </div>;
};
