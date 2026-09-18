import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  InventoryDocument,
  InventoryItem,
  InventoryMaintenance,
  InventoryMovement,
  InventoryPark,
  parkBaseLocation,
} from '../services/inventoryService';
import { applyInstitutionalPdfStandard, renderInstitutionalReportHeader, renderInstitutionalSectionTitle } from './exportUtils';

const BLUE: [number, number, number] = [0, 84, 142];
const LIGHT: [number, number, number] = [240, 247, 255];
const REQUIRED_DOCS = ['Marcado CE / placa identificativa', 'Declaración CE de conformidad', 'Manual de instrucciones', 'Revisión / comprobación periódica'];

const safeName = (value: string) => value.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]+/g, '_').replace(/^_+|_+$/g, '');
const fmtDate = (value?: string | null) => value ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString('es-ES') : '-';
const fmtDateTime = (value?: string | null) => value ? new Date(value).toLocaleString('es-ES') : '-';

const fetchImageData = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

const addHeader = (doc: jsPDF, title: string, subtitle: string) => {
  renderInstitutionalReportHeader(
    doc,
    title,
    subtitle,
    { subtitle: 'DESARROLLO LOCAL · GESTIÓN DE FONDOS PROFEA' },
  );
};

const ensureRoom = (doc: jsPDF, y: number, needed: number, title: string, subtitle: string) => {
  if (y + needed <= 275) return y;
  doc.addPage();
  addHeader(doc, title, subtitle);
  return 36;
};

const addSectionTitle = (doc: jsPDF, text: string, y: number) =>
  renderInstitutionalSectionTitle(doc, text, y, { x: 14, width: 182 });

