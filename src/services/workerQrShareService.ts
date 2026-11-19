import { supabase } from '../lib/supabase';

export async function ensureWorkerQrShare(workerId: number): Promise<string> {
  const token = await supabase.rpc('ensure_worker_qr_share', { p_worker_id: workerId });
  const value = String(token || '').trim();
  if (!value) throw new Error('No se ha podido crear el acceso QR del trabajador.');
  return value;
}

export type WorkerCardReference = { id: number; ownerId: string };

export interface WorkerQrDetails {
  maskedDni?: string;
  worksite?: string;
  periodStart?: string;
  periodEnd?: string;
  contractStatus?: string;
  trainingRecord?: string;
  aptitudeConclusion?: string;
  expiresAt?: string;
}

export async function resolveWorkerQrShare(token: string): Promise<boolean> {
  const result = await supabase.rpc('resolve_worker_qr_share', { p_token: token }, { fresh: true });
  return result?.valid === true;
}

export async function readWorkerQrDetails(token: string): Promise<WorkerQrDetails | null> {
  return await supabase.rpc('read_worker_qr_details', { p_token: token }) ?? null;
}

export async function resolveWorkerCardReference(token: string): Promise<WorkerCardReference | null> {
  const result = await supabase.rpc('resolve_worker_card_reference', { p_token: token }, { fresh: true });
  const id = Number(result?.id);
  const ownerId = result?.ownerId;
  return Number.isSafeInteger(id) && id > 0 && typeof ownerId === 'string' && /^[a-f0-9-]{36}$/i.test(ownerId)
    ? { id, ownerId }
    : null;
}

export async function resolveWorkerCardOwner(token: string): Promise<number | null> {
  const result = await supabase.rpc('resolve_worker_card_owner', { p_token: token }, { fresh: true });
  const id = typeof result === 'number' ? result : Number(result);
  return result != null && Number.isSafeInteger(id) && id > 0 ? id : null;
}
