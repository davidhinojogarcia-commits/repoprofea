import { jsPDF } from 'jspdf';
import type { Person } from '../../types';
import { applyInstitutionalPdfStandard, renderInstitutionalReportHeader } from './exportUtils';
import {
  generateAdditionalWorksiteDocument,
  type AdditionalWorksiteDocumentType,
} from './worksiteAdditionalDocumentsPdf';
import type { ForemanAttendanceDay, ForemanCompletedDocument, ForemanMandatoryDocument } from '../services/foremanPortalService';

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
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  renderInstitutionalReportHeader(
    doc,
    'REGISTRO DIARIO DE JORNADA · ENCARGADO',
    `${obra} · ${String(day.workDate || '').slice(0, 10)}`,
    { subtitle: 'CONTROL DE ENTRADA Y SALIDA · PROFEA' },
  );
  const rows = day.rows || [];
  let y = 50;
  doc.setFont('helvetica','bold'); doc.setFontSize(8);
  doc.text('TRABAJADOR',14,y); doc.text('DNI/NIE',95,y); doc.text('ENTRADA',135,y); doc.text('FIRMA ENTRADA',160,y); doc.text('SALIDA',215,y); doc.text('FIRMA SALIDA',238,y);
  y += 4; doc.setDrawColor(180); doc.line(14,y,283,y); y += 5;
  doc.setFont('helvetica','normal'); doc.setFontSize(7.2);
  for (const row of rows) {
    if (y > 185) { doc.addPage('a4','landscape'); y=20; }
    doc.text(String(row.name||'-'),14,y,{maxWidth:76});
    doc.text(String(row.dni||'-'),95,y,{maxWidth:35});
    doc.text(String(row.entryTime||'-'),135,y);
    if (row.entrySignature) { try { doc.addImage(row.entrySignature,'PNG',160,y-7,42,10,undefined,'FAST'); } catch {} }
    doc.text(String(row.exitTime||'-'),215,y);
    if (row.exitSignature) { try { doc.addImage(row.exitSignature,'PNG',238,y-7,42,10,undefined,'FAST'); } catch {} }
    y += 13; doc.setDrawColor(225); doc.line(14,y-3,283,y-3);
  }
  doc.setFont('helvetica','bold'); doc.setFontSize(7.5);
  doc.text(`Encargado/a: ${foremanName || '-'} · Estado: ${day.status === 'completed' ? 'Jornada finalizada' : 'En cumplimentación'}`,14,198);
  applyInstitutionalPdfStandard(doc);
  return { doc, filename: `REGISTRO_DIARIO_${String(day.workDate||'').slice(0,10)}.pdf` };
}


const fmtEs = (value: string) => {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value || '');
};

