import { createClient, type User } from '@supabase/supabase-js';
import { RequestLimiter } from './requestLimiter';
import { ReadResponseCache } from './readResponseCache';
import {
  applyRestMutationToCachedReads,
  enqueueOfflineOperation,
  listOfflineOperations,
  offlineCacheKey,
  readOfflineCache,
  removeOfflineOperation,
  setOfflineSyncActivity,
  updateOfflineOperationFailure,
  writeOfflineCache,
  type OfflineOperation,
} from './offlineStore';
import {
  isReplayingActionHistory,
  recordActionHistory,
  setActionHistoryExecutor,
  type ActionHistoryStep,
} from './actionHistory';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://oanurwzoymkmwmxoyzqi.supabase.co';
// La publishable key de Supabase está diseñada para usarse en clientes públicos.
// Se mantiene la variable de entorno como primera opción y esta clave como respaldo
// para evitar que la aplicación falle antes de montar React si Vercel no la inyecta.
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_bvx-RBb1Kvz9sfo0LXY3iQ_WHzw6ee2';
const STORAGE_KEY = 'profea-supabase-auth';
const LEGACY_STORAGE_KEY = 'profea-supabase-session';

if (typeof window !== 'undefined') {
  try { window.localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* noop */ }
}

export type SupabaseUser = User & { uid: string };

export const normalizeSupabaseUser = (user: User): SupabaseUser => ({
  ...user,
  uid: user.id,
});

const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: STORAGE_KEY,
  },
});

export async function getSessionUser(): Promise<User | null> {
  const { data } = await client.auth.getSession();
  return data.session?.user || null;
}

async function getAccessToken(): Promise<string | null> {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session?.access_token || null;
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const isNetworkFailure = (error: unknown) =>
  isOffline() ||
  error instanceof TypeError ||
  /failed to fetch|networkerror|network request failed|load failed/i.test(String((error as any)?.message || error || ''));

const requestLimiter = new RequestLimiter();
const readResponseCache = new ReadResponseCache();
const cacheChannel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('profea-read-cache-invalidation') : null;
if (cacheChannel) cacheChannel.onmessage = () => readResponseCache.clear();
function invalidateReadCache() {
  readResponseCache.clear();
  cacheChannel?.postMessage('invalidate');
}
client.auth.onAuthStateChange(() => readResponseCache.clear());
async function performNetworkRequest(path: string, options: RequestInit = {}, fresh = false): Promise<any> {
  const user = await getSessionUser();
  const method = String(options.method || 'GET').toUpperCase();
  const key = JSON.stringify([path, Array.from(new Headers(options.headers).entries()).sort()]);
  const load = () => requestLimiter.run(user?.id || 'anonymous', key, method === 'GET', () => sendNetworkRequest(path, options));
  if (method !== 'GET') {
    invalidateReadCache();
    try { return await load(); } finally { invalidateReadCache(); }
  }
  // Keep document/signature and permission reads live. Cache only ordinary lists/settings.
  // Static configuration can stay warm for longer because every local mutation
  // invalidates the cache immediately across tabs.
  const cacheTtl = (() => {
    if (!user) return 0;
    if (/^\/rest\/v1\/(obras|user_settings)(\?|$)/.test(path)) return 5 * 60_000;
    if (/^\/rest\/v1\/(trabajadores|inventory_items|inventory_parks)(\?|$)/.test(path)) return 60_000;
    return 0;
  })();
  return readResponseCache.read(
    JSON.stringify([user?.id || 'anonymous', key]),
    load,
    !fresh ? cacheTtl : 0,
  );
}

async function sendNetworkRequest(path: string, options: RequestInit = {}): Promise<any> {
  const token = await getAccessToken();
  const headers = new Headers(options.headers);
  headers.set('apikey', SUPABASE_KEY);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const error: any = new Error(data?.msg || data?.message || data?.error_description || data?.error || `Supabase HTTP ${response.status}`);
    error.status = response.status;
    error.code = data?.code || data?.error_code;
    throw error;
  }
  return data;
}

function parseBody(body: BodyInit | null | undefined) {
  if (typeof body !== 'string' || !body) return body ?? null;
  try { return JSON.parse(body); } catch { return body; }
}

function restTableFromPath(path: string) {
  return path.match(/^\/rest\/v1\/([^?]+)/)?.[1] || '';
}

