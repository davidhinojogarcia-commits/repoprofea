import { PREVENTION_CHECKS, PREVENTION_STATUS_LABELS, type PreventionRecord } from '../lib/prevention';
import type { PreventionActHistoryEvent } from './preventionService';

export type PreventionActFilters = {
  obra?: string;
  status?: string;
  from?: string;
  to?: string;
};

export type PreventionActIssuer = {
  supervisorName?: string;
  supervisorEmail?: string;
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
  issuer: PreventionActIssuer = {},
): Promise<{ blob: Blob; fileName: string }> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 15;
  const contentWidth = pageWidth - marginX * 2;
  const bottom = 24;
  let y = 18;

  const ensure = (height = 8) => {
    if (y + height > pageHeight - bottom) {
      doc.addPage();
      y = 18;
    }
  };

  const text = (
    value: string,
    opts: { bold?: boolean; size?: number; gap?: number; indent?: number; color?: [number, number, number] } = {},
  ) => {
    const size = opts.size ?? 9.3;
    const indent = opts.indent ?? 0;
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const color = opts.color ?? [33, 45, 58];
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(value || '—', contentWidth - indent);
    ensure(lines.length * 4.4 + (opts.gap ?? 1));
    doc.text(lines, marginX + indent, y);
    y += lines.length * 4.4 + (opts.gap ?? 1);
  };

  const section = (title: string) => {
    ensure(12);
    doc.setFillColor(0, 84, 142);
    doc.roundedRect(marginX, y - 3, contentWidth, 9, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(title.toUpperCase(), marginX + 3, y + 3);
    y += 11;
  };

  const infoRow = (label: string, value: string, x: number, width: number, top: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(90, 105, 120);
    doc.text(label.toUpperCase(), x, top);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.2);
    doc.setTextColor(25, 40, 55);
    const lines = doc.splitTextToSize(value || '—', width);
    doc.text(lines, x, top + 5);
  };

  const now = new Date();
  const generatedAt = now.toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid',
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const year = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', year: 'numeric' }).format(now);
  const reference = `ACP-${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(now).replace(/-/g, '')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

  doc.setFillColor(0, 84, 142);
  doc.rect(0, 0, pageWidth, 31, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16.5);
  doc.text('ACTA DE COMUNICACIÓN PREVENTIVA', marginX, 12.5);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.text('Incidencias, alertas, comprobaciones y seguimiento preventivo', marginX, 20);
  doc.setFontSize(8);
  doc.text('Sistema de Gestión PROFEA · Diputación de Cádiz', marginX, 26);
  y = 39;

  ensure(30);
  doc.setFillColor(247, 249, 251);
  doc.setDrawColor(210, 218, 226);
  doc.roundedRect(marginX, y - 3, contentWidth, 27, 2, 2, 'FD');
  const col = (contentWidth - 9) / 2;
  infoRow('Referencia documental', reference, marginX + 4, col - 4, y + 2);
  infoRow('Fecha y hora de emisión', generatedAt, marginX + col + 5, col - 4, y + 2);
  infoRow('Obra / ámbito', filters.obra || 'Todas las obras seleccionadas', marginX + 4, col - 4, y + 14);
  infoRow('Periodo', `${filters.from || 'Sin fecha inicial'} — ${filters.to || 'Sin fecha final'}`, marginX + col + 5, col - 4, y + 14);
  y += 31;

  section('Responsable del registro');
  ensure(22);
  doc.setFillColor(250, 252, 254);
  doc.setDrawColor(210, 218, 226);
  doc.roundedRect(marginX, y - 3, contentWidth, 18, 2, 2, 'FD');
  infoRow('Supervisor responsable', issuer.supervisorName || 'Supervisor autenticado', marginX + 4, contentWidth * 0.55, y + 1);
  infoRow('Correo', issuer.supervisorEmail || 'No indicado', marginX + contentWidth * 0.58, contentWidth * 0.37, y + 1);
  y += 22;
  text('El presente documento se emite desde GestionProfea como constancia de las comunicaciones y comprobaciones registradas por el supervisor responsable.', { size: 8.4, color: [75, 88, 103], gap: 3 });

  const incidentCount = records.filter(r => r.kind === 'incident').length;
  const precheckCount = records.filter(r => r.kind === 'precheck').length;
  const pendingCount = records.filter(r => r.status !== 'closed').length;
  const highCount = records.filter(r => r.status !== 'closed' && r.severity === 'high').length;

  section('Resumen ejecutivo');
  ensure(24);
  const cardGap = 3;
  const cardWidth = (contentWidth - cardGap * 3) / 4;
  const summaryCards = [
    ['Incidencias', incidentCount],
    ['Comprobaciones', precheckCount],
    ['Pendientes', pendingCount],
    ['Prioridad alta', highCount],
  ] as const;
  summaryCards.forEach(([label, value], index) => {
    const x = marginX + index * (cardWidth + cardGap);
    doc.setFillColor(247, 249, 251);
    doc.setDrawColor(215, 222, 229);
    doc.roundedRect(x, y - 3, cardWidth, 18, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(0, 84, 142);
    doc.text(String(value), x + 4, y + 5);
    doc.setFontSize(7.5);
    doc.setTextColor(70, 82, 95);
    doc.text(label, x + 4, y + 11);
  });
  y += 23;
  text(`Estado filtrado: ${filters.status ? (PREVENTION_STATUS_LABELS[filters.status as keyof typeof PREVENTION_STATUS_LABELS] || filters.status) : 'Todos los estados'} · Registros incluidos: ${records.length}`, { size: 8.8, gap: 2 });
  text('Este acta documenta comunicaciones y comprobaciones preventivas. No sustituye la evaluación de riesgos, el plan de seguridad y salud ni las obligaciones preventivas exigibles.', { size: 8.2, color: [90, 100, 112], gap: 3 });

  const eventsByRecord = new Map<string, PreventionActHistoryEvent[]>();
  for (const event of events) {
    const bucket = eventsByRecord.get(event.record_id) || [];
    bucket.push(event);
    eventsByRecord.set(event.record_id, bucket);
  }

  section('Relación de registros');
  records.forEach((record, index) => {
    ensure(48);
    doc.setFillColor(245, 248, 251);
    doc.setDrawColor(205, 215, 224);
    doc.roundedRect(marginX, y - 2, contentWidth, 10, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 84, 142);
    doc.text(`${index + 1}. ${record.kind === 'incident' ? 'INCIDENCIA / ALERTA' : 'COMPROBACIÓN PREVIA'}`, marginX + 3, y + 4.5);
    y += 13;

    text(record.title, { bold: true, size: 11, gap: 1.5 });
    text(`Obra: ${record.obra} · Fecha: ${record.work_date} · Tipo de riesgo: ${record.category}`, { size: 8.8, gap: 0.5 });
    text(`Prioridad: ${severityLabel(record.severity)} · Estado: ${PREVENTION_STATUS_LABELS[record.status]}`, { size: 8.8, bold: true, gap: 1.5 });
    text(`Tarea: ${record.task}`, { size: 9 });
    if (record.description) text(`Descripción: ${record.description}`, { size: 9 });
    if (record.measures) text(`Medidas adoptadas / propuestas: ${record.measures}`, { size: 9 });
    text(`Responsable de actuación: ${record.responsible || 'Pendiente de asignar'} · Plazo: ${record.deadline || 'Sin plazo'}`, { size: 8.8 });
    text(`Registro original: ${record.actor || 'Supervisor'} · Última actualización: ${formatDateTime(record.updated_at)}`, { size: 8.2, color: [90, 100, 112], gap: 2 });

    if (record.kind === 'precheck') {
      ensure(12);
      text('Estado de comprobaciones', { bold: true, size: 9.4, color: [0, 84, 142], gap: 1 });
      for (const check of PREVENTION_CHECKS) {
        const status = checkLabel(record.checks?.[check.id]);
        text(`• ${check.label}: ${status}`, { size: 8.4, indent: 3, gap: 0.4 });
      }
      y += 1;
    }

    const history = eventsByRecord.get(record.id) || [];
    text('Historial y seguimiento', { bold: true, size: 9.4, color: [0, 84, 142], gap: 1 });
    if (!history.length) {
      text('Sin movimientos de seguimiento adicionales.', { size: 8.4, indent: 3, gap: 1 });
    } else {
      history.forEach(event => {
        const snapshot = event.snapshot || ({} as PreventionRecord);
        text(
          `• ${event.action === 'created' ? 'Registro inicial' : 'Seguimiento'} · ${formatDateTime(event.created_at)} · ${event.actor || 'Supervisor'} · Estado: ${snapshot.status ? PREVENTION_STATUS_LABELS[snapshot.status] : '—'}`,
          { size: 8.2, indent: 3, gap: 0.5 },
        );
        if (snapshot.measures) text(`Medidas: ${snapshot.measures}`, { size: 8, indent: 6, gap: 0.4 });
        if (snapshot.responsible || snapshot.deadline) {
          text(`Responsable: ${snapshot.responsible || 'Pendiente'} · Plazo: ${snapshot.deadline || 'Sin plazo'}`, { size: 8, indent: 6, gap: 0.4 });
        }
      });
    }

    ensure(8);
    doc.setDrawColor(220, 226, 232);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 6;
  });

  section('Constancia de emisión');
  text(`Supervisor responsable del registro: ${issuer.supervisorName || 'Supervisor autenticado'}`, { bold: true, size: 9.5 });
  if (issuer.supervisorEmail) text(`Correo: ${issuer.supervisorEmail}`, { size: 8.8 });
  text(`Documento emitido: ${generatedAt} · Referencia: ${reference}`, { size: 8.8 });
  text('La emisión de esta acta deja constancia documental de la información registrada en GestionProfea en la fecha indicada.', { size: 8.4, color: [80, 92, 105] });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(218, 224, 230);
    doc.line(marginX, pageHeight - 16, pageWidth - marginX, pageHeight - 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(88, 100, 112);
    doc.text(`© ${year} David Hinojo García. Todos los derechos reservados.`, marginX, pageHeight - 10);
    doc.text('Sistema de Gestión PROFEA · Acta de comunicación preventiva', marginX, pageHeight - 6.5);
    doc.text(`Página ${page} de ${pages}`, pageWidth - marginX, pageHeight - 6.5, { align: 'right' });
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
