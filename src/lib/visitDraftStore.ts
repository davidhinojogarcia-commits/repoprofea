// Drafts only: never queue signatures, links, OTPs, Gmail credentials or sends.
// AES-GCM protects stored bytes. The non-exportable device key does not protect
// against malicious same-origin script; CSP and device access remain essential.
const TTL = 7 * 86400000;
let database: Promise<IDBDatabase> | undefined;
function db() {
  return database ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('profea-visit-drafts', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('drafts'); r.result.createObjectStore('keys'); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { database = undefined; reject(new Error('No se pudo abrir el guardado del dispositivo.')); };
  });
}
async function read(store: string, id: string): Promise<any> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const r = database.transaction(store).objectStore(store).get(id);
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
async function write(store: string, id: string, value?: unknown) {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const t = database.transaction(store, 'readwrite');
    if (value === undefined) t.objectStore(store).delete(id); else t.objectStore(store).put(value, id);
    t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  });
}
const pendingKeys = new Map<string, Promise<CryptoKey>>();
function key(user: string): Promise<CryptoKey> {
  let pending = pendingKeys.get(user);
  if (!pending) {
    pending = (async () => {
      const candidate = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
      const database = await db();
      return await new Promise<CryptoKey>((resolve,reject)=>{
        const transaction=database.transaction('keys','readwrite'),store=transaction.objectStore('keys'),request=store.get(user);let value:CryptoKey;
        request.onsuccess=()=>{value=request.result||candidate;if(!request.result)store.put(candidate,user);};
        transaction.oncomplete=()=>resolve(value);transaction.onerror=()=>reject(transaction.error);
      });
    })();
    pendingKeys.set(user, pending);
    void pending.catch(() => pendingKeys.delete(user));
  }
  return pending;
}
async function encryptDraft(user: string, value: unknown) {
  if (!user) throw new Error('Inicia sesión para proteger el borrador.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:new TextEncoder().encode(user)}, await key(user), bytes);
  await write('drafts', user, {iv, encrypted, expires:Date.now()+TTL});
}
export async function readVisitDraft<T>(user: string): Promise<T | null> {
  const row = await read('drafts', user);
  if (!row) return null;
  if (row.expires < Date.now()) { await clearVisitDraft(user); return null; }
  try {
    const bytes = await crypto.subtle.decrypt({name:'AES-GCM', iv:row.iv, additionalData:new TextEncoder().encode(user)}, await key(user), row.encrypted);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { throw new Error('No se pudo recuperar el borrador protegido de este dispositivo.'); }
}
const writes = new Map<string,Promise<void>>();
function serialize(user:string,operation:()=>Promise<void>){
  const next=(writes.get(user)||Promise.resolve()).catch(()=>undefined).then(operation);writes.set(user,next);
  void next.finally(()=>{if(writes.get(user)===next)writes.delete(user);}).catch(()=>undefined);return next;
}
export const storeVisitDraft=(user:string,value:unknown)=>serialize(user,()=>encryptDraft(user,value));
export const clearVisitDraft = (user: string) => serialize(user,()=>write('drafts', user));
export async function forgetVisitDraft(user: string) {
  pendingKeys.delete(user);
  await clearVisitDraft(user); await write('keys', user);
}