function optimisticRestResult(path: string, options: RequestInit) {
  const prefer = new Headers(options.headers).get('Prefer') || '';
  if (!prefer.includes('return=representation')) return null;
  const parsed = parseBody(options.body);
  const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : [];
  const id = new URLSearchParams(path.split('?')[1] || '').get('id')?.replace(/^eq\./, '');
  return values.map((value: any) => ({
    ...(id && value?.id == null ? { id } : {}),
    ...value,
    __offlinePending: true,
  }));
}

async function queueRestRequest(path: string, options: RequestInit, userId: string) {
  invalidateReadCache();
  const method = String(options.method || 'GET').toUpperCase();
  const headers = Object.fromEntries(new Headers(options.headers).entries());
  const rawBody = options.body == null ? null : typeof options.body === 'string' ? options.body : String(options.body);
  const table = restTableFromPath(path);
  const query = path.includes('?') ? path.slice(path.indexOf('?') + 1) : '';

  await enqueueOfflineOperation({
    kind: 'rest',
    userId,
    label: table ? `${method} ${table}` : `${method} datos`,
    payload: { path, method, headers, body: rawBody },
  });

  if (table) {
    await applyRestMutationToCachedReads({
      userId,
      table,
      method,
      query,
      body: parseBody(rawBody),
    });
  }

  return optimisticRestResult(path, options);
}

async function request(path: string, options: RequestInit = {}, fresh = false): Promise<any> {
  const method = String(options.method || 'GET').toUpperCase();
  const user = await getSessionUser();
  const userId = user?.id || 'anonymous';
  const cacheKey = offlineCacheKey(userId, 'rest', path);

  if (method === 'GET') {
    if (isOffline()) {
      const cached = await readOfflineCache<any>(cacheKey);
      if (cached !== null) return cached;
      throw new Error('Sin conexión y sin una copia local disponible de estos datos.');
    }
    try {
      const result = await performNetworkRequest(path, options, fresh);
      await writeOfflineCache(cacheKey, result);
      return result;
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
      const cached = await readOfflineCache<any>(cacheKey);
      if (cached !== null) return cached;
      throw error;
    }
  }

  if (!user?.id) return performNetworkRequest(path, options);

  if (isOffline()) return queueRestRequest(path, options, user.id);

  try {
    return await performNetworkRequest(path, options);
  } catch (error) {
    if (!isNetworkFailure(error)) throw error;
    return queueRestRequest(path, options, user.id);
  }
}


type RestHistoryContext = {
  userId: string;
  table: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  query: string;
  body: any;
  prefer: string;
  beforeRows: any[];
};

type RpcHistoryContext = {
  userId: string;
  name: string;
  body: any;
  before: any;
};

const historyTableLabels: Record<string, string> = {
  trabajadores: 'trabajador',
  trash: 'papelera',
  obras: 'obra',
  subcontratas: 'subcontrata',
  subcontrata_trabajadores: 'trabajador de subcontrata',
  subcontrata_documentos: 'documentación CAE',
  medical_recognitions: 'reconocimiento médico',
  medical_appointments: 'cita médica',
  sae_needs: 'necesidad SAE',
  inventory_parks: 'parque',
  inventory_items: 'herramienta o maquinaria',
  inventory_movements: 'movimiento de inventario',
  inventory_maintenance: 'mantenimiento',
  inventory_documents: 'documentación de maquinaria',
  user_settings: 'configuración',
};

const cloneHistoryValue = <T,>(value: T): T => {
  if (value == null) return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
};

const idFilter = (id: unknown) => `id=eq.${encodeURIComponent(String(id))}`;

const cleanHistoryReadQuery = (query = '') => {
  const params = new URLSearchParams(query);
  params.delete('select');
  params.delete('order');
  params.delete('limit');
  params.delete('offset');
  params.set('select', '*');
  return params.toString();
};

async function readHistoryRows(table: string, query = ''): Promise<any[]> {
  const cleanQuery = cleanHistoryReadQuery(query);
  const result = await request(`/rest/v1/${table}${cleanQuery ? `?${cleanQuery}` : '?select=*'}`, { method: 'GET' }, true);
  return Array.isArray(result) ? cloneHistoryValue(result) : [];
}

