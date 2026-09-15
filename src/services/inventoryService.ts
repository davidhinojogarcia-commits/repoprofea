import { supabase } from '../lib/supabase';
import { loadInventoryZona6Seed } from '../data/inventoryZona6Seed';

export const INVENTORY_DEFAULT_PARK_NAME = 'Nave logística Antonio Ramos';
export const INVENTORY_DEFAULT_ZONE = 'Zona 6';
export const INVENTORY_BASE_LOCATION = `${INVENTORY_DEFAULT_PARK_NAME} (${INVENTORY_DEFAULT_ZONE})`;

export type InventoryItem = {
  id: string;
  parkId: string;
  codigo: string;
  categoria: string;
  nombre: string;
  marca?: string | null;
  modelo?: string | null;
  numeroSerie?: string | null;
  matricula?: string | null;
  cantidad: number;
  tipoGestion: 'individual' | 'lote';
  estado: string;
  ubicacionActual: string;
  obraActualId?: string | null;
  responsableActual?: string | null;
  detalles: Record<string, unknown>;
  observaciones?: string | null;
  activo: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type InventoryMovement = {
  id: string;
  parkId: string;
  itemId: string;
  tipo: string;
  origen: string;
  destino: string;
  obraId?: string | null;
  estadoAnterior?: string | null;
  estadoNuevo?: string | null;
  observaciones?: string | null;
  latitud?: number | null;
  longitud?: number | null;
  fotoPaths: string[];
  fotoUrls?: string[];
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: string;
};

export type InventoryMaintenance = {
  id: string;
  parkId: string;
  itemId: string;
  tipo: string;
  fecha: string;
  proximaRevision?: string | null;
  proveedor?: string | null;
  coste?: number | null;
  observaciones?: string | null;
  createdBy?: string | null;
  createdAt: string;
};

export type InventoryPark = {
  id: string;
  nombre: string;
  zona: string;
  descripcion?: string | null;
  createdBy?: string | null;
};

const mapItem = (row: any): InventoryItem => ({
  id: row.id,
  parkId: row.park_id,
  codigo: row.codigo || '',
  categoria: row.categoria || '',
  nombre: row.nombre || '',
  marca: row.marca,
  modelo: row.modelo,
  numeroSerie: row.numero_serie,
  matricula: row.matricula,
  cantidad: Number(row.cantidad || 1),
  tipoGestion: row.tipo_gestion === 'lote' ? 'lote' : 'individual',
  estado: row.estado || 'Disponible',
  ubicacionActual: row.ubicacion_actual || INVENTORY_BASE_LOCATION,
  obraActualId: row.obra_actual_id,
  responsableActual: row.responsable_actual,
  detalles: row.detalles || {},
  observaciones: row.observaciones,
  activo: row.activo !== false,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapMovement = (row: any): InventoryMovement => ({
  id: row.id,
  parkId: row.park_id,
  itemId: row.item_id,
  tipo: row.tipo || '',
  origen: row.origen || '',
  destino: row.destino || '',
  obraId: row.obra_id,
  estadoAnterior: row.estado_anterior,
  estadoNuevo: row.estado_nuevo,
  observaciones: row.observaciones,
  latitud: row.latitud == null ? null : Number(row.latitud),
  longitud: row.longitud == null ? null : Number(row.longitud),
  fotoPaths: Array.isArray(row.foto_paths) ? row.foto_paths : [],
  createdBy: row.created_by,
  createdByName: row.created_by_name,
  createdAt: row.created_at,
});

const mapMaintenance = (row: any): InventoryMaintenance => ({
  id: row.id,
  parkId: row.park_id,
  itemId: row.item_id,
  tipo: row.tipo || '',
  fecha: row.fecha || '',
  proximaRevision: row.proxima_revision,
  proveedor: row.proveedor,
  coste: row.coste == null ? null : Number(row.coste),
  observaciones: row.observaciones,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Debes iniciar sesión para gestionar el inventario.');
  return data.user.id;
}

export async function ensureInventoryReady(): Promise<InventoryPark> {
  const userId = await currentUserId();
  const visible = await supabase.query('inventory_parks', {
    query: 'select=id,nombre,zona,descripcion,created_by&active=eq.true&order=created_at.asc&limit=10',
  });
  if (Array.isArray(visible) && visible.length) {
    const row = visible.find((p: any) => p.nombre === INVENTORY_DEFAULT_PARK_NAME && p.zona === INVENTORY_DEFAULT_ZONE) || visible[0];
    const park = { id: row.id, nombre: row.nombre, zona: row.zona, descripcion: row.descripcion, createdBy: row.created_by };
    await seedInventoryIfEmpty(park.id);
    return park;
  }

  try {
    const created = await supabase.query('inventory_parks', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        nombre: INVENTORY_DEFAULT_PARK_NAME,
        zona: INVENTORY_DEFAULT_ZONE,
        descripcion: 'Parque compartido de herramientas y maquinaria de la Zona 6.',
        created_by: userId,
        active: true,
      },
    });
    const row = created?.[0];
    if (!row?.id) throw new Error('No se pudo crear el parque de inventario.');
    await supabase.query('inventory_park_members', {
      method: 'POST',
      body: { park_id: row.id, user_id: userId, role: 'responsable', active: true },
    });
    await seedInventoryIfEmpty(row.id);
    return { id: row.id, nombre: row.nombre, zona: row.zona, descripcion: row.descripcion, createdBy: row.created_by };
  } catch (error: any) {
    if (error?.code === '23505' || String(error?.message || '').toLowerCase().includes('duplicate')) {
      throw new Error('El parque compartido ya existe, pero todavía no está compartido con tu usuario. Pide al otro supervisor que te añada desde Herramientas y maquinaria.');
    }
    throw error;
  }
}

export async function seedInventoryIfEmpty(parkId: string) {
  const countRows = await supabase.query('inventory_items', {
    query: `select=id&park_id=eq.${encodeURIComponent(parkId)}&limit=1`,
  });
  if (Array.isArray(countRows) && countRows.length) return;
  const userId = await currentUserId();
  const seed = await loadInventoryZona6Seed();
  const chunkSize = 40;
  for (let i = 0; i < seed.length; i += chunkSize) {
    const chunk = seed.slice(i, i + chunkSize).map(item => ({
      park_id: parkId,
      codigo: item.codigo,
      categoria: item.categoria,
      nombre: item.nombre,
      marca: item.marca || null,
      modelo: item.modelo || null,
      numero_serie: item.numeroSerie || null,
      matricula: item.matricula || null,
      cantidad: item.cantidad || 1,
      tipo_gestion: item.tipoGestion,
      estado: item.estado || 'Disponible',
      ubicacion_actual: item.ubicacionActual || INVENTORY_BASE_LOCATION,
      detalles: item.detalles || {},
      observaciones: 'Importado del inventario PROFEA Zona 6 (2025).',
      activo: true,
      created_by: userId,
      updated_by: userId,
    }));
    await supabase.query('inventory_items', { method: 'POST', body: chunk });
  }
}

export async function listInventoryItems(parkId: string): Promise<InventoryItem[]> {
  const rows = await supabase.query('inventory_items', {
    query: `select=*&park_id=eq.${encodeURIComponent(parkId)}&order=categoria.asc,nombre.asc,codigo.asc`,
  });
  return (rows || []).map(mapItem);
}

export async function saveInventoryItem(parkId: string, item: Partial<InventoryItem> & { nombre: string; categoria: string }) {
  const userId = await currentUserId();
  const payload = {
    park_id: parkId,
    codigo: item.codigo || '',
    categoria: item.categoria || 'OTROS',
    nombre: item.nombre,
    marca: item.marca || null,
    modelo: item.modelo || null,
    numero_serie: item.numeroSerie || null,
    matricula: item.matricula || null,
    cantidad: Number(item.cantidad || 1),
    tipo_gestion: item.tipoGestion || 'individual',
    estado: item.estado || 'Disponible',
    ubicacion_actual: item.ubicacionActual || INVENTORY_BASE_LOCATION,
    obra_actual_id: item.obraActualId || null,
    responsable_actual: item.responsableActual || null,
    detalles: item.detalles || {},
    observaciones: item.observaciones || null,
    activo: item.activo !== false,
    updated_by: userId,
  };
  if (item.id) {
    const rows = await supabase.query('inventory_items', {
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(item.id)}&select=*`,
      prefer: 'return=representation',
      body: payload,
    });
    return mapItem(rows?.[0]);
  }
  const rows = await supabase.query('inventory_items', {
    method: 'POST',
    prefer: 'return=representation',
    body: { ...payload, created_by: userId },
  });
  return mapItem(rows?.[0]);
}

export async function softDeleteInventoryItem(itemId: string) {
  const userId = await currentUserId();
  await supabase.query('inventory_items', {
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(itemId)}`,
    body: { activo: false, estado: 'Baja', updated_by: userId },
  });
}

export async function listInventoryMovements(parkId: string): Promise<InventoryMovement[]> {
  const rows = await supabase.query('inventory_movements', {
    query: `select=*&park_id=eq.${encodeURIComponent(parkId)}&order=created_at.desc&limit=2000`,
  });
  const movements = (rows || []).map(mapMovement);
  for (const movement of movements) {
    if (!movement.fotoPaths.length) continue;
    const signed = await Promise.all(movement.fotoPaths.map(async path => {
      const { data } = await supabase.storage.from('inventory-photos').createSignedUrl(path, 3600);
      return data?.signedUrl || '';
    }));
    movement.fotoUrls = signed.filter(Boolean);
  }
  return movements;
}

export async function uploadInventoryPhotos(parkId: string, itemId: string, files: File[]): Promise<string[]> {
  if (!files.length) return [];
  const paths: string[] = [];
  for (const file of files.slice(0, 4)) {
    const ext = (file.name.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const path = `${parkId}/${itemId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('inventory-photos').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw error;
    paths.push(path);
  }
  return paths;
}

export async function registerInventoryMovement(input: {
  itemId: string;
  tipo: string;
  destino: string;
  estadoNuevo: string;
  obraId?: string | null;
  observaciones?: string;
  latitud?: number | null;
  longitud?: number | null;
  fotoPaths?: string[];
}) {
  const result = await supabase.rpc('inventory_register_movement', {
    p_item_id: input.itemId,
    p_tipo: input.tipo,
    p_destino: input.destino,
    p_estado_nuevo: input.estadoNuevo,
    p_obra_id: input.obraId || null,
    p_observaciones: input.observaciones || '',
    p_latitud: input.latitud ?? null,
    p_longitud: input.longitud ?? null,
    p_foto_paths: input.fotoPaths || [],
  });
  return result;
}

export async function listInventoryMaintenance(parkId: string): Promise<InventoryMaintenance[]> {
  const rows = await supabase.query('inventory_maintenance', {
    query: `select=*&park_id=eq.${encodeURIComponent(parkId)}&order=fecha.desc,created_at.desc&limit=2000`,
  });
  return (rows || []).map(mapMaintenance);
}

export async function addInventoryMaintenance(parkId: string, itemId: string, data: Omit<InventoryMaintenance, 'id' | 'parkId' | 'itemId' | 'createdAt'>) {
  const userId = await currentUserId();
  const rows = await supabase.query('inventory_maintenance', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      park_id: parkId,
      item_id: itemId,
      tipo: data.tipo,
      fecha: data.fecha,
      proxima_revision: data.proximaRevision || null,
      proveedor: data.proveedor || null,
      coste: data.coste ?? null,
      observaciones: data.observaciones || null,
      created_by: userId,
    },
  });
  return mapMaintenance(rows?.[0]);
}

export async function shareInventoryParkByEmail(parkId: string, email: string) {
  return supabase.rpc('inventory_add_member_by_email', {
    p_park_id: parkId,
    p_email: email.trim().toLowerCase(),
  });
}
