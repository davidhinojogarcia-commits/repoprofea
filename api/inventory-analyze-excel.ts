import { reportOperationalError } from '../src/lib/operationalLog.js';
import * as XLSX from 'xlsx';

type Row = Record<string, string>;

const norm = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const compact = (value: unknown) => norm(value).replace(/\s+/g, '');

const FIELD_ALIASES: Record<string, string[]> = {
  codigo: ['codigo','cod','codigo inventario','cod inventario','referencia','ref','id','numero inventario','n inventario','num inventario','activo','codigo activo'],
  categoria: ['categoria','familia','grupo','tipo','clase','tipo equipo','familia equipo'],
  nombre: ['nombre','equipo','maquina','maquinaria','herramienta','descripcion','denominacion','articulo','elemento','bien','material','concepto'],
  marca: ['marca','fabricante','manufacturer'],
  modelo: ['modelo','model'],
  numeroSerie: ['numero serie','n serie','num serie','serie','serial','serial number','numero de serie'],
  matricula: ['matricula','placa','registration'],
  cantidad: ['cantidad','cant','unidades','uds','ud','numero unidades','n unidades'],
  estado: ['estado','situacion','status','condicion'],
  ubicacionActual: ['ubicacion','ubicacion actual','localizacion','lugar','almacen','nave','obra','destino','emplazamiento','centro'],
  observaciones: ['observaciones','observacion','notas','nota','comentarios','comentario','incidencia','incidencias'],
};

const aliasIndex = new Map<string, string>();
Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
  aliases.forEach(alias => aliasIndex.set(compact(alias), field));
});

const canonicalHeader = (value: unknown): string | null => {
  const c = compact(value);
  if (!c) return null;
  if (aliasIndex.has(c)) return aliasIndex.get(c)!;
  for (const [alias, field] of aliasIndex.entries()) {
    if (c.length >= 4 && (c.includes(alias) || alias.includes(c))) return field;
  }
  return null;
};

const cleanCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return String(value).replace(/\s+/g, ' ').trim();
};

const stateFrom = (value: string) => {
  const n = norm(value);
  if (!n) return 'Disponible';
  if (/aver|rota|roto|fuera.*servicio/.test(n)) return /fuera.*servicio/.test(n) ? 'Fuera de servicio' : 'Averiada';
  if (/repar/.test(n)) return 'En reparación';
  if (/revision|revisar|pendiente/.test(n)) return 'Pendiente de revisión';
  if (/traslado|transito/.test(n)) return 'En traslado';
  if (/asign|obra|prestada|cedida/.test(n)) return 'Asignada a obra';
  if (/baja|retirad|desguace/.test(n)) return 'Baja';
  return 'Disponible';
};

const categoryFrom = (name: string, sheetName: string, explicit = '') => {
  if (explicit.trim()) return explicit.trim();
  const n = norm(name);
  if (/vehiculo|camion|furgon|tractor|excavadora|retro|dumpe?r|carretilla elevadora|maquina/.test(n)) return 'MAQUINARIA';
  if (/taladro|radial|amoladora|martillo|sierra|hormigonera|compresor|generador|soldadora|desbrozadora|motosierra/.test(n)) return 'HERRAMIENTAS ELÉCTRICAS / MAQUINARIA LIGERA';
  if (/pala|pico|azada|rastrillo|carretilla|llave|destornillador|alicate|martillo/.test(n)) return 'HERRAMIENTAS';
  const sheet = cleanCell(sheetName);
  return sheet && !/hoja|sheet\d*/i.test(sheet) ? sheet : 'OTROS';
};

const isNoiseRow = (values: string[]) => {
  const text = norm(values.filter(Boolean).join(' '));
  if (!text) return true;
  if (/^(total|subtotal|totales|inventario|listado|relacion|pagina|fecha)\b/.test(text) && values.filter(Boolean).length <= 3) return true;
  return false;
};

