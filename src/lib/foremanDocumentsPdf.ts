import { jsPDF } from 'jspdf';
import type { Person } from '../../types';
import { applyInstitutionalPdfStandard, renderInstitutionalReportHeader } from './exportUtils';
import {
  generateAdditionalWorksiteDocument,
  type AdditionalWorksiteDocumentType,
} from './worksiteAdditionalDocumentsPdf';
import type { ForemanAttendanceDay, ForemanCompletedDocument } from '../services/foremanPortalService';

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
