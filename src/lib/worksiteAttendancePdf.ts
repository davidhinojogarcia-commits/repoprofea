import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Person } from '../../types';
import type { WorksiteDocumentContext } from './worksiteDocumentsPdf';
import { applyPdfFooters, getStoredPdfConfig, renderPdfLogo } from './exportUtils';

const BLUE: [number, number, number] = [0, 84, 142];
const safe = (value: unknown) => String(value ?? '').trim();
const slug = (value: string) => safe(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9_-]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 80);

const fmtDate = (value: string) => {
  const match = safe(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : safe(value) || '-';
};

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

type Ymd = { year: number; month: number; day: number };

const parseYmd = (value: unknown): Ymd | null => {
  const match = safe(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
};

const monthLabel = (value: string) => {
  const parsed = parseYmd(value);
  if (!parsed) return '-';
  return `${MONTHS[parsed.month - 1] || parsed.month} ${parsed.year}`;
};

const dateNumber = (date: Ymd) => date.year * 10000 + date.month * 100 + date.day;
const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

const resolveMonth = (workers: Person[], context: WorksiteDocumentContext): { year: number; month: number; lastDay: number } => {
  const candidates = [
    context.fecha,
    ...workers.flatMap(worker => [worker.periodoInicio, worker.periodoFin, worker.fechaRegistro]),
  ];
  const parsed = candidates.map(parseYmd).find(Boolean) as Ymd | undefined;
  const now = new Date();
  const year = parsed?.year || now.getFullYear();
  const month = parsed?.month || (now.getMonth() + 1);
  return { year, month, lastDay: daysInMonth(year, month) };
};

const workerOverlapsRange = (worker: Person, year: number, month: number, startDay: number, endDay: number) => {
  const rangeStart = dateNumber({ year, month, day: startDay });
  const rangeEnd = dateNumber({ year, month, day: endDay });
  const start = parseYmd(worker.periodoInicio);
  const end = parseYmd(worker.periodoFin);
  const workerStart = start ? dateNumber(start) : rangeStart;
  const workerEnd = end ? dateNumber(end) : rangeEnd;
  return workerStart <= rangeEnd && workerEnd >= rangeStart;
};

const workerActiveOnDay = (worker: Person, year: number, month: number, day: number) => {
  const target = dateNumber({ year, month, day });
  const start = parseYmd(worker.periodoInicio);
  const end = parseYmd(worker.periodoFin);
  if (start && target < dateNumber(start)) return false;
  if (end && target > dateNumber(end)) return false;
  return true;
};

const resolveActualRange = (
  workers: Person[],
  year: number,
  month: number,
  fortnight: 1 | 2,
  lastDay: number,
) => {
  const fortnightStart = fortnight === 1 ? 1 : 16;
  const fortnightEnd = fortnight === 1 ? Math.min(15, lastDay) : lastDay;
  const activeWorkers = workers.filter(worker => workerOverlapsRange(worker, year, month, fortnightStart, fortnightEnd));

  let startDay = fortnightEnd;
  let endDay = fortnightStart;
  let hasBoundedContract = false;

  for (const worker of activeWorkers) {
    const start = parseYmd(worker.periodoInicio);
    const end = parseYmd(worker.periodoFin);
    const startWithinMonth = start && start.year === year && start.month === month ? start.day : fortnightStart;
    const endWithinMonth = end && end.year === year && end.month === month ? end.day : fortnightEnd;
    const clampedStart = Math.max(fortnightStart, Math.min(fortnightEnd, startWithinMonth));
    const clampedEnd = Math.max(fortnightStart, Math.min(fortnightEnd, endWithinMonth));
    if (clampedStart <= clampedEnd) {
      startDay = Math.min(startDay, clampedStart);
      endDay = Math.max(endDay, clampedEnd);
      hasBoundedContract = true;
    }
  }

  if (!hasBoundedContract || !activeWorkers.length) {
    startDay = fortnightStart;
    endDay = fortnightEnd;
  }

  return {
    activeWorkers,
    startDay,
    endDay,
    days: Array.from({ length: Math.max(0, endDay - startDay + 1) }, (_, index) => startDay + index),
  };
};

const rangeLabel = (year: number, month: number, startDay: number, endDay: number) => {
  const monthName = MONTHS[month - 1] || String(month);
  if (startDay === endDay) return `${startDay} DE ${monthName.toUpperCase()} DE ${year}`;
  return `DEL ${startDay} AL ${endDay} DE ${monthName.toUpperCase()} DE ${year}`;
};

const drawHeader = (
  doc: jsPDF,
  context: WorksiteDocumentContext,
  fortnight: 1 | 2,
  actualRangeLabel: string,
) => {
  const config = getStoredPdfConfig();
  const width = doc.internal.pageSize.getWidth();
  const title = `REGISTRO QUINCENAL DE JORNADA DE TRABAJO · ${fortnight === 1 ? '1ª QUINCENA' : '2ª QUINCENA'}`;

  doc.setProperties({
    title,
    author: 'Diputación Provincial de Cádiz',
    creator: 'Sistema de Gestión PROFEA',
  });

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, width, 19, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...BLUE);
  doc.text((config.headerLine1 || 'DIPUTACIÓN PROVINCIAL DE CÁDIZ').toUpperCase(), 14, 7.8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(90, 105, 125);
  doc.text('COOPERACIÓN · GESTIÓN DE FONDOS PROFEA', 14, 13.2);
  renderPdfLogo(doc, width - 68, 4.2, 53, 10.5, true, config.customLogo);
  doc.setDrawColor(218, 226, 233);
  doc.line(14, 17.6, width - 14, 17.6);

  doc.setFillColor(...BLUE);
  doc.rect(0, 19, width, 18, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  doc.text(title, 14, 25.9);
  doc.setFontSize(8.1);
  doc.text(actualRangeLabel, 14, 31.4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(225, 239, 249);
  doc.text('Modelo de registro conforme al artículo 34.9 del Estatuto de los Trabajadores', width - 14, 31.4, { align: 'right' });

  return { config, width };
};

const drawWorkBlock = (
  doc: jsPDF,
  width: number,
  context: WorksiteDocumentContext,
  actualRangeLabel: string,
) => {
  const y = 42;
  doc.setFillColor(247, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(10, y, width - 20, 20, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(...BLUE);
  doc.text('DATOS DE LA EMPRESA / OBRA', 14, y + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(30, 41, 59);
  doc.text(`Empresa: ${context.empresa || '-'}`, 14, y + 10.1);
  doc.text(`CIF: ${safe(context.cif) || '-'}`, 106, y + 10.1);
  doc.text(`Obra / Centro de trabajo: ${context.obra || '-'}`, 14, y + 14.7);
  doc.text(`Encargado / Recurso preventivo: ${context.recursoPreventivo || '-'}`, 142, y + 10.1);
  doc.text(`Mes: ${monthLabel(context.fecha)}`, 142, y + 14.7);
  doc.text(`Periodo real: ${actualRangeLabel}`, 14, y + 18.2);
  doc.text(`Fecha de emisión: ${fmtDate(context.fecha)}`, 142, y + 18.2);
  return y + 25;
};

const drawPageCertification = (
  doc: jsPDF,
  context: WorksiteDocumentContext,
) => {
  const width = doc.internal.pageSize.getWidth();
  const y = 179;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...BLUE);
  doc.text('Firma del encargado / recurso preventivo', 10, y);
  doc.setDrawColor(170, 190, 210);
  doc.rect(10, y + 2, 72, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(30, 41, 59);
  doc.text(`Nombre: ${context.recursoPreventivo || '-'}`, 86, y + 6);
  doc.text('Registro diario conforme al art. 34.9 del Estatuto de los Trabajadores (RDL 2/2015, redacción RDL 8/2019).', 86, y + 11);
  doc.text('Conservar durante cuatro años. Las celdas “—” indican días fuera del contrato.', 86, y + 15);
  doc.setDrawColor(203, 213, 225);
  doc.line(86, y + 17, width - 10, y + 17);
};

const drawWorkerAttendanceBlock = (
  doc: jsPDF,
  worker: Person,
  workerNumber: number,
  x: number,
  y: number,
  blockWidth: number,
  days: number[],
  year: number,
  month: number,
) => {
  doc.setFillColor(229, 239, 248);
  doc.setDrawColor(160, 188, 214);
  doc.roundedRect(x, y, blockWidth, 10, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(15, 42, 75);
  const workerName = `${workerNumber}. ${safe(worker.apellidosNombre) || 'Trabajador sin identificar'}`;
  doc.text(workerName, x + 3, y + 4, { maxWidth: blockWidth - 6 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.8);
  doc.text(`DNI/NIE: ${safe(worker.dni) || '-'} · Puesto: ${safe(worker.categoria) || '-'}`, x + 3, y + 8);

  const body = days.map(day => {
    const active = workerActiveOnDay(worker, year, month, day);
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return active
      ? [String(day), fmtDate(date), '', '', '', '', '']
      : [String(day), fmtDate(date), '—', '—', '—', '—', 'Fuera de contrato'];
  });

  autoTable(doc, {
    startY: y + 11,
    head: [['Día', 'Fecha', 'Entrada', 'Salida', 'HT', 'Firma diaria', 'Incidencias']],
    body,
    margin: { left: x, right: doc.internal.pageSize.getWidth() - x - blockWidth },
    tableWidth: blockWidth,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 5.2,
      cellPadding: 0.7,
      minCellHeight: 5.5,
      valign: 'middle',
      textColor: [30, 41, 59],
      lineColor: [160, 188, 214],
      lineWidth: 0.16,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: BLUE,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 5.1,
      halign: 'center',
      minCellHeight: 6.2,
    },
    alternateRowStyles: { fillColor: [250, 252, 254] },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 16, halign: 'center' },
      2: { cellWidth: 12, halign: 'center' },
      3: { cellWidth: 12, halign: 'center' },
      4: { cellWidth: 9, halign: 'center' },
      5: { cellWidth: 88 },
      6: { cellWidth: blockWidth - 145 },
    },
    didParseCell: data => {
      if (data.section !== 'body') return;
      const row = body[data.row.index];
      if (row?.[2] === '—') {
        data.cell.styles.fillColor = [232, 236, 241];
        data.cell.styles.textColor = [115, 125, 136];
      }
    },
  });
};

export const generateFortnightAttendancePdf = (
  workers: Person[],
  context: WorksiteDocumentContext,
  fortnight: 1 | 2,
) => {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
  const { year, month, lastDay } = resolveMonth(workers, context);
  const range = resolveActualRange(workers, year, month, fortnight, lastDay);
  const actualRange = rangeLabel(year, month, range.startDay, range.endDay);
  const activeWorkers = range.activeWorkers.length ? range.activeWorkers : workers;
  const days = range.days;
  const workersPerPage = 1;
  const totalPages = Math.max(1, Math.ceil(activeWorkers.length / workersPerPage));
  let config = getStoredPdfConfig();

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    if (pageIndex > 0) doc.addPage();
    const header = drawHeader(doc, context, fortnight, actualRange);
    config = header.config;
    const startY = drawWorkBlock(doc, header.width, context, actualRange);
    const gap = 0;
    const blockWidth = header.width - 20;

    for (let slot = 0; slot < workersPerPage; slot += 1) {
      const workerIndex = pageIndex * workersPerPage + slot;
      const worker = activeWorkers[workerIndex];
      if (!worker) continue;
      const x = 10 + slot * (blockWidth + gap);
      drawWorkerAttendanceBlock(doc, worker, workerIndex + 1, x, startY, blockWidth, days, year, month);
    }

    drawPageCertification(doc, context);
  }

  applyPdfFooters(doc, {
    ...config,
    footerText: 'Diputación de Cádiz · Registro diario de jornada · Art. 34.9 RDL 2/2015 (redacción RDL 8/2019) · Conservación: 4 años',
  });

  const label = fortnight === 1 ? '1_QUINCENA' : '2_QUINCENA';
  return {
    doc,
    filename: `CONTROL_HORARIO_INDIVIDUAL_FIRMA_DIARIA_${label}_${range.startDay}_AL_${range.endDay}_${slug(context.obra)}_${slug(monthLabel(context.fecha))}.pdf`,
  };
};
