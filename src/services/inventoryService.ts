import { supabase } from '../lib/supabase';
import { loadInventoryZona6Seed } from '../data/inventoryZona6Seed';

export const INVENTORY_DEFAULT_PARK_NAME = 'Parque / nave logística';
export const INVENTORY_DEFAULT_ZONE = 'Zona 1';
export const INVENTORY_BASE_LOCATION = `${INVENTORY_DEFAULT_PARK_NAME} (${INVENTORY_DEFAULT_ZONE})`;
export const INVENTORY_ZONES = Array.from({ length: 9 }, (_, i) => `Zona ${i + 1}`);

export const MACHINE_DOCUMENT_TYPES = [
  'Marcado CE / placa identificativa',
  'Declaración CE de conformidad',
  'Manual de instrucciones',
  'Revisión / comprobación periódica',
  'Certificado de mantenimiento',
  'ITV / inspección reglamentaria',
  'Seguro / póliza',
  'Ficha técnica',
  'Autorización de uso',
  'Otro documento',
] as const;

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
  mechanicName?: string | null;
  coste?: number | null;
  observaciones?: string | null;
  signedDocumentPaths: string[];
  signedDocumentUrls?: { path: string; url: string }[];
  createdBy?: string | null;
  createdAt: string;
};

export type InventoryDocument = {
  id: string;
  parkId: string;
  itemId: string;
  documentType: string;
  title: string;
  filePath: string;
  fileName: string;
  issueDate?: string | null;
  expiryDate?: string | null;
  notes?: string | null;
  createdAt: string;
  downloadUrl?: string;
};

export type InventoryPark = {
  id: string;
  nombre: string;
  zona: string;
  descripcion?: string | null;
  coordinatorEmail?: string | null;
  createdBy?: string | null;
  isOwned?: boolean;
};

export type InventoryParkShare = {
  participantKey: string;
  userId?: string | null;
  email: string;
  displayName: string;
  status: 'accepted' | 'pending';
  role: string;
  isOwner: boolean;
  acceptedAt?: string | null;
};

export type InventoryParkInvitation = {
  invitationId: string;
  parkId: string;
  parkName: string;
  parkZone: string;
  inviterName: string;
  inviterEmail?: string | null;
  createdAt: string;
};

export type InventoryInvitationCreateResult = {
  invitationId: string;
  email: string;
  displayName: string;
  parkName: string;
  status: 'pending';
};

const parkBaseLocation = (park: Pick<InventoryPark, 'nombre' | 'zona'>) => `${park.nombre} (${park.zona})`;

const mapPark = (row: any, userId?: string): InventoryPark => ({
  id: row.id,
  nombre: row.nombre || INVENTORY_DEFAULT_PARK_NAME,
  zona: row.zona || INVENTORY_DEFAULT_ZONE,
  descripcion: row.descripcion,
  coordinatorEmail: row.coordinator_email,
  createdBy: row.created_by,
  isOwned: userId ? row.created_by === userId : undefined,
});

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
  mechanicName: row.mechanic_name,
  coste: row.coste == null ? null : Number(row.coste),
  observaciones: row.observaciones,
  signedDocumentPaths: Array.isArray(row.signed_document_paths) ? row.signed_document_paths : [],
  createdBy: row.created_by,
  createdAt: row.created_at,
});

const mapDocument = (row: any): InventoryDocument => ({
  id: row.id,
  parkId: row.park_id,
  itemId: row.item_id,
  documentType: row.document_type || 'Otro documento',
  title: row.title || row.file_name || 'Documento',
  filePath: row.file_path,
  fileName: row.file_name || 'documento',
  issueDate: row.issue_date,
  expiryDate: row.expiry_date,
  notes: row.notes,
  createdAt: row.created_at,
});

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Debes iniciar sesión para gestionar el inventario.');
  return data.user.id;
}

