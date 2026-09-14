import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Person } from '../../types';
import type { WorksiteDocumentContext } from './worksiteDocumentsPdf';
import { applyPdfFooters, getStoredPdfConfig, renderPdfLogo } from './exportUtils';

const BLUE: [number, number, number] = [0, 84, 142];
const LIGHT_BLUE: [number, number, number] = [235, 244, 251];
const BORDER: [number, number, number] = [166, 193, 216];
const TEXT: [number, number, number] = [30, 41, 59];

const safe = (value: unknown) => String(value ?? '').trim();
const slug = (value: string) => safe(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9_-]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 80);

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

type Ymd = { year: number; month: number; day: number };
export type AttendancePeriod = { year: number; month: number; fortnight: 1 | 2 };
type AttendanceContext = WorksiteDocumentContext & { codigoObra?: string; municipio?: string };

const parseYmd = (value: unknown): Ymd | null => {
  const match = safe(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
};

const dateNumber = (date: Ymd) => date.year * 10000 + date.month * 100 + date.day;
const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();
const pad = (value: number) => String(value).padStart(2, '0');
const fmtDay = (year: number, month: number, day: number) => `${pad(day)}/${pad(month)}/${year}`;

const resolveMonth = (workers: Person[], context: AttendanceContext) => {
  const candidates = [context.fecha, ...workers.flatMap(worker => [worker.periodoInicio, worker.periodoFin, worker.fechaRegistro])];
  const parsed = candidates.map(parseYmd).find(Boolean) as Ymd | undefined;
  const now = new Date();
  return { year: parsed?.year || now.getFullYear(), month: parsed?.month || now.getMonth() + 1 };
};

export const getFortnightDays = (year: number, month: number, fortnight: 1 | 2) => {
  const lastDay = daysInMonth(year, month);
  const startDay = fortnight === 1 ? 1 : 16;
  const endDay = fortnight === 1 ? Math.min(15, lastDay) : lastDay;
  return Array.from({ length: Math.max(0, endDay - startDay + 1) }, (_, index) => startDay + index);
};

export const workerOverlapsAttendancePeriod = (worker: Person, period: AttendancePeriod) => {
  const days = getFortnightDays(period.year, period.month, period.fortnight);
  if (!days.length) return false;
  const rangeStart = dateNumber({ year: period.year, month: period.month, day: days[0] });
  const rangeEnd = dateNumber({ year: period.year, month: period.month, day: days[days.length - 1] });
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

const resolveWorkCode = (context: AttendanceContext) => {
  if (safe(context.codigoObra)) return safe(context.codigoObra);
  const raw = safe(context.obra).replace(/[._\-/:]+/g, ' ');
  const code = raw.match(/\b(\d{5})\b/)?.[1] || '';
  const compact = raw.toLowerCase().replace(/\s+/g, '');
  const type = compact.includes('gr') ? 'GR' : compact.includes('ee') ? 'EE' : '';
  return code && type ? `${code} ${type}` : code;
};

const field = (doc: jsPDF, label: string, value: string, x: number, y: number, width: number, labelWidth: number) => {
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.18);
  doc.setFillColor(...LIGHT_BLUE);
  doc.rect(x, y, labelWidth, 7, 'FD');
  doc.setFillColor(255, 255, 255);
  doc.rect(x + labelWidth, y, width - labelWidth, 7, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.3);
  doc.setTextColor(...BLUE);
  doc.text(label, x + 2, y + 4.6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.4);
  doc.setTextColor(...TEXT);
  const valueLines = doc.splitTextToSize(value || '-', Math.max(8, width - labelWidth - 4));
  doc.text(valueLines[0] || '-', x + labelWidth + 2, y + 4.6);
};

const drawInstitutionalHeader = (doc: jsPDF, context: AttendanceContext, period: AttendancePeriod) => {
  const config = getStoredPdfConfig();
  const width = doc.internal.pageSize.getWidth();
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, width, 22, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...BLUE);
  doc.text((config.headerLine1 || 'DIPUTACIÓN PROVINCIAL DE CÁDIZ').toUpperCase(), 14, 8.3);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(85, 105, 125);
  doc.text('COOPERACIÓN · GESTIÓN DE FONDOS PROFEA', 14, 14);
  renderPdfLogo(doc, width - 68, 4.2, 53, 10.5, true, config.customLogo);
  doc.setDrawColor(218, 226, 233);
  doc.line(14, 18.2, width - 14, 18.2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...BLUE);
  doc.text('REGISTRO DIARIO DE JORNADA', width / 2, 27.5, { align: 'center' });
  doc.setFontSize(9);
  doc.text('Control horario quincenal', width / 2, 33, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.6);
  doc.setTextColor(80, 100, 120);
  doc.text(`${period.fortnight === 1 ? '1ª' : '2ª'} quincena · ${MONTHS[period.month - 1]} ${period.year}`, width / 2, 37.2, { align: 'center' });
  return 41;
};

