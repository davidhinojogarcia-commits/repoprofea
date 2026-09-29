import type { Person } from '../../types';
import { supabase } from '../lib/supabase';

const FOREMAN_REQUEST_TIMEOUT_MS = 15000;

const withForemanTimeout = async <T>(promise: Promise<T>, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), FOREMAN_REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const compactAttendanceRows = (rows: ForemanAttendanceRow[]) =>
  rows.map(row => {
    const next: Record<string, unknown> = {
      workerId: row.workerId,
      name: row.name,
      dni: row.dni,
      category: row.category,
      entryTime: row.entryTime || '',
      exitTime: row.exitTime || '',
    };
    if (row.entrySignature === '') next.entrySignature = '';
    if (row.exitSignature === '') next.exitSignature = '';
    return next;
  });

export type ForemanAttendanceRow = {
  workerId: number;
  name: string;
  dni: string;
  category: string;
  entryTime?: string;
  entrySignature?: string;
  exitTime?: string;
  exitSignature?: string;
};

export type ForemanAttendanceDay = {
  id?: string;
  workDate: string;
  rows: ForemanAttendanceRow[];
  status: 'draft' | 'completed' | 'reviewed';
  completedAt?: string | null;
  updatedAt?: string | null;
  correctionPending?: boolean;
  correctionReason?: string | null;
  correctionRequestedAt?: string | null;
};

export type ForemanMandatoryDocument = {
  id: string;
  workDate: string;
  periodKey: string;
  documentType: 'inicio' | 'control_presencia' | 'epis' | 'formacion' | 'maquinaria' | 'autorizacion_uso_maquinaria';
  category: string;
  workers: Person[];
  signatures: Record<string, { signature: string; signedAt?: string } | string>;
  status: 'pending' | 'in_progress' | 'returned' | 'completed' | 'reviewed';
  completedAt?: string | null;
  details?: Record<string, any>;
  correctionPending?: boolean;
  correctionReason?: string | null;
  correctionRequestedAt?: string | null;
};

export type ForemanCompletedDocument = {
  id: string;
  workDate: string;
  documentType: string;
  workerId?: number | null;
  workerSnapshot: Partial<Person>;
  answers: Record<string, string>;
  signatures: Record<string, string>;
  status: 'draft' | 'completed' | 'reviewed';
  completedAt?: string | null;
  correctionPending?: boolean;
  correctionReason?: string | null;
  correctionRequestedAt?: string | null;
};

export type ForemanPortalPayload = {
  valid: boolean;
  obra: string;
  foremanName: string;
  defaultWorkStartHour: string;
  defaultWorkEndHour: string;
  worksite: {
    codigo: string;
    nombre: string;
    municipio: string;
    empresa: string;
    cif: string;
    recursoPreventivo: string;
  };
  workers: Person[];
  attendance: ForemanAttendanceDay[];
  documents: ForemanCompletedDocument[];
  mandatoryDocuments: ForemanMandatoryDocument[];
};

export type ForemanPortalAccessStatus = {
  exists: boolean;
  active: boolean;
  foremanName: string;
  lastUsedAt?: string | null;
  updatedAt?: string | null;
};

