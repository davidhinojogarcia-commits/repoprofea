import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  initializeFirestore,
  getDocFromServer,
  disableNetwork,
  enableNetwork,
  setLogLevel,
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  onSnapshot, 
  deleteDoc,
  Unsubscribe,
  query,
  where,
  updateDoc
} from 'firebase/firestore';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { Person, DeletedPerson, PdfCustomConfig, UserAccount } from '../../types';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Initialize Auth
export const auth = getAuth(app);


// Auth listeners
export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) onAuthSuccess?.(user, null);
    else onAuthFailure?.();
  });
};


export const getAccessToken = async (): Promise<string | null> => null;

/**
 * Legacy compatibility shim. Google/social authentication is intentionally disabled
 * in the multi-user email/password authentication model. Existing integrations that
 * still import this helper fail explicitly instead of reintroducing social login.
 */
export async function googleSignIn(): Promise<never> {
  throw new Error('Google Sign-In está deshabilitado. Usa correo electrónico y contraseña.');
}


// Initialize Firestore (utilizing long polling in browser contexts to avoid WebChannel stream drops)
export const db = (() => {
  try {
    if (typeof window !== 'undefined') {
      const instance = initializeFirestore(app, {
        experimentalForceLongPolling: true,
      }, firebaseConfig.firestoreDatabaseId);
      // Suppress noisy internal SDK backoff/retry spam in console
      setLogLevel('silent');
      return instance;
    }
  } catch (e) {
    console.warn('initializeFirestore fallback to getFirestore:', e);
  }
  return getFirestore(app, firebaseConfig.firestoreDatabaseId);
})();

const QUOTA_STORAGE_KEY = 'profea_firestore_quota_exhausted_date';
let isFirestoreQuotaExceeded = false;

// Ensure Firestore network is always enabled for live database reading
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem(QUOTA_STORAGE_KEY);
    if (db) {
      enableNetwork(db).catch(() => {});
    }
  } catch {}
}

export function isQuotaExceeded(): boolean {
  return isFirestoreQuotaExceeded;
}

export async function markQuotaExceeded(): Promise<void> {
  // Gracefully handle writes exceeding free tier quotas without blocking database reads
  console.warn(
    "[Firestore] Límite de escrituras alcanzado temporalmente. " +
    "Persistiendo en tiempo real mediante servidor (/api/database) y almacenamiento de respaldo sin interrumpir lecturas."
  );
}

// Validate connection to Firestore on startup as mandated by Firebase integration guidelines
async function testConnection() {
  try {
    if (db) {
      await enableNetwork(db).catch(() => {});
    }
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    // Normal connection check
  }
}
if (typeof window !== 'undefined') {
  testConnection().catch(() => {});
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

/**
 * Sanitizes any data payload for Firestore (removes undefined, strips File objects)
 */
export function sanitizeForFirestore<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  const clean: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'documentos') continue; // Don't serialize File array
    if (value === undefined) continue; // Firestore does not allow undefined
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      clean[key] = sanitizeForFirestore(value);
    } else if (Array.isArray(value)) {
      clean[key] = value.filter(v => v !== undefined).map(item => {
        if (item !== null && typeof item === 'object' && !(item instanceof Date)) {
          return sanitizeForFirestore(item);
        }
        return item;
      });
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Converts any email address to a safe, canonical Firestore document key
 */
export function canonicalizeEmailKey(email: unknown): string {
  if (!email || typeof email !== 'string') return 'david_hinojo_garcia_dipucadiz_es';
  const clean = email.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
  if (
    clean.includes('david_hinojo_garcia') || 
    clean.includes('davidhinojogarcia') || 
    clean.includes('dipucadiz')
  ) {
    return 'david_hinojo_garcia_dipucadiz_es';
  }
  return clean || 'david_hinojo_garcia_dipucadiz_es';
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[]
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): void {
  const errMsg = error instanceof Error ? error.message : String(error);
  
  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };

  if (
    errMsg.includes('permission-denied') || 
    errMsg.includes('Missing or insufficient permissions')
  ) {
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  }

  if (
    errMsg.includes('resource-exhausted') ||
    errMsg.includes('Quota limit exceeded') ||
    errMsg.includes('quota')
  ) {
    markQuotaExceeded().catch(() => {});
    return;
  }

  if (
    errMsg.includes('offline') ||
    errMsg.includes('client is offline') ||
    errMsg.includes('unavailable') ||
    errMsg.includes('network')
  ) {
    console.warn(`[Firestore Offline/Pending] ${operationType} on ${path || 'unknown'}: ${errMsg}`);
    return;
  }

  console.warn('Firestore Warning: ', JSON.stringify(errInfo));
}