const drawIdentityBlock = (doc: jsPDF, worker: Person, context: AttendanceContext, period: AttendancePeriod, startY: number) => {
  const workCode = resolveWorkCode(context);
  const monthName = MONTHS[period.month - 1] || String(period.month);
  const x = 10;
  const gap = 3;
  const full = 277;
  const half = (full - gap) / 2;
  field(doc, 'Obra', safe(context.obra), x, startY, half, 22);
  field(doc, 'Código obra', workCode, x + half + gap, startY, 67, 24);
  field(doc, 'Municipio', safe(context.municipio), x + half + gap + 70, startY, half - 70, 23);
  field(doc, 'Quincena', period.fortnight === 1 ? '1ª' : '2ª', x, startY + 9, 55, 22);
  field(doc, 'Mes', monthName.charAt(0).toUpperCase() + monthName.slice(1), x + 58, startY + 9, 64, 18);
  field(doc, 'Año', String(period.year), x + 125, startY + 9, 45, 16);
  field(doc, 'Nº oferta', safe(worker.numOferta), x + 173, startY + 9, 114, 24);
  field(doc, 'Empresa', safe(context.empresa), x, startY + 18, half, 22);
  field(doc, 'Responsable / Encargado de obra', safe(context.recursoPreventivo), x + half + gap, startY + 18, half, 51);
  field(doc, 'Trabajador', safe(worker.apellidosNombre), x, startY + 27, half, 22);
  field(doc, 'DNI/NIE', safe(worker.dni), x + half + gap, startY + 27, 76, 21);
  field(doc, 'Categoría', safe(worker.categoria), x + half + gap + 79, startY + 27, half - 79, 22);
  return startY + 37;
};

const drawDailyTable = (doc: jsPDF, worker: Person, period: AttendancePeriod, startY: number) => {
  const days = getFortnightDays(period.year, period.month, period.fortnight);
  const body = days.map(day => {
    const active = workerActiveOnDay(worker, period.year, period.month, day);
    return [String(day), fmtDay(period.year, period.month, day), active ? '' : '—', active ? '' : '—', active ? '' : '—', active ? '' : '—', active ? '' : '—', active ? '' : 'Fuera de contrato'];
  });
  autoTable(doc, {
    startY,
    head: [['Día', 'Fecha', 'Hora entrada', 'Firma entrada', 'Hora salida', 'Firma salida', 'Horas efectivas', 'Incidencias']],
    body,
    margin: { left: 10, right: 10 },
    theme: 'grid',
    tableWidth: 277,
    styles: { font: 'helvetica', fontSize: 5.5, textColor: TEXT, lineColor: BORDER, lineWidth: 0.18, minCellHeight: 4.8, cellPadding: 0.55, valign: 'middle' },
    headStyles: { fillColor: BLUE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 5.7, halign: 'center', valign: 'middle', minCellHeight: 6.2 },
    alternateRowStyles: { fillColor: [250, 252, 254] },
    columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 24, halign: 'center' }, 2: { cellWidth: 27, halign: 'center' }, 3: { cellWidth: 43 }, 4: { cellWidth: 27, halign: 'center' }, 5: { cellWidth: 43 }, 6: { cellWidth: 28, halign: 'center' }, 7: { cellWidth: 75 } },
    didParseCell: data => {
      if (data.section !== 'body') return;
      const day = days[data.row.index];
      if (!workerActiveOnDay(worker, period.year, period.month, day)) {
        data.cell.styles.fillColor = [238, 241, 244];
        data.cell.styles.textColor = [125, 135, 145];
      }
    },
  });
  return (doc as any).lastAutoTable?.finalY || startY + 105;
};

