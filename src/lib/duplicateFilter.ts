import { Person } from '../../types';

export interface DuplicateMatch {
  workerName: string;
  workerDni: string;
  quincena: string;
  periodo: string;
  obra: string;
  matchedWith: string; // "Ya registrado en el sistema" or "Repetido en este mismo archivo"
  reason: string;
}

export function cleanDni(dni: string | undefined): string {
  if (!dni) return '';
  return dni.trim().toUpperCase().replace(/[\s-]/g, '');
}

export function cleanName(name: string | undefined): string {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function cleanQuincena(q: string | undefined): string {
  if (!q) return '';
  return q.trim().toLowerCase();
}

/**
 * Checks if two workers represent the same person in the same quincena or period.
 */
export function isSamePersonSamePeriod(
  a: Partial<Person>,
  b: Partial<Person>
): { isDuplicate: boolean; reason: string } {
  const dniA = cleanDni(a.dni);
  const dniB = cleanDni(b.dni);
  const nameA = cleanName(a.apellidosNombre);
  const nameB = cleanName(b.apellidosNombre);

  // 1. Same Person Check (matching DNI or matching full name)
  const isSamePerson = (dniA && dniB && dniA === dniB) || (nameA && nameB && nameA === nameB);

  if (!isSamePerson) {
    return { isDuplicate: false, reason: '' };
  }

  // 2. Same Period / Quincena Check
  const qA = cleanQuincena(a.quincena);
  const qB = cleanQuincena(b.quincena);
  const startA = a.periodoInicio ? a.periodoInicio.trim() : '';
  const startB = b.periodoInicio ? b.periodoInicio.trim() : '';
  const endA = a.periodoFin ? a.periodoFin.trim() : '';
  const endB = b.periodoFin ? b.periodoFin.trim() : '';

  // Check quincena match
  const sameQuincena = qA && qB && qA === qB;

  // Check period date match
  const samePeriod = (startA && startB && startA === startB) || (endA && endB && endA === endB);

  // If period or quincena match, OR if both lack quincena/dates (same default period)
  if (sameQuincena || samePeriod || (!qA && !qB && !startA && !startB)) {
    let reasonText = `Misma persona (${a.apellidosNombre || a.dni})`;
    if (sameQuincena) {
      reasonText += ` en la misma quincena (${a.quincena})`;
    } else if (samePeriod) {
      reasonText += ` en el mismo periodo (${startA || endA})`;
    } else {
      reasonText += ` repetido en el mismo registro`;
    }
    return { isDuplicate: true, reason: reasonText };
  }

  return { isDuplicate: false, reason: '' };
}

/**
 * Detects duplicate workers in an incoming list against existing database records and within the batch.
 */
export function detectImportDuplicates(
  incomingWorkers: Omit<Person, 'id' | 'fechaRegistro'>[],
  existingPeople: Person[]
): {
  uniqueWorkers: Omit<Person, 'id' | 'fechaRegistro'>[];
  duplicates: DuplicateMatch[];
} {
  const uniqueWorkers: Omit<Person, 'id' | 'fechaRegistro'>[] = [];
  const duplicates: DuplicateMatch[] = [];

  for (const incoming of incomingWorkers) {
    let matchFound = false;

    // Check against existing database workers
    for (const existing of existingPeople) {
      const { isDuplicate, reason } = isSamePersonSamePeriod(incoming, existing);
      if (isDuplicate) {
        matchFound = true;
        duplicates.push({
          workerName: incoming.apellidosNombre || 'Sin nombre',
          workerDni: incoming.dni || 'Sin DNI',
          quincena: incoming.quincena || 'No especificada',
          periodo: incoming.periodoInicio ? `${incoming.periodoInicio} - ${incoming.periodoFin || ''}` : 'No especificado',
          obra: incoming.obra || 'Sin obra',
          matchedWith: 'Ya registrado en el sistema',
          reason
        });
        break;
      }
    }

    if (!matchFound) {
      // Check against workers already accepted in this same batch
      for (const accepted of uniqueWorkers) {
        const { isDuplicate, reason } = isSamePersonSamePeriod(incoming, accepted);
        if (isDuplicate) {
          matchFound = true;
          duplicates.push({
            workerName: incoming.apellidosNombre || 'Sin nombre',
            workerDni: incoming.dni || 'Sin DNI',
            quincena: incoming.quincena || 'No especificada',
            periodo: incoming.periodoInicio ? `${incoming.periodoInicio} - ${incoming.periodoFin || ''}` : 'No especificado',
            obra: incoming.obra || 'Sin obra',
            matchedWith: 'Repetido en este mismo lote',
            reason
          });
          break;
        }
      }
    }

    if (!matchFound) {
      uniqueWorkers.push(incoming);
    }
  }

  return { uniqueWorkers, duplicates };
}
