import type { Person } from '../../types';

export interface WorkerMasterRecord {
  key: string;
  dni: string;
  apellidosNombre: string;
  fechaNacimiento: string;
  telefono: string;
  numeroSeguridadSocial: string;
  iban: string;
  calzado: string;
  ultimaContratacion: string;
  contratos: number;
  source: Person;
}

const clean = (value: unknown) => String(value || '').trim();
const cleanDni = (value: unknown) => clean(value).replace(/[\s-]/g, '').toUpperCase();
const cleanDigits = (value: unknown) => clean(value).replace(/\D/g, '');
const cleanIban = (value: unknown) => clean(value).replace(/\s/g, '').toUpperCase();

const recordDate = (person: Person): string =>
  clean(person.periodoInicio) || clean(person.fechaRegistro) || '';

export const buildWorkerMasterRecords = (people: Person[]): WorkerMasterRecord[] => {
  const groups = new Map<string, Person[]>();

  (people || []).forEach((person) => {
    const dni = cleanDni(person.dni);
    const fallback = [clean(person.apellidosNombre).toUpperCase(), clean(person.fechaNacimiento)].filter(Boolean).join('|');
    const key = dni || fallback || String(person.id);
    const group = groups.get(key) || [];
    group.push(person);
    groups.set(key, group);
  });

  return Array.from(groups.entries()).map(([key, contracts]) => {
    const ordered = [...contracts].sort((a, b) => recordDate(b).localeCompare(recordDate(a)));
    const latest = ordered[0];

    const firstNonEmpty = (selector: (person: Person) => unknown) => {
      for (const person of ordered) {
        const value = clean(selector(person));
        if (value) return value;
      }
      return '';
    };

    return {
      key,
      dni: firstNonEmpty(p => p.dni),
      apellidosNombre: firstNonEmpty(p => p.apellidosNombre),
      fechaNacimiento: firstNonEmpty(p => p.fechaNacimiento),
      telefono: firstNonEmpty(p => p.telefono),
      numeroSeguridadSocial: firstNonEmpty(p => p.numeroSeguridadSocial),
      iban: firstNonEmpty(p => p.iban),
      calzado: firstNonEmpty(p => p.calzado),
      ultimaContratacion: firstNonEmpty(p => p.periodoInicio || p.fechaRegistro),
      contratos: contracts.length,
      source: latest,
    };
  }).sort((a, b) => a.apellidosNombre.localeCompare(b.apellidosNombre, 'es'));
};

export const searchWorkerMasterRecords = (
  records: WorkerMasterRecord[],
  query: string,
  limit = 8,
): WorkerMasterRecord[] => {
  const raw = clean(query);
  if (raw.length < 2) return [];
  const text = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const digits = cleanDigits(raw);
  const iban = cleanIban(raw);

  return records
    .map((record) => {
      const haystack = [
        record.apellidosNombre,
        record.dni,
        record.fechaNacimiento,
        record.telefono,
        record.numeroSeguridadSocial,
        record.iban,
        record.calzado,
      ].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

      let score = 0;
      if (record.apellidosNombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().startsWith(text)) score += 50;
      if (cleanDni(record.dni).startsWith(cleanDni(raw))) score += 45;
      if (digits && cleanDigits(record.telefono).startsWith(digits)) score += 40;
      if (digits && cleanDigits(record.numeroSeguridadSocial).startsWith(digits)) score += 38;
      if (iban.length >= 4 && cleanIban(record.iban).startsWith(iban)) score += 36;
      if (haystack.includes(text)) score += 20;
      return { record, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.record.apellidosNombre.localeCompare(b.record.apellidosNombre, 'es'))
    .slice(0, limit)
    .map(item => item.record);
};

export const maskWorkerIban = (value: string): string => {
  const cleanValue = cleanIban(value);
  if (!cleanValue) return '-';
  return cleanValue.length > 8
    ? `${cleanValue.slice(0, 4)} •••• •••• •••• ${cleanValue.slice(-4)}`
    : cleanValue;
};

export const maskWorkerNuss = (value: string): string => {
  const digits = cleanDigits(value);
  if (!digits) return '-';
  return digits.length > 4 ? `••••••••${digits.slice(-4)}` : digits;
};