const drawSummary = (doc: jsPDF, context: AttendanceContext, startY: number) => {
  const width = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const y = Math.min(startY + 4, pageHeight - 50);
  const leftX = 10, leftW = 68, centerX = 81, centerW = 112, rightX = 196, rightW = width - rightX - 10, boxH = 27;
  const box = (x: number, w: number, title: string) => {
    doc.setDrawColor(...BORDER); doc.setFillColor(255, 255, 255); doc.rect(x, y, w, boxH, 'FD');
    doc.setFillColor(...LIGHT_BLUE); doc.rect(x, y, w, 6.5, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...BLUE); doc.text(title, x + 2.5, y + 4.4);
  };
  box(leftX, leftW, 'Resumen quincenal'); box(centerX, centerW, 'Incidencias / observaciones'); box(rightX, rightW, 'Conforme responsable / encargado');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.1); doc.setTextColor(...TEXT);
  ['Días trabajados', 'Horas ordinarias', 'Horas extraordinarias', 'Total horas'].forEach((label, index) => { const rowY = y + 10 + index * 4.5; doc.text(label, leftX + 3, rowY); doc.line(leftX + 39, rowY + 0.8, leftX + leftW - 3, rowY + 0.8); });
  doc.text(`Nombre: ${safe(context.recursoPreventivo)}`, rightX + 3, y + 11); doc.text('Firma:', rightX + 3, y + 16); doc.line(rightX + 18, y + 16.6, rightX + rightW - 3, y + 16.6); doc.text('Fecha: ____ / ____ / ______', rightX + 3, y + 23);
  const noticeY = pageHeight - 18; doc.setFontSize(5.7); doc.setTextColor(75, 95, 115);
  doc.text('El trabajador firma diariamente la entrada y la salida de la jornada.', 10, noticeY);
  doc.text('Registro diario individual conforme al art. 34.9 del Estatuto de los Trabajadores. Conservación: 4 años.', width - 10, noticeY, { align: 'right' });
};

const drawWorkerPage = (doc: jsPDF, worker: Person, context: AttendanceContext, period: AttendancePeriod) => {
  const startY = drawInstitutionalHeader(doc, context, period);
  const tableY = drawIdentityBlock(doc, worker, context, period, startY);
  const endY = drawDailyTable(doc, worker, period, tableY);
  drawSummary(doc, context, endY);
};

export const generateAttendancePeriodsPdf = (workers: Person[], context: AttendanceContext, periods: AttendancePeriod[]) => {
  const uniquePeriods = Array.from(new Map(periods.map(period => [`${period.year}-${period.month}-${period.fortnight}`, period])).values())
    .sort((a, b) => a.year - b.year || a.month - b.month || a.fortnight - b.fortnight);
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
  const config = getStoredPdfConfig();
  doc.setProperties({ title: 'REGISTRO DIARIO DE JORNADA · PERIODOS SELECCIONADOS', author: 'Diputación Provincial de Cádiz', creator: 'Sistema de Gestión PROFEA' });
  let pages = 0;
  uniquePeriods.forEach(period => {
    workers.filter(worker => workerOverlapsAttendancePeriod(worker, period)).forEach(worker => {
      if (pages > 0) doc.addPage('a4', 'landscape');
      drawWorkerPage(doc, worker, context, period);
      pages += 1;
    });
  });
  if (!pages) {
    const fallback = uniquePeriods[0] || { year: new Date().getFullYear(), month: new Date().getMonth() + 1, fortnight: 1 as const };
    workers.slice(0, 1).forEach(worker => drawWorkerPage(doc, worker, context, fallback));
  }
  applyPdfFooters(doc, { ...config, footerText: 'Diputación de Cádiz · PROFEA · Registro diario de jornada' });
  const first = uniquePeriods[0];
  const last = uniquePeriods[uniquePeriods.length - 1];
  const range = first && last ? `${first.year}${pad(first.month)}Q${first.fortnight}_${last.year}${pad(last.month)}Q${last.fortnight}` : 'SELECCION';
  return { doc, filename: `REGISTRO_DIARIO_JORNADA_${range}_${slug(context.obra)}.pdf` };
};

export const generateFortnightAttendancePdf = (workers: Person[], context: AttendanceContext, fortnight: 1 | 2) => {
  const { year, month } = resolveMonth(workers, context);
  return generateAttendancePeriodsPdf(workers, context, [{ year, month, fortnight }]);
};