import { PREVENTION_CHECKS, PREVENTION_STATUS_LABELS, type PreventionRecord } from '../lib/prevention';
import type { PreventionActHistoryEvent } from './preventionService';

export type PreventionActFilters = {
  obra?: string;
  status?: string;
  from?: string;
  to?: string;
};

const severityLabel = (severity: PreventionRecord['severity']) =>
  severity === 'high' ? 'Alta' : severity === 'medium' ? 'Media' : 'Baja';

const checkLabel = (value?: string) =>
  value === 'yes' ? 'Comprobado' : value === 'no' ? 'Pendiente / problema detectado' : 'No aplica';

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('es-ES', {
      timeZone: 'Europe/Madrid',
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return value;
  }
};

const safeFilePart = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');

export async function createPreventionCommunicationActPdf(
  records: PreventionRecord[],
  events: PreventionActHistoryEvent[],
  filters: PreventionActFilters,
): Promise<{ blob: Blob; fileName: string }> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 16;
  const contentWidth = pageWidth - marginX * 2;
  const bottom = 18;
  let y = 18;

  const newPageIfNeeded = (height = 8) => {
    if (y + height > pageHeight - bottom) {
      doc.addPage();
      y = 18;
    }
  };

  const line = (text: string, opts: { bold?: boolean; size?: number; gap?: number; indent?: number } = {}) => {
    const size = opts.size ?? 9.5;
    const indent = opts.indent ?? 0;
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(28, 42, 58);
    const lines = doc.splitTextToSize(text || '—', contentWidth - indent);
    newPageIfNeeded(lines.length * 4.5 + (opts.gap ?? 1));
    doc.text(lines, marginX + indent, y);
    y += lines.length * 4.5 + (opts.gap ?? 1);
  };

  const rule = () => {
    newPageIfNeeded(5);
    doc.setDrawColor(205, 215, 225);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 5;
  };

  doc.setFillColor(0, 84, 142);
  doc.rect(0, 0, pageWidth, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('ACTA DE COMUNICACIÓN PREVENTIVA', marginX, 13);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Gestión PROFEA · Incidencias, alertas y comprobaciones', marginX, 21);
  y = 38;

  const now = new Date();
  const generatedAt = now.toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  line(`Fecha de emisión: ${generatedAt}`, { bold: true });
  line(`Obra: ${filters.obra || 'Todas las obras seleccionadas'}`);
  line(`Estado: ${filters.status ? (PREVENTION_STATUS_LABELS[filters.status as keyof typeof PREVENTION_STATUS_LABELS] || filters.status) : 'Todos'}`);
  line(`Periodo: ${filters.from || 'sin fecha inicial'} — ${filters.to || 'sin fecha final'}`);
  line(`Registros incluidos: ${records.length}`);
  rule();

  const incidentCount = records.filter(r => r.kind === 'incident').length;
  const precheckCount = records.filter(r => r.kind === 'precheck').length;
  const pendingCount = records.filter(r => r.status !== 'closed').length;
  const highCount = records.filter(r => r.status !== 'closed' && r.severity === 'high').length;

  line('RESUMEN', { bold: true, size: 12, gap: 2 });
  line(`Incidencias: ${incidentCount} · Comprobaciones previas: ${precheckCount} · Pendientes/en seguimiento: ${pendingCount} · Prioridad alta abierta: ${highCount}`);
  line('Este documento deja constancia de las comunicaciones y comprobaciones registradas en GestionProfea. No sustituye la evaluación de riesgos, el plan de seguridad y salud ni las obligaciones preventivas aplicables.', { size: 8.5, gap: 3 });
  rule();

  const eventsByRecord = new Map<string, PreventionActHistoryEvent[]>();
  for (const event of events) {
    const bucket = eventsByRecord.get(event.record_id) || [];
    bucket.push(event);
    eventsByRecord.set(event.record_id, bucket);
  }

  records.forEach((record, index) => {
    newPageIfNeeded(35);
    doc.setFillColor(242, 246, 249);
    doc.roundedRect(marginX, y - 3, contentWidth, 11, 2, 2, 'F');
    doc.setTextColor(0, 84, 142);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`${index + 1}. ${record.kind === 'incident' ? 'INCIDENCIA / ALERTA' : 'COMPROBACIÓN PREVIA'}`, marginX + 3, y + 4);
    y += 12;

    line(record.title, { bold: true, size: 11 });
    line(`Obra: ${record.obra} · Fecha: ${record.work_date} · Riesgo: ${record.category}`);
    line(`Prioridad: ${severityLabel(record.severity)} · Estado: ${PREVENTION_STATUS_LABELS[record.status]}`);
    line(`Tarea: ${record.task}`);
    if (record.description) line(`Descripción: ${record.description}`);
    if (record.measures) line(`Medidas: ${record.measures}`);
    line(`Responsable: ${record.responsible || 'Pendiente'} · Plazo: ${record.deadline || 'Sin plazo'}`);
    line(`Registrado por: ${record.actor} · Última actualización: ${formatDateTime(record.updated_at)}`, { size: 8.5 });

    if (record.kind === 'precheck') {
      line('Estado de comprobaciones:', { bold: true, gap: 1 });
      for (const check of PREVENTION_CHECKS) {
        line(`• ${check.label}: ${checkLabel(record.checks?.[check.id])}`, { size: 8.5, indent: 3, gap: 0.5 });
      }
    }

    const history = eventsByRecord.get(record.id) || [];
    line('Historial de seguimiento:', { bold: true, gap: 1 });
    if (!history.length) {
      line('Sin movimientos de seguimiento adicionales.', { size: 8.5, indent: 3 });
    } else {
      history.forEach(event => {
        const snapshot = event.snapshot || ({} as PreventionRecord);
        line(
          `• ${event.action === 'created' ? 'Registro inicial' : 'Seguimiento'} · ${formatDateTime(event.created_at)} · ${event.actor} · Estado: ${snapshot.status ? PREVENTION_STATUS_LABELS[snapshot.status] : '—'}`,
          { size: 8.5, indent: 3, gap: 0.5 },
        );
        if (snapshot.measures) line(`Medidas: ${snapshot.measures}`, { size: 8.2, indent: 6, gap: 0.5 });
        if (snapshot.responsible || snapshot.deadline) {
          line(`Responsable: ${snapshot.responsible || 'Pendiente'} · Plazo: ${snapshot.deadline || 'Sin plazo'}`, { size: 8.2, indent: 6, gap: 0.5 });
        }
      });
    }
    rule();
  });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(220, 226, 232);
    doc.line(marginX, pageHeight - 12, pageWidth - marginX, pageHeight - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(90, 105, 120);
    doc.text('Sistema de Gestión PROFEA · Acta de comunicación preventiva', marginX, pageHeight - 7);
    doc.text(`Página ${page} de ${pages}`, pageWidth - marginX, pageHeight - 7, { align: 'right' });
  }

  const obraPart = filters.obra ? `_${safeFilePart(filters.obra).slice(0, 40)}` : '';
  const datePart = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(now);
  const fileName = `Acta_comunicacion_preventiva${obraPart}_${datePart}.pdf`;
  return { blob: doc.output('blob'), fileName };
}

export async function shareOrDownloadPreventionAct(blob: Blob, fileName: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], fileName, { type: 'application/pdf' });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({
      title: 'Acta de comunicación preventiva',
      text: 'Acta de comunicación preventiva generada desde GestionProfea.',
      files: [file],
    });
    return 'shared';
  }

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }
  return 'downloaded';
}
