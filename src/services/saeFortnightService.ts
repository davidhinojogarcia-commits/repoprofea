import { supabase } from '../lib/supabase';

export type SaeCodeState = {
  candidateId: string;
  automaticCode: string | null;
  sourceCode: string | null;
  sourceId: string | null;
  signature: string | null;
  pendingCode: string | null;
  manual: boolean;
  issue: string | null;
};

export async function syncSaeFortnightCodes(needId: string, decision?: {
  candidateId: string; signature: string; apply: boolean;
}): Promise<SaeCodeState[]> {
  return await supabase.rpc('sae_sync_fortnight_codes', {
    p_need_id: needId,
    ...(decision ? { p_candidate_id: decision.candidateId,
      p_signature: decision.signature, p_apply: decision.apply } : {}),
  });
}
