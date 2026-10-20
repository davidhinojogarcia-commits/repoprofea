import type { ForemanMandatoryDocument } from './foremanPortalService';
import { foremanVault } from '../lib/foremanLocalVault';
import { supabase } from '../lib/supabase';

export type OfflineSnapshot = {
  id: string; version: string; downloadedAt: string;
  document: ForemanMandatoryDocument & { obra: string };
  pdf: { base64: string; filename: string; sha256: string; variant: 'original' | 'signed' };
};
export type PendingPortalSignature = {
  id: string; documentId: string; version: string; signature: string;
  workerId?: number; documentWorkerId?: string; foreman?: boolean; attendanceKind?: 'entry'|'exit'|'foreman';workDate?:string;
  createdAt: number; attempts: number; retryAt: number; error?: string; blocked?: boolean;
};
const changes = () => window.dispatchEvent(new Event('profea:foreman-offline'));

async function locked<T>(token: string, task: () => Promise<T>) {
  if (!navigator.locks) throw new Error('Este navegador no permite gestionar firmas sin conexión de forma segura. Usa la firma con conexión.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const scope = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  return navigator.locks.request('foreman-offline:' + scope, task);
}

export async function offlineDocuments(token: string) {
  const vault = await foremanVault(token);
  return (await vault.get<OfflineSnapshot[]>('documents')) || [];
}
export async function pendingPortalSignatures(token: string) {
  return (await (await foremanVault(token)).get<PendingPortalSignature[]>('signatures')) || [];
}
export async function downloadPortalDocument(token: string, id: string, renderNative?: (snapshot: OfflineSnapshot) => Promise<OfflineSnapshot['pdf']>) {
  return locked(token, async () => {
    const snapshot = await supabase.rpc('get_foreman_offline_snapshot', { p_token: token, p_document_id: id }, { fresh: true }) as OfflineSnapshot;
    if (!snapshot?.version) throw new Error('No se pudo descargar el documento completo.');
    if(!snapshot.pdf?.base64&&snapshot.document?.details?.originalPdfMode!=='overlay'&&renderNative)snapshot.pdf=await renderNative(snapshot);
    if(!snapshot.pdf?.base64)throw new Error('No se encuentra el PDF original.');
    // Detect corrupt/truncated transport before announcing offline availability.
    const raw = Uint8Array.from(atob(snapshot.pdf.base64.replace(/\s/g, '')), c => c.charCodeAt(0));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)), n => n.toString(16).padStart(2, '0')).join('');
    if (hash !== snapshot.pdf.sha256) throw new Error('El documento descargado no supera la comprobación de integridad.');
    const vault = await foremanVault(token);
    const pending = await pendingPortalSignatures(token);
    if (pending.some(p => p.documentId === id && p.version !== snapshot.version)) throw new Error('Conserva primero las firmas pendientes y revisa el conflicto antes de sustituir la copia local.');
    const documents = await offlineDocuments(token);
    await vault.put('documents', [...documents.filter(d => d.id !== id), snapshot]);
    await vault.authorize();
    changes();
    return snapshot;
  });
}
export async function removePortalDownload(token: string, id: string) {
  return locked(token, async () => {
    if ((await pendingPortalSignatures(token)).some(p => p.documentId === id)) throw new Error('Hay firmas pendientes de sincronizar. Revísalas antes de retirar la copia.');
    await (await foremanVault(token)).put('documents', (await offlineDocuments(token)).filter(d => d.id !== id));
    changes();
  });
}
export async function queuePortalSignature(token: string, input: Pick<PendingPortalSignature, 'documentId' | 'signature' | 'workerId' | 'documentWorkerId' | 'foreman'>) {
  return locked(token, async () => {
    const vault = await foremanVault(token);
    if (!await vault.authorized()) throw new Error('Conéctate para verificar tu acceso antes de continuar. Tu trabajo local se conserva.');
    const snapshot = (await offlineDocuments(token)).find(d => d.id === input.documentId);
    if (!snapshot || snapshot.pdf.variant !== 'original') throw new Error('Descarga primero la versión pendiente del documento con conexión.');
    const queue = await pendingPortalSignatures(token);
    const existing = queue.find(p => p.documentId === input.documentId && Boolean(p.foreman) === Boolean(input.foreman) && p.workerId === input.workerId);
    if (existing) {
      if (existing.signature !== input.signature) throw new Error('Esta persona ya tiene una firma pendiente. Revísala antes de cambiarla.');
      return existing;
    }
    const operation: PendingPortalSignature = { ...input, id: crypto.randomUUID(), version: snapshot.version, createdAt: Date.now(), attempts: 0, retryAt: 0 };
    await vault.put('signatures', [...queue, operation]);
    changes();
    return operation;
  });
}
export async function synchronizePortalSignatures(token: string, manual = false) {
  if (!navigator.onLine) return;
  return locked(token, async () => {
    const vault = await foremanVault(token);
    let queue = await pendingPortalSignatures(token);
    const blockedDocuments = new Set<string>();
    for (const operation of [...queue]) {
      if(operation.blocked)blockedDocuments.add(operation.documentId);
      if (operation.blocked || blockedDocuments.has(operation.documentId) || (!manual && operation.retryAt > Date.now())) continue;
      operation.attempts+=1;
      queue=queue.map(p=>p.id===operation.id?{...p,attempts:operation.attempts}:p);
      await vault.put('signatures',queue);
      try {
        const result = operation.attendanceKind ? await supabase.rpc('sync_foreman_offline_attendance',{p_token:token,p_operation_id:operation.id,p_work_date:operation.workDate,p_version:operation.version,p_signature:operation.signature,p_worker_id:operation.workerId??null,p_kind:operation.attendanceKind}) : await supabase.rpc('sync_foreman_offline_signature', {
          p_token: token, p_operation_id: operation.id, p_document_id: operation.documentId,
          p_version: operation.version, p_signature: operation.signature,
          p_worker_id: operation.workerId ?? null, p_document_worker_id: operation.documentWorkerId ?? null, p_foreman: Boolean(operation.foreman),
        });
        if (!result?.ok) throw new Error('No se recibió confirmación del servidor.');
        queue = queue.filter(p => p.id !== operation.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo sincronizar.';
        const blocked = /modificado|revocado|no válido|no disponible|otra firma|incompatible|Persona/.test(message);
        queue = queue.map(p => p.id === operation.id ? { ...p, attempts: operation.attempts, retryAt: Date.now() + Math.min(300000, 2000 * 2 ** Math.min(p.attempts, 7)), error: message, blocked } : p);
        blockedDocuments.add(operation.documentId);
      }
      // If persisting the receipt fails, the immutable operation UUID remains safe to retry.
      await vault.put('signatures', queue);
      changes();
    }
  });
}

export async function prepareOfflineAttendance(token:string,workDate:string){
  const snapshot=await supabase.rpc('get_foreman_offline_attendance',{p_token:token,p_work_date:workDate},{fresh:true});
  if(!snapshot?.version)throw new Error('No se pudo preparar la jornada.');
  await (await foremanVault(token)).put('attendance:'+workDate,snapshot);
  changes();
}
export async function queueOfflineAttendance(token:string,workDate:string,rows:import('./foremanPortalService').ForemanAttendanceRow[],kind:'entry'|'exit'|'foreman',signature:string,workerId?:number){
 return locked(token,async()=>{
  const vault=await foremanVault(token);
  if(!await vault.authorized())throw new Error('Conéctate para verificar tu acceso.');
  const snapshot=await vault.get<{id:string;version:string;rows:import('./foremanPortalService').ForemanAttendanceRow[]}>('attendance:'+workDate);
  if(!snapshot)throw new Error('Prepara esta jornada con conexión antes de firmarla sin cobertura.');
  if(rows.some(row=>{const saved=snapshot.rows.find(item=>item.workerId===row.workerId);return !saved||saved.entryTime!==row.entryTime||saved.exitTime!==row.exitTime;}))throw new Error('Las horas han cambiado. Conéctate y prepara de nuevo la jornada antes de firmar.');
  const queue=await pendingPortalSignatures(token);
  const documentId='attendance:'+workDate;
  const existing=queue.find(item=>item.documentId===documentId&&item.attendanceKind===kind&&item.workerId===workerId);
  if(existing){if(existing.signature!==signature)throw new Error('Ya hay otra firma pendiente de esta persona.');return;}
  await vault.put('signatures',[...queue,{id:crypto.randomUUID(),documentId,version:snapshot.version,signature,workerId,attendanceKind:kind,workDate,foreman:kind==='foreman',createdAt:Date.now(),attempts:0,retryAt:0}]);
  changes();
 });
}

export async function cancelPendingPortalSignature(token:string,id:string){
 return locked(token,async()=>{
  const queue=await pendingPortalSignatures(token);
  const operation=queue.find(item=>item.id===id);
  if(!operation)return;
  if(operation.attempts>0)throw new Error('Ya se ha intentado enviar esta firma. Hay que conciliarla con el servidor antes de retirarla.');
  await (await foremanVault(token)).put('signatures',queue.filter(item=>item.id!==id));changes();
 });
}
export async function reconcilePortalDownloads(token:string,documentIds:string[]){
 return locked(token,async()=>{
  const vault=await foremanVault(token);const allowed=new Set(documentIds);
  const files=await offlineDocuments(token);
  const kept=files.filter(file=>allowed.has(file.id));if(kept.length!==files.length)await vault.put('documents',kept);
  const queue=await pendingPortalSignatures(token);
  if(queue.some(item=>!item.attendanceKind&&!allowed.has(item.documentId)))await vault.put('signatures',queue.map(item=>!item.attendanceKind&&!allowed.has(item.documentId)?{...item,blocked:true,error:'Documento retirado del portal. Revisa la operación con el supervisor; la firma local se conserva.'}:item));
  changes();
 });
}
