import { reportOperationalError } from './operationalLog';
import { jsPDF } from 'jspdf';
import type { Person } from '../../types';
import { loadAppBusinessSettings } from '../services/appSettingsService';
import { supabase } from './supabase';
import { getStoredObrasRecursosPreventivos, hydrateStoredSubcontratasPreferences } from './subcontratasDefaults';

export interface WorkerHiringInformation {
  worker: Person;
  municipio: string;
  encargado: string;
  telefonoEncargado: string;
  supervisor: string;
  telefonoSupervisor: string;
  emailSupervisor: string;
  workStartHour: string;
  workEndHour: string;
  needsTraining: boolean;
  trainingDays: Array<{ date: string; start: string; end: string }>;
  lugarFormacion: string;
  incorporationDate: string;
  incorporationTime: string;
  incorporationPlace: string;
}

const safe = (value: unknown) => String(value ?? '').trim();
const normalize = (value: unknown) =>
  safe(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[._\-/:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const formatDate = (value: string) => {
  const match = safe(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : safe(value) || '-';
};

const parseDate = (value: string): Date | null => {
  const match = safe(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const isWeekend = (date: Date) => date.getDay() === 0 || date.getDay() === 6;

const nextBusinessDay = (source: Date, includeSource = false) => {
  const date = new Date(source);
  if (!includeSource) date.setDate(date.getDate() + 1);
  while (isWeekend(date)) date.setDate(date.getDate() + 1);
  return date;
};

const firstBusinessDays = (startIso: string, count: number) => {
  const start = parseDate(startIso);
  if (!start) return [];
  const days: Date[] = [];
  let cursor = nextBusinessDay(start, true);
  while (days.length < count) {
    if (!isWeekend(cursor)) days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};

const needsTraining = (person: Person) => {
  const value = normalize(person.formacion);
  return value === 'no' || value.includes('sin formacion') || value.includes('pendiente');
};

const normalizePhone = (value: string) => {
  let digits = safe(value).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9) digits = `34${digits}`;
  return digits;
};

const resolveWork = async (person: Person) => {
  try {
    await hydrateStoredSubcontratasPreferences();
    const configuredResources = getStoredObrasRecursosPreventivos();
    const workerWork = normalize(person.obra);
    const workerCode = workerWork.match(/\b\d{4,6}\b/)?.[0] || '';

    const configuredEntry = Object.entries(configuredResources).find(([obra, resource]) => {
      const obraName = normalize(obra);
      const resourceObra = normalize(resource?.obra);
      return Boolean(workerWork) && (
        obraName === workerWork ||
        resourceObra === workerWork ||
        (workerCode && (obraName.includes(workerCode) || resourceObra.includes(workerCode)))
      );
    })?.[1];

    const rows = await supabase.query('obras', {
      query: 'select=id,codigo,nombre,municipio,recurso_preventivo',
    });
    const match = (rows || []).find((row: any) => {
      const code = normalize(row.codigo);
      const name = normalize(row.nombre);
      return (
        (workerCode && code.includes(workerCode)) ||
        (workerWork && name === workerWork) ||
        (workerWork && code === workerWork)
      );
    });

    return {
      municipio: safe(match?.municipio),
      encargado: safe(configuredEntry?.recursoPreventivoNombre) || safe(match?.recurso_preventivo),
      telefonoEncargado: safe(configuredEntry?.recursoPreventivoTelefono),
    };
  } catch (error) {
    reportOperationalError('[worker-hiring-info] No se pudieron resolver los datos de la obra:', error, 'warn');
    return { municipio: '', encargado: '', telefonoEncargado: '' };
  }
};

export const resolveWorkerHiringInformation = async (
  person: Person,
): Promise<WorkerHiringInformation> => {
  const [settings, work] = await Promise.all([
    loadAppBusinessSettings(),
    resolveWork(person),
  ]);

  const training = needsTraining(person);
  const trainingDates = training ? firstBusinessDays(person.periodoInicio, 3) : [];
  const trainingDays = trainingDates.map((date, index) => ({
    date: toIso(date),
    start: '08:00',
    end: index === 2 ? '14:00' : '15:00',
  }));

  const contractStart = parseDate(person.periodoInicio);
  const incorporationDate = training && trainingDates.length === 3
    ? toIso(nextBusinessDay(trainingDates[2]))
    : contractStart
      ? toIso(nextBusinessDay(contractStart, true))
      : '';

  const municipio = safe((person as any).municipioObra) || work.municipio;
  const encargado = work.encargado;
  const telefonoEncargado = work.telefonoEncargado;
  const incorporationPlace = [safe(person.obra), municipio].filter(Boolean).join(' · ');

  return {
    worker: person,
    municipio,
    encargado,
    telefonoEncargado,
    supervisor: safe(settings.supervisor.nombreApellidos) || safe(person.supervisorResponsable),
    telefonoSupervisor: safe(settings.supervisor.telefono),
    emailSupervisor: safe(settings.supervisor.email),
    workStartHour: safe(settings.workStartHour) || '08:00',
    workEndHour: safe(settings.workEndHour) || '15:00',
    needsTraining: training,
    trainingDays,
    lugarFormacion: safe(person.lugarFormacion),
    incorporationDate,
    incorporationTime: training ? (safe(settings.workStartHour) || '08:00') : (safe(settings.workStartHour) || '08:00'),
    incorporationPlace,
  };
};

const validate = (info: WorkerHiringInformation, requireWorkerPhone = false) => {
  const missing: string[] = [];
  if (!safe(info.worker.apellidosNombre)) missing.push('nombre del trabajador');
  if (!safe(info.worker.obra)) missing.push('obra');
  if (!safe(info.municipio)) missing.push('localidad/municipio');
  if (!safe(info.worker.periodoInicio) || !safe(info.worker.periodoFin)) missing.push('periodo de contratación');
  if (!safe(info.encargado)) missing.push('encargado/recurso preventivo');
  if (!safe(info.telefonoEncargado)) missing.push('teléfono del encargado');
  if (!safe(info.supervisor)) missing.push('supervisor');
  if (!safe(info.telefonoSupervisor)) missing.push('teléfono del supervisor');
  if (info.needsTraining && !safe(info.lugarFormacion)) missing.push('lugar de formación');
  if (info.needsTraining && info.trainingDays.length !== 3) missing.push('fecha de inicio del contrato para calcular la formación');
  if (requireWorkerPhone && !normalizePhone(info.worker.telefono || '')) missing.push('teléfono del trabajador');
  if (missing.length) throw new Error(`Faltan datos para preparar la información de contratación: ${missing.join(', ')}.`);
};

export const buildWorkerHiringWhatsAppText = (info: WorkerHiringInformation) => {
  validate(info, true);
  const worker = info.worker;
  const lines = [
    'INFORMACIÓN DE CONTRATACIÓN · PROFEA',
    `Hola ${worker.apellidosNombre || 'trabajador/a'}.`,
    '',
    `Obra: ${worker.obra}`,
    `Localidad: ${info.municipio}`,
    `Puesto: ${worker.categoria || '-'}`,
    `Periodo: ${formatDate(worker.periodoInicio)} - ${formatDate(worker.periodoFin)}`,
    `Horario habitual: ${info.workStartHour} - ${info.workEndHour} h`,
  ];

  if (info.needsTraining) {
    lines.push(
      '',
      'FORMACIÓN PREVIA',
      `Lugar: ${info.lugarFormacion}`,
      `${formatDate(info.trainingDays[0].date)}: 08:00 - 15:00 h`,
      `${formatDate(info.trainingDays[1].date)}: 08:00 - 15:00 h`,
      `${formatDate(info.trainingDays[2].date)}: 08:00 - 14:00 h`,
      `Incorporación a obra: ${formatDate(info.incorporationDate)} a las ${info.incorporationTime} h`,
    );
  } else {
    lines.push('', `Incorporación a obra: ${formatDate(info.incorporationDate)} a las ${info.incorporationTime} h`);
  }

  lines.push(
    `Lugar de incorporación: ${info.incorporationPlace}`,
    '',
    `Encargado: ${info.encargado} · Tel. ${info.telefonoEncargado}`,
    `Supervisor PROFEA: ${info.supervisor} · Tel. ${info.telefonoSupervisor}`,
  );

  if (info.emailSupervisor) lines.push(`Correo supervisor: ${info.emailSupervisor}`);
  lines.push('', 'Te adjuntamos el PDF con toda la información. Consérvalo para cualquier consulta.');
  return lines.join('\n');
};

const box = (
  doc: jsPDF,
  title: string,
  rows: Array<[string, string]>,
  y: number,
  height?: number,
) => {
  const x = 14;
  const w = 182;
  const rowH = 7;
  const h = height || 12 + rows.length * rowH;
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, w, h, 2.5, 2.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 84, 142);
  doc.setFontSize(9.5);
  doc.text(title, x + 5, y + 7);
  doc.setFontSize(8.2);
  rows.forEach(([label, value], index) => {
    const ry = y + 14 + index * rowH;
    doc.setTextColor(71, 85, 105);
    doc.setFont('helvetica', 'bold');
    doc.text(label, x + 5, ry);
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'normal');
    doc.text(doc.splitTextToSize(value || '-', 122), x + 55, ry);
  });
  return y + h + 4;
};

export const createWorkerHiringInformationPdfFile = async (person: Person): Promise<File> => {
  const info = await resolveWorkerHiringInformation(person);
  validate(info);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setFillColor(0, 84, 142);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('INFORMACIÓN DE CONTRATACIÓN · PROFEA', 14, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Información práctica para la incorporación del trabajador', 14, 19);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text((person.apellidosNombre || '-').toUpperCase(), 14, 38);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`DNI/NIE: ${person.dni || '-'} · Categoría: ${person.categoria || '-'}`, 14, 44);

  let y = 51;
  y = box(doc, 'DATOS DE LA CONTRATACIÓN', [
    ['Obra', person.obra || '-'],
    ['Localidad', info.municipio || '-'],
    ['Nº oferta', person.numOferta || '-'],
    ['Periodo', `${formatDate(person.periodoInicio)} - ${formatDate(person.periodoFin)}`],
    ['Horario', `${info.workStartHour} - ${info.workEndHour} h`],
  ], y);

  if (info.needsTraining) {
    y = box(doc, 'FORMACIÓN PREVIA OBLIGATORIA', [
      ['Lugar', info.lugarFormacion],
      ['Día 1', `${formatDate(info.trainingDays[0].date)} · 08:00 - 15:00 h`],
      ['Día 2', `${formatDate(info.trainingDays[1].date)} · 08:00 - 15:00 h`],
      ['Día 3', `${formatDate(info.trainingDays[2].date)} · 08:00 - 14:00 h`],
      ['Después', `Incorporación a la obra el ${formatDate(info.incorporationDate)} a las ${info.incorporationTime} h`],
    ], y, 50);
  }

  y = box(doc, 'INCORPORACIÓN A LA OBRA', [
    ['Fecha', formatDate(info.incorporationDate)],
    ['Hora', `${info.incorporationTime} h`],
    ['Lugar', info.incorporationPlace],
  ], y);

  y = box(doc, 'CONTACTOS DE REFERENCIA', [
    ['Encargado', `${info.encargado} · Tel. ${info.telefonoEncargado}`],
    ['Supervisor', `${info.supervisor} · Tel. ${info.telefonoSupervisor}`],
    ['Correo', info.emailSupervisor || '-'],
  ], y);

  doc.setFillColor(255, 247, 237);
  doc.setDrawColor(251, 191, 36);
  doc.roundedRect(14, Math.min(y + 1, 247), 182, 20, 2.5, 2.5, 'FD');
  doc.setTextColor(120, 53, 15);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.4);
  doc.text('IMPORTANTE', 19, Math.min(y + 8, 254));
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  const note = info.needsTraining
    ? 'La formación forma parte de los primeros días del periodo contratado. Una vez finalizado el tercer día de curso, el trabajador debe incorporarse a la obra en la fecha y hora indicadas.'
    : 'El trabajador debe incorporarse directamente a la obra en la fecha, hora y lugar indicados.';
  doc.text(doc.splitTextToSize(note, 155), 39, Math.min(y + 8, 254));

  doc.setDrawColor(148, 163, 184);
  doc.line(14, 278, 196, 278);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(100, 116, 139);
  doc.text('Documento informativo. No sustituye al contrato de trabajo ni a la documentación oficial de contratación.', 14, 283);
  doc.text(`Generado por GestionProfea: ${new Date().toLocaleString('es-ES')}`, 14, 288);

  const safeName = (person.apellidosNombre || 'trabajador')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const filename = `INFORMACION_CONTRATACION_${safeName || 'TRABAJADOR'}.pdf`;
  return new File([doc.output('blob')], filename, { type: 'application/pdf' });
};

const download = (file: File) => {
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

export const downloadWorkerHiringInformationPdf = async (person: Person) => {
  const file = await createWorkerHiringInformationPdfFile(person);
  download(file);
  return file.name;
};

export const shareWorkerHiringInformationPdf = async (
  person: Person,
): Promise<'shared' | 'downloaded' | 'cancelled'> => {
  const info = await resolveWorkerHiringInformation(person);
  validate(info, true);
  const file = await createWorkerHiringInformationPdfFile(person);
  const text = buildWorkerHiringWhatsAppText(info);

  try {
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: 'Información de contratación PROFEA',
        text,
        files: [file],
      });
      return 'shared';
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') return 'cancelled';
    reportOperationalError('[worker-hiring-info] No se pudo compartir el PDF de forma nativa:', error, 'warn');
  }

  download(file);
  return 'downloaded';
};

export const openWorkerHiringWhatsApp = async (
  person: Person,
  reservedWindow?: Window | null,
) => {
  const info = await resolveWorkerHiringInformation(person);
  validate(info, true);
  const phone = normalizePhone(person.telefono || '');
  if (phone.length < 10) throw new Error('El trabajador no tiene un teléfono válido para WhatsApp.');
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(buildWorkerHiringWhatsAppText(info))}`;

  if (reservedWindow && !reservedWindow.closed) {
    reservedWindow.location.replace(url);
    return;
  }
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) window.location.href = url;
};
