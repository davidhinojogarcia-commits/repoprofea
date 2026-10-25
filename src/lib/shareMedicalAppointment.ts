import { reportOperationalError } from './operationalLog';
import type { Person } from '../../types';
import { applyPdfCopyrightStamp, generateMedicalTicketsPDF } from './exportUtils';
import { loadAppBusinessSettings } from '../services/appSettingsService';
import { supabase } from '../lib/supabase';

let reservedWhatsAppWindow: Window | null = null;

export const reserveMedicalAppointmentWhatsAppWindow = (): boolean => {
  try {
    if (reservedWhatsAppWindow && !reservedWhatsAppWindow.closed) reservedWhatsAppWindow.close();
    reservedWhatsAppWindow = window.open('about:blank', '_blank');
    if (reservedWhatsAppWindow) reservedWhatsAppWindow.opener = null;
    return Boolean(reservedWhatsAppWindow);
  } catch {
    reservedWhatsAppWindow = null;
    return false;
  }
};

export const cancelReservedMedicalAppointmentWhatsAppWindow = () => {
  try {
    if (reservedWhatsAppWindow && !reservedWhatsAppWindow.closed) reservedWhatsAppWindow.close();
  } catch {
    // Ignorar errores específicos del navegador.
  } finally {
    reservedWhatsAppWindow = null;
  }
};

const consumeReservedWhatsAppWindow = (): Window | null => {
  const target = reservedWhatsAppWindow;
  reservedWhatsAppWindow = null;
  return target && !target.closed ? target : null;
};

const closeWindow = (target: Window | null) => {
  try {
    if (target && !target.closed) target.close();
  } catch {
    // Ignorar errores específicos del navegador.
  }
};

const normalizePhone = (value: string): string => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9) digits = `34${digits}`;
  return digits;
};

const formatDate = (value: string): string => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value || '-';
};

const needsPrl20h = (person: Person): boolean => {
  const value = String(person.formacion || '').trim().toLowerCase();
  return value === 'no' || value === 'sin formación' || value === 'sin formacion' || value === 'pendiente';
};

const getPrlSchedule = (person: Person) => ({
  date: String((person as any).fechaFormacionPrl || '').trim(),
  time: String((person as any).horaFormacionPrl || '').trim(),
  place: String(person.lugarFormacion || '').trim(),
});

