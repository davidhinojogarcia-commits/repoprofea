import { collection, doc, getDocs, onSnapshot, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { playNotificationSound } from './uiSounds';

const ROOT_COLLECTION = 'user_data';
const STATE_COLLECTION = 'state';
const MAX_VALUE_BYTES = 900_000;

// Persist application data automatically. Legacy manual-sync metadata is excluded.
const EXCLUDED_KEYS = new Set([
  'personasPROFEA_groupId',
  'personasPROFEA_isSyncing',
  'personasPROFEA_syncMode',
  'personasPROFEA_syncEmail',
  'personasPROFEA_activeWorkspace',
  'personasPROFEA_activeWorkspaceId',
  'personasPROFEA_sessionId',
  'personasPROFEA_lastSyncTime',
  'personasPROFEA_activeUid',
]);

function shouldSyncKey(key: string) {
  return (
    key.startsWith('personasPROFEA') ||
    key.startsWith('profea_') ||
    [
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
    ].includes(key)
  ) && !EXCLUDED_KEYS.has(key);
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

/**
 * Small, framework-independent notification shown whenever a cloud database
 * operation succeeds or fails. It is deliberately rendered here so every
 * module using the automatic persistence layer gets the same feedback.
 */
let notificationTimer: ReturnType<typeof setTimeout> | null = null;
let lastNotificationMessage = '';
let lastNotificationAt = 0;

function showDatabaseNotification(success: boolean, message: string) {
  if (typeof document === 'undefined') return;

  // Avoid flooding the screen when one UI action updates several local keys.
  const now = Date.now();
  if (message === lastNotificationMessage && now - lastNotificationAt < 900) return;
  lastNotificationMessage = message;
  lastNotificationAt = now;

  playNotificationSound();

  const existing = document.getElementById('profea-database-notification');
  existing?.remove();
  if (notificationTimer) clearTimeout(notificationTimer);

  const notification = document.createElement('div');
  notification.id = 'profea-database-notification';
  notification.setAttribute('role', 'status');
  notification.setAttribute('aria-live', 'polite');
  notification.style.cssText = [
    'position:fixed',
    'top:20px',
    'right:20px',
    'z-index:99999',
    'display:flex',
    'align-items:center',
    'gap:10px',
    'max-width:calc(100vw - 40px)',
    'padding:13px 18px',
    'border-radius:12px',
    'font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'font-size:14px',
    'font-weight:600',
    'line-height:1.35',
    'color:#fff',
    `background:${success ? '#16a34a' : '#dc2626'}`,
    `box-shadow:0 10px 25px rgba(0,0,0,.18)`,
    'animation:profeaDbNotificationIn .22s ease-out',
  ].join(';');

  const icon = document.createElement('span');
  icon.textContent = success ? '✓' : '✕';
  icon.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:2px solid rgba(255,255,255,.85);border-radius:50%;font-size:13px;flex:0 0 auto;';

  const text = document.createElement('span');
  text.textContent = message;

  notification.append(icon, text);

  if (!document.getElementById('profea-db-notification-style')) {
    const style = document.createElement('style');
    style.id = 'profea-db-notification-style';
    style.textContent = '@keyframes profeaDbNotificationIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(style);
  }

  document.body.appendChild(notification);
  notificationTimer = setTimeout(() => {
    notification.style.transition = 'opacity .2s ease, transform .2s ease';
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(-8px)';
    setTimeout(() => notification.remove(), 220);
  }, 2600);
}

export async function loadUserCloudState(uid: string): Promise<{ hasCloudData: boolean }> {
  try {
    const snapshot = await getDocs(collection(db, ROOT_COLLECTION, uid, STATE_COLLECTION));
    if (snapshot.empty) return { hasCloudData: false };

    for (const item of snapshot.docs) {
      const key = item.id;
      if (!shouldSyncKey(key)) continue;
      const data = item.data();
      if (data.deleted === true) localStorage.removeItem(key);
      else if (data.value !== undefined) localStorage.setItem(key, decodeValue(data.value));
    }
    return { hasCloudData: true };
  } catch (error) {
    console.warn('[PROFEA Cloud] No se pudieron cargar los datos:', error);
    showDatabaseNotification(false, 'No se han podido cargar los datos de la base de datos');
    throw error;
  }
}

export async function uploadExistingLocalState(uid: string) {
  try {
    const stateRef = collection(db, ROOT_COLLECTION, uid, STATE_COLLECTION);
    const batch = writeBatch(db);
    let count = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !shouldSyncKey(key)) continue;
      const encoded = encodeValue(localStorage.getItem(key));
      if (encoded === null) continue;
      batch.set(doc(stateRef, key), { value: encoded, updatedAt: new Date() });
      count++;
    }

    if (count > 0) {
      await batch.commit();
      showDatabaseNotification(true, 'Datos guardados correctamente en la base de datos');
    }
  } catch (error) {
    console.warn('[PROFEA Cloud] No se pudieron guardar los datos iniciales:', error);
    showDatabaseNotification(false, 'No se han podido guardar los datos en la base de datos');
    throw error;
  }
}

export function startUserCloudSync(uid: string) {
  let applyingRemote = false;
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const originalSetItem = localStorage.setItem.bind(localStorage);
  const originalRemoveItem = localStorage.removeItem.bind(localStorage);

  const persist = (key: string, value: string | null) => {
    if (applyingRemote || !shouldSyncKey(key)) return;
    const oldTimer = pending.get(key);
    if (oldTimer) clearTimeout(oldTimer);

    const timer = setTimeout(async () => {
      pending.delete(key);
      const encoded = encodeValue(value);
      try {
        if (encoded === null) {
          if (value === null) {
            await deleteDoc(doc(db, ROOT_COLLECTION, uid, STATE_COLLECTION, key));
            showDatabaseNotification(true, 'Cambio eliminado correctamente de la base de datos');
          }
          return;
        }
        await setDoc(doc(db, ROOT_COLLECTION, uid, STATE_COLLECTION, key), {
          value: encoded,
          updatedAt: new Date(),
        });
        showDatabaseNotification(true, 'Cambios guardados correctamente en la base de datos');
      } catch (error) {
        console.warn('[PROFEA Cloud] No se pudo guardar', key, error);
        showDatabaseNotification(false, 'No se ha podido guardar el cambio en la base de datos');
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
          if (!shouldSyncKey(key)) return;
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
    (error) => {
      console.warn('[PROFEA Cloud] Listener error:', error);
      showDatabaseNotification(false, 'Error al sincronizar los cambios desde la base de datos');
    }
  );

  return () => {
    unsubscribe();
    for (const timer of pending.values()) clearTimeout(timer);
    localStorage.setItem = originalSetItem as Storage['setItem'];
    localStorage.removeItem = originalRemoveItem as Storage['removeItem'];
  };
}
