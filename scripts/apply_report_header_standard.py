from pathlib import Path

path = Path('src/lib/exportUtils.ts')
text = path.read_text()

helper_anchor = "const INSTITUTION_FOOTER = 'Diputación Provincial de Cádiz · Gestión de Fondos PROFEA';\n"
helper = r'''

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
'''

if 'const renderInstitutionalReportHeader = (' not in text:
    text = text.replace(helper_anchor, helper_anchor + helper, 1)

period_start = text.index('  // --- PAGE 1: DECORATIVE COVER & EXECUTIVE DASHBOARD ---')
period_end = text.index('  // Large Period subtitle', period_start)
period_new = r'''  // --- PAGE 1: INSTITUTIONAL COVER & EXECUTIVE DASHBOARD ---
  const supervisorPart = supervisorName ? `SUPERVISOR RESPONSABLE: ${supervisorName}` : '';
  const zonaPart = zonaName ? `ZONA: ${zonaName}` : '';
  const headerMeta = [supervisorPart, zonaPart].filter(Boolean).join('   |   ');
  renderInstitutionalReportHeader(
    doc,
    'PROGRAMA PROFEA · INFORME DE CONTRATACIÓN',
    headerMeta
  );

'''
text = text[:period_start] + period_new + text[period_end:]

obra_start = text.index('  // Header block', text.index('export const generateObraSummaryPDF'))
obra_end = text.index('  // Large Work subtitle Panel', obra_start)
obra_new = r'''  // Cabecera institucional común: logotipo visible sobre blanco y título homogéneo.
  renderInstitutionalReportHeader(
    doc,
    'PROGRAMA PROFEA · INFORME RESUMEN DE OBRA (PIE DE OBRA)'
  );

'''
text = text[:obra_start] + obra_new + text[obra_end:]

# Homogeneizar también el encabezado reducido de la segunda página del informe periódico.
legacy_mini = r'''  // Mini-Header
  doc.setFillColor(0, 84, 142);
  doc.rect(0, 0, 210, 16, 'F');
  doc.setFillColor(56, 189, 248);
  doc.rect(0, 16, 210, 1.2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('DIPUTACIÓN DE CÁDIZ - PROGRAMA PROFEA', 15, 10);
  doc.setFont('helvetica', 'normal');
  doc.text(`REGISTRO COMPLETO DE CONTRATACIONES (${periodLabel})`, 110, 10);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 84, 142);
  doc.text('ANEXO DETALLADO DE CONTRATOS REGISTRADOS', 15, 24);
'''
new_mini = r'''  // Cabecera secundaria coherente con la identidad del documento principal.
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
'''
if legacy_mini in text:
    text = text.replace(legacy_mini, new_mini, 1)
    text = text.replace("    startY: 28,", "    startY: 32,", 1)

path.write_text(text)
print('Report headers standardized.')
