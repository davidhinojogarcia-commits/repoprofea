import { InventoryItem, saveInventoryItem } from '../services/inventoryService';

export type ImportedInventoryItem = Partial<InventoryItem> & { nombre: string; categoria: string };
export type InventoryImportPlanRow = { key: string; imported: ImportedInventoryItem; existing?: InventoryItem };

const normalize = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();

export const inventoryIdentityKey = (item: Partial<InventoryItem>) => {
  const matricula = normalize(item.matricula);
  if (matricula) return `MATRICULA:${matricula}`;
  const serie = normalize(item.numeroSerie);
  if (serie) return `SERIE:${serie}`;
  const codigo = normalize(item.codigo);
  if (codigo) return `CODIGO:${codigo}`;
  const signature = [item.nombre, item.marca, item.modelo, item.categoria]
    .map(normalize)
    .filter(Boolean)
    .join('|');
  return signature ? `FIRMA:${signature}` : '';
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo Excel.'));
    reader.readAsDataURL(file);
  });

export const analyzeInventoryExcel = async (file: File): Promise<ImportedInventoryItem[]> => {
  if (!/\.xlsx?$/i.test(file.name)) throw new Error('El archivo debe estar en formato Excel (.xlsx o .xls).');
  const fileBase64 = await readFileAsDataUrl(file);
  const requestBody = JSON.stringify({ fileBase64, filename: file.name });
  let response = await fetch('/api/inventory-analyze-excel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody,
  });

  // En desarrollo local antiguo mantenemos compatibilidad con el endpoint Express.
  if (response.status === 404) {
    response = await fetch('/api/inventory/analyze-excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    });
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error || (response.status === 413
      ? 'El Excel es demasiado grande para enviarlo al servidor.'
      : 'No se pudo analizar el Excel.');
    throw new Error(detail);
  }

  const validStates = new Set([
    'Disponible', 'Asignada a obra', 'En traslado', 'Averiada', 'En reparación',
    'Pendiente de revisión', 'Fuera de servicio', 'Baja',
  ]);

  return (Array.isArray(payload?.items) ? payload.items : [])
    .filter((item: any) => String(item?.nombre || '').trim())
    .map((item: any) => ({
      codigo: String(item.codigo || '').trim(),
      categoria: String(item.categoria || 'OTROS').trim() || 'OTROS',
      nombre: String(item.nombre || '').trim(),
      marca: String(item.marca || '').trim(),
      modelo: String(item.modelo || '').trim(),
      numeroSerie: String(item.numeroSerie || '').trim(),
      matricula: String(item.matricula || '').trim(),
      cantidad: Math.max(1, Number(item.cantidad || 1)),
      tipoGestion: item.tipoGestion === 'lote' ? 'lote' : 'individual',
      estado: validStates.has(String(item.estado || '')) ? String(item.estado) : 'Disponible',
      ubicacionActual: String(item.ubicacionActual || '').trim(),
      detalles: item.detalles && typeof item.detalles === 'object' ? item.detalles : {},
      observaciones: String(item.observaciones || '').trim(),
      activo: true,
    }));
};

export const buildInventoryImportPlan = (detected: ImportedInventoryItem[], existingItems: InventoryItem[]) => {
  const existingByKey = new Map<string, InventoryItem>();
  existingItems.forEach(item => {
    const key = inventoryIdentityKey(item);
    if (key) existingByKey.set(key, item);
  });

  const unique = new Map<string, ImportedInventoryItem>();
  detected.forEach((item, index) => {
    const key = inventoryIdentityKey(item) || `NUEVO:${index}:${normalize(item.nombre)}`;
    const previous = unique.get(key);
    unique.set(key, previous ? { ...previous, ...item, detalles: { ...(previous.detalles || {}), ...(item.detalles || {}) } } : item);
  });

  const rows: InventoryImportPlanRow[] = Array.from(unique.entries()).map(([key, imported]) => ({
    key,
    imported,
    existing: existingByKey.get(key),
  }));
  return {
    rows,
    creates: rows.filter(row => !row.existing).length,
    updates: rows.filter(row => Boolean(row.existing)).length,
  };
};

const mergeItem = (existing: InventoryItem | undefined, imported: ImportedInventoryItem, baseLocation: string) => ({
  ...(existing || {}),
  ...(existing?.id ? { id: existing.id } : {}),
  codigo: imported.codigo || existing?.codigo || '',
  categoria: imported.categoria || existing?.categoria || 'OTROS',
  nombre: imported.nombre || existing?.nombre || 'Equipo sin nombre',
  marca: imported.marca || existing?.marca || null,
  modelo: imported.modelo || existing?.modelo || null,
  numeroSerie: imported.numeroSerie || existing?.numeroSerie || null,
  matricula: imported.matricula || existing?.matricula || null,
  cantidad: Math.max(1, Number(imported.cantidad || existing?.cantidad || 1)),
  tipoGestion: imported.tipoGestion === 'lote' ? 'lote' as const : (existing?.tipoGestion || 'individual' as const),
  estado: imported.estado || existing?.estado || 'Disponible',
  ubicacionActual: imported.ubicacionActual || existing?.ubicacionActual || baseLocation,
  obraActualId: existing?.obraActualId || null,
  responsableActual: existing?.responsableActual || null,
  detalles: { ...(existing?.detalles || {}), ...((imported.detalles as Record<string, unknown>) || {}) },
  observaciones: imported.observaciones || existing?.observaciones || null,
  activo: true,
});

export const applyInventoryImportPlan = async (parkId: string, baseLocation: string, rows: InventoryImportPlanRow[]) => {
  let created = 0;
  let updated = 0;
  let failed = 0;
  const queue = rows.slice();
  const runners = Array.from({ length: Math.min(8, Math.max(1, queue.length)) }, async () => {
    while (queue.length) {
      const row = queue.shift();
      if (!row) break;
      try {
        await saveInventoryItem(parkId, mergeItem(row.existing, row.imported, baseLocation), baseLocation);
        if (row.existing) updated += 1;
        else created += 1;
      } catch (error) {
        console.error('[inventory-excel-import]', row.imported, error);
        failed += 1;
      }
    }
  });
  await Promise.all(runners);
  return { created, updated, failed };
};