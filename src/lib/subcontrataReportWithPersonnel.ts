import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Subcontratista, SubcontrataTrabajadorCAE } from '../../types';
import { applyInstitutionalPdfStandard, formatDate, renderInstitutionalReportHeader } from './exportUtils';
import {
  getStoredObrasRecursosPreventivos,
  getStoredReporteTecnicoConfig,
  getSubcontrataCompliance,
} from './subcontratasDefaultsBase';

type ReportOptions = {
  tecnicoNombre?: string;
  coordinadorNombre?: string;
  empresaCoordinacion?: string;
  supervisorNombre?: string;
  recursoPreventivoObra?: string;
  recursoPreventivoCategoria?: string;
};

const clean = (value: unknown) => String(value || '').trim();

const docLabelById = (sub: Subcontratista, id: string) =>
  sub.checklist.find(item => item.id === id)?.nombre || id;

const renderPersonnelSection = (
  doc: jsPDF,
  sub: Subcontratista,
  startY: number,
  marginLeft: number,
  contentWidth: number,
): number => {
  const workers = Array.isArray(sub.trabajadoresCae) ? sub.trabajadoresCae : [];
  const authorized = workers.filter(worker => worker.estadoAcceso === 'autorizado');
  const denied = workers.filter(worker => worker.estadoAcceso !== 'autorizado');

  let y = startY;
  if (y > 252) {
    doc.addPage();
    y = 22;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 84, 142);
  doc.text('CONTROL NOMINAL DE PERSONAL AUTORIZADO PARA ACCESO A OBRA', marginLeft, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text(
    'Relación de trabajadores detectados en la documentación CAE y confirmados en el expediente de la subcontrata.',
    marginLeft,
    y + 4.5,
  );

  const summaryY = y + 8;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(marginLeft, summaryY, contentWidth, 10, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(15, 23, 42);
  doc.text(`Personal registrado: ${workers.length}`, marginLeft + 3, summaryY + 4.3);
  doc.setTextColor(5, 150, 105);
  doc.text(`Autorizados: ${authorized.length}`, marginLeft + 52, summaryY + 4.3);
  doc.setTextColor(220, 38, 38);
  doc.text(`No autorizados: ${denied.length}`, marginLeft + 92, summaryY + 4.3);
  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text(
    workers.length
      ? 'El estado de acceso se basa en la documentación nominal acreditada y revisada en el expediente CAE.'
      : 'No hay trabajadores confirmados en el expediente CAE de esta subcontrata.',
    marginLeft + 3,
    summaryY + 8,
  );

  let cursor = summaryY + 13;

  const rowsFor = (rows: SubcontrataTrabajadorCAE[], authorizedState: boolean) => rows.map((worker, index) => {
    const accredited = (worker.documentosAcreditados || [])
      .map(id => docLabelById(sub, id))
      .join(' · ');
    const reasons = authorizedState
      ? (accredited || 'Documentación nominal acreditada en el expediente.')
      : ((worker.motivosNoAutorizado || []).join(' · ') || 'Pendiente de subsanar documentación nominal.');
    return [
      String(index + 1),
      worker.nombreApellidos || 'Nombre pendiente',
      worker.dni || 'DNI/NIE pendiente',
      worker.puestoTrabajo || 'Puesto pendiente',
      reasons,
    ];
  });

  const drawGroup = (title: string, rows: SubcontrataTrabajadorCAE[], isAuthorized: boolean) => {
    if (cursor > 252) {
      doc.addPage();
      cursor = 22;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(isAuthorized ? 5 : 185, isAuthorized ? 120 : 28, isAuthorized ? 85 : 28);
    doc.text(`${title} (${rows.length})`, marginLeft, cursor);

    autoTable(doc, {
      startY: cursor + 2,
      head: [['Nº', 'Nombre y apellidos', 'DNI / NIE', 'Puesto de trabajo', isAuthorized ? 'Acreditación documental' : 'Motivo de no autorización']],
      body: rows.length
        ? rowsFor(rows, isAuthorized)
        : [['-', isAuthorized ? 'No hay trabajadores autorizados.' : 'No hay trabajadores no autorizados.', '-', '-', '-']],
      theme: 'grid',
      styles: {
        fontSize: 6.5,
        cellPadding: 1.5,
        textColor: [30, 41, 59],
        valign: 'middle',
        lineWidth: 0.1,
        lineColor: [226, 232, 240],
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: isAuthorized ? [5, 150, 105] : [185, 28, 28],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 6.7,
      },
      columnStyles: {
        0: { cellWidth: 7, halign: 'center' },
        1: { cellWidth: 48 },
        2: { cellWidth: 25, halign: 'center' },
        3: { cellWidth: 36 },
        4: { cellWidth: contentWidth - 116 },
      },
      margin: { left: marginLeft, right: 14, bottom: 16 },
      didParseCell: data => {
        if (data.section === 'body' && data.column.index === 4 && !isAuthorized && rows.length) {
          data.cell.styles.textColor = [185, 28, 28];
        }
      },
    });
    cursor = ((doc as any).lastAutoTable?.finalY || cursor + 12) + 6;
  };

  drawGroup('PERSONAL AUTORIZADO PARA ENTRAR A OBRA', authorized, true);
  drawGroup('PERSONAL NO AUTORIZADO PARA ENTRAR A OBRA', denied, false);

  return cursor;
};

export const generateSubcontrataReportPDF = async (
  sub: Subcontratista,
  supervisorResponsable?: string,
  customLogo?: string,
  options?: ReportOptions,
): Promise<void> => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const defaultCfg = getStoredReporteTecnicoConfig();
  const obrasRecursos = getStoredObrasRecursosPreventivos();
  const obraRecurso = sub.obra ? obrasRecursos[sub.obra] : undefined;
  const compliance = getSubcontrataCompliance(sub);

  const effectiveTecnico = clean(options?.tecnicoNombre ?? defaultCfg.tecnicoNombre);
  const effectiveCoordinador = clean(options?.coordinadorNombre ?? defaultCfg.coordinadorNombre);
  const effectiveSupervisorFirma = clean(options?.supervisorNombre ?? defaultCfg.supervisorNombre);
  const effectiveRecursoNombre = clean(options?.recursoPreventivoObra) || clean(sub.recursoPreventivo) || clean(obraRecurso?.recursoPreventivoNombre);
  const supNombre = clean(supervisorResponsable) || clean(sub.supervisorResponsable) || clean(defaultCfg.supervisorNombre) || 'Supervisor Responsable';

  const marginLeft = 14;
  const marginRight = 14;
  const pageWidth = 210;
  const contentWidth = pageWidth - marginLeft - marginRight;

  const now = new Date();
  renderInstitutionalReportHeader(
    doc,
    'INFORME DE CONTROL DOCUMENTAL DE SUBCONTRATA DE OBRA',
    `EXPEDIENTE REF: ${sub.id.toUpperCase()} · ${sub.obra || 'OBRA SIN ASIGNAR'}`,
    {
      subtitle: 'COORDINACIÓN DE SEGURIDAD Y SALUD · GESTIÓN DE FONDOS PROFEA',
      customLogo,
    },
  );

  let bannerBg:[number,number,number] = [239, 246, 255];
  let bannerBorder:[number,number,number] = [147, 197, 253];
  let bannerText:[number,number,number] = [30, 64, 175];
  let bannerTitle = 'ESTADO DEL ACCESO: PENDIENTE DE REVISIÓN';
  let bannerSub = 'La documentación obligatoria está en fase de aportación o revisión por el supervisor técnico.';
  if (sub.estadoExpediente === 'apto') {
    bannerBg = [236, 253, 245]; bannerBorder = [16, 185, 129]; bannerText = [6, 95, 70];
    bannerTitle = 'ESTADO DEL ACCESO: AUTORIZADO (APTO)';
    bannerSub = 'La documentación obligatoria registrada se encuentra conforme y en vigor.';
  } else if (sub.estadoExpediente === 'denegado') {
    bannerBg = [254, 242, 242]; bannerBorder = [239, 68, 68]; bannerText = [153, 27, 27];
    bannerTitle = 'ESTADO DEL ACCESO: DENEGADO / NO AUTORIZADO';
    bannerSub = 'Existen incumplimientos documentales que impiden el acceso a obra.';
  } else if (sub.estadoExpediente === 'condicionado') {
    bannerBg = [255, 251, 235]; bannerBorder = [245, 158, 11]; bannerText = [146, 64, 14];
    bannerTitle = 'ESTADO DEL ACCESO: CONDICIONADO A SUBSANACIÓN';
    bannerSub = 'Existen incidencias o documentos pendientes que requieren subsanación.';
  }
  doc.setFillColor(...bannerBg); doc.setDrawColor(...bannerBorder); doc.roundedRect(marginLeft, 43, contentWidth, 14, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...bannerText); doc.text(bannerTitle, marginLeft + 4, 49);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.text(bannerSub, marginLeft + 4, 53.5);

  const metaY = 60;
  const colW = (contentWidth - 4) / 2;
  const col2X = marginLeft + colW + 4;
  for (const x of [marginLeft, col2X]) {
    doc.setFillColor(248, 250, 252); doc.setDrawColor(226, 232, 240); doc.roundedRect(x, metaY, colW, 34, 2, 2, 'FD');
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0, 84, 142); doc.text('DATOS DE LA OBRA', marginLeft + 3, metaY + 5);
  doc.setFontSize(7.2); doc.setTextColor(71, 85, 105); doc.setFont('helvetica', 'normal');
  doc.text('Obra:', marginLeft + 3, metaY + 11); doc.text('Municipio:', marginLeft + 3, metaY + 16); doc.text('Supervisor:', marginLeft + 3, metaY + 21); doc.text('Inicio:', marginLeft + 3, metaY + 26); doc.text('Rec. preventivo:', marginLeft + 3, metaY + 31);
  doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
  doc.text(sub.obra || 'Sin asignar', marginLeft + 27, metaY + 11, { maxWidth: colW - 30 });
  doc.text(sub.municipio || 'Provincia de Cádiz', marginLeft + 27, metaY + 16, { maxWidth: colW - 30 });
  doc.text(supNombre, marginLeft + 27, metaY + 21, { maxWidth: colW - 30 });
  doc.text(sub.fechaInicioPrevista ? formatDate(sub.fechaInicioPrevista) : 'A determinar', marginLeft + 27, metaY + 26);
  doc.text(effectiveRecursoNombre || 'Pendiente designación', marginLeft + 27, metaY + 31, { maxWidth: colW - 30 });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0, 84, 142); doc.text('DATOS DE LA EMPRESA SUBCONTRATISTA', col2X + 3, metaY + 5);
  doc.setFontSize(7.2); doc.setFont('helvetica', 'normal'); doc.setTextColor(71, 85, 105);
  doc.text('Razón social:', col2X + 3, metaY + 11); doc.text('CIF / NIF:', col2X + 3, metaY + 16); doc.text('Actividad:', col2X + 3, metaY + 21); doc.text('Contacto:', col2X + 3, metaY + 26); doc.text('Libro subcontr.:', col2X + 3, metaY + 31);
  doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
  doc.text(sub.nombreEmpresa || 'No especificada', col2X + 28, metaY + 11, { maxWidth: colW - 31 });
  doc.text(sub.cif || 'Sin CIF', col2X + 28, metaY + 16);
  doc.text(sub.actividadGremio || 'Construcción', col2X + 28, metaY + 21, { maxWidth: colW - 31 });
  doc.text(`${sub.personaContacto || '-'} ${sub.telefono ? `· ${sub.telefono}` : ''}`, col2X + 28, metaY + 26, { maxWidth: colW - 31 });
  const libro = sub.libroSubcontratacionEstado || (sub.checklist.find(item => item.id === 'libro_subcontratacion')?.estado === 'entregado' ? 'registrado' : 'no_registrado');
  doc.setTextColor(libro === 'registrado' ? 5 : 185, libro === 'registrado' ? 150 : 28, libro === 'registrado' ? 105 : 28);
  doc.text(libro === 'registrado' ? 'REGISTRADO' : 'NO REGISTRADO', col2X + 28, metaY + 31);

  const statsY = metaY + 38;
  doc.setFillColor(241, 245, 249); doc.roundedRect(marginLeft, statsY, contentWidth, 8, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.4); doc.setTextColor(15, 23, 42);
  doc.text(`Cumplimiento documental: ${compliance.porcentaje}%`, marginLeft + 3, statsY + 5.2);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(71, 85, 105);
  doc.text(`Conformes: ${compliance.entregados} · Pendientes: ${compliance.pendientes} · Caducados/Incidencias: ${compliance.caducados} · Total: ${compliance.total}`, marginLeft + 51, statsY + 5.2);

  const tableData = sub.checklist.map((item, index) => {
    const state = item.estado === 'entregado' ? 'ENTREGADO (OK)' : item.estado === 'caducado' ? 'CADUCADO' : item.estado === 'incompleto' ? 'INCOMPLETO' : item.estado === 'no_aplica' ? 'NO APLICA' : 'PENDIENTE';
    let notes = item.observaciones || '';
    if (item.fechaCaducidad) notes = `${notes ? `${notes} · ` : ''}Caduca: ${formatDate(item.fechaCaducidad)}`;
    if (item.detectadoPorIA) notes = `${notes ? `${notes} · ` : ''}Verificado con IA`;
    return [String(index + 1), item.categoria === 'empresa' ? 'Empresa' : item.categoria === 'trabajadores' ? 'Personal' : 'Maquinaria', item.nombre, item.normativa, item.obligatorio ? 'Sí' : 'No', state, notes || '-'];
  });

  autoTable(doc, {
    startY: statsY + 11,
    head: [['Nº', 'Área', 'Documento legal requerido', 'Normativa', 'Oblig.', 'Estado', 'Vigencia / Observaciones']],
    body: tableData,
    theme: 'grid',
    styles: { fontSize: 6.6, cellPadding: 1.5, textColor: [30, 41, 59], valign: 'middle', lineWidth: 0.1, lineColor: [226, 232, 240], overflow: 'linebreak' },
    headStyles: { fillColor: [0, 84, 142], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.8 },
    columnStyles: { 0:{cellWidth:7,halign:'center'},1:{cellWidth:15,halign:'center'},2:{cellWidth:55},3:{cellWidth:28},4:{cellWidth:11,halign:'center'},5:{cellWidth:25,halign:'center',fontStyle:'bold'},6:{cellWidth:41} },
    margin: { left: marginLeft, right: marginRight, bottom: 16 },
    didParseCell: data => {
      if (data.section === 'body' && data.column.index === 5) {
        const value = String(data.cell.raw);
        if (value.includes('ENTREGADO')) data.cell.styles.textColor = [5, 150, 105];
        else if (value.includes('CADUCADO') || value.includes('INCOMPLETO') || value.includes('PENDIENTE')) data.cell.styles.textColor = [185, 28, 28];
        else data.cell.styles.textColor = [100, 116, 139];
      }
    },
  });

  const checklistEnd = ((doc as any).lastAutoTable?.finalY || 150) + 8;
  const personnelEnd = renderPersonnelSection(doc, sub, checklistEnd, marginLeft, contentWidth);

  let sigY = personnelEnd;
  // Reserva compacta: evita crear una página nueva únicamente por firmas sobredimensionadas.
  if (sigY > 252) {
    doc.addPage();
    sigY = 22;
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.4); doc.setTextColor(100, 116, 139);
  doc.text('Documento emitido para control CAE y acceso nominal a obra. La autorización individual depende de que la documentación acreditativa permanezca vigente.', marginLeft, sigY, { maxWidth: contentWidth });
  const signatures = [
    { label: 'Por el Supervisor de obra:', name: effectiveSupervisorFirma },
    { label: 'Por el Técnico de Obra:', name: effectiveTecnico },
    { label: 'Coordinación de Seguridad y Salud:', name: effectiveCoordinador },
  ].filter(item => item.name);
  const sigBoxY = sigY + 4.5;
  if (signatures.length) {
    const gap = 3;
    const boxW = (contentWidth - gap * (signatures.length - 1)) / signatures.length;
    signatures.forEach((signature, index) => {
      const x = marginLeft + index * (boxW + gap);
      const signatureH = 19;
      doc.setDrawColor(203, 213, 225); doc.roundedRect(x, sigBoxY, boxW, signatureH, 1.5, 1.5, 'S');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.1); doc.setTextColor(15, 23, 42); doc.text(signature.label, x + 2, sigBoxY + 3.8, { maxWidth: boxW - 4 });
      doc.setDrawColor(220, 226, 232); doc.line(x + 2, sigBoxY + 5.2, x + boxW - 2, sigBoxY + 5.2);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5.6); doc.setTextColor(71, 85, 105);
      doc.text('Firma:', x + 2, sigBoxY + 10);
      doc.line(x + 13, sigBoxY + 10.5, x + boxW - 2, sigBoxY + 10.5);
      doc.text(`Fdo: ${signature.name}`, x + 2, sigBoxY + 16.2, { maxWidth: boxW - 4 });
    });
  }

  applyInstitutionalPdfStandard(doc);

  const cleanName = (sub.nombreEmpresa || 'subcontrata').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  doc.save(`informe_subcontrata_${cleanName}_${now.toISOString().slice(0, 10)}.pdf`);
};
