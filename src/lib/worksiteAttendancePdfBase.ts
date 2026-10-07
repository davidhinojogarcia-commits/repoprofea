import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Person } from "../../types";
import type { WorksiteDocumentContext } from "./worksiteDocumentsPdf";
import {
  applyInstitutionalPdfStandard,
  renderInstitutionalReportHeader,
} from "./exportUtils";

const BLUE: [number, number, number] = [0, 84, 142];
const LIGHT_BLUE: [number, number, number] = [235, 244, 251];
const BORDER: [number, number, number] = [166, 193, 216];
const TEXT: [number, number, number] = [30, 41, 59];

const safe = (value: unknown) => String(value ?? "").trim();
const slug = (value: string) =>
  safe(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

const pad = (value: number) => String(value).padStart(2, "0");
const fmtDateParts = (year: number, month: number, day: number) =>
  `${pad(day)}/${pad(month)}/${year}`;

type Ymd = { year: number; month: number; day: number };
export type AttendancePeriod = {
  year: number;
  month: number;
  fortnight: 1 | 2;
};
type AttendanceContext = WorksiteDocumentContext & {
  codigoObra?: string;
  municipio?: string;
  workStartHour?: string;
  workEndHour?: string;
};

const parseYmd = (value: unknown): Ymd | null => {
  const match = safe(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
};

const toUtc = (value: Ymd) => Date.UTC(value.year, value.month - 1, value.day);
const fromUtc = (value: number): Ymd => {
  const date = new Date(value);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

const enumerateDays = (start: Ymd, end: Ymd, maxDays = 366): Ymd[] => {
  const startMs = toUtc(start);
  const endMs = toUtc(end);
  const low = Math.min(startMs, endMs);
  const high = Math.max(startMs, endMs);
  const result: Ymd[] = [];
  for (
    let current = low;
    current <= high && result.length < maxDays;
    current += 86400000
  )
    result.push(fromUtc(current));
  return result;
};

const workerContractRange = (worker: Person, context: AttendanceContext) => {
  const fallback = parseYmd(context.fecha) || fromUtc(Date.now());
  const start = parseYmd(worker.periodoInicio) || fallback;
  const end = parseYmd(worker.periodoFin) || start;
  const days = enumerateDays(start, end);
  const first = days[0] || start;
  const last = days[days.length - 1] || end;
  return { start: first, end: last, days };
};

const daysInMonth = (year: number, month: number) =>
  new Date(year, month, 0).getDate();
export const getFortnightDays = (
  year: number,
  month: number,
  fortnight: 1 | 2,
) => {
  const lastDay = daysInMonth(year, month);
  const startDay = fortnight === 1 ? 1 : 16;
  const endDay = fortnight === 1 ? Math.min(15, lastDay) : lastDay;
  return Array.from(
    { length: Math.max(0, endDay - startDay + 1) },
    (_, index) => startDay + index,
  );
};

export const workerOverlapsAttendancePeriod = (
  worker: Person,
  period: AttendancePeriod,
) => {
  const days = getFortnightDays(period.year, period.month, period.fortnight);
  if (!days.length) return false;
  const rangeStart = Date.UTC(period.year, period.month - 1, days[0]);
  const rangeEnd = Date.UTC(
    period.year,
    period.month - 1,
    days[days.length - 1],
  );
  const start = parseYmd(worker.periodoInicio);
  const end = parseYmd(worker.periodoFin);
  const workerStart = start ? toUtc(start) : rangeStart;
  const workerEnd = end ? toUtc(end) : rangeEnd;
  return workerStart <= rangeEnd && workerEnd >= rangeStart;
};

const resolveWorkCode = (context: AttendanceContext) => {
  if (safe(context.codigoObra)) return safe(context.codigoObra);
  const raw = safe(context.obra).replace(/[._\-/:]+/g, " ");
  const code = raw.match(/\b(\d{5})\b/)?.[1] || "";
  const compact = raw.toLowerCase().replace(/\s+/g, "");
  const type = compact.includes("gr")
    ? "GR"
    : compact.includes("ee")
      ? "EE"
      : "";
  return code && type ? `${code} ${type}` : code;
};

const field = (
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  labelWidth: number,
  height = 5.7,
) => {
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.18);
  doc.setFillColor(...LIGHT_BLUE);
  doc.rect(x, y, labelWidth, height, "FD");
  doc.setFillColor(255, 255, 255);
  doc.rect(x + labelWidth, y, width - labelWidth, height, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.8);
  doc.setTextColor(...BLUE);
  doc.text(label, x + 2, y + 3.8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.9);
  doc.setTextColor(...TEXT);
  const valueLines = doc.splitTextToSize(
    value || "-",
    Math.max(8, width - labelWidth - 4),
  );
  doc.text(valueLines[0] || "-", x + labelWidth + 2, y + 3.8);
};

const drawInstitutionalHeader = (
  doc: jsPDF,
  context: AttendanceContext,
  worker: Person,
  partLabel?: string,
) => {
  const range = workerContractRange(worker, context);
  const subtitle = `Contrato: ${fmtDateParts(range.start.year, range.start.month, range.start.day)} – ${fmtDateParts(range.end.year, range.end.month, range.end.day)}${partLabel ? ` · ${partLabel}` : ""}`;
  renderInstitutionalReportHeader(
    doc,
    "REGISTRO DIARIO DE JORNADA",
    subtitle,
    { subtitle: "COOPERACIÓN · GESTIÓN DE FONDOS PROFEA" },
  );
  return 42;
};

const drawIdentityBlock = (
  doc: jsPDF,
  worker: Person,
  context: AttendanceContext,
  startY: number,
) => {
  const range = workerContractRange(worker, context);
  const workCode = resolveWorkCode(context);
  const period = `${fmtDateParts(range.start.year, range.start.month, range.start.day)} – ${fmtDateParts(range.end.year, range.end.month, range.end.day)}`;
  const x = 10;
  const gap = 3;
  const full = 277;
  const half = (full - gap) / 2;
  const h = 5.7;
  field(doc, "Obra", safe(context.obra), x, startY, half, 22, h);
  field(doc, "Código obra", workCode, x + half + gap, startY, 67, 24, h);
  field(
    doc,
    "Municipio",
    safe(context.municipio),
    x + half + gap + 70,
    startY,
    half - 70,
    23,
    h,
  );
  // Una única fila alineada. Antes se repintaba esta línea desde otro módulo,
  // generando cuadros fantasma superpuestos en el PDF.
  const periodWidth = 137;
  const offerWidth = 67;
  const companyWidth = full - periodWidth - offerWidth - gap * 2;
  field(doc, "Periodo contratado", period, x, startY + 7, periodWidth, 32, h);
  field(
    doc,
    "Nº oferta",
    safe(worker.numOferta),
    x + periodWidth + gap,
    startY + 7,
    offerWidth,
    24,
    h,
  );
  field(
    doc,
    "Empresa",
    safe(context.empresa),
    x + periodWidth + gap + offerWidth + gap,
    startY + 7,
    companyWidth,
    22,
    h,
  );
  field(
    doc,
    "Trabajador",
    safe(worker.apellidosNombre),
    x,
    startY + 14,
    half,
    22,
    h,
  );
  field(
    doc,
    "DNI/NIE",
    safe(worker.dni),
    x + half + gap,
    startY + 14,
    76,
    21,
    h,
  );
  field(
    doc,
    "Categoría",
    safe(worker.categoria),
    x + half + gap + 79,
    startY + 14,
    half - 79,
    22,
    h,
  );
  field(
    doc,
    "Responsable / Encargado",
    safe(context.recursoPreventivo),
    x,
    startY + 21,
    full,
    43,
    h,
  );
  return startY + 28.5;
};

const drawDailyTable = (
  doc: jsPDF,
  days: Ymd[],
  startY: number,
  context: AttendanceContext,
) => {
  const compact = days.length > 20;
  const startHour = safe(context.workStartHour);
  const endHour = safe(context.workEndHour);
  const body = days.map((day, index) => [
    String(index + 1),
    fmtDateParts(day.year, day.month, day.day),
    startHour,
    "",
    endHour,
    "",
    "",
    "",
  ]);
  autoTable(doc, {
    startY,
    head: [
      [
        "Nº",
        "Fecha",
        "Hora entrada",
        "Firma entrada",
        "Hora salida",
        "Firma salida",
        "Horas efectivas",
        "Incidencias",
      ],
    ],
    body,
    margin: { left: 10, right: 10, bottom: 50 },
    theme: "grid",
    tableWidth: 277,
    styles: {
      font: "helvetica",
      fontSize: compact ? 4.7 : 5.4,
      textColor: TEXT,
      lineColor: BORDER,
      lineWidth: 0.16,
      minCellHeight: compact ? 2.75 : 4.5,
      cellPadding: compact ? 0.28 : 0.5,
      valign: "middle",
    },
    headStyles: {
      fillColor: BLUE,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: compact ? 5 : 5.6,
      halign: "center",
      valign: "middle",
      minCellHeight: compact ? 5.2 : 6,
    },
    alternateRowStyles: { fillColor: [250, 252, 254] },
    columnStyles: {
      0: { cellWidth: 9, halign: "center" },
      1: { cellWidth: 25, halign: "center" },
      2: { cellWidth: 27, halign: "center" },
      3: { cellWidth: 43 },
      4: { cellWidth: 27, halign: "center" },
      5: { cellWidth: 43 },
      6: { cellWidth: 28, halign: "center" },
      7: { cellWidth: 75 },
    },
  });
  return (doc as any).lastAutoTable?.finalY || startY + 100;
};

const drawSummary = (
  doc: jsPDF,
  context: AttendanceContext,
  startY: number,
) => {
  const width = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const y = Math.min(startY + 3, pageHeight - 47);
  const leftX = 10,
    leftW = 68,
    centerX = 81,
    centerW = 112,
    rightX = 196,
    rightW = width - rightX - 10,
    boxH = 24;
  const box = (x: number, w: number, title: string) => {
    doc.setDrawColor(...BORDER);
    doc.setFillColor(255, 255, 255);
    doc.rect(x, y, w, boxH, "FD");
    doc.setFillColor(...LIGHT_BLUE);
    doc.rect(x, y, w, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.2);
    doc.setTextColor(...BLUE);
    doc.text(title, x + 2.5, y + 4.1);
  };
  box(leftX, leftW, "Resumen del periodo");
  box(centerX, centerW, "Incidencias / observaciones");
  box(rightX, rightW, "Conforme responsable / encargado");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);
  doc.setTextColor(...TEXT);
  [
    "Días trabajados",
    "Horas ordinarias",
    "Horas extraordinarias",
    "Total horas",
  ].forEach((label, index) => {
    const rowY = y + 9 + index * 4;
    doc.text(label, leftX + 3, rowY);
    doc.line(leftX + 39, rowY + 0.7, leftX + leftW - 3, rowY + 0.7);
  });
  doc.text(`Nombre: ${safe(context.recursoPreventivo)}`, rightX + 3, y + 10);
  doc.text("Firma:", rightX + 3, y + 15);
  doc.line(rightX + 18, y + 15.6, rightX + rightW - 3, y + 15.6);
  doc.text("Fecha: ____ / ____ / ______", rightX + 3, y + 21);
  const noticeY = pageHeight - 18;
  doc.setFontSize(5.5);
  doc.setTextColor(75, 95, 115);
  doc.text(
    "El trabajador firma diariamente la entrada y la salida de la jornada.",
    10,
    noticeY,
  );
  doc.text(
    "Registro diario individual conforme al art. 34.9 del Estatuto de los Trabajadores. Conservación: 4 años.",
    width - 10,
    noticeY,
    { align: "right" },
  );
};

const chunk = <T>(values: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size)
    result.push(values.slice(i, i + size));
  return result;
};

