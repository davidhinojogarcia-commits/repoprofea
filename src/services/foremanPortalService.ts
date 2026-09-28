import type { Person } from '../../types';
import { supabase } from '../lib/supabase';

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
};

export type ForemanMandatoryDocument = {
  id: string;
  workDate: string;
  periodKey: string;
  documentType: 'inicio' | 'control_presencia' | 'epis' | 'maquinaria' | 'autorizacion_uso_maquinaria';
  category: string;
  workers: Person[];
  signatures: Record<string, { signature: string; signedAt?: string } | string>;
  status: 'pending' | 'in_progress' | 'completed' | 'reviewed';
  completedAt?: string | null;
  details?: Record<string, any>;
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
};

export type ForemanPortalPayload = {
  valid: boolean;
  obra: string;
  foremanName: string;
  defaultWorkStartHour: string;
  defaultWorkEndHour: string;
  workers: Person[];
  attendance: ForemanAttendanceDay[];
  documents: ForemanCompletedDocument[];
  mandatoryDocuments: ForemanMandatoryDocument[];
};

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
  const result = await supabase.rpc('resolve_foreman_portal', { p_token: token });
  return {
    valid: Boolean(result?.valid),
    obra: String(result?.obra || ''),
    foremanName: String(result?.foremanName || ''),
    defaultWorkStartHour: String(result?.defaultWorkStartHour || '08:00'),
    defaultWorkEndHour: String(result?.defaultWorkEndHour || '15:00'),
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
  return supabase.rpc('save_foreman_attendance', {
    p_token: token,
    p_work_date: workDate,
    p_rows: rows,
    p_status: status,
  });
}

export async function submitForemanDocument(input: {
  token: string;
  documentType: string;
  workDate: string;
  workerId?: number | null;
  answers: Record<string, string>;
  signatures: Record<string, string>;
}) {
  return supabase.rpc('submit_foreman_document', {
    p_token: input.token,
    p_document_type: input.documentType,
    p_work_date: input.workDate,
    p_worker_id: input.workerId ?? null,
    p_answers: input.answers,
    p_signatures: input.signatures,
  });
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
  return supabase.rpc('sign_foreman_mandatory_document', {
    p_token: token,
    p_document_id: documentId,
    p_worker_id: workerId,
    p_signature: signature,
  });
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
}) {
  return supabase.rpc('prepare_foreman_mandatory_from_email', {
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
}

export async function markMandatoryDocumentReturned(id: string, gmailMessageId: string) {
  await supabase.rpc('mark_foreman_mandatory_returned', {
    p_id: id,
    p_gmail_message_id: gmailMessageId,
  });
}


export async function finalizeForemanMandatoryDocument(token: string, documentId: string) {
  return supabase.rpc('finalize_foreman_mandatory_document', {
    p_token: token,
    p_document_id: documentId,
  });
}


export async function createForemanOperationalDocument(input: {
  token: string;
  documentType: 'epis' | 'maquinaria' | 'autorizacion_uso_maquinaria';
  workDate: string;
  workerIds: number[];
  details?: Record<string, any>;
}) {
  return supabase.rpc('create_foreman_operational_document', {
    p_token: input.token,
    p_document_type: input.documentType,
    p_work_date: input.workDate,
    p_worker_ids: input.workerIds,
    p_details: input.details || {},
  });
}
