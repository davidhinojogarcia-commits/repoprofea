import { supabase } from '../lib/supabase';

export interface WorkerQrVisitSession { token: string; expiresAt: string }
export interface WorkerQrVisitGrant { id: string; recipient: string; expiresAt: string; redeemed: boolean }
export type WorkerQrVisitResult =
  | { status: 'visit_closed' | 'not_available' | 'card_expired' }
  | {
      status: 'ok';
      remainingMs: number;
      maskedDni: string;
      workerName?: string;
      professionalCategory?: string;
      worksite: string;
      periodStart: string;
      periodEnd: string;
      trainingRecord: string;
      aptitudeConclusion?: 'Apto' | 'Apto con limitación';
      workRestrictions?: string;
    };

export const workerQrVisitStorageKey = 'profea-worker-qr-visit';
export const isWorkerQrVisitCode = (value: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

export const workerQrVisitFragmentKey = 'qr-visit-access';

export function workerQrVisitUrl(cardUrl: string, code: string): string {
  const url = new URL(cardUrl);
  url.hash = new URLSearchParams({ [workerQrVisitFragmentKey]: code }).toString();
  return url.toString();
}

export function getWorkerQrVisitSession(): WorkerQrVisitSession | null {
  try {
    const session = JSON.parse(localStorage.getItem(workerQrVisitStorageKey) || 'null') as WorkerQrVisitSession | null;
    return session && isWorkerQrVisitCode(session.token) && Date.parse(session.expiresAt) > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function storeWorkerQrVisitSession(session: WorkerQrVisitSession | null) {
  try {
    if (session) localStorage.setItem(workerQrVisitStorageKey, JSON.stringify(session));
    else localStorage.removeItem(workerQrVisitStorageKey);
  } catch {
    // El navegador puede limitar el almacenamiento. La pestaña actual sigue funcionando.
  }
}

export async function redeemWorkerQrVisit(code: string): Promise<WorkerQrVisitSession | null> {
  return await supabase.rpc('redeem_worker_qr_visit', { p_code: code }) ?? null;
}

export async function readWorkerQrVisit(session: string, card: string): Promise<WorkerQrVisitResult> {
  return await supabase.rpc('read_worker_qr_visit', { p_session: session, p_card: card });
}

export async function closeWorkerQrVisit(session: string): Promise<void> {
  await supabase.rpc('close_worker_qr_visit', { p_session: session });
}

export async function issueWorkerQrVisit(workerId: number, recipient: string): Promise<{ id: string; code: string; expiresAt: string } | null> {
  return await supabase.rpc('issue_worker_qr_visit', { p_worker_id: workerId, p_recipient: recipient }) ?? null;
}

export async function listWorkerQrVisits(workerId: number): Promise<WorkerQrVisitGrant[]> {
  return await supabase.rpc('list_worker_qr_visits', { p_worker_id: workerId }, { fresh: true });
}

export async function revokeWorkerQrVisit(id: string): Promise<boolean> {
  return await supabase.rpc('revoke_worker_qr_visit', { p_id: id }) === true;
}

export async function saveWorkerQrRestrictions(workerId: number, restrictions: string): Promise<boolean> {
  return await supabase.rpc('save_worker_qr_restrictions', { p_worker_id: workerId, p_text: restrictions }) === true;
}

export async function getWorkerQrRestrictions(workerId: number): Promise<string | null> {
  return await supabase.rpc('get_worker_qr_restrictions', { p_worker_id: workerId }, { fresh: true }) ?? null;
}
