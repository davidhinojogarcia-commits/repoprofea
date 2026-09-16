import type { Person } from '../../types';
import { generateMedicalTicketsPDF } from './exportUtils';

let reservedWhatsAppWindow: Window | null = null;

export const reserveMedicalAppointmentWhatsAppWindow = (): boolean => {
  try {
    if (reservedWhatsAppWindow && !reservedWhatsAppWindow.closed) {
      reservedWhatsAppWindow.close();
    }
    // Must run synchronously from the user's tap. Safari/iOS may block a window
    // opened later after awaits, which was causing the PDF to open but not WhatsApp.
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
    if (reservedWhatsAppWindow && !reservedWhatsAppWindow.closed) {
      reservedWhatsAppWindow.close();
    }
  } catch {
    // Ignore browser-specific close errors.
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
    // Ignore browser-specific close errors.
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

export type MedicalConfirmationLinks = { confirm: string; decline: string };

export const buildMedicalAppointmentWhatsAppText = (person: Person, reminder = false, confirmationLinks?: MedicalConfirmationLinks): string => {
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
  if (observations) lines.push(`Observaciones: ${observations}`);
  lines.push('', 'Se adjunta la citación oficial con todos los datos e instrucciones para el reconocimiento médico.');
  if (confirmationLinks) {
    lines.push('', 'CONFIRMACIÓN DE ASISTENCIA');
    lines.push('Al confirmar mi asistencia, declaro haber recibido y leído la documentación adjunta, así como las instrucciones e indicaciones facilitadas para el proceso de contratación, quedando informado de su contenido.');
    lines.push('', `✅ Confirmar asistencia: ${confirmationLinks.confirm}`);
    lines.push(`❌ No puedo asistir: ${confirmationLinks.decline}`);
    lines.push('', 'La respuesta quedará registrada automáticamente en GestionProfea.');
  } else {
    lines.push('Por favor, confirma respondiendo CONFIRMO. Si no puedes asistir, responde NO PUEDO ASISTIR.');
  }
  return lines.join('\n');
};

const overlayWorkerIdentity = (doc: any, person: Person) => {
  try {
    doc.setPage(1);
    const namePlaceholder = '___________________________________________';
    const dniPlaceholder = '___________________________';
    const prefix = 'El trabajador ';
    const middle = ' con DNI ';
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);

    const startX = 18;
    const baselineY = 70;
    const nameX = startX + doc.getTextWidth(prefix);
    const nameW = doc.getTextWidth(namePlaceholder);
    const dniX = nameX + nameW + doc.getTextWidth(middle);
    const dniW = doc.getTextWidth(dniPlaceholder);

    doc.setFillColor(255, 255, 255);
    doc.rect(nameX - 0.5, baselineY - 3.5, nameW + 1, 4.5, 'F');
    doc.rect(dniX - 0.5, baselineY - 3.5, dniW + 1, 4.5, 'F');
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.text((person.apellidosNombre || '-').toUpperCase(), nameX, baselineY, { maxWidth: nameW });
    doc.text((person.dni || '-').toUpperCase(), dniX, baselineY, { maxWidth: dniW });
  } catch (error) {
    console.warn('No se pudo completar la identidad del trabajador en la citación PDF:', error);
  }
};

export const createMedicalAppointmentPdfFile = async (person: Person): Promise<File> => {
  const observations = String(person.observaciones || '').trim();
  const site = observations
    ? `${person.sitioReconocimiento || '-'}\nOBSERVACIONES / INDICACIONES PARTICULARES: ${observations}`
    : (person.sitioReconocimiento || '-');

  const { doc } = await generateMedicalTicketsPDF([
    {
      id: person.id,
      apellidosNombre: person.apellidosNombre,
      dni: person.dni,
      obra: person.obra,
      numOferta: person.numOferta,
      categoria: person.categoria,
      quincena: person.quincena,
      citaDia: person.citaDia,
      citaHora: person.citaHora,
      sitioReconocimiento: site,
      supervisorResponsable: person.supervisorResponsable,
      diaComienzo: person.periodoInicio,
      diaFinContrato: person.periodoFin,
      diaContratacion: person.fechaRegistro?.slice(0, 10),
    },
  ], {}, '08:00');

  overlayWorkerIdentity(doc, person);
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

export const shareMedicalAppointmentByWhatsApp = async (person: Person, reminder = false, confirmationLinks?: MedicalConfirmationLinks): Promise<'shared' | 'opened' | 'cancelled'> => {
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

  // Web Share is the only browser API that can send the PDF as a real WhatsApp
  // attachment. The reserved window remains available as a safe fallback for iOS.
  if (navigator.share && navigator.canShare?.({ files: [pdfFile] })) {
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
      console.warn('No se pudo compartir directamente la citación PDF; se usará la alternativa de WhatsApp.', error);
    }
  }

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
    window.location.href = whatsappUrl;
  }

  return 'opened';
};
