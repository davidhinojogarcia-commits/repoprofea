import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  User
} from 'firebase/auth';
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
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      // Save or update user profile in Firestore
      saveUserProfile(user).catch(err => console.warn('Could not auto-save user profile:', err));
      if (onAuthSuccess) {
        onAuthSuccess(user, cachedAccessToken);
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) {
        onAuthFailure();
      }
    }
  });
};

export async function emailPasswordSignIn(email: string, password: string) {
  const result = await signInWithEmailAndPassword(auth, email.trim(), password);
  await saveUserProfile(result.user);
  return result.user;
}

export async function registerEmailPassword(email: string, password: string, displayName?: string) {
  const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName?.trim()) await updateProfile(result.user, { displayName: displayName.trim() });
  await saveUserProfile(result.user);
  return result.user;
}

export async function resetEmailPassword(email: string) {
  return sendPasswordResetEmail(auth, email.trim());
}

// Compatibility exports kept only so legacy UI code compiles. No Google provider exists.
export async function emailPasswordSignIn(email: string, password: string) {
  const result = await signInWithEmailAndPassword(auth, email.trim(), password);
  await saveUserProfile(result.user);
  return result.user;
}

export async function registerEmailPassword(email: string, password: string, displayName?: string) {
  const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName?.trim()) await updateProfile(result.user, { displayName: displayName.trim() });
  await saveUserProfile(result.user);
  return result.user;
}

export async function resetEmailPassword(email: string) {
  return sendPasswordResetEmail(auth, email.trim());
}

// Compatibility exports kept only so legacy UI code compiles. No Google provider exists.
export async function emailPasswordSignIn(email: string, password: string) {
  const result = await signInWithEmailAndPassword(auth, email.trim(), password);
  await saveUserProfile(result.user);
  return result.user;
}

export async function registerEmailPassword(email: string, password: string, displayName?: string) {
  const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName?.trim()) await updateProfile(result.user, { displayName: displayName.trim() });
  await saveUserProfile(result.user);
  return result.user;
}

export async function resetEmailPassword(email: string) {
  return sendPasswordResetEmail(auth, email.trim());
}

// Compatibility exports kept only so legacy UI code compiles. No Google provider exists.
export async function emailPasswordSignIn(email: string, password: string) {
  const result = await signInWithEmailAndPassword(auth, email.trim(), password);
  await saveUserProfile(result.user);
  return result.user;
}

export async function registerEmailPassword(email: string, password: string, displayName?: string) {
  const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName?.trim()) await updateProfile(result.user, { displayName: displayName.trim() });
  await saveUserProfile(result.user);
  return result.user;
}

export async function resetEmailPassword(email: string) {
  return sendPasswordResetEmail(auth, email.trim());
}

// Compatibility exports kept only so legacy UI code compiles. No Google provider exists.
export const googleSignIn = async () => {
  throw new Error('Google Sign-In está deshabilitado. Usa correo electrónico y contraseña.');
};

export const getAccessToken = async (): Promise<string | null> => null;

export const logoutGoogle = async () => {
  await auth.signOut();
};

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

let isFirestoreQuotaExceeded = false;

// Ensure Firestore network is always enabled for live database reading
if (typeof window !== 'undefined') {
  try {
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
    }[];
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
  if (!idOrEmail || typeof idOrEmail !== 'string') return null;
  const trimmed = idOrEmail.trim();
  if (!trimmed) return null;
  const cleanKey = trimmed.includes('@') ? canonicalizeEmailKey(trimmed) : trimmed;
  const workspaceRef = doc(db, 'workspaces', cleanKey);
  try {
    const snap = await getDoc(workspaceRef);
    if (snap.exists()) {
      return snap.data() as Workspace;
    }
    return null;
  } catch (error) {
    console.warn("Could not fetch workspace:", error);
    return null;
  }
}

/**
 * Finds all workspaces where user email is listed as an authorized member
 */
export async function fetchSharedWorkspacesForEmail(userEmail: string): Promise<Workspace[]> {
  if (!userEmail) return [];
  const cleanEmail = userEmail.trim().toLowerCase();
  const workspacesRef = collection(db, 'workspaces');
  try {
    const snap = await getDocs(workspacesRef);
    const results: Workspace[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as Workspace;
      if (
        data.ownerEmail?.toLowerCase() === cleanEmail ||
        data.sharedWithEmails?.some(e => e.toLowerCase() === cleanEmail) ||
        data.sharedWith?.some(m => m.email?.toLowerCase() === cleanEmail)
      ) {
        results.push(data);
      }
    });
    return results;
  } catch (error) {
    console.warn("Error fetching shared workspaces for email:", error);
    return [];
  }
}

/**
 * Finds a workspace by 6-digit access code
 */
export async function findWorkspaceByAccessCode(code: string): Promise<Workspace | null> {
  if (!code || code.trim().length < 4) return null;
  const cleanCode = code.trim();
  const workspacesRef = collection(db, 'workspaces');
  try {
    const snap = await getDocs(workspacesRef);
    let matched: Workspace | null = null;
    snap.forEach((docSnap) => {
      const data = docSnap.data() as Workspace;
      if (data.accessCode === cleanCode) {
        matched = data;
      }
    });
    return matched;
  } catch (error) {
    console.warn("Error finding workspace by code:", error);
    return null;
  }
}

/**
 * Gets or creates the primary Workspace for a user based on their Google account
 */
