export type OfflineOperationKind =
  | 'rest'
  | 'rpc'
  | 'storage-upload'
  | 'storage-remove';

export type OfflineOperation = {
  id: string;
  kind: OfflineOperationKind;
  userId: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
  label?: string;
  payload: any;
};

export type OfflineSyncState = {
  online: boolean;
  pending: number;
  syncing: boolean;
  lastError: string;
  lastSyncedAt: number | null;
};

type CacheRecord = {
  key: string;
  value: any;
  updatedAt: number;
};

const DB_NAME = 'profea-offline-v1';
const DB_VERSION = 1;
const CACHE_STORE = 'cache';
const QUEUE_STORE = 'queue';
const STATE_EVENT = 'profea:offline-sync-state';

let dbPromise: Promise<IDBDatabase> | null = null;
let syncing = false;
let lastError = '';
let lastSyncedAt: number | null = null;

const isBrowser = () => typeof window !== 'undefined' && typeof indexedDB !== 'undefined';

function openDb(): Promise<IDBDatabase> {
  if (!isBrowser()) return Promise.reject(new Error('IndexedDB no disponible'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('userId', 'userId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacén offline'));
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Error de IndexedDB'));
  });
}

async function transactionDone(transaction: IDBTransaction): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Error de IndexedDB'));
    transaction.onabort = () => reject(transaction.error || new Error('Operación IndexedDB cancelada'));
  });
}

export const offlineCacheKey = (userId: string, scope: string, key: string) =>
  `${userId}:${scope}:${key}`;

export async function readOfflineCache<T>(key: string): Promise<T | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(CACHE_STORE, 'readonly');
    const row = await requestResult<CacheRecord | undefined>(tx.objectStore(CACHE_STORE).get(key));
    return row ? (row.value as T) : null;
  } catch {
    return null;
  }
}

export async function writeOfflineCache(key: string, value: any): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  const tx = db.transaction(CACHE_STORE, 'readwrite');
  tx.objectStore(CACHE_STORE).put({ key, value, updatedAt: Date.now() } satisfies CacheRecord);
  await transactionDone(tx);
}

export async function listOfflineCache(prefix: string): Promise<CacheRecord[]> {
  if (!isBrowser()) return [];
  const db = await openDb();
  const tx = db.transaction(CACHE_STORE, 'readonly');
  const rows = await requestResult<CacheRecord[]>(tx.objectStore(CACHE_STORE).getAll());
  return (rows || []).filter(row => row.key.startsWith(prefix));
}

export async function enqueueOfflineOperation(
  operation: Omit<OfflineOperation, 'id' | 'createdAt' | 'attempts'> & { id?: string; createdAt?: number },
): Promise<OfflineOperation> {
  if (!isBrowser()) throw new Error('El almacenamiento offline no está disponible en este dispositivo.');
  const row: OfflineOperation = {
    ...operation,
    id: operation.id || crypto.randomUUID(),
    createdAt: operation.createdAt || Date.now(),
    attempts: 0,
  };
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, 'readwrite');
  tx.objectStore(QUEUE_STORE).put(row);
  await transactionDone(tx);
  await emitOfflineState();
  return row;
}

export async function listOfflineOperations(userId?: string): Promise<OfflineOperation[]> {
  if (!isBrowser()) return [];
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, 'readonly');
  const rows = await requestResult<OfflineOperation[]>(tx.objectStore(QUEUE_STORE).getAll());
  return (rows || [])
    .filter(row => !userId || row.userId === userId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeOfflineOperation(id: string): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, 'readwrite');
  tx.objectStore(QUEUE_STORE).delete(id);
  await transactionDone(tx);
}

export async function updateOfflineOperationFailure(id: string, error: unknown): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, 'readwrite');
  const store = tx.objectStore(QUEUE_STORE);
  const row = await requestResult<OfflineOperation | undefined>(store.get(id));
  if (row) {
    store.put({
      ...row,
      attempts: Number(row.attempts || 0) + 1,
      lastError: error instanceof Error ? error.message : String(error),
    });
  }
  await transactionDone(tx);
}

const ignoredFilterKeys = new Set(['select', 'order', 'limit', 'offset', 'or', 'and']);