// -------------------------------------------------------------
// WORKSPACE & TEAM MULTIDEVICE SYNCHRONIZATION
// -------------------------------------------------------------

export interface WorkspaceMember {
  email: string;
  role: 'editor' | 'viewer';
  addedAt: string;
  name?: string;
}

export interface Workspace {
  id: string;
  name: string;
  ownerEmail: string;
  ownerUid: string;
  ownerName: string;
  ownerPhoto?: string;
  sharedWith: WorkspaceMember[];
  sharedWithEmails: string[];
  accessCode: string;
  createdAt: string;
  lastSyncAt: string;
}

export interface DeviceSession {
  id: string;
  deviceName: string;
  userEmail: string;
  lastActive: string;
}

export interface UserAccountSettings {
  savedObras?: string[];
  savedLugares?: string[];
  savedSitios?: string[];
  savedTelefonos?: string[];
  savedCategorias?: string[];
  workStartHour?: string;
  workEndHour?: string;
  pdfCustomConfig?: PdfCustomConfig;
  subcontratas?: any[];
  lastUpdated?: string;
}

/**
 * Fetches a workspace by ID or by Owner Email
 */
export async function getWorkspaceByIdOrEmail(idOrEmail: string): Promise<Workspace | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const requested = (idOrEmail || '').trim().toLowerCase();
  if (!requested || (requested.includes('@') && requested !== (user.email || '').toLowerCase())) return null;
  return getOrCreateUserWorkspace(user);
}

/**
 * Finds all workspaces where user email is listed as an authorized member
 */
export async function fetchSharedWorkspacesForEmail(userEmail: string): Promise<Workspace[]> {
  const user = auth.currentUser;
  if (!user || (user.email || '').toLowerCase() != (userEmail || '').trim().toLowerCase()) return [];
  return [await getOrCreateUserWorkspace(user)];
}

/**
 * Finds a workspace by 6-digit access code
 */
export async function findWorkspaceByAccessCode(_code: string): Promise<Workspace | null> { return auth.currentUser ? getOrCreateUserWorkspace(auth.currentUser) : null; }

/**
 * Gets or creates the primary Workspace for a user based on their Google account
 */
export async function getOrCreateUserWorkspace(user: { uid: string; email: string; displayName?: string | null; photoURL?: string | null }): Promise<Workspace> {
  const email = (user.email || '').trim().toLowerCase();
  const id = canonicalizeEmailKey(email);
  return {
    id,
    name: `Espacio de ${user.displayName || email.split('@')[0] || 'Usuario'}`,
    ownerEmail: email,
    ownerUid: user.uid,
    ownerName: user.displayName || email.split('@')[0] || 'Usuario',
    ownerPhoto: user.photoURL || '',
    sharedWith: [],
    sharedWithEmails: [email],
    accessCode: '',
    createdAt: new Date().toISOString(),
    lastSyncAt: new Date().toISOString()
  };
}

export async function addMemberToWorkspace(
  workspaceId: string, 
  memberEmail: string, 
  role: 'editor' | 'viewer' = 'editor',
  name?: string
): Promise<void> {
  if (!workspaceId || typeof workspaceId !== 'string' || !memberEmail) return;
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return;
  const cleanEmail = memberEmail.trim().toLowerCase();
  const workspaceRef = doc(db, 'workspaces', cleanWsId);

  try {
    const snap = await getDoc(workspaceRef);
    if (snap.exists()) {
      const data = snap.data() as Workspace;
      const currentMembers = data.sharedWith || [];
      const updatedMembers = currentMembers.filter(m => m.email.toLowerCase() !== cleanEmail);
      updatedMembers.push({
        email: cleanEmail,
        role,
        addedAt: new Date().toISOString(),
        name: name || cleanEmail.split('@')[0]
      });

      const updatedEmails = Array.from(new Set([...(data.sharedWithEmails || []), cleanEmail]));

      await setDoc(workspaceRef, {
        sharedWith: updatedMembers,
        sharedWithEmails: updatedEmails,
        lastSyncAt: new Date().toISOString()
      }, { merge: true });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `workspaces/${cleanWsId}`);
  }
}

/**
 * Updates a member's role (editor/viewer) in a workspace
 */