async function readRowsByIds(table: string, ids: unknown[]): Promise<any[]> {
  const unique = Array.from(new Set(ids.filter(id => id !== undefined && id !== null).map(String)));
  const rows: any[] = [];
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = unique.slice(offset, offset + 100);
    // PostgREST quoted values keep commas/parentheses in identifiers literal.
    const values = batch.map(id => JSON.stringify(id)).join(',');
    const found = await readHistoryRows(table, `id=in.${encodeURIComponent(`(${values})`)}`);
    rows.push(...found);
  }
  return rows;
}

const restStep = (
  table: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  query = '',
  body?: any,
  prefer = 'return=minimal',
): ActionHistoryStep => ({
  kind: 'rest',
  table,
  method,
  ...(query ? { query } : {}),
  ...(body !== undefined ? { body: cloneHistoryValue(body) } : {}),
  ...(prefer ? { prefer } : {}),
});

const rpcStep = (name: string, body: any = {}): ActionHistoryStep => ({
  kind: 'rpc',
  name,
  body: cloneHistoryValue(body),
});

const restoreRowsStep = (table: string, rows: any[]): ActionHistoryStep | null =>
  rows.length
    ? restStep(table, 'POST', '', rows, 'resolution=merge-duplicates,return=minimal')
    : null;

function historyLabel(table: string, method: string, count = 1) {
  const target = historyTableLabels[table] || table.replace(/_/g, ' ');
  if (method === 'POST') return count > 1 ? `Crear ${count} registros en ${target}` : `Crear ${target}`;
  if (method === 'PATCH') return count > 1 ? `Modificar ${count} registros de ${target}` : `Modificar ${target}`;
  return count > 1 ? `Eliminar ${count} registros de ${target}` : `Eliminar ${target}`;
}

async function prepareRestHistory(
  table: string,
  method: string,
  query: string,
  body: any,
  prefer: string,
): Promise<RestHistoryContext | null> {
  const upper = method.toUpperCase();
  if (isReplayingActionHistory() || !['POST', 'PATCH', 'DELETE'].includes(upper)) return null;
  const user = await getSessionUser();
  if (!user) return null;

  let beforeRows: any[] = [];
  if (upper === 'PATCH' || upper === 'DELETE') {
    beforeRows = await readHistoryRows(table, query);
  } else {
    const rows = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : [];
    beforeRows = await readRowsByIds(table, rows.map((row: any) => row?.id));
  }

  return {
    userId: user.id,
    table,
    method: upper as RestHistoryContext['method'],
    query,
    body: cloneHistoryValue(body),
    prefer,
    beforeRows,
  };
}

function commitRestHistory(context: RestHistoryContext) {
  const rows = Array.isArray(context.body) ? context.body : context.body && typeof context.body === 'object' ? [context.body] : [];
  const undo: ActionHistoryStep[] = [];
  const redo: ActionHistoryStep[] = [
    restStep(context.table, context.method, context.query, context.body, context.prefer || 'return=minimal'),
  ];

  if (context.method === 'DELETE') {
    const restore = restoreRowsStep(context.table, context.beforeRows);
    if (restore) undo.push(restore);
  } else if (context.method === 'PATCH') {
    const keys = Object.keys(context.body || {}).filter(key => key !== 'id');
    for (const before of context.beforeRows) {
      if (before?.id == null) continue;
      const patch: Record<string, any> = {};
      keys.forEach(key => { patch[key] = before?.[key] ?? null; });
      if (Object.keys(patch).length) undo.push(restStep(context.table, 'PATCH', idFilter(before.id), patch));
    }
  } else {
    const previousById = new Map(context.beforeRows.filter(row => row?.id != null).map(row => [String(row.id), row]));
    for (const row of rows) {
      if (row?.id == null) continue;
      const previous = previousById.get(String(row.id));
      if (previous) {
        const patch: Record<string, any> = {};
        Object.keys(row).filter(key => key !== 'id').forEach(key => { patch[key] = previous?.[key] ?? null; });
        undo.push(restStep(context.table, 'PATCH', idFilter(row.id), patch));
      } else {
        undo.push(restStep(context.table, 'DELETE', idFilter(row.id)));
      }
    }
  }

  if (!undo.length) return;
  recordActionHistory({
    userId: context.userId,
    label: historyLabel(
      context.table,
      context.method,
      context.method === 'PATCH' || context.method === 'DELETE' ? Math.max(1, context.beforeRows.length) : Math.max(1, rows.length),
    ),
    undo,
    redo,
  });
}

