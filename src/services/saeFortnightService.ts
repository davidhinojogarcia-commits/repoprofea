import { supabase } from '../lib/supabase';
import { listSaeMonthlyMatches, type SaeMonthlyState } from './saeMonthlyService';

export type SaeCodeState = {
  candidateId: string;
  automaticCode: string | null;
  sourceCode: string | null;
  sourceId: string | null;
  signature: string | null;
  pendingCode: string | null;
  manual: boolean;
  issue: string | null;
  monthly?: SaeMonthlyState;
};

export async function syncSaeFortnightCodes(needId: string, decision?: {
  candidateId: string; signature: string; apply: boolean;
}): Promise<SaeCodeState[]> {
  const states: SaeCodeState[] = await supabase.rpc('sae_sync_fortnight_codes', {
    p_need_id: needId,
    ...(decision ? { p_candidate_id: decision.candidateId,
      p_signature: decision.signature, p_apply: decision.apply } : {}),
  });
  const monthly = await listSaeMonthlyMatches(needId);
  const combined = new Map(states.map(state => [state.candidateId, state]));
  for (const item of monthly) combined.set(item.candidateId, {
    candidateId: item.candidateId, automaticCode: null, sourceCode: null, sourceId: null,
    signature: null, pendingCode: null, manual: true, issue: null,
    ...combined.get(item.candidateId), monthly: item,
  });
  return [...combined.values()];
}
