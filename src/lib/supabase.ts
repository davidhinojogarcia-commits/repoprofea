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

    const result = await request(`/rest/v1/${table}${options.query ? `?${options.query}` : ''}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }, options.fresh === true);

    if (table === 'obras' && upperMethod === 'GET') {
      return syncObrasPreventiveResource(result);
    }

    return result;
  },
  async rpc(name: string, body: any = {}) {
    if (isOffline()) throw new Error('Esta operación necesita conexión. Los movimientos y cambios de obra compatibles se guardan automáticamente para sincronizarse después.');
    invalidateReadCache();
    try {
      const result = await client.rpc(name, body);
      if (result.error) throw result.error;
      return result.data;
    } finally {
      invalidateReadCache();
    }
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
