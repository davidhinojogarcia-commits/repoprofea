import type { Person } from '../../types';
import { supabase } from '../lib/supabase';

export async function importWorkersAtomic(workers: Person[]): Promise<number> {
  if (!Array.isArray(workers) || workers.length === 0) return 0;
  const imported = await supabase.rpc('import_workers_atomic', { p_workers: workers });
  const count = Number(imported);
  if (!Number.isFinite(count) || count !== workers.length) {
    throw new Error(`Supabase confirmó ${Number.isFinite(count) ? count : 0} de ${workers.length} trabajadores importados.`);
  }
  return count;
}

export async function moveWorkersToTrashBulk(ids: number[]): Promise<number> {
  const uniqueIds = Array.from(new Set(ids.filter(id => Number.isFinite(id) && id > 0)));
  if (uniqueIds.length === 0) return 0;
  const moved = await supabase.rpc('bulk_move_trabajadores_to_trash', { p_ids: uniqueIds });
  const count = Number(moved);
  if (!Number.isFinite(count) || count !== uniqueIds.length) {
    throw new Error(`Supabase movió ${Number.isFinite(count) ? count : 0} de ${uniqueIds.length} trabajadores a la papelera.`);
  }
  return count;
}
