import type { Person } from '../../types';

const normalize = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

export const relationPeriodRank = (person: Person) => {
  const value = normalize(person.quincena);
  if (/^(1|1A|1ª|PRIMERA)\b/.test(value) || /PRIMERA\s+QUINCENA/.test(value)) return 0;
  if (/^(2|2A|2ª|SEGUNDA)\b/.test(value) || /SEGUNDA\s+QUINCENA/.test(value)) return 1;
  if (/\bMES\b|MENSUAL|MES COMPLETO/.test(value)) return 2;
  return 3;
};

const dateKey = (person: Person) => {
  const raw = String(person.periodoInicio || person.fechaRegistro || '').slice(0, 10);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
};

const cleanWork = (person: Person) => String(person.obra || '').trim() || 'SIN OBRA';

export const compareRelationWorkers = (a: Person, b: Person) =>
  relationPeriodRank(a) - relationPeriodRank(b) ||
  dateKey(a) - dateKey(b) ||
  String(a.quincena || '').localeCompare(String(b.quincena || ''), 'es', { sensitivity: 'base', numeric: true }) ||
  String(a.apellidosNombre || '').localeCompare(String(b.apellidosNombre || ''), 'es', { sensitivity: 'base' }) ||
  Number(a.id || 0) - Number(b.id || 0);

export const sortRelationWorkers = (people: Person[]) =>
  [...people].sort(compareRelationWorkers);

export const splitRelationWorkersByWork = (people: Person[]) => {
  const groups = new Map<string, Person[]>();
  for (const person of people) {
    const work = cleanWork(person);
    if (!groups.has(work)) groups.set(work, []);
    groups.get(work)!.push(person);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true }))
    .map(([obra, workers]) => ({
      obra,
      workers: sortRelationWorkers(workers),
    }));
};