const normalizeWorkToken = (value: unknown): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[._\-/:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const resolveAppointmentLocalidad = async (person: Person): Promise<string> => {
  try {
    const obraId = String((person as any).obraId || '').trim();
    if (obraId) {
      const rows = await supabase.query('obras', {
        query: `select=id,codigo,nombre,municipio&id=eq.${encodeURIComponent(obraId)}&limit=1`,
      });
      const municipio = String(rows?.[0]?.municipio || '').trim();
      if (municipio) return municipio;
    }

    const rows = await supabase.query('obras', { query: 'select=id,codigo,nombre,municipio' });
    const workerWork = normalizeWorkToken(person.obra);
    const workerCode = workerWork.match(/\b\d{4,6}\b/)?.[0] || '';
    const match = (rows || []).find((row: any) => {
      const code = normalizeWorkToken(row.codigo);
      const name = normalizeWorkToken(row.nombre);
      return (
        (workerCode && code && code.includes(workerCode)) ||
        (workerWork && name === workerWork) ||
        (workerWork && code === workerWork)
      );
    });
    const municipio = String(match?.municipio || '').trim();
    if (municipio) return municipio;
  } catch (error) {
    reportOperationalError('No se pudo resolver la localidad de la obra para la citación médica:', error, 'warn');
  }

  const fallback = String((person as any).municipio || (person as any).localidad || '').trim();
  return fallback || '-';
};

export type MedicalConfirmationLinks = { confirm: string; decline: string };

export const buildMedicalAppointmentWhatsAppText = (
  person: Person,
  reminder = false,
  confirmationLinks?: MedicalConfirmationLinks,
): string => {
  const observations = String(person.observaciones || '').trim();
  const lines = reminder
    ? [
        'RECORDATORIO DE RECONOCIMIENTO MÉDICO - PROFEA',
        `Hola ${person.apellidosNombre || 'trabajador/a'}.`,
        `Te recordamos tu reconocimiento médico del ${formatDate(person.citaDia)} a las ${person.citaHora || '-'} h.`,
        `Lugar: ${person.sitioReconocimiento || '-'}`,
        `Obra: ${person.obra || '-'}`,
      ]
    : [
        'CITA PARA RECONOCIMIENTO MÉDICO - PROFEA',
        `Hola ${person.apellidosNombre || 'trabajador/a'}.`,
        `Tienes programado tu reconocimiento médico el ${formatDate(person.citaDia)} a las ${person.citaHora || '-'} h.`,
        `Lugar: ${person.sitioReconocimiento || '-'}`,
        `Obra: ${person.obra || '-'}`,
      ];

  if (needsPrl20h(person)) {
    const prl = getPrlSchedule(person);
    lines.push('', 'FORMACIÓN PRL 20 HORAS - PENDIENTE');
    lines.push(`Día: ${formatDate(prl.date)}`);
    lines.push(`Hora: ${prl.time || '-'} h`);
    lines.push(`Lugar: ${prl.place || '-'}`);
  }

  if (observations) lines.push(`Observaciones: ${observations}`);
  lines.push('', 'A continuación recibirás tu citación oficial en PDF con todos los datos e instrucciones del reconocimiento médico.');
  lines.push('Lee el PDF completo antes de confirmar tu asistencia.');

  if (confirmationLinks) {
    lines.push('', 'CONFIRMACIÓN DE ASISTENCIA');
    lines.push('Después de recibir y leer el PDF, confirma tu asistencia. Al hacerlo declaras que has recibido y leído la documentación y las indicaciones facilitadas para el proceso de contratación.');
    lines.push('', `✅ Confirmar asistencia: ${confirmationLinks.confirm}`);
    lines.push(`❌ No puedo asistir: ${confirmationLinks.decline}`);
    lines.push('', 'La respuesta quedará registrada automáticamente en GestionProfea.');
  } else {
    lines.push('Por favor, confirma respondiendo CONFIRMO. Si no puedes asistir, responde NO PUEDO ASISTIR.');
  }
  return lines.join('\n');
};

const appendPrlTrainingSchedule = (doc: any, person: Person) => {
  if (!needsPrl20h(person)) return;
  const prl = getPrlSchedule(person);
  doc.addPage('a4', 'portrait');
  doc.setFillColor(0, 84, 142);
  doc.rect(0, 0, 210, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('CONVOCATORIA DE FORMACIÓN PRL 20 HORAS', 18, 12);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Documento complementario a la citación de reconocimiento médico · PROFEA', 18, 18);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text((person.apellidosNombre || '-').toUpperCase(), 18, 39);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`DNI/NIE: ${person.dni || '-'}`, 18, 45);
  doc.text(`Obra: ${person.obra || '-'}`, 18, 51);
  doc.text(`Categoría: ${person.categoria || '-'}`, 18, 57);

  doc.setFillColor(255, 247, 237);
  doc.setDrawColor(245, 158, 11);
  doc.roundedRect(18, 68, 174, 48, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(146, 64, 14);
  doc.text('FORMACIÓN PREVENTIVA PRL 20H PENDIENTE / NO ACREDITADA', 24, 78);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9);
  doc.text(`DÍA DE IMPARTICIÓN: ${formatDate(prl.date)}`, 24, 90);
  doc.text(`HORA: ${prl.time ? `${prl.time} h` : '-'}`, 24, 99);
  doc.text(`LUGAR: ${prl.place || '-'}`, 24, 108, { maxWidth: 158 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  const notice = 'El trabajador deberá acudir a la formación preventiva indicada en la fecha, hora y lugar señalados. Esta información procede directamente de los datos registrados en su ficha de contratación en GestionProfea.';
  doc.text(notice, 18, 130, { maxWidth: 174, align: 'justify' });

  doc.setDrawColor(0, 84, 142);
  doc.line(18, 274, 192, 274);
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('Diputación Provincial de Cádiz · Gestión de Fondos PROFEA', 18, 280);
  doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, 192, 280, { align: 'right' });
};

export const openMedicalAppointmentWhatsAppMessage = (
  person: Person,
  reminder = false,
  confirmationLinks?: MedicalConfirmationLinks,
): void => {
  const phone = normalizePhone(person.telefono || '');
  if (phone.length < 10) {
    cancelReservedMedicalAppointmentWhatsAppWindow();
    throw new Error('El trabajador no tiene un teléfono válido para WhatsApp.');
  }

  const text = buildMedicalAppointmentWhatsAppText(person, reminder, confirmationLinks);
  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  const whatsappWindow = consumeReservedWhatsAppWindow();

  if (whatsappWindow) {
    try {
      whatsappWindow.location.replace(whatsappUrl);
      return;
    } catch {
      try {
        whatsappWindow.location.href = whatsappUrl;
        return;
      } catch {}
    }
  }

  const opened = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  if (!opened) window.location.href = whatsappUrl;
};

export const createMedicalAppointmentPdfFile = async (person: Person): Promise<File> => {
  if (!person.citaDia || !person.citaHora || !person.sitioReconocimiento) {
    throw new Error('La cita debe tener fecha, hora y lugar antes de generar el PDF.');
  }

  if (needsPrl20h(person)) {
    const prl = getPrlSchedule(person);
    if (!prl.date || !prl.time || !prl.place) {
      throw new Error('El trabajador no tiene acreditada la PRL 20h. Antes de generar la citación debes indicar día, hora y lugar de impartición de la formación.');
    }
  }

  const site = person.sitioReconocimiento || '-';
  const localidad = await resolveAppointmentLocalidad(person);

  const settings = await loadAppBusinessSettings().catch(() => ({
    workStartHour: '08:00',
    workEndHour: '15:00',
  }));
  const { doc } = await generateMedicalTicketsPDF([
    {
      id: person.id,
      apellidosNombre: person.apellidosNombre,
      dni: person.dni,
      obra: person.obra,
      localidad,
      numOferta: person.numOferta,
      categoria: person.categoria,
      quincena: person.quincena,
      citaDia: person.citaDia,
      citaHora: person.citaHora,
      sitioReconocimiento: site,
      supervisorResponsable: person.supervisorResponsable,
      diaComienzo: person.periodoInicio,
      diaFinContrato: person.periodoFin,
      workStartHour: settings.workStartHour,
      workEndHour: settings.workEndHour,
      diaContratacion: person.fechaRegistro?.slice(0, 10),
    },
  ], {}, settings.workStartHour, settings.workEndHour);

  appendPrlTrainingSchedule(doc, person);
  // La citación base ya se sella en su generador. Si se añade la página PRL,
  // esta segunda pasada incorpora el mismo copyright a la nueva página.
  applyPdfCopyrightStamp(doc);
  const safeName = (person.apellidosNombre || 'trabajador').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]+/g, '_');
  const filename = `CITACION_RECONOCIMIENTO_${safeName}_${formatDate(person.citaDia).replace(/\//g, '-')}.pdf`;
  const blob = doc.output('blob');
  return new File([blob], filename, { type: 'application/pdf' });
};

const downloadPdfFile = (pdfFile: File) => {
  const url = URL.createObjectURL(pdfFile);
  const link = document.createElement('a');
  link.href = url;
  link.download = pdfFile.name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
};

export const downloadMedicalAppointmentPdf = async (person: Person): Promise<string> => {
  const file = await createMedicalAppointmentPdfFile(person);
  downloadPdfFile(file);
  return file.name;
};

const canNativeShareFiles = (file: File) => {
  try {
    return Boolean(navigator.share && navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
};

export const sharePreparedMedicalAppointmentPdf = async (
  person: Person,
  pdfFile: File,
): Promise<'shared' | 'downloaded' | 'cancelled'> => {
  if (canNativeShareFiles(pdfFile)) {
    try {
      await navigator.share({
        title: 'Citación para reconocimiento médico PROFEA',
        text: `PDF de citación para ${person.apellidosNombre || 'trabajador/a'} · WhatsApp ${person.telefono || '-'}`,
        files: [pdfFile],
      });
      return 'shared';
    } catch (error: any) {
      if (error?.name === 'AbortError') return 'cancelled';
      reportOperationalError('No se pudo abrir el sistema nativo de compartir; se descargará el PDF.', error, 'warn');
    }
  }

  downloadPdfFile(pdfFile);
  return 'downloaded';
};

export const shareMedicalAppointmentByWhatsApp = async (
  person: Person,
  reminder = false,
  confirmationLinks?: MedicalConfirmationLinks,
): Promise<'shared' | 'opened' | 'cancelled'> => {
  const phone = normalizePhone(person.telefono || '');
  if (phone.length < 10) {
    cancelReservedMedicalAppointmentWhatsAppWindow();
    throw new Error('El trabajador no tiene un teléfono válido para WhatsApp.');
  }

  const text = buildMedicalAppointmentWhatsAppText(person, reminder, confirmationLinks);
  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  const whatsappWindow = consumeReservedWhatsAppWindow();

  let pdfFile: File;
  try {
    pdfFile = await createMedicalAppointmentPdfFile(person);
  } catch (error) {
    closeWindow(whatsappWindow);
    throw error;
  }

  // En móvil/tablet, Web Share permite pasar el PDF real a WhatsApp como archivo.
  if (canNativeShareFiles(pdfFile)) {
    try {
      await navigator.share({
        title: reminder ? 'Recordatorio de reconocimiento médico' : 'Citación para reconocimiento médico',
        text,
        files: [pdfFile],
      });
      closeWindow(whatsappWindow);
      return 'shared';
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        closeWindow(whatsappWindow);
        return 'cancelled';
      }
      reportOperationalError('No se pudo compartir directamente la citación PDF; se usará la alternativa de WhatsApp Web.', error, 'warn');
    }
  }

  // WhatsApp Web no permite a una web externa precargar un archivo local mediante wa.me.
  // Por ello se descarga el PDF individual y se abre el chat correcto con el texto listo.
  downloadPdfFile(pdfFile);

  if (whatsappWindow) {
    try {
      whatsappWindow.location.replace(whatsappUrl);
    } catch {
      try {
        whatsappWindow.location.href = whatsappUrl;
      } catch {
        window.location.href = whatsappUrl;
      }
    }
  } else {
    const opened = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = whatsappUrl;
  }

  return 'opened';
};