async function prepareRpcHistory(name: string, body: any): Promise<RpcHistoryContext | null> {
  if (isReplayingActionHistory()) return null;
  const user = await getSessionUser();
  if (!user) return null;

  if (name === 'patch_user_settings') {
    const before = await readHistoryRows('user_settings', `user_id=eq.${encodeURIComponent(user.id)}&limit=1`);
    return { userId: user.id, name, body: cloneHistoryValue(body), before };
  }

  if (name === 'import_workers_atomic') {
    const ids = Array.isArray(body?.p_workers) ? body.p_workers.map((row: any) => row?.id) : [];
    const before = await readRowsByIds('trabajadores', ids);
    return { userId: user.id, name, body: cloneHistoryValue(body), before };
  }

  if (name === 'bulk_move_trabajadores_to_trash') {
    const ids = Array.isArray(body?.p_ids) ? body.p_ids : [];
    const workers = await readRowsByIds('trabajadores', ids);
    const trash = await readRowsByIds('trash', ids);
    return { userId: user.id, name, body: cloneHistoryValue(body), before: { workers, trash } };
  }

  if (name === 'empty_trash_bulk') {
    const trash = await readHistoryRows('trash');
    return { userId: user.id, name, body: cloneHistoryValue(body), before: { trash } };
  }

  if (name === 'inventory_update_movement' || name === 'inventory_delete_movement') {
    const movementId = body?.p_movement_id;
    if (!movementId) return null;
    const movement = (await readHistoryRows('inventory_movements', `${idFilter(movementId)}&limit=1`))[0] || null;
    if (!movement) return null;
    const item = (await readHistoryRows('inventory_items', `${idFilter(movement.item_id)}&limit=1`))[0] || null;
    let nextMovement: any = null;
    if (movement.created_at) {
      nextMovement = (
        await readHistoryRows(
          'inventory_movements',
          `item_id=eq.${encodeURIComponent(String(movement.item_id))}&created_at=gt.${encodeURIComponent(String(movement.created_at))}&order=created_at.asc&limit=1`,
        )
      )[0] || null;
    }
    return { userId: user.id, name, body: cloneHistoryValue(body), before: { movement, item, nextMovement } };
  }

  if (name === 'inventory_register_movement') {
    const itemId = body?.p_item_id;
    if (!itemId) return null;
    const item = (await readHistoryRows('inventory_items', `${idFilter(itemId)}&limit=1`))[0] || null;
    return { userId: user.id, name, body: cloneHistoryValue(body), before: { item } };
  }

  return null;
}

