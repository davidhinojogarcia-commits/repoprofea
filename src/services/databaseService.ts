import { supabase } from '../lib/supabase';

export type DatabaseRecord = Record<string, any> & { id?: string | number; ownerId?: string };
type ListOptions = { includeShared?: boolean; allForAdmin?: boolean; limitCount?: number };

const TABLE_BY_COLLECTION: Record<string, string> = {
  appointments: 'citas', citas: 'citas',
  subcontractors: 'subcontratas', subcontratas: 'subcontratas',
  medicalExams: 'reconocimientos', reconocimientos: 'reconocimientos',
  contracts: 'contrataciones', contratacion: 'contrataciones', contrataciones: 'contrataciones',
  works: 'obras', obras: 'obras',
};

const canonicalTable = (name: string) => TABLE_BY_COLLECTION[name] || name;
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_k, v) => v === undefined ? null : v));
const dateOrNull = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
const timeOrNull = (value: unknown) => typeof value === 'string' && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 8) : null;
const isLegacyNumericTable = (table: string) => table === 'workers' || table === 'trash';

async function requireUser() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Debes iniciar sesión para realizar esta operación.');
  return data.user;
}

async function resolveObraId(obra: unknown): Promise<string | null> {
  if (!obra || typeof obra !== 'string') return null;
  const name = obra.trim();
  const rows = await supabase.query('obras', { query: `select=id&nombre=eq.${encodeURIComponent(name)}&limit=1` });
  return rows?.[0]?.id || null;
}

async function serialize(table: string, value: DatabaseRecord) {
  const data = clean(value);
  if (isLegacyNumericTable(table)) return { data };
  if (table === 'obras') return {
    codigo: value.codigo || value.code || '',
    nombre: value.nombre || value.name || value.obra || '',
    municipio: value.municipio || '',
    descripcion: value.descripcion || value.description || '',
  };
  const obraId = value.obraId || value.obra_id || await resolveObraId(value.obra);
  if (table === 'citas') return {
    obra_id: obraId, trabajador_id: value.trabajadorId ?? value.trabajador_id ?? null,
    cita_dia: dateOrNull(value.citaDia), cita_hora: timeOrNull(value.citaHora),
    sitio_reconocimiento: value.sitioReconocimiento || '', num_oferta: value.numOferta || '',
    quincena: value.quincena || '', supervisor_responsable: value.supervisorResponsable || '',
    telefono_supervisor: value.telefonoSupervisor || '', dia_comienzo: dateOrNull(value.diaComienzo),
    dia_fin_contrato: dateOrNull(value.diaFinContrato), dia_contratacion: dateOrNull(value.diaContratacion), data
  };
  if (table === 'subcontratas') return {
    obra_id: obraId, nombre_empresa: value.nombreEmpresa || '', cif: value.cif || '', municipio: value.municipio || '',
    persona_contacto: value.personaContacto || '', telefono: value.telefono || '', email: value.email || '',
    actividad_gremio: value.actividadGremio || '', fecha_inicio_prevista: dateOrNull(value.fechaInicioPrevista),
    supervisor_responsable: value.supervisorResponsable || '', recurso_preventivo: value.recursoPreventivo || '',
    numero_trabajadores_previstos: Number.isFinite(Number(value.numeroTrabajadoresPrevistos)) ? Number(value.numeroTrabajadoresPrevistos) : null,
    estado_expediente: value.estadoExpediente || 'pendiente', notas: value.notas || '', data
  };
  if (table === 'reconocimientos') return {
    obra_id: obraId, trabajador_id: value.matchedPersonId ?? value.trabajadorId ?? value.trabajador_id ?? null,
    dni: value.dni || '', apellidos_nombre: value.apellidosNombre || '', resultado: value.resultado || value.reconocimientoEstado || 'Pendiente',
    limitaciones: value.limitaciones || value.reconocimientoLimitaciones || '', fecha_reconocimiento: dateOrNull(value.fechaReconocimiento || value.reconocimientoFecha),
    validez: dateOrNull(value.validez || value.reconocimientoValidez), centro_medico: value.centroMedico || value.sitioReconocimiento || '',
    observaciones: value.observaciones || value.reconocimientoObservaciones || '', data
  };
  if (table === 'contrataciones') return {
    obra_id: obraId, trabajador_id: value.trabajadorId ?? value.trabajador_id ?? value.idTrabajador ?? null,
    num_oferta: value.numOferta || '', categoria: value.categoria || '', periodo_inicio: dateOrNull(value.periodoInicio),
    periodo_fin: dateOrNull(value.periodoFin), quincena: value.quincena || '', estado: value.estado || '',
    observaciones: value.observaciones || '', data
  };
  return { data };
}

