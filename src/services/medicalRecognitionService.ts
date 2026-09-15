import type { Person } from '../../types';
import { supabase } from '../lib/supabase';

const hasMedicalData = (person: Person) => Boolean(
  person.reconocimientoEstado ||
  person.reconocimientoFecha ||
  person.aptitudMedica ||
  person.reconocimientoValidez ||
  person.reconocimientoLimitaciones ||
  person.reconocimientoObservaciones
);

const dateOrNull = (value: unknown) => {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
};

export async function persistMedicalRecognition(person: Person): Promise<void> {
  if (!hasMedicalData(person)) return;

  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Debes iniciar sesión para guardar el reconocimiento médico.');

  const recognitionId = `${data.user.id}:${person.id}`;
  const workerRows = await supabase.query('trabajadores', {
    query: `select=obra_id& id=eq.${encodeURIComponent(String(person.id))}&limit=1`.replace('& ', '&'),
  });
  const obraId = (person as any).obraId || workerRows?.[0]?.obra_id || null;
  const payload = {
    id: recognitionId,
    owner_id: data.user.id,
    obra_id: obraId,
    trabajador_id: person.id,
    dni: person.dni || '',
    apellidos_nombre: person.apellidosNombre || '',
    resultado: person.reconocimientoEstado || person.aptitudMedica || 'Pendiente',
    limitaciones: person.reconocimientoLimitaciones || person.limitacionesAptitud || '',
    fecha_reconocimiento: dateOrNull(person.reconocimientoFecha),
    validez: person.reconocimientoValidez || '',
    centro_medico: person.sitioReconocimiento || '',
    observaciones: person.reconocimientoObservaciones || '',
    data: {
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
    },
    created_by: data.user.id,
    updated_by: data.user.id,
  };

  await supabase.query('reconocimientos', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: payload,
  });
}