function cachedPathMatchesRow(path: string, row: any): boolean {
  const queryIndex = path.indexOf('?');
  if (queryIndex < 0) return true;
  const params = new URLSearchParams(path.slice(queryIndex + 1));
  for (const [key, rawValue] of params.entries()) {
    if (ignoredFilterKeys.has(key) || key.includes('.')) continue;
    if (!rawValue.startsWith('eq.')) continue;
    const expected = rawValue.slice(3);
    const actual = row?.[key];
    if (String(actual ?? '') !== expected) return false;
  }
  return true;
}

function operationFilterMatches(query: string | undefined, row: any): boolean {
  if (!query) return true;
  const params = new URLSearchParams(query);
  let hasFilter = false;
  for (const [key, rawValue] of params.entries()) {
    if (ignoredFilterKeys.has(key) || !rawValue.startsWith('eq.')) continue;
    hasFilter = true;
    const expected = rawValue.slice(3);
    if (String(row?.[key] ?? '') !== expected) return false;
  }
  return hasFilter ? true : true;
}

export async function applyRestMutationToCachedReads(input: {
  userId: string;
  table: string;
  method: string;
  query?: string;
  body?: any;
}): Promise<void> {
  if (!isBrowser()) return;
  const method = input.method.toUpperCase();
  if (!['POST', 'PATCH', 'DELETE'].includes(method)) return;

  const prefix = offlineCacheKey(input.userId, 'rest', `/rest/v1/${input.table}`);
  const records = await listOfflineCache(prefix);
  const bodies = Array.isArray(input.body) ? input.body : input.body ? [input.body] : [];

  for (const record of records) {
    if (!Array.isArray(record.value)) continue;
    let next = [...record.value];

    if (method === 'POST') {
      for (const row of bodies) {
        if (!cachedPathMatchesRow(record.key.slice(record.key.indexOf('/rest/v1/')), row)) continue;
        const id = row?.id == null ? '' : String(row.id);
        const existingIndex = id ? next.findIndex(item => String(item?.id ?? '') === id) : -1;
        const optimisticRow = {
          ...row,
          created_at: row?.created_at || new Date().toISOString(),
          updated_at: row?.updated_at || new Date().toISOString(),
          __offlinePending: true,
        };
        if (existingIndex >= 0) next[existingIndex] = { ...next[existingIndex], ...optimisticRow };
        else next.unshift(optimisticRow);
      }
    } else if (method === 'PATCH') {
      next = next.map(row =>
        operationFilterMatches(input.query, row)
          ? {
              ...row,
              ...(input.body || {}),
              updated_at: input.body?.updated_at || new Date().toISOString(),
              __offlinePending: true,
            }
          : row,
      );
    } else if (method === 'DELETE') {
      next = next.filter(row => !operationFilterMatches(input.query, row));
    }

    await writeOfflineCache(record.key, next);
  }
}

export async function getOfflineSyncState(): Promise<OfflineSyncState> {
  const pending = (await listOfflineOperations()).length;
  // Un error de sincronización solo tiene sentido mientras exista trabajo
  // pendiente. Si la cola ya está vacía, no mantengas un aviso rojo residual.
  if (pending === 0 && lastError) lastError = '';
  return {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    pending,
    syncing,
    lastError,
    lastSyncedAt,
  };
}

export async function emitOfflineState(): Promise<void> {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<OfflineSyncState>(STATE_EVENT, {
    detail: await getOfflineSyncState(),
  }));
}

export function subscribeOfflineState(listener: (state: OfflineSyncState) => void) {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<OfflineSyncState>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(STATE_EVENT, handler as EventListener);
  void getOfflineSyncState().then(listener);
  return () => window.removeEventListener(STATE_EVENT, handler as EventListener);
}

export async function setOfflineSyncActivity(
  nextSyncing: boolean,
  error = '',
  synced = false,
): Promise<void> {
  syncing = nextSyncing;
  lastError = error;
  if (synced) lastSyncedAt = Date.now();
  await emitOfflineState();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void emitOfflineState());
  window.addEventListener('offline', () => void emitOfflineState());
}
