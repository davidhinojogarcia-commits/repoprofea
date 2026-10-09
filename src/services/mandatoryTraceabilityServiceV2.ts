import { supabase } from '../lib/supabase';

export type MandatoryV2WorkerInput = {
  legacyWorkerId?: number | null;
  printedName: string;
  directoryWorkerId?: number | null;
  page?: number | null;
  rowIndex?: number | null;
  detectionStatus: 'DETECTED'|'CONFIRMED'|'REJECTED';
  detectionConfidence?: number | null;
  positionStatus: 'PENDING'|'RESOLVED'|'REJECTED';
  positionSource?: 'AUTO'|'MANUAL';
  nameBox?: Record<string,number>|null;
  signatureBox?: Record<string,number>|null;
};

export async function initializeMandatoryTraceabilityV2(input: {
  documentId: string;
  workers: MandatoryV2WorkerInput[];
  detectedWorksite?: string | null;
  lifecycleStatus?: string | null;
}) {
  return supabase.rpc('initialize_mandatory_document_v2', {
    p_document_id: input.documentId,
    p_workers: input.workers,
    p_detected_worksite: input.detectedWorksite || null,
    p_lifecycle_status: input.lifecycleStatus || null,
  });
}

export async function reviewMandatoryDocumentWorkerV2(input: {
  documentId: string;
  documentWorkerId: string;
  action: 'confirm'|'reject';
  printedName?: string;
  nameBox?: Record<string,number>|null;
  signatureBox?: Record<string,number>|null;
}) {
  return supabase.rpc('review_mandatory_document_worker_v2', {
    p_document_id: input.documentId,
    p_document_worker_id: input.documentWorkerId,
    p_action: input.action,
    p_printed_name: input.printedName || null,
    p_name_box: input.nameBox || null,
    p_signature_box: input.signatureBox || null,
  });
}

export async function saveMandatoryWorkerSelectionV2(input: {
  documentId: string;
  workers: Array<{
    documentWorkerId: string;
    selected: boolean;
    printedName: string;
    nameBox?: Record<string, number> | null;
    signatureBox?: Record<string, number> | null;
  }>;
}) {
  const readWorkers = () => supabase.query('mandatory_document_workers_v2', {
    query: `document_id=eq.${encodeURIComponent(input.documentId)}&select=id,legacy_worker_id,detection_status`,
    networkOnly: true,
  });
  const before = await readWorkers();
  const byId = new Map((Array.isArray(before) ? before : []).map((row: any) => [String(row.id), row]));
  for (const worker of input.workers) {
    if (!byId.has(worker.documentWorkerId)) throw new Error('La lista de trabajadores ha cambiado. Actualiza el documento antes de guardar.');
  }
  // Reject first; unchanged confirmed workers must not be reconfirmed in an assigned document.
  for (const worker of input.workers.filter(worker => !worker.selected)) {
    if (byId.get(worker.documentWorkerId)?.detection_status === 'REJECTED') continue;
    await reviewMandatoryDocumentWorkerV2({ documentId: input.documentId, documentWorkerId: worker.documentWorkerId, action: 'reject' });
  }
  for (const worker of input.workers.filter(worker => worker.selected)) {
    if (byId.get(worker.documentWorkerId)?.detection_status === 'CONFIRMED') continue;
    await reviewMandatoryDocumentWorkerV2({ ...worker, documentId: input.documentId, action: 'confirm' });
  }
  const after = await readWorkers();
  const persisted = new Map((Array.isArray(after) ? after : []).map((row: any) => [String(row.id), row]));
  const documents = await supabase.query('foreman_mandatory_documents', {
    query: `id=eq.${encodeURIComponent(input.documentId)}&select=id,details,signatures,workers&limit=1`,
    networkOnly: true,
  });
  const document = Array.isArray(documents) ? documents[0] : null;
  if (!document) throw new Error('No se pudo verificar el documento guardado.');
  for (const worker of input.workers) {
    const row: any = persisted.get(worker.documentWorkerId);
    if (!row || row.detection_status !== (worker.selected ? 'CONFIRMED' : 'REJECTED')) {
      throw new Error('La selección de trabajadores no quedó guardada. Mantén abierto el documento y vuelve a intentarlo.');
    }
    if (!worker.selected && row.legacy_worker_id != null) {
      const legacyId = String(row.legacy_worker_id);
      const ids = document.details?.importedWorkerIds || [];
      const anchors = document.details?.workerAnchors || [];
      if (ids.some((id: any) => String(id) === legacyId) ||
          anchors.some((anchor: any) => String(anchor.workerId) === legacyId) ||
          (document.workers || []).some((entry: any) => String(entry.id) === legacyId) ||
          Object.prototype.hasOwnProperty.call(document.signatures || {}, legacyId)) {
        throw new Error('El trabajador desmarcado todavía aparece en la lista de firmas. No se ha confirmado el guardado.');
      }
    }
  }
  return document;
}