async function commitRpcHistory(context: RpcHistoryContext, result: any) {
  const { name, body, userId, before } = context;
  const undo: ActionHistoryStep[] = [];
  const redo: ActionHistoryStep[] = [rpcStep(name, body)];
  let label = name.replace(/_/g, ' ');

  if (name === 'patch_user_settings') {
    const previous = before?.[0];
    if (previous) {
      undo.push(restStep('user_settings', 'PATCH', `user_id=eq.${encodeURIComponent(userId)}`, { settings: previous.settings }));
    } else {
      undo.push(restStep('user_settings', 'DELETE', `user_id=eq.${encodeURIComponent(userId)}`));
    }
    label = 'Cambiar configuración';
  } else if (name === 'import_workers_atomic') {
    const workers = Array.isArray(body?.p_workers) ? body.p_workers : [];
    const previousById = new Map((before || []).filter((row: any) => row?.id != null).map((row: any) => [String(row.id), row]));
    const restore: any[] = [];
    for (const worker of workers) {
      if (worker?.id == null) continue;
      const previous = previousById.get(String(worker.id));
      if (previous) restore.push(previous);
      else undo.push(restStep('trabajadores', 'DELETE', idFilter(worker.id)));
    }
    const restoreStep = restoreRowsStep('trabajadores', restore);
    if (restoreStep) undo.unshift(restoreStep);
    label = workers.length > 1 ? `Importar ${workers.length} trabajadores` : 'Importar trabajador';
  } else if (name === 'bulk_move_trabajadores_to_trash') {
    const ids = Array.isArray(body?.p_ids) ? body.p_ids : [];
    ids.forEach((id: unknown) => undo.push(restStep('trash', 'DELETE', idFilter(id))));
    const previousTrash = restoreRowsStep('trash', before?.trash || []);
    if (previousTrash) undo.push(previousTrash);
    const previousWorkers = restoreRowsStep('trabajadores', before?.workers || []);
    if (previousWorkers) undo.push(previousWorkers);
    label = ids.length > 1 ? `Enviar ${ids.length} trabajadores a papelera` : 'Enviar trabajador a papelera';
  } else if (name === 'empty_trash_bulk') {
    const restore = restoreRowsStep('trash', before?.trash || []);
    if (restore) undo.push(restore);
    label = 'Vaciar papelera';
  } else if (name === 'inventory_update_movement') {
    const movement = before?.movement;
    if (movement) {
      undo.push(rpcStep('inventory_update_movement', {
        p_movement_id: movement.id,
        p_tipo: movement.tipo,
        p_destino: movement.destino,
        p_estado_nuevo: movement.estado_nuevo,
        p_observaciones: movement.observaciones || '',
        p_latitud: movement.latitud ?? null,
        p_longitud: movement.longitud ?? null,
        p_foto_paths: movement.foto_paths || [],
      }));
    }
    label = 'Corregir movimiento de inventario';
  } else if (name === 'inventory_delete_movement') {
    const movement = before?.movement;
    if (movement) {
      const restore = restoreRowsStep('inventory_movements', [movement]);
      if (restore) undo.push(restore);
      if (before?.nextMovement?.id != null) {
        undo.push(restStep('inventory_movements', 'PATCH', idFilter(before.nextMovement.id), { origen: before.nextMovement.origen }));
      }
      if (before?.item?.id != null) {
        undo.push(restStep('inventory_items', 'PATCH', idFilter(before.item.id), {
          ubicacion_actual: before.item.ubicacion_actual,
          obra_actual_id: before.item.obra_actual_id,
          estado: before.item.estado,
          responsable_actual: before.item.responsable_actual,
        }));
      }
    }
    label = 'Eliminar movimiento de inventario';
  } else if (name === 'inventory_register_movement') {
    const movementId = typeof result === 'string' ? result : result?.movement_id || result?.id;
    if (movementId) {
      const movement = (await readHistoryRows('inventory_movements', `${idFilter(movementId)}&limit=1`))[0] || null;
      const itemAfter = before?.item?.id
        ? (await readHistoryRows('inventory_items', `${idFilter(before.item.id)}&limit=1`))[0] || null
        : null;
      undo.push(rpcStep('inventory_delete_movement', { p_movement_id: movementId }));
      if (movement) {
        redo.length = 0;
        const restore = restoreRowsStep('inventory_movements', [movement]);
        if (restore) redo.push(restore);
        if (itemAfter?.id != null) {
          redo.push(restStep('inventory_items', 'PATCH', idFilter(itemAfter.id), {
            ubicacion_actual: itemAfter.ubicacion_actual,
            obra_actual_id: itemAfter.obra_actual_id,
            estado: itemAfter.estado,
            responsable_actual: itemAfter.responsable_actual,
          }));
        }
      }
    }
    label = 'Registrar movimiento de inventario';
  }

  if (!undo.length || !redo.length) return;
  recordActionHistory({ userId, label, undo, redo });
}

async function executeHistoryStep(step: ActionHistoryStep) {
  if (step.kind === 'rpc') {
    invalidateReadCache();
    const { error } = await Promise.resolve(client.rpc(step.name, step.body || {})).finally(invalidateReadCache);
    if (error) throw error;
    return;
  }
  const headers: Record<string, string> = {};
  if (step.prefer) headers.Prefer = step.prefer;
  await request(`/rest/v1/${step.table}${step.query ? `?${step.query}` : ''}`, {
    method: step.method,
    headers,
    body: step.body === undefined ? undefined : JSON.stringify(step.body),
  });
}

setActionHistoryExecutor(executeHistoryStep);

const normalizeWork = (value: unknown) => String(value ?? '')
  .trim()
  .toLocaleLowerCase('es')
  .replace(/[._\-/:]+/g, ' ')
  .replace(/\s+/g, ' ');

