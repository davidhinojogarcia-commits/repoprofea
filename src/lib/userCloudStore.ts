import { collection, doc, getDocs, onSnapshot, setDoc, deleteDoc, query, where, writeBatch } from 'firebase/firestore';
import { db } from './firebase';

const ROOT_COLLECTION = 'user_data';
const STATE_COLLECTION = 'state';
const PREFIX = 'personasPROFEA';
const MAX_VALUE_BYTES = 900_000;

// Keys used only by the old manual synchronization system are deliberately not persisted.
const EXCLUDED_KEYS = new Set([
  'personasPROFEA_groupId',
  'personasPROFEA_isSyncing',
  'personasPROFEA_syncMode',
  'personasPROFEA_syncEmail',
  'personasPROFEA_activeWorkspace',
  'personasPROFEA_activeWorkspaceId',
  'personasPROFEA_sessionId',
  'personasPROFEA_lastSyncTime',
]);

function shouldSyncKey(key: string) {
  return key.startsWith(PREFIX) || [
    'obrasGuardadas',
    'lugaresFormacion',
    'sitiosReconocimiento',
    'telefonosGuardados',
    'categoriasGuardadas',
    'workStartHour',
    'workEndHour',
    'selectedObraFilter',
    'selectedQuincenaFilter',
    'theme',
  ].includes(key);
}

function encodeValue(value: string | null) {
  if (value === null) return null;
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes > MAX_VALUE_BYTES) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function decodeValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export async function loadUserCloudState(uid: string): Promise<{ hasCloudData: boolean }> {
  const snapshot = await getDocs(collection(db, ROOT_COLLECTION, uid, STATE_COLLECTION));
  if (snapshot.empty) return { hasCloudData: false };

  // Cloud is authoritative once the account already has data.
  for (const item of snapshot.docs) {
    const key = item.id;
    if (!shouldSyncKey(key) || EXCLUDED_KEYS.has(key)) continue;
    const data = item.data();
    if (data.deleted === true) {
      localStorage.removeItem(key);
    } else if (data.value !== undefined) {
      localStorage.setItem(key, decodeValue(data.value));
    }
  }
  return { hasCloudData: true };
}

export async function uploadExistingLocalState(uid: string) {
  const stateRef = collection(db, ROOT_COLLECTION, uid, STATE_COLLECTION);
  const batch = writeBatch(db);
  let count = 0;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !shouldSyncKey(key) || EXCLUDED_KEYS.has(key)) continue;
    const encoded = encodeValue(localStorage.getItem(key));
    if (encoded === null) continue;
    batch.set(doc(stateRef, key), { value: encoded, updatedAt: new Date() });
    count++;
  }

  if (count > 0) await batch.commit();
}

export function startUserCloudSync(uid: string) {
  let applyingRemote = false;
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const originalSetItem = localStorage.setItem.bind(localStorage);
  const originalRemoveItem = localStorage.removeItem.bind(localStorage);

  const persist = (key: string, value: string | null) => {
    if (applyingRemote || !shouldSyncKey(key) || EXCLUDED_KEYS.has(key)) return;
    const oldTimer = pending.get(key);
    if (oldTimer) clearTimeout(oldTimer);
    const timer = setTimeout(async () => {
      pending.delete(key);
      const encoded = encodeValue(value);
      try {
        if (encoded === null) {
          if (value === null) await deleteDoc(doc(db, ROOT_COLLECTION, uid, STATE_COLLECTION, key));
          return;
        }
        await setDoc(doc(db, ROOT_COLLECTION, uid, STATE_COLLECTION, key), {
          value: encoded,
          updatedAt: new Date(),
        });
      } catch (error) {
        console.warn('[PROFEA Cloud] No se pudo guardar', key, error);
      }
    }, 350);
    pending.set(key, timer);
  };

  localStorage.setItem = ((key: string, value: string) => {
    originalSetItem(key, value);
    persist(key, value);
  }) as Storage['setItem'];

  localStorage.removeItem = ((key: string) => {
    originalRemoveItem(key);
    persist(key, null);
  }) as Storage['removeItem'];

  const unsubscribe = onSnapshot(
    collection(db, ROOT_COLLECTION, uid, STATE_COLLECTION),
    (snapshot) => {
      if (snapshot.empty) return;
      applyingRemote = true;
      try {
        let changed = false;
        snapshot.docChanges().forEach((change) => {
          const key = change.doc.id;
          if (!shouldSyncKey(key) || EXCLUDED_KEYS.has(key)) return;
          const data = change.doc.data();
          if (change.type === 'removed' || data.deleted === true) {
            originalRemoveItem(key);
            changed = true;
          } else if (data.value !== undefined) {
            const nextValue = decodeValue(data.value);
            if (localStorage.getItem(key) !== nextValue) {
              originalSetItem(key, nextValue);
              changed = true;
            }
          }
        });
        if (changed && typeof window !== 'undefined') {
          window.setTimeout(() => window.location.reload(), 100);
        }
      } finally {
        applyingRemote = false;
      }
    },
    (error) => console.warn('[PROFEA Cloud] Listener error:', error)
  );

  return () => {
    unsubscribe();
    for (const timer of pending.values()) clearTimeout(timer);
    localStorage.setItem = originalSetItem as Storage['setItem'];
    localStorage.removeItem = originalRemoveItem as Storage['removeItem'];
  };
}