export async function updateMandatoryDocumentWorkerGeometryV2(input: {
  documentId: string;
  documentWorkerId: string;
  nameBox?: Record<string,number>|null;
  signatureBox: Record<string,number>;
  page?: number|null;
  rowIndex?: number|null;
}) {
  return supabase.rpc('update_mandatory_document_worker_geometry_v2', {
    p_document_id: input.documentId,
    p_document_worker_id: input.documentWorkerId,
    p_name_box: input.nameBox,
    p_signature_box: input.signatureBox,
    p_page: input.page ?? null,
    p_row_index: input.rowIndex ?? null,
  });
}

export async function addMissingMandatoryDocumentWorkerV2(input: {
  documentId: string;
  printedName: string;
  page: number;
  rowIndex: number;
  signatureBox: Record<string,number>;
  nameBox?: Record<string,number>|null;
}) {
  return supabase.rpc('add_missing_mandatory_document_worker_v2', {
    p_document_id: input.documentId,
    p_printed_name: input.printedName,
    p_page: input.page,
    p_row_index: input.rowIndex,
    p_signature_box: input.signatureBox,
    p_name_box: input.nameBox || null,
  });
}

export async function assignMandatoryDocumentV2(documentId: string) {
  return supabase.rpc('assign_mandatory_document_v2', { p_document_id: documentId });
}

export async function confirmMandatoryWorksiteV2(documentId: string, obra: string) {
  return supabase.rpc('confirm_mandatory_document_worksite_v2', {
    p_document_id: documentId,
    p_obra: obra,
  });
}

export async function signMandatoryDocumentWorkerV2(input: {
  token: string;
  documentId: string;
  documentWorkerId: string;
  signature: string;
}) {
  return supabase.rpc('sign_mandatory_document_worker_v2', {
    p_token: input.token,
    p_document_id: input.documentId,
    p_document_worker_id: input.documentWorkerId,
    p_signature: input.signature,
  });
}

export async function submitMandatoryDocumentV2(input: {
  token: string;
  documentId: string;
  pdfBase64: string;
  signedSha256: string;
  fidelity: Record<string, unknown>;
}) {
  return supabase.rpc('submit_mandatory_document_v2', {
    p_token: input.token,
    p_document_id: input.documentId,
    p_pdf_base64: input.pdfBase64,
    p_signed_sha256: input.signedSha256,
    p_fidelity: input.fidelity || {},
  });
}

export async function getSupervisorMandatorySignedPdfV2(documentId: string) {
  return supabase.rpc('get_supervisor_mandatory_signed_pdf_v2', {
    p_document_id: documentId,
  });
}

export async function returnMandatoryDocumentV2(documentId: string, reason: string) {
  return supabase.rpc('return_mandatory_document_v2', {
    p_document_id: documentId,
    p_reason: reason,
  });
}

export async function reviewSubmittedMandatoryDocumentV2(documentId: string) {
  return supabase.rpc('review_submitted_mandatory_document_v2', {
    p_document_id: documentId,
  });
}

export async function getMandatoryTraceabilityV2(documentId: string) {
  return supabase.rpc('get_supervisor_mandatory_traceability_v2', {
    p_document_id: documentId,
  });
}

export async function reopenMandatoryDocumentV2(documentId: string) {
  return supabase.rpc('reopen_mandatory_document_v2', { p_document_id: documentId });
}

