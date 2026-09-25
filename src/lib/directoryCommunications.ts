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

export type DirectoryCommunicationKind =
  | 'encargados'
  | 'administrative'
  | 'medical'
  | 'footwear'
  | 'training';

const cleanPhone = (value: string) => {
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

const distinct = (values: string[]) =>
  Array.from(new Set(values.map(v => String(v || '').trim()).filter(Boolean)));

const summarizeScope = (people: Person[]) => {
  const obras = distinct(people.map(p => p.obra));
  const periodos = distinct(people.map(p => p.quincena));
  return {
    obras,
    periodos,
    obrasText: obras.length ? obras.join(', ') : 'obra seleccionada',
    periodosText: periodos.length ? periodos.join(', ') : 'periodo seleccionado',
  };
};

const buildPdf = (kind: DirectoryCommunicationKind, people: Person[]) => {
  if (!people.length) throw new Error('No hay trabajadores dentro de los filtros actuales.');
  if (kind === 'encargados') return preparePDFData(people);
  if (kind === 'administrative') return prepareAdministrativeRelationPDF(people);
  if (kind === 'medical') return prepareRRMMPDFData(people);
  if (kind === 'footwear') return prepareCalzadoPDFData(people);
  return preparePRLPDFData(people);
};

const toFile = (kind: DirectoryCommunicationKind, people: Person[]) => {
  const { doc, filename } = buildPdf(kind, people);
  const blob = doc.output('blob');
  return new File([blob], filename, { type: 'application/pdf' });
};

const emailMeta = async (kind: Exclude<DirectoryCommunicationKind, 'encargados'>, people: Person[]) => {
  const settings = await loadAppBusinessSettings();
  const scope = summarizeScope(people);

  if (kind === 'administrative') {
    return {
      email: settings.administrative.email,
      contact: settings.administrative.nombreApellidos || 'Administración',
      subject: `Relación administrativa de trabajadores · ${scope.obrasText}`,
      body: `Hola ${settings.administrative.nombreApellidos || ''},\n\nAdjunto la relación administrativa de trabajadores correspondiente a ${scope.obrasText} · ${scope.periodosText}.\n\nUn saludo.`,
    };
  }
  if (kind === 'medical') {
    return {
      email: settings.medicalCompany.email,
      contact: settings.medicalCompany.nombreApellidos || settings.medicalCompany.empresa || 'Responsable de reconocimientos médicos',
      subject: `Relación de citas de reconocimientos médicos · ${scope.obrasText}`,
      body: `Hola ${settings.medicalCompany.nombreApellidos || ''},\n\nAdjunto la relación de citas de reconocimientos médicos correspondiente a ${scope.obrasText} · ${scope.periodosText}.\n\nUn saludo.`,
    };
  }
  if (kind === 'footwear') {
    return {
      email: settings.footwearProvider.email,
      contact: settings.footwearProvider.nombreApellidos || settings.footwearProvider.empresa || 'Proveedor de calzado',
      subject: `Relación de calzado · ${scope.obrasText}`,
      body: `Hola ${settings.footwearProvider.nombreApellidos || ''},\n\nAdjunto el resumen de calzado correspondiente a ${scope.obrasText} · ${scope.periodosText}.\n\nUn saludo.`,
    };
  }
  return {
    email: settings.trainingCompany.email,
    contact: settings.trainingCompany.nombreApellidos || settings.trainingCompany.empresa || 'Responsable de formación',
    subject: `Relación de formación PRL · ${scope.obrasText}`,
    body: `Hola ${settings.trainingCompany.nombreApellidos || ''},\n\nAdjunto la relación de formación PRL correspondiente a ${scope.obrasText} · ${scope.periodosText}.\n\nUn saludo.`,
  };
};

export const sendDirectoryPdfByEmail = async (
  kind: Exclude<DirectoryCommunicationKind, 'encargados'>,
  people: Person[],
): Promise<'shared' | 'prepared'> => {
  const meta = await emailMeta(kind, people);
  const email = String(meta.email || '').trim();
  if (!email) {
    throw new Error(`No hay correo configurado para ${meta.contact}. Revíselo en Configuración.`);
  }

  const file = toFile(kind, people);

  // En móvil/tablet, el sistema de compartir puede adjuntar el PDF real a la app de correo.
  // El destinatario configurado se incluye en el texto porque Web Share no permite fijar
  // de forma estándar el campo "Para".
  try {
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: meta.subject,
        text: `Destinatario: ${email}\n\n${meta.body}`,
        files: [file],
      });
      return 'shared';
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') return 'prepared';
    console.warn('[directory-mail] No se pudo usar Web Share:', error);
  }

  // Navegadores de escritorio no permiten adjuntar un archivo local automáticamente
  // mediante mailto/Gmail. Se descarga el PDF y se abre el correo ya dirigido.
  downloadFile(file);
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(meta.subject)}&body=${encodeURIComponent(meta.body + '\n\nEl PDF se ha descargado y debe adjuntarse a este correo.')}`;
  window.location.href = mailto;
  return 'prepared';
};

export const sendEncargadosPdfByWhatsApp = async (people: Person[]) => {
  if (!people.length) throw new Error('No hay trabajadores dentro de los filtros actuales.');
  const obras = distinct(people.map(p => p.obra));
  if (obras.length !== 1) {
    throw new Error('Para enviar por WhatsApp al encargado, filtre una sola obra.');
  }

  const obra = obras[0];
  const resource = getStoredObrasRecursosPreventivos()[obra];
  const phone = cleanPhone(resource?.recursoPreventivoTelefono || '');
  if (phone.length < 10) {
    throw new Error(`La obra "${obra}" no tiene teléfono del recurso preventivo configurado.`);
  }

  const file = toFile('encargados', people);
  const periods = distinct(people.map(p => p.quincena)).join(', ');
  const message = [
    'RELACIÓN DE TRABAJADORES · PROFEA',
    `Obra: ${obra}`,
    periods ? `Periodo: ${periods}` : '',
    `Trabajadores incluidos: ${people.length}`,
    '',
    'Se adjunta la relación de trabajadores en PDF.',
  ].filter(Boolean).join('\n');

  // WhatsApp Web/wa.me no permite precargar un archivo local como adjunto.
  // Descargamos el PDF y abrimos directamente el chat del recurso preventivo configurado.
  downloadFile(file);
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message + '\n\nAdjunte el PDF descargado en este chat.')}`;
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) window.location.href = url;
  return { phone, obra, filename: file.name };
};