export async function getForemanPortalAccessStatus(obra: string): Promise<ForemanPortalAccessStatus> {
  const rows = await supabase.query('foreman_portal_access', {
    query: `obra=eq.${encodeURIComponent(obra)}&select=active,foreman_name,last_used_at,updated_at&limit=1`,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  return {
    exists: Boolean(row),
    active: Boolean(row?.active),
    foremanName: String(row?.foreman_name || ''),
    lastUsedAt: row?.last_used_at || null,
    updatedAt: row?.updated_at || null,
  };
}

export async function createForemanPortalAccess(obra: string, foremanName: string): Promise<string> {
  const token = await supabase.rpc('ensure_foreman_portal_access', {
    p_obra: obra,
    p_foreman_name: foremanName,
  });
  const value = String(token || '').trim();
  if (!value) throw new Error('No se pudo generar el acceso móvil del encargado.');
  return value;
}

export async function revokeForemanPortalAccess(obra: string): Promise<void> {
  await supabase.rpc('revoke_foreman_portal_access', { p_obra: obra });
}

export async function resolveForemanPortal(token: string): Promise<ForemanPortalPayload> {
  const result = await withForemanTimeout(
    supabase.rpc('resolve_foreman_portal', { p_token: token }),
    'La conexión con el portal está tardando demasiado. Comprueba la cobertura y pulsa Reintentar.',
  );
  return {
    valid: Boolean(result?.valid),
    obra: String(result?.obra || ''),
    foremanName: String(result?.foremanName || ''),
    defaultWorkStartHour: String(result?.defaultWorkStartHour || '08:00'),
    defaultWorkEndHour: String(result?.defaultWorkEndHour || '15:00'),
    worksite: {
      codigo: String(result?.worksite?.codigo || ''),
      nombre: String(result?.worksite?.nombre || result?.obra || ''),
      municipio: String(result?.worksite?.municipio || ''),
      empresa: String(result?.worksite?.empresa || ''),
      cif: String(result?.worksite?.cif || ''),
      recursoPreventivo: String(result?.worksite?.recursoPreventivo || result?.foremanName || ''),
    },
    workers: Array.isArray(result?.workers) ? result.workers : [],
    attendance: Array.isArray(result?.attendance) ? result.attendance : [],
    documents: Array.isArray(result?.documents) ? result.documents : [],
    mandatoryDocuments: Array.isArray(result?.mandatoryDocuments) ? result.mandatoryDocuments : [],
  };
}

export async function saveForemanAttendance(
  token: string,
  workDate: string,
  rows: ForemanAttendanceRow[],
  status: 'draft' | 'completed' = 'draft',
) {
  return withForemanTimeout(
    supabase.rpc('save_foreman_attendance', {
      p_token: token,
      p_work_date: workDate,
      p_rows: compactAttendanceRows(rows),
      p_status: status,
    }),
    'No se pudo guardar la jornada a tiempo. Comprueba la conexión y vuelve a intentarlo.',
  );
}

export async function signForemanAttendance(
  token: string,
  workDate: string,
  rows: ForemanAttendanceRow[],
  workerId: number,
  kind: 'entry' | 'exit',
  signature: string,
) {
  return withForemanTimeout(
    supabase.rpc('sign_foreman_attendance', {
      p_token: token,
      p_work_date: workDate,
      p_rows: compactAttendanceRows(rows),
      p_worker_id: workerId,
      p_kind: kind,
      p_signature: signature,
    }),
    'La firma está tardando demasiado en guardarse. Comprueba la conexión y vuelve a intentarlo.',
  );
}

export async function submitForemanDocument(input: {
  token: string;
  documentType: string;
  workDate: string;
  workerId?: number | null;
  answers: Record<string, string>;
  signatures: Record<string, string>;
}) {
  return withForemanTimeout(
    supabase.rpc('submit_foreman_document', {
      p_token: input.token,
      p_document_type: input.documentType,
      p_work_date: input.workDate,
      p_worker_id: input.workerId ?? null,
      p_answers: input.answers,
      p_signatures: input.signatures,
    }),
    'No se pudo enviar el documento a tiempo. Comprueba la conexión y vuelve a intentarlo.',
  );
}


export async function prepareMandatoryForemanDocuments(workers: Person[]): Promise<number> {
  if (!workers.length) return 0;
  const result = await supabase.rpc('prepare_foreman_mandatory_documents', { p_workers: workers });
  return Number(result) || 0;
}

export async function signMandatoryForemanDocument(
  token: string,
  documentId: string,
  workerId: number,
  signature: string,
) {
  return withForemanTimeout(
    supabase.rpc('sign_foreman_mandatory_document', {
      p_token: token,
      p_document_id: documentId,
      p_worker_id: workerId,
      p_signature: signature,
    }),
    'La firma está tardando demasiado en guardarse. Comprueba la conexión y vuelve a intentarlo.',
  );
}


export async function prepareMandatoryDocumentFromEmail(input: {
  documentType: 'inicio' | 'control_presencia';
  workerIds: number[];
  workDate: string;
  category?: string;
  periodKey: string;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  rfcMessageId?: string | null;
  emailFrom?: string | null;
  emailSubject?: string | null;
  attachmentName?: string | null;
  sourceText?: string | null;
  sourcePdfBase64?: string | null;
  sourcePdfSha256?: string | null;
  pageMeta?: any[];
  workerAnchors?: any[];
}) {
  const id = await supabase.rpc('prepare_foreman_mandatory_from_email', {
    p_document_type: input.documentType,
    p_worker_ids: input.workerIds,
    p_work_date: input.workDate,
    p_category: input.category || '',
    p_period_key: input.periodKey,
    p_gmail_message_id: input.gmailMessageId || null,
    p_gmail_thread_id: input.gmailThreadId || null,
    p_rfc_message_id: input.rfcMessageId || null,
    p_email_from: input.emailFrom || null,
    p_email_subject: input.emailSubject || null,
    p_attachment_name: input.attachmentName || null,
  });
  const documentId = String(id || '').trim();
  if (documentId && input.sourcePdfBase64) {
    await supabase.rpc('save_foreman_mandatory_original_pdf', {
      p_document_id: documentId,
      p_pdf_base64: input.sourcePdfBase64,
      p_filename: input.attachmentName || '',
      p_original_sha256: input.sourcePdfSha256 || '',
      p_page_meta: input.pageMeta || [],
      p_worker_anchors: input.workerAnchors || [],
    });
  }
  if (documentId) {
    const currentRows = await supabase.query('foreman_mandatory_documents', {
      query: 'id=eq.' + encodeURIComponent(documentId) + '&select=details&limit=1',
    });
    const currentDetails =
      Array.isArray(currentRows) && currentRows[0]?.details && typeof currentRows[0].details === 'object'
        ? currentRows[0].details
        : {};
    await supabase.query('foreman_mandatory_documents', {
      method: 'PATCH',
      query: 'id=eq.' + encodeURIComponent(documentId),
      prefer: 'return=minimal',
      body: {
        details: {
          ...currentDetails,
          sourceText: input.sourceText || '',
          sourceFilename: input.attachmentName || '',
          importedWorkerIds: Array.isArray(currentDetails.importedWorkerIds)
            ? currentDetails.importedWorkerIds
            : input.workerIds,
        },
        updated_at: new Date().toISOString(),
      },
    });
  }
  return id;
}

export async function getForemanMandatoryPdf(
  token: string,
  documentId: string,
  variant: 'original' | 'signed' = 'original',
) {
  return withForemanTimeout(
    supabase.rpc('get_foreman_mandatory_pdf', {
      p_token: token,
      p_document_id: documentId,
      p_variant: variant,
    }),
    'No se pudo abrir el PDF a tiempo. Comprueba la conexión y vuelve a intentarlo.',
  ) as Promise<{ base64:string; filename:string; sha256:string; variant:'original'|'signed'; fidelity?:any }>;
}

export async function getSupervisorMandatoryPdf(
  documentId: string,
  variant: 'original' | 'signed' = 'signed',
) {
  return supabase.rpc('get_supervisor_mandatory_pdf', {
    p_document_id: documentId,
    p_variant: variant,
  }) as Promise<{ base64:string; filename:string; sha256:string; variant:'original'|'signed'; fidelity?:any }>;
}

export async function storeForemanMandatorySignedPdf(input: {
  token: string;
  documentId: string;
  pdfBase64: string;
  signedSha256: string;
  fidelity: any;
}) {
  return withForemanTimeout(
    supabase.rpc('store_foreman_mandatory_signed_pdf', {
      p_token: input.token,
      p_document_id: input.documentId,
      p_pdf_base64: input.pdfBase64,
      p_signed_sha256: input.signedSha256,
      p_fidelity: input.fidelity || {},
    }),
    'No se pudo guardar el PDF firmado a tiempo. Comprueba la conexión y vuelve a intentarlo.',
  );
}

export async function markMandatoryDocumentReturned(id: string, gmailMessageId: string) {
  await supabase.rpc('mark_foreman_mandatory_returned', {
    p_id: id,
    p_gmail_message_id: gmailMessageId,
  });
}


export async function finalizeForemanMandatoryDocument(token: string, documentId: string) {
  return withForemanTimeout(
    supabase.rpc('finalize_foreman_mandatory_document', {
      p_token: token,
      p_document_id: documentId,
    }),
    'No se pudo finalizar el documento a tiempo. Comprueba la conexión y vuelve a intentarlo.',
  );
}


export async function createForemanOperationalDocument(input: {
  token: string;
  documentType: 'epis' | 'formacion' | 'maquinaria' | 'autorizacion_uso_maquinaria';
  workDate: string;
  workerIds: number[];
  details?: Record<string, any>;
}) {
  return withForemanTimeout(
    supabase.rpc('create_foreman_operational_document', {
      p_token: input.token,
      p_document_type: input.documentType,
      p_work_date: input.workDate,
      p_worker_ids: input.workerIds,
      p_details: input.details || {},
    }),
    'No se pudo preparar el documento a tiempo. Comprueba la conexión y vuelve a intentarlo.',
  );
}


export async function returnForemanItemForCorrection(
  entityType: 'mandatory' | 'attendance' | 'document',
  id: string,
  reason: string,
) {
  return supabase.rpc('return_foreman_item_for_correction', {
    p_entity_type: entityType,
    p_id: id,
    p_reason: reason,
  });
}

export async function reviewForemanItem(
  entityType: 'mandatory' | 'attendance' | 'document',
  id: string,
) {
  return supabase.rpc('review_foreman_item', {
    p_entity_type: entityType,
    p_id: id,
  });
}

export async function resubmitForemanDocument(input: {
  token: string;
  documentId: string;
  answers: Record<string, string>;
  signatures: Record<string, string>;
}) {
  return withForemanTimeout(
    supabase.rpc('resubmit_foreman_document', {
      p_token: input.token,
      p_document_id: input.documentId,
      p_answers: input.answers,
      p_signatures: input.signatures,
    }),
    'No se pudo reenviar el documento a tiempo. Comprueba la conexión y vuelve a intentarlo.',
  );
}


export async function updateForemanMandatoryDocument(input: {
  id: string;
  workDate: string;
  category: string;
  workers: Person[];
  signatures: Record<string, { signature: string; signedAt?: string } | string>;
  status: 'pending' | 'in_progress' | 'returned' | 'completed' | 'reviewed';
  details?: Record<string, any>;
}) {
  const workerIds = new Set(input.workers.map((worker) => String(worker.id)));
  const filteredSignatures = Object.fromEntries(
    Object.entries(input.signatures || {}).filter(([workerId]) => workerIds.has(String(workerId))),
  );
  const signedCount = Object.keys(filteredSignatures).length;
  const total = input.workers.length;
  const exactOriginalMode = input.details?.originalPdfMode === 'overlay';
  const nextStatus = exactOriginalMode
    ? (signedCount > 0 ? 'in_progress' : 'pending')
    : total > 0 && signedCount >= total
      ? 'completed'
      : signedCount > 0
        ? 'in_progress'
        : 'pending';

  if (exactOriginalMode) {
    await supabase.query('foreman_mandatory_pdf_files', {
      method: 'PATCH',
      prefer: 'return=minimal',
      query: `document_id=eq.${encodeURIComponent(input.id)}`,
      body: {
        signed_pdf: null,
        signed_sha256: null,
        fidelity: null,
        updated_at: new Date().toISOString(),
      },
    });
  }

  await supabase.query('foreman_mandatory_documents', {
    method: 'PATCH',
    prefer: 'return=minimal',
    query: `id=eq.${encodeURIComponent(input.id)}`,
    body: {
      work_date: input.workDate,
      category: input.category,
      workers: input.workers,
      signatures: filteredSignatures,
      status: nextStatus,
      completed_at: nextStatus === 'completed' ? new Date().toISOString() : null,
      reviewed_at: null,
      returned_at: null,
      correction_pending: false,
      correction_reason: null,
      correction_requested_at: null,
      updated_at: new Date().toISOString(),
    },
  });
}

export async function deleteForemanMandatoryDocument(id: string) {
  await supabase.query('foreman_mandatory_documents', {
    method: 'DELETE',
    prefer: 'return=minimal',
    query: `id=eq.${encodeURIComponent(id)}`,
  });
}
