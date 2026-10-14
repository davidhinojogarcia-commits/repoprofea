import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Person } from '../../types';
import { applyInstitutionalPdfStandard, renderInstitutionalReportHeader } from './exportUtils';
import {
  generateAdditionalWorksiteDocument,
  type AdditionalWorksiteDocumentType,
} from './worksiteAdditionalDocumentsPdf';
import type { ForemanAttendanceDay, ForemanAttendanceRow, ForemanCompletedDocument, ForemanMandatoryDocument } from '../services/foremanPortalService';
import {
  generateEpiDeliveryPdf,
  generateTrainingInformationPdf,
  generateMachineryAuthorizationPdf,
  type WorksiteDocumentContext,
} from './worksiteDocumentsPdf';

export function generateForemanCompletedDocumentPdf(record: ForemanCompletedDocument, obra: string, foremanName: string) {
  return generateAdditionalWorksiteDocument(
    record.documentType as AdditionalWorksiteDocumentType,
    (record.workerSnapshot || null) as Person | null,
    {
      obra,
      empresa: 'AEPSA (Diputación Provincial de Cádiz)',
      cif: 'P1100000G',
      fecha: String(record.workDate || '').slice(0, 10),
      responsable: foremanName,
      supervisor: '',
    },
    record.answers || {},
    {
      worker: record.signatures?.worker,
      foreman: record.signatures?.foreman,
      supervisor: record.signatures?.supervisor,
    },
  );
}

