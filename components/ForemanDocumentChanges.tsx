import React, { useState } from 'react';
import { supabase } from '../src/lib/supabase';
import { appConfirm, appPrompt } from '../src/lib/appDialog';

export const documentChangeLabel = (action: string) => ({ rectify: 'Rectificar', replace: 'Sustituir', annul: 'Anular', withdraw: 'Retirar de la vista' }[action] || action);

export async function requestDocumentChange(token: string, documentId: string, action: string) {
  const reason = await appPrompt('Indica el motivo. El documento firmado original se conservará y el supervisor revisará tu solicitud.', { title: documentChangeLabel(action), confirmLabel: 'Enviar solicitud' });
  if (reason == null) return false;
  if (reason.trim().length < 3) throw new Error('Indica un motivo de al menos tres caracteres.');
  await supabase.rpc('request_foreman_document_change', { p_token: token, p_document_id: documentId, p_action: action, p_reason: reason });
  return true;
}

type Request = { id: string; document_id: string; action: string; reason: string; created_at: string; status: string };
export default function ForemanDocumentChanges({ documents, onResolved }: {
  documents: { id: string; obra: string; status: string; document_type: string; details?: Record<string, any>; signatures: Record<string, any> }[];
  onResolved: () => void;
}) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = async () => {
    setBusy(true); setMessage('');
    try { const result = await supabase.query('foreman_document_change_requests', { query: 'select=id,document_id,action,reason,created_at,status&status=eq.pending&order=created_at.desc&limit=100', networkOnly: true }); setRequests(Array.isArray(result) ? result : []); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'No se pudieron consultar las solicitudes.'); }
    finally { setBusy(false); }
  };
  const resolve = async (request: Request, approve: boolean) => {
    if (!await appConfirm(approve ? `¿Aprobar ${documentChangeLabel(request.action).toLocaleLowerCase('es')}? El original y sus firmas quedarán en el historial.` : '¿Rechazar esta solicitud?', { confirmLabel: approve ? 'Aprobar' : 'Rechazar' })) return;
    setBusy(true);setMessage('');
    try {
      await supabase.rpc('resolve_foreman_document_change', { p_request_id: request.id, p_approve: approve, p_replacement_id: replacements[request.id] || null });
      setRequests(current => current.filter(r => r.id !== request.id));onResolved();setMessage('Solicitud resuelta y registrada.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'No se pudo resolver la solicitud.'); }
    finally { setBusy(false); }
  };
  return <details className="rounded-2xl border bg-white p-4 dark:bg-slate-900">
    <summary className="min-h-[48px] cursor-pointer font-black">Rectificaciones, sustituciones y anulaciones</summary>
    <p className="my-3 text-sm">Para corregir contenido, importa primero una versión nueva sin firmas. Selecciónala al aprobar: el original se archiva y la nueva versión deberá completar sus propias firmas.</p>
    <button type="button" disabled={busy} className="min-h-[48px] rounded-xl border p-3 font-bold" onClick={() => void load()}>Consultar solicitudes</button>
    {requests.map(request => {
      const document = documents.find(d => d.id === request.document_id);
      const requiresReplacement = ['rectify', 'replace'].includes(request.action);
      return <article key={request.id} className="mt-3 space-y-2 rounded-xl border p-3">
        <p className="font-bold">{documentChangeLabel(request.action)} · {document?.obra || ''} · {String(document?.details?.sourceFilename || document?.document_type || 'Documento')}</p>
        <p className="break-words text-sm">{request.reason}</p>
        {requiresReplacement && <label className="block font-bold">Nueva versión sin firmas<select value={replacements[request.id] || ''} onChange={e => setReplacements(current => ({ ...current, [request.id]: e.target.value }))} className="mt-1 min-h-[48px] w-full rounded-xl border p-2"><option value="">Selecciona el documento importado</option>{documents.filter(d => d.id !== request.document_id && d.obra === document?.obra && !['completed', 'reviewed'].includes(d.status) && !Object.keys(d.signatures || {}).length).map(d => <option key={d.id} value={d.id}>{String(d.details?.sourceFilename || d.document_type)} · {d.id.slice(0, 8)}</option>)}</select></label>}
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || (requiresReplacement && !replacements[request.id])} onClick={() => void resolve(request, true)} className="min-h-[48px] rounded-xl bg-[#00548E] p-3 font-bold text-white disabled:opacity-50">Aprobar</button><button type="button" disabled={busy} onClick={() => void resolve(request, false)} className="min-h-[48px] rounded-xl border p-3 font-bold">Rechazar</button></div>
      </article>;
    })}
    {message && <p role="status" className="mt-3 text-sm font-bold">{message}</p>}
  </details>;
}