const drawTraceMap = (doc: jsPDF, movements: InventoryMovement[], y: number) => {
  const geo = movements.filter(m => m.latitud != null && m.longitud != null);
  const h = 47;
  doc.setDrawColor(205, 215, 225);
  doc.setFillColor(249, 251, 253);
  doc.roundedRect(14, y, 182, h, 2, 2, 'FD');
  doc.setFontSize(7);
  doc.setTextColor(90, 100, 115);
  if (!geo.length) {
    doc.text('Sin coordenadas registradas. La trazabilidad cronológica y las fotografías se incluyen a continuación.', 18, y + 10);
    return y + h + 4;
  }

  const xs = geo.map(m => Number(m.longitud));
  const ys = geo.map(m => Number(m.latitud));
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const pts = geo.map((m, idx) => ({
    m,
    x: 24 + 160 * ((Number(m.longitud) - minX) / ((maxX - minX) || 1)),
    y: y + 37 - 27 * ((Number(m.latitud) - minY) / ((maxY - minY) || 1)),
    idx,
  }));
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.7);
  pts.slice(1).forEach((p, i) => doc.line(pts[i].x, pts[i].y, p.x, p.y));
  pts.forEach(p => {
    doc.setFillColor(...BLUE);
    doc.circle(p.x, p.y, 2.2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(40, 50, 65);
    doc.text(String(p.idx + 1), p.x + 3, p.y - 1);
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.6);
  doc.setTextColor(100, 110, 125);
  doc.text('Recorrido construido con las coordenadas registradas en cada movimiento.', 18, y + 43);
  return y + h + 4;
};

export async function exportInventoryStatusPdf(input: {
  park: InventoryPark;
  items: InventoryItem[];
  movements: InventoryMovement[];
  maintenance: InventoryMaintenance[];
  documents: InventoryDocument[];
}) {
  const { park, items, movements, maintenance, documents } = input;
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4', unit: 'mm' });
  const title = 'Informe de situación de herramientas y maquinaria';
  const subtitle = `${park.zona} · ${park.nombre}`;
  addHeader(doc, title, subtitle);

  let y = 36;
  // El informe de situación recibe únicamente equipos que están actualmente
  // en uso operativo: asignados a una obra o en traslado.
  const inCourse = items.filter(i => i.activo && /obra|traslado/i.test(i.estado || ''));
  const assignedToWork = inCourse.filter(i => /obra/i.test(i.estado || '')).length;
  const inTransit = inCourse.filter(i => /traslado/i.test(i.estado || '')).length;
  autoTable(doc, {
    startY: y,
    head: [['Parque / nave', 'Equipos en uso', 'Asignados a obra', 'En traslado']],
    body: [[parkBaseLocation(park), String(inCourse.length), String(assignedToWork), String(inTransit)]],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2.4, valign: 'middle' },
    headStyles: { fillColor: BLUE, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: LIGHT },
    margin: { left: 14, right: 14 },
  });
  y = ((doc as any).lastAutoTable?.finalY || y + 15) + 7;

  for (let index = 0; index < inCourse.length; index++) {
    const item = inCourse[index];
    const itemDocs = documents.filter(d => d.itemId === item.id);
    const itemMaint = maintenance.filter(m => m.itemId === item.id);
    const itemMoves = movements.filter(m => m.itemId === item.id).slice().sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const missing = REQUIRED_DOCS.filter(type => !itemDocs.some(d => d.documentType === type));

    y = ensureRoom(doc, y, 55, title, subtitle);
    y = addSectionTitle(doc, `${index + 1}. ${item.codigo || 'SIN CÓDIGO'} · ${item.nombre}`, y);

    autoTable(doc, {
      startY: y,
      body: [
        ['Categoría', item.categoria || '-', 'Estado actual', item.estado || '-'],
        ['Ubicación actual', item.ubicacionActual || '-', 'Marca / modelo', [item.marca, item.modelo].filter(Boolean).join(' · ') || '-'],
        ['Nº serie / matrícula', [item.numeroSerie, item.matricula].filter(Boolean).join(' · ') || '-', 'Documentación', missing.length ? `INCOMPLETA · faltan ${missing.length}` : 'BÁSICA COMPLETA'],
      ],
      theme: 'grid',
      styles: { fontSize: 7.8, cellPadding: 2.1, valign: 'middle' },
      columnStyles: { 0: { fontStyle: 'bold', fillColor: LIGHT }, 2: { fontStyle: 'bold', fillColor: LIGHT } },
      margin: { left: 14, right: 14 },
    });
    y = ((doc as any).lastAutoTable?.finalY || y + 20) + 5;

    y = ensureRoom(doc, y, 35, title, subtitle);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...BLUE); doc.text('DOCUMENTACIÓN', 14, y); y += 3;
    autoTable(doc, {
      startY: y,
      head: [['Documento', 'Emisión', 'Caducidad / revisión', 'Estado']],
      body: itemDocs.length ? itemDocs.map(d => [d.documentType, fmtDate(d.issueDate), fmtDate(d.expiryDate), d.expiryDate && new Date(d.expiryDate) < new Date() ? 'CADUCADO' : 'REGISTRADO']) : [['Sin documentación registrada', '-', '-', 'PENDIENTE']],
      theme: 'grid',
      styles: { fontSize: 7.2, cellPadding: 1.8 },
      headStyles: { fillColor: BLUE, textColor: 255, fontStyle: 'bold' },
      margin: { left: 14, right: 14 },
    });
    y = ((doc as any).lastAutoTable?.finalY || y + 18) + 5;

    y = ensureRoom(doc, y, 35, title, subtitle);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...BLUE); doc.text('MANTENIMIENTO Y REVISIONES', 14, y); y += 3;
    autoTable(doc, {
      startY: y,
      head: [['Fecha', 'Actuación', 'Próxima revisión', 'Taller / técnico', 'Observaciones']],
      body: itemMaint.length ? itemMaint.map(m => [fmtDate(m.fecha), m.tipo, fmtDate(m.proximaRevision), [m.proveedor, m.mechanicName].filter(Boolean).join(' · ') || '-', m.observaciones || '-']) : [['-', 'Sin actuaciones registradas', '-', '-', '-']],
      theme: 'grid',
      styles: { fontSize: 6.8, cellPadding: 1.6 },
      headStyles: { fillColor: BLUE, textColor: 255, fontStyle: 'bold' },
      margin: { left: 14, right: 14 },
    });
    y = ((doc as any).lastAutoTable?.finalY || y + 18) + 5;

    y = ensureRoom(doc, y, 60, title, subtitle);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...BLUE); doc.text('MAPA Y TRAZABILIDAD', 14, y); y += 3;
    y = drawTraceMap(doc, itemMoves, y);

    autoTable(doc, {
      startY: y,
      head: [['#', 'Fecha / hora', 'Movimiento', 'Origen', 'Destino', 'Estado']],
      body: itemMoves.length ? itemMoves.map((m, i) => [String(i + 1), fmtDateTime(m.createdAt), m.tipo, m.origen, m.destino, m.estadoNuevo || '-']) : [['-', '-', 'Sin movimientos registrados', '-', '-', '-']],
      theme: 'grid',
      styles: { fontSize: 6.7, cellPadding: 1.5 },
      headStyles: { fillColor: BLUE, textColor: 255, fontStyle: 'bold' },
      margin: { left: 14, right: 14 },
    });
    y = ((doc as any).lastAutoTable?.finalY || y + 18) + 5;

    const photoMoves = itemMoves.filter(m => m.fotoUrls?.length);
    if (photoMoves.length) {
      y = ensureRoom(doc, y, 45, title, subtitle);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...BLUE); doc.text('EVIDENCIAS FOTOGRÁFICAS DEL ESTADO', 14, y); y += 4;
      for (const move of photoMoves) {
        y = ensureRoom(doc, y, 42, title, subtitle);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.3); doc.setTextColor(55, 65, 80);
        doc.text(`${fmtDateTime(move.createdAt)} · ${move.tipo} · ${move.destino}`, 14, y + 3);
        y += 6;
        let x = 14;
        for (const url of (move.fotoUrls || []).slice(0, 3)) {
          const img = await fetchImageData(url);
          if (!img) continue;
          try {
            const props = (doc as any).getImageProperties(img);
            const ratio = props?.width && props?.height ? props.width / props.height : 1.4;
            let w = 55; let h = w / ratio;
            if (h > 32) { h = 32; w = h * ratio; }
            doc.addImage(img, img.startsWith('data:image/png') ? 'PNG' : 'JPEG', x, y, w, h, undefined, 'FAST');
            doc.setDrawColor(210, 218, 226); doc.rect(x, y, w, h);
            x += 59;
          } catch { /* imagen incompatible: se omite sin romper el informe */ }
        }
        y += 35;
      }
    }

    y += 5;
  }

  applyInstitutionalPdfStandard(doc);
  const filename = `INFORME_SITUACION_MAQUINARIA_${safeName(park.zona)}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
}