export async function getOrCreateUserWorkspace(user: {
  uid: string;
  email: string;
  displayName?: string | null;
  photoURL?: string | null;
}): Promise<Workspace> {
  const workspaceId = canonicalizeEmailKey(user.email);
  const workspaceRef = doc(db, 'workspaces', workspaceId);

  try {
    const snap = await getDoc(workspaceRef);
    if (snap.exists()) {
      const data = snap.data() as Workspace;
      // Ensure sharedWith arrays exist
      return {
        ...data,
        sharedWith: data.sharedWith || [],
        sharedWithEmails: data.sharedWithEmails || [user.email.toLowerCase()]
      };
    } else {
      const newWorkspace: Workspace = {
        id: workspaceId,
        name: `Espacio de ${user.displayName || user.email.split('@')[0]}`,
        ownerEmail: user.email.toLowerCase(),
        ownerUid: user.uid,
        ownerName: user.displayName || user.email.split('@')[0] || 'Usuario',
        ownerPhoto: user.photoURL || '',
        sharedWith: [],
        sharedWithEmails: [user.email.toLowerCase()],
        accessCode: Math.floor(100000 + Math.random() * 900000).toString(),
        createdAt: new Date().toISOString(),
        lastSyncAt: new Date().toISOString()
      };
      await setDoc(workspaceRef, newWorkspace);
      return newWorkspace;
    }
  } catch (error) {
    console.warn("Workspace offline or not reachable, using local fallback:", error);
    // Return fallback workspace
    return {
      id: workspaceId,
      name: `Espacio de ${user.displayName || user.email.split('@')[0]}`,
      ownerEmail: user.email.toLowerCase(),
      ownerUid: user.uid,
      ownerName: user.displayName || user.email.split('@')[0] || 'Usuario',
      ownerPhoto: user.photoURL || '',
      sharedWith: [],
      sharedWithEmails: [user.email.toLowerCase()],
      accessCode: '123456',
      createdAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString()
    };
  }
}

/**
 * Adds an authorized coworker email to a workspace
 */
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
export async function syncWorkerToWorkspace(workspaceId: string, person: Person): Promise<void> {
  const cleanWsId = (workspaceId || DEFAULT_WORKSPACE_ID).trim();
  if (!cleanWsId || !person?.id) return;
  const sanitized = sanitizeForFirestore(person);

  // 1. Instantly persist to full-stack server database (shares instantly with all devices)
  try {
    await fetch('/api/database/save-worker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: cleanWsId, worker: sanitized })
    });
  } catch (err) {
    console.warn("Could not post worker to /api/database/save-worker:", err);
  }

  // 2. Also update Firestore if quota is available
  if (isFirestoreQuotaExceeded) return;
  try {
    const workerRef = doc(db, 'workspaces', cleanWsId, 'workers', String(person.id));
    await setDoc(workerRef, {
      ...sanitized,
      _lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `workspaces/${cleanWsId}/workers/${person.id}`);
  }
}

/**
 * Deletes a worker from the shared workspace in the server store and Firestore
 */
export async function deleteWorkerFromWorkspace(workspaceId: string, personId: number, deletedRecord?: DeletedPerson): Promise<void> {
  const cleanWsId = (workspaceId || DEFAULT_WORKSPACE_ID).trim();
  if (!cleanWsId || !personId) return;

  // 1. Server database
  try {
    await fetch('/api/database/delete-worker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: cleanWsId, workerId: personId, deletedRecord })
    });
  } catch (err) {
    console.warn("Could not post delete to /api/database/delete-worker:", err);
  }

  // 2. Firestore
  if (isFirestoreQuotaExceeded) return;
  try {
    const workerRef = doc(db, 'workspaces', cleanWsId, 'workers', String(personId));
    await deleteDoc(workerRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `workspaces/${cleanWsId}/workers/${personId}`);
  }
}

/**
 * Syncs a deleted worker to the workspace trash bin
 */
export async function syncDeletedWorkerToWorkspace(workspaceId: string, deletedPerson: DeletedPerson): Promise<void> {
  const cleanWsId = (workspaceId || DEFAULT_WORKSPACE_ID).trim();
  if (!cleanWsId || !deletedPerson?.person?.id) return;

  // 1. Server database
  try {
    await fetch('/api/database/delete-worker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: cleanWsId, workerId: deletedPerson.person.id, deletedRecord: deletedPerson })
    });
  } catch (err) {
    console.warn("Could not sync deleted worker to server database:", err);
  }

  // 2. Firestore
  if (isFirestoreQuotaExceeded) return;
  try {
    const trashRef = doc(db, 'workspaces', cleanWsId, 'trash', String(deletedPerson.person.id));
    const sanitizedPerson = sanitizeForFirestore(deletedPerson.person);
    await setDoc(trashRef, {
      person: sanitizedPerson,
      fechaEliminacion: deletedPerson.fechaEliminacion || new Date().toISOString(),
      _lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `workspaces/${cleanWsId}/trash/${deletedPerson.person.id}`);
  }
}

/**
 * Permanently removes a worker from the workspace trash bin
 */
export async function deleteFromWorkspaceTrash(workspaceId: string, personId: number): Promise<void> {
  const cleanWsId = (workspaceId || DEFAULT_WORKSPACE_ID).trim();
  if (!cleanWsId || !personId) return;

  if (isFirestoreQuotaExceeded) return;
  try {
    const trashRef = doc(db, 'workspaces', cleanWsId, 'trash', String(personId));
    await deleteDoc(trashRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `workspaces/${cleanWsId}/trash/${personId}`);
  }
}

/**
 * Fetches all workers, trash, settings and metadata for a workspace
 */
