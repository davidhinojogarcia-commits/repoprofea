import React, { useEffect, useState } from 'react';
import { appConfirm } from '../src/lib/appDialog';
import type { ForemanMandatoryDocument } from '../src/services/foremanPortalService';
import { cancelPendingPortalSignature, downloadPortalDocument, offlineDocuments, pendingPortalSignatures, removePortalDownload, synchronizePortalSignatures, type OfflineSnapshot, type PendingPortalSignature } from '../src/services/foremanOfflineService';
import { base64ToBytes, bytesToBase64 } from '../src/lib/mandatoryPdfOverlay';

export default function ForemanOfflinePanel({ token, documents, onPreview, onSynchronized }: {
  token: string; documents: ForemanMandatoryDocument[];
  onPreview: (bytes: Uint8Array, title: string, documentId: string) => void; onSynchronized: () => void;
}) {
  const [downloads, setDownloads] = useState<OfflineSnapshot[]>([]);
  const [pending, setPending] = useState<PendingPortalSignature[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    let active = true;
    const update = async () => {
      try {
        const [files, queue] = await Promise.all([offlineDocuments(token), pendingPortalSignatures(token)]);
        if (active) { setDownloads(files); setPending(queue); }
      } catch { if (active) setMessage('No se pudo leer el almacenamiento de este dispositivo.'); }
    };
    const connection = () => { setOnline(navigator.onLine); };
    void update();
    window.addEventListener('profea:foreman-offline', update);
    window.addEventListener('online', connection); window.addEventListener('offline', connection);
    return () => { active = false; window.removeEventListener('profea:foreman-offline', update); window.removeEventListener('online', connection); window.removeEventListener('offline', connection); };
  }, [token]);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo completar la operación.'); }
    finally { setBusy(false); }
  };
  const download = async (id: string) => {
    // Cache the lazy renderer and its worker while there is still coverage.
    await import('pdfjs-dist/legacy/build/pdf.mjs');
    const worker=await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    const response=await fetch(worker.default);
    if(!response.ok)throw new Error('No se pudo preparar el visor sin conexión.');
    await downloadPortalDocument(token, id,async snapshot=>{
      const {generateForemanMandatoryDocumentPdf}=await import('../src/lib/foremanDocumentsPdf');
      const output=generateForemanMandatoryDocumentPdf(snapshot.document,snapshot.document.obra);
      const bytes=new Uint8Array(output.doc.output('arraybuffer'));
      const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
      return {base64:bytesToBase64(bytes),filename:output.filename,sha256,variant:['completed','reviewed'].includes(snapshot.document.status)?'signed':'original'};
    }); setMessage('Documento verificado y guardado en este dispositivo.'); };
  const available = documents;
  return <details className="rounded-2xl border bg-white p-4 dark:bg-slate-900">
    <summary className="min-h-[48px] cursor-pointer font-black">Sin conexión · {downloads.length} documentos · {pending.length} firmas pendientes</summary>
    <p className="my-3 text-sm">Descarga con cobertura los PDF que necesites. Las firmas locales quedan pendientes hasta que el servidor las confirme. El acceso offline se verifica de nuevo tras 24 horas.</p>
    <p className="my-2 text-sm font-bold">Copias PDF: {(downloads.reduce((sum, d) => sum + d.pdf.base64.length * .75, 0) / 1048576).toFixed(1)} MB</p>
    <button type="button" disabled={busy || !online} className="min-h-[48px] rounded-xl border p-3 font-bold disabled:opacity-50" onClick={() => void run(async () => {
      const candidates = available.filter(d => !['completed', 'reviewed'].includes(d.status) && !downloads.some(file => file.id === d.id));
      // Sequential downloads bound network and memory use; a failed file does not erase earlier downloads.
      for (const doc of candidates) await download(doc.id);
      setMessage(candidates.length ? 'Documentos pendientes descargados.' : 'No quedan documentos pendientes por descargar.');
    })}>Descargar pendientes de esta obra</button>
    <div className="mt-3 space-y-2">
      {available.map(doc => {
        const cached = downloads.find(d => d.id === doc.id);
        return <div key={doc.id} className="rounded-xl border p-3">
          <p className="break-words font-bold">{String(doc.details?.sourceFilename || doc.documentType)} · {doc.periodKey || doc.workDate}</p>
          <p className="text-sm">{cached ? 'Disponible offline · copia del ' + new Date(cached.downloadedAt).toLocaleString('es-ES') : 'Necesita descarga'}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy || !online} className="min-h-[48px] rounded-xl border p-2 font-bold disabled:opacity-50" onClick={() => void run(() => download(doc.id))}>{cached ? 'Actualizar copia' : 'Descargar sin conexión'}</button>
            {cached && <><button type="button" className="min-h-[48px] rounded-xl border p-2 font-bold" onClick={() => onPreview(base64ToBytes(cached.pdf.base64), cached.pdf.filename,doc.id)}>Abrir copia local</button>
              <button type="button" disabled={busy} className="min-h-[48px] rounded-xl border p-2 font-bold" onClick={() => void run(async () => { if (await appConfirm('¿Retirar solo la copia de este dispositivo? El documento del supervisor se conserva.')) await removePortalDownload(token, doc.id); })}>Retirar copia local</button></>}
          </div>
        </div>;
      })}
    </div>
    {pending.length > 0 && <div className="mt-4 space-y-2">
      <h3 className="font-black">Firmas pendientes de sincronizar</h3>
      {pending.map(operation => <div key={operation.id} className="rounded-xl border border-amber-300 p-3 text-sm">
        <p className="font-bold">{documents.find(d => d.id === operation.documentId)?.details?.sourceFilename || 'Documento'} · {operation.foreman ? 'Encargado' : 'Trabajador'}</p>
        <img src={operation.signature} alt="Firma conservada en este dispositivo" className="h-14 max-w-full bg-white" />
        <p>{operation.error || 'Guardada en este dispositivo. El supervisor todavía no tiene confirmación.'}</p>
        {!operation.attempts&&<button type="button" disabled={busy} className="mt-2 min-h-[48px] rounded-xl border p-2 font-bold" onClick={()=>void run(async()=>{if(await appConfirm('¿Cancelar esta firma local que todavía no se ha enviado?'))await cancelPendingPortalSignature(token,operation.id);})}>Cancelar firma local</button>}
        {operation.blocked && <p className="font-bold">Requiere revisión con el supervisor. La firma local se conserva.</p>}
      </div>)}
      <button type="button" disabled={busy || !online} className="min-h-[52px] rounded-xl bg-[#00548E] p-3 font-black text-white disabled:opacity-50" onClick={() => void run(async () => { await synchronizePortalSignatures(token, true); onSynchronized(); })}>{busy ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
    </div>}
    {message && <p role="status" className="mt-3 text-sm font-bold">{message}</p>}
  </details>;
}
