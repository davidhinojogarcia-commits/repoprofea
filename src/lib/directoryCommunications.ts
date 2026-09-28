import type { Person } from '../../types';
import {
  preparePDFData,
  prepareRRMMPDFData,
  prepareCalzadoPDFData,
  preparePRLPDFData,
} from './exportUtils';
import { prepareAdministrativeRelationPDF } from './administrativeRelationExport';
import { loadAppBusinessSettings } from '../services/appSettingsService';
import { getStoredObrasRecursosPreventivos } from './subcontratasDefaults';
import { getGmailConnectionStatus, sendPdfWithConnectedGmail } from './gmailConnection';

export type DirectoryCommunicationKind =
  | 'encargados'
  | 'administrative'
  | 'medical'
  | 'footwear'
  | 'training';

type PreparedCommunication = {
  file: File;
  recipientName: string;
  recipientEmail?: string;
  recipientPhone?: string;
  subject: string;
  body: string;
};

const normalizePhone = (value: string) => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9) digits = `34${digits}`;
  return digits;
};

const downloadFile = (file: File) => {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
};

const toPdfFile = (doc: any, filename: string) =>
  new File([doc.output('blob')], filename, { type: 'application/pdf' });

const uniqueText = (values: string[]) =>
  Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean))).join(', ');

const buildContext = (data: Person[]) => ({
  obras: uniqueText(data.map(person => person.obra)),
  periodos: uniqueText(data.map(person => person.quincena)),
  supervisor: data[0]?.supervisorResponsable || 'Supervisor PROFEA',
});

const preparePdf = (
  kind: DirectoryCommunicationKind,
  data: Person[],
  allPeople?: Person[],
) => {
  if (kind === 'administrative') return prepareAdministrativeRelationPDF(data);
  if (kind === 'medical') return prepareRRMMPDFData(data);
  if (kind === 'footwear') return prepareCalzadoPDFData(data);
  if (kind === 'training') {
    const pendingTraining = data.filter(person => {
      const value = String(person.formacion || '').trim().toLowerCase();
      return value === 'no' || value === 'pendiente' || value.includes('sin form');
    });
    if (!pendingTraining.length) {
      throw new Error('No hay trabajadores sin formación dentro de los filtros actuales.');
    }
    return preparePRLPDFData(pendingTraining);
  }
  return preparePDFData(data, allPeople || data);
};

const prepareCommunication = async (
  kind: DirectoryCommunicationKind,
  data: Person[],
  allPeople?: Person[],
): Promise<PreparedCommunication> => {
  if (!data.length) throw new Error('No hay trabajadores dentro de los filtros actuales para enviar.');

  const settings = await loadAppBusinessSettings();
  const context = buildContext(data);
  const prepared = preparePdf(kind, data, allPeople);
  const file = toPdfFile(prepared.doc, prepared.filename);

  if (kind === 'encargados') {
    const works = Array.from(new Set(data.map(person => person.obra).filter(Boolean)));
    if (works.length !== 1) {
      throw new Error('Para enviar por WhatsApp al encargado, selecciona una sola obra.');
    }
    const work = works[0];
    const resource = getStoredObrasRecursosPreventivos()[work];
    const phone = normalizePhone(resource?.recursoPreventivoTelefono || '');
    if (!resource?.recursoPreventivoNombre?.trim()) {
      throw new Error('La obra seleccionada no tiene configurado el recurso preventivo/encargado.');
    }
    if (phone.length < 10) {
      throw new Error('Falta el teléfono del recurso preventivo/encargado en Configuración → Obras.');
    }
    return {
      file,
      recipientName: resource.recursoPreventivoNombre,
      recipientPhone: phone,
      subject: `Relación de trabajadores · ${work}`,
      body: [
        `Hola ${resource.recursoPreventivoNombre}.`,
        '',
        `Te envío la relación de trabajadores de la obra ${work}.`,
        context.periodos ? `Periodo: ${context.periodos}.` : '',
        '',
        `Un saludo,\n${context.supervisor}`,
      ].filter(Boolean).join('\n'),
    };
  }

  const recipient =
    kind === 'administrative' ? settings.administrative :
    kind === 'medical' ? settings.medicalProvider :
    kind === 'footwear' ? settings.footwearProvider :
    settings.trainingProvider;

  const email = String(recipient?.email || '').trim();
  const recipientName = String(recipient?.nombreApellidos || '').trim();
  if (!recipientName) {
    const labels: Record<Exclude<DirectoryCommunicationKind, 'encargados'>, string> = {
      administrative: 'administrativo/a',
      medical: 'responsable de reconocimientos médicos',
      footwear: 'responsable del proveedor de calzado',
      training: 'responsable de la empresa de formación',
    };
    throw new Error(`Falta configurar el contacto ${labels[kind as Exclude<DirectoryCommunicationKind, 'encargados'>]}.`);
  }
  if (!email) {
    throw new Error('Falta el correo electrónico del destinatario en Configuración.');
  }

  const subjects: Record<Exclude<DirectoryCommunicationKind, 'encargados'>, string> = {
    administrative: 'Relación administrativa de trabajadores',
    medical: 'Relación de citas de reconocimientos médicos',
    footwear: 'Relación de calzado de trabajadores',
    training: 'Relación de trabajadores para formación PRL',
  };
  const labels: Record<Exclude<DirectoryCommunicationKind, 'encargados'>, string> = {
    administrative: 'la relación administrativa de trabajadores',
    medical: 'la relación de citas de reconocimientos médicos',
    footwear: 'la relación de calzado',
    training: 'la relación de trabajadores para formación',
  };
  const typedKind = kind as Exclude<DirectoryCommunicationKind, 'encargados'>;

  return {
    file,
    recipientName,
    recipientEmail: email,
    subject: `${subjects[typedKind]}${context.obras ? ` · ${context.obras}` : ''}`,
    body: [
      `Hola ${recipientName}.`,
      '',
      `Te envío adjunto el PDF con ${labels[typedKind]}.`,
      context.obras ? `Obra(s): ${context.obras}.` : '',
      context.periodos ? `Periodo(s): ${context.periodos}.` : '',
      '',
      `Un saludo,\n${context.supervisor}`,
    ].filter(Boolean).join('\n'),
  };
};

