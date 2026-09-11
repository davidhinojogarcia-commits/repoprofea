import type { Person } from '../../types';
import { supabase } from '../lib/supabase';
import { createDocument } from './databaseService';

const hasMedicalData = (person: Person) => Boolean(
  person.reconocimientoEstado ||
  person.reconocimientoFecha ||
  person.aptitudMedica ||
  person.reconocimientoValidez ||
  person.reconocimientoLimitaciones ||
  person.reconocimientoObservaciones
);

export async function persistMedicalRecognition(person: Person): Promise<void> {
  if (!hasMedicalData(person)) return;

  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Debes iniciar sesión para guardar el reconocimiento médico.');

  const recognitionId = `${data.user.id}:${person.id}`;
  await createDocument('reconocimientos', recognitionId, {
    trabajadorId: person.id,
    obra: person.obra || '',
    dni: person.dni || '',
    apellidosNombre: person.apellidosNombre || '',
    resultado: person.reconocimientoEstado || person.aptitudMedica || 'Pendiente',
    limitaciones: person.reconocimientoLimitaciones || person.limitacionesAptitud || '',
    fechaReconocimiento: person.reconocimientoFecha || '',
    validez: person.reconocimientoValidez || '',
    centroMedico: person.sitioReconocimiento || '',
    observaciones: person.reconocimientoObservaciones || '',
  });
}
