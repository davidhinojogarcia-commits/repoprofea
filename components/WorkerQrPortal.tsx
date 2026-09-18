import React, { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, FileText, Loader2, Share2, ShieldCheck, X } from 'lucide-react';
import type { Person } from '../types';
import { generateWorkerIDCardPDF } from '../src/lib/exportUtils';
import { resolveWorkerQrShare } from '../src/services/workerQrShareService';

interface WorkerQrPortalProps {
  token: string;
}

const safeName = (value: unknown) => String(value || 'Trabajador').trim() || 'Trabajador';

export const WorkerQrPortal: React.FC<WorkerQrPortalProps> = ({ token }) => {
  const normalizedToken = useMemo(() => String(token || '').trim(), [token]);
  const [history, setHistory] = useState<Person[]>([]);
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [filename, setFilename] = useState('FICHA_PROFEA.pdf');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let objectUrl = '';

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const records = await resolveWorkerQrShare(normalizedToken);
        if (!active) return;
        if (!records.length) {
          setError('Este código QR no es válido, ha sido revocado o la ficha ya no está disponible.');
          return;
        }

        setHistory(records);
        const worker = records[0];
        const { doc, filename: generatedFilename } = await generateWorkerIDCardPDF(worker, records, { includeQr: false });
        if (!active) return;

        const blob = doc.output('blob');
        objectUrl = URL.createObjectURL(blob);
        setPdfBlob(blob);
        setPdfUrl(objectUrl);
        setFilename(generatedFilename);
        document.title = `Ficha PROFEA · ${safeName(worker.apellidosNombre)}`;
      } catch (e: any) {
        if (!active) return;
        setError(e?.message || 'No se ha podido preparar la ficha del trabajador.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [normalizedToken]);

  const worker = history[0];

  const downloadPdf = () => {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const sharePdf = async () => {
    if (!pdfBlob || !worker) return;
    const file = new File([pdfBlob], filename, { type: 'application/pdf' });
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({
          files: [file],
          title: `Ficha PROFEA · ${safeName(worker.apellidosNombre)}`,
          text: 'Ficha del trabajador PROFEA',
        });
        return;
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      console.warn('No se pudo compartir el PDF desde el navegador:', error);
    }
    downloadPdf();
  };

  const closeViewer = () => {
    if (window.history.length > 1) window.history.back();
    else window.close();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-8 flex items-center justify-center">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl">
          <Loader2 className="mx-auto h-9 w-9 animate-spin text-[#00548E]" />
          <h1 className="mt-4 text-lg font-black text-slate-900">Preparando ficha PDF</h1>
          <p className="mt-2 text-sm text-slate-500">Abriendo el expediente asociado al código QR…</p>
        </div>
      </div>
    );
  }

  if (!worker || error) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-8 flex items-center justify-center">
        <div className="w-full max-w-md rounded-3xl border border-amber-200 bg-white p-8 text-center shadow-xl">
          <ShieldCheck className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-4 text-xl font-black text-slate-900">Ficha no disponible</h1>
          <p className="mt-3 text-sm text-slate-600">{error || 'No se ha encontrado la ficha.'}</p>
          <button type="button" onClick={closeViewer} className="mt-6 inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700">
            <X className="h-4 w-4" /> Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-3 py-3 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[#00548E]">Ficha QR PROFEA · solo lectura</div>
            <div className="truncate text-sm font-black text-slate-900">{safeName(worker.apellidosNombre)}</div>
          </div>
          <button type="button" onClick={sharePdf} className="inline-flex items-center gap-2 rounded-xl bg-[#00548E] px-3 py-2.5 text-xs font-black text-white shadow-sm">
            <Share2 className="h-4 w-4" /> Compartir
          </button>
          <button type="button" onClick={closeViewer} className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-3 py-4 sm:px-5 sm:py-6">
        <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-900">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Este QR abre únicamente esta ficha. No inicia sesión ni permite navegar por la aplicación.</span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <button type="button" onClick={sharePdf} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] px-4 py-3 text-sm font-black text-white shadow-sm">
            <Share2 className="h-4 w-4" /> Compartir PDF
          </button>
          <button type="button" onClick={downloadPdf} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm">
            <Download className="h-4 w-4" /> Guardar PDF
          </button>
          <a href={pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm">
            <ExternalLink className="h-4 w-4" /> Abrir PDF
          </a>
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-sm font-black text-slate-800">
            <FileText className="h-4 w-4 text-[#00548E]" />
            Expediente PDF · {history.length} registro{history.length === 1 ? '' : 's'} histórico{history.length === 1 ? '' : 's'}
          </div>
          <iframe
            title={`Ficha PROFEA de ${safeName(worker.apellidosNombre)}`}
            src={pdfUrl}
            className="h-[calc(100vh-230px)] min-h-[540px] w-full bg-slate-100"
          />
        </section>
      </main>
    </div>
  );
};
