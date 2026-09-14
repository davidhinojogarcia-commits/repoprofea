
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import QRCode from 'qrcode';
import { Person, PdfCustomConfig, getAptitudMedicaInfo } from '../../types';
import { OFFICIAL_LOGO_BASE64 } from '../assets/logoData';
import { loadPdfPreferences, savePdfPreferences } from '../services/pdfPreferencesService';
export { OFFICIAL_LOGO_BASE64 };
export const LOGO_URL = OFFICIAL_LOGO_BASE64;

export const DEFAULT_PDF_CONFIG: Required<PdfCustomConfig> = {
  headerLine1: 'DIPUTACIÓN PROVINCIAL DE CÁDIZ',
  headerLine2: 'DESARROLLO LOCAL | GESTIÓN DE FONDOS PROFEA',
  footerText: 'Diputación Provincial de Cádiz | Gestión de Fondos PROFEA',
  customLogo: '',
  showTimestamp: true,
  showPageNumbers: true
};

let pdfConfigCache: Required<PdfCustomConfig> = { ...DEFAULT_PDF_CONFIG };
let pdfPreferencesHydrated = false;

const normalizePdfConfig = (value?: Partial<PdfCustomConfig>): Required<PdfCustomConfig> => ({
  headerLine1: value?.headerLine1 || DEFAULT_PDF_CONFIG.headerLine1,
  headerLine2: value?.headerLine2 || DEFAULT_PDF_CONFIG.headerLine2,
  footerText: value?.footerText || DEFAULT_PDF_CONFIG.footerText,
  customLogo: value?.customLogo || '',
  showTimestamp: value?.showTimestamp !== undefined ? Boolean(value.showTimestamp) : DEFAULT_PDF_CONFIG.showTimestamp,
  showPageNumbers: value?.showPageNumbers !== undefined ? Boolean(value.showPageNumbers) : DEFAULT_PDF_CONFIG.showPageNumbers,
});

export const hydrateStoredPdfConfig = async (): Promise<void> => {
  if (pdfPreferencesHydrated) return;
  const remote = await loadPdfPreferences();

  pdfConfigCache = normalizePdfConfig(remote);
  pdfPreferencesHydrated = true;
};

export const getStoredPdfConfig = (): Required<PdfCustomConfig> => ({ ...pdfConfigCache });

export const saveStoredPdfConfig = (config: Partial<PdfCustomConfig>): Required<PdfCustomConfig> => {
  pdfConfigCache = normalizePdfConfig({ ...pdfConfigCache, ...config });
  void savePdfPreferences(pdfConfigCache).catch(error =>
    console.warn('Error guardando configuración PDF en Supabase:', error)
  );
  return { ...pdfConfigCache };
};

export const formatDate = (date: string) => date ? date.split('-').reverse().join('/') : '-';

export const getBase64Image = async (url?: string): Promise<string> => {
  const config = getStoredPdfConfig();
  if (config.customLogo) {
    return config.customLogo;
  }
  if (!url || url.includes('dipucadiz.es') || url === OFFICIAL_LOGO_BASE64) {
    return OFFICIAL_LOGO_BASE64;
  }
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return OFFICIAL_LOGO_BASE64;
  }
};

export const renderPdfLogo = (
  doc: jsPDF,
  x: number,
  y: number,
  maxW: number = 52,
  maxH: number = 10,
  alignRight: boolean = true,
  customLogoOverride?: string
) => {
  const config = getStoredPdfConfig();
  const logoToUse = customLogoOverride || config.customLogo || OFFICIAL_LOGO_BASE64;
  if (!logoToUse) return;

  try {
    const imgProps = (doc as any).getImageProperties ? (doc as any).getImageProperties(logoToUse) : null;
    let w = maxW;
    let h = maxH;

    if (imgProps && imgProps.width && imgProps.height) {
      const ratio = imgProps.width / imgProps.height;
      w = maxW;
      h = w / ratio;
      if (h > maxH) {
        h = maxH;
        w = h * ratio;
      }
    }

    const posX = alignRight ? (x + maxW - w) : x;
    const posY = y + (maxH - h) / 2;
    const format = logoToUse.startsWith('data:image/jpeg') || logoToUse.startsWith('data:image/jpg') ? 'JPEG' : 'PNG';
    doc.addImage(logoToUse, format, posX, posY, w, h);
  } catch (err) {
    try {
      doc.addImage(logoToUse, 'PNG', x, y, maxW, maxH);
    } catch (e2) {
      console.warn('Error adding logo to PDF:', e2);
    }
  }
};

export const applyPdfFooters = (doc: jsPDF, customConfig?: Partial<PdfCustomConfig>) => {
  const config = { ...getStoredPdfConfig(), ...customConfig };
  const totalPages = (doc as any).internal.getNumberOfPages ? (doc as any).internal.getNumberOfPages() : 1;

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pageSize = doc.internal.pageSize;
    const pageHeight = pageSize.height || pageSize.getHeight();
    const pageWidth = pageSize.width || pageSize.getWidth();

    // Subtle divider line
    doc.setDrawColor(220, 225, 230);
    doc.setLineWidth(0.3);
    doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(130, 140, 150);

    const parts: string[] = [];
    if (config.footerText) parts.push(config.footerText);
    if (config.showTimestamp) parts.push(`Emitido: ${new Date().toLocaleString('es-ES')}`);

    const footerLeft = parts.join(' | ');
    if (footerLeft) {
      doc.text(footerLeft, 14, pageHeight - 7);
    }

    if (config.showPageNumbers) {
      doc.text(`Página ${i} de ${totalPages}`, pageWidth - 14, pageHeight - 7, { align: 'right' });
    }
  }
};

export const generateSamplePreviewPDF = (customConfig?: Partial<PdfCustomConfig>) => {
  const config = { ...getStoredPdfConfig(), ...customConfig };
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });

  // Header Lines
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(70, 80, 95);
  doc.text(config.headerLine1.toUpperCase(), 14, 12);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(110, 120, 135);
  doc.text(config.headerLine2.toUpperCase(), 14, 16);

  // Supervisor
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(BLUE_COLOR_RGB[0], BLUE_COLOR_RGB[1], BLUE_COLOR_RGB[2]);
  doc.text('SUPERVISOR: EJEMPLO DE RESPONSABLE TÉCNICO', 283, 18, { align: 'right' });

  // Logo
  renderPdfLogo(doc, 231, 4, 52, 10, true, config.customLogo);

  // Title
  doc.setFontSize(15);
  doc.text('DOCUMENTO DE MUESTRA · PERSONALIZACIÓN PDF', 14, 25);

  doc.setDrawColor(BLUE_COLOR_RGB[0], BLUE_COLOR_RGB[1], BLUE_COLOR_RGB[2]);
  doc.setLineWidth(0.6);
  doc.line(14, 28, 283, 28);

  const sampleColumns = ["Nº", "OBRA", "TRABAJADOR / DNI", "CATEGORÍA", "TELÉFONO", "FECHA INICIO", "ESTADO FORMACIÓN"];
  const sampleRows = [
    ["1", "REURBANIZACIÓN PLAZA MAYOR", "GARCÍA LÓPEZ, MANUEL\n12345678Z", "PEÓN ORDINARIO", "600 123 456", "01/10/2026", "APTO (PRL 20H)"],
    ["2", "ACONDICIONAMIENTO CAMINO RURAL", "FERNÁNDEZ RUIZ, CARMEN\n87654321A", "OFICIAL DE 1ª", "611 987 654", "01/10/2026", "APTO (PRL 20H)"],
    ["3", "PINTURA Y MANTENIMIENTO EDIFICIOS", "RODRÍGUEZ SÁNCHEZ, ANTONIO\n45678912B", "PEÓN ORDINARIO", "622 345 678", "16/10/2026", "PENDIENTE RECONOCIMIENTO"]
  ];

  autoTable(doc, {
    head: [sampleColumns],
    body: sampleRows,
    startY: 33,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 3, valign: 'middle', halign: 'center' as const },
    headStyles: { fillColor: BLUE_COLOR_RGB, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: LIGHT_BLUE_RGB }
  });

  applyPdfFooters(doc, config);

  const filename = `MUESTRA_PERSONALIZACION_PDF_${new Date().toISOString().slice(0, 10)}.pdf`;
  applyInstitutionalPdfStandard(doc);
  return { doc, filename };
};

const BLUE_COLOR_HEX = '00548E';
const LIGHT_BLUE_HEX = 'F0F7FF';
const BLUE_COLOR_RGB: [number, number, number] = [0, 84, 142];
const LIGHT_BLUE_RGB: [number, number, number] = [240, 247, 255];


const INSTITUTION_NAME = 'DIPUTACIÓN PROVINCIAL DE CÁDIZ';
const INSTITUTION_SERVICE = 'GESTIÓN DE FONDOS PROFEA';
const INSTITUTION_FOOTER = 'Diputación Provincial de Cádiz · Gestión de Fondos PROFEA';


/**
 * Cabecera institucional homogénea para informes de gestión PROFEA.
 * Mantiene el logotipo sobre fondo blanco para preservar su legibilidad y
 * separa identidad corporativa, título del documento y metadatos.
 */
