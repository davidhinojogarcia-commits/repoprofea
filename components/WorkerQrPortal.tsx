import React, { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, FileText, Loader2, Share2, ShieldCheck, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import type { Person } from '../types';
import { resolveWorkerQrShare, resolveWorkerQrOccupational } from '../src/services/workerQrShareService';
import { getAptitudMedicaInfo } from '../types';

interface WorkerQrPortalProps { token: string; }
const safeName = (value: unknown) => String(value || 'Trabajador').trim() || 'Trabajador';
const safeText = (value: unknown) => String(value || '—').trim() || '—';
const dateText = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value).split('-').reverse().join('/') : '—';

// Inspection-facing view only: the public RPC intentionally omits the full DNI,
// contact details, payroll identifiers and occupational medical information.
function makePublicInspectionPdf(history: Person[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const worker = history[0];
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('FICHA DE CONSULTA PROFEA', 15, 20);
  doc.setFontSize(10);
  doc.text(safeName(worker.apellidosNombre), 15, 30);
  doc.setFont('helvetica', 'normal');
  doc.text('DNI/NIE (parcial): ' + safeText(worker.dni), 15, 37);
  doc.text('Consulta mediante codigo QR. No acredita contratacion vigente.', 15, 44);
  let y = 57;
  history.forEach((item, index) => {
    if (y > 258) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold');
    doc.text('Registro ' + (index + 1), 15, y);
    doc.setFont('helvetica', 'normal');
    const entries = [
      'Obra: ' + safeText(item.obra),
      'Categoria: ' + safeText(item.categoria),
      'Formacion PRL 20h: ' + safeText(item.formacion),
      ...(item.aptitudMedica || item.reconocimientoEstado ? [
        'Aptitud laboral: ' + getAptitudMedicaInfo(item).estado,
        ...(getAptitudMedicaInfo(item).estado === 'Apto con limitaciones' ? [
          'Limitaciones laborales: ' + safeText(getAptitudMedicaInfo(item).limitaciones)
        ] : [])
      ] : ['Aptitud laboral: acceso restringido al supervisor autorizado']),
      'Periodo: ' + dateText(item.periodoInicio) + ' a ' + dateText(item.periodoFin)
    ];
    for (const entry of entries) {
      const lines = doc.splitTextToSize(entry, 174);
      doc.text(lines, 15, y + 6);
      y += 5 * lines.length + 2;
    }
    y += 10;
  });
  return doc.output('blob');
}

export const WorkerQrPortal: React.FC<WorkerQrPortalProps> = ({ token }) => {
  const normalizedToken = useMemo(() => String(token || '').trim(), [token]);
  const [history, setHistory] = useState<Person[]>([]);
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const filename = 'CONSULTA_PROFEA.pdf';

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setLoading(true);
    setError('');
    setHistory([]);
    setPdfUrl('');
    setPdfBlob(null);
    (async () => {
      try {
        const records = await resolveWorkerQrShare(normalizedToken);
        if (!active) return;
        if (!records.length) {
          setError('Este código QR no es válido, ha sido revocado o la ficha ya no está disponible.');
          return;
        }
        let displayRecords = records;
        try {
          const occupational = await resolveWorkerQrOccupational(normalizedToken);
          if (!active) return;
          if (occupational.length) {
            const byId = new Map(occupational.map(item => [item.id, item]));
            displayRecords = records.map(item => ({ ...item, ...(byId.get(item.id) || {}) }));
          }
        } catch {
          // Anonymous and unauthorized visitors see only the limited public ficha.
        }
        const blob = makePublicInspectionPdf(displayRecords);
        objectUrl = URL.createObjectURL(blob);
        setHistory(displayRecords);
        setPdfBlob(blob);
        setPdfUrl(objectUrl);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'No se ha podido consultar la ficha.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [normalizedToken]);

  const worker = history[0];
  const downloadPdf = () => {
    if (!pdfUrl) return;
    const anchor = document.createElement('a');
    anchor.href = pdfUrl; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
  };
  const sharePdf = async () => {
    if (!pdfBlob) return;
    const file = new File([pdfBlob], filename, { type: 'application/pdf' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Consulta PROFEA' });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    }
    downloadPdf();
  };
  const closeViewer = () => { if (window.history.length > 1) window.history.back(); else window.close(); };

  if (loading || error || !worker) return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 flex items-center justify-center">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl">
        {loading ? <Loader2 className="mx-auto h-9 w-9 animate-spin text-[#00548E]" /> : <ShieldCheck className="mx-auto h-9 w-9 text-amber-500" />}
        <h1 className="mt-4 text-lg font-black text-slate-900">{loading ? 'Preparando consulta del trabajador' : 'Ficha no disponible'}</h1>
        {error && <p role="alert" className="mt-3 text-sm text-slate-600">{error}</p>}
        {!loading && <button type="button" onClick={closeViewer} className="mt-5 rounded-xl border px-4 py-2.5">Cerrar</button>}
      </div>
    </div>
  );
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-3 py-3 shadow-sm">
        <div className="mx-auto max-w-6xl flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-black uppercase tracking-wide text-[#00548E]">Ficha QR PROFEA · consulta limitada</div>
            <div className="truncate text-sm font-black">{safeName(worker.apellidosNombre)}</div>
          </div>
          <button type="button" onClick={sharePdf} className="inline-flex items-center gap-2 rounded-xl bg-[#00548E] px-3 py-2.5 text-xs font-black text-white"><Share2 className="h-4 w-4"/> Compartir</button>
          <button type="button" onClick={closeViewer} className="rounded-xl border p-2.5" aria-label="Cerrar"><X className="h-4 w-4"/></button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-3 py-4 sm:px-5">
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs text-blue-900 flex gap-2">
          <ShieldCheck className="h-5 w-5 shrink-0"/>
          <span>Este QR permite consultar únicamente los datos de identificación y contratación autorizados. No acredita una contratación vigente. La formación PRL es visible; la aptitud laboral y las limitaciones solo se muestran al supervisor autenticado y autorizado. No se muestran datos bancarios ni diagnósticos.</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <button type="button" onClick={sharePdf} className="rounded-xl bg-[#00548E] text-white px-4 py-3 font-bold flex justify-center gap-2"><Share2 className="h-4 w-4"/> Compartir PDF</button>
          <button type="button" onClick={downloadPdf} className="rounded-xl border bg-white px-4 py-3 font-bold flex justify-center gap-2"><Download className="h-4 w-4"/> Guardar PDF</button>
          <a href={pdfUrl} target="_blank" rel="noreferrer" className="rounded-xl border bg-white px-4 py-3 font-bold flex justify-center gap-2"><ExternalLink className="h-4 w-4"/> Abrir PDF</a>
        </div>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-black"><FileText className="h-4 w-4 text-[#00548E]"/> Ficha de consulta · {history.length} registros</div>
          <iframe title={'Ficha PROFEA de ' + safeName(worker.apellidosNombre)} src={pdfUrl} className="h-[calc(100vh-230px)] min-h-[540px] w-full bg-slate-100"/>
        </section>
      </main>
    </div>
  );
};
