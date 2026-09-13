import { supabase } from '../lib/supabase';

const dateOnly = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || null;
};

const timeOnly = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{2}:\d{2})/);
  return match?.[1] || null;
};

export async function syncMedicalAppointmentFromWorker(worker: Record<string, any>, workerId: string | number, userId: string) {
  const appointmentId = `medical-${String(workerId)}`;
  const citaDia = dateOnly(worker.citaDia);
  const citaHora = timeOnly(worker.citaHora);
  const site = String(worker.sitioReconocimiento || '').trim();
  const needsMedical = worker.necesitaReconocimiento === 'Sí';

  if (!needsMedical || !citaDia || !citaHora || !site) {
    await supabase.query('citas', {
      method: 'DELETE',
      prefer: 'return=minimal',
      query: `id=eq.${encodeURIComponent(appointmentId)}`,
    }).catch(() => undefined);
    return;
  }

  const observations = String(worker.observaciones || '').trim();
  const siteForDocument = observations ? `${site}\nOBSERVACIONES: ${observations}` : site;
  const reminderDate = new Date(`${citaDia}T12:00:00`);
  reminderDate.setDate(reminderDate.getDate() - 1);

  const data = {
    id: appointmentId,
    trabajadorId: Number(workerId),
    apellidosNombre: worker.apellidosNombre || '',
    dni: worker.dni || '',
    telefonoTrabajador: worker.telefono || '',
    categoria: worker.categoria || '',
    citaDia,
    citaHora,
    sitioReconocimiento: siteForDocument,
    sitioReconocimientoOriginal: site,
    citaObservaciones: observations,
    obra: worker.obra || '',
    numOferta: worker.numOferta || '',
    quincena: worker.quincena || '',
    supervisorResponsable: worker.supervisorResponsable || '',
    diaComienzo: worker.periodoInicio || '',
    diaFinContrato: worker.periodoFin || '',
    diaContratacion: dateOnly(worker.fechaRegistro) || new Date().toISOString().slice(0, 10),
    estado: 'Programada',
    recordatorioDiaAnterior: true,
    recordatorioDia: reminderDate.toISOString().slice(0, 10),
    recordatorioEstado: 'pendiente',
    creadoDesdeContratacion: true,
  };

  await supabase.query('citas', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      id: appointmentId,
      owner_id: userId,
      obra_id: worker.obraId || worker.obra_id || null,
      trabajador_id: Number(workerId),
      cita_dia: citaDia,
      cita_hora: citaHora,
      sitio_reconocimiento: site,
      num_oferta: worker.numOferta || '',
      quincena: worker.quincena || '',
      supervisor_responsable: worker.supervisorResponsable || '',
      telefono_supervisor: '',
      dia_comienzo: dateOnly(worker.periodoInicio),
      dia_fin_contrato: dateOnly(worker.periodoFin),
      dia_contratacion: dateOnly(worker.fechaRegistro) || new Date().toISOString().slice(0, 10),
      data,
      created_by: userId,
      updated_by: userId,
    },
  });
}
