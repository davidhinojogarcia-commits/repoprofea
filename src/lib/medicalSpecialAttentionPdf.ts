import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Person, getAptitudMedicaInfo } from '../../types';
import { getStoredPdfConfig, renderPdfLogo, applyPdfFooters } from './exportUtils';

export type SpecialAttentionColumns = {
  dni: boolean;
  obra: boolean;
  quincena: boolean;
  fecha: boolean;
  estado: boolean;
  limitaciones: boolean;
};

export type SpecialAttentionFilters = {
  obra?: string;
  mes?: string;
  mesLabel?: string;
  quincena?: string;
  estadoLabel?: string;
};

const BLUE: [number, number, number] = [0, 84, 142];
const LIGHT_BLUE: [number, number, number] = [240, 247, 255];
const safe = (value: unknown) => String(value ?? '').trim();
const formatDate = (value: unknown) => {
  const text = safe(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text || '-';
};

const exportPdfFile = (doc: jsPDF, filename: string) => {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS = /iPad|iPhone|iPod/i.test(ua) || (/Macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);

  try {
    if (isIOS) {
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) window.location.href = url;
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.rel = 'noopener';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  } finally {
    // Safari needs the object URL to remain alive while its PDF viewer opens it.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
};

export const generateMedicalSpecialAttentionPdf = (
  people: Person[],
  filters: SpecialAttentionFilters,
  columns: SpecialAttentionColumns,
) => {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
  const config = getStoredPdfConfig();
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setProperties({
    title: 'Informe de trabajadores con especial atención',
    subject: 'Trabajadores aptos con limitaciones',
    author: 'Diputación Provincial de Cádiz',
    creator: 'Sistema de Gestión PROFEA',
  });

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, 20, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...BLUE);
  doc.text((config.headerLine1 || 'DIPUTACIÓN PROVINCIAL DE CÁDIZ').toUpperCase(), 14, 8.3);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(100, 116, 139);
  doc.text((config.headerLine2 || 'DESARROLLO LOCAL | GESTIÓN DE FONDOS PROFEA').toUpperCase(), 14, 13.5);
  renderPdfLogo(doc, pageWidth - 68, 4.5, 53, 10.5, true, config.customLogo);
  doc.setDrawColor(218, 226, 233);
  doc.setLineWidth(0.25);
  doc.line(14, 18.2, pageWidth - 14, 18.2);

  doc.setFillColor(...BLUE);
  doc.rect(0, 20, pageWidth, 20, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text('INFORME DE TRABAJADORES CON ESPECIAL ATENCIÓN', 14, 27.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.setTextColor(226, 241, 249);
  doc.text(`${filters.estadoLabel || 'Aptos con limitaciones'} · ${people.length} trabajador(es)`, 14, 33);
  doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, 14, 37);

  const applied = [
    filters.obra ? `Obra: ${filters.obra}` : 'Obra: Todas',
    filters.mes ? `Mes: ${filters.mesLabel || filters.mes}` : 'Mes: Todos',
    filters.quincena ? `Quincena: ${filters.quincena}` : 'Quincena: Todas',
    `Aptitud: ${filters.estadoLabel || 'Aptos con limitaciones'}`,
  ];

  doc.setFillColor(247, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, 45, pageWidth - 28, 16, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('FILTROS APLICADOS', 18, 50.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(30, 41, 59);
  doc.text(applied.join('   ·   '), 18, 56.2, { maxWidth: pageWidth - 36 });

  doc.setFillColor(255, 251, 235);
  doc.setDrawColor(245, 158, 11);
  doc.roundedRect(14, 65, pageWidth - 28, 12, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(146, 64, 14);
  doc.text('ESPECIAL ATENCIÓN:', 18, 72);
  doc.setFont('helvetica', 'normal');
  doc.text('Antes de asignar tareas, revisar y respetar las limitaciones médicas indicadas para cada trabajador.', 48, 72);

  const headers: string[] = ['Nº', 'TRABAJADOR'];
  if (columns.dni) headers.push('DNI/NIE');
  if (columns.obra) headers.push('OBRA');
  if (columns.quincena) headers.push('QUINCENA');
  if (columns.fecha) headers.push('RECONOCIMIENTO');
  if (columns.estado) headers.push('APTITUD');
  if (columns.limitaciones) headers.push('LIMITACIONES');

  const body = people.map((person, index) => {
    const info = getAptitudMedicaInfo(person);
    const row: string[] = [String(index + 1), safe(person.apellidosNombre) || '-'];
    if (columns.dni) row.push(safe(person.dni) || '-');
    if (columns.obra) row.push(safe(person.obra) || '-');
    if (columns.quincena) row.push(safe(person.quincena) || '-');
    if (columns.fecha) row.push(formatDate(person.reconocimientoFecha));
    if (columns.estado) row.push(info.estado);
    if (columns.limitaciones) row.push(info.limitaciones || (info.estado === 'Apto con limitaciones' ? 'LIMITACIÓN PENDIENTE DE DETALLE' : '—'));
    return row;
  });

  autoTable(doc, {
    head: [headers],
    body: body.length ? body : [['-', 'No hay trabajadores que coincidan con los filtros seleccionados.']],
    startY: 82,
    margin: { left: 14, right: 14, bottom: 18 },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 7.7,
      cellPadding: 2.5,
      valign: 'middle',
      textColor: [30, 41, 59],
      lineColor: [203, 213, 225],
      lineWidth: 0.2,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: BLUE,
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 7.2,
      halign: 'center',
    },
    alternateRowStyles: { fillColor: LIGHT_BLUE },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 42, fontStyle: 'bold' },
    },
    didParseCell: data => {
      if (data.section === 'body' && headers[data.column.index] === 'LIMITACIONES') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.textColor = [146, 64, 14];
      }
    },
  });

  applyPdfFooters(doc, config);
  const suffix = [filters.obra, filters.mes, filters.quincena].filter(Boolean).join('_').replace(/[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ_-]+/g, '_');
  const filename = `INFORME_ESPECIAL_ATENCION${suffix ? `_${suffix}` : ''}_${new Date().toISOString().slice(0, 10)}.pdf`;
  exportPdfFile(doc, filename);
  return { doc, filename };
};