const drawWorkerContractPages = (
  doc: jsPDF,
  worker: Person,
  context: AttendanceContext,
  addPageBefore: boolean,
) => {
  const range = workerContractRange(worker, context);
  const chunks = chunk(range.days, 31);
  const parts = chunks.length ? chunks : [[range.start]];
  parts.forEach((days, index) => {
    if (addPageBefore || index > 0) doc.addPage("a4", "landscape");
    const partLabel =
      parts.length > 1 ? `Parte ${index + 1} de ${parts.length}` : undefined;
    const startY = drawInstitutionalHeader(doc, context, worker, partLabel);
    const tableY = drawIdentityBlock(doc, worker, context, startY);
    const endY = drawDailyTable(doc, days, tableY, context);
    drawSummary(doc, context, endY);
    addPageBefore = true;
  });
  return addPageBefore;
};

export const generateContractAttendancePdf = (
  workers: Person[],
  context: AttendanceContext,
) => {
  const doc = new jsPDF({ compress: true, orientation: "landscape", format: "a4" });
  doc.setProperties({
    title: "REGISTRO DIARIO DE JORNADA · PERIODOS CONTRATADOS",
    author: "Diputación Provincial de Cádiz",
    creator: "Sistema de Gestión PROFEA",
  });
  let hasPage = false;
  workers.forEach((worker) => {
    hasPage = drawWorkerContractPages(doc, worker, context, hasPage);
  });
  if (!workers.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...BLUE);
    doc.text("No hay trabajadores en el periodo seleccionado.", 20, 30);
  }
  applyInstitutionalPdfStandard(doc);
  return {
    doc,
    filename: `REGISTRO_DIARIO_JORNADA_CONTRATOS_${slug(context.obra)}_${slug(context.periodoLabel)}.pdf`,
  };
};

// Compatibilidad con llamadas anteriores: el control horario se adapta siempre al contrato real del trabajador.
export const generateAttendancePeriodsPdf = (
  workers: Person[],
  context: AttendanceContext,
  _periods: AttendancePeriod[],
) => generateContractAttendancePdf(workers, context);

export const generateFortnightAttendancePdf = (
  workers: Person[],
  context: AttendanceContext,
  _fortnight: 1 | 2,
) => generateContractAttendancePdf(workers, context);
