import { supabase } from '../lib/supabase';

export type SaeMonthlyMatch = {
  id: string; origin: 'sae' | 'directory'; candidateId: string | null;
  workerId: number | null; fullName: string; needId: string | null; reportId: string | null;
  workCode: string | null; workName: string | null; category: string | null;
  status: 'registered' | 'planned'; start: string | null; end: string | null;
  overlap: boolean | null; code: string | null;
};
export type SaeMonthlyState = {
  candidateId: string; month: number; year: number; matches: SaeMonthlyMatch[];
  ambiguous: boolean; locked: boolean; canApply: boolean; signature: string;
  currentCode: string | null; start: string | null; end: string | null;
};

export async function listSaeMonthlyMatches(needId: string): Promise<SaeMonthlyState[]> {
  return await supabase.rpc('list_sae_monthly_matches', { p_need_id: needId }, { fresh: true });
}

export async function applySaeMonthly2500(candidateId: string, signature: string): Promise<void> {
  await supabase.rpc('sae_apply_monthly_2500', { p_candidate_id: candidateId, p_signature: signature });
}
