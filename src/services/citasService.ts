import { createDocument, deleteDocument, getDocuments } from './databaseService';

export interface CitaRecord {
  id?: string;
  citaDia: string;
  citaHora: string;
  sitioReconocimiento: string;
  obra?: string;
  numOferta?: string;
  quincena?: string;
  supervisorResponsable?: string;
  telefonoSupervisor?: string;
  diaComienzo?: string;
  diaFinContrato?: string;
  diaContratacion?: string;
  ownerId?: string;
}

function newCitaId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `cita_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export async function listCitas(): Promise<CitaRecord[]> {
  return getDocuments<CitaRecord>('citas', { includeShared: true });
}

export async function saveCita(cita: CitaRecord): Promise<CitaRecord> {
  const id = cita.id || newCitaId();
  const persisted = { ...cita, id };
  await createDocument('citas', id, persisted);
  return persisted;
}

export async function saveCitas(citas: CitaRecord[]): Promise<CitaRecord[]> {
  const persisted = citas.map(cita => ({ ...cita, id: cita.id || newCitaId() }));
  await Promise.all(persisted.map(cita => createDocument('citas', cita.id!, cita)));
  return persisted;
}

export async function deleteCita(id: string): Promise<void> {
  await deleteDocument('citas', id);
}

export async function replaceCitas(previous: CitaRecord[], next: CitaRecord[]): Promise<CitaRecord[]> {
  const persisted = next.map(cita => ({ ...cita, id: cita.id || newCitaId() }));
  const nextIds = new Set(persisted.map(cita => cita.id));
  const removedIds = previous.map(cita => cita.id).filter((id): id is string => Boolean(id && !nextIds.has(id)));
  await Promise.all([
    ...persisted.map(cita => createDocument('citas', cita.id!, cita)),
    ...removedIds.map(deleteCita),
  ]);
  return persisted;
}