async function syncSubcontrataChecklist(subcontrataId: string, value: DatabaseRecord) {
  const checklist = Array.isArray(value.checklist) ? value.checklist : [];
  const existing = await supabase.query('subcontrata_documentos', {
    query: `select=id&subcontrata_id=eq.${encodeURIComponent(subcontrataId)}`,
  });
  const nextIds = new Set<string>();

  for (let index = 0; index < checklist.length; index += 1) {
    const item = checklist[index] || {};
    const sourceId = String(item.id || `item_${index + 1}`);
    const itemId = `${subcontrataId}:${sourceId}`;
    nextIds.add(itemId);
    await supabase.query('subcontrata_documentos', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        id: itemId,
        subcontrata_id: subcontrataId,
        categoria: item.categoria || 'empresa',
        nombre: item.nombre || '',
        descripcion: item.descripcion || '',
        normativa: item.normativa || '',
        obligatorio: item.obligatorio !== false,
        estado: item.estado || 'pendiente',
        fecha_entrega: dateOrNull(item.fechaEntrega),
        fecha_caducidad: dateOrNull(item.fechaCaducidad),
        observaciones: item.observaciones || '',
        documento_nombre: item.documentoNombre || '',
        data: clean(item),
      },
    });
  }

  for (const row of existing || []) {
    if (!nextIds.has(String(row.id))) {
      await supabase.query('subcontrata_documentos', {
        method: 'DELETE',
        prefer: 'return=minimal',
        query: `id=eq.${encodeURIComponent(String(row.id))}&subcontrata_id=eq.${encodeURIComponent(subcontrataId)}`,
      });
    }
  }
}

function hydrate(row: any, table: string): any {
  if (table === 'obras') return {
    id: row.id,
    codigo: row.codigo,
    nombre: row.nombre,
    municipio: row.municipio,
    descripcion: row.descripcion,
    ownerId: row.owner_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
  return {
    ...(row.data || {}), id: row.id, ownerId: row.owner_id, obraId: row.obra_id,
    createdBy: row.created_by, createdAt: row.created_at, updatedBy: row.updated_by, updatedAt: row.updated_at,
  };
}

export async function createDocument<T extends DatabaseRecord>(collectionName: string, id: string | number, data: T) {
  const user = await requireUser();
  const table = canonicalTable(collectionName);
  const serialized = await serialize(table, data);
  const body = isLegacyNumericTable(table)
    ? { owner_id: user.id, id: Number(id), ...serialized, created_by: user.id, updated_by: user.id }
    : { id: String(id), ...serialized };
  await supabase.query(table, { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body });
  if (table === 'subcontratas') await syncSubcontrataChecklist(String(id), data);
}

export async function updateDocument<T extends DatabaseRecord>(collectionName: string, id: string | number, patch: Partial<T>) {
  const user = await requireUser();
  const table = canonicalTable(collectionName);
  const current = await getDocument<T>(collectionName, id);
  if (!current) throw new Error('El registro ya no existe o no tienes permiso para verlo.');
  const merged = { ...current, ...patch, id } as DatabaseRecord;
  const body: any = await serialize(table, merged);
  if (isLegacyNumericTable(table)) body.updated_by = user.id;
  await supabase.query(table, { method: 'PATCH', prefer: 'return=minimal', query: `id=eq.${encodeURIComponent(String(id))}`, body });
  if (table === 'subcontratas') await syncSubcontrataChecklist(String(id), merged);
}

export async function deleteDocument(collectionName: string, id: string | number) {
  await requireUser();
  await supabase.query(canonicalTable(collectionName), { method: 'DELETE', prefer: 'return=minimal', query: `id=eq.${encodeURIComponent(String(id))}` });
}

export async function getDocument<T = DatabaseRecord>(collectionName: string, id: string | number): Promise<T | null> {
  await requireUser();
  const table = canonicalTable(collectionName);
  const rows = await supabase.query(table, { query: `select=*&id=eq.${encodeURIComponent(String(id))}&limit=1` });
  return rows?.[0] ? hydrate(rows[0], table) as T : null;
}

export async function getDocuments<T = DatabaseRecord>(collectionName: string, options: ListOptions = {}): Promise<T[]> {
  await requireUser();
  const table = canonicalTable(collectionName);
  const limit = options.limitCount ? `&limit=${options.limitCount}` : '';
  const rows = await supabase.query(table, { query: `select=*&order=updated_at.desc${limit}` });
  return (rows || []).map((row: any) => hydrate(row, table) as T);
}

export function subscribeToDocuments<T = DatabaseRecord>(collectionName: string, onUpdate: (items: T[]) => void, options: ListOptions = {}, onError?: (error: Error) => void) {
  let active = true;
  const run = async () => {
    try { if (active) onUpdate(await getDocuments<T>(collectionName, options)); }
    catch (error) { onError?.(error instanceof Error ? error : new Error(String(error))); }
  };
  void run();
  const timer = window.setInterval(() => void run(), 3000);
  return () => { active = false; window.clearInterval(timer); };
}

export const getSharedDocuments = getDocuments;