export function generateForemanAttendancePdf(day: ForemanAttendanceDay, obra: string, foremanName: string) {
  const BLUE: [number,number,number] = [0,84,142];
  const LIGHT_BLUE: [number,number,number] = [235,244,251];
  const BORDER: [number,number,number] = [166,193,216];
  const TEXT: [number,number,number] = [30,41,59];
  const safe=(value:unknown)=>String(value??'').trim();
  const formatDate=(value:string)=>{
    const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m?`${m[3]}/${m[2]}/${m[1]}`:String(value||'');
  };
  const rows=day.rows||[];
  const doc=new jsPDF({ compress: true,unit:'mm',format:'a4',orientation:'landscape'});

  const drawField=(label:string,value:string,x:number,y:number,width:number,labelWidth:number,height=6)=>{
    doc.setDrawColor(...BORDER);doc.setLineWidth(0.18);
    doc.setFillColor(...LIGHT_BLUE);doc.rect(x,y,labelWidth,height,'FD');
    doc.setFillColor(255,255,255);doc.rect(x+labelWidth,y,width-labelWidth,height,'FD');
    doc.setFont('helvetica','bold');doc.setFontSize(5.8);doc.setTextColor(...BLUE);
    doc.text(label,x+2,y+4);
    doc.setFont('helvetica','normal');doc.setFontSize(5.9);doc.setTextColor(...TEXT);
    const lines=doc.splitTextToSize(value||'-',Math.max(8,width-labelWidth-4));
    doc.text(lines[0]||'-',x+labelWidth+2,y+4);
  };

  const drawPage=(row:ForemanAttendanceRow,index:number)=>{
    if(index>0)doc.addPage('a4','landscape');
    renderInstitutionalReportHeader(
      doc,
      'REGISTRO DIARIO DE JORNADA',
      `${obra} · ${formatDate(String(day.workDate||''))}`,
      {subtitle:'COOPERACIÓN · GESTIÓN DE FONDOS PROFEA'},
    );

    const pageW=doc.internal.pageSize.getWidth();
    const x=10,gap=3,full=277,half=(full-gap)/2,h=6;
    let y=42;

    drawField('Obra',safe(obra),x,y,half,22,h);
    drawField('Código obra',safe((row as any).codigoObra||''),x+half+gap,y,67,24,h);
    drawField('Municipio',safe((row as any).municipio||''),x+half+gap+70,y,half-70,23,h);

    const periodStart=safe((row as any).periodoInicio);
    const periodEnd=safe((row as any).periodoFin);
    const period=periodStart||periodEnd
      ? `${formatDate(periodStart||periodEnd)} – ${formatDate(periodEnd||periodStart)}`
      : formatDate(String(day.workDate||''));
    const periodWidth=137,offerWidth=67,companyWidth=full-periodWidth-offerWidth-gap*2;
    drawField('Periodo contratado',period,x,y+7,periodWidth,32,h);
    drawField('Nº oferta',safe((row as any).numOferta||''),x+periodWidth+gap,y+7,offerWidth,24,h);
    drawField('Empresa',safe((row as any).empresa||'Diputación Provincial de Cádiz'),x+periodWidth+gap+offerWidth+gap,y+7,companyWidth,22,h);

    drawField('Trabajador',safe(row.name),x,y+14,half,22,h);
    drawField('DNI/NIE',safe(row.dni),x+half+gap,y+14,76,21,h);
    drawField('Categoría',safe(row.category),x+half+gap+79,y+14,half-79,22,h);
    drawField('Responsable / Encargado',safe(foremanName),x,y+21,full,43,h);

    y+=29;

    autoTable(doc,{
      startY:y,
      head:[['Nº','Fecha','Hora entrada','Firma entrada','Hora salida','Firma salida','Horas efectivas','Incidencias']],
      body:[[
        '1',
        formatDate(String(day.workDate||'')),
        safe(row.entryTime)||'',
        '',
        safe(row.exitTime)||'',
        '',
        '',
        '',
      ]],
      margin:{left:10,right:10,bottom:50},
      tableWidth:277,
      theme:'grid',
      styles:{
        font:'helvetica',fontSize:6.2,textColor:TEXT,lineColor:BORDER,lineWidth:0.16,
        minCellHeight:22,cellPadding:0.7,valign:'middle',
      },
      headStyles:{
        fillColor:BLUE,textColor:[255,255,255],fontStyle:'bold',fontSize:5.6,
        halign:'center',valign:'middle',minCellHeight:7,
      },
      columnStyles:{
        0:{cellWidth:9,halign:'center'},
        1:{cellWidth:25,halign:'center'},
        2:{cellWidth:27,halign:'center'},
        3:{cellWidth:43},
        4:{cellWidth:27,halign:'center'},
        5:{cellWidth:43},
        6:{cellWidth:28,halign:'center'},
        7:{cellWidth:75},
      },
      didDrawCell:(data:any)=>{
        if(data.section!=='body'||data.row.index!==0)return;
        if(data.column.index===3&&row.entrySignature){
          try{
            const pad=2;
            doc.addImage(row.entrySignature,'PNG',data.cell.x+pad,data.cell.y+2,data.cell.width-pad*2,data.cell.height-4,undefined,'FAST');
          }catch{}
        }
        if(data.column.index===5&&row.exitSignature){
          try{
            const pad=2;
            doc.addImage(row.exitSignature,'PNG',data.cell.x+pad,data.cell.y+2,data.cell.width-pad*2,data.cell.height-4,undefined,'FAST');
          }catch{}
        }
      },
    });

    const tableEnd=(doc as any).lastAutoTable?.finalY||y+30;
    const summaryY=Math.min(tableEnd+4,doc.internal.pageSize.getHeight()-47);
    const leftX=10,leftW=68,centerX=81,centerW=112,rightX=196,rightW=pageW-rightX-10,boxH=24;
    const box=(bx:number,bw:number,title:string)=>{
      doc.setDrawColor(...BORDER);doc.setFillColor(255,255,255);doc.rect(bx,summaryY,bw,boxH,'FD');
      doc.setFillColor(...LIGHT_BLUE);doc.rect(bx,summaryY,bw,6,'F');
      doc.setFont('helvetica','bold');doc.setFontSize(6.2);doc.setTextColor(...BLUE);
      doc.text(title,bx+2.5,summaryY+4.1);
    };
    box(leftX,leftW,'Resumen del periodo');
    box(centerX,centerW,'Incidencias / observaciones');
    box(rightX,rightW,'Conforme responsable / encargado');

    doc.setFont('helvetica','normal');doc.setFontSize(5.8);doc.setTextColor(...TEXT);
    const worked=Boolean(row.entrySignature&&row.exitSignature);
    const summaryValues=[
      ['Días trabajados',worked?'1':''],
      ['Horas ordinarias',''],
      ['Horas extraordinarias',''],
      ['Total horas',''],
    ];
    summaryValues.forEach(([label,value],i)=>{
      const ry=summaryY+9+i*4;
      doc.text(label,leftX+3,ry);
      if(value)doc.text(value,leftX+leftW-6,ry,{align:'right'});
      doc.line(leftX+39,ry+0.7,leftX+leftW-3,ry+0.7);
    });
    doc.text(`Nombre: ${safe(foremanName)}`,rightX+3,summaryY+10);
    doc.text('Firma:',rightX+3,summaryY+15);
    doc.line(rightX+18,summaryY+15.6,rightX+rightW-3,summaryY+15.6);
    doc.text('Fecha: ____ / ____ / ______',rightX+3,summaryY+21);

    const noticeY=doc.internal.pageSize.getHeight()-18;
    doc.setFontSize(5.5);doc.setTextColor(75,95,115);
    doc.text('El trabajador firma diariamente la entrada y la salida de la jornada.',10,noticeY);
    doc.text('Registro diario individual conforme al art. 34.9 del Estatuto de los Trabajadores. Conservación: 4 años.',pageW-10,noticeY,{align:'right'});
  };

  if(rows.length){
    rows.forEach(drawPage);
  }else{
    renderInstitutionalReportHeader(doc,'REGISTRO DIARIO DE JORNADA',obra,{subtitle:'COOPERACIÓN · GESTIÓN DE FONDOS PROFEA'});
    doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(...BLUE);
    doc.text('No hay trabajadores registrados en esta jornada.',20,55);
  }

  applyInstitutionalPdfStandard(doc);
  return {
    doc,
    filename:`REGISTRO_DIARIO_JORNADA_${String(day.workDate||'').slice(0,10)}.pdf`,
  };
}

