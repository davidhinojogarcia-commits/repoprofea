import { supabase } from '../lib/supabase';

export type InspectionRole = 'inspector' | 'direccion_facultativa' | 'coordinador_seguridad';
export type InspectionSection = 'identity' | 'worksite' | 'employment' | 'prevention' | 'medical_conclusion';
export type InspectionGrant = {
  id: string;
  role: InspectionRole;
  email: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};
export type InspectionRead = {
  role: InspectionRole;
  expiresAt: string;
  sections: InspectionSection[];
  worker: {
    name?: string;
    category?: string;
    worksite?: string;
    periodStart?: string;
    periodEnd?: string;
    trainingRecord?: string;
    aptitudeConclusion?: string;
  };
  notice: string;
};

export async function issueInspectionAccess(input: {
  workerId: number;
  recipientEmail: string;
  role: InspectionRole;
  sections: InspectionSection[];
  durationMinutes: number;
  verificationNote: string;
}): Promise<string> {
  const result = await supabase.rpc('issue_inspection_access', {
    p_worker_id: input.workerId,
    p_recipient_email: input.recipientEmail,
    p_role: input.role,
    p_sections: input.sections,
    p_duration_minutes: input.durationMinutes,
    p_verification_note: input.verificationNote,
  });
  if (typeof result !== 'string' || !/^[a-f0-9-]{36}$/i.test(result)) throw new Error('La autorización no se ha confirmado.');
  return result;
}

export async function readInspectionAccess(id: string): Promise<InspectionRead> {
  const result = await supabase.rpc('read_inspection_access', { p_grant_id: id }, { fresh: true });
  if (!result?.worker || !Array.isArray(result.sections)) throw new Error('No se ha podido comprobar la autorización.');
  return result as InspectionRead;
}

export async function listInspectionAccess(workerId: number): Promise<InspectionGrant[]> {
  const result = await supabase.rpc('list_inspection_access', { p_worker_id: workerId }, { fresh: true });
  return Array.isArray(result) ? result as InspectionGrant[] : [];
}

export async function revokeInspectionAccess(id: string): Promise<boolean> {
  return (await supabase.rpc('revoke_inspection_access', { p_grant_id: id })) === true;
}

export function inspectionAccessUrl(id: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Código de acceso inválido');
  return new URL('/?inspection-access=' + encodeURIComponent(id), window.location.origin).toString();
}