export async function listInventoryParks(): Promise<InventoryPark[]> {
  const userId = await currentUserId();
  const rows = await supabase.query('inventory_parks', {
    query: 'select=id,nombre,zona,descripcion,coordinator_email,created_by&active=eq.true&order=zona.asc,nombre.asc',
  });
  return (rows || []).map((row: any) => mapPark(row, userId));
}

export async function ensureInventoryReady(): Promise<InventoryPark> {
  const userId = await currentUserId();
  const visible = await listInventoryParks();
  const own = visible.find(p => p.createdBy === userId);
  if (own) {
    if (own.nombre === 'Nave logística Antonio Ramos' && own.zona === 'Zona 6') await seedInventoryIfEmpty(own.id);
    return own;
  }

  const created = await supabase.query('inventory_parks', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      nombre: INVENTORY_DEFAULT_PARK_NAME,
      zona: INVENTORY_DEFAULT_ZONE,
      descripcion: 'Parque de herramientas y maquinaria del supervisor.',
      created_by: userId,
      active: true,
    },
  });
  const row = created?.[0];
  if (!row?.id) throw new Error('No se pudo crear el parque de inventario.');
  await supabase.query('inventory_park_members', {
    method: 'POST',
    body: { park_id: row.id, user_id: userId, role: 'responsable', active: true, created_by: userId },
  });
  return mapPark(row, userId);
}