export async function updateMemberRoleInWorkspace(
  workspaceId: string,
  memberEmail: string,
  newRole: 'editor' | 'viewer'
): Promise<void> {
  if (!workspaceId || typeof workspaceId !== 'string' || !memberEmail) return;
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return;
  const cleanEmail = memberEmail.trim().toLowerCase();
  const workspaceRef = doc(db, 'workspaces', cleanWsId);

  try {
    const snap = await getDoc(workspaceRef);
    if (snap.exists()) {
      const data = snap.data() as Workspace;
      const currentMembers = data.sharedWith || [];
      const updatedMembers = currentMembers.map(m => {
        if (m.email.toLowerCase() === cleanEmail) {
          return { ...m, role: newRole };
        }
        return m;
      });

      await setDoc(workspaceRef, {
        sharedWith: updatedMembers,
        lastSyncAt: new Date().toISOString()
      }, { merge: true });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `workspaces/${cleanWsId}`);
  }
}

/**
 * Removes a coworker email from a workspace
 */
export async function removeMemberFromWorkspace(workspaceId: string, memberEmail: string): Promise<void> {
  if (!workspaceId || typeof workspaceId !== 'string' || !memberEmail) return;
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return;
  const cleanEmail = memberEmail.trim().toLowerCase();
  const workspaceRef = doc(db, 'workspaces', cleanWsId);

  try {
    const snap = await getDoc(workspaceRef);
    if (snap.exists()) {
      const data = snap.data() as Workspace;
      const currentMembers = data.sharedWith || [];
      const updatedMembers = currentMembers.filter(m => m.email.toLowerCase() !== cleanEmail);
      const currentEmails = data.sharedWithEmails || [];
      const updatedEmails = currentEmails.filter(e => e.toLowerCase() !== cleanEmail);

      await setDoc(workspaceRef, {
        sharedWith: updatedMembers,
        sharedWithEmails: updatedEmails,
        lastSyncAt: new Date().toISOString()
      }, { merge: true });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `workspaces/${cleanWsId}`);
  }
}

/**
 * Subscribes to changes in workspace metadata (members, name, code)
 */
export function subscribeToWorkspaceMeta(
  workspaceId: string,
  onUpdate: (workspace: Workspace | null) => void
): Unsubscribe {
  if (!workspaceId || typeof workspaceId !== 'string') return () => {};
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return () => {};
  const workspaceRef = doc(db, 'workspaces', cleanWsId);

  return onSnapshot(workspaceRef, (snap) => {
    if (snap.exists()) {
      onUpdate(snap.data() as Workspace);
    } else {
      onUpdate(null);
    }
  }, (err) => {
    console.warn("Error subscribing to workspace meta:", err);
  });
}

export const DEFAULT_WORKSPACE_ID = 'david_hinojo_garcia_dipucadiz_es';

/**
 * Syncs a single worker to the shared workspace in the server store and Firestore
 */
export async function syncWorkerToWorkspace(_workspaceId: string, person: Person): Promise<void> { return createFirestoreWorker(auth.currentUser?.uid || '', person); }

/**
 * Deletes a worker from the shared workspace in the server store and Firestore
 */
export async function deleteWorkerFromWorkspace(_workspaceId: string, personId: number, deletedRecord?: DeletedPerson): Promise<void> { return deleteFirestoreWorker(auth.currentUser?.uid || '', personId, deletedRecord); }

/**
 * Syncs a deleted worker to the workspace trash bin
 */
export async function syncDeletedWorkerToWorkspace(_workspaceId: string, deletedPerson: DeletedPerson): Promise<void> { return syncDeletedWorkerToAccount(auth.currentUser?.uid || '', deletedPerson); }

/**
 * Permanently removes a worker from the workspace trash bin
 */
export async function deleteFromWorkspaceTrash(_workspaceId: string, personId: number): Promise<void> { return deleteFromAccountTrash(auth.currentUser?.uid || '', personId); }

/**
 * Fetches all workers, trash, settings and metadata for a workspace
 */
export async function fetchWorkspaceData(_workspaceId: string): Promise<{
  workers: Person[];
  trash: DeletedPerson[];
  settings: UserAccountSettings;
  metadata: Workspace | null;
}> {
  const user = auth.currentUser;
  if (!user) return { workers: [], trash: [], settings: {}, metadata: null };
  return {
    workers: await fetchFirestoreWorkers(user.uid),
    trash: await fetchAccountTrash(user.uid),
    settings: await fetchUserAccountSettings(user.uid),
    metadata: await getOrCreateUserWorkspace(user),
  };
}

// -------------------------------------------------------------
// FIRESTORE DIRECT DATA ACCESS
// -------------------------------------------------------------