const detectHeaderRow = (rows: unknown[][]): number => {
  let best = -1;
  let bestScore = 0;
  const max = Math.min(rows.length, 50);
  for (let i = 0; i < max; i++) {
    const values = (rows[i] || []).map(cleanCell);
    const mapped = values.map(canonicalHeader).filter(Boolean);
    const unique = new Set(mapped);
    let score = unique.size;
    if (unique.has('nombre')) score += 3;
    if (unique.has('codigo')) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 2 ? best : -1;
};

const rowToItem = (row: Row, sheetName: string, rowNumber: number) => {
  const get = (field: string) => cleanCell(row[field]);
  let nombre = get('nombre');

  if (!nombre) {
    const candidates = Object.entries(row)
      .filter(([key, value]) => !canonicalHeader(key) && cleanCell(value))
      .map(([, value]) => cleanCell(value))
      .filter(v => /[a-záéíóúñ]/i.test(v) && v.length >= 3);
    nombre = candidates[0] || '';
  }
  if (!nombre) return null;

  const textName = norm(nombre);
  if (/^(total|subtotal|codigo|descripcion|denominacion|nombre|material|maquinaria|herramientas?)$/.test(textName)) return null;

  const details: Record<string, string> = {};
  Object.entries(row).forEach(([header, value]) => {
    const val = cleanCell(value);
    if (!val) return;
    const mapped = canonicalHeader(header);
    if (!mapped) details[header] = val;
  });
  details['Hoja origen'] = sheetName;
  details['Fila origen'] = String(rowNumber);

  const cantidadRaw = get('cantidad').replace(',', '.');
  const cantidad = Math.max(1, Math.round(Number(cantidadRaw) || 1));

  return {
    codigo: get('codigo'),
    categoria: categoryFrom(nombre, sheetName, get('categoria')),
    nombre,
    marca: get('marca'),
    modelo: get('modelo'),
    numeroSerie: get('numeroSerie'),
    matricula: get('matricula'),
    cantidad,
    tipoGestion: cantidad > 1 && !get('numeroSerie') && !get('matricula') ? 'lote' : 'individual',
    estado: stateFrom(get('estado')),
    ubicacionActual: get('ubicacionActual'),
    observaciones: get('observaciones'),
    detalles: details,
  };
};

const parseSheet = (sheet: XLSX.WorkSheet, sheetName: string) => {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  }) as unknown[][];

  if (!rows.length) return [];
  const headerRow = detectHeaderRow(rows);
  const items: any[] = [];

  if (headerRow >= 0) {
    const rawHeaders = (rows[headerRow] || []).map((v, idx) => cleanCell(v) || `Columna ${idx + 1}`);
    const headers = rawHeaders.map((header, idx) => canonicalHeader(header) || header || `Columna ${idx + 1}`);
    const lastContext: Record<string, string> = {};

    for (let r = headerRow + 1; r < rows.length; r++) {
      const cells = (rows[r] || []).map(cleanCell);
      if (isNoiseRow(cells)) continue;
      const row: Row = {};
      headers.forEach((h, idx) => {
        const value = cells[idx] || '';
        if (value) row[h] = value;
      });

      // Hojas administrativas suelen dejar categoría/ubicación solo en la primera fila del bloque.
      for (const field of ['categoria', 'ubicacionActual']) {
        if (row[field]) lastContext[field] = row[field];
        else if (lastContext[field]) row[field] = lastContext[field];
      }

      const item = rowToItem(row, sheetName, r + 1);
      if (item) items.push(item);
    }
    return items;
  }

  // Fallback para hojas sin cabecera reconocible: conserva todas las filas con contenido.
  for (let r = 0; r < rows.length; r++) {
    const cells = (rows[r] || []).map(cleanCell).filter(Boolean);
    if (cells.length === 0 || isNoiseRow(cells)) continue;
    const probableName = cells.find(v => /[a-záéíóúñ]/i.test(v) && v.length >= 3) || '';
    if (!probableName) continue;
    const details: Record<string, string> = {};
    cells.forEach((v, idx) => { details[`Columna ${idx + 1}`] = v; });
    items.push({
      codigo: /^[A-Z0-9._/-]+$/i.test(cells[0] || '') && cells[0] !== probableName ? cells[0] : '',
      categoria: categoryFrom(probableName, sheetName),
      nombre: probableName,
      marca: '',
      modelo: '',
      numeroSerie: '',
      matricula: '',
      cantidad: 1,
      tipoGestion: 'individual',
      estado: 'Disponible',
      ubicacionActual: '',
      observaciones: '',
      detalles: { ...details, 'Hoja origen': sheetName, 'Fila origen': String(r + 1) },
    });
  }
  return items;
};

const identity = (item: any) => {
  const clean = (v: unknown) => compact(v);
  if (clean(item.matricula)) return `M:${clean(item.matricula)}`;
  if (clean(item.numeroSerie)) return `S:${clean(item.numeroSerie)}`;
  if (clean(item.codigo)) return `C:${clean(item.codigo)}`;
  return `N:${[item.nombre, item.marca, item.modelo, item.categoria].map(clean).join('|')}`;
};

export default function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });
  try {
    const { fileBase64, filename } = req.body || {};
    if (!fileBase64 || !filename) return res.status(400).json({ error: 'No se proporcionó un archivo Excel válido.' });
    if (!/\.xlsx?$/i.test(String(filename))) return res.status(400).json({ error: 'El archivo debe ser .xlsx o .xls.' });

    const cleanBase64 = String(fileBase64).replace(/^data:.*;base64,/, '');
    const bytes = Buffer.from(cleanBase64, 'base64');
    if (!bytes.length) return res.status(400).json({ error: 'El archivo está vacío.' });

    const workbook = XLSX.read(bytes, {
      type: 'buffer',
      cellDates: true,
      cellFormula: true,
      cellText: true,
      dense: false,
    });

    const all: any[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      all.push(...parseSheet(sheet, sheetName));
    }

    const unique = new Map<string, any>();
    all.forEach((item, idx) => {
      const key = identity(item) || `ROW:${idx}`;
      const previous = unique.get(key);
      unique.set(key, previous ? {
        ...previous,
        ...Object.fromEntries(Object.entries(item).filter(([, v]) => v !== '' && v != null)),
        detalles: { ...(previous.detalles || {}), ...(item.detalles || {}) },
      } : item);
    });

    const items = Array.from(unique.values()).filter(item => String(item.nombre || '').trim());
    if (!items.length) {
      return res.status(422).json({
        error: 'El Excel se ha leído correctamente, pero no se han podido identificar filas de herramientas o maquinaria. Revisa que exista al menos una columna con nombre/descripcion/equipo.',
        sheets: workbook.SheetNames,
      });
    }

    return res.status(200).json({
      success: true,
      items,
      count: items.length,
      sheets: workbook.SheetNames,
      parser: 'deterministic-xlsx',
    });
  } catch (error: any) {
    reportOperationalError('[inventory-excel-api]', error);
    return res.status(500).json({
      error: error?.message ? `No se pudo leer el Excel: ${error.message}` : 'No se pudo analizar el Excel.',
    });
  }
}