const renderInstitutionalReportHeader = (
  doc: jsPDF,
  reportTitle: string,
  metaLine?: string
) => {
  const config = getStoredPdfConfig();

  // Banda institucional blanca: el logotipo nunca se coloca sobre el azul.
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, 210, 20, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(BLUE_COLOR_RGB[0], BLUE_COLOR_RGB[1], BLUE_COLOR_RGB[2]);
  doc.text((config.headerLine1 || INSTITUTION_NAME).toUpperCase(), 15, 8.2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(100, 116, 139);
  doc.text((config.headerLine2 || `DESARROLLO LOCAL | ${INSTITUTION_SERVICE}`).toUpperCase(), 15, 13.3);

  renderPdfLogo(doc, 142, 4.5, 53, 10.5, true, config.customLogo);

  doc.setDrawColor(218, 226, 233);
  doc.setLineWidth(0.25);
  doc.line(15, 18.2, 195, 18.2);

  // Banda de identificación del informe.
  doc.setFillColor(BLUE_COLOR_RGB[0], BLUE_COLOR_RGB[1], BLUE_COLOR_RGB[2]);
  doc.rect(0, 20, 210, 18, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.7);
  doc.setTextColor(255, 255, 255);
  doc.text(reportTitle.toUpperCase(), 15, 27.2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(226, 241, 249);
  const issued = `Generado el ${new Date().toLocaleDateString('es-ES')} a las ${new Date().toLocaleTimeString('es-ES')}`;
  doc.text(issued, 15, 32.3);

  if (metaLine?.trim()) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(240, 249, 255);
    doc.text(metaLine.toUpperCase(), 15, 36.1, { maxWidth: 180 });
  }

  // Acento secundario de la propia familia azul corporativa.
  doc.setFillColor(56, 189, 248);
  doc.rect(0, 38, 210, 1.6, 'F');
};

/**
 * Final institutional pass for every generated PDF.
 *
 * Individual reports may keep their specialised body/layout, but identity,
 * metadata and footer are always rendered through this common layer so every
 * exported document belongs to the same Diputación/PROFEA family.
 */
const applyInstitutionalPdfStandard = (doc: jsPDF) => {
  try {
    doc.setProperties({
      title: 'Documento de Gestión PROFEA',
      subject: 'Gestión de Fondos PROFEA',
      author: 'Diputación Provincial de Cádiz',
      creator: 'Sistema de Gestión PROFEA',
      keywords: 'Diputación de Cádiz, PROFEA, Gestión de Fondos PROFEA'
    });
  } catch {
    // Metadata support depends on the jsPDF runtime; visual standardisation
    // below remains mandatory even if metadata cannot be written.
  }

  const totalPages = (doc as any).internal.getNumberOfPages
    ? (doc as any).internal.getNumberOfPages()
    : 1;
  const issuedAt = new Date().toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page);
    const pageSize = doc.internal.pageSize;
    const pageHeight = pageSize.height || pageSize.getHeight();
    const pageWidth = pageSize.width || pageSize.getWidth();

    // Clear the legacy footer area first so specialised reports cannot leave
    // inconsistent copyright/developer footers underneath the official one.
    doc.setFillColor(255, 255, 255);
    doc.rect(0, pageHeight - 14, pageWidth, 14, 'F');

    doc.setDrawColor(BLUE_COLOR_RGB[0], BLUE_COLOR_RGB[1], BLUE_COLOR_RGB[2]);
    doc.setLineWidth(0.35);
    doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(0, 84, 142);
    doc.text(INSTITUTION_FOOTER, 14, pageHeight - 7);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Emitido: ${issuedAt}`, pageWidth / 2, pageHeight - 7, { align: 'center' });
    doc.text(`Página ${page} de ${totalPages}`, pageWidth - 14, pageHeight - 7, { align: 'right' });
  }
};

/** Common print/metadata standard for every XLSX export. */
const applyInstitutionalExcelStandard = (workbook: ExcelJS.Workbook, worksheet: ExcelJS.Worksheet) => {
  workbook.creator = 'Diputación Provincial de Cádiz';
  workbook.lastModifiedBy = 'Sistema de Gestión PROFEA';
  workbook.company = 'Diputación Provincial de Cádiz';
  workbook.subject = 'Gestión de Fondos PROFEA';
  workbook.category = 'Informe institucional';
  workbook.description = 'Documento generado por el Sistema de Gestión de Fondos PROFEA';
  workbook.created = new Date();
  workbook.modified = new Date();

  worksheet.pageSetup = {
    ...worksheet.pageSetup,
    fitToPage: true,
    fitToWidth: 1,
    margins: {
      left: 0.45,
      right: 0.45,
      top: 0.6,
      bottom: 0.6,
      header: 0.25,
      footer: 0.25,
      ...(worksheet.pageSetup?.margins || {})
    }
  };

  const header = `&L&9${INSTITUTION_NAME}&C&B&9${INSTITUTION_SERVICE}`;
  const footer = `&L&8${INSTITUTION_FOOTER}&R&8Página &P de &N`;
  worksheet.headerFooter = {
    ...worksheet.headerFooter,
    oddHeader: header,
    evenHeader: header,
    firstHeader: header,
    oddFooter: footer,
    evenFooter: footer,
    firstFooter: footer
  };

  // Unify typography without destroying semantic colours/bold states already
  // assigned to status cells by each specialised report.
  worksheet.eachRow(row => {
    row.eachCell(cell => {
      cell.font = { ...(cell.font || {}), name: 'Arial' };
      if (typeof cell.value === 'string' && cell.value.includes('David Hinojo García')) {
        cell.value = cell.value
          .replace(/©?\s*\d{4}\s*David Hinojo García\s*\|?\s*/gi, '')
          .replace(/©?\s*David Hinojo García\s*\|?\s*/gi, '')
          .trim();
        if (!String(cell.value).includes('Diputación')) {
          cell.value = INSTITUTION_FOOTER;
        }
      }
    });
  });
};

const generateExportFilename = (baseName: string, data: Person[], extension: string) => {
  const uniqueObras = Array.from(new Set(data.map(p => p.obra?.trim()))).filter(Boolean);
  const obraStr = uniqueObras.length > 0 
    ? (uniqueObras.length > 2 ? 'Multiples_Obras' : uniqueObras.join('-')) 
    : 'Sin_Obra';

  const uniqueMeses = Array.from(new Set(data.map(p => {
    const parts = p.quincena?.trim().split(/\s+/) || [];
    if (parts.length >= 2 && (parts[0] === '1ª' || parts[0] === '2ª' || parts[0] === 'Mes')) {
      return parts[1];
    }
    return parts[0] || 'Sin_Mes';
  }))).filter(Boolean);

  const mesStr = uniqueMeses.length > 0 
    ? (uniqueMeses.length > 2 ? 'Multiples_Meses' : uniqueMeses.join('-')) 
    : 'Sin_Mes';

  const cleanObra = obraStr.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]/g, '_');
  const cleanMes = mesStr.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]/g, '_');

  return `${baseName}_${cleanMes}_${cleanObra}.${extension}`;
};

export const preparePRLExcelData = async (dataToExport: Person[]) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Formación PRL 20h', {
    pageSetup: { 
      paperSize: 9, 
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
    }
  });

  const logoBase64 = await getBase64Image(LOGO_URL);
  if (logoBase64) {
    const imageId = workbook.addImage({
      base64: logoBase64,
      extension: 'png',
    });
    worksheet.addImage(imageId, {
      tl: { col: 0.2, row: 0.2 },
      ext: { width: 195, height: 30 }
    });
  }

  worksheet.mergeCells('E1:G1');
  const supervisorCell = worksheet.getCell('E1');
  supervisorCell.value = `SUPERVISOR RESPONSABLE: ${dataToExport[0]?.supervisorResponsable?.toUpperCase() || '-'}`;
  supervisorCell.font = { name: 'Arial', bold: true, size: 10, color: { argb: BLUE_COLOR_HEX } };
  supervisorCell.alignment = { horizontal: 'right' };

  worksheet.mergeCells('A4:G4');
  const mainTitle = worksheet.getCell('A4');
  mainTitle.value = `RELACIÓN TRABAJADORES SIN FORMACIÓN - PRL 20H`;
  mainTitle.font = { name: 'Arial', bold: true, size: 16, color: { argb: BLUE_COLOR_HEX } };
  mainTitle.alignment = { horizontal: 'center' };

  const columns = [
    { header: 'QUINCENA', key: 'quincena', width: 15 },
    { header: 'OBRA', key: 'obra', width: 25 },
    { header: 'TRABAJADOR (Apellidos y Nombre)', key: 'nombre', width: 40 },
    { header: 'DNI/NIE', key: 'dni', width: 15 },
    { header: 'FECHA NACIMIENTO', key: 'nacimiento', width: 15 },
    { header: 'PERIODO CONTRATO', key: 'periodo', width: 30 },
    { header: 'TELÉFONO', key: 'tel', width: 15 },
    { header: 'LUGAR DE FORMACIÓN', key: 'lugar', width: 35 },
    { header: 'ESTADO FORMACIÓN', key: 'estado', width: 20 },
  ];

  const headerRowNumber = 6;
  const headerRow = worksheet.getRow(headerRowNumber);
  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    worksheet.getColumn(idx + 1).width = col.width;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_COLOR_HEX } };
    cell.font = { color: { argb: 'FFFFFF' }, bold: true, size: 9 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  });
  headerRow.height = 25;

  dataToExport.forEach((p, index) => {
    const rowData = [
      p.quincena,
      p.obra,
      p.apellidosNombre,
      p.dni,
      formatDate(p.fechaNacimiento),
      `${formatDate(p.periodoInicio)} al ${formatDate(p.periodoFin)}`,
      p.telefono,
      p.lugarFormacion || '-',
      'SIN FORMACIÓN'
    ];
    const row = worksheet.addRow(rowData);
    row.height = 25;
    row.eachCell((cell, colNumber) => {
      cell.font = { size: 9 };
      if (colNumber === 6) cell.font = { ...cell.font, color: { argb: 'AA0000' }, bold: true };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { top: { style: 'thin', color: { argb: 'EEEEEE' } }, left: { style: 'thin', color: { argb: 'EEEEEE' } }, bottom: { style: 'thin', color: { argb: 'EEEEEE' } }, right: { style: 'thin', color: { argb: 'EEEEEE' } } };
      if (index % 2 !== 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BLUE_HEX } };
    });
  });

  // Footer Copyright row
  const copyrightRow = worksheet.addRow([]);
  worksheet.mergeCells(`A${copyrightRow.number}:I${copyrightRow.number}`);
  const copyrightCell = worksheet.getCell(`A${copyrightRow.number}`);
  copyrightCell.value = `Diputación Provincial de Cádiz | Gestión de Fondos PROFEA`;
  copyrightCell.font = { name: 'Arial', italic: true, size: 8, color: { argb: '777777' } };
  copyrightCell.alignment = { horizontal: 'left', vertical: 'middle' };
  copyrightRow.height = 20;

  applyInstitutionalExcelStandard(workbook, worksheet);
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = generateExportFilename('PROFEA_SIN_FORMACION_PRL', dataToExport, 'xlsx');
  return { buffer, filename };
};

export const preparePRLPDFData = (dataToExport: Person[]) => {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
  const config = getStoredPdfConfig();

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(70, 80, 95);
  doc.text(config.headerLine1.toUpperCase(), 14, 12);
  
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(110, 120, 135);
  doc.text(config.headerLine2.toUpperCase(), 14, 16);
  
  const supervisorName = dataToExport[0]?.supervisorResponsable || '-';
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(BLUE_COLOR_RGB[0], BLUE_COLOR_RGB[1], BLUE_COLOR_RGB[2]);
  doc.text(`SUPERVISOR: ${supervisorName.toUpperCase()}`, 283, 18, { align: 'right' });
  
  renderPdfLogo(doc, 231, 4, 52, 10, true, config.customLogo);

  doc.setFontSize(16);
  doc.text(`RELACIÓN TRABAJADORES SIN FORMACIÓN - PRL 20H`, 14, 26);
  
  doc.setDrawColor(BLUE_COLOR_RGB[0], BLUE_COLOR_RGB[1], BLUE_COLOR_RGB[2]);
  doc.setLineWidth(0.5);
  doc.line(14, 28, 283, 28);

  const tableColumn = ["QUINCENA", "OBRA", "TRABAJADOR / DNI / NAC.", "PERIODO CONTRATO", "TELÉFONO", "LUGAR FORMACIÓN", "ESTADO"];
  const tableRows = dataToExport.map(p => {
    return [
      p.quincena,
      p.obra,
      `${p.apellidosNombre}\n${p.dni}\nNac: ${formatDate(p.fechaNacimiento)}`,
      `Del ${formatDate(p.periodoInicio)}\nAl ${formatDate(p.periodoFin)}`,
      p.telefono,
      p.lugarFormacion || '-',
      'SIN FORMACIÓN'
    ];
  });

  autoTable(doc, {
    head: [tableColumn],
    body: tableRows,
    startY: 32,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3, valign: 'middle', halign: 'center' as const },
    headStyles: { fillColor: BLUE_COLOR_RGB, textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 40 },
      2: { cellWidth: 55 },
      3: { cellWidth: 35 },
      4: { cellWidth: 25 },
      5: { cellWidth: 55 },
      6: { cellWidth: 34 }
    },
    alternateRowStyles: { fillColor: LIGHT_BLUE_RGB },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 5) {
        data.cell.styles.textColor = [180, 0, 0];
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });

  applyPdfFooters(doc, config);

  const filename = generateExportFilename('PROFEA_SIN_FORMACION_PRL', dataToExport, 'pdf');
  applyInstitutionalPdfStandard(doc);
  return { doc, filename };
};

export const prepareRRMMExcelData = async (dataToExport: Person[]) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Reconocimientos Médicos', {
    pageSetup: { 
      paperSize: 9, 
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
    }
  });

  const logoBase64 = await getBase64Image(LOGO_URL);
  if (logoBase64) {
    const imageId = workbook.addImage({
      base64: logoBase64,
      extension: 'png',
    });
    worksheet.addImage(imageId, {
      tl: { col: 0.2, row: 0.2 },
      ext: { width: 195, height: 30 }
    });
  }

  worksheet.mergeCells('E1:G1');
  const supervisorCell = worksheet.getCell('E1');
  supervisorCell.value = `SUPERVISOR RESPONSABLE: ${dataToExport[0]?.supervisorResponsable?.toUpperCase() || '-'}`;
  supervisorCell.font = { name: 'Arial', bold: true, size: 10, color: { argb: BLUE_COLOR_HEX } };
  supervisorCell.alignment = { horizontal: 'right' };

  worksheet.mergeCells('A4:L4');
  const mainTitle = worksheet.getCell('A4');
  mainTitle.value = `RELACIÓN DE RECONOCIMIENTOS MÉDICOS`;
  mainTitle.font = { name: 'Arial', bold: true, size: 16, color: { argb: BLUE_COLOR_HEX } };
  mainTitle.alignment = { horizontal: 'center' };

  const columns = [
    { header: 'QUINCENA', key: 'quincena', width: 15 },
    { header: 'OBRA', key: 'obra', width: 25 },
    { header: 'CATEGORÍA', key: 'categoria', width: 15 },
    { header: 'TRABAJADOR (Apellidos y Nombre)', key: 'nombre', width: 35 },
    { header: 'DNI/NIE', key: 'dni', width: 15 },
    { header: 'FECHA NACIMIENTO', key: 'nacimiento', width: 15 },
    { header: 'TELÉFONO', key: 'tel', width: 15 },
    { header: 'DÍA CITA', key: 'dia', width: 15 },
    { header: 'HORA', key: 'hora', width: 10 },
    { header: 'SITIO RECONOCIMIENTO', key: 'sitio', width: 30 },
    { header: 'APTITUD RECONOCIMIENTO MÉDICO', key: 'resultado', width: 26 },
    { header: 'LIMITACIONES / VALIDEZ', key: 'limitaciones', width: 35 },
  ];

  const headerRowNumber = 6;
  const headerRow = worksheet.getRow(headerRowNumber);
  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    worksheet.getColumn(idx + 1).width = col.width;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_COLOR_HEX } };
    cell.font = { color: { argb: 'FFFFFF' }, bold: true, size: 9 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  });
  headerRow.height = 25;

  dataToExport.forEach((p, index) => {
    const { estado, limitaciones, validez } = getAptitudMedicaInfo(p);
    let aptitudLabel = 'PENDIENTE';
    let limitacionesLabel = '-';
    if (estado === 'Apto') {
      aptitudLabel = 'APTO';
      limitacionesLabel = `Sin limitaciones (Válido ${validez})`;
    } else if (estado === 'No Apto') {
      aptitudLabel = 'NO APTO';
      limitacionesLabel = p.reconocimientoObservaciones || 'No apto para el puesto';
    } else if (estado === 'Apto con limitaciones') {
      aptitudLabel = 'APTO C/ LIMITACIONES';
      limitacionesLabel = `${limitaciones || 'Restricciones laborales'}\n(Válido ${validez})`;
    } else if (p.reconocimientoEstado || p.aptitudMedica) {
      aptitudLabel = (p.aptitudMedica || p.reconocimientoEstado || '').toUpperCase();
    }

    const rowData = [
      p.quincena,
      p.obra,
      p.categoria,
      p.apellidosNombre,
      p.dni,
      formatDate(p.fechaNacimiento),
      p.telefono,
      formatDate(p.citaDia),
      p.citaHora,
      p.sitioReconocimiento,
      aptitudLabel,
      limitacionesLabel
    ];
    const row = worksheet.addRow(rowData);
    row.height = 28;
    row.eachCell((cell, colNumber) => {
      cell.font = { size: 9 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { top: { style: 'thin', color: { argb: 'EEEEEE' } }, left: { style: 'thin', color: { argb: 'EEEEEE' } }, bottom: { style: 'thin', color: { argb: 'EEEEEE' } }, right: { style: 'thin', color: { argb: 'EEEEEE' } } };
      if (index % 2 !== 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BLUE_HEX } };
      if (colNumber === 11) {
        if (cell.text.includes('NO APTO') || cell.text.includes('PENDIENTE')) {
          cell.font = { ...cell.font, color: { argb: 'AA0000' }, bold: true };
        } else if (cell.text.includes('LIMITACIÓN')) {
          cell.font = { ...cell.font, color: { argb: 'C06000' }, bold: true };
        } else if (cell.text.includes('APTO')) {
          cell.font = { ...cell.font, color: { argb: '008020' }, bold: true };
        }
      }
    });
  });

  // Footer Copyright row
  const copyrightRow = worksheet.addRow([]);
  worksheet.mergeCells(`A${copyrightRow.number}:L${copyrightRow.number}`);
  const copyrightCell = worksheet.getCell(`A${copyrightRow.number}`);
  copyrightCell.value = `Diputación Provincial de Cádiz | Gestión de Fondos PROFEA`;
  copyrightCell.font = { name: 'Arial', italic: true, size: 8, color: { argb: '777777' } };
  copyrightCell.alignment = { horizontal: 'left', vertical: 'middle' };
  copyrightRow.height = 20;

  applyInstitutionalExcelStandard(workbook, worksheet);
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = generateExportFilename('PROFEA_RRMM', dataToExport, 'xlsx');
  return { buffer, filename };
};

export const prepareRRMMPDFData = (dataToExport: Person[]) => {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
  const config = getStoredPdfConfig();

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(70, 80, 95);
  doc.text(config.headerLine1.toUpperCase(), 14, 12);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(110, 120, 135);
  doc.text(config.headerLine2.toUpperCase(), 14, 16);
  
  const supervisorName = dataToExport[0]?.supervisorResponsable || '-';
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(BLUE_COLOR_RGB[0], BLUE_COLOR_RGB[1], BLUE_COLOR_RGB[2]);
  doc.text(`SUPERVISOR: ${supervisorName.toUpperCase()}`, 283, 18, { align: 'right' });
  
  renderPdfLogo(doc, 231, 4, 52, 10, true, config.customLogo);

  doc.setFontSize(16);
  doc.text(`RELACIÓN DE RECONOCIMIENTOS MÉDICOS`, 14, 26);
  
  doc.setDrawColor(BLUE_COLOR_RGB[0], BLUE_COLOR_RGB[1], BLUE_COLOR_RGB[2]);
  doc.setLineWidth(0.5);
  doc.line(14, 28, 283, 28);

  const tableColumn = ["QUINCENA", "OBRA", "CATEGORÍA", "TRABAJADOR / DNI / NAC.", "TELÉFONO", "CITA (DÍA / HORA)", "SITIO RECONOCIMIENTO", "APTITUD / LIMITACIONES"];
  const tableRows = dataToExport.map(p => {
    const { estado, limitaciones, validez } = getAptitudMedicaInfo(p);
    let aptitudCell = 'PENDIENTE';
    if (estado === 'Apto') {
      aptitudCell = `APTO\n(Válido ${validez})`;
    } else if (estado === 'No Apto') {
      aptitudCell = 'NO APTO';
    } else if (estado === 'Apto con limitaciones') {
      aptitudCell = `APTO C/ LIMITACIONES\nLimitaciones: ${limitaciones || 'Sin especificar'}\n(Válido ${validez})`;
    } else if (p.reconocimientoEstado || p.aptitudMedica) {
      aptitudCell = (p.aptitudMedica || p.reconocimientoEstado || '').toUpperCase();
    }

    return [
      p.quincena,
      p.obra,
      p.categoria,
      `${p.apellidosNombre}\n${p.dni}\nNac: ${formatDate(p.fechaNacimiento)}`,
      p.telefono,
      `${formatDate(p.citaDia)}\n${p.citaHora}`,
      p.sitioReconocimiento,
      aptitudCell
    ];
  });

  autoTable(doc, {
    head: [tableColumn],
    body: tableRows,
    startY: 32,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2.5, valign: 'middle', halign: 'center' as const, overflow: 'linebreak' },
    headStyles: { fillColor: BLUE_COLOR_RGB, textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 30 },
      2: { cellWidth: 22 },
      3: { cellWidth: 46 },
      4: { cellWidth: 22 },
      5: { cellWidth: 24 },
      6: { cellWidth: 42 },
      7: { cellWidth: 65 }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 7) {
        const text = data.cell.text.join(' ');
        if (text.includes('NO APTO') || text.includes('PENDIENTE')) {
          data.cell.styles.textColor = [180, 0, 0];
          data.cell.styles.fontStyle = 'bold';
        } else if (text.includes('LIMITACIÓN') || text.includes('LIMITACIONES') || text.includes('LIMITACION')) {
          data.cell.styles.textColor = [190, 95, 0];
          data.cell.styles.fontStyle = 'bold';
        } else if (text.includes('APTO')) {
          data.cell.styles.textColor = [0, 120, 50];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
    alternateRowStyles: { fillColor: LIGHT_BLUE_RGB }
  });

  applyPdfFooters(doc, config);

  const filename = generateExportFilename('PROFEA_RRMM', dataToExport, 'pdf');
  applyInstitutionalPdfStandard(doc);
  return { doc, filename };
};

export const preparePRLLimitacionesPDFData = (dataToExport: Person[]) => {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
  const config = getStoredPdfConfig();

  // Filtrar exclusivamente trabajadores con limitaciones físicas detectadas
  const workersWithLimitations = dataToExport.filter(p => {
    const lim = p.reconocimientoLimitaciones?.trim();
    const estado = p.reconocimientoEstado?.trim();
    if (estado === 'Apto con Limitación') return true;
    if (!lim) return false;
    const lower = lim.toLowerCase();
    if (['ninguna', 'ninguno', 'sin limitaciones', 'sin restricción', 'sin restricciones', 'no', '-', 'ninguna limitación', 'sin limitacion', 'n/a'].includes(lower)) {
      return false;
    }
    return lim.length > 0;
  });

  // Cabecera institucional
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(70, 80, 95);
  doc.text(config.headerLine1.toUpperCase(), 14, 11);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(110, 120, 135);
  doc.text(`${config.headerLine2.toUpperCase()} | SERVICIO DE PREVENCIÓN DE RIESGOS LABORALES (PRL)`, 14, 15);

  const supervisorName = dataToExport[0]?.supervisorResponsable || '-';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(BLUE_COLOR_RGB[0], BLUE_COLOR_RGB[1], BLUE_COLOR_RGB[2]);
  doc.text(`SUPERVISOR: ${supervisorName.toUpperCase()}`, 283, 15, { align: 'right' });

  renderPdfLogo(doc, 231, 4, 52, 10, true, config.customLogo);

  // Título principal con tono preventivo destacado
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(180, 83, 9); // Amber-700
  doc.text('INFORME DE SITUACIÓN DE TRABAJADORES CON ESPECIAL ATENCIÓN', 14, 23);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(90, 100, 115);
  doc.text('VIGILANCIA DE LA SALUD Y ADAPTACIÓN DE PUESTOS EN OBRA · PROGRAMA PROFEA', 14, 27);

  // Cuadro de Confidencialidad y Uso Exclusivo en Obra
  doc.setFillColor(254, 243, 199); // Amber-100
  doc.setDrawColor(245, 158, 11); // Amber-500
  doc.setLineWidth(0.4);
  doc.roundedRect(14, 30, 269, 13, 2, 2, 'FD');

  doc.setFontSize(7.2);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(146, 64, 14); // Amber-800
  doc.text('AVISO DE CONFIDENCIALIDAD Y USO EN OBRA (Art. 22 y 32 bis Ley 31/1995 de Prevención de Riesgos Laborales):', 17, 34);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 53, 15); // Amber-950
  const noticeText = 'Informe para uso en obra reservado para el encargado de la obra (recurso preventivo). Contiene únicamente las limitaciones físicas y restricciones de aptitud laboral detectadas en los reconocimientos médicos de la plantilla, con la exclusiva finalidad de coordinar la adaptación ergonómica, preventiva y funcional de las tareas en cada obra.';
  const splitNotice = doc.splitTextToSize(noticeText, 263);
  doc.text(splitNotice, 17, 38);

  // Barra de métricas resumen
  const uniqueObras = Array.from(new Set(workersWithLimitations.map(p => p.obra?.trim()))).filter(Boolean);
  const currentYear = new Date().getFullYear();

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(50, 60, 75);
  doc.text(`Trabajadores con limitaciones detectadas: ${workersWithLimitations.length} | Obras afectadas: ${uniqueObras.length} | Ejercicio: ${currentYear} | Fecha de emisión: ${new Date().toLocaleDateString('es-ES')}`, 14, 47);

  const tableColumn = [
    "Nº",
    "TRABAJADOR / DNI / NAC.",
    "OBRA ASIGNADA / QUINCENA",
    "CATEGORÍA",
    "TELÉFONO",
    "APTITUD RECONOCIMIENTO MÉDICO",
    "LIMITACIONES FÍSICAS DETECTADAS (RESTRICCIONES)",
    "MEDIDAS PREVENTIVAS / ADAPTACIÓN REQUERIDA"
  ];

  const tableRows = workersWithLimitations.map((p, idx) => {
    const validez = p.reconocimientoValidez || currentYear.toString();
    const aptitud = `APTO C/ LIMITACIÓN\n(Válido: ${validez})`;
    const limText = p.reconocimientoLimitaciones?.trim() || 'Limitación médica detectada en aptitud laboral.';
    const obsText = p.reconocimientoObservaciones?.trim() || 'Coordinar con encargado: restringir levantamiento de cargas y sobreesfuerzos posturales.';

    return [
      (idx + 1).toString(),
      `${p.apellidosNombre}\n${p.dni}\nNac: ${formatDate(p.fechaNacimiento)}`,
      `${p.obra}\n${p.quincena}`,
      p.categoria,
      p.telefono,
      aptitud,
      limText,
      obsText
    ];
  });

  autoTable(doc, {
    head: [tableColumn],
    body: tableRows.length > 0 ? tableRows : [["-", "No se detectaron trabajadores con limitaciones físicas en la base de datos", "-", "-", "-", "-", "-", "-"]],
    startY: 50,
    theme: 'grid',
    styles: { 
      fontSize: 7.5, 
      cellPadding: 2.8, 
      valign: 'middle', 
      halign: 'center' as const, 
      overflow: 'linebreak' 
    },
    headStyles: { 
      fillColor: [180, 83, 9], // Amber-700
      textColor: 255, 
      fontStyle: 'bold',
      fontSize: 7.5
    },
    columnStyles: {
      0: { cellWidth: 9, halign: 'center' as const },
      1: { cellWidth: 46, halign: 'left' as const },
      2: { cellWidth: 38, halign: 'left' as const },
      3: { cellWidth: 24, halign: 'center' as const },
      4: { cellWidth: 20, halign: 'center' as const },
      5: { cellWidth: 26, halign: 'center' as const },
      6: { cellWidth: 62, halign: 'left' as const },
      7: { cellWidth: 44, halign: 'left' as const }
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        if (data.column.index === 6) {
          data.cell.styles.fillColor = [254, 243, 199]; // Resaltado en ámbar suave
          data.cell.styles.textColor = [146, 64, 14]; // Texto ámbar oscuro
          data.cell.styles.fontStyle = 'bold';
        }
        if (data.column.index === 5) {
          data.cell.styles.textColor = [180, 83, 9];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
    alternateRowStyles: { 
      fillColor: [255, 251, 235]
    }
  });

  applyPdfFooters(doc, config);

  const filename = generateExportFilename('PROFEA_PRL_LIMITACIONES_TECNICO', workersWithLimitations, 'pdf');
  applyInstitutionalPdfStandard(doc);
  return { doc, filename, count: workersWithLimitations.length };
};

export const prepareExcelData = async (dataToExport: Person[], allPeople?: Person[]) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Relación PROFEA', {
    pageSetup: { 
      paperSize: 9, 
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
    }
  });

  const logoBase64 = await getBase64Image(LOGO_URL);
  if (logoBase64) {
    const imageId = workbook.addImage({
      base64: logoBase64,
      extension: 'png',
    });
    worksheet.addImage(imageId, {
      tl: { col: 0.2, row: 0.2 },
      ext: { width: 195, height: 30 }
    });
  }

  worksheet.mergeCells('G1:O1');
  const supervisorCell = worksheet.getCell('G1');
  supervisorCell.value = `SUPERVISOR RESPONSABLE: ${dataToExport[0]?.supervisorResponsable?.toUpperCase() || '-'}`;
  supervisorCell.font = { name: 'Arial', bold: true, size: 10, color: { argb: BLUE_COLOR_HEX } };
  supervisorCell.alignment = { horizontal: 'right' };

  worksheet.mergeCells('G2:O2');
  const titleCell = worksheet.getCell('G2');
  titleCell.value = 'DIPUTACIÓN PROVINCIAL DE CÁDIZ';
  titleCell.font = { name: 'Arial', bold: false, size: 9, color: { argb: '777777' } };
  titleCell.alignment = { horizontal: 'right' };

  worksheet.mergeCells('A4:O4');
  const mainTitle = worksheet.getCell('A4');
  mainTitle.value = `RELACIÓN DE TRABAJADORES CONTRATADOS`;
  mainTitle.font = { name: 'Arial', bold: true, size: 16, color: { argb: BLUE_COLOR_HEX } };
  mainTitle.alignment = { horizontal: 'center' };

  const columns = [
    { header: 'Nº OFERTA', key: 'numOferta', width: 12 },
    { header: 'OBRA / PROYECTO', key: 'obra', width: 25 },
    { header: 'CATEGORÍA', key: 'categoria', width: 12 },
    { header: 'QUINCENA', key: 'quincena', width: 15 },
    { header: 'TRABAJADOR (Apellidos y Nombre)', key: 'nombre', width: 35 },
    { header: 'DNI/NIE', key: 'dni', width: 12 },
    { header: 'FECHA NACIMIENTO', key: 'nacimiento', width: 15 },
    { header: 'INICIO', key: 'inicio', width: 12 },
    { header: 'FIN', key: 'fin', width: 12 },
    { header: 'TELÉFONO', key: 'tel', width: 12 },
    { header: 'TALLA', key: 'talla', width: 8 },
    { header: 'FORMACIÓN / LUGAR', key: 'formacion', width: 28 },
    { header: 'CITA MÉDICA', key: 'medico', width: 30 },
    { header: 'APTITUD MÉDICA', key: 'aptitud', width: 35 },
    { header: 'DOC. / OBSERVACIONES', key: 'obs', width: 38 },
  ];

  const headerRowNumber = 6;
  const headerRow = worksheet.getRow(headerRowNumber);
  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    worksheet.getColumn(idx + 1).width = col.width;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_COLOR_HEX } };
    cell.font = { color: { argb: 'FFFFFF' }, bold: true, size: 8.5 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  });
  headerRow.height = 25;

  const fullList = allPeople || dataToExport;
  dataToExport.forEach((p, index) => {
    const cleanDni = p.dni?.trim().toUpperCase().replace(/[\s-]/g, '') || '';
    const otherPeriods = cleanDni 
      ? fullList.filter(x => x.dni?.trim().toUpperCase().replace(/[\s-]/g, '') === cleanDni && x.id !== p.id)
      : [];
    const isRepeater = otherPeriods.length > 0;
    
    const repeaterLabel = isRepeater ? ` [REPETIDOR - ${otherPeriods.length + 1} per.]` : '';
    const nameWithRepeater = `${p.apellidosNombre}${repeaterLabel}`;

    const otherPeriodsText = isRepeater 
      ? `\n* Historial Repetidor: ${otherPeriods.map(x => `${x.quincena || 'S/Q'} (${x.obra || 'S/O'})`).join(', ')}`
      : '';

    const { estado, limitaciones, validez } = getAptitudMedicaInfo(p);
    let aptitudLabel = 'PENDIENTE';
    if (estado === 'Apto') {
      aptitudLabel = `APTO\n(Válido ${validez})`;
    } else if (estado === 'No Apto') {
      aptitudLabel = 'NO APTO';
    } else if (estado === 'Apto con limitaciones') {
      aptitudLabel = `APTO CON LIMITACIONES\nLimitaciones: ${limitaciones || 'Sin especificar'}\n(Válido ${validez})`;
    } else if (p.reconocimientoEstado || p.aptitudMedica) {
      aptitudLabel = (p.aptitudMedica || p.reconocimientoEstado || '').toUpperCase();
    }

    const rowData = [
      p.numOferta,
      p.obra,
      p.categoria,
      p.quincena,
      nameWithRepeater,
      p.dni,
      formatDate(p.fechaNacimiento),
      formatDate(p.periodoInicio),
      formatDate(p.periodoFin),
      p.telefono,
      p.calzado,
      `Formación: ${p.formacion}\nLugar: ${p.lugarFormacion || '-'}`,
      `Cita: ${formatDate(p.citaDia)} ${p.citaHora}\nCentro: ${p.sitioReconocimiento}`,
      aptitudLabel,
      `Expediente: ${p.documentacionCompleta === 'Sí' ? 'COMPLETO' : 'PENDIENTE'}\nNotas: ${p.observaciones || '-'}${otherPeriodsText}`
    ];
    const row = worksheet.addRow(rowData);
    row.height = 35;
    row.eachCell((cell, colNumber) => {
      cell.font = { size: 8 };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { top: { style: 'thin', color: { argb: 'EEEEEE' } }, left: { style: 'thin', color: { argb: 'EEEEEE' } }, bottom: { style: 'thin', color: { argb: 'EEEEEE' } }, right: { style: 'thin', color: { argb: 'EEEEEE' } } };
      if (index % 2 !== 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BLUE_HEX } };
      if (cell.text.includes('PENDIENTE')) cell.font = { ...cell.font, color: { argb: 'AA0000' }, bold: true };
      if (colNumber === 14) {
        if (cell.text.includes('NO APTO')) {
          cell.font = { ...cell.font, color: { argb: 'AA0000' }, bold: true };
        } else if (cell.text.includes('LIMITACION') || cell.text.includes('LIMITACIÓN') || cell.text.includes('LIMITACIONES')) {
          cell.font = { ...cell.font, color: { argb: 'C06000' }, bold: true };
        } else if (cell.text.includes('APTO')) {
          cell.font = { ...cell.font, color: { argb: '008020' }, bold: true };
        }
      }
    });
  });

  // Footer Copyright row
  const copyrightRow = worksheet.addRow([]);
  worksheet.mergeCells(`A${copyrightRow.number}:O${copyrightRow.number}`);
  const copyrightCell = worksheet.getCell(`A${copyrightRow.number}`);
  copyrightCell.value = `Diputación Provincial de Cádiz | Gestión de Fondos PROFEA`;
  copyrightCell.font = { name: 'Arial', italic: true, size: 8, color: { argb: '777777' } };
  copyrightCell.alignment = { horizontal: 'left', vertical: 'middle' };
  copyrightRow.height = 20;

  applyInstitutionalExcelStandard(workbook, worksheet);
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = generateExportFilename('PROFEA_RELACION_CONTRATADOS', dataToExport, 'xlsx');
  return { buffer, filename };
};

export const preparePDFData = (dataToExport: Person[], allPeople?: Person[]) => {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
  const config = getStoredPdfConfig();
  const grouped: { [key: string]: Person[] } = {};
  dataToExport.forEach(p => {
    const key = `${p.quincena} - ${p.obra}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(p);
  });
  const groupKeys = Object.keys(grouped).sort();
  const fullList = allPeople || dataToExport;

  groupKeys.forEach((key, index) => {
    if (index > 0) doc.addPage();
    doc.setFontSize(8.5);
    doc.setTextColor(70, 80, 95);
    doc.setFont('helvetica', 'bold');
    doc.text(config.headerLine1.toUpperCase(), 14, 12);

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(110, 120, 135);
    doc.text(config.headerLine2.toUpperCase(), 14, 16);
    
    const supervisorName = grouped[key][0]?.supervisorResponsable || '-';
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(BLUE_COLOR_RGB[0], BLUE_COLOR_RGB[1], BLUE_COLOR_RGB[2]);
    doc.text(`SUPERVISOR: ${supervisorName.toUpperCase()}`, 283, 18, { align: 'right' });
    
    renderPdfLogo(doc, 231, 4, 52, 10, true, config.customLogo);
    
    const [quincena, ...obraParts] = key.split(' - ');
    const obra = obraParts.join(' - ');
    
    doc.setFontSize(14);
    doc.text(`RELACIÓN DE TRABAJADORES CONTRATADOS`, 14, 24);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`QUINCENA: ${quincena.toUpperCase()}`, 14, 30);
    doc.text(`OBRA: ${obra.toUpperCase()}`, 14, 35);
    
    doc.setDrawColor(BLUE_COLOR_RGB[0], BLUE_COLOR_RGB[1], BLUE_COLOR_RGB[2]);
    doc.setLineWidth(0.5);
    doc.line(14, 37, 283, 37);

    const tableColumn = ["OFERTA / CAT.", "TRABAJADOR / DNI / NAC.", "PERIODO CONTRATO", "CONTACTO / TALLA", "SEGURIDAD / FORMACIÓN", "CITA MÉDICA", "APTITUD MÉDICA", "DOC. / OBSERVACIONES"];
    const tableRows = grouped[key].map(p => {
      const cleanDni = p.dni?.trim().toUpperCase().replace(/[\s-]/g, '') || '';
      const otherPeriods = cleanDni 
        ? fullList.filter(x => x.dni?.trim().toUpperCase().replace(/[\s-]/g, '') === cleanDni && x.id !== p.id)
        : [];
      const isRepeater = otherPeriods.length > 0;
      
      const repeaterLabel = isRepeater ? `\n[REPETIDOR - ${otherPeriods.length + 1} per.]` : '';
      const nameCellContent = `${p.apellidosNombre}${repeaterLabel}\n${p.dni}\nNac: ${formatDate(p.fechaNacimiento)}`;

      const otherPeriodsText = isRepeater 
        ? `\n* Historial: ${otherPeriods.map(x => `${x.quincena || 'S/Q'}`).join(', ')}`
        : '';

      const { estado, limitaciones, validez } = getAptitudMedicaInfo(p);
      let aptitudPdf = 'PENDIENTE';
      if (estado === 'Apto') {
        aptitudPdf = `APTO\n(Válido ${validez})`;
      } else if (estado === 'No Apto') {
        aptitudPdf = 'NO APTO';
      } else if (estado === 'Apto con limitaciones') {
        aptitudPdf = `APTO C/ LIMITACIONES\nLimitaciones: ${limitaciones || 'Sin especificar'}\n(Válido ${validez})`;
      } else if (p.reconocimientoEstado || p.aptitudMedica) {
        aptitudPdf = (p.aptitudMedica || p.reconocimientoEstado || '').toUpperCase();
      }

      return [
        { content: `${p.numOferta}\n(${p.categoria})`, styles: { halign: 'center' as const } },
        { content: nameCellContent, styles: { fontStyle: 'bold' as const } },
        { content: `Del ${formatDate(p.periodoInicio)}\nAl ${formatDate(p.periodoFin)}`, styles: { halign: 'center' as const } },
        { content: `Tel: ${p.telefono}\nTalla: ${p.calzado}`, styles: { halign: 'center' as const } },
        { content: `Formación: ${p.formacion}\nLugar: ${p.lugarFormacion || '-'}` },
        { content: `Día: ${formatDate(p.citaDia)}\nHora: ${p.citaHora}\nCentro: ${p.sitioReconocimiento}` },
        { content: aptitudPdf },
        { content: `Exp: ${p.documentacionCompleta === 'Sí' ? 'OK' : 'PENDIENTE'}\nObs: ${p.observaciones || '-'}${otherPeriodsText}` }
      ];
    });

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 40,
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 2, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: BLUE_COLOR_RGB, textColor: 255, fontSize: 7.5, fontStyle: 'bold', halign: 'center' as const },
      columnStyles: { 
        0: { cellWidth: 22 }, 
        1: { cellWidth: 44 }, 
        2: { cellWidth: 28 }, 
        3: { cellWidth: 24 }, 
        4: { cellWidth: 32 }, 
        5: { cellWidth: 32 }, 
        6: { cellWidth: 52 }, 
        7: { cellWidth: 35 }
      },
      didParseCell: (data) => { 
        if (data.section === 'body') {
          const text = data.cell.text.join(' ');
          if (text.includes('PENDIENTE')) { 
            data.cell.styles.textColor = [180, 0, 0]; 
            data.cell.styles.fontStyle = 'bold'; 
          } else if (text.includes('NO APTO')) {
            data.cell.styles.textColor = [180, 0, 0];
            data.cell.styles.fontStyle = 'bold';
          } else if (text.includes('LIMITACIÓN') || text.includes('LIMITACIONES') || text.includes('LIMITACION')) {
            data.cell.styles.textColor = [190, 95, 0];
            data.cell.styles.fontStyle = 'bold';
          } else if (text.includes('APTO')) {
            data.cell.styles.textColor = [0, 120, 50];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
      alternateRowStyles: { fillColor: LIGHT_BLUE_RGB }
    });
  });
  applyPdfFooters(doc, config);
  const filename = generateExportFilename('PROFEA_RELACION_CONTRATADOS', dataToExport, 'pdf');
  applyInstitutionalPdfStandard(doc);
  return { doc, filename };
};

