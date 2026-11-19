import React, { useEffect, useState } from 'react';
import { Download, Loader2, LockKeyhole, ShieldCheck, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { OFFICIAL_LOGO_BASE64 } from '../src/assets/logoData';
import { readWorkerQrDetails, resolveWorkerQrShare, type WorkerQrDetails } from '../src/services/workerQrShareService';
import { supabase } from '../src/lib/supabase';
import { workerTokenFromQr } from '../src/lib/workerQrScan';

interface WorkerQrPortalProps { token: string; }

// This PDF is built only from the public verification result. It never combines
// privileged data with a document that can be downloaded or shared anonymously.
function makeVerificationPdf(checkedAt: Date): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const image = doc.getImageProperties(OFFICIAL_LOGO_BASE64);
  const width = Math.min(49, 10.5 * image.width / image.height);
  doc.addImage(OFFICIAL_LOGO_BASE64, 'PNG', 195 - width, 5, width, 10.5);
  doc.setTextColor(0, 84, 142);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('GESTIONPROFEA · VERIFICACIÓN DE CARNET', 15, 28);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Estado en el momento de la consulta: carnet activo', 15, 43);
  doc.text(`Fecha de consulta: ${checkedAt.toLocaleString('es-ES')}`, 15, 51);
  doc.text(doc.splitTextToSize('Esta consulta comprueba el estado del enlace en GestionProfea. No acredita la identidad de la persona portadora ni una contratación vigente.', 180), 15, 63);
  return doc.output('blob');
}

const fields: { key: keyof WorkerQrDetails; label: string }[] = [
  { key: 'maskedDni', label: 'DNI/NIE' },
  { key: 'worksite', label: 'Obra asignada' },
  { key: 'periodStart', label: 'Inicio del contrato' },
  { key: 'periodEnd', label: 'Fin del contrato' },
  { key: 'contractStatus', label: 'Estado contractual según periodo' },
  { key: 'trainingRecord', label: 'Formación PRL de 20 horas' },
  { key: 'aptitudeConclusion', label: 'Conclusión de aptitud médica' },
];

function fieldValue(key: keyof WorkerQrDetails, value: string) {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return (key === 'periodStart' || key === 'periodEnd') && date ? `${date[3]}/${date[2]}/${date[1]}` : value;
}

