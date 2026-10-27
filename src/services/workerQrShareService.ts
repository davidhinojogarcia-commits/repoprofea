import type { Person } from '../../types';
import { supabase } from '../lib/supabase';

export async function ensureWorkerQrShare(workerId: number): Promise<string> {
  const token = await supabase.rpc('ensure_worker_qr_share', { p_worker_id: workerId });
  const value = String(token || '').trim();
  if (!value) throw new Error('No se ha podido crear el acceso QR del trabajador.');
  return value;
}

export async function resolveWorkerQrShare(token: string): Promise<Person[]> {
  const result = await supabase.rpc('resolve_worker_qr_share', { p_token: token });
  if (!result?.valid || !Array.isArray(result?.history)) return [];
  return result.history as Person[];
}

export async function resolveWorkerQrOccupational(token: string): Promise<Person[]> {
  const result = await supabase.rpc('resolve_worker_qr_occupational', { p_token: token });
  return result?.valid && Array.isArray(result.history) ? result.history as Person[] : [];
}

export async function resolveWorkerCardOwner(token: string): Promise<number | null> {
  const result = await supabase.rpc('resolve_worker_card_owner', { p_token: token });
  const id = typeof result === 'number' ? result : Number(result);
  return result != null && Number.isSafeInteger(id) && id > 0 ? id : null;
}