export function generateForemanMandatoryDocumentPdf(
  record: ForemanMandatoryDocument,
  obra: string,
) {
  if (['epis','maquinaria','autorizacion_uso_maquinaria'].includes(record.documentType)) {
    const titleMap: Record<string,string> = {
      epis: 'ENTREGA DE EPIs',
      maquinaria: 'AUTORIZACIÓN DE MAQUINARIA',
      autorizacion_uso_maquinaria: 'AUTORIZACIÓN AL USO DE MAQUINARIA',
    };
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    const title = titleMap[record.documentType] || 'DOCUMENTO DE OBRA';
    renderInstitutionalReportHeader(
      doc,
      title,
      `${obra} · ${fmtEs(record.workDate)}`,
      { subtitle: 'DOCUMENTACIÓN CUMPLIMENTADA POR EL ENCARGADO · PROFEA' },
    );

    const detailText = record.documentType === 'epis'
      ? Object.entries((record.details?.epis || {}) as Record<string,boolean>)
          .filter(([,enabled])=>Boolean(enabled))
          .map(([key])=>({
            casco:'Casco',chaleco:'Chaleco',orejeras:'Orejeras',gafas:'Gafas',
            guantes:'Guantes',mascarillas:'Mascarillas',calzado:'Calzado',
          } as Record<string,string>)[key] || key)
          .join(', ')
      : String(record.details?.maquinaria || '');

    let y = 49;
    doc.setTextColor(0,0,0);
    doc.setDrawColor(0,0,0);
    doc.setFont('helvetica','bold');
    doc.setFontSize(8.5);
    doc.text('TRABAJADOR/A', 14, y);
    doc.text('DNI/NIE', 92, y);
    doc.text('CATEGORÍA', 126, y);
    doc.text(record.documentType==='epis' ? 'EPIs ENTREGADOS' : 'MAQUINARIA / EQUIPOS', 174, y);
    doc.text('FIRMA', 246, y);
    y += 3;
    doc.setLineWidth(0.35);
    doc.line(14,y,283,y);
    y += 8;

    const rowHeight=17;
    const signatureHeight=11;
    for (const worker of record.workers || []) {
      if (y + rowHeight > 192) {
        doc.addPage('a4','landscape');
        y=22;
        doc.setTextColor(0,0,0);
        doc.setDrawColor(0,0,0);
        doc.setFont('helvetica','bold');
        doc.setFontSize(8.5);
        doc.text('TRABAJADOR/A', 14, y);
        doc.text('DNI/NIE', 92, y);
        doc.text('CATEGORÍA', 126, y);
        doc.text(record.documentType==='epis' ? 'EPIs ENTREGADOS' : 'MAQUINARIA / EQUIPOS', 174, y);
        doc.text('FIRMA', 246, y);
        y += 3;
        doc.line(14,y,283,y);
        y += 8;
      }

      const rowTop=y-5;
      const rowBottom=rowTop+rowHeight;
      const signatureRaw=(record.signatures||{})[String(worker.id)];
      const signature=typeof signatureRaw==='string'?signatureRaw:signatureRaw?.signature;

      doc.setFont('helvetica','bold');
      doc.setFontSize(8.3);
      doc.text(String(worker.apellidosNombre||''),14,y,{maxWidth:74});
      doc.setFont('helvetica','normal');
      doc.setFontSize(7.8);
      doc.text(String(worker.dni||''),92,y,{maxWidth:30});
      doc.text(String(worker.categoria||''),126,y,{maxWidth:44});
      doc.text(detailText||'-',174,y,{maxWidth:68});

      if(signature){
        const sy=rowTop+(rowHeight-signatureHeight)/2;
        try{doc.addImage(signature,'PNG',246,sy,34,signatureHeight,undefined,'FAST');}catch{}
      }else{
        doc.line(246,rowTop+rowHeight/2+1,280,rowTop+rowHeight/2+1);
      }
      doc.setDrawColor(90,90,90);
      doc.setLineWidth(0.2);
      doc.line(14,rowBottom,283,rowBottom);
      y+=rowHeight;
    }

    doc.setFont('helvetica','bold');
    doc.setFontSize(7.5);
    doc.text('Estado: '+(record.status==='reviewed'?'Revisado':record.status==='completed'?'Cumplimentado':'En cumplimentación'),14,201);
    applyInstitutionalPdfStandard(doc);
    const prefix=record.documentType==='epis'?'EPIS':record.documentType==='maquinaria'?'AUTORIZACION_MAQUINARIA':'AUTORIZACION_USO_MAQUINARIA';
    return { doc, filename: `${prefix}_ENCARGADO_${record.workDate}.pdf` };
  }

  if (record.documentType === 'control_presencia') {
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    renderInstitutionalReportHeader(
      doc,
      'CONTROL DE PRESENCIA',
      `${obra} · ${fmtEs(record.workDate)}`,
      { subtitle: 'UNIDAD DE GESTIÓN A.E.P.S.A. · PROFEA' },
    );

    let y = 50;
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);
    doc.setFont('courier', 'bold');
    doc.setFontSize(8.6);
    doc.text('APELLIDOS / NOMBRE', 14, y);
    doc.text('CATEGORÍA', 84, y);
    doc.text('N.I.F.', 132, y);
    doc.text('FIRMA', 165, y);
    y += 3;
    doc.setLineWidth(0.35);
    doc.line(14, y, 196, y);
    y += 8;

    doc.setFont('courier', 'normal');
    doc.setFontSize(8.2);
    const rowHeight = 16;
    const signatureHeight = 11;
    const signatureWidth = 28;
    for (const worker of record.workers || []) {
      if (y + rowHeight > 282) {
        doc.addPage('a4', 'portrait');
        y = 20;
        doc.setTextColor(0, 0, 0);
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.25);
      }

      const rowTop = y - 5;
      const rowBottom = rowTop + rowHeight;
      const signatureRaw = (record.signatures || {})[String(worker.id)];
      const signature = typeof signatureRaw === 'string' ? signatureRaw : signatureRaw?.signature;

      doc.setTextColor(0, 0, 0);
      doc.text(String(worker.apellidosNombre || ''), 14, y, { maxWidth: 65 });
      doc.text(String(worker.categoria || ''), 84, y, { maxWidth: 43 });
      doc.text(String(worker.dni || ''), 132, y, { maxWidth: 28 });

      if (signature) {
        const signatureY = rowTop + (rowHeight - signatureHeight) / 2;
        try { doc.addImage(signature, 'PNG', 165, signatureY, signatureWidth, signatureHeight, undefined, 'FAST'); } catch {}
      } else {
        doc.setDrawColor(0, 0, 0);
        doc.line(165, rowTop + rowHeight / 2 + 1, 195, rowTop + rowHeight / 2 + 1);
      }

      doc.setDrawColor(80, 80, 80);
      doc.setLineWidth(0.2);
      doc.line(14, rowBottom, 196, rowBottom);
      y += rowHeight;
    }
    applyInstitutionalPdfStandard(doc);
    return { doc, filename: `CONTROL_PRESENCIA_${record.workDate}.pdf` };
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  renderInstitutionalReportHeader(
    doc,
    'INICIO / INCORPORACIÓN AL CENTRO DE TRABAJO',
    obra,
    { subtitle: 'ÁREA DE COOPERACIÓN · GESTIÓN DE FONDOS PROFEA' },
  );

  let y = 47;
  const width = 174;
  const paragraphs = [
    'Teniendo la Excma. Diputación Provincial suscritos contratos de trabajo acogidos al R.D. 939/97 (desarrollado según Orden de 26/10/98 y Resolución de 30/03/99).',
    'Estando prevista su incorporación al centro de trabajo, indicar que dichas personas no han sido incapacitadas en el reconocimiento médico obligatorio y previo al ingreso en el trabajo realizado por la empresa responsable de los reconocimientos médicos, de acuerdo con el Convenio Colectivo de Construcción y obras Públicas para la provincia de Cádiz vigente, para desempeñar las tareas que se les encomienden dentro de las labores para las que han sido contratadas y en función de los riesgos inherentes al propio puesto de trabajo, según consta en la documentación por la empresa responsable de los reconocimientos médicos.',
    'Expresando los mismos, mediante su firma, su conformidad con las instrucciones de la Empresa.',
  ];
  doc.setFont('helvetica','normal');
  doc.setFontSize(9);
  for (const p of paragraphs) {
    const lines = doc.splitTextToSize(p, width);
    doc.text(lines, 18, y);
    y += lines.length * 4.4 + 5;
  }

  doc.setFont('helvetica','bold');
  doc.setFontSize(10.5);
  const workLines = doc.splitTextToSize(String(obra || '').toUpperCase(), width);
  doc.text(workLines, 18, y);
  y += workLines.length * 5 + 5;
  doc.line(18, y, 192, y);
  y += 8;
  doc.text(`CATEGORÍA ${String(record.category || '').toUpperCase()}`, 18, y);
  y += 4;
  doc.line(18, y, 192, y);
  y += 8;

  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setFont('helvetica','bold');
  doc.setFontSize(8.5);
  doc.text('TRABAJADOR/A', 18, y);
  doc.text('FIRMA', 120, y);
  y += 3;
  doc.setLineWidth(0.35);
  doc.line(18, y, 190, y);
  y += 8;

  const inicioRowHeight = 16;
  const inicioSignatureHeight = 11;
  const inicioSignatureWidth = 48;
  const renderInicioHeader = () => {
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);
    doc.setFont('helvetica','bold');
    doc.setFontSize(8.5);
    doc.text('TRABAJADOR/A', 18, y);
    doc.text('FIRMA', 120, y);
    y += 3;
    doc.setLineWidth(0.35);
    doc.line(18, y, 190, y);
    y += 8;
  };

  doc.setFontSize(9);
  for (const worker of record.workers || []) {
    if (y + inicioRowHeight > 274) {
      doc.addPage('a4','portrait');
      y = 24;
      renderInicioHeader();
    }

    const rowTop = y - 5;
    const rowBottom = rowTop + inicioRowHeight;
    const signatureRaw = (record.signatures || {})[String(worker.id)];
    const signature = typeof signatureRaw === 'string' ? signatureRaw : signatureRaw?.signature;

    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica','bold');
    doc.text(String(worker.apellidosNombre || '').toUpperCase(), 18, y, { maxWidth: 96 });

    if (signature) {
      const signatureY = rowTop + (inicioRowHeight - inicioSignatureHeight) / 2;
      try { doc.addImage(signature, 'PNG', 120, signatureY, inicioSignatureWidth, inicioSignatureHeight, undefined, 'FAST'); } catch {}
    } else {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.25);
      doc.line(120, rowTop + inicioRowHeight / 2 + 1, 170, rowTop + inicioRowHeight / 2 + 1);
    }

    doc.setDrawColor(90, 90, 90);
    doc.setLineWidth(0.2);
    doc.line(18, rowBottom, 190, rowBottom);
    y += inicioRowHeight;
  }

  doc.setFont('helvetica','normal');
  doc.setFontSize(9);
  doc.text(`Cádiz, a ${fmtEs(record.workDate)}`, 132, 286);
  applyInstitutionalPdfStandard(doc);
  return { doc, filename: `INICIO_${String(record.category || 'GENERAL').replace(/[^a-zA-Z0-9]+/g,'_')}_${record.workDate}.pdf` };
}
