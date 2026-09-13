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

const monthLabel = (value: string) => {
  const match = safe(value).match(/^(\d{4})-(\d{2})/);
  if (!match) return '-';
  const month = Number(match[2]);
  return `${MONTHS[month - 1] || match[2]} ${match[1]}`;
};

const drawHeader = (
  doc: jsPDF,
  context: WorksiteDocumentContext,
  fortnight: 1 | 2,
) => {
  const config = getStoredPdfConfig();
  const width = doc.internal.pageSize.getWidth();
  const title = `REGISTRO QUINCENAL DE JORNADA DE TRABAJO · ${fortnight === 1 ? '1ª QUINCENA' : '2ª QUINCENA'}`;
  const range = fortnight === 1 ? 'DEL 1 AL 15' : 'DEL 16 AL 31';

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
  doc.setFontSize(8.3);
  doc.text(range, 14, 31.4);
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
  fortnight: 1 | 2,
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
  doc.text(`Quincena / Periodo: ${fortnight === 1 ? 'Del 1 al 15' : 'Del 16 al 31'}`, 14, y + 18.2);
  doc.text(`Fecha de emisión: ${fmtDate(context.fecha)}`, 142, y + 18.2);
  return y + 25;
};

const drawInstructionsAndSignature = (
  doc: jsPDF,
  context: WorksiteDocumentContext,
  startY: number,
) => {
  const width = doc.internal.pageSize.getWidth();
  let y = Math.min(startY + 5, 155);

  doc.setFillColor(240, 247, 255);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(10, y, width - 20, 22, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...BLUE);
  doc.text('INSTRUCCIONES', 14, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(30, 41, 59);
  doc.text('1. Se anotará diariamente, para cada trabajador, la hora de entrada (E) y la hora de salida (S).', 14, y + 10);
  doc.text('2. Las horas totales del periodo se reflejarán en la columna HT.', 14, y + 13.7);
  doc.text('3. En caso de ausencia, incidencia o modificación de la jornada, se hará constar la observación correspondiente.', 14, y + 17.4);
  doc.text('4. El registro se conservará durante cuatro años y permanecerá a disposición de las personas y autoridades legalmente previstas.', 14, y + 21.1);

  y += 27;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...BLUE);
  doc.text('Firma del encargado (recurso preventivo)', 14, y);
  doc.setDrawColor(170, 190, 210);
  doc.rect(14, y + 2, 82, 18);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  doc.text(`Nombre: ${context.recursoPreventivo || ''}`, 102, y + 7);
  doc.text('Cargo: Encargado / recurso preventivo', 102, y + 13);
  doc.text(`Fecha: ${fmtDate(context.fecha)}`, 102, y + 19);
};

export const generateFortnightAttendancePdf = (
  workers: Person[],
  context: WorksiteDocumentContext,
  fortnight: 1 | 2,
) => {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
  const { config, width } = drawHeader(doc, context, fortnight);
  const startY = drawWorkBlock(doc, width, context, fortnight);
  const days = fortnight === 1
    ? Array.from({ length: 15 }, (_, index) => index + 1)
    : Array.from({ length: 16 }, (_, index) => index + 16);

  const firstHeader: any[] = [
    { content: 'Nº', rowSpan: 2, styles: { valign: 'middle' } },
    { content: 'Nombre y apellidos', rowSpan: 2, styles: { valign: 'middle' } },
    { content: 'DNI/NIE', rowSpan: 2, styles: { valign: 'middle' } },
    { content: 'Puesto de trabajo', rowSpan: 2, styles: { valign: 'middle' } },
    ...days.map(day => ({ content: `Día ${day}`, colSpan: 2, styles: { halign: 'center' } })),
    { content: 'HT', rowSpan: 2, styles: { valign: 'middle' } },
    { content: 'Firma trabajador', rowSpan: 2, styles: { valign: 'middle' } },
  ];
  const secondHeader: any[] = days.flatMap(() => ['E', 'S']);

  const body = workers.map((worker, index) => [
    String(index + 1),
    safe(worker.apellidosNombre),
    safe(worker.dni),
    safe(worker.categoria),
    ...days.flatMap(() => ['', '']),
    '',
    '',
  ]);

  const columnStyles: Record<number, any> = {
    0: { cellWidth: 7, halign: 'center' },
    1: { cellWidth: 32 },
    2: { cellWidth: 18 },
    3: { cellWidth: 25 },
  };
  let columnIndex = 4;
  for (let index = 0; index < days.length * 2; index += 1) {
    columnStyles[columnIndex++] = { cellWidth: 4.5, halign: 'center' };
  }
  columnStyles[columnIndex++] = { cellWidth: 9, halign: 'center' };
  columnStyles[columnIndex] = { cellWidth: 24 };

  autoTable(doc, {
    startY,
    head: [firstHeader, secondHeader],
    body,
    margin: { left: 10, right: 10, bottom: 52 },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 5.6,
      cellPadding: 1,
      minCellHeight: 7.8,
      valign: 'middle',
      textColor: [30, 41, 59],
      lineColor: [160, 188, 214],
      lineWidth: 0.18,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [229, 239, 248],
      textColor: [15, 42, 75],
      fontStyle: 'bold',
      fontSize: 4.8,
      cellPadding: 0.7,
      halign: 'center',
      valign: 'middle',
    },
    alternateRowStyles: { fillColor: [250, 252, 254] },
    columnStyles,
  });

  const endY = (doc as any).lastAutoTable?.finalY || startY + 70;
  drawInstructionsAndSignature(doc, context, endY);

  applyPdfFooters(doc, {
    ...config,
    footerText: 'Diputación de Cádiz · Documento interno de control de jornada · Referencia: art. 34.9 del Estatuto de los Trabajadores',
  });

  const label = fortnight === 1 ? '1_QUINCENA_1_AL_15' : '2_QUINCENA_16_AL_31';
  return {
    doc,
    filename: `CONTROL_HORARIO_${label}_${slug(context.obra)}_${slug(monthLabel(context.fecha))}.pdf`,
  };
};
