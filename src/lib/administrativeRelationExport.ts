import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import type { Person } from '../../types';
import { getAptitudMedicaInfo } from '../../types';
import { applyPdfFooters, getBase64Image, getStoredPdfConfig, renderPdfLogo } from './exportUtils';
import { formatIban, formatSpanishSocialSecurityNumber } from './personalDataValidators';

const BLUE: [number, number, number] = [0, 84, 142];
const LIGHT_BLUE: [number, number, number] = [240, 247, 255];
const RED_ROW: [number, number, number] = [254, 226, 226];
const BLUE_HEX = '00548E';
const RED_HEX = 'FEE2E2';
const MONTH = new Date().toISOString().slice(0, 10);

const formatDate = (value?: string) => value ? value.slice(0, 10).split('-').reverse().join('/') : '—';
const isRenounced = (p: Person) => {
  const row = p as any;
  return String(row.estadoContratacion || '').toLowerCase() === 'renuncia' || String(row.codigoSaeResultado || '') === '2100';
};
const workerAdministrativeLabel = (p: Person) => [
  p.apellidosNombre || '—',
  ...(isRenounced(p) ? ['RENUNCIA · SAE 2100'] : []),
  p.dni || '—',
  `Nac.: ${formatDate(p.fechaNacimiento)}`,
].join('\n');
const aptitudLabel = (p: Person) => {
  const { estado, limitaciones, validez } = getAptitudMedicaInfo(p);
  if (estado === 'Apto con limitaciones') return `APTO C/ LIMITACIONES\n${limitaciones || 'Sin detalle'}\nVálido ${validez}`;
  if (estado === 'Apto') return `APTO\nVálido ${validez}`;
  if (estado === 'No Apto') return 'NO APTO';
  return 'PENDIENTE';
};

const filename = (ext: 'pdf' | 'xlsx') => `PROFEA_RELACION_ADMINISTRATIVA_${MONTH}.${ext}`;