export const WorkerQrPortal: React.FC<WorkerQrPortalProps> = ({ token }) => {
  const normalizedToken = workerTokenFromQr(`${location.origin}/?worker-qr=${encodeURIComponent(token)}`, location.origin);
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'error'>('loading');
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [accountId, setAccountId] = useState<string | null | undefined>(undefined);
  const [scopedDetails, setScopedDetails] = useState<{ accountId: string; token: string; data: WorkerQrDetails } | null>(null);
  const details = scopedDetails?.accountId === accountId && scopedDetails?.token === normalizedToken ? scopedDetails.data : null;
  const [checkingDetails, setCheckingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [loginMessage, setLoginMessage] = useState('');

  useEffect(() => {
    let active = true;
    setStatus('loading');
    setCheckedAt(null);
    if (!normalizedToken) { setStatus('invalid'); return; }
    void resolveWorkerQrShare(normalizedToken).then(valid => {
      if (!active) return;
      if (valid) setCheckedAt(new Date());
      setStatus(valid ? 'valid' : 'invalid');
    }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [normalizedToken]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccountId(session?.user.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setScopedDetails(null);
    setDetailsError('');
    setCheckingDetails(false);
    if (status !== 'valid' || !normalizedToken || !accountId) return;
    let active = true;
    let expiry: number | undefined;
    let request = 0;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      const version = ++request;
      window.clearTimeout(expiry);
      setScopedDetails(null);
      setDetailsError('');
      setCheckingDetails(true);
      void readWorkerQrDetails(normalizedToken).then(result => {
        if (!active || version !== request) return;
        if (result?.expiresAt) {
          const remaining = Date.parse(result.expiresAt) - Date.now();
          if (!(remaining > 0)) return;
          expiry = window.setTimeout(() => setScopedDetails(null), remaining);
        }
        setScopedDetails(result ? { accountId, token: normalizedToken, data: result } : null);
      }).catch(() => {
        if (active && version === request) setDetailsError('No se pudo comprobar la autorización. Vuelve a abrir el carnet para reintentar.');
      }).finally(() => { if (active && version === request) setCheckingDetails(false); });
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      active = false;
      window.clearTimeout(expiry);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [accountId, normalizedToken, status]);

  const requestLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending || !normalizedToken) return;
    setSending(true);
    setLoginMessage('');
    try {
      const redirect = new URL(location.pathname, location.origin);
      redirect.searchParams.set('worker-qr', normalizedToken);
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirect.toString(), shouldCreateUser: false },
      });
      setLoginMessage(error
        ? 'No se pudo enviar el enlace. Revisa el correo o vuelve a intentarlo.'
        : 'Abre el enlace de verificación que recibirás en el correo que has indicado.');
    } catch {
      setLoginMessage('No se pudo enviar el enlace. Comprueba la conexión y vuelve a intentarlo.');
    } finally {
      setSending(false);
    }
  };

  const download = () => {
    if (!checkedAt) return;
    const objectUrl = URL.createObjectURL(makeVerificationPdf(checkedAt));
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'VERIFICACION_PROFEA.pdf';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
  };
  const closeViewer = () => { if (window.history.length > 1) window.history.back(); else window.close(); };

  return <main className="min-h-screen bg-slate-100 px-3 py-5 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-6 sm:py-10">
    <section className="mx-auto w-full max-w-xl space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900 sm:p-6">
      <header className="flex items-start gap-3">
        <div className="rounded-xl bg-blue-50 p-3 text-[#00548E] dark:bg-slate-800 dark:text-blue-300">
          {status === 'loading' ? <Loader2 className="h-6 w-6 animate-spin" /> : <ShieldCheck className="h-6 w-6" />}
        </div>
        <div>
          <h1 className="text-xl font-black">Verificación de carnet PROFEA</h1>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Diputación Provincial de Cádiz</p>
        </div>
      </header>
      {status === 'loading' && <p role="status">Consultando el estado del carnet…</p>}
      {status === 'invalid' && <p role="alert">El código no es válido, ha sido revocado o ya no está disponible.</p>}
      {status === 'error' && <p role="alert">No se ha podido consultar el carnet. Comprueba la conexión y vuelve a intentarlo.</p>}
      {status === 'valid' && <>
        <p className="font-bold text-emerald-700 dark:text-emerald-300">Carnet activo en el momento de la consulta</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">Consulta realizada {checkedAt?.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</p>
        {accountId === null && <form onSubmit={requestLogin} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
          <p className="text-sm">Identifícate con el correo autorizado para consultar los datos laborales y preventivos. Si es tu primer acceso profesional, abre primero el enlace que te ha facilitado el supervisor.</p>
          <label className="block text-sm font-bold">Correo autorizado
            <input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base dark:border-slate-600 dark:bg-slate-900" />
          </label>
          <button type="submit" disabled={sending} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#00548E] px-4 py-2 font-bold text-white disabled:opacity-50"><LockKeyhole className="h-4 w-4" />{sending ? 'Enviando…' : 'Verificar correo'}</button>
          {loginMessage && <p role="status" className="text-sm">{loginMessage}</p>}
        </form>}
        {checkingDetails && <p role="status">Comprobando autorización…</p>}
        {detailsError && <p role="alert" className="text-sm">{detailsError}</p>}
        {accountId && !details && !checkingDetails && !detailsError && <p className="text-sm">Esta cuenta no dispone de una autorización vigente para consultar los datos del carnet.</p>}
        {accountId && details && <section aria-label="Datos autorizados del carnet" className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <dl className="divide-y divide-slate-200 dark:divide-slate-700">
            {fields.map(({ key, label }) => details[key] && <div key={key} className="grid gap-1 py-2 text-sm sm:grid-cols-2">
              <dt className="font-bold text-slate-600 dark:text-slate-300">{label}</dt>
              <dd className="break-words">{fieldValue(key, details[key])}</dd>
            </div>)}
          </dl>
          {details.expiresAt && <p className="mt-2 text-xs">Acceso temporal hasta {new Date(details.expiresAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</p>}
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">Datos informativos procedentes del registro de GestionProfea. El periodo indicado no acredita el alta en la Seguridad Social.</p>
        </section>}
        {accountId && <button type="button" onClick={() => { setScopedDetails(null); void supabase.auth.signOut({ scope: 'local' }); }} className="min-h-11 rounded-xl border px-4 py-2 text-sm font-bold">Cambiar cuenta</button>}
      </>}
      <footer className="flex flex-wrap gap-2">
        {status === 'valid' && <button type="button" onClick={download} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold"><Download className="h-4 w-4" /> PDF de verificación</button>}
        <button type="button" onClick={closeViewer} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold"><X className="h-4 w-4" /> Cerrar</button>
      </footer>
    </section>
  </main>;
};