const renderImportedSourceText = (
  doc: jsPDF,
  text: string,
  startY: number,
  options: { width?: number; x?: number; fontSize?: number; lineHeight?: number; paragraphGap?: number } = {},
) => {
  const cleaned = String(text || '').replace(/\r/g,'').trim();
  if (!cleaned) return startY;
  const width = options.width ?? 174;
  const x = options.x ?? 18;
  const fontSize = options.fontSize ?? 8.8;
  const lineHeight = options.lineHeight ?? 4.35;
  const paragraphGap = options.paragraphGap ?? 2.8;
  let y = startY;

  doc.setFont('helvetica','normal');
  doc.setFontSize(fontSize);
  doc.setTextColor(30,41,59);

  const blocks = cleaned
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const rawLines = block.split(/\n/).map(line => line.trim()).filter(Boolean);
    const paragraph = rawLines.join(' ');
    const lines = doc.splitTextToSize(paragraph, width);
    for (const line of lines) {
      if (y > 270) {
        doc.addPage('a4','portrait');
        y = 24;
      }
      doc.text(line, x, y);
      y += lineHeight;
    }
    y += paragraphGap;
  }
  return y;
};

const drawMandatoryWorkersHeader = (
  doc: jsPDF,
  y: number,
  options: { control?: boolean } = {},
) => {
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica','bold');
  doc.setFontSize(8.4);
  doc.text('TRABAJADOR/A', 18, y);
  doc.text('FIRMA', options.control ? 164 : 132, y);
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.25);
  doc.line(18, y + 3, 192, y + 3);
  return y + 9;
};


const fmtEs = (value: string) => {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value || '');
};