const workIdentity = (value: unknown) => {
  const raw = normalizeWork(value);
  const code = raw.match(/\b(\d{5})\b/)?.[1] || '';
  const compact = raw.replace(/\s+/g, '');
  const type = compact.includes('gr') ? 'gr' : compact.includes('ee') ? 'ee' : '';
  return code && type ? `${code} ${type}` : raw;
};

async function syncObrasPreventiveResource(rows: any): Promise<any> {
  if (!Array.isArray(rows) || !rows.length) return rows;
  try {
    const user = await getSessionUser();
    if (!user) return rows;

    const settingsRows = await request(`/rest/v1/user_settings?user_id=eq.${encodeURIComponent(user.id)}&select=preferences:settings->subcontratasPreferences&limit=1`);
    const mapping = settingsRows?.[0]?.preferences?.obrasRecursosPreventivos;
    if (!mapping || typeof mapping !== 'object') return rows;

    const entries = Object.entries(mapping as Record<string, any>);
    return rows.map((row: any) => {
      const key = workIdentity(row?.nombre);
      const match = entries.find(([obra]) => workIdentity(obra) === key)?.[1] as any;
      const configuredName = String(match?.recursoPreventivoNombre || '').trim();
      if (!configuredName) return row;
      return { ...row, recurso_preventivo: configuredName };
    });
  } catch {
    return rows;
  }
}

async function edgeFunctionErrorMessage(error: any): Promise<string> {
  try {
    const response = error?.context;
    if (response && typeof response.clone === 'function') {
      const cloned = response.clone();
      const text = await cloned.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          return parsed?.error || parsed?.message || parsed?.msg || error?.message || 'La operación no se pudo completar.';
        } catch {
          return text;
        }
      }
    }
  } catch {
    // Conserva el mensaje original si no se puede leer la respuesta de la Edge Function.
  }
  return error?.message || 'La operación no se pudo completar.';
}

export async function queueOfflineRpc(name: string, body: any, label?: string, meta?: any) {
  const user = await getSessionUser();
  if (!user) throw new Error('Debes iniciar sesión para guardar cambios sin conexión.');
  return enqueueOfflineOperation({
    kind: 'rpc',
    userId: user.id,
    label: label || name,
    payload: { name, body, meta: meta || null },
  });
}

export async function queueOfflineStorageUpload(input: {
  bucket: string;
  path: string;
  file: Blob;
  options?: Record<string, any>;
  label?: string;
}) {
  const user = await getSessionUser();
  if (!user) throw new Error('Debes iniciar sesión para guardar archivos sin conexión.');
  return enqueueOfflineOperation({
    kind: 'storage-upload',
    userId: user.id,
    label: input.label || `Subir ${input.path}`,
    payload: {
      bucket: input.bucket,
      path: input.path,
      file: input.file,
      options: input.options || {},
    },
  });
}

export async function queueOfflineStorageRemove(bucket: string, paths: string[]) {
  const user = await getSessionUser();
  if (!user) throw new Error('Debes iniciar sesión para guardar cambios sin conexión.');
  return enqueueOfflineOperation({
    kind: 'storage-remove',
    userId: user.id,
    label: 'Eliminar archivo',
    payload: { bucket, paths },
  });
}

async function replayOperation(operation: OfflineOperation) {
  if (operation.kind === 'rest') {
    const payload = operation.payload || {};
    await performNetworkRequest(payload.path, {
      method: payload.method,
      headers: payload.headers,
      body: payload.body ?? undefined,
    });
    return;
  }
  if (operation.kind === 'rpc') {
    invalidateReadCache();
    const { data, error } = await Promise.resolve(client.rpc(operation.payload.name, operation.payload.body || {})).finally(invalidateReadCache);
    if (error) throw error;
    return data;
  }
  if (operation.kind === 'storage-upload') {
    const { bucket, path, file, options } = operation.payload;
    const { error } = await client.storage.from(bucket).upload(path, file, options || {});
    if (error) throw error;
    return;
  }
  if (operation.kind === 'storage-remove') {
    const { error } = await client.storage.from(operation.payload.bucket).remove(operation.payload.paths || []);
    if (error) throw error;
  }
}

let flushPromise: Promise<void> | null = null;

