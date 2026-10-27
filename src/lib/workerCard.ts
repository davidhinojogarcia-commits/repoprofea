import { jsPDF } from 'jspdf';
import type { Person } from '../../types';

// Explicit allowlist: the shareable card never includes the worker's file or QR access token.
export function generateWorkerCard(person: Person) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [95, 62], compress: true });
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, 95, 62, 'F');
  doc.setFillColor(0, 84, 142);
  doc.rect(0, 0, 95, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('DIPUTACIÓN PROVINCIAL DE CÁDIZ', 4, 5);
  doc.setFontSize(6.5);
  doc.text('PROFEA · TARJETA DEL TRABAJADOR', 4, 9);

  const fitLines = (text: string, width: number, maxLines: number, initialSize: number) => {
    let size = initialSize;
    doc.setFontSize(size);
    let lines = doc.splitTextToSize(text || '—', width) as string[];
    while (lines.length > maxLines && size > 5) {
      size -= 0.25;
      doc.setFontSize(size);
      lines = doc.splitTextToSize(text || '—', width) as string[];
    }
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      let last = lines[maxLines - 1];
      while (last && doc.getTextWidth(`${last}...`) > width) last = last.slice(0, -1);
      lines[maxLines - 1] = `${last}...`;
    }
    return lines;
  };
  doc.setTextColor(15, 23, 42);
  doc.text(fitLines(person.apellidosNombre.toUpperCase(), 87, 2, 9), 4, 18);

  const field = (label: string, value: string, y: number, maxLines = 1) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(label, 4, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(fitLines(value, 66, maxLines, 7), 25, y);
  };
  const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : '—';
  field('DNI / NIE', person.dni, 28);
  field('CATEGORÍA', person.categoria || 'Peón', 34);
  field('OBRA', person.obra, 40, 2);
  field('CONTRATO', `${date(person.periodoInicio)} a ${date(person.periodoFin)}`, 50);
  doc.setDrawColor(226, 232, 240);
  doc.line(4, 54, 91, 54);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(100, 116, 139);
  doc.text('Tarjeta personal de identificación PROFEA', 4, 58);
  const name = person.apellidosNombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Trabajador';
  return { doc, filename: `CARNE_PROFEA_${name}.pdf` };
}

export function downloadWorkerCard(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function shareWorkerCard(file: File): Promise<'shared' | 'cancelled' | 'downloaded'> {
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Carnet PROFEA' });
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    }
  }
  downloadWorkerCard(file, file.name);
  return 'downloaded';
}
