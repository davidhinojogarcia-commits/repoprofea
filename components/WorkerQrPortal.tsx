import React, { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, ShieldCheck, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { OFFICIAL_LOGO_BASE64 } from '../src/assets/logoData';
import { resolveWorkerQrShare } from '../src/services/workerQrShareService';

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

export const WorkerQrPortal: React.FC<WorkerQrPortalProps> = ({ token }) => {
  const normalizedToken = useMemo(() => String(token || '').trim(), [token]);
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'error'>('loading');
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [pdfUrl, setPdfUrl] = useState('');

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setStatus('loading');
    setPdfUrl('');
    setCheckedAt(null);
    void (async () => {
      try {
        const records = await resolveWorkerQrShare(normalizedToken);
        if (!active) return;
        if (!records.length) { setStatus('invalid'); return; }
        const date = new Date();
        objectUrl = URL.createObjectURL(makeVerificationPdf(date));
        setCheckedAt(date);
        setPdfUrl(objectUrl);
        setStatus('valid');
      } catch {
        if (active) setStatus('error');
      }
    })();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [normalizedToken]);

  const closeViewer = () => { if (window.history.length > 1) window.history.back(); else window.close(); };
  return <main className="min-h-screen bg-slate-100 px-4 py-8 flex items-center justify-center text-slate-900">
    <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
      {status === 'loading' ? <Loader2 className="h-9 w-9 animate-spin text-[#00548E]" /> : <ShieldCheck className="h-9 w-9 text-[#00548E]" />}
      <h1 className="mt-4 text-xl font-black">Verificación de carnet PROFEA</h1>
      {status === 'loading' && <p role="status" className="mt-3">Consultando el estado del carnet…</p>}
      {status === 'invalid' && <p role="alert" className="mt-3">El código no es válido, ha sido revocado o ya no está disponible.</p>}
      {status === 'error' && <p role="alert" className="mt-3">No se ha podido consultar el carnet. Comprueba la conexión y vuelve a intentarlo.</p>}
      {status === 'valid' && <>
        <p className="mt-3 font-bold text-emerald-700">Carnet activo en el momento de la consulta</p>
        <p className="mt-2 text-sm text-slate-600">Consulta realizada: {checkedAt?.toLocaleString('es-ES')}</p>
        <p className="mt-3 text-sm text-slate-600">Esta comprobación no acredita la identidad de la persona portadora ni una contratación vigente. Los datos laborales y preventivos requieren acceso autorizado.</p>
        <a href={pdfUrl} download="VERIFICACION_PROFEA.pdf" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#00548E] px-4 py-3 font-bold text-white"><Download className="h-4 w-4" /> Descargar PDF</a>
      </>}
      <button type="button" onClick={closeViewer} className="mt-5 flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2"><X className="h-4 w-4" /> Cerrar</button>
    </section>
  </main>;
};