export const prepareCalzadoExcelData = async (dataToExport: Person[]) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Resumen Calzado', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 }
  });

  const logoBase64 = await getBase64Image(LOGO_URL);
  if (logoBase64) {
    const imageId = workbook.addImage({ base64: logoBase64, extension: 'png' });
    worksheet.addImage(imageId, { tl: { col: 0.2, row: 0.2 }, ext: { width: 195, height: 30 } });
  }

  worksheet.mergeCells('A4:D4');
  const mainTitle = worksheet.getCell('A4');
  mainTitle.value = `RESUMEN DE CALZADO POR TALLAS Y OBRAS`;
  mainTitle.font = { name: 'Arial', bold: true, size: 14, color: { argb: BLUE_COLOR_HEX } };
  mainTitle.alignment = { horizontal: 'center' };

  // Agrupar datos
  const summary: { [obra: string]: { [talla: string]: number } } = {};
  const allTallas = new Set<string>();
  const allObras = new Set<string>();

  dataToExport.forEach(p => {
    const obra = p.obra || 'SIN OBRA';
    const talla = p.calzado || 'S/T';
    allObras.add(obra);
    allTallas.add(talla);
    if (!summary[obra]) summary[obra] = {};
    summary[obra][talla] = (summary[obra][talla] || 0) + 1;
  });

  const sortedTallas = Array.from(allTallas).sort((a, b) => {
    const numA = parseInt(a);
    const numB = parseInt(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });
  const sortedObras = Array.from(allObras).sort();

  let currentRow = 6;

  sortedObras.forEach(obra => {
    worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
    const obraCell = worksheet.getCell(`A${currentRow}`);
    obraCell.value = `OBRA: ${obra.toUpperCase()}`;
    obraCell.font = { bold: true, color: { argb: BLUE_COLOR_HEX } };
    obraCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BLUE_HEX } };
    currentRow++;

    const headerRow = worksheet.getRow(currentRow);
    headerRow.getCell(1).value = 'TALLA';
    headerRow.getCell(2).value = 'CANTIDAD';
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_COLOR_HEX } };
      cell.alignment = { horizontal: 'center' };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });
    currentRow++;

    let totalObra = 0;
    sortedTallas.forEach(talla => {
      const cant = summary[obra][talla] || 0;
      if (cant > 0) {
        const row = worksheet.getRow(currentRow);
        row.getCell(1).value = talla;
        row.getCell(2).value = cant;
        row.eachCell(cell => {
          cell.alignment = { horizontal: 'center' };
          cell.border = { top: { style: 'thin', color: { argb: 'EEEEEE' } }, left: { style: 'thin', color: { argb: 'EEEEEE' } }, bottom: { style: 'thin', color: { argb: 'EEEEEE' } }, right: { style: 'thin', color: { argb: 'EEEEEE' } } };
        });
        totalObra += cant;
        currentRow++;
      }
    });

    const totalRow = worksheet.getRow(currentRow);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = totalObra;
    totalRow.eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F5F5F5' } };
      cell.alignment = { horizontal: 'center' };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });
    currentRow += 2;
  });

  // Footer Copyright row
  const copyrightRow = worksheet.addRow([]);
  worksheet.mergeCells(`A${copyrightRow.number}:D${copyrightRow.number}`);
  const copyrightCell = worksheet.getCell(`A${copyrightRow.number}`);
  copyrightCell.value = `Diputación Provincial de Cádiz | Gestión de Fondos PROFEA`;
  copyrightCell.font = { name: 'Arial', italic: true, size: 8, color: { argb: '777777' } };
  copyrightCell.alignment = { horizontal: 'left', vertical: 'middle' };
  copyrightRow.height = 20;

  applyInstitutionalExcelStandard(workbook, worksheet);
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = generateExportFilename('PROFEA_RESUMEN_CALZADO', dataToExport, 'xlsx');
  return { buffer, filename };
};

