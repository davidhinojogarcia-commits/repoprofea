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
  workers: Person[];
  attendance: ForemanAttendanceDay[];
  documents: ForemanCompletedDocument[];
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
    workers: Array.isArray(result?.workers) ? result.workers : [],
    attendance: Array.isArray(result?.attendance) ? result.attendance : [],
    documents: Array.isArray(result?.documents) ? result.documents : [],
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