const canShareFile = (file: File) => {
  try {
    return Boolean(navigator.share && navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
};

export const sendDirectoryCommunication = async (
  kind: DirectoryCommunicationKind,
  data: Person[],
  allPeople?: Person[],
): Promise<'sent' | 'shared' | 'opened' | 'cancelled'> => {
  const prepared = await prepareCommunication(kind, data, allPeople);

  if (kind === 'encargados') {
    if (canShareFile(prepared.file)) {
      try {
        await navigator.share({
          title: prepared.subject,
          text: `${prepared.body}\n\nDestinatario configurado: ${prepared.recipientName} · ${prepared.recipientPhone}`,
          files: [prepared.file],
        });
        return 'shared';
      } catch (error: any) {
        if (error?.name === 'AbortError') return 'cancelled';
        console.warn('[directory-communications] Compartir nativo falló:', error);
      }
    }

    downloadFile(prepared.file);
    const url = `https://wa.me/${prepared.recipientPhone}?text=${encodeURIComponent(
      `${prepared.body}\n\nEl PDF se ha descargado para adjuntarlo a este chat.`,
    )}`;
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = url;
    window.alert(`Se ha descargado ${prepared.file.name}. Adjunta ese PDF al chat de ${prepared.recipientName}.`);
    return 'opened';
  }

  // Si el supervisor ha autorizado Gmail, el botón Mail envía directamente
  // desde su cuenta institucional con el PDF adjunto.
  try {
    const gmail = await getGmailConnectionStatus();
    if (gmail.connected) {
      const confirmed = window.confirm(
        `Enviar “${prepared.subject}” desde ${gmail.email} a ${prepared.recipientEmail} con el PDF adjunto?`,
      );
      if (!confirmed) return 'cancelled';
      await sendPdfWithConnectedGmail({
        to: prepared.recipientEmail || '',
        subject: prepared.subject,
        body: prepared.body,
        file: prepared.file,
      });
      window.alert(`Correo enviado correctamente desde ${gmail.email} a ${prepared.recipientEmail}.`);
      return 'sent';
    }
  } catch (error: any) {
    console.warn('[directory-communications] No se pudo usar el envío Gmail directo:', error);
    if (error?.code !== 'GMAIL_NOT_CONNECTED') {
      window.alert(error?.message || 'No se pudo enviar mediante Gmail. Se usará el método alternativo.');
    }
  }

  // Compatibilidad: si Gmail aún no está conectado, conserva el flujo anterior.
  if (canShareFile(prepared.file)) {
    try {
      await navigator.share({
        title: prepared.subject,
        text: prepared.body,
        files: [prepared.file],
      });
      return 'shared';
    } catch (error: any) {
      if (error?.name === 'AbortError') return 'cancelled';
      console.warn('[directory-communications] Compartir nativo falló:', error);
    }
  }

  downloadFile(prepared.file);
  const gmailUrl =
    `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(prepared.recipientEmail || '')}` +
    `&su=${encodeURIComponent(prepared.subject)}&body=${encodeURIComponent(
      `${prepared.body}\n\nAdjunta el PDF descargado: ${prepared.file.name}`,
    )}`;
  window.open(gmailUrl, '_blank', 'noopener,noreferrer');
  window.alert(
    `Se ha descargado ${prepared.file.name} y se ha preparado el correo para ${prepared.recipientName} (${prepared.recipientEmail}). Adjunta el PDF descargado antes de enviar.`,
  );
  return 'opened';
};
