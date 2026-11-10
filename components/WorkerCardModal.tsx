import React, { Suspense, useEffect, useState } from 'react';
import { Download, Loader2, Share2, Printer, ShieldCheck, X } from 'lucide-react';
import ModalPortal from './ModalPortal';
import type { Person } from '../types';
import { downloadWorkerCard, generateWorkerCard, generateDniSizedPrintSheet, shareWorkerCard } from '../src/lib/workerCard';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import QRCode from 'qrcode';
import { ensureWorkerQrShare } from '../src/services/workerQrShareService';

const InspectionAccessManager = React.lazy(() => import('./InspectionAccessManager'));

export default function WorkerCardModal({ person, onClose }: { person: Person; onClose: () => void }) {
  const [card, setCard] = useState<{ url: string; image: File; pdf: Blob; pdfName: string; printPdf: Blob; printName: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sharing, setSharing] = useState(false);
  const [inspectionExpanded, setInspectionExpanded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let url = '';
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
    setCard(null);
    setError('');
    void (async () => {
      const token = await ensureWorkerQrShare(Number(person.id));
      if (cancelled) return;
      const qrUrl = `${window.location.origin}${window.location.pathname}?worker-qr=${encodeURIComponent(token)}`;
      const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
      if (cancelled) return;
      const { doc, filename } = generateWorkerCard(person, qrDataUrl);
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      task = pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')), useSystemFonts: true });
      const pdf = await task.promise;
      if (cancelled) return;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 4 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No se ha podido crear la imagen del carnet.');
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se ha podido preparar la imagen.')), 'image/png'));
      if (cancelled) return;
      const image = new File([blob], filename.replace(/\.pdf$/, '.png'), { type: 'image/png' });
      url = URL.createObjectURL(image);
      const { doc: printDoc, filename: printName } = generateDniSizedPrintSheet(canvas.toDataURL('image/png'));
      setCard({ url, image, pdf: doc.output('blob'), pdfName: filename, printPdf: printDoc.output('blob'), printName });
    })().catch(e => { if (!cancelled) setError(e.message || 'No se ha podido preparar el carnet.'); })
      .finally(() => { void task?.destroy().catch(() => undefined); });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      void task?.destroy().catch(() => undefined);
    };
  }, [person]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const share = async () => {
    if (!card || sharing) return;
    // Call navigator.share from the same click handler (user activation required).
    // Avoid showing a spinner that can look stuck while the native sheet is open.
    setSharing(true);
    setNotice('');
    try {
      const result = await shareWorkerCard(card.image);
      if (result === 'unsupported') {
        setNotice('Este navegador no permite compartir imágenes como archivo. Prueba en Edge o Chrome actualizado con la opción Compartir de Windows, o usa Descargar imagen.');
      }
    } catch {
      setNotice('No se ha podido abrir el menú para compartir la imagen. Prueba con otro navegador o utiliza Descargar imagen.');
    } finally {
      setSharing(false);
    }
  };
  return <ModalPortal label="Carnet del trabajador">
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-2 sm:p-3">
      <section role="dialog" aria-modal="true" aria-labelledby="worker-card-title" className="max-h-[94dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100 sm:max-h-[90dvh] sm:p-5">
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 id="worker-card-title" className="font-bold">Carnet del trabajador</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar carnet" className="min-h-11 min-w-11 rounded-xl border p-3"><X className="h-5 w-5" /></button>
        </header>
        {error ? <p role="alert">No se ha podido crear la tarjeta con su QR. {error}</p> : card ? <>
          <img src={card.url} alt={`Carnet PROFEA de ${person.apellidosNombre} con código QR para consultar la ficha`} className="block h-auto w-full rounded-xl border" />
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={sharing} onClick={share} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#00548E] px-4 py-3 font-bold text-white disabled:opacity-50"><Share2 className="h-4 w-4" />Compartir tarjeta</button>
            <button type="button" onClick={() => downloadWorkerCard(card.image, card.image.name)} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 font-bold"><Download className="h-4 w-4" />Descargar imagen</button>
          </div>
          <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            <h3 className="text-sm font-extrabold text-[#00548E] dark:text-blue-300">Imprimir el carnet</h3>
            <p className="text-xs text-slate-600 dark:text-slate-300">Elige «Tamaño DNI» para obtener una hoja A4 con la tarjeta de 85,60 × 53,98 mm. Imprime al 100 % (tamaño real), sin ajustar la página.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => downloadWorkerCard(card.printPdf, card.printName)}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#00548E] px-4 py-3 text-sm font-bold text-white hover:bg-[#003f70]">
                <Printer className="h-4 w-4" /> PDF tamaño DNI · A4
              </button>
              <button type="button" onClick={() => downloadWorkerCard(card.pdf, card.pdfName)}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold dark:border-slate-600">
                <Download className="h-4 w-4" /> PDF original
              </button>
            </div>
          </div>
          <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
            <button type="button" aria-expanded={inspectionExpanded} aria-controls="card-inspection-access"
              onClick={() => setInspectionExpanded(value => !value)}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#00548E]/30 px-4 py-3 text-sm font-bold text-[#00548E] dark:border-blue-700 dark:text-blue-300">
              <ShieldCheck className="h-4 w-4"/> Acceso temporal a Inspección y Dirección Facultativa
            </button>
            {inspectionExpanded && <div id="card-inspection-access" className="mt-3">
              <Suspense fallback={<p role="status">Preparando acceso seguro…</p>}>
                <InspectionAccessManager person={person}/>
              </Suspense>
            </div>}
          </div>
          {notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
        </> : <p role="status" className="flex items-center gap-2 p-6"><Loader2 className="h-5 w-5 animate-spin" />Preparando carnet…</p>}
      </section>
    </div>
  </ModalPortal>;
}
