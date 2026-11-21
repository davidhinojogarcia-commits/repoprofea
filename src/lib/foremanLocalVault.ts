// Private portal records never enter the public Service Worker cache.
// The access token is the key material; it is not stored in this database.
const DB = 'profea-foreman-v3';
const LEASE_MS = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();
type Envelope = { id: string; iv: Uint8Array; bytes: ArrayBuffer };
let database: Promise<IDBDatabase> | undefined;
const writes = new Map<string, Promise<unknown>>();

function openDatabase() {
  return database ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'id' });
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function foremanVault(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode('foreman-v3:' + token));
  const scope = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  const secret = await crypto.subtle.digest('SHA-256', encoder.encode('foreman-v3-encryption:' + token));
  const key = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const id = (name: string) => scope + ':' + name;
  async function get<T>(name: string): Promise<T | null> {
    await writes.get(scope)?.catch(() => undefined);
    const db = await openDatabase();
    const row = await new Promise<Envelope | undefined>((resolve, reject) => {
      const request = db.transaction('records').objectStore('records').get(id(name));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!row) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv, additionalData: encoder.encode(row.id) }, key, row.bytes);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  }
  function mutate(name: string, value: unknown, remove = false) {
    const previous = writes.get(scope) || Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const recordId = id(name);
      const bytes = remove ? null : await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(recordId) }, key, encoder.encode(JSON.stringify(value)));
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('records', 'readwrite');
        const store = tx.objectStore('records');
        if (remove) store.delete(recordId);
        else store.put({ id: recordId, iv, bytes });
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error || new Error('No se pudo guardar en este dispositivo.'));
      });
    });
    writes.set(scope, task);
    return task;
  }
  return {
    get,
    put: (name: string, value: unknown) => mutate(name, value),
    remove: (name: string) => mutate(name, null, true),
    async authorize() { await mutate('lease', Date.now() + LEASE_MS); },
    async authorized() { return Number(await get<number>('lease')) > Date.now(); },
    async clear() {
      await writes.get(scope)?.catch(() => undefined);
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('records', 'readwrite');
        const request = tx.objectStore('records').openCursor(IDBKeyRange.bound(scope + ':', scope + ':\uffff'));
        request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    },
  };
}

export type ForemanVault = Awaited<ReturnType<typeof foremanVault>>;
