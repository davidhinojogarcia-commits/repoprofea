import type { Person } from '../../types';

export type DirectoryTrainingFilter = 'all' | 'trained' | 'pending';

const normalize = (value: string | undefined) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

// These are contract records, not dated course certificates. Missing/unknown
// training values must never be counted as completed training.
export const hasRecordedTraining = (person: Person): boolean => normalize(person.formacion) === 'si';

export function directoryContractYear(person: Person): string | null {
  const start = String(person.periodoInicio || '').trim().match(/^(\d{4})-/)?.[1];
  if (start) return start;
  const fortnight = String(person.quincena || '').match(/(?:^|\s)(20\d{2})(?:$|\s)/)?.[1];
  if (fortnight) return fortnight;
  // Legacy records without a contract year use their registration year.
  return String(person.fechaRegistro || '').trim().match(/^(\d{4})-/)?.[1] || null;
}

export function matchesDirectoryTraining(person: Person, training: DirectoryTrainingFilter, year: string): boolean {
  const contractYear = directoryContractYear(person);
  const matchesYear = year === 'all' || (year === 'unknown' ? contractYear === null : contractYear === year);
  const trained = hasRecordedTraining(person);
  return matchesYear && (training === 'all' || (training === 'trained' ? trained : !trained));
}