export async function fetchWorkspaceData(workspaceId: string): Promise<{ 
  workers: Person[]; 
  trash: DeletedPerson[]; 
  settings: UserAccountSettings | null;
  workspace: Workspace | null;
}> {
  const cleanWsId = (workspaceId || DEFAULT_WORKSPACE_ID).trim();

  // 1. Try local server database first (guarantees cross-device data immediately)
  try {
    const res = await fetch(`/api/database/workspace/${encodeURIComponent(cleanWsId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && Array.isArray(data.workers) && data.workers.length > 0) {
        return {
          workers: data.workers,
          trash: data.deletedPeople || [],
          settings: data.settings || null,
          workspace: null
        };
      }
    }
  } catch (err) {
    console.warn("Could not fetch workspace from server endpoint, falling back to Firestore:", err);
  }

  // 2. Fallback to Firestore
  let workspace: Workspace | null = null;
  try {
    const wsSnap = await getDoc(doc(db, 'workspaces', cleanWsId));
    if (wsSnap.exists()) {
      workspace = wsSnap.data() as Workspace;
    }
  } catch (e) {
    console.warn("Could not fetch workspace metadata:", e);
  }

  const workers: Person[] = [];
  try {
    const workersRef = collection(db, 'users', auth.currentUser!.uid, 'workers');
    const workersSnap = await getDocs(workersRef);
    workersSnap.forEach(docSnap => {
      const data = docSnap.data();
      delete data._lastUpdated;
      workers.push(data as Person);
    });
  } catch (error) {
    console.warn(`Could not fetch workspace workers (workspaces/${cleanWsId}/workers):`, error);
  }

  const trash: DeletedPerson[] = [];
  try {
    const trashRef = collection(db, 'users', auth.currentUser!.uid, 'trash');
    const trashSnap = await getDocs(trashRef);
    trashSnap.forEach(docSnap => {
      const data = docSnap.data();
      delete data._lastUpdated;
      trash.push(data as DeletedPerson);
    });
  } catch (error) {
    console.warn(`Could not fetch workspace trash (workspaces/${cleanWsId}/trash):`, error);
  }

  let settings: UserAccountSettings | null = null;
  try {
    const settingsDoc = await getDoc(doc(db, 'users', auth.currentUser!.uid, 'settings', 'app_config'));
    if (settingsDoc.exists()) {
      settings = settingsDoc.data() as UserAccountSettings;
    }
  } catch (e) {
    console.warn("Could not fetch workspace settings:", e);
  }

  return { workers, trash, settings, workspace };
}

/**
 * Triggers a comprehensive live sync and reload from Firebase Firestore database.
 * Pulls all workers, trash, and settings across all Firestore collections.
 */
export async function triggerFirestoreDatabaseSync(workspaceId?: string): Promise<{
  workers: Person[];
  trash: DeletedPerson[];
  settings: UserAccountSettings | null;
  count: number;
}> {
  const cleanWsId = (workspaceId || DEFAULT_WORKSPACE_ID).trim();
  try {
    const res = await fetch(`/api/database/sync-from-firestore/${encodeURIComponent(cleanWsId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: cleanWsId })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && Array.isArray(data.workers)) {
        return {
          workers: data.workers,
          trash: data.trash || [],
          settings: data.settings || null,
          count: data.workersCount || data.workers.length
        };
      }
    }
  } catch (err) {
    console.warn("Error calling /api/database/sync-from-firestore:", err);
  }

  // Fallback to direct workspace fetch
  const fallback = await fetchWorkspaceData(cleanWsId);
  return {
    workers: fallback.workers,
    trash: fallback.trash,
    settings: fallback.settings,
    count: fallback.workers.length
  };
}

/**
 * Subscribes to real-time changes in workers for a workspace (using both server polling and Firestore onSnapshot)
 */
export function subscribeToWorkspaceWorkers(
  workspaceId: string, 
  onUpdate: (workers: Person[]) => void,
  onError?: (err: any) => void
): Unsubscribe {
  const cleanWsId = (workspaceId || DEFAULT_WORKSPACE_ID).trim();
  let isUnsubscribed = false;
  let lastServerUpdated = '';

  // Polling server endpoint for instant multi-device sync
  const pollServer = async () => {
    if (isUnsubscribed) return;
    try {
      const url = `/api/database/poll/${encodeURIComponent(cleanWsId)}${lastServerUpdated ? `?since=${encodeURIComponent(lastServerUpdated)}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.hasChanged && Array.isArray(data.workers)) {
          lastServerUpdated = data.lastUpdated || new Date().toISOString();
          onUpdate(data.workers);
        }
      }
    } catch {
      // ignore transient network errors
    }
  };

  // Initial poll
  pollServer();
  const pollTimer = setInterval(pollServer, 3000);

  // Also hook Firestore snapshot
  let unsubFirestore: Unsubscribe = () => {};
  try {
    const workersRef = collection(db, 'users', auth.currentUser!.uid, 'workers');
    unsubFirestore = onSnapshot(workersRef, (snapshot) => {
      const workers: Person[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        delete data._lastUpdated;
        workers.push(data as Person);
      });
      if (workers.length > 0) {
        onUpdate(workers);
      }
    }, (error) => {
      console.warn("Firestore workers listener warning:", error);
      if (onError) onError(error);
    });
  } catch (err) {
    console.warn("Error setting up Firestore worker listener:", err);
  }

  return () => {
    isUnsubscribed = true;
    clearInterval(pollTimer);
    try {
      unsubFirestore();
    } catch {}
  };
}

/**
 * Subscribes to real-time changes in trash for a workspace
 */
