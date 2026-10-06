import { supabase } from '../lib/supabase';
import { validatePreventionDraft, type PreventionDraft, type PreventionRecord, type PreventionStatus } from '../lib/prevention';

export async function loadPreventionRecords(token?: string): Promise<{ records: PreventionRecord[]; truncated: boolean }> {
  const result = await supabase.rpc('list_prevention_records', { p_token: token || null });
  return { records: result.records || [], truncated: Boolean(result.truncated) };
}
export async function getPreventionRecordDetails(id: string, token?: string): Promise<{ photo: string | null; events: Array<{ id: number; actor: string; action: string; created_at: string; snapshot: PreventionRecord }> }> {
  return supabase.rpc('get_prevention_record_details', { p_id: id, p_token: token || null });
}
export async function createPreventionRecord(draft: PreventionDraft, id: string, token?: string): Promise<PreventionRecord> {
  validatePreventionDraft(draft);
  return supabase.rpc('save_prevention_record', { p_id: id, p_data: draft, p_token: token || null, p_expected_updated_at: null });
}
export async function followUpPreventionRecord(record: PreventionRecord, status: PreventionStatus, measures: string, responsible: string, deadline: string): Promise<PreventionRecord> {
  if (!responsible.trim()) throw new Error('Indica el responsable del seguimiento.');
  if (status === 'closed' && !measures.trim()) throw new Error('Registra las medidas adoptadas antes de cerrar.');
  return supabase.rpc('save_prevention_record', {
    p_id: record.id,
    p_data: { status, measures, responsible, deadline },
    p_token: null,
    p_expected_updated_at: record.updated_at,
  });
}