export async function flushOfflineQueue(): Promise<void> {
  if (flushPromise) return flushPromise;
  if (isOffline()) return;
  flushPromise = (async () => {
    await setOfflineSyncActivity(true);
    try {
      const user = await getSessionUser();
      if (!user) {
        await setOfflineSyncActivity(false, 'Inicia sesión para sincronizar los cambios pendientes.');
        return;
      }
      const operations = await listOfflineOperations(user.id);
      for (const operation of operations) {
        try {
          await replayOperation(operation);
          await removeOfflineOperation(operation.id);
        } catch (error) {
          await updateOfflineOperationFailure(operation.id, error);
          if (isNetworkFailure(error)) throw error;
          // Conserva la operación para que el usuario no pierda trabajo.
          throw error;
        }
      }
      await setOfflineSyncActivity(false, '', true);
    } catch (error) {
      await setOfflineSyncActivity(false, error instanceof Error ? error.message : String(error));
    } finally {
      flushPromise = null;
    }
  })();
  return flushPromise;
}

let offlineSyncInstalled = false;
export function initializeOfflineSync() {
  if (offlineSyncInstalled || typeof window === 'undefined') return;
  offlineSyncInstalled = true;
  const sync = () => {
    if (navigator.onLine) void flushOfflineQueue();
  };
  window.addEventListener('online', sync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync();
  });
  window.addEventListener('pageshow', sync);
  window.setTimeout(sync, 800);
}

export const supabase = {
  get url() { return SUPABASE_URL; },
  get key() { return SUPABASE_KEY; },
  auth: client.auth,
  storage: client.storage,
  channel(name: string) {
    return client.channel(name);
  },
  removeChannel(channel: ReturnType<typeof client.channel>) {
    return client.removeChannel(channel);
  },
  async query(table: string, options: { method?: string; query?: string; body?: any; prefer?: string; fresh?: boolean } = {}) {
    const headers: Record<string, string> = {};
    if (options.prefer) headers.Prefer = options.prefer;
    const method = options.method || 'GET';
    const upperMethod = method.toUpperCase();
    let historyContext: RestHistoryContext | null = null;
    if (['POST', 'PATCH', 'DELETE'].includes(upperMethod) && !isReplayingActionHistory()) {
      try {
        historyContext = await prepareRestHistory(
          table,
          upperMethod,
          options.query || '',
          options.body,
          options.prefer || 'return=minimal',
        );
      } catch (error) {
        console.warn('No se pudo preparar el historial reversible de la operación:', error);
      }
    }

    const result = await request(`/rest/v1/${table}${options.query ? `?${options.query}` : ''}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }, options.fresh === true);

    if (historyContext) commitRestHistory(historyContext);

    if (table === 'obras' && upperMethod === 'GET') {
      return syncObrasPreventiveResource(result);
    }

    return result;
  },
  async rpc(name: string, body: any = {}) {
    if (isOffline()) throw new Error('Esta operación necesita conexión. Los movimientos y cambios de obra compatibles se guardan automáticamente para sincronizarse después.');
    let historyContext: RpcHistoryContext | null = null;
    if (!isReplayingActionHistory()) {
      try {
        historyContext = await prepareRpcHistory(name, body);
      } catch (error) {
        console.warn('No se pudo preparar el historial reversible del RPC:', error);
      }
    }
    invalidateReadCache();
    let data: any;
    try {
      const result = await client.rpc(name, body);
      if (result.error) throw result.error;
      data = result.data;
    } finally { invalidateReadCache(); }
    if (historyContext) {
      try {
        await commitRpcHistory(historyContext, data);
      } catch (historyError) {
        console.warn('La operación se completó, pero no pudo añadirse al historial reversible:', historyError);
      }
    }
    return data;
  },
  async edgeFunction(name: string, body: any) {
    if (isOffline()) throw new Error('Esta operación necesita conexión a internet.');
    invalidateReadCache();
    const result = await client.functions.invoke(name, { body }).finally(invalidateReadCache);
    const { data, error } = result;
    if (error) {
      const friendly = new Error(await edgeFunctionErrorMessage(error));
      (friendly as any).cause = error;
      throw friendly;
    }
    return data;
  },
};

export { SUPABASE_URL, SUPABASE_KEY, STORAGE_KEY };
