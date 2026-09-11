from pathlib import Path

path = Path('src/lib/exportUtils.ts')
text = path.read_text(encoding='utf-8')

# Institutional wording: remove developer credits from official documents and use
# the current Diputacion/PROFEA service naming consistently.
replacements = {
    "headerLine1: 'EXCMA. DIPUTACIÓN PROVINCIAL DE CÁDIZ'": "headerLine1: 'DIPUTACIÓN PROVINCIAL DE CÁDIZ'",
    "headerLine2: 'ÁREA DE COOPERACIÓN | GESTIÓN PROFEA'": "headerLine2: 'DESARROLLO LOCAL | GESTIÓN DE FONDOS PROFEA'",
    "footerText: '© David Hinojo García | Sistema de Gestión PROFEA'": "footerText: 'Diputación Provincial de Cádiz | Gestión de Fondos PROFEA'",
    "'EXCMA. DIPUTACIÓN PROVINCIAL DE CÁDIZ'": "'DIPUTACIÓN PROVINCIAL DE CÁDIZ'",
    "'ÁREA DE COOPERACIÓN | GESTIÓN PROFEA'": "'DESARROLLO LOCAL | GESTIÓN DE FONDOS PROFEA'",
    "'SISTEMA DE CONTRATACIÓN PROFEA · DIPUTACIÓN PROVINCIAL DE CÁDIZ'": "'GESTIÓN DE FONDOS PROFEA · DIPUTACIÓN PROVINCIAL DE CÁDIZ'",
    "`© ${new Date().getFullYear()} David Hinojo García | Sistema de Gestión PROFEA`": "`Diputación Provincial de Cádiz | Gestión de Fondos PROFEA`",
    "`© ${new Date().getFullYear()} David Hinojo García | Resumen de Calzado PROFEA`": "`Diputación Provincial de Cádiz | Gestión de Fondos PROFEA`",
    "`Documento de validez interna. © David Hinojo García | PROFEA - Diputación de Cádiz`": "`Documento de gestión interna | Diputación Provincial de Cádiz · Gestión de Fondos PROFEA`",
    "`Dossier de Control Físico | © David Hinojo García | Diputación de Cádiz`": "`Dossier de control | Diputación Provincial de Cádiz · Gestión de Fondos PROFEA`",
}
for old, new in replacements.items():
    text = text.replace(old, new)

anchor = "const LIGHT_BLUE_RGB: [number, number, number] = [240, 247, 255];\n"
if anchor not in text:
    raise SystemExit('Institutional helper insertion anchor not found')

helpers = r'''

const INSTITUTION_NAME = 'DIPUTACIÓN PROVINCIAL DE CÁDIZ';
const INSTITUTION_SERVICE = 'GESTIÓN DE FONDOS PROFEA';
const INSTITUTION_FOOTER = 'Diputación Provincial de Cádiz · Gestión de Fondos PROFEA';

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
'''

if 'const INSTITUTION_NAME' not in text:
    text = text.replace(anchor, anchor + helpers)

# Apply the Excel institutional pass immediately before serialisation in every
# workbook-producing export function.
needle_excel = "  const buffer = await workbook.xlsx.writeBuffer();"
if needle_excel not in text:
    raise SystemExit('No Excel writeBuffer calls found')
text = text.replace(
    needle_excel,
    "  applyInstitutionalExcelStandard(workbook, worksheet);\n" + needle_excel
)

# Apply the PDF institutional pass at the final hand-off of every PDF generator.
# This catches specialised exports too (worker cards, histories, periodic reports,
# obra summaries, medical tickets and stats PDFs), not only the generic reports.
needle_pdf = "  return { doc, filename"
if needle_pdf not in text:
    raise SystemExit('No PDF return hand-offs found')
text = text.replace(
    needle_pdf,
    "  applyInstitutionalPdfStandard(doc);\n" + needle_pdf
)

# If this script is accidentally rerun, do not duplicate the finalisation calls.
text = text.replace(
    "  applyInstitutionalExcelStandard(workbook, worksheet);\n  applyInstitutionalExcelStandard(workbook, worksheet);",
    "  applyInstitutionalExcelStandard(workbook, worksheet);"
)
text = text.replace(
    "  applyInstitutionalPdfStandard(doc);\n  applyInstitutionalPdfStandard(doc);",
    "  applyInstitutionalPdfStandard(doc);"
)

path.write_text(text, encoding='utf-8')

print('Institutional export standard applied.')
print('PDF finalisation calls:', text.count('applyInstitutionalPdfStandard(doc);'))
print('Excel finalisation calls:', text.count('applyInstitutionalExcelStandard(workbook, worksheet);'))