export function subscribeToWorkspaceTrash(
  workspaceId: string, 
  onUpdate: (trash: DeletedPerson[]) => void,
  onError?: (err: any) => void
): Unsubscribe {
  const cleanWsId = (workspaceId || DEFAULT_WORKSPACE_ID).trim();
  if (!cleanWsId) return () => {};
  const trashRef = collection(db, 'users', auth.currentUser!.uid, 'trash');

  return onSnapshot(trashRef, (snapshot) => {
    const trash: DeletedPerson[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      delete data._lastUpdated;
      trash.push(data as DeletedPerson);
    });
    onUpdate(trash);
  }, (error) => {
    console.warn("Error subscribing to workspace trash:", error);
    if (onError) onError(error);
  });
}

/**
 * Saves custom catalogs/settings to the workspace in server store and Firestore
 */
export async function syncWorkspaceSettings(workspaceId: string, settings: UserAccountSettings): Promise<void> {
  const cleanWsId = (workspaceId || DEFAULT_WORKSPACE_ID).trim();
  if (!cleanWsId) return;
  const sanitized = sanitizeForFirestore(settings);

  // 1. Server database
  try {
    await fetch('/api/database/save-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: cleanWsId, settings: sanitized })
    });
  } catch (err) {
    console.warn("Could not post settings to server store:", err);
  }

  // 2. Firestore
  if (isFirestoreQuotaExceeded) return;
  try {
    const settingsRef = doc(db, 'users', auth.currentUser!.uid, 'settings', 'app_config');
    await setDoc(settingsRef, {
      ...sanitized,
      lastUpdated: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `workspaces/${cleanWsId}/settings/app_config`);
  }
}

/**
 * Subscribes to real-time changes of workspace settings/catalogs
 */
export function subscribeToWorkspaceSettings(
  workspaceId: string,
  onUpdate: (settings: UserAccountSettings) => void
): Unsubscribe {
  const cleanWsId = (workspaceId || DEFAULT_WORKSPACE_ID).trim();
  let isUnsubscribed = false;
  let lastServerUpdated = '';

  const pollServer = async () => {
    if (isUnsubscribed) return;
    try {
      const url = `/api/database/poll/${encodeURIComponent(cleanWsId)}${lastServerUpdated ? `?since=${encodeURIComponent(lastServerUpdated)}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.hasChanged && data.settings) {
          lastServerUpdated = data.lastUpdated || new Date().toISOString();
          onUpdate(data.settings as UserAccountSettings);
        }
      }
    } catch {
      // ignore
    }
  };

  const pollTimer = setInterval(pollServer, 4000);

  let unsubFirestore: Unsubscribe = () => {};
  try {
    const settingsRef = doc(db, 'users', auth.currentUser!.uid, 'settings', 'app_config');
    unsubFirestore = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        onUpdate(docSnap.data() as UserAccountSettings);
      }
    }, (error) => {
      console.warn("Firestore settings listener warning:", error);
    });
  } catch (err) {
    console.warn("Error setting up Firestore settings listener:", err);
  }

  return () => {
    isUnsubscribed = true;
    clearInterval(pollTimer);
    try {
      unsubFirestore();
    } catch {}
  };
}

/**
 * Registers an active device session under a workspace
 */
export async function registerWorkspaceSession(
  workspaceId: string, 
  userEmail: string = '', 
  customSessionId?: string
): Promise<string> {
  if (!workspaceId || typeof workspaceId !== 'string') return '';
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return '';
  const sessionId = customSessionId || `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  if (isFirestoreQuotaExceeded) return sessionId;

  const sessionRef = doc(db, 'workspaces', cleanWsId, 'sessions', sessionId);

  const sessionData: DeviceSession = {
    id: sessionId,
    deviceName: getFriendlyDeviceName(),
    userEmail: userEmail || auth.currentUser?.email || 'Usuario',
    lastActive: new Date().toISOString()
  };

  try {
    await setDoc(sessionRef, sessionData);
    return sessionId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `workspaces/${cleanWsId}/sessions/${sessionId}`);
    return sessionId;
  }
}

/**
 * Unregisters an active device session from a workspace
 */
export async function unregisterWorkspaceSession(workspaceId: string, sessionId: string): Promise<void> {
  if (!workspaceId || typeof workspaceId !== 'string' || !sessionId || isFirestoreQuotaExceeded) return;
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return;
  const sessionRef = doc(db, 'workspaces', cleanWsId, 'sessions', sessionId);
  try {
    await deleteDoc(sessionRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `workspaces/${cleanWsId}/sessions/${sessionId}`);
  }
}

/**
 * Subscribes to real-time session list for the workspace
 */
export function subscribeToWorkspaceSessions(
  workspaceId: string, 
  onUpdate: (sessions: DeviceSession[]) => void
): Unsubscribe {
  if (!workspaceId) return () => {};
  const sessionsRef = collection(db, 'users', auth.currentUser!.uid, 'sessions');

  return onSnapshot(sessionsRef, (snapshot) => {
    const sessions: DeviceSession[] = [];
    snapshot.forEach((docSnap) => {
      sessions.push(docSnap.data() as DeviceSession);
    });
    onUpdate(sessions);
  }, (error) => {
    console.warn("Error subscribing to workspace sessions:", error);
  });
}

// -------------------------------------------------------------
// USER ACCOUNT-BASED SYNCHRONIZATION (MULTIDEVICE)
// -------------------------------------------------------------

/**
 * Save user profile in /users/{userId}
 */
export async function saveUserProfile(user: User): Promise<void> {
  if (!user.uid) return;
  const userRef = doc(db, 'users', user.uid);
  try {
    await setDoc(userRef, {
      userId: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      lastSyncAt: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    console.warn("Error saving user profile to Firestore:", error);
  }
}

/**
 * Syncs a single worker to the user's account in Firestore
 */
export async function syncWorkerToAccount(userId: string, person: Person): Promise<void> {
  if (!userId || !person?.id) return;
  const workerRef = doc(db, 'users', userId, 'workers', String(person.id));
  const sanitized = sanitizeForFirestore(person);

  try {
    await setDoc(workerRef, {
      ...sanitized,
      _lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${userId}/workers/${person.id}`);
  }
}