export const prepareAdministrativeRelationPDF = (people: Person[]) => {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4', unit: 'mm' });
  const config = getStoredPdfConfig();
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;
  const usableWidth = pageWidth - (marginX * 2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(70, 80, 95);
  doc.text(config.headerLine1.toUpperCase(), marginX, 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(110, 120, 135);
  doc.text(config.headerLine2.toUpperCase(), marginX, 15);
  renderPdfLogo(doc, pageWidth - 66, 3.5, 52, 10, true, config.customLogo);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.text('RELACIÓN ADMINISTRATIVA DE TRABAJADORES', marginX, 25);
  doc.setDrawColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.setLineWidth(0.5);
  doc.line(marginX, 28, pageWidth - marginX, 28);

  const hasRenunciations = people.some(isRenounced);
  let tableStartY = 32;
  if (hasRenunciations) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(153, 27, 27);
    doc.text('Las filas resaltadas en rojo corresponden a trabajadores con RENUNCIA · SAE 2100.', marginX, 32);
    tableStartY = 36;
  }

  const head = [[
    'OFERTA / CAT.',
    'TRABAJADOR / DNI / NACIMIENTO',
    'PERIODO CONTRATO',
    'CONTACTO',
    'APTITUD MÉDICA',
    'Nº SEGURIDAD SOCIAL',
    'CUENTA BANCARIA / IBAN',
  ]];

  const body = people.map(p => [
    `${p.numOferta || '—'}\n${p.categoria || '—'}`,
    workerAdministrativeLabel(p),
    `Del ${formatDate(p.periodoInicio)}\nAl ${formatDate(p.periodoFin)}`,
    `${p.telefono || '—'}\n${p.obra || '—'}`,
    aptitudLabel(p),
    p.numeroSeguridadSocial ? formatSpanishSocialSecurityNumber(p.numeroSeguridadSocial) : '—',
    p.iban ? formatIban(p.iban) : '—',
  ]);

  autoTable(doc, {
    head,
    body,
    startY: tableStartY,
    theme: 'grid',
    margin: { left: marginX, right: marginX },
    tableWidth: usableWidth,
    styles: { fontSize: 6.15, cellPadding: 1.45, valign: 'middle', overflow: 'linebreak', lineWidth: 0.1 },
    headStyles: { fillColor: BLUE, textColor: 255, fontStyle: 'bold', halign: 'center', fontSize: 6.05, cellPadding: 1.4 },
    columnStyles: {
      0: { cellWidth: 27, halign: 'center' },
      1: { cellWidth: 49 },
      2: { cellWidth: 31, halign: 'center' },
      3: { cellWidth: 36 },
      4: { cellWidth: 42 },
      5: { cellWidth: 35 },
      6: { cellWidth: 49 },
    },
    alternateRowStyles: { fillColor: LIGHT_BLUE },
    didParseCell: data => {
      if (data.section !== 'body') return;
      const person = people[data.row.index];
      if (person && isRenounced(person)) {
        data.cell.styles.fillColor = RED_ROW;
        data.cell.styles.textColor = [153, 27, 27];
        data.cell.styles.fontStyle = 'bold';
      } else if (data.column.index === 4) {
        const text = data.cell.text.join(' ').toUpperCase();
        if (text.includes('NO APTO') || text.includes('PENDIENTE')) data.cell.styles.textColor = [180, 0, 0];
        else if (text.includes('LIMIT')) data.cell.styles.textColor = [180, 83, 9];
        else if (text.includes('APTO')) data.cell.styles.textColor = [0, 120, 50];
      }
    },
  });

  applyPdfFooters(doc, config);
  return { doc, filename: filename('pdf') };
};

export const prepareAdministrativeRelationExcel = async (people: Person[]) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Diputación Provincial de Cádiz';
  workbook.company = 'Diputación Provincial de Cádiz';
  workbook.subject = 'Relación administrativa de trabajadores PROFEA';
  const worksheet = workbook.addWorksheet('Relación Administrativa', {
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.15, footer: 0.2 },
    },
  });

  const logo = await getBase64Image();
  if (logo) {
    const imageId = workbook.addImage({ base64: logo, extension: 'png' });
    worksheet.addImage(imageId, { tl: { col: 0.2, row: 0.2 }, ext: { width: 195, height: 30 } });
  }
  worksheet.mergeCells('C1:G1');
  const institution = worksheet.getCell('C1');
  institution.value = 'DIPUTACIÓN PROVINCIAL DE CÁDIZ · GESTIÓN DE FONDOS PROFEA';
  institution.font = { name: 'Arial', bold: true, size: 10, color: { argb: BLUE_HEX } };
  institution.alignment = { horizontal: 'right' };

  worksheet.mergeCells('A4:G4');
  const title = worksheet.getCell('A4');
  title.value = 'RELACIÓN ADMINISTRATIVA DE TRABAJADORES';
  title.font = { name: 'Arial', bold: true, size: 16, color: { argb: BLUE_HEX } };
  title.alignment = { horizontal: 'center' };

  const hasRenunciations = people.some(isRenounced);
  if (hasRenunciations) {
    worksheet.mergeCells('A5:G5');
    const legend = worksheet.getCell('A5');
    legend.value = 'Las filas resaltadas en rojo corresponden a trabajadores con RENUNCIA · SAE 2100.';
    legend.font = { name: 'Arial', bold: true, size: 8, color: { argb: '991B1B' } };
    legend.alignment = { horizontal: 'left' };
  }

  const headers = [
    ['OFERTA / CAT.', 18],
    ['TRABAJADOR / DNI / NACIMIENTO', 38],
    ['PERIODO CONTRATO', 23],
    ['CONTACTO', 31],
    ['APTITUD MÉDICA', 32],
    ['Nº SEGURIDAD SOCIAL', 22],
    ['CUENTA BANCARIA / IBAN', 31],
  ] as const;
  const headerRow = worksheet.getRow(6);
  headers.forEach(([label, width], index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = label;
    worksheet.getColumn(index + 1).width = width;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_HEX } };
    cell.font = { name: 'Arial', color: { argb: 'FFFFFF' }, bold: true, size: 9 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  });
  headerRow.height = 28;

  people.forEach((p, index) => {
    const row = worksheet.addRow([
      `${p.numOferta || '—'}\n${p.categoria || '—'}`,
      workerAdministrativeLabel(p),
      `Del ${formatDate(p.periodoInicio)} al ${formatDate(p.periodoFin)}`,
      `${p.telefono || '—'}\n${p.obra || '—'}`,
      aptitudLabel(p),
      p.numeroSeguridadSocial ? formatSpanishSocialSecurityNumber(p.numeroSeguridadSocial) : '—',
      p.iban ? formatIban(p.iban) : '—',
    ]);
    row.height = isRenounced(p) ? 52 : 42;
    row.eachCell(cell => {
      cell.font = { name: 'Arial', size: 8 };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { top: { style: 'thin', color: { argb: 'DDDDDD' } }, left: { style: 'thin', color: { argb: 'DDDDDD' } }, bottom: { style: 'thin', color: { argb: 'DDDDDD' } }, right: { style: 'thin', color: { argb: 'DDDDDD' } } };
      if (index % 2 !== 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F0F7FF' } };
      if (isRenounced(p)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_HEX } };
        cell.font = { ...cell.font, color: { argb: '991B1B' }, bold: true };
      }
    });
  });

  worksheet.headerFooter = {
    oddFooter: '&LDiputación Provincial de Cádiz · Gestión de Fondos PROFEA&R Página &P de &N',
  };
  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer, filename: filename('xlsx') };
};
