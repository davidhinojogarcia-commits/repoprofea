import type { WorkerMasterRecord } from './workerMaster';

const formatDate = (value: string) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : raw;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const exportDateToken = () => new Date().toISOString().slice(0, 10);

export const workerRecordIsComplete = (worker: WorkerMasterRecord) =>
  Boolean(
    worker.apellidosNombre &&
    worker.dni &&
    worker.fechaNacimiento &&
    worker.telefono &&
    worker.numeroSeguridadSocial &&
    worker.iban &&
    worker.calzado
  );

export const workerRecordYear = (worker: WorkerMasterRecord) => {
  const match = String(worker.ultimaContratacion || '').match(/(20\d{2})/);
  return match?.[1] || '';
};

export const downloadWorkerMasterExcel = async (records: WorkerMasterRecord[]) => {
  if (!records.length) throw new Error('No hay trabajadores para exportar.');

  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GestionProfea';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Trabajadores');
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = 'A1:I1';

  sheet.columns = [
    { header: 'Nombre y apellidos', key: 'nombre', width: 36 },
    { header: 'DNI / NIE', key: 'dni', width: 16 },
    { header: 'Fecha nacimiento', key: 'nacimiento', width: 17 },
    { header: 'Teléfono', key: 'telefono', width: 16 },
    { header: 'Nº Seguridad Social', key: 'nuss', width: 22 },
    { header: 'IBAN', key: 'iban', width: 30 },
    { header: 'Talla calzado', key: 'calzado', width: 14 },
    { header: 'Última contratación', key: 'ultima', width: 18 },
    { header: 'Nº contrataciones', key: 'contratos', width: 16 },
  ];

  records.forEach((worker) => {
    sheet.addRow({
      nombre: worker.apellidosNombre || '',
      dni: worker.dni || '',
      nacimiento: formatDate(worker.fechaNacimiento),
      telefono: worker.telefono || '',
      nuss: worker.numeroSeguridadSocial || '',
      iban: worker.iban || '',
      calzado: worker.calzado || '',
      ultima: formatDate(worker.ultimaContratacion),
      contratos: worker.contratos || 0,
    });
  });

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00548E' } };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.height = 24;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: 'middle', wrapText: true };
      if (rowNumber % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6F9' } };
      }
    }
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD7DEE7' } },
        left: { style: 'thin', color: { argb: 'FFD7DEE7' } },
        bottom: { style: 'thin', color: { argb: 'FFD7DEE7' } },
        right: { style: 'thin', color: { argb: 'FFD7DEE7' } },
      };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `trabajadores_profea_${exportDateToken()}.xlsx`,
  );
};

export const downloadWorkerMasterPdf = async (
  records: WorkerMasterRecord[],
  supervisorLabel = '',
) => {
  if (!records.length) throw new Error('No hay trabajadores para exportar.');

  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = (autoTableModule as any).default || autoTableModule;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const generated = new Date().toLocaleString('es-ES');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(0, 84, 142);
  doc.text('RELACIÓN DE TRABAJADORES · DATOS PERSONALES', 12, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(70, 78, 90);
  doc.text(
    [
      `Registros exportados: ${records.length}`,
      supervisorLabel ? `Supervisor: ${supervisorLabel}` : '',
      `Generado: ${generated}`,
    ].filter(Boolean).join('   ·   '),
    12,
    20,
  );
  doc.setFontSize(7);
  doc.setTextColor(130, 70, 20);
  doc.text(
    'Documento con datos personales de uso administrativo. Incluye Seguridad Social e IBAN completos.',
    12,
    25,
  );

  const body = records.map((worker) => [
    worker.apellidosNombre || '',
    worker.dni || '',
    formatDate(worker.fechaNacimiento),
    worker.telefono || '',
    worker.numeroSeguridadSocial || '',
    worker.iban || '',
    worker.calzado || '',
    formatDate(worker.ultimaContratacion),
    String(worker.contratos || 0),
  ]);

  autoTable(doc, {
    startY: 29,
    head: [[
      'Nombre y apellidos',
      'DNI/NIE',
      'Nacimiento',
      'Teléfono',
      'Seg. Social',
      'IBAN',
      'Calzado',
      'Últ. contratación',
      'Nº',
    ]],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 6.6,
      cellPadding: 1.5,
      valign: 'middle',
      overflow: 'linebreak',
      textColor: [30, 41, 59],
      lineColor: [210, 218, 228],
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [0, 84, 142],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
    },
    alternateRowStyles: { fillColor: [246, 248, 251] },
    columnStyles: {
      0: { cellWidth: 47 },
      1: { cellWidth: 22 },
      2: { cellWidth: 23 },
      3: { cellWidth: 23 },
      4: { cellWidth: 29 },
      5: { cellWidth: 45 },
      6: { cellWidth: 17, halign: 'center' },
      7: { cellWidth: 27 },
      8: { cellWidth: 10, halign: 'center' },
    },
    margin: { left: 10, right: 10, bottom: 12 },
    didDrawPage: () => {
      const pageCount = (doc as any).internal.getNumberOfPages();
      const page = (doc as any).internal.getCurrentPageInfo?.().pageNumber || pageCount;
      doc.setFontSize(6.5);
      doc.setTextColor(120);
      doc.text(
        `GestionProfea · Página ${page}`,
        doc.internal.pageSize.getWidth() - 10,
        doc.internal.pageSize.getHeight() - 5,
        { align: 'right' },
      );
    },
  });

  doc.save(`trabajadores_profea_${exportDateToken()}.pdf`);
};
