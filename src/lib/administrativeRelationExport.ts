import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import type { Person } from '../../types';
import { getAptitudMedicaInfo } from '../../types';
import { applyInstitutionalPdfStandard, getBase64Image, renderInstitutionalReportHeader } from './exportUtils';
import { formatIban, formatSpanishSocialSecurityNumber } from './personalDataValidators';
import { sortRelationWorkers } from './relationExportOrdering';

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
const aptitudLabel = (p: Person) => {
  const { estado, limitaciones, validez } = getAptitudMedicaInfo(p);
  if (estado === 'Apto con limitaciones') return `APTO C/ LIMITACIONES\n${limitaciones || 'Sin detalle'}\nVálido ${validez}`;
  if (estado === 'Apto') return `APTO\nVálido ${validez}`;
  if (estado === 'No Apto') return 'NO APTO';
  return 'PENDIENTE';
};

const filename = (ext: 'pdf' | 'xlsx', people: Person[]) => {
  const obra = String(people[0]?.obra || 'SIN_OBRA')
    .trim()
    .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]/g, '_');
  return `PROFEA_RELACION_ADMINISTRATIVA_${obra}_${MONTH}.${ext}`;
};

export const prepareAdministrativeRelationPDF = (people: Person[]) => {
  people = sortRelationWorkers(people);
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
  const supervisor = people.find(person => person.supervisorResponsable?.trim())?.supervisorResponsable?.trim() || '';
  renderInstitutionalReportHeader(
    doc,
    'RELACIÓN ADMINISTRATIVA DE TRABAJADORES',
    [`${people.length} trabajador(es)`, supervisor ? `Supervisor: ${supervisor}` : ''].filter(Boolean).join(' · '),
    { subtitle: 'DESARROLLO LOCAL · GESTIÓN DE FONDOS PROFEA' },
  );

  const head = [[
    'OFERTA / CAT.',
    'TRABAJADOR / DNI / NACIMIENTO',
    'PERIODO CONTRATO',
    'CONTACTO',
    'APTITUD MÉDICA',
    'Nº SEGURIDAD SOCIAL',
    'CUENTA BANCARIA / IBAN'
  ]];

  const body = people.map(p => [
    `${p.numOferta || '—'}\n${p.categoria || '—'}`,
    `${p.apellidosNombre || '—'}\n${p.dni || '—'}\nNac.: ${formatDate(p.fechaNacimiento)}${isRenounced(p) ? '\nRENUNCIA' : ''}`,
    `Del ${formatDate(p.periodoInicio)}\nAl ${formatDate(p.periodoFin)}`,
    `${p.telefono || '—'}\n${p.obra || '—'}`,
    aptitudLabel(p),
    p.numeroSeguridadSocial ? formatSpanishSocialSecurityNumber(p.numeroSeguridadSocial) : '—',
    p.iban ? formatIban(p.iban) : '—',
  ]);

  const horizontalMargin = 14;
  const tableWidth = doc.internal.pageSize.getWidth() - (horizontalMargin * 2);

  autoTable(doc, {
    head,
    body,
    startY: 44,
    theme: 'grid',
    margin: { left: horizontalMargin, right: horizontalMargin, bottom: 18 },
    tableWidth,
    styles: { fontSize: 6.4, cellPadding: 1.8, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: BLUE, textColor: 255, fontStyle: 'bold', halign: 'center', fontSize: 6.4 },
    columnStyles: {
      // Total: 269 mm en A4 apaisado, dejando 14 mm a ambos lados.
      0: { cellWidth: 29, halign: 'center' },
      1: { cellWidth: 54 },
      2: { cellWidth: 32, halign: 'center' },
      3: { cellWidth: 36 },
      4: { cellWidth: 42 },
      5: { cellWidth: 33 },
      6: { cellWidth: 43 },
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

  applyInstitutionalPdfStandard(doc);
  return { doc, filename: filename('pdf', people) };
};

export const prepareAdministrativeRelationExcel = async (people: Person[]) => {
  people = sortRelationWorkers(people);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Diputación Provincial de Cádiz';
  workbook.company = 'Diputación Provincial de Cádiz';
  workbook.subject = 'Relación administrativa de trabajadores PROFEA';
  const worksheet = workbook.addWorksheet('Relación Administrativa', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
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

  const headers = [
    ['OFERTA / CAT.', 20],
    ['TRABAJADOR / DNI / NACIMIENTO', 48],
    ['PERIODO CONTRATO', 25],
    ['CONTACTO', 34],
    ['APTITUD MÉDICA', 34],
    ['Nº SEGURIDAD SOCIAL', 23],
    ['CUENTA BANCARIA / IBAN', 36],
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
      `${p.apellidosNombre || '—'}\n${p.dni || '—'}\nNac.: ${formatDate(p.fechaNacimiento)}${isRenounced(p) ? '\nRENUNCIA' : ''}`,
      `Del ${formatDate(p.periodoInicio)} al ${formatDate(p.periodoFin)}`,
      `${p.telefono || '—'}\n${p.obra || '—'}`,
      aptitudLabel(p),
      p.numeroSeguridadSocial ? formatSpanishSocialSecurityNumber(p.numeroSeguridadSocial) : '—',
      p.iban ? formatIban(p.iban) : '—',
    ]);
    row.height = 42;
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
  return { buffer, filename: filename('xlsx', people) };
};
