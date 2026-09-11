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