export async function updateInventoryPark(parkId: string, data: { nombre: string; zona: string; coordinatorEmail?: string | null }) {
  const userId = await currentUserId();
  const rows = await supabase.query('inventory_parks', {
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(parkId)}&select=id,nombre,zona,descripcion,coordinator_email,created_by`,
    prefer: 'return=representation',
    body: {
      nombre: data.nombre.trim() || INVENTORY_DEFAULT_PARK_NAME,
      zona: data.zona || INVENTORY_DEFAULT_ZONE,
      coordinator_email: data.coordinatorEmail?.trim().toLowerCase() || null,
      updated_at: new Date().toISOString(),
    },
  });
  return mapPark(rows?.[0], userId);
}

export async function seedInventoryIfEmpty(parkId: string) {
  const countRows = await supabase.query('inventory_items', { query: `select=id&park_id=eq.${encodeURIComponent(parkId)}&limit=1` });
  if (Array.isArray(countRows) && countRows.length) return;
  const parkRows = await supabase.query('inventory_parks', { query: `select=nombre,zona&id=eq.${encodeURIComponent(parkId)}&limit=1` });
  const park = parkRows?.[0];
  if (!park || park.nombre !== 'Nave logística Antonio Ramos' || park.zona !== 'Zona 6') return;
  const userId = await currentUserId();
  const seed = await loadInventoryZona6Seed();
  const baseLocation = `${park.nombre} (${park.zona})`;
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
      ubicacion_actual: item.ubicacionActual || baseLocation,
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
  const rows = await supabase.query('inventory_items', { query: `select=*&park_id=eq.${encodeURIComponent(parkId)}&order=categoria.asc,nombre.asc,codigo.asc` });
  return (rows || []).map(mapItem);
}

export async function saveInventoryItem(parkId: string, item: Partial<InventoryItem> & { nombre: string; categoria: string }, baseLocation?: string) {
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
    ubicacion_actual: item.ubicacionActual || baseLocation || INVENTORY_BASE_LOCATION,
    obra_actual_id: item.obraActualId || null,
    responsable_actual: item.responsableActual || null,
    detalles: item.detalles || {},
    observaciones: item.observaciones || null,
    activo: item.activo !== false,
    updated_by: userId,
  };
  if (item.id) {
    const rows = await supabase.query('inventory_items', { method: 'PATCH', query: `id=eq.${encodeURIComponent(item.id)}&select=*`, prefer: 'return=representation', body: payload });
    return mapItem(rows?.[0]);
  }
  const rows = await supabase.query('inventory_items', { method: 'POST', prefer: 'return=representation', body: { ...payload, created_by: userId } });
  return mapItem(rows?.[0]);
}

export async function softDeleteInventoryItem(itemId: string) {
  const userId = await currentUserId();
  await supabase.query('inventory_items', { method: 'PATCH', query: `id=eq.${encodeURIComponent(itemId)}`, body: { activo: false, estado: 'Baja', updated_by: userId } });
}

export async function listInventoryMovements(parkId: string): Promise<InventoryMovement[]> {
  const rows = await supabase.query('inventory_movements', { query: `select=*&park_id=eq.${encodeURIComponent(parkId)}&order=created_at.desc&limit=2000` });
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
    const { error } = await supabase.storage.from('inventory-photos').upload(path, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    paths.push(path);
  }
  return paths;
}

export async function registerInventoryMovement(input: {
  itemId: string; tipo: string; destino: string; estadoNuevo: string; obraId?: string | null; observaciones?: string;
  latitud?: number | null; longitud?: number | null; fotoPaths?: string[];
}) {
  return supabase.rpc('inventory_register_movement', {
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
}

export async function updateInventoryMovement(input: {
  movementId: string;
  tipo: string;
  destino: string;
  estadoNuevo: string;
  observaciones?: string;
  latitud?: number | null;
  longitud?: number | null;
  fotoPaths?: string[];
}) {
  return supabase.rpc('inventory_update_movement', {
    p_movement_id: input.movementId,
    p_tipo: input.tipo,
    p_destino: input.destino,
    p_estado_nuevo: input.estadoNuevo,
    p_observaciones: input.observaciones || '',
    p_latitud: input.latitud ?? null,
    p_longitud: input.longitud ?? null,
    p_foto_paths: input.fotoPaths || [],
  });
}

export async function deleteInventoryMovement(movementId: string) {
  return supabase.rpc('inventory_delete_movement', { p_movement_id: movementId });
}

async function signDocumentPath(path: string, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from('inventory-documents').createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data?.signedUrl || '';
}

export async function uploadInventoryDocuments(parkId: string, itemId: string, files: File[], folder = 'documents'): Promise<string[]> {
  const paths: string[] = [];
  for (const file of files.slice(0, 8)) {
    const ext = (file.name.split('.').pop() || 'pdf').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const path = `${parkId}/${itemId}/${folder}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('inventory-documents').upload(path, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    paths.push(path);
  }
  return paths;
}

export async function listInventoryMaintenance(parkId: string): Promise<InventoryMaintenance[]> {
  const rows = await supabase.query('inventory_maintenance', { query: `select=*&park_id=eq.${encodeURIComponent(parkId)}&order=fecha.desc,created_at.desc&limit=2000` });
  const result = (rows || []).map(mapMaintenance);
  for (const record of result) {
    record.signedDocumentUrls = (await Promise.all(record.signedDocumentPaths.map(async path => ({ path, url: await signDocumentPath(path) })))).filter(x => x.url);
  }
  return result;
}

export async function addInventoryMaintenance(parkId: string, itemId: string, data: Omit<InventoryMaintenance, 'id' | 'parkId' | 'itemId' | 'createdAt' | 'signedDocumentUrls'>) {
  const userId = await currentUserId();
  const rows = await supabase.query('inventory_maintenance', {
    method: 'POST', prefer: 'return=representation',
    body: {
      park_id: parkId,
      item_id: itemId,
      tipo: data.tipo,
      fecha: data.fecha,
      proxima_revision: data.proximaRevision || null,
      proveedor: data.proveedor || null,
      mechanic_name: data.mechanicName || null,
      coste: data.coste ?? null,
      observaciones: data.observaciones || null,
      signed_document_paths: data.signedDocumentPaths || [],
      created_by: userId,
    },
  });
  return mapMaintenance(rows?.[0]);
}

export async function listInventoryDocuments(parkId: string, itemId?: string): Promise<InventoryDocument[]> {
  const filter = itemId ? `&item_id=eq.${encodeURIComponent(itemId)}` : '';
  const rows = await supabase.query('inventory_documents', { query: `select=*&park_id=eq.${encodeURIComponent(parkId)}${filter}&order=created_at.desc` });
  const docs = (rows || []).map(mapDocument);
  for (const doc of docs) doc.downloadUrl = await signDocumentPath(doc.filePath);
  return docs;
}

export async function addInventoryDocument(input: {
  parkId: string; itemId: string; documentType: string; title: string; file: File;
  issueDate?: string | null; expiryDate?: string | null; notes?: string | null;
}) {
  const userId = await currentUserId();
  const [filePath] = await uploadInventoryDocuments(input.parkId, input.itemId, [input.file], 'machine-docs');
  const rows = await supabase.query('inventory_documents', {
    method: 'POST', prefer: 'return=representation',
    body: {
      park_id: input.parkId,
      item_id: input.itemId,
      document_type: input.documentType,
      title: input.title || input.file.name,
      file_path: filePath,
      file_name: input.file.name,
      issue_date: input.issueDate || null,
      expiry_date: input.expiryDate || null,
      notes: input.notes || null,
      created_by: userId,
    },
  });
  return mapDocument(rows?.[0]);
}

export async function deleteInventoryDocument(doc: InventoryDocument) {
  await supabase.query('inventory_documents', { method: 'DELETE', query: `id=eq.${encodeURIComponent(doc.id)}` });
  await supabase.storage.from('inventory-documents').remove([doc.filePath]);
}

export async function createInventoryDocumentMailLinks(docs: InventoryDocument[], minutes = 60) {
  const expiresIn = Math.max(5, minutes) * 60;
  return Promise.all(docs.map(async doc => ({ ...doc, downloadUrl: await signDocumentPath(doc.filePath, expiresIn) })));
}

export async function listInventoryParkShares(parkId: string): Promise<InventoryParkShare[]> {
  const rows = await supabase.rpc('inventory_list_park_shares', { p_park_id: parkId });
  return (rows || []).map((row: any) => ({
    participantKey: row.participant_key,
    userId: row.user_id,
    email: row.email || '',
    displayName: row.display_name || row.email || 'Supervisor',
    status: row.status === 'pending' ? 'pending' : 'accepted',
    role: row.role || 'responsable',
    isOwner: row.is_owner === true,
    acceptedAt: row.accepted_at || null,
  }));
}

export async function listInventoryParkInvitations(): Promise<InventoryParkInvitation[]> {
  const rows = await supabase.rpc('inventory_list_invitations');
  return (rows || []).map((row: any) => ({
    invitationId: row.invitation_id,
    parkId: row.park_id,
    parkName: row.park_name || 'Parque de maquinaria',
    parkZone: row.park_zone || '',
    inviterName: row.inviter_name || row.inviter_email || 'Supervisor',
    inviterEmail: row.inviter_email || null,
    createdAt: row.created_at,
  }));
}

export async function createInventoryParkInvitation(
  parkId: string,
  email: string,
): Promise<InventoryInvitationCreateResult> {
  return supabase.rpc('inventory_create_invitation', {
    p_park_id: parkId,
    p_email: email.trim().toLowerCase(),
  });
}

export async function sendInventoryParkInvitationEmail(invitationId: string) {
  return supabase.edgeFunction('inventory-share-invite', { invitationId });
}

export async function respondInventoryParkInvitation(invitationId: string, accept: boolean) {
  return supabase.rpc('inventory_respond_invitation', {
    p_invitation_id: invitationId,
    p_accept: accept,
  });
}

export async function revokeInventoryParkMember(parkId: string, userId: string) {
  return supabase.rpc('inventory_revoke_member', {
    p_park_id: parkId,
    p_user_id: userId,
  });
}

export { parkBaseLocation };