export const prepareCalzadoPDFData = (dataToExport: Person[]) => {
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4' });
  const config = getStoredPdfConfig();

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(70, 80, 95);
  doc.text(config.headerLine1.toUpperCase(), 14, 12);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(110, 120, 135);
  doc.text(config.headerLine2.toUpperCase(), 14, 16);
  
  renderPdfLogo(doc, 144, 4, 52, 10, true, config.customLogo);

  doc.setFontSize(16);
  doc.setTextColor(BLUE_COLOR_RGB[0], BLUE_COLOR_RGB[1], BLUE_COLOR_RGB[2]);
  doc.text(`RESUMEN DE CALZADO POR TALLAS`, 14, 26);
  
  doc.setDrawColor(BLUE_COLOR_RGB[0], BLUE_COLOR_RGB[1], BLUE_COLOR_RGB[2]);
  doc.setLineWidth(0.5);
  doc.line(14, 28, 196, 28);

  const summary: { [obra: string]: { [talla: string]: number } } = {};
  const allTallas = new Set<string>();
  const allObras = new Set<string>();

  dataToExport.forEach(p => {
    const obra = p.obra || 'SIN OBRA';
    const talla = p.calzado || 'S/T';
    allObras.add(obra);
    allTallas.add(talla);
    if (!summary[obra]) summary[obra] = {};
    summary[obra][talla] = (summary[obra][talla] || 0) + 1;
  });

  const sortedTallas = Array.from(allTallas).sort((a, b) => {
    const numA = parseInt(a);
    const numB = parseInt(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });
  const sortedObras = Array.from(allObras).sort();

  let currentY = 35;

  sortedObras.forEach((obra, index) => {
    if (currentY > 240) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(BLUE_COLOR_RGB[0], BLUE_COLOR_RGB[1], BLUE_COLOR_RGB[2]);
    doc.text(`OBRA: ${obra.toUpperCase()}`, 14, currentY);
    currentY += 5;

    const tableRows: any[] = sortedTallas
      .filter(t => (summary[obra][t] || 0) > 0)
      .map(t => [t, (summary[obra][t] || 0).toString()]);
    
    const totalObra = sortedTallas.reduce((acc, t) => acc + (summary[obra][t] || 0), 0);
    tableRows.push([{ content: 'TOTAL', styles: { fontStyle: 'bold', fillColor: [245, 245, 245] } }, { content: totalObra.toString(), styles: { fontStyle: 'bold', fillColor: [245, 245, 245] } }]);

    autoTable(doc, {
      head: [['TALLA', 'CANTIDAD']],
      body: tableRows,
      startY: currentY,
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2, halign: 'center' as const },
      headStyles: { fillColor: BLUE_COLOR_RGB, textColor: 255 },
      margin: { left: 14, right: 14 },
      tableWidth: 80
    });

    currentY = (doc as any).lastAutoTable.finalY + 15;
  });

  applyPdfFooters(doc, config);

  const filename = generateExportFilename('PROFEA_RESUMEN_CALZADO', dataToExport, 'pdf');
  applyInstitutionalPdfStandard(doc);
  return { doc, filename };
};

