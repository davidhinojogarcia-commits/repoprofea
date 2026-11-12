import React, { useEffect, useState } from 'react';
import { Download, Loader2, Share2, Printer, X } from 'lucide-react';
import ModalPortal from './ModalPortal';
import type { Person } from '../types';
import { downloadWorkerCard, generateWorkerCard, generateDniSizedPrintSheet, shareWorkerCard } from '../src/lib/workerCard';
import { generateWorkerCardBack, generateWorkerCardDuplexSheet, generateWorkerCardCalibration } from '../src/lib/workerCardDuplex';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import QRCode from 'qrcode';
import { ensureWorkerQrShare } from '../src/services/workerQrShareService';

export default function WorkerCardModal({ person, people = [person], onClose }: { person: Person; people?: Person[]; onClose: () => void }) {
  const [card, setCard] = useState<{ url: string; backUrl: string; image: File; pdf: Blob; pdfName: string; printPdf: Blob; printName: string; duplexPdf: Blob; duplexName: string; backPdf: Blob } | null>(null);
  const [viewBack, setViewBack] = useState(false);
  const [selectedIds,setSelectedIds]=useState<string[]>([String(person.id)]);
  const [bulkOpen,setBulkOpen]=useState(false);
  const [bulkSearch,setBulkSearch]=useState('');
  const [bulkBusy,setBulkBusy]=useState(false);
  const [bulkProgress,setBulkProgress]=useState('');
  const availablePeople=people.filter(p=>p.id!==null&&p.id!==undefined);
  const bulkChoices=availablePeople.filter(p=>String(p.apellidosNombre||'').toLocaleLowerCase('es-ES').includes(bulkSearch.toLocaleLowerCase('es-ES'))).slice(0,80);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let url = '';
    let backUrl = '';
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
    let backTask: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
    setCard(null);
    setViewBack(false);
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
      const frontPng=canvas.toDataURL('image/png');
      const { doc: printDoc, filename: printName } = generateDniSizedPrintSheet(frontPng);
      const { doc: duplexDoc, filename: duplexName } = generateWorkerCardDuplexSheet([{id:person.id,frontPng}]);
      const reverseDoc=generateWorkerCardBack();
      backTask=pdfjs.getDocument({data:new Uint8Array(reverseDoc.output('arraybuffer')),useSystemFonts:true});
      const reversePdf=await backTask.promise;
      const reversePage=await reversePdf.getPage(1);
      const reverseViewport=reversePage.getViewport({scale:4});
      const reverseCanvas=document.createElement('canvas');
      reverseCanvas.width=Math.ceil(reverseViewport.width);
      reverseCanvas.height=Math.ceil(reverseViewport.height);
      const reverseContext=reverseCanvas.getContext('2d');
      if(!reverseContext)throw new Error('No se ha podido preparar la cara trasera.');
      await reversePage.render({canvasContext:reverseContext,canvas:reverseCanvas,viewport:reverseViewport}).promise;
      const reverseBlob=await new Promise<Blob>((resolve,reject)=>reverseCanvas.toBlob(value=>value?resolve(value):reject(new Error('No se ha podido representar el reverso.')),'image/png'));
      if(cancelled)return;
      backUrl=URL.createObjectURL(reverseBlob);
      setCard({url,backUrl,image,pdf:doc.output('blob'),pdfName:filename,
        printPdf:printDoc.output('blob'),printName,
        duplexPdf:duplexDoc.output('blob'),duplexName,backPdf:reverseDoc.output('blob')});
    })().catch(e => { if (!cancelled) setError(e.message || 'No se ha podido preparar el carnet.'); })
      .finally(() => { void task?.destroy().catch(() => undefined); void backTask?.destroy().catch(() => undefined); });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      if (backUrl) URL.revokeObjectURL(backUrl);
      void task?.destroy().catch(() => undefined);
      void backTask?.destroy().catch(() => undefined);
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
  const printSelected=async()=>{
    if(bulkBusy)return;
    const unique=new Set(selectedIds);
    const chosen=availablePeople.filter(p=>unique.has(String(p.id)));
    if(!chosen.length||chosen.length>16){setNotice('Selecciona entre 1 y 16 trabajadores.');return;}
    setBulkBusy(true);setNotice('');setBulkProgress('');
    try{
      const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
      const cards:{id:string;frontPng:string}[]=[];
      for(let index=0;index<chosen.length;index++){
        const worker=chosen[index];
        setBulkProgress(`Preparando ${index+1} de ${chosen.length} carnets…`);
        const token=await ensureWorkerQrShare(Number(worker.id));
        const qrUrl=`${window.location.origin}${window.location.pathname}?worker-qr=${encodeURIComponent(token)}`;
        const qr=await QRCode.toDataURL(qrUrl,{margin:1,width:320,errorCorrectionLevel:'M'});
        const {doc}=generateWorkerCard(worker,qr);
        const task=pdfjs.getDocument({data:new Uint8Array(doc.output('arraybuffer')),useSystemFonts:true});
        try{
          const pdf=await task.promise;
          const page=await pdf.getPage(1);
          const viewport=page.getViewport({scale:3.5});
          const canvas=document.createElement('canvas');
          canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
          const ctx=canvas.getContext('2d');
          if(!ctx)throw new Error('No se ha podido representar un carnet.');
          await page.render({canvasContext:ctx,canvas,viewport}).promise;
          cards.push({id:String(worker.id),frontPng:canvas.toDataURL('image/png')});
        } finally {await task.destroy().catch(()=>undefined);}
      }
      const output=generateWorkerCardDuplexSheet(cards);
      downloadWorkerCard(output.doc.output('blob'),output.filename);
      setNotice(`PDF A4 preparado: ${chosen.length} carnets, ${Math.ceil(chosen.length/8)*2} páginas, doble cara por borde largo.`);
    } catch(e:any){setNotice(e?.message||'No se han podido preparar los carnets seleccionados.');}
    finally{setBulkBusy(false);setBulkProgress('');}
  };
  return <ModalPortal label="Carnet del trabajador">
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-2 sm:p-3">
      <section role="dialog" aria-modal="true" aria-labelledby="worker-card-title" className="max-h-[94dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100 sm:max-h-[90dvh] sm:p-5">
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 id="worker-card-title" className="font-bold">Carnet del trabajador</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar carnet" className="min-h-11 min-w-11 rounded-xl border p-3"><X className="h-5 w-5" /></button>
        </header>
        {error ? <p role="alert">No se ha podido crear la tarjeta con su QR. {error}</p> : card ? <>
          <div role="group" aria-label="Vista del carnet" className="mb-2 grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={!viewBack} onClick={()=>setViewBack(false)} className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-bold ${!viewBack?'bg-[#00548E] text-white':'dark:bg-slate-800'}`}>Ver carnet</button>
            <button type="button" aria-pressed={viewBack} onClick={()=>setViewBack(true)} className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-bold ${viewBack?'bg-[#00548E] text-white':'dark:bg-slate-800'}`}>Ver cara trasera</button>
          </div>
          <img src={viewBack?card.backUrl:card.url} alt={viewBack?'Reverso institucional del carnet PROFEA':`Carnet PROFEA de ${person.apellidosNombre} con código QR para consultar la ficha`} className="block h-auto w-full rounded-xl border" />
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={sharing} onClick={share} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#00548E] px-4 py-3 font-bold text-white disabled:opacity-50"><Share2 className="h-4 w-4" />Compartir tarjeta</button>
            <button type="button" onClick={() => downloadWorkerCard(card.image, card.image.name)} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 font-bold"><Download className="h-4 w-4" />Descargar imagen</button>
          </div>
          <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            <h3 className="text-sm font-extrabold text-[#00548E] dark:text-blue-300">Imprimir el carnet</h3>
            <p className="text-xs text-slate-600 dark:text-slate-300">A4 vertical · doble cara · voltear por borde largo · escala 100 % (tamaño real) · desactivar «Ajustar a página». Recorta por las marcas exteriores. Haz primero una prueba de calibración con tu impresora.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => downloadWorkerCard(card.duplexPdf, card.duplexName)}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#00548E] px-4 py-3 text-sm font-bold text-white hover:bg-[#003f70]">
                <Printer className="h-4 w-4" /> PDF A4 doble cara
              </button>
              <button type="button" onClick={() => { const proof=generateWorkerCardCalibration(); downloadWorkerCard(proof.doc.output('blob'),proof.filename); }}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold dark:border-slate-600">
                <Download className="h-4 w-4" /> Prueba de calibración
              </button>
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
          <details className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700" open={bulkOpen} onToggle={event=>setBulkOpen(event.currentTarget.open)}>
            <summary className="cursor-pointer text-sm font-extrabold text-[#00548E] dark:text-blue-300">Imprimir varios carnets · selección autorizada</summary>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">Selecciona hasta 16 trabajadores. Cada grupo de ocho ocupa dos páginas A4 (anversos y reversos). La selección solo incluye trabajadores visibles para tu cuenta.</p>
            <input aria-label="Buscar trabajadores para imprimir carnets" value={bulkSearch} onChange={event=>setBulkSearch(event.target.value)} placeholder="Buscar por nombre" className="mt-2 min-h-11 w-full rounded-xl border px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"/>
            <div role="group" aria-label="Trabajadores autorizados para impresión" className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2 dark:border-slate-700">
              {bulkChoices.map(worker=><label key={worker.id} className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
                <input type="checkbox" className="h-5 w-5 shrink-0" checked={selectedIds.includes(String(worker.id))}
                  onChange={event=>setSelectedIds(current=>event.target.checked?[...new Set([...current,String(worker.id)])]:current.filter(id=>id!==String(worker.id)))}/>
                <span className="min-w-0 break-words">{worker.apellidosNombre}</span>
              </label>)}
              {!bulkChoices.length&&<p className="text-sm text-slate-500">No hay trabajadores coincidentes.</p>}
            </div>
            <p className="mt-2 text-xs font-semibold">{selectedIds.length} seleccionado(s) · máximo 16</p>
            <button type="button" disabled={bulkBusy||!selectedIds.length||selectedIds.length>16} onClick={()=>void printSelected()}
              className="mt-2 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#00548E] px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
              <Printer className="h-4 w-4"/>{bulkBusy?'Preparando PDF…':'Imprimir varios carnets · A4 dúplex'}
            </button>
            {bulkProgress&&<p role="status" className="mt-2 text-sm">{bulkProgress}</p>}
          </details>
          {notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
        </> : <p role="status" className="flex items-center gap-2 p-6"><Loader2 className="h-5 w-5 animate-spin" />Preparando carnet…</p>}
      </section>
    </div>
  </ModalPortal>;
}