/**
 * Deletes a worker from the user's account in Firestore
 */
export async function deleteWorkerFromAccount(userId: string, personId: number): Promise<void> {
  if (!userId || !personId) return;
  const workerRef = doc(db, 'users', userId, 'workers', String(personId));
  try {
    await deleteDoc(workerRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${userId}/workers/${personId}`);
  }
}

/**
 * Syncs a deleted worker to the user's account trash bin in Firestore
 */
export async function syncDeletedWorkerToAccount(userId: string, deletedPerson: DeletedPerson): Promise<void> {
  if (!userId || !deletedPerson?.person?.id) return;
  const trashRef = doc(db, 'users', userId, 'trash', String(deletedPerson.person.id));
  const sanitizedPerson = sanitizeForFirestore(deletedPerson.person);

  try {
    await setDoc(trashRef, {
      person: sanitizedPerson,
      fechaEliminacion: deletedPerson.fechaEliminacion || new Date().toISOString(),
      _lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${userId}/trash/${deletedPerson.person.id}`);
  }
}

/**
 * Permanently removes a worker from the trash bin in the user's account
 */
export async function deleteFromAccountTrash(userId: string, personId: number): Promise<void> {
  if (!userId || !personId) return;
  const trashRef = doc(db, 'users', userId, 'trash', String(personId));
  try {
    await deleteDoc(trashRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${userId}/trash/${personId}`);
  }
}

/**
 * Fetches all workers, trash, and settings from the user account in Firestore
 */
export async function fetchAccountData(userId: string): Promise<{ 
  workers: Person[]; 
  trash: DeletedPerson[]; 
  settings: UserAccountSettings | null 
}> {
  if (!userId) return { workers: [], trash: [], settings: null };

  // 1. Workers
  const workers: Person[] = [];
  try {
    const workersRef = collection(db, 'users', userId, 'workers');
    const workersSnap = await getDocs(workersRef);
    workersSnap.forEach(docSnap => {
      const data = docSnap.data();
      delete data._lastUpdated;
      workers.push(data as Person);
    });
  } catch (error) {
    console.warn(`Could not fetch account workers (users/${userId}/workers):`, error);
  }

  // 2. Trash
  const trash: DeletedPerson[] = [];
  try {
    const trashRef = collection(db, 'users', userId, 'trash');
    const trashSnap = await getDocs(trashRef);
    trashSnap.forEach(docSnap => {
      const data = docSnap.data();
      delete data._lastUpdated;
      trash.push(data as DeletedPerson);
    });
  } catch (error) {
    console.warn(`Could not fetch account trash (users/${userId}/trash):`, error);
  }

  // 3. Settings
  let settings: UserAccountSettings | null = null;
  try {
    const settingsDoc = await getDoc(doc(db, 'users', userId, 'settings', 'app_config'));
    if (settingsDoc.exists()) {
      settings = settingsDoc.data() as UserAccountSettings;
    }
  } catch (e) {
    console.warn("Could not fetch user settings:", e);
  }

  return { workers, trash, settings };
}

/**
 * Subscribes to real-time changes in workers for the user account
 */
export function subscribeToAccountWorkers(
  userId: string, 
  onUpdate: (workers: Person[]) => void,
  onError?: (err: any) => void
): Unsubscribe {
  if (!userId) return () => {};
  const workersRef = collection(db, 'users', userId, 'workers');

  return onSnapshot(workersRef, (snapshot) => {
    const workers: Person[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      delete data._lastUpdated;
      workers.push(data as Person);
    });
    onUpdate(workers);
  }, (error) => {
    console.error("Error subscribing to account workers:", error);
    if (onError) onError(error);
  });
}

/**
 * Subscribes to real-time changes in trash for the user account
 */
export function subscribeToAccountTrash(
  userId: string, 
  onUpdate: (trash: DeletedPerson[]) => void,
  onError?: (err: any) => void
): Unsubscribe {
  if (!userId) return () => {};
  const trashRef = collection(db, 'users', userId, 'trash');

  return onSnapshot(trashRef, (snapshot) => {
    const trash: DeletedPerson[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      delete data._lastUpdated;
      trash.push(data as DeletedPerson);
    });
    onUpdate(trash);
  }, (error) => {
    console.error("Error subscribing to account trash:", error);
    if (onError) onError(error);
  });
}

/**
 * Saves custom catalogs/settings to the user account in Firestore
 */
export async function syncAccountSettings(userId: string, settings: UserAccountSettings): Promise<void> {
  if (!userId) return;
  const settingsRef = doc(db, 'users', userId, 'settings', 'app_config');
  const sanitized = sanitizeForFirestore(settings);
  try {
    await setDoc(settingsRef, {
      ...sanitized,
      lastUpdated: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    console.warn("Error saving account settings to Firestore:", error);
  }
}

/**
 * Subscribes to real-time changes of user settings/catalogs
 */
export function subscribeToAccountSettings(
  userId: string,
  onUpdate: (settings: UserAccountSettings) => void
): Unsubscribe {
  if (!userId) return () => {};
  const settingsRef = doc(db, 'users', userId, 'settings', 'app_config');

  return onSnapshot(settingsRef, (docSnap) => {
    if (docSnap.exists()) {
      onUpdate(docSnap.data() as UserAccountSettings);
    }
  }, (error) => {
    console.warn("Error subscribing to account settings:", error);
  });
}

/**
 * Gets a friendly device name based on User-Agent
 */
export function getFriendlyDeviceName(): string {
  if (typeof window === 'undefined' || !navigator) return 'Navegador Web';
  const ua = navigator.userAgent;
  let browser = 'Navegador';
  let os = 'Dispositivo';

  if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('SamsungBrowser')) browser = 'Samsung Browser';
  else if (ua.includes('Opera') || ua.includes('OPR')) browser = 'Opera';
  else if (ua.includes('Edge') || ua.includes('Edg')) browser = 'Microsoft Edge';
  else if (ua.includes('Chrome')) browser = 'Google Chrome';
  else if (ua.includes('Safari')) browser = 'Safari';

  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Macintosh')) os = 'macOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS (Apple)';
  else if (ua.includes('Linux')) os = 'Linux';

  return `${browser} · ${os}`;
}

/**
 * Registers an active device session under the user's account
 */
export async function registerAccountSession(
  userId: string, 
  userEmail: string = '', 
  customSessionId?: string
): Promise<string> {
  if (!userId) return '';
  const sessionId = customSessionId || `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const sessionRef = doc(db, 'users', userId, 'sessions', sessionId);

  const sessionData: DeviceSession = {
    id: sessionId,
    deviceName: getFriendlyDeviceName(),
    userEmail: userEmail || auth.currentUser?.email || 'Usuario',
    lastActive: new Date().toISOString()
  };

  try {
    await setDoc(sessionRef, sessionData);
    return sessionId;
  } catch (error) {
    console.warn("Could not register account session:", error);
    return sessionId;
  }
}

/**
 * Unregisters an active device session
 */
export async function unregisterAccountSession(userId: string, sessionId: string): Promise<void> {
  if (!userId || !sessionId) return;
  const sessionRef = doc(db, 'users', userId, 'sessions', sessionId);
  try {
    await deleteDoc(sessionRef);
  } catch (error) {
    console.warn("Could not unregister account session:", error);
  }
}

/**
 * Subscribes to real-time session list for the user account
 */
export function subscribeToAccountSessions(
  userId: string, 
  onUpdate: (sessions: DeviceSession[]) => void
): Unsubscribe {
  if (!userId) return () => {};
  const sessionsRef = collection(db, 'users', userId, 'sessions');

  return onSnapshot(sessionsRef, (snapshot) => {
    const sessions: DeviceSession[] = [];
    snapshot.forEach((docSnap) => {
      sessions.push(docSnap.data() as DeviceSession);
    });
    onUpdate(sessions);
  }, (error) => {
    console.warn("Error subscribing to account sessions:", error);
  });
}

// -------------------------------------------------------------
// LEGACY COMPATIBILITY HELPERS (To avoid breaking any old refs)
// -------------------------------------------------------------
const GROUP_COLLECTION = 'sync_groups';

export interface SyncGroup {
  id: string;
  name: string;
  createdAt: string;
  lastSyncAt: string;
}

export async function getOrCreateSyncGroup(groupId: string, groupName: string = 'Grupo General'): Promise<SyncGroup> {
  const cleanId = groupId.trim().toUpperCase();
  const groupRef = doc(db, GROUP_COLLECTION, cleanId);
  try {
    const snap = await getDoc(groupRef);
    if (snap.exists()) {
      return snap.data() as SyncGroup;
    } else {
      const newGroup: SyncGroup = {
        id: cleanId,
        name: groupName,
        createdAt: new Date().toISOString(),
        lastSyncAt: new Date().toISOString()
      };
      await setDoc(groupRef, newGroup);
      return newGroup;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${GROUP_COLLECTION}/${cleanId}`);
    return {
      id: cleanId,
      name: groupName,
      createdAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString()
    };
  }
}

export async function syncWorkerToCloud(groupId: string, person: Person): Promise<void> {
  if (auth.currentUser?.uid) {
    return syncWorkerToAccount(auth.currentUser.uid, person);
  }
  const cleanGroupId = groupId.trim().toUpperCase();
  const workerRef = doc(db, GROUP_COLLECTION, cleanGroupId, 'workers', String(person.id));
  const cleanPerson = { ...person };
  if (cleanPerson.documentos) delete cleanPerson.documentos;
  await setDoc(workerRef, { ...cleanPerson, _lastUpdated: new Date().toISOString() });
}

export async function deleteWorkerFromCloud(groupId: string, personId: number): Promise<void> {
  if (auth.currentUser?.uid) {
    return deleteWorkerFromAccount(auth.currentUser.uid, personId);
  }
  const cleanGroupId = groupId.trim().toUpperCase();
  const workerRef = doc(db, GROUP_COLLECTION, cleanGroupId, 'workers', String(personId));
  await deleteDoc(workerRef);
}

export async function syncDeletedWorkerToCloud(groupId: string, deletedPerson: DeletedPerson): Promise<void> {
  if (auth.currentUser?.uid) {
    return syncDeletedWorkerToAccount(auth.currentUser.uid, deletedPerson);
  }
  const cleanGroupId = groupId.trim().toUpperCase();
  const trashRef = doc(db, GROUP_COLLECTION, cleanGroupId, 'trash', String(deletedPerson.person.id));
  const cleanPerson = { ...deletedPerson.person };
  if (cleanPerson.documentos) delete cleanPerson.documentos;
  await setDoc(trashRef, {
    person: cleanPerson,
    fechaEliminacion: deletedPerson.fechaEliminacion,
    _lastUpdated: new Date().toISOString()
  });
}

export async function deleteFromCloudTrash(groupId: string, personId: number): Promise<void> {
  if (auth.currentUser?.uid) {
    return deleteFromAccountTrash(auth.currentUser.uid, personId);
  }
  const cleanGroupId = groupId.trim().toUpperCase();
  const trashRef = doc(db, GROUP_COLLECTION, cleanGroupId, 'trash', String(personId));
  await deleteDoc(trashRef);
}

export async function fetchGroupData(groupId: string): Promise<{ workers: Person[], trash: DeletedPerson[] }> {
  if (auth.currentUser?.uid) {
    const data = await fetchAccountData(auth.currentUser.uid);
    return { workers: data.workers, trash: data.trash };
  }
  const cleanGroupId = groupId.trim().toUpperCase();
  const workersRef = collection(db, GROUP_COLLECTION, cleanGroupId, 'workers');
  const workersSnap = await getDocs(workersRef);
  const workers: Person[] = [];
  workersSnap.forEach(docSnap => {
    const data = docSnap.data();
    delete data._lastUpdated;
    workers.push(data as Person);
  });

  const trashRef = collection(db, GROUP_COLLECTION, cleanGroupId, 'trash');
  const trashSnap = await getDocs(trashRef);
  const trash: DeletedPerson[] = [];
  trashSnap.forEach(docSnap => {
    const data = docSnap.data();
    delete data._lastUpdated;
    trash.push(data as DeletedPerson);
  });

  return { workers, trash };
}

export function subscribeToWorkers(groupId: string, onUpdate: (workers: Person[]) => void) {
  if (auth.currentUser?.uid) {
    return subscribeToAccountWorkers(auth.currentUser.uid, onUpdate);
  }
  const cleanGroupId = groupId.trim().toUpperCase();
  const workersRef = collection(db, GROUP_COLLECTION, cleanGroupId, 'workers');
  return onSnapshot(workersRef, (snapshot) => {
    const workers: Person[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      delete data._lastUpdated;
      workers.push(data as Person);
    });
    onUpdate(workers);
  });
}

export function subscribeToTrash(groupId: string, onUpdate: (trash: DeletedPerson[]) => void) {
  if (auth.currentUser?.uid) {
    return subscribeToAccountTrash(auth.currentUser.uid, onUpdate);
  }
  const cleanGroupId = groupId.trim().toUpperCase();
  const trashRef = collection(db, GROUP_COLLECTION, cleanGroupId, 'trash');
  return onSnapshot(trashRef, (snapshot) => {
    const trash: DeletedPerson[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      delete data._lastUpdated;
      trash.push(data as DeletedPerson);
    });
    onUpdate(trash);
  });
}

export async function checkGroupExists(groupId: string): Promise<boolean> {
  return true;
}

export async function registerSession(groupId: string, userEmail: string = 'Anónimo', customSessionId?: string): Promise<string> {
  if (auth.currentUser?.uid) {
    return registerAccountSession(auth.currentUser.uid, userEmail, customSessionId);
  }
  return customSessionId || `session_${Date.now()}`;
}

export async function unregisterSession(groupId: string, sessionId: string): Promise<void> {
  if (auth.currentUser?.uid) {
    return unregisterAccountSession(auth.currentUser.uid, sessionId);
  }
}

export function subscribeToSessions(groupId: string, onUpdate: (sessions: DeviceSession[]) => void) {
  if (auth.currentUser?.uid) {
    return subscribeToAccountSessions(auth.currentUser.uid, onUpdate);
  }
  return () => {};
}

// -------------------------------------------------------------
// FIRESTORE CRUD & ACCOUNT PERSISTENCE
// -------------------------------------------------------------

/**
 * Saves or updates a registered user account in Firestore
 */
export async function saveFirestoreAccount(account: UserAccount): Promise<void> {
  if (!account || !account.id) return;
  const cleanId = account.id.trim();
  const safePayload = sanitizeForFirestore({
    id: cleanId,
    username: account.username.toLowerCase(),
    email: account.email.toLowerCase(),
    displayName: account.displayName,
    role: account.role,
    departamento: account.departamento || 'PROFEA',
    createdAt: account.createdAt || new Date().toISOString(),
    lastLoginAt: account.lastLoginAt || new Date().toISOString(),
    _lastUpdated: new Date().toISOString()
  });

  if (isFirestoreQuotaExceeded) return;

  try {
    const accRef = doc(db, 'users', cleanId);
    await setDoc(accRef, safePayload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `accounts/${cleanId}`);
  }
}

/**
 * Retrieves all registered accounts from Firestore
 */
export async function getFirestoreAccounts(): Promise<UserAccount[]> {
  try {
    const accountsRef = collection(db, 'accounts');
    const snap = await getDocs(accountsRef);
    const accounts: UserAccount[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      delete data._lastUpdated;
      accounts.push(data as UserAccount);
    });
    return accounts;
  } catch (error) {
    console.warn("Could not load accounts from Firestore:", error);
    return [];
  }
}

/**
 * Deletes an account from Firestore
 */
export async function deleteFirestoreAccount(accountId: string): Promise<void> {
  if (!accountId || isFirestoreQuotaExceeded) return;
  try {
    const accRef = doc(db, 'accounts', accountId);
    await deleteDoc(accRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `accounts/${accountId}`);
  }
}

/**
 * CRUD: Create/Insert a worker in Firestore for a specific user
 */
export async function createFirestoreWorker(userId: string, worker: Person): Promise<void> {
  if (!userId || !worker || !worker.id) return;
  const cleanUserId = canonicalizeEmailKey(userId);
  const workerWithSync = sanitizeForFirestore({
    ...worker,
    sincronizadoEnNube: true,
    ownerId: worker.ownerId || cleanUserId,
    _lastUpdated: new Date().toISOString()
  });

  // Always persist instantly to server store
  try {
    await fetch('/api/database/save-worker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: cleanUserId, worker: workerWithSync })
    });
  } catch (err) {
    console.warn("Could not post worker to server store:", err);
  }

  if (isFirestoreQuotaExceeded) return;

  try {
    const wsWorkerRef = doc(db, 'workspaces', cleanUserId, 'workers', String(worker.id));
    await setDoc(wsWorkerRef, workerWithSync, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `workspaces/${cleanUserId}/workers/${worker.id}`);
  }
}

/**
 * CRUD: Update/Modify an existing worker in Firestore for a specific user
 */
export async function updateFirestoreWorker(userId: string, worker: Person): Promise<void> {
  await createFirestoreWorker(userId, worker);
}

/**
 * CRUD: Delete a worker in Firestore (moves to trash)
 */
export async function deleteFirestoreWorker(
  userId: string, 
  workerId: number | string, 
  deletedRecord?: DeletedPerson
): Promise<void> {
  if (!userId || !workerId) return;
  const cleanUserId = canonicalizeEmailKey(userId);

  // 1. Server database first
  try {
    await fetch('/api/database/delete-worker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: cleanUserId, workerId, deletedRecord })
    });
  } catch (err) {
    console.warn("Could not post delete to server database:", err);
  }

  if (isFirestoreQuotaExceeded) return;

  try {
    const wsWorkerRef = doc(db, 'workspaces', cleanUserId, 'workers', String(workerId));
    await deleteDoc(wsWorkerRef);

    if (deletedRecord) {
      const wsTrashRef = doc(db, 'workspaces', cleanUserId, 'trash', String(workerId));
      await setDoc(wsTrashRef, sanitizeForFirestore({
        ...deletedRecord,
        _lastUpdated: new Date().toISOString()
      }));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `workspaces/${cleanUserId}/workers/${workerId}`);
  }
}

/**
 * CRUD: Restore a worker from trash in Firestore
 */
export async function restoreFirestoreWorker(userId: string, worker: Person): Promise<void> {
  if (!userId || !worker || !worker.id) return;
  const cleanUserId = canonicalizeEmailKey(userId);

  if (isFirestoreQuotaExceeded) {
    await createFirestoreWorker(userId, worker);
    return;
  }

  try {
    const wsTrashRef = doc(db, 'workspaces', cleanUserId, 'trash', String(worker.id));
    await deleteDoc(wsTrashRef);
    await createFirestoreWorker(userId, worker);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `workspaces/${cleanUserId}/trash/${worker.id}`);
  }
}

/**
 * CRUD: Permanently delete a worker from Firestore trash
 */
export async function permanentDeleteFirestoreWorker(userId: string, workerId: number | string): Promise<void> {
  if (!userId || !workerId) return;
  const cleanUserId = canonicalizeEmailKey(userId);

  if (isFirestoreQuotaExceeded) return;

  try {
    const wsTrashRef = doc(db, 'workspaces', cleanUserId, 'trash', String(workerId));
    await deleteDoc(wsTrashRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `workspaces/${cleanUserId}/trash/${workerId}`);
  }
}

/**
 * CRUD: Read/List workers for a specific user from Firestore
 */
export async function fetchFirestoreWorkers(userId: string): Promise<Person[]> {
  if (!userId) return [];
  const cleanUserId = canonicalizeEmailKey(userId);

  try {
    const workersRef = collection(db, 'users', cleanUserId, 'workers');
    const snap = await getDocs(workersRef);
    const list: Person[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      delete data._lastUpdated;
      list.push({ ...data, sincronizadoEnNube: true } as Person);
    });

    if (list.length > 0) return list;

    // Fallback check in workspaces
    const wsRef = collection(db, 'workspaces', cleanUserId, 'workers');
    const wsSnap = await getDocs(wsRef);
    const wsList: Person[] = [];
    wsSnap.forEach((docSnap) => {
      const data = docSnap.data();
      delete data._lastUpdated;
      wsList.push({ ...data, sincronizadoEnNube: true } as Person);
    });
    return wsList;
  } catch (error) {
    console.warn(`Could not read Firestore workers for ${userId}:`, error);
    return [];
  }
}

/**
 * Subscribes to real-time updates for a specific user in Firestore
 */
export function subscribeToFirestoreUserWorkers(
  userId: string, 
  onUpdate: (workers: Person[]) => void
): Unsubscribe {
  const cleanUserId = canonicalizeEmailKey(userId);
  const workersRef = collection(db, 'users', cleanUserId, 'workers');
  
  return onSnapshot(workersRef, (snap) => {
    const list: Person[] = [];
    snap.forEach((d) => {
      const data = d.data();
      delete data._lastUpdated;
      list.push({ ...data, sincronizadoEnNube: true } as Person);
    });
    onUpdate(list);
  }, (err) => {
    handleFirestoreError(err, OperationType.GET, `users/${cleanUserId}/workers`);
  });
}