export const downloadExcel = (buffer: ExcelJS.Buffer, filename: string) => {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const downloadPDF = (doc: jsPDF, filename: string) => {
  doc.save(filename);
};

export const fallbackManualEmail = (asunto: string, cuerpo: string, pdfBlob: Blob, excelBlob: Blob, pdfName: string, excelName: string) => {
  const pdfUrl = URL.createObjectURL(pdfBlob);
  const excelUrl = URL.createObjectURL(excelBlob);
  
  const pdfLink = document.createElement('a');
  pdfLink.href = pdfUrl;
  pdfLink.download = pdfName;
  pdfLink.click();

  const excelLink = document.createElement('a');
  excelLink.href = excelUrl;
  excelLink.download = excelName;
  excelLink.click();

  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
  
  alert(`Se han descargado los archivos: ${pdfName} y ${excelName}.\n\nSe abrirá Gmail para que puedas enviar el correo.`);
  window.open(gmailUrl, '_blank');
};

export const handleEmailFiles = async (dataToExport: Person[], allPeople?: Person[]) => {
  if (dataToExport.length === 0) return alert('No hay datos para enviar.');

  try {
    const { doc, filename: pdfFilename } = preparePDFData(dataToExport, allPeople);
    const { buffer: excelBuffer, filename: excelFilename } = await prepareExcelData(dataToExport, allPeople);
    
    const pdfBlob = doc.output('blob');
    const excelBlob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    // Extracción de datos únicos para el asunto y cuerpo
    const obrasUnicas = Array.from(new Set(dataToExport.map(p => p.obra))).filter(Boolean).join(', ');
    const quincenasUnicas = Array.from(new Set(dataToExport.map(p => p.quincena))).filter(Boolean).join(', ');
    const mesesUnicos = Array.from(new Set(dataToExport.map(p => {
        const parts = p.quincena.split(' ');
        return parts.length >= 2 ? parts[1] : 'Mes no especificado';
    }))).filter(Boolean).join(', ');
    
    const supervisor = dataToExport[0]?.supervisorResponsable || 'Supervisor';

    // Configuración: Asunto con la obra y el mes, Cuerpo informal con quincena y obra
    const asunto = `Relación de trabajadores contratados de la obra ${obrasUnicas} y el mes ${mesesUnicos}`;
    const cuerpo = `Hola,\n\nTe paso la relación de los trabajadores contratados para la obra ${obrasUnicas}. Son los que pertenecen a la ${quincenasUnicas}.\n\nUn saludo,\n${supervisor}`;

    const filesArray = [
      new File([pdfBlob], pdfFilename, { type: 'application/pdf' }),
      new File([excelBlob], excelFilename, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    ];

    if (navigator.share && navigator.canShare && navigator.canShare({ files: filesArray })) {
      try {
        await navigator.share({
          files: filesArray,
          title: asunto,
          text: cuerpo,
        });
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.warn('Navigator.share falló:', err.message);
      }
    }

    fallbackManualEmail(asunto, cuerpo, pdfBlob, excelBlob, pdfFilename, excelFilename);

  } catch (error) {
    console.error('Error al preparar el envío:', error);
    alert('Se produjo un error al preparar los archivos.');
  }
};

export const generateWorkerIDCardPDF = async (selectedPerson: Person, allPeople: Person[]) => {
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4' });
  const cleanDni = selectedPerson.dni.trim().toUpperCase().replace(/[\s-]/g, '');
  const history = allPeople.filter(p => p.dni.trim().toUpperCase().replace(/[\s-]/g, '') === cleanDni);

  const appUrl = typeof window !== 'undefined' ? window.location.origin + window.location.pathname : 'https://ais-dev-z7d4v355a6bfwlbnq24eyg-269075130225.europe-west2.run.app';

  // The QR carries only the internal record id. Personal identifiers and medical data
  // remain behind Supabase authentication and row-level sharing permissions.
  const qrText = `${appUrl}?worker-profile=${encodeURIComponent(String(selectedPerson.id))}`;
  
  let qrCodeDataUrl = '';
  try {
    qrCodeDataUrl = await QRCode.toDataURL(qrText, { margin: 1, width: 250 });
  } catch (error) {
    console.error('Error generating QR code:', error);
  }

  // Draw Card Badge
  const badgeW = 95;
  const badgeH = 62;
  const badgeX = (210 - badgeW) / 2; // ~57.5
  const badgeY = 15;

  // Background card rounded container
  doc.setDrawColor(0, 84, 142);
  doc.setLineWidth(0.8);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 3, 3, 'FD');

  // Top header banner
  doc.setFillColor(0, 84, 142);
  doc.roundedRect(badgeX + 0.4, badgeY + 0.4, badgeW - 0.8, 12, 2.5, 2.5, 'F');
  doc.rect(badgeX + 0.4, badgeY + 8, badgeW - 0.8, 4.4, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text('DIPUTACIÓN PROVINCIAL DE CÁDIZ', badgeX + 4, badgeY + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('PROGRAMA PROFEA - TARJETA DE IDENTIFICACIÓN', badgeX + 4, badgeY + 9);

  // Logo if loaded
  try {
    const logoBase64 = await getBase64Image(LOGO_URL);
    if (logoBase64) {
      doc.addImage(logoBase64, 'PNG', badgeX + badgeW - 27, badgeY + 2.5, 24, 3.7);
    }
  } catch (err) {
    console.warn('Logo addition failed:', err);
  }

  doc.setTextColor(30, 41, 59);

  // Worker detail texts on Badge:
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  
  const rawName = selectedPerson.apellidosNombre.toUpperCase();
  const displayName = rawName.length > 28 ? rawName.slice(0, 26) + '...' : rawName;
  doc.text(displayName, badgeX + 4, badgeY + 19);

  const drawBadgeLine = (label: string, value: string, textY: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(label, badgeX + 4, textY);
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(15, 23, 42);
    const splitVal = doc.splitTextToSize(value || '-', 50);
    doc.text(splitVal, badgeX + 18, textY);
    return splitVal.length;
  };

  drawBadgeLine('DNI / NIE:', selectedPerson.dni, badgeY + 24);
  drawBadgeLine('CATEGORÍA:', selectedPerson.categoria, badgeY + 28);
  
  const rawObra = selectedPerson.obra || '-';
  const displayObra = rawObra.length > 60 ? rawObra.slice(0, 57) + '...' : rawObra;
  drawBadgeLine('OBRA:', displayObra, badgeY + 32);
  
  drawBadgeLine('CONTRATO:', `${formatDate(selectedPerson.periodoInicio)} a ${formatDate(selectedPerson.periodoFin)}`, badgeY + 41);

  if (qrCodeDataUrl) {
    const qrSize = 22;
    const qrX = badgeX + badgeW - 27;
    const qrY = badgeY + 15;
    doc.addImage(qrCodeDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    doc.setTextColor(120, 120, 120);
    doc.text('CÓDIGO QR', qrX + qrSize/2, qrY + qrSize + 2, { align: 'center' });
    doc.text('IDENTIFICATIVO', qrX + qrSize/2, qrY + qrSize + 4, { align: 'center' });
  }

  // Divider and footer in badge
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(badgeX + 2, badgeY + 54, badgeX + badgeW - 2, badgeY + 54);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(5.5);
  doc.setTextColor(148, 163, 184);
  doc.text('Identificador oficial no transferible.', badgeX + 4, badgeY + 57.5);
  doc.setFont('helvetica', 'normal');
  doc.text('Tel: ' + selectedPerson.telefono, badgeX + badgeW - 4, badgeY + 57.5, { align: 'right' });

  // Cutting Line
  doc.setDrawColor(148, 163, 184);
  doc.setLineDashPattern([2, 2], 0);
  doc.setLineWidth(0.3);
  doc.line(15, 83, 195, 83);
  doc.setLineDashPattern([], 0); // Reset dash style

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('✂  RECORTAR CREDENCIAL DEL TRABAJADOR  ✂', 105, 87, { align: 'center' });

  // Complete data header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 84, 142);
  doc.text('FICHA COMPLETA DEL TRABAJADOR CONTRATADO', 15, 96);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('A continuación se detallan de forma exhaustiva todos los datos de contratación registrados para este trabajador:', 15, 100.5);

  doc.setDrawColor(0, 84, 142);
  doc.setLineWidth(0.4);
  doc.line(15, 102.5, 195, 102.5);

  // Print structured grid
  let currY = 108.5;
  
  const printField = (label: string, value: string, x: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(label, x, currY);
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    const wrap = doc.splitTextToSize(value || '-', 50);
    doc.text(wrap, x + 35, currY);
    return wrap.length * 4;
  };

  printField('Apellidos y Nombre:', selectedPerson.apellidosNombre, 15);
  let h1 = printField('Supervisor Resp.:', selectedPerson.supervisorResponsable, 110);
  currY += Math.max(5.5, h1);

  printField('DNI / NIE:', selectedPerson.dni, 15);
  let h2 = printField('Nº Oferta Ocupación:', selectedPerson.numOferta, 110);
  currY += Math.max(5.5, h2);

  printField('Fecha Nacimiento:', formatDate(selectedPerson.fechaNacimiento), 15);
  let h3 = printField('Obra / Proyecto:', selectedPerson.obra, 110);
  currY += Math.max(5.5, h3);

  printField('Teléfono Contacto:', selectedPerson.telefono, 15);
  let h4 = printField('Quincena de Alta:', selectedPerson.quincena, 110);
  currY += Math.max(5.5, h4);

  printField('Talla Calzado:', selectedPerson.calzado, 15);
  let h5 = printField('Período de Contrato:', `${formatDate(selectedPerson.periodoInicio)} al ${formatDate(selectedPerson.periodoFin)}`, 110);
  currY += Math.max(5.5, h5);

  printField('Formación PRL 20h:', selectedPerson.formacion, 15);
  let h6 = printField('Lugar Formación:', selectedPerson.lugarFormacion || '-', 110);
  currY += Math.max(5.5, h6);

  printField('Día Cita Médica:', formatDate(selectedPerson.citaDia), 15);
  let h7 = printField('Hora Cita Médica:', selectedPerson.citaHora || '-', 110);
  currY += Math.max(5.5, h7);

  printField('Carpeta Expediente:', selectedPerson.documentacionCompleta === 'Sí' ? 'COMPLETA (OK)' : 'PENDIENTE', 15);
  let h8 = printField('Centro Reconocimiento:', selectedPerson.sitioReconocimiento || '-', 110);
  currY += Math.max(5.5, h8);

  // Aptitud Médica en la Ficha Completa del Trabajador
  const { estado: aptEstado, limitaciones: aptLim, validez: aptVal } = getAptitudMedicaInfo(selectedPerson);
  let aptLabel = aptEstado as string;
  if (aptEstado === 'Apto con limitaciones') {
    aptLabel = `Apto c/ Limitaciones: ${aptLim || 'Restricciones laborales'}`;
  } else if (aptEstado === 'Apto') {
    aptLabel = `Apto (Válido ${aptVal})`;
  } else if (aptEstado === 'No Apto') {
    aptLabel = 'NO APTO (Contratación No Autorizada)';
  }
  let hApt = printField('Aptitud Médica:', aptLabel, 15);
  currY += Math.max(5.5, hApt) + 1;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Observaciones:', 15, currY);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const wrappedObs = doc.splitTextToSize(selectedPerson.observaciones || 'Sin observaciones registradas.', 140);
  doc.text(wrappedObs, 45, currY);
  currY += wrappedObs.length * 4.5 + 6;

  // History section
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 84, 142);
  doc.text('HISTORIAL DE CONTRATACIONES REGISTRADAS', 15, currY);
  currY += 4.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('Siguiente desglose de todas las obras y periodos de contratación históricos registrados bajo este mismo DNI:', 15, currY);
  currY += 4.5;

  const historyColumns = [
    { title: 'Quincena / Mes', dataKey: 'quincena' },
    { title: 'Obra', dataKey: 'obra' },
    { title: 'Categoría', dataKey: 'categoria' },
    { title: 'Período Contrato', dataKey: 'periodo' },
    { title: 'Aptitud Médica', dataKey: 'aptitud' },
    { title: 'Nº Oferta', dataKey: 'numOferta' },
    { title: 'Supervisor Responsable', dataKey: 'supervisor' }
  ];

  const historyRows = history.map(p => {
    const { estado, limitaciones, validez } = getAptitudMedicaInfo(p);
    let aptStr = estado as string;
    if (estado === 'Apto con limitaciones') {
      aptStr = limitaciones ? `Apto c/ lim.: ${limitaciones}` : 'Apto c/ limitaciones';
    } else if (estado === 'Apto') {
      aptStr = `Apto (${validez})`;
    }
    return {
      quincena: p.quincena,
      obra: p.obra,
      categoria: p.categoria,
      periodo: `${formatDate(p.periodoInicio)} a ${formatDate(p.periodoFin)}`,
      aptitud: aptStr,
      numOferta: p.numOferta,
      supervisor: p.supervisorResponsable
    };
  });

  autoTable(doc, {
    columns: historyColumns,
    body: historyRows,
    startY: currY,
    theme: 'striped',
    headStyles: {
      fillColor: [0, 84, 142],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'center'
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [33, 41, 54]
    },
    columnStyles: {
      quincena: { cellWidth: 26 },
      obra: { cellWidth: 38 },
      categoria: { cellWidth: 22 },
      periodo: { cellWidth: 30, halign: 'center' },
      aptitud: { cellWidth: 32, halign: 'center' },
      numOferta: { cellWidth: 16, halign: 'center' },
      supervisor: { cellWidth: 16 }
    },
    margin: { left: 15, right: 15 },
    didDrawPage: (data) => {
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.setFont('helvetica', 'normal');
      doc.text(`Documento de gestión interna | Diputación Provincial de Cádiz · Gestión de Fondos PROFEA`, 15, 287);
      doc.text(`Página ${data.pageNumber} de ${pageCount}`, 195, 287, { align: 'right' });
    }
  });

  const filename = `CARNE_PROFEA_${selectedPerson.apellidosNombre.replace(/[\s,]+/g, '_')}_${cleanDni}.pdf`;
  applyInstitutionalPdfStandard(doc);
  return { doc, filename };
};

export const generateWorkerHistoryOnlyPDF = async (selectedPerson: Person, allPeople: Person[]) => {
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4' });
  const cleanDni = selectedPerson.dni.trim().toUpperCase().replace(/[\s-]/g, '');
  
  // Get all historic contracts for this employee
  const history = allPeople
    .filter(p => p.dni.trim().toUpperCase().replace(/[\s-]/g, '') === cleanDni)
    .sort((a, b) => b.periodoInicio.localeCompare(a.periodoInicio)); // Sort descending (most recent first)

  // Header band
  doc.setFillColor(0, 84, 142);
  doc.rect(0, 0, 210, 32, 'F');

  // Title text in white
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text('INFORME HISTÓRICO DE CONTRATACIONES', 15, 14);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('GESTIÓN DE FONDOS PROFEA · DIPUTACIÓN PROVINCIAL DE CÁDIZ', 15, 20);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.text(`Expediente unificado de contratación para el DNI: ${selectedPerson.dni}`, 15, 25);

  // Logo if loaded
  try {
    const logoBase64 = await getBase64Image(LOGO_URL);
    if (logoBase64) {
      doc.addImage(logoBase64, 'PNG', 145, 5, 52, 8);
    }
  } catch (err) {
    console.warn('Logo addition failed:', err);
  }

  // Personal data panel
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.roundedRect(15, 40, 180, 52, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text('DATOS CONSOLIDADOS DEL TRABAJADOR', 20, 47);

  // Divider
  doc.setDrawColor(226, 232, 240);
  doc.line(20, 50, 190, 50);

  const drawInfoField = (label: string, value: string, x: number, y: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(label, x, y);
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(value || '-', x + 34, y);
  };

  drawInfoField('Apellidos y Nombre:', selectedPerson.apellidosNombre, 20, 56);
  drawInfoField('NIF / DNI / NIE:', selectedPerson.dni, 20, 62);
  drawInfoField('Fecha Nacimiento:', formatDate(selectedPerson.fechaNacimiento), 20, 68);
  drawInfoField('Teléfono Móvil:', selectedPerson.telefono, 20, 74);
  drawInfoField('Talla de Calzado:', selectedPerson.calzado, 20, 80);

  drawInfoField('Formación PRL 20h:', selectedPerson.formacion, 110, 56);
  drawInfoField('Lugar de Formación:', selectedPerson.lugarFormacion || '-', 110, 62);
  drawInfoField('Cita Reconocimiento:', `${formatDate(selectedPerson.citaDia)} ${selectedPerson.citaHora || ''}`, 110, 68);
  drawInfoField('Centro Médico:', selectedPerson.sitioReconocimiento || '-', 110, 74);
  drawInfoField('Expediente Completo:', selectedPerson.documentacionCompleta === 'Sí' ? 'SÍ (Documentación OK)' : 'PENDIENTE', 110, 80);

  // Aptitud Médica en Datos Consolidados
  const { estado: aptEstado, limitaciones: aptLim, validez: aptVal } = getAptitudMedicaInfo(selectedPerson);
  let aptLabel = aptEstado as string;
  if (aptEstado === 'Apto con limitaciones') {
    aptLabel = `Apto c/ Limitaciones: ${aptLim || 'Restricciones laborales'}`;
  } else if (aptEstado === 'Apto') {
    aptLabel = `Apto (Válido ${aptVal})`;
  } else if (aptEstado === 'No Apto') {
    aptLabel = 'NO APTO (Contratación No Autorizada)';
  }
  drawInfoField('Aptitud Médica:', aptLabel, 20, 86);

  // KPI boxes below the personal section
  const uniqueObras = new Set(history.map(h => h.obra?.trim()).filter(Boolean)).size;

  doc.setFillColor(241, 245, 249);
  doc.roundedRect(15, 96, 56, 15, 3, 3, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('CONTRATOS REGISTRADOS', 18, 100);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 84, 142);
  doc.text(`${history.length} contratos`, 18, 107);

  doc.setFillColor(241, 245, 249);
  doc.roundedRect(77, 96, 56, 15, 3, 3, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('OBRAS PARTICIPADAS', 80, 100);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 84, 142);
  doc.text(`${uniqueObras} obras distintas`, 80, 107);

  doc.setFillColor(241, 245, 249);
  doc.roundedRect(139, 96, 56, 15, 3, 3, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('ÚLTIMA ASIGNACIÓN', 142, 100);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 84, 142);
  const latestObra = history[0]?.obra || '-';
  const displayLatestObra = latestObra.length > 24 ? latestObra.slice(0, 22) + '...' : latestObra;
  doc.text(displayLatestObra, 142, 107);

  // History table title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 84, 142);
  doc.text('CRONOLOGÍA COMPLETA DE CONTRATACIONES', 15, 122);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Lista ordenada cronológicamente de todas las actas de contratación del trabajador histórico:', 15, 126.5);

  const historyColumns = [
    { title: 'Quincena / Mes', dataKey: 'quincena' },
    { title: 'Obra', dataKey: 'obra' },
    { title: 'Categoría', dataKey: 'categoria' },
    { title: 'Período Contrato', dataKey: 'periodo' },
    { title: 'Aptitud Médica', dataKey: 'aptitud' },
    { title: 'Nº Oferta', dataKey: 'numOferta' },
    { title: 'Supervisor Responsable', dataKey: 'supervisor' }
  ];

  const historyRows = history.map(p => {
    const { estado, limitaciones, validez } = getAptitudMedicaInfo(p);
    let aptStr = estado as string;
    if (estado === 'Apto con limitaciones') {
      aptStr = limitaciones ? `Apto c/ lim.: ${limitaciones}` : 'Apto c/ limitaciones';
    } else if (estado === 'Apto') {
      aptStr = `Apto (${validez})`;
    }
    return {
      quincena: p.quincena,
      obra: p.obra,
      categoria: p.categoria,
      periodo: `${formatDate(p.periodoInicio)} a ${formatDate(p.periodoFin)}`,
      aptitud: aptStr,
      numOferta: p.numOferta,
      supervisor: p.supervisorResponsable
    };
  });

  autoTable(doc, {
    columns: historyColumns,
    body: historyRows,
    startY: 130,
    theme: 'grid',
    headStyles: {
      fillColor: [0, 84, 142],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'center'
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [33, 41, 54]
    },
    columnStyles: {
      quincena: { cellWidth: 26 },
      obra: { cellWidth: 38 },
      categoria: { cellWidth: 22 },
      periodo: { cellWidth: 30, halign: 'center' },
      aptitud: { cellWidth: 32, halign: 'center' },
      numOferta: { cellWidth: 16, halign: 'center' },
      supervisor: { cellWidth: 16 }
    },
    margin: { left: 15, right: 15 },
    didDrawPage: (data) => {
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.setFont('helvetica', 'normal');
      doc.text(`Informe generado: ${new Date().toLocaleDateString('es-ES')} | © David Hinojo García | PROFEA Cádiz`, 15, 287);
      doc.text(`Página ${data.pageNumber} de ${pageCount}`, 195, 287, { align: 'right' });
    }
  });

  const filename = `HISTORIAL_CONTRATOS_${selectedPerson.apellidosNombre.replace(/[\s,]+/g, '_')}_${cleanDni}.pdf`;
  applyInstitutionalPdfStandard(doc);
  return { doc, filename };
};

export const generatePeriodicReportPDF = async (
  filteredPeople: Person[], 
  periodLabel: string, 
  supervisorName?: string, 
  zonaName?: string
) => {
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4' });
  const totalContracts = filteredPeople.length;
  const uniqueDnis = new Set(filteredPeople.map(p => p.dni.trim().toUpperCase().replace(/[\s-]/g, ''))).size;
  const uniqueObras = new Set(filteredPeople.map(p => p.obra.trim()).filter(Boolean)).size;
  const prlCount = filteredPeople.filter(p => p.formacion === 'Sí').length;
  const prlPercent = totalContracts > 0 ? Math.round((prlCount / totalContracts) * 100) : 0;

  const dniCounts: { [key: string]: number } = {};
  filteredPeople.forEach(p => {
    const dni = p.dni.trim().toUpperCase().replace(/[\s-]/g, '');
    if (dni) {
      dniCounts[dni] = (dniCounts[dni] || 0) + 1;
    }
  });
  const repeatedWorkersCount = Object.values(dniCounts).filter(count => count > 1).length;

  // --- PAGE 1: INSTITUTIONAL COVER & EXECUTIVE DASHBOARD ---
  const supervisorPart = supervisorName ? `SUPERVISOR RESPONSABLE: ${supervisorName}` : '';
  const zonaPart = zonaName ? `ZONA: ${zonaName}` : '';
  const headerMeta = [supervisorPart, zonaPart].filter(Boolean).join('   |   ');
  renderInstitutionalReportHeader(
    doc,
    'PROGRAMA PROFEA · INFORME DE CONTRATACIÓN',
    headerMeta
  );

  // Large Period subtitle
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(`PERIODO DE ANÁLISIS: ${periodLabel.toUpperCase()}`, 15, 52);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Este documento formal consolida las contrataciones efectuadas bajo las condiciones de búsqueda seleccionadas,', 15, 57);
  doc.text('desglosando datos demográficos de la plantilla, proyectos asignados y certificaciones médicas/PRL.', 15, 61);

  // Draw 4 aesthetic KPI cards
  const drawKpiCard = (title: string, value: string, x: number, y: number, w: number, h: number, description: string) => {
    // Card background
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.4);
    doc.roundedRect(x, y, w, h, 2.5, 2.5, 'FD');

    // Title label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(title, x + 4, y + 5.5);

    // Huge bold value
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(0, 84, 142);
    doc.text(value, x + 4, y + 13.5);

    // Decorative mini-line
    doc.setFillColor(0, 84, 142);
    doc.rect(x + 4, y + 16, 10, 0.6, 'F');

    // Bottom tiny caption
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(description, x + 4, y + 21);
  };

  const cardW = 33;
  const cardH = 24;
  const startCardY = 67;

  drawKpiCard('CONTRATOS TOTALES', `${totalContracts} altas`, 15, startCardY, cardW, cardH, 'Registros procesados');
  drawKpiCard('PERSONAL ÚNICO', `${uniqueDnis} operarios`, 51.75, startCardY, cardW, cardH, 'NIFs consolidados');
  drawKpiCard('CENTROS / OBRAS', `${uniqueObras} proyectos`, 88.5, startCardY, cardW, cardH, 'En ejecución');
  drawKpiCard('FORMACIÓN PRL', `${prlPercent}% apto`, 125.25, startCardY, cardW, cardH, `${prlCount} con curso 20h`);
  drawKpiCard('TRAB. REPETIDOS', `${repeatedWorkersCount} repetidos`, 162.0, startCardY, cardW, cardH, 'Con >1 contrato');

  // Section titles for groupings
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(0, 84, 142);
  doc.text('RESUMEN DE ASIGNACIONES POR OBRA / PROYECTO', 15, 102);

  // Compute breakdown of Obras
  const obraMap: { [key: string]: number } = {};
  filteredPeople.forEach(p => {
    if (p.obra) obraMap[p.obra] = (obraMap[p.obra] || 0) + 1;
  });
  const obraBreakdown = Object.entries(obraMap)
    .map(([name, count]) => ({
      name,
      count,
      percent: totalContracts > 0 ? `${Math.round((count / totalContracts) * 100)} %` : '0 %'
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6); // Top 6 works to fit page elegantly

  const obraCols = [
    { title: 'Obra / Proyecto Escenario', dataKey: 'name' },
    { title: 'Personal Contratado', dataKey: 'count', style: { halign: 'center' } },
    { title: 'Representación %', dataKey: 'percent', style: { halign: 'center' } }
  ];

  autoTable(doc, {
    columns: obraCols,
    body: obraBreakdown,
    startY: 106,
    theme: 'striped',
    styles: { fontSize: 7.5 },
    headStyles: { fillColor: [0, 84, 142], textColor: [255, 255, 255], fontStyle: 'bold' },
    margin: { left: 15, right: 15 },
    tableWidth: 'auto'
  });

  // Section: Demographics by Category
  const finalYOfObraTable = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : 160;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(0, 84, 142);
  doc.text('DISTRIBUCIÓN POR CATEGORÍA PROFESIONAL', 15, finalYOfObraTable);

  const catMap: { [key: string]: number } = {};
  filteredPeople.forEach(p => {
    if (p.categoria) catMap[p.categoria] = (catMap[p.categoria] || 0) + 1;
  });
  const catBreakdown = Object.entries(catMap)
    .map(([cat, count]) => ({
      categoria: cat,
      count,
      percent: totalContracts > 0 ? `${Math.round((count / totalContracts) * 100)} %` : '0 %'
    }))
    .sort((a, b) => b.count - a.count);

  const catCols = [
    { title: 'Categoría Ocupacional', dataKey: 'categoria' },
    { title: 'Personal Contratado', dataKey: 'count' },
    { title: 'Fracción de Obra', dataKey: 'percent' }
  ];

  autoTable(doc, {
    columns: catCols,
    body: catBreakdown,
    startY: finalYOfObraTable + 4,
    theme: 'grid',
    styles: { fontSize: 7.5 },
    headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255], fontStyle: 'bold' },
    margin: { left: 15, right: 15 },
    tableWidth: 'auto'
  });

  // --- PAGE 2: CHRONOLOGICAL DETAIL REGISTRY ---
  doc.addPage();

  // Cabecera secundaria coherente con la identidad del documento principal.
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, 210, 14, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(0, 84, 142);
  doc.text('DIPUTACIÓN PROVINCIAL DE CÁDIZ · GESTIÓN DE FONDOS PROFEA', 15, 7.5);
  renderPdfLogo(doc, 153, 3, 42, 7, true);
  doc.setFillColor(0, 84, 142);
  doc.rect(0, 14, 210, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text(`REGISTRO COMPLETO DE CONTRATACIONES · ${periodLabel.toUpperCase()}`, 15, 18.5);
  doc.setFillColor(56, 189, 248);
  doc.rect(0, 21, 210, 1, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 84, 142);
  doc.text('ANEXO DETALLADO DE CONTRATOS REGISTRADOS', 15, 28);

  // Table of ALL transactions in this period
  const listCols = [
    { title: '#', dataKey: 'idx' },
    { title: 'Trabajador', dataKey: 'worker' },
    { title: 'DNI/NIE', dataKey: 'dni' },
    { title: 'Obra Asignada', dataKey: 'obra' },
    { title: 'Categoría', dataKey: 'categoria' },
    { title: 'Período', dataKey: 'periodo' },
    { title: 'Aptitud Médica', dataKey: 'aptitud' },
    { title: 'Formación', dataKey: 'prl' }
  ];

  const listRows = filteredPeople.map((p, index) => {
    const { estado, limitaciones } = getAptitudMedicaInfo(p);
    let aptStr = estado as string;
    if (estado === 'Apto con limitaciones') {
      aptStr = limitaciones ? `Apto c/ lim: ${limitaciones}` : 'Apto c/ limitaciones';
    }
    return {
      idx: index + 1,
      worker: p.apellidosNombre,
      dni: p.dni,
      obra: p.obra,
      categoria: p.categoria,
      periodo: `${formatDate(p.periodoInicio)} al ${formatDate(p.periodoFin)}`,
      aptitud: aptStr,
      prl: p.formacion === 'Sí' ? 'SÍ' : 'NO'
    };
  });

  autoTable(doc, {
    columns: listCols,
    body: listRows,
    startY: 32,
    theme: 'striped',
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [0, 84, 142], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      idx: { cellWidth: 7, halign: 'center' },
      worker: { cellWidth: 34, fontStyle: 'bold' },
      dni: { cellWidth: 18 },
      obra: { cellWidth: 36 },
      categoria: { cellWidth: 22 },
      periodo: { cellWidth: 26, halign: 'center' },
      aptitud: { cellWidth: 25, halign: 'center' },
      prl: { cellWidth: 12, halign: 'center' }
    },
    margin: { left: 15, right: 15 },
    didDrawPage: (data) => {
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.setFont('helvetica', 'italic');
      doc.text(`Informe de Contratación | © David Hinojo García | Diputación de Cádiz`, 15, 287);
      doc.setFont('helvetica', 'normal');
      doc.text(`Página ${data.pageNumber} de ${pageCount}`, 195, 287, { align: 'right' });
    }
  });

  const rawPeriodName = periodLabel.replace(/[\s,]+/g, '_');
  const filename = `INFORME_CONTRATACION_${rawPeriodName}.pdf`;
  applyInstitutionalPdfStandard(doc);
  return { doc, filename };
};

export const generateObraSummaryPDF = async (obraName: string, workers: Person[]) => {
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4' });
  const totalWorkers = workers.length;
  const prlCount = workers.filter(p => p.formacion === 'Sí').length;
  const prlPercent = totalWorkers > 0 ? Math.round((prlCount / totalWorkers) * 100) : 0;
  const uniqueCategories = new Set(workers.map(p => p.categoria).filter(Boolean)).size;

  // Cabecera institucional común: logotipo visible sobre blanco y título homogéneo.
  renderInstitutionalReportHeader(
    doc,
    'PROGRAMA PROFEA · INFORME RESUMEN DE OBRA (PIE DE OBRA)'
  );

  // Large Work subtitle Panel
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.roundedRect(15, 43, 180, 29, 3, 3, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('CENTRO DE TRABAJO / PROYECTO ANALIZADO:', 20, 49);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(0, 84, 142);
  const textTitle = obraName.toUpperCase();
  const splitTitle = doc.splitTextToSize(textTitle, 170);
  doc.text(splitTitle, 20, 54);

  // Contract period range and quincenas/meses
  const startDates = workers.map(p => p.periodoInicio).filter(Boolean).sort();
  const endDates = workers.map(p => p.periodoFin).filter(Boolean).sort();
  const minStart = startDates[0] ? formatDate(startDates[0]) : '-';
  const maxEnd = endDates[endDates.length - 1] ? formatDate(endDates[endDates.length - 1]) : '-';
  const periodString = (minStart !== '-' || maxEnd !== '-') ? `${minStart} al ${maxEnd}` : 'No definido';
  
  // Dynamic Spanish Month Name extraction
  const getSpanishMonthName = (dateStr: string): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const m = parseInt(parts[1], 10);
        const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        return months[m - 1] || '';
      }
      return '';
    }
    const mName = date.toLocaleString('es-ES', { month: 'long' });
    return mName.charAt(0).toUpperCase() + mName.slice(1);
  };

  const monthsSet = new Set<string>();
  workers.forEach(w => {
    const mStart = getSpanishMonthName(w.periodoInicio);
    const mEnd = getSpanishMonthName(w.periodoFin);
    if (mStart) monthsSet.add(mStart);
    if (mEnd) monthsSet.add(mEnd);
    
    // Also extract fallback month from quincena text
    if (w.quincena) {
      const parts = w.quincena.trim().split(/\s+/);
      const possibleMonth = parts.length >= 2 ? parts[1] : parts[0];
      if (possibleMonth && possibleMonth.length > 3 && !possibleMonth.includes('ª') && !possibleMonth.includes('Mes')) {
        monthsSet.add(possibleMonth.charAt(0).toUpperCase() + possibleMonth.slice(1).toLowerCase());
      }
    }
  });
  
  const uniqueMonths = Array.from(monthsSet);
  const monthsString = uniqueMonths.length > 0 ? uniqueMonths.join(', ') : 'No definido';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('RANGO DE FECHAS:', 20, 61);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(periodString, 68, 61);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('MESES COMPRENDIDOS:', 20, 66);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 84, 142);
  doc.text(monthsString.toUpperCase(), 68, 66);

  // Draw 3 beautiful KPI cards for this obra
  const drawKpiCard = (title: string, value: string, x: number, y: number, w: number, h: number, description: string) => {
    // Card background
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.4);
    doc.roundedRect(x, y, w, h, 2, 2, 'FD');

    // Title label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(title, x + 4, y + 5);

    // Huge bold value
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(0, 84, 142);
    doc.text(value, x + 4, y + 12);

    // Decorative mini-line
    doc.setFillColor(217, 119, 6);
    doc.rect(x + 4, y + 14.5, 8, 0.5, 'F');

    // Bottom tiny caption
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6);
    doc.setTextColor(148, 163, 184);
    doc.text(description, x + 4, y + 19);
  };

  const cardW = 57;
  const cardH = 22;
  const startCardY = 76;

  drawKpiCard('OPERARIOS DETECTADOS', `${totalWorkers} altas`, 15, startCardY, cardW, cardH, 'Asignados en delegación');
  drawKpiCard('FORMACIÓN PRL 20H', `${prlPercent}% apto`, 76, startCardY, cardW, cardH, `${prlCount} con curso aprobado`);
  drawKpiCard('ROLES ACTIVOS', `${uniqueCategories} categorías`, 138, startCardY, cardW, cardH, 'Especialidades cubiertas');

  // Table header/title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 84, 142);
  doc.text('RELACIÓN NOMINAL DE TRABAJADORES A PIE DE OBRA', 15, 105);

  // Table of ALL workers in this work
  const listCols = [
    { title: '#', dataKey: 'idx' },
    { title: 'Trabajador', dataKey: 'worker' },
    { title: 'DNI/NIE', dataKey: 'dni' },
    { title: 'Categoría Profesional', dataKey: 'categoria' },
    { title: 'Quincena y Período', dataKey: 'quincenaPeriodo' },
    { title: 'Teléfono', dataKey: 'tel' },
    { title: 'Calzado', dataKey: 'shoes' },
    { title: 'PRL 20h', dataKey: 'prl' }
  ];

  const listRows = workers.map((p, index) => ({
    idx: index + 1,
    worker: p.apellidosNombre,
    dni: p.dni,
    categoria: p.categoria || '-',
    quincenaPeriodo: p.quincena 
      ? `${p.quincena}\n(${formatDate(p.periodoInicio)} a ${formatDate(p.periodoFin)})` 
      : `${formatDate(p.periodoInicio)} a ${formatDate(p.periodoFin)}`,
    tel: p.telefono || '-',
    shoes: p.calzado || '-',
    prl: p.formacion === 'Sí' ? 'SÍ (Apto)' : 'NO (Pte.)'
  }));

  autoTable(doc, {
    columns: listCols,
    body: listRows,
    startY: 110,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 2.5 },
    headStyles: { fillColor: [0, 84, 142], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      idx: { cellWidth: 7, halign: 'center' },
      worker: { cellWidth: 35, fontStyle: 'bold' },
      dni: { cellWidth: 18, halign: 'center' },
      categoria: { cellWidth: 25 },
      quincenaPeriodo: { cellWidth: 43, fontStyle: 'normal' },
      tel: { cellWidth: 15, halign: 'center' },
      shoes: { cellWidth: 12, halign: 'center' },
      prl: { cellWidth: 15, halign: 'center', fontStyle: 'bold' }
    },
    margin: { left: 15, right: 15 },
    didDrawPage: (data) => {
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.setFont('helvetica', 'italic');
      doc.text(`Dossier de control | Diputación Provincial de Cádiz · Gestión de Fondos PROFEA`, 15, 287);
      doc.setFont('helvetica', 'normal');
      doc.text(`Página ${data.pageNumber} de ${pageCount}`, 195, 287, { align: 'right' });
    }
  });

  const rawObraName = obraName.replace(/[\s/\\?%*:|"<>\s]+/g, '_').toUpperCase();
  const filename = `RESUMEN_PIE_DE_OBRA_${rawObraName}.pdf`;
  applyInstitutionalPdfStandard(doc);
  return { doc, filename };
};

export const getLocalidadFromObra = (obraName: string): string => {
  if (!obraName) return 'BORNOS';
  const clean = obraName.trim().toUpperCase();
  if (clean.includes('BORNOS')) return 'BORNOS';
  if (clean.includes('JEREZ')) return 'JEREZ DE LA FRONTERA';
  if (clean.includes('CADIZ')) return 'CÁDIZ';
  if (clean.includes('ALGECIRAS')) return 'ALGECIRAS';
  if (clean.includes('CHICLANA')) return 'CHICLANA';
  if (clean.includes('SAN FERNANDO')) return 'SAN FERNANDO';
  if (clean.includes('ARCOS')) return 'ARCOS DE LA FRONTERA';
  if (clean.includes('UBRIQUE')) return 'UBRIQUE';
  if (clean.includes('ROTA')) return 'ROTA';
  if (clean.includes('CONIL')) return 'CONIL DE LA FRONTERA';
  if (clean.includes('CHIPIONA')) return 'CHIPIONA';
  if (clean.includes('PUERTO REAL')) return 'EL PUERTO DE SANTA MARÍA';
  if (clean.includes('SANLUCAR')) return 'SANLÚCAR DE BARRAMEDA';
  
  return obraName.trim();
};

export interface TicketData {
  id?: number;
  apellidosNombre?: string;
  dni?: string;
  obra?: string;
  numOferta?: string;
  categoria?: string;
  quincena?: string;
  citaDia?: string;
  citaHora?: string;
  sitioReconocimiento?: string;
  supervisorResponsable?: string;
  telefono?: string;
  diaComienzo?: string;
  diaFinContrato?: string;
  workStartHour?: string;
  diaContratacion?: string;
}

export const generateMedicalTicketsPDF = async (
  workers: TicketData[],
  supervisorPhones: { [supervisor: string]: string },
  workStartHourDefault: string = '08:00'
) => {
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4' });
  const logoBase64 = await getBase64Image(LOGO_URL);

  for (let i = 0; i < workers.length; i++) {
    if (i > 0) {
      doc.addPage();
    }

    const p = workers[i];
    const supervisorPhone = p.supervisorResponsable ? (supervisorPhones[p.supervisorResponsable] || p.telefono || '-') : '-';
    const workStartHourVal = p.workStartHour || workStartHourDefault;

    const numOferta = p.numOferta || '11002GR';
    const obraVal = p.obra || 'BORNOS';
    const localidad = getLocalidadFromObra(obraVal);
    const citaDiaFormatted = p.citaDia ? formatDate(p.citaDia) : '13-02-2026';
    const citaHoraFormatted = p.citaHora || '08:10';
    const diaComienzoFormatted = p.diaComienzo ? formatDate(p.diaComienzo) : '___/___/______';
    const diaFinContratoFormatted = p.diaFinContrato ? formatDate(p.diaFinContrato) : (p.diaComienzo ? formatDate(p.diaComienzo) : '___/___/______');
    const sitio = p.sitioReconocimiento || 'UNIDAD MOVIL UBICADA EN BORNOS: NAVE DEL AYUNTAMIENTO, CALLE BLAS INFANTE S/N, BORNOS';

    const workerName = '___________________________________________';
    const workerDni = '___________________________';

    // Thin slate frame around the A4 page (aesthetic margins)
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.5);
    doc.roundedRect(10, 10, 190, 277, 4, 4, 'S');

    // Solid top blue bar
    doc.setFillColor(0, 84, 142);
    doc.rect(10.5, 10.5, 189, 4, 'F');

    // Header logo & titles
    if (logoBase64) {
      doc.addImage(logoBase64, 'PNG', 142, 16, 52, 8);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 84, 142);
    doc.text('DIPUTACIÓN PROVINCIAL DE CÁDIZ', 18, 22);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text('DESARROLLO LOCAL | GESTIÓN DE FONDOS PROFEA', 18, 27);
    doc.text(`Supervisor Responsable: ${p.supervisorResponsable || '-'} | Tel: ${supervisorPhone}`, 18, 31.5);

    // Separating line
    doc.setDrawColor(226, 232, 240);
    doc.line(18, 36, 192, 36);

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(0, 84, 142);
    doc.text('COMUNICACIÓN DE CITACIÓN PARA RECONOCIMIENTO MÉDICO', 105, 47, { align: 'center' });
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(148, 163, 184);
    doc.text('(Documento obligatorio para la incorporación al puesto de trabajo)', 105, 52, { align: 'center' });

    // Golden underline accent
    doc.setFillColor(217, 119, 6); // Amber
    doc.rect(65, 55, 80, 1, 'F');

    // Official text section
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    doc.text('NOTIFICACIÓN OFICIAL AL TRABAJADOR', 18, 64);
    
    // Homogenize body text: set all paragraphs to helvetica normal, font size 8.5
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    
    const quincenaStr = p.quincena ? ` perteneciente a la ${p.quincena.toUpperCase()},` : '';
    const finContratoText = p.diaFinContrato ? ` hasta el ${diaFinContratoFormatted}` : '';
    const par1Text = `El trabajador ${workerName} con DNI ${workerDni} de la obra nº ${numOferta} de la localidad de ${localidad.toUpperCase()},${quincenaStr} cuyo periodo de contratación es del ${diaComienzoFormatted}${finContratoText} (hora de entrada a las ${workStartHourVal} h), está citado/a el día ${citaDiaFormatted} a las ${citaHoraFormatted} horas en el/a ${sitio.toUpperCase()}, para la realización del reconocimiento médico en cumplimiento del Convenio Colectivo para la Construcción de Cádiz en vigor.`;
    const par1Wrapped = doc.splitTextToSize(par1Text, 174);
    doc.text(par1Text, 18, 70, { maxWidth: 174, align: 'justify' });
    
    let currentY = 70 + (par1Wrapped.length * 4) + 4;

    // Second paragraph (exact requested text layout)
    const par2Text = `Deberá acudir el día del reconocimiento con su DNI, la corrección visual (gafas) en el caso de que las necesite, y este documento que se le solicitará a su llegada al centro médico (será firmado y sellado por el equipo médico y de conformidad con el trabajador). Para la correcta realización de las pruebas analíticas, es obligatorio presentarse estrictamente en ayunas (o sin haber comido nada durante las 4 horas previas al reconocimiento) y aportar el tarro con la muestra de orina.`;
    const par2Wrapped = doc.splitTextToSize(par2Text, 174);
    doc.text(par2Text, 18, currentY, { maxWidth: 174, align: 'justify' });
    currentY += (par2Wrapped.length * 4) + 4;

    // Third paragraph (exact requested text layout with professional pathology notice and supervisor responsible update)
    const par3Text = `En caso de padecer alguna patología, enfermedad diagnosticada o condición crónica activa, el/la trabajador/a tiene la obligación legal y sanitaria de aportar los correspondientes informes médicos, tratamientos o documentos justificativos emitidos por facultativos especialistas de la salud el día de su cita ante el equipo médico evaluador del servicio de prevención, garantizando así la correcta valoración de su aptitud laboral. En caso de no poder acudir por causa plenamente justificada, deberá comunicarlo lo antes posible al supervisor responsable de la zona.`;
    const par3Wrapped = doc.splitTextToSize(par3Text, 174);
    doc.text(par3Text, 18, currentY, { maxWidth: 174, align: 'justify' });
    currentY += (par3Wrapped.length * 4) + 4;

    // Fourth paragraph: PRL 20H Course Instructions
    const parPRLText = `Formación de PRL 20 horas: Si el/la trabajador/a tiene que realizar el curso de formación en Prevención de Riesgos Laborales (PRL 20h), se debe personar en el lugar indicado por el supervisor responsable y realizar el curso durante 3 días de 8:00h a 15:00h y el último día de 8:00h a 14:00h. Una vez finalizado el curso, debe presentarse al día siguiente de la finalización en la obra a la hora indicada.`;
    const parPRLWrapped = doc.splitTextToSize(parPRLText, 174);
    doc.setFont('helvetica', 'normal');
    doc.text(parPRLText, 18, currentY, { maxWidth: 174, align: 'justify' });
    currentY += (parPRLWrapped.length * 4) + 4;

    // Fifth paragraph (exact requested text layout - HOMOGENIZED TO NORMAL)
    const par5Text = `Se le recuerda que dicho reconocimiento médico es de carácter obligatorio, si no ha sido sometido al mismo en el último año para el mismo trabajo, por lo cual, si no se lo realiza, no podrá incorporarse al trabajo y podrá anularse el contrato laboral.`;
    const par5Wrapped = doc.splitTextToSize(par5Text, 174);
    doc.text(par5Text, 18, currentY, { maxWidth: 174, align: 'justify' });
    currentY += (par5Wrapped.length * 4) + 8;

    // Beautiful slate-themed key details box
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.roundedRect(18, currentY, 174, 46, 2, 2, 'FD');

    // Grid labels and values inside details box
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(0, 84, 142);
    doc.text('RESUMEN DE DATOS CLAVE DE LA CITACIÓN Y CONTRATO', 24, currentY + 6);
    doc.line(24, currentY + 8, 186, currentY + 8);

    const printGridItem = (label: string, val: string, xPos: number, yPos: number, width: number) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(label, xPos, yPos);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      const wrapped = doc.splitTextToSize(val, width);
      doc.text(wrapped, xPos, yPos + 4);
    };

    printGridItem('OBRA ASIGNADA:', `[${numOferta}] ${obraVal.toUpperCase()}`, 24, currentY + 14, 75);
    printGridItem('LUGAR RECONOCIMIENTO:', sitio.toUpperCase(), 108, currentY + 14, 75);

    printGridItem('FECHA CITA:', citaDiaFormatted, 24, currentY + 26, 35);
    printGridItem('HORA CITA:', `${citaHoraFormatted} H`, 65, currentY + 26, 30);
    printGridItem('QUINCENA / PERIODO:', p.quincena ? p.quincena.toUpperCase() : 'NO ESPECIFICADA', 108, currentY + 26, 75);

    printGridItem('INICIO OBRA:', `${diaComienzoFormatted} - ${workStartHourVal} H`, 24, currentY + 38, 75);
    printGridItem('FIN CONTRATO:', diaFinContratoFormatted, 108, currentY + 38, 75);

    // Official footer with copyright (Firma box removed from page 1)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(`Documento oficial emitido: ${new Date().toLocaleDateString('es-ES')} | © David Hinojo García | PROFEA - Diputación de Cádiz`, 18, 281);

    // --- ANNEX / JUSTIFICANTE PAGE ---
    doc.addPage();

    // Frame
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.5);
    doc.roundedRect(10, 10, 190, 277, 4, 4, 'S');

    // ANNEX / JUSTIFICANTE PAGE
    // Top blue bar
    doc.setFillColor(0, 84, 142);
    doc.rect(10.5, 10.5, 189, 4, 'F');

    // Header logo & titles
    if (logoBase64) {
      doc.addImage(logoBase64, 'PNG', 142, 16, 52, 8);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 84, 142);
    doc.text('DIPUTACIÓN PROVINCIAL DE CÁDIZ', 18, 22);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text('DESARROLLO LOCAL | GESTIÓN DE FONDOS PROFEA', 18, 27);
    doc.text(`Supervisor Responsable: ${p.supervisorResponsable || '-'} | Tel: ${supervisorPhone}`, 18, 31.5);

    doc.setDrawColor(226, 232, 240);
    doc.line(18, 36, 192, 36);

    // Title for Justificante
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(0, 84, 142);
    doc.text('ANEXO: JUSTIFICANTE DE ENTREGA DE CITACIÓN MÉDICA', 105, 47, { align: 'center' });
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(148, 163, 184);
    doc.text('(Documento de archivo para la entidad contratante - Firmado por el trabajador)', 105, 52, { align: 'center' });

    // Golden underline accent
    doc.setFillColor(217, 119, 6); // Amber
    doc.rect(40, 55, 130, 1, 'F');

    // Section header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    doc.text('DECLARACIÓN DE RECEPCIÓN Y CONFORMIDAD', 18, 66);

    // Legal text
    const legalText = `Por la presente, el/la trabajador/a abajo firmante declara bajo su responsabilidad haber recibido en mano la citación oficial para el reconocimiento médico preceptivo, así como las instrucciones de carácter sanitario obligatorias para la correcta realización de las correspondientes pruebas médicas y analíticas.

Específicamente, manifiesta haber sido advertido/a e informado/a de que:
1. Deberá comparecer estrictamente EN AYUNAS, o no haber comido nada durante las 4 horas previas a la hora fijada para la cita de su reconocimiento médico.
2. Deberá aportar inexcusablemente un TARRO CON LA MUESTRA DE ORINA en el momento de presentarse al examen médico.
3. Deberá acudir provisto/a de su documento nacional de identidad (DNI o NIE) ineludiblemente en vigor y de su correspondiente corrección visual (gafas) si la necesitara.
4. En caso de padecer alguna patología, enfermedad diagnosticada o condición crónica activa, tiene la obligación legal y sanitaria de aportar los informes médicos o documentos justificativos de especialistas el día del reconocimiento médico ante el equipo evaluador.
5. Es obligatorio el cumplimiento de este reconocimiento médico, de forma que de no realizarse, no podrá iniciarse la prestación de servicios ni formalizarse su incorporación a la obra, pudiendo declararse la nulidad de su contrato laboral.

En prueba de conformidad y de haber recibido la citación correspondiente y las instrucciones descritas, firma el presente justificante de recepción.`;

    const legalLines = legalText.split('\n').filter(line => line.trim() !== '');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);

    let currentAnnexY = 73;
    legalLines.forEach((line) => {
      const wrapped = doc.splitTextToSize(line, 174);
      doc.text(line, 18, currentAnnexY, { maxWidth: 174, align: 'justify' });
      currentAnnexY += (wrapped.length * 4.2) + 2.5;
    });

    let annexY = currentAnnexY + 2;

    // Beautiful details box (summary of the details delivered)
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.roundedRect(18, annexY, 174, 46, 2, 2, 'FD');

    // Grid labels and values inside details box
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(0, 84, 142);
    doc.text('INFORMACIÓN DE CITACIÓN DETALLADA EN EL DOCUMENTO ENTREGADO', 24, annexY + 6);
    doc.line(24, annexY + 8, 186, annexY + 8);

    const printAnnexGridItem = (label: string, val: string, xPos: number, yPos: number, width: number) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(label, xPos, yPos);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      const wrapped = doc.splitTextToSize(val, width);
      doc.text(wrapped, xPos, yPos + 4);
    };

    printAnnexGridItem('OBRA ASIGNADA:', `[${numOferta}] ${obraVal.toUpperCase()}`, 24, annexY + 14, 85);
    printAnnexGridItem('LUGAR RECONOCIMIENTO:', sitio.toUpperCase(), 115, annexY + 14, 70);

    printAnnexGridItem('FECHA CITA:', citaDiaFormatted, 24, annexY + 26, 30);
    printAnnexGridItem('HORA CITA:', `${citaHoraFormatted} H`, 65, annexY + 26, 25);
    printAnnexGridItem('QUINCENA / PERIODO:', p.quincena ? p.quincena.toUpperCase() : 'NO ESPECIFICADA', 115, annexY + 26, 70);

    printAnnexGridItem('INICIO TRABAJO:', `${diaComienzoFormatted} - ${workStartHourVal} H`, 24, annexY + 38, 85);

    annexY += 54;

    // Beautiful Signature Boxes
    // Left Box: Worker identity and signature
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.4);
    doc.roundedRect(18, annexY, 84, 52, 2, 2, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text('DATOS Y FIRMA DEL TRABAJADOR', 22, annexY + 6);
    doc.line(22, annexY + 8, 98, annexY + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Nombre y Apellidos (A MANO):', 22, annexY + 14);
    doc.text('___________________________________________', 22, annexY + 19);
    doc.text('DNI / NIE:', 22, annexY + 25);
    doc.text('___________________________', 22, annexY + 30);
    doc.text('Firma:', 22, annexY + 36);
    const sigDateStrAnnex = p.diaContratacion ? `Fecha: ${formatDate(p.diaContratacion)}` : 'Fecha: _____ / _____ / ________';
    doc.text(sigDateStrAnnex, 22, annexY + 47);

    // Right Box: Supervisor identity and signature
    doc.roundedRect(108, annexY, 84, 52, 2, 2, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('SUPERVISOR / ENTIDAD ENTREGADORA', 112, annexY + 6);
    doc.line(112, annexY + 8, 188, annexY + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Entregado por:', 112, annexY + 14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(p.supervisorResponsable ? p.supervisorResponsable.toUpperCase() : 'ENCARGADO DE OBRA', 112, annexY + 19);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('Firma y Sello:', 112, annexY + 28);
    const deliveryDateStr = p.diaContratacion ? `Fecha de Entrega: ${formatDate(p.diaContratacion)}` : 'Fecha de Entrega: _____ / _____ / ________';
    doc.text(deliveryDateStr, 112, annexY + 47);

    // Official footer with copyright
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(`Copia de Control Administrativo | Documento emitido: ${new Date().toLocaleDateString('es-ES')} | © David Hinojo García | PROFEA - Diputación de Cádiz`, 18, 281);
  }

  const filename = `NOTIFICACIONES_CITAS_PROFEA_${new Date().toISOString().slice(0, 10)}.pdf`;
  applyInstitutionalPdfStandard(doc);
  return { doc, filename };
};

export interface GenerateStatsPDFParams {
  stats: any;
  filterMode: 'origen' | 'fechas' | 'mes_actual' | 'ano_actual' | string;
  startDate?: string;
  endDate?: string;
  obraFilter?: string[];
  people?: Person[];
}

export const generateStatsSummaryPDF = async ({
  stats,
  filterMode,
  startDate,
  endDate,
  obraFilter,
  people = []
}: GenerateStatsPDFParams) => {
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4' });
  const logoBase64 = await getBase64Image(LOGO_URL);

  const total = stats.total || people.length;

  // Criterio de formaciones solicitado:
  // - "considerando los registrados como no formados como nuevas formaciones" -> formacion === 'No' o vacía o 'Sin formación'
  // - "y formados aquellos que no lo necesitan la formación" -> formacion === 'Sí' o 'No Necesita' o 'No necesita' o exentos
  const formacionNoCount = people.filter(p => 
    !p.formacion || p.formacion === 'No' || p.formacion === 'Sin formación'
  ).length;

  const formacionSiCount = people.filter(p => 
    p.formacion === 'Sí' || 
    p.formacion === 'No Necesita' || 
    p.formacion === 'No necesita' || 
    p.formacion === 'Exento' ||
    p.formacion === 'No requiere'
  ).length;

  const nuevasFormacionesCount = formacionNoCount;
  const formadosOExentosCount = (total - nuevasFormacionesCount > 0) ? (total - nuevasFormacionesCount) : formacionSiCount;

  const pctFormados = total > 0 ? ((formadosOExentosCount / total) * 100).toFixed(1) : '0';
  const pctNuevas = total > 0 ? ((nuevasFormacionesCount / total) * 100).toFixed(1) : '0';

  // Label del modo de filtro
  let filterLabel = 'HISTÓRICO COMPLETO';
  if (filterMode === 'mes_actual') {
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const now = new Date();
    filterLabel = `MES ACTUAL (${monthNames[now.getMonth()].toUpperCase()} ${now.getFullYear()})`;
  } else if (filterMode === 'ano_actual') {
    filterLabel = `AÑO EN CURSO (${new Date().getFullYear()})`;
  } else if (filterMode === 'fechas') {
    if (startDate && endDate) {
      filterLabel = `DEL ${formatDate(startDate)} AL ${formatDate(endDate)}`;
    } else if (startDate) {
      filterLabel = `DESDE ${formatDate(startDate)}`;
    } else if (endDate) {
      filterLabel = `HASTA ${formatDate(endDate)}`;
    } else {
      filterLabel = `RANGO DE FECHAS PERSONALIZADO`;
    }
  }

  const obrasLabel = (!obraFilter || obraFilter.includes('Todas') || obraFilter.length === 0)
    ? 'Todas las Obras'
    : obraFilter.join(', ');

  // Thin outer frame
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.roundedRect(10, 10, 190, 277, 4, 4, 'S');

  // Top blue bar
  doc.setFillColor(0, 84, 142);
  doc.rect(10.5, 10.5, 189, 4, 'F');

  // Header logo & titles
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', 142, 16, 52, 8);
    } catch (e) {
      console.warn('Logo addition failed', e);
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 84, 142);
  doc.text('DIPUTACIÓN PROVINCIAL DE CÁDIZ', 18, 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text('DESARROLLO LOCAL | GESTIÓN DE FONDOS PROFEA', 18, 27);
  doc.text('Documentación Administrativa Oficial de Resumen Estadístico', 18, 31.5);

  doc.setDrawColor(226, 232, 240);
  doc.line(18, 35, 192, 35);

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0, 84, 142);
  doc.text('INFORME RESUMEN ESTADÍSTICO DE CONTRATACIÓN Y FORMACIÓN', 105, 44, { align: 'center' });
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(100, 116, 139);
  doc.text('PROGRAMA PROFEA - EVALUACIÓN DE CONTRATACIONES Y NECESIDADES PREVENTIVAS', 105, 49, { align: 'center' });

  // Amber line accent
  doc.setFillColor(217, 119, 6);
  doc.rect(40, 52, 130, 1, 'F');

  // Context Box
  let currentY = 57;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(18, currentY, 174, 22, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0, 84, 142);
  doc.text('PARÁMETROS DEL INFORME Y FILTROS APLICADOS', 24, currentY + 5);
  doc.line(24, currentY + 7, 186, currentY + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);

  doc.text('FILTRO TEMPORAL:', 24, currentY + 12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(filterLabel, 55, currentY + 12);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('OBRAS SELECCIONADAS:', 24, currentY + 17);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  const truncatedObras = obrasLabel.length > 45 ? obrasLabel.substring(0, 42) + '...' : obrasLabel;
  doc.text(truncatedObras, 60, currentY + 17);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('FECHA EMISIÓN:', 125, currentY + 12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(new Date().toLocaleString('es-ES'), 150, currentY + 12);

  currentY += 27;

  // KPI Grid Cards
  const cardW = 39;
  const cardH = 22;
  const gap = 6;

  // Card 1
  doc.setFillColor(240, 247, 255);
  doc.setDrawColor(191, 219, 254);
  doc.roundedRect(18, currentY, cardW, cardH, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(30, 64, 175);
  doc.text('TOTAL CONTRATADOS', 21, currentY + 5);
  doc.setFontSize(13);
  doc.setTextColor(30, 58, 138);
  doc.text(String(total), 21, currentY + 14);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');
  doc.text('Trabajadores en registro', 21, currentY + 18.5);

  // Card 2
  doc.setFillColor(236, 253, 245);
  doc.setDrawColor(167, 243, 208);
  doc.roundedRect(18 + cardW + gap, currentY, cardW, cardH, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(6, 95, 70);
  doc.text('FORMADOS / EXENTOS', 18 + cardW + gap + 3, currentY + 5);
  doc.setFontSize(13);
  doc.setTextColor(4, 120, 87);
  doc.text(`${formadosOExentosCount}`, 18 + cardW + gap + 3, currentY + 14);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`${pctFormados}% del total`, 18 + cardW + gap + 3, currentY + 18.5);

  // Card 3
  doc.setFillColor(254, 242, 242);
  doc.setDrawColor(254, 202, 202);
  doc.roundedRect(18 + (cardW + gap) * 2, currentY, cardW, cardH, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(153, 27, 27);
  doc.text('NUEVAS FORMACIONES', 18 + (cardW + gap) * 2 + 3, currentY + 5);
  doc.setFontSize(13);
  doc.setTextColor(185, 28, 28);
  doc.text(`${nuevasFormacionesCount}`, 18 + (cardW + gap) * 2 + 3, currentY + 14);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`${pctNuevas}% requieren PRL 20h`, 18 + (cardW + gap) * 2 + 3, currentY + 18.5);

  // Card 4
  doc.setFillColor(255, 251, 235);
  doc.setDrawColor(253, 230, 138);
  doc.roundedRect(18 + (cardW + gap) * 3, currentY, cardW, cardH, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(146, 64, 14);
  doc.text('OBRAS / QUINCENAS', 18 + (cardW + gap) * 3 + 3, currentY + 5);
  doc.setFontSize(11);
  doc.setTextColor(180, 83, 9);
  const qCount = stats.desgloseQuincena ? Object.keys(stats.desgloseQuincena).length : 0;
  doc.text(`${stats.totalObras || 0} Obras`, 18 + (cardW + gap) * 3 + 3, currentY + 13.5);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`${qCount} quincenas atendid.`, 18 + (cardW + gap) * 3 + 3, currentY + 18.5);

  currentY += 27;

  // Criteria Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(18, currentY, 174, 15, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text('CRITERIO AUDITABLE DE FORMACIÓN PREVENTIVA (PRL 20H):', 22, currentY + 4.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('• Nuevas formaciones a realizar:', 22, currentY + 9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(185, 28, 28);
  doc.text(`${nuevasFormacionesCount} pers.`, 60, currentY + 9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('(Registrados como sin formación).', 73, currentY + 9.5);

  doc.text('• Personal Formado / Exento:', 22, currentY + 13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(4, 120, 87);
  doc.text(`${formadosOExentosCount} pers.`, 57, currentY + 13);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('(Acreditados con diploma o sin necesidad por normativa).', 70, currentY + 13);

  if (stats.formacionesReincorporacion && stats.formacionesReincorporacion > 0) {
    doc.text(`• Re-incorporaciones: ${stats.formacionesReincorporacion} pers.`, 135, currentY + 13);
  }

  currentY += 19;

  // Table 1: Desglose por Obras
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(0, 84, 142);
  doc.text('1. DESGLOSE DE CONTRATACIÓN Y FORMACIÓN POR OBRA / DESTINO', 18, currentY);

  const obraEntries = stats.desgloseObra 
    ? Object.entries(stats.desgloseObra).sort((a, b) => (b[1] as number) - (a[1] as number))
    : [];

  const obraTableRows = obraEntries.map(([obraName, count]) => {
    const workersInObra = people.filter(p => p.obra === obraName);
    const formadosInObra = workersInObra.filter(p => p.formacion === 'Sí' || p.formacion === 'No Necesita' || p.formacion === 'No necesita' || p.formacion === 'Exento' || p.formacion === 'No requiere').length;
    const nuevasInObra = workersInObra.filter(p => !p.formacion || p.formacion === 'No' || p.formacion === 'Sin formación').length;
    const cntNum = count as number;
    const pct = total > 0 ? ((cntNum / total) * 100).toFixed(1) + '%' : '0%';

    return [
      obraName.toUpperCase(),
      String(cntNum),
      pct,
      `${formadosInObra} pers.`,
      `${nuevasInObra} pers.`
    ];
  });

  obraTableRows.push([
    'TOTAL CONSOLIDADO',
    String(total),
    '100.0%',
    `${formadosOExentosCount} pers.`,
    `${nuevasFormacionesCount} pers.`
  ]);

  autoTable(doc, {
    head: [['OBRA / CENTRO DE TRABAJO', 'Nº TRABAJADORES', 'CUOTA (%)', 'FORMADOS / EXENTOS', 'NUEVAS FORMACIONES (PRL 20H)']],
    body: obraTableRows,
    startY: currentY + 3,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 2, valign: 'middle', halign: 'center' as const },
    headStyles: { fillColor: [0, 84, 142], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { halign: 'left' as const, cellWidth: 70 },
      1: { cellWidth: 26 },
      2: { cellWidth: 22 },
      3: { cellWidth: 32 },
      4: { cellWidth: 34 }
    },
    alternateRowStyles: { fillColor: [240, 247, 255] },
    didParseCell: (data) => {
      if (data.row.index === obraTableRows.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [226, 232, 240];
        data.cell.styles.textColor = [15, 23, 42];
      }
    }
  });

  let finalY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY : currentY + 45;
  finalY += 6;

  // Table 2: Desglose por Quincenas
  if (finalY + 40 > 260) {
    doc.addPage();
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.roundedRect(10, 10, 190, 277, 4, 4, 'S');
    doc.setFillColor(0, 84, 142);
    doc.rect(10.5, 10.5, 189, 4, 'F');
    finalY = 20;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(0, 84, 142);
  doc.text('2. DESGLOSE TEMPORAL POR QUINCENAS / PERÍODOS DE CONTRATACIÓN', 18, finalY);

  const quincenaEntries = stats.desgloseQuincena
    ? Object.entries(stats.desgloseQuincena)
    : [];

  const quincenaTableRows = quincenaEntries.map(([qName, count]) => {
    const cntNum = count as number;
    const pct = total > 0 ? ((cntNum / total) * 100).toFixed(1) + '%' : '0%';
    return [
      qName.toUpperCase(),
      String(cntNum),
      pct
    ];
  });

  quincenaTableRows.push([
    'TOTAL GENERAL',
    String(total),
    '100.0%'
  ]);

  autoTable(doc, {
    head: [['QUINCENA / PERÍODO', 'TRABAJADORES ASIGNADOS', 'CUOTA DE DISTRIBUCIÓN (%)']],
    body: quincenaTableRows,
    startY: finalY + 3,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 2, valign: 'middle', halign: 'center' as const },
    headStyles: { fillColor: [0, 84, 142], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { halign: 'left' as const, cellWidth: 90 },
      1: { cellWidth: 45 },
      2: { cellWidth: 49 }
    },
    alternateRowStyles: { fillColor: [240, 247, 255] },
    didParseCell: (data) => {
      if (data.row.index === quincenaTableRows.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [226, 232, 240];
        data.cell.styles.textColor = [15, 23, 42];
      }
    }
  });

  let signY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY : finalY + 35;
  signY += 8;

  if (signY + 32 > 260) {
    doc.addPage();
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.roundedRect(10, 10, 190, 277, 4, 4, 'S');
    doc.setFillColor(0, 84, 142);
    doc.rect(10.5, 10.5, 189, 4, 'F');
    signY = 20;
  }

  // Certification Box
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text('CERTIFICACIÓN Y DILIGENCIA DE CONTROL ADMINISTRATIVO', 18, signY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('DILIGENCIA: Se expide el presente informe cuantitativo y cualitativo de personal contratado y necesidades de formación preventivas', 18, signY + 3.5);
  doc.text('conforme a los expedientes de contratación registrados oficialmente en la plataforma de gestión PROFEA de la Diputación de Cádiz.', 18, signY + 7);

  const sigBoxY = signY + 10;

  // Signature box 1
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.roundedRect(18, sigBoxY, 82, 25, 2, 2, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(51, 65, 85);
  doc.text('RESPONSABLE TÉCNICO / SUPERVISOR', 22, sigBoxY + 4.5);
  doc.line(22, sigBoxY + 6, 96, sigBoxY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Firma:', 22, sigBoxY + 12);
  doc.text('Fecha: _____ / _____ / ________', 22, sigBoxY + 21);

  // Signature box 2
  doc.roundedRect(110, sigBoxY, 82, 25, 2, 2, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(51, 65, 85);
  doc.text('CONTROL Y GESTIÓN PROFEA (DIPUTACIÓN DE CÁDIZ)', 114, sigBoxY + 4.5);
  doc.line(114, sigBoxY + 6, 188, sigBoxY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Sello y Validación:', 114, sigBoxY + 12);
  doc.text('Fecha: _____ / _____ / ________', 114, sigBoxY + 21);

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Informe Resumen Estadístico Oficial PROFEA | Emitido: ${new Date().toLocaleDateString('es-ES')} | © David Hinojo García | Página ${i} de ${totalPages}`,
      105,
      281,
      { align: 'center' }
    );
  }

  const cleanFilterStr = filterLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `RESUMEN_ESTADISTICO_PROFEA_${cleanFilterStr}_${new Date().toISOString().slice(0, 10)}.pdf`;

  applyInstitutionalPdfStandard(doc);
  return { doc, filename };
};