export function generateForemanMandatoryDocumentPdf(
  record: ForemanMandatoryDocument,
  obra: string,
) {
  if (['epis','formacion','maquinaria','autorizacion_uso_maquinaria'].includes(record.documentType)) {
    const workerSignatures = Object.fromEntries(
      Object.entries(record.signatures || {})
        .map(([workerId, raw]) => [workerId, typeof raw === 'string' ? raw : raw?.signature || ''])
        .filter(([, signature]) => signature && signature !== 'signed'),
    ) as Record<string,string>;
    const fallbackMachinery = String(record.details?.maquinaria || '').trim();
    const machineryByWorker = {
      ...(record.details?.maquinariaPorTrabajador || {}),
      ...Object.fromEntries(
        (record.workers || [])
          .filter(worker => fallbackMachinery && !record.details?.maquinariaPorTrabajador?.[String(worker.id)])
          .map(worker => [String(worker.id), fallbackMachinery]),
      ),
    };
    const context: WorksiteDocumentContext = {
      obra,
      municipio: String(record.details?.municipio || ''),
      empresa: String(record.details?.empresa || 'AEPSA (Diputación Provincial de Cádiz)'),
      cif: String(record.details?.cif || 'P1100000G'),
      recursoPreventivo: String(record.details?.recursoPreventivo || ''),
      fecha: String(record.workDate || '').slice(0,10),
      periodoLabel: String(record.details?.periodoLabel || record.periodKey || ''),
      accionFormativa: String(record.details?.accionFormativa || ''),
      duracionFormacion: String(record.details?.duracionFormacion || ''),
      epis: (record.details?.epis || {}) as Record<string,boolean>,
      maquinariaPorTrabajador: machineryByWorker,
      workerSignatures,
    };
    if (record.documentType === 'epis') return generateEpiDeliveryPdf(record.workers || [], context);
    if (record.documentType === 'formacion') return generateTrainingInformationPdf(record.workers || [], context);
    return generateMachineryAuthorizationPdf(record.workers || [], context);
  }

  if (['contrato','prorroga'].includes(record.documentType)) throw new Error('Los contratos y prórrogas deben abrirse desde el PDF original o firmado almacenado.');

  if (record.details?.originalPdfMode === 'overlay' && ['inicio','control_presencia','contrato','prorroga'].includes(record.documentType)) {
    throw new Error('Este documento conserva el PDF original y no puede reconstruirse. Usa la copia Original/Firmado almacenada.');
  }

  if (
    ['inicio','control_presencia','contrato','prorroga'].includes(record.documentType) &&
    record.details?.originalPdfMode === 'overlay'
  ) {
    throw new Error('Este documento conserva el PDF original. Debe abrirse desde la copia Original/Firmado, no regenerarse.');
  }

  if (record.documentType === 'control_presencia') {
    const doc = new jsPDF({ compress: true, unit: 'mm', format: 'a4', orientation: 'portrait' });
    renderInstitutionalReportHeader(
      doc,
      'CONTROL DE PRESENCIA',
      `${obra} · ${fmtEs(record.workDate)}`,
      { subtitle: 'UNIDAD DE GESTIÓN A.E.P.S.A. · PROFEA' },
    );

    let y = 49;
    const importedText = String(record.details?.sourceText || '').trim();
    if (importedText) {
      y = renderImportedSourceText(doc, importedText, y, {
        width: 174,
        x: 18,
        fontSize: 8.4,
        lineHeight: 4.15,
        paragraphGap: 2.4,
      });
      y += 3;
    }

    if (y > 242) {
      doc.addPage('a4','portrait');
      y = 24;
    }

    y = drawMandatoryWorkersHeader(doc, y, { control: true });

    const rowHeight = 18;
    const signatureHeight = 10.5;
    const signatureWidth = 29;

    for (const worker of record.workers || []) {
      if (y + rowHeight > 276) {
        doc.addPage('a4','portrait');
        y = drawMandatoryWorkersHeader(doc, 24, { control: true });
      }

      const rowTop = y - 2;
      const signatureRaw = (record.signatures || {})[String(worker.id)];
      const signature = typeof signatureRaw === 'string' ? signatureRaw : signatureRaw?.signature;

      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica','bold');
      doc.setFontSize(8.5);
      doc.text(String(worker.apellidosNombre || '').toUpperCase(), 18, y, { maxWidth: 92 });

      doc.setFont('helvetica','normal');
      doc.setFontSize(7.6);
      doc.text(`DNI/NIE: ${String(worker.dni || '-')}`, 18, y + 4.5, { maxWidth: 54 });
      doc.text(`Categoría: ${String(worker.categoria || '-')}`, 75, y + 4.5, { maxWidth: 58 });

      // Control de presencia conserva su línea horizontal de firma,
      // diferenciándose expresamente del documento de Inicio.
      const signatureLineY = rowTop + 10.5;
      doc.setDrawColor(71, 85, 105);
      doc.setLineWidth(0.25);
      doc.line(158, signatureLineY, 192, signatureLineY);

      if (signature) {
        const signatureY = rowTop + 1.2;
        try { doc.addImage(signature, 'PNG', 160, signatureY, signatureWidth, signatureHeight, undefined, 'FAST'); } catch {}
      }

      y += rowHeight;
    }

    applyInstitutionalPdfStandard(doc);
    return { doc, filename: `CONTROL_PRESENCIA_${record.workDate}.pdf` };
  }

  const doc = new jsPDF({ compress: true, unit: 'mm', format: 'a4', orientation: 'portrait' });
  renderInstitutionalReportHeader(
    doc,
    'INICIO / INCORPORACIÓN AL CENTRO DE TRABAJO',
    obra,
    { subtitle: 'ÁREA DE COOPERACIÓN · GESTIÓN DE FONDOS PROFEA' },
  );

  let y = 48;
  const width = 174;
  const importedText = String(record.details?.sourceText || '').trim();

  if (importedText) {
    y = renderImportedSourceText(doc, importedText, y, {
      width,
      x: 18,
      fontSize: 8.8,
      lineHeight: 4.45,
      paragraphGap: 3.2,
    });
  } else {
    y = renderImportedSourceText(
      doc,
      [
        'Teniendo la Excma. Diputación Provincial suscritos contratos de trabajo acogidos al R.D. 939/97 (desarrollado según Orden de 26/10/98 y Resolución de 30/03/99).',
        'Estando prevista su incorporación al centro de trabajo, las personas relacionadas han resultado aptas para las tareas que se les encomienden dentro de las labores para las que han sido contratadas y según los riesgos inherentes al puesto de trabajo.',
        'Expresando las mismas, mediante su firma, su conformidad con las instrucciones de la Empresa.',
      ].join('\n\n'),
      y,
      { width, x: 18, fontSize: 8.8, lineHeight: 4.45, paragraphGap: 3.2 },
    );
  }

  if (y > 228) {
    doc.addPage('a4','portrait');
    y = 24;
  }

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica','bold');
  doc.setFontSize(10.2);
  const workLines = doc.splitTextToSize(String(obra || '').toUpperCase(), width);
  doc.text(workLines, 18, y);
  y += workLines.length * 5 + 3;

  if (record.category) {
    doc.setFontSize(8.7);
    doc.setTextColor(51, 65, 85);
    doc.text(`CATEGORÍA: ${String(record.category).toUpperCase()}`, 18, y);
    y += 7;
  } else {
    y += 2;
  }

  y = drawMandatoryWorkersHeader(doc, y, { control: false });

  // En Inicio se conserva la estética original: firma a la derecha,
  // sin línea continua larga. Se da más aire entre trabajadores para
  // evitar que las firmas se junten.
  const inicioRowHeight = 21;
  const inicioSignatureHeight = 12;
  const inicioSignatureWidth = 48;

  for (const worker of record.workers || []) {
    if (y + inicioRowHeight > 272) {
      doc.addPage('a4','portrait');
      y = drawMandatoryWorkersHeader(doc, 24, { control: false });
    }

    const rowTop = y - 1;
    const signatureRaw = (record.signatures || {})[String(worker.id)];
    const signature = typeof signatureRaw === 'string' ? signatureRaw : signatureRaw?.signature;

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica','bold');
    doc.setFontSize(8.8);
    doc.text(String(worker.apellidosNombre || '').toUpperCase(), 18, y, { maxWidth: 96 });

    doc.setFont('helvetica','normal');
    doc.setFontSize(7.5);
    if (worker.dni) doc.text(`DNI/NIE: ${String(worker.dni)}`, 18, y + 4.5, { maxWidth: 48 });
    if (worker.categoria) doc.text(`Categoría: ${String(worker.categoria)}`, 70, y + 4.5, { maxWidth: 45 });

    if (signature) {
      const signatureY = rowTop + 0.8;
      try { doc.addImage(signature, 'PNG', 132, signatureY, inicioSignatureWidth, inicioSignatureHeight, undefined, 'FAST'); } catch {}
    }

    // Sin línea horizontal bajo la firma ni separador largo de fila.
    // El espaciado vertical mantiene la lectura limpia y la estética del original.
    y += inicioRowHeight;
  }

  if (y > 274) {
    doc.addPage('a4','portrait');
    y = 24;
  }
  doc.setFont('helvetica','normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Cádiz, a ${fmtEs(record.workDate)}`, 132, Math.min(282, Math.max(y + 4, 266)));

  applyInstitutionalPdfStandard(doc);
  return { doc, filename: `INICIO_${String(record.category || 'GENERAL').replace(/[^a-zA-Z0-9]+/g,'_')}_${record.workDate}.pdf` };
}