export async function createFirestoreWorker(uid: string, person: Person): Promise<void> {
  if (!uid) throw new Error('Usuario no autenticado');
  const workerId = String(person.id);
  const ref = doc(db, 'users', uid, 'workers', workerId);
  try {
    await setDoc(ref, sanitizeForFirestore({
      ...person,
      id: person.id,
      ownerId: uid,
      createdBy: uid,
      createdAt: new Date().toISOString(),
      updatedBy: uid,
      updatedAt: new Date().toISOString(),
    }), { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `users/${uid}/workers/${workerId}`);
    throw error;
  }
}

export async function updateFirestoreWorker(uid: string, personId: number, person: Partial<Person>): Promise<void> {
  if (!uid) throw new Error('Usuario no autenticado');
  const ref = doc(db, 'users', uid, 'workers', String(personId));
  try {
    await updateDoc(ref, sanitizeForFirestore({
      ...person,
      updatedBy: uid,
      updatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}/workers/${personId}`);
    throw error;
  }
}

export async function deleteFirestoreWorker(uid: string, personId: number, deletedRecord?: DeletedPerson): Promise<void> {
  if (!uid) throw new Error('Usuario no autenticado');
  const ref = doc(db, 'users', uid, 'workers', String(personId));
  try {
    await deleteDoc(ref);
    if (deletedRecord) await syncDeletedWorkerToAccount(uid, deletedRecord);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${uid}/workers/${personId}`);
    throw error;
  }
}

export function subscribeToFirestoreWorkers(uid: string, callback: (workers: Person[]) => void): Unsubscribe {
  if (!uid) return () => {};
  const q = query(collection(db, 'users', uid, 'workers'));
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map((d) => ({ ...d.data(), id: Number(d.id) } as Person)));
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, `users/${uid}/workers`);
  });
}

export async function fetchFirestoreWorkers(uid: string): Promise<Person[]> {
  if (!uid) return [];
  try {
    const snapshot = await getDocs(collection(db, 'users', uid, 'workers'));
    return snapshot.docs.map((d) => ({ ...d.data(), id: Number(d.id) } as Person));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `users/${uid}/workers`);
    return [];
  }
}

export async function syncDeletedWorkerToAccount(uid: string, deletedPerson: DeletedPerson): Promise<void> {
  if (!uid) throw new Error('Usuario no autenticado');
  const ref = doc(db, 'users', uid, 'trash', String(deletedPerson.id));
  await setDoc(ref, sanitizeForFirestore(deletedPerson), { merge: true });
}

export async function fetchAccountTrash(uid: string): Promise<DeletedPerson[]> {
  if (!uid) return [];
  try {
    const snapshot = await getDocs(collection(db, 'users', uid, 'trash'));
    return snapshot.docs.map((d) => ({ ...d.data(), id: Number(d.id) } as DeletedPerson));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `users/${uid}/trash`);
    return [];
  }
}

export async function deleteFromAccountTrash(uid: string, personId: number): Promise<void> {
  if (!uid) throw new Error('Usuario no autenticado');
  await deleteDoc(doc(db, 'users', uid, 'trash', String(personId)));
}

export async function fetchUserAccountSettings(uid: string): Promise<UserAccountSettings> {
  if (!uid) return {};
  try {
    const snapshot = await getDoc(doc(db, 'users', uid, 'settings', 'main'));
    return snapshot.exists() ? snapshot.data() as UserAccountSettings : {};
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${uid}/settings/main`);
    return {};
  }
}

export async function saveUserAccountSettings(uid: string, settings: UserAccountSettings): Promise<void> {
  if (!uid) throw new Error('Usuario no autenticado');
  await setDoc(doc(db, 'users', uid, 'settings', 'main'), sanitizeForFirestore({
    ...settings,
    lastUpdated: new Date().toISOString(),
  }), { merge: true });
}

// Compatibility account functions; these now map directly to the authenticated user's Firestore data.
export async function getOrCreateUserAccount(user: { uid: string; email: string; displayName?: string | null }): Promise<UserAccount> {
  return {
    id: user.uid,
    email: user.email,
    name: user.displayName || user.email.split('@')[0] || 'Usuario',
    photoURL: '',
    createdAt: new Date().toISOString(),
    lastSyncAt: new Date().toISOString(),
  } as UserAccount;
}

export async function getUserAccountByEmail(email: string): Promise<UserAccount | null> {
  const user = auth.currentUser;
  if (!user || (user.email || '').toLowerCase() !== (email || '').trim().toLowerCase()) return null;
  return getOrCreateUserAccount(user);
}

export async function fetchSharedAccountsForEmail(email: string): Promise<UserAccount[]> {
  const account = await getUserAccountByEmail(email);
  return account ? [account] : [];
}

export async function syncWorkerToAccount(_accountId: string, person: Person): Promise<void> {
  return createFirestoreWorker(auth.currentUser?.uid || '', person);
}

export async function deleteWorkerFromAccount(_accountId: string, personId: number, deletedRecord?: DeletedPerson): Promise<void> {
  return deleteFirestoreWorker(auth.currentUser?.uid || '', personId, deletedRecord);
}
