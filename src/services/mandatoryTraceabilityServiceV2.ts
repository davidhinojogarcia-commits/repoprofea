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
