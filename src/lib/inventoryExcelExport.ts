import type {
  InventoryPark, InventoryParkShare, InventoryItem, InventoryMovement,
  InventoryMaintenance, InventoryDocument,
} from '../services/inventoryService';

type Snapshot = {
  exportedAt: string;
  items: InventoryItem[];
  movements: InventoryMovement[];
  maintenance: InventoryMaintenance[];
  documents: InventoryDocument[];
  shares: InventoryParkShare[];
};

const safeCell = (v: unknown): string | number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const text = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Evitar que datos procedentes de usuarios se interpreten como fórmulas al abrir Excel.
  return /^[\s]*[=+@\-]/.test(text) ? `'${text}` : text;
};
const fmt = (v?: string | null) => v ? new Date(v).toLocaleString('es-ES') : '';
const filePart = (v: string) => v.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 65);

async function institutionalLogo(): Promise<string | null> {
  try {
    const response = await fetch('/logo-diputacion-profea.svg');
    if (!response.ok) return null;
    const svg = await response.text();
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Logo no disponible'));
        image.src = blobUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 220;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    } finally { URL.revokeObjectURL(blobUrl); }
  } catch { return null; }
}

export async function exportInventoryParkExcel(park: InventoryPark, snapshot: Snapshot) {
  const ExcelJS = (await import('exceljs')).default;
  const book = new ExcelJS.Workbook();
  book.creator = 'Gestión PROFEA · Diputación de Cádiz';
  book.title = `Inventario y trazabilidad · ${park.nombre}`;
  book.subject = 'Exportación institucional del parque de maquinaria';
  book.created = new Date(snapshot.exportedAt);
  const logo = await institutionalLogo();
  const logoId = logo ? book.addImage({ base64: logo, extension: 'png' }) : null;

  function sheet(name: string, headers: string[], rows: (string | number | null | undefined)[][]) {
    const ws = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 7 }] });
    const total = headers.length;
    const last = ws.getColumn(total).letter;
    ws.mergeCells(`C1:${last}2`);
    ws.getCell('C1').value = 'DIPUTACIÓN DE CÁDIZ · GESTIÓN PROFEA';
    ws.getCell('C1').font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF00548E' } };
    ws.getCell('C1').alignment = { vertical: 'middle', wrapText: true };
    ws.mergeCells(`C3:${last}3`);
    ws.getCell('C3').value = `${park.zona} · ${park.nombre} · ${name}`;
    ws.getCell('C3').font = { size: 11, bold: true, color: { argb: 'FF334155' } };
    ws.mergeCells(`A5:${last}5`);
    ws.getCell('A5').value = `Corte de datos: ${fmt(snapshot.exportedAt)} · Registros: ${rows.length}`;
    ws.getCell('A5').font = { size: 10, italic: true, color: { argb: 'FF475569' } };
    if (logoId !== null) ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 130, height: 51 } });
    const headRow = ws.getRow(7);
    headers.forEach((h, i) => {
      const cell = headRow.getCell(i + 1);
      cell.value = h;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00548E' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.alignment = { vertical: 'middle', wrapText: true };
      ws.getColumn(i + 1).width = Math.max(17, Math.min(38, h.length + 8));
    });
    headRow.height = 31;
    for (const data of rows) {
      const row = ws.addRow(data.map(safeCell));
      row.eachCell(cell => {
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.font = { size: 10, color: { argb: 'FF1E293B' } };
        if (row.number % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F6FA' } };
      });
    }
    ws.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7 + rows.length, column: total } };
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    ws.headerFooter.oddFooter = 'Gestión PROFEA · Parque de maquinaria · Página &P de &N';
    return ws;
  }

  const count = (status: string) => snapshot.items.filter(i => i.estado === status && i.activo).length;
  sheet('Resumen', ['Concepto', 'Resultado', 'Información adicional'], [
    ['Zona', park.zona, ''], ['Parque', park.nombre, ''], ['Coordinación', park.coordinatorEmail || '', ''],
    ['Exportación', fmt(snapshot.exportedAt), 'Fecha y hora de corte'],
    ['Equipos activos', snapshot.items.filter(i => i.activo).length, 'Incluye todos los estados'],
    ['Equipos dados de baja', snapshot.items.filter(i => !i.activo).length, 'Se conservan para consulta histórica'],
    ['Disponibles', count('Disponible'), ''],
    ['Movimientos registrados', snapshot.movements.length, 'Desde el primer registro conservado'],
    ['Mantenimientos registrados', snapshot.maintenance.length, ''],
    ['Documentos registrados', snapshot.documents.length, ''],
    ['Supervisores con acceso', snapshot.shares.filter(s => s.status === 'accepted').length, ''],
    ['Alcance histórico', 'Registros conservados en la base de datos', 'No reconstruye cambios anteriores al inicio del registro ni eventos no auditados'],
  ]);
  sheet('Inventario', ['Código','Categoría','Equipo','Marca','Modelo','Serie','Matrícula','Cantidad','Gestión','Estado','Ubicación','Obra','Responsable de uso','Supervisor responsable','Activo','Alta','Última actualización','Observaciones','Detalles'], snapshot.items.map(i=>[
    i.codigo,i.categoria,i.nombre,i.marca,i.modelo,i.numeroSerie,i.matricula,i.cantidad,i.tipoGestion,
    i.estado,i.ubicacionActual,i.obraActualId,i.responsableActual,i.supervisorResponsableNombre,
    i.activo?'Sí':'No',fmt(i.createdAt),fmt(i.updatedAt),i.observaciones,i.detalles,
  ]));
  const itemNames = new Map(snapshot.items.map(i=>[i.id,`${i.codigo} · ${i.nombre}`]));
  sheet('Trazabilidad', ['Fecha y hora','Equipo','Tipo de movimiento','Origen','Destino','Obra','Estado anterior','Estado nuevo','Responsable ID','Registrado por','Coordenadas','Fotografías (rutas)','Observaciones','ID de movimiento'],
    snapshot.movements.slice().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(m=>[
      fmt(m.createdAt),itemNames.get(m.itemId)||m.itemId,m.tipo,m.origen,m.destino,m.obraId,
      m.estadoAnterior,m.estadoNuevo,m.responsableId,m.createdByName||m.createdBy,
      m.latitud!=null&&m.longitud!=null?`${m.latitud}, ${m.longitud}`:'',
      (m.fotoPaths||[]).join(' · '),m.observaciones,m.id,
    ]));
  sheet('Mantenimiento', ['Equipo','Tipo','Fecha','Próxima revisión','Proveedor','Técnico','Coste (€)','Observaciones','Documentos firmados (rutas)','Registrado por','ID'], snapshot.maintenance.map(m=>[
    itemNames.get(m.itemId)||m.itemId,m.tipo,m.fecha,m.proximaRevision,m.proveedor,m.mechanicName,m.coste,m.observaciones,
    (m.signedDocumentPaths||[]).join(' · '),m.createdBy,m.id,
  ]));
  sheet('Documentación', ['Equipo','Tipo','Título','Nombre de archivo','Emisión','Caducidad','Observaciones','Ruta de archivo','Fecha de registro','ID'], snapshot.documents.map(d=>[
    itemNames.get(d.itemId)||d.itemId,d.documentType,d.title,d.fileName,d.issueDate,d.expiryDate,d.notes,d.filePath,fmt(d.createdAt),d.id,
  ]));
  sheet('Supervisores', ['Nombre','Correo','Rol','Estado','Titular','Alta/aceptación','Identificador'], snapshot.shares.map(s=>[
    s.displayName,s.email,s.role,s.status==='accepted'?'Aceptado':'Pendiente',s.isOwner?'Sí':'No',fmt(s.acceptedAt),s.userId||s.participantKey,
  ]));
  const buffer = await book.xlsx.writeBuffer();
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  try {
    link.href=url;
    link.download=`PARQUE_COMPLETO_${filePart(park.zona)}_${new Date(snapshot.exportedAt).toISOString().slice(0,10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally { window.setTimeout(()=>URL.revokeObjectURL(url),30000); }
  return link.download;
}
