import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  onSnapshot, 
  deleteDoc,
  Unsubscribe
} from 'firebase/firestore';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { Person, DeletedPerson, PdfCustomConfig } from '../../types';

// Read config from provisioned details
const firebaseConfig = {
  projectId: "composite-proton-ktxfk",
  appId: "1:32369359528:web:00bf85bd582dbef71c209d",
  apiKey: "AIzaSyCoLiLZXdWWYQklXwsWnf1LDjzbKxPST2g",
  authDomain: "composite-proton-ktxfk.firebaseapp.com",
  databaseId: "ai-studio-sistemacontratac-6e2967df-5143-4870-8115-db3d280cbe25",
  storageBucket: "composite-proton-ktxfk.firebasestorage.app",
  messagingSenderId: "32369359528"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Initialize Auth
export const auth = getAuth(app);

// Initialize Provider with full Drive, Sheets, Gmail & Calendar scopes
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive');
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.addScope('https://www.googleapis.com/auth/drive.metadata.readonly');
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.addScope('https://www.googleapis.com/auth/spreadsheets.readonly');
provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
provider.addScope('https://www.googleapis.com/auth/gmail.send');
provider.addScope('https://www.googleapis.com/auth/gmail.compose');
provider.addScope('https://www.googleapis.com/auth/gmail.modify');
provider.addScope('https://www.googleapis.com/auth/calendar.events');

let isSigningIn = false;
let cachedAccessToken: string | null = null;

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

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedAccessToken = credential.accessToken;
    }
    
    // Save user profile metadata in Firestore
    if (result.user) {
      await saveUserProfile(result.user);
    }

    return { user: result.user, accessToken: cachedAccessToken || '' };
  } catch (error: any) {
    if (
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request' ||
      error?.message?.includes('popup-closed-by-user')
    ) {
      // User closed the authentication popup - gracefully return null without error
      return null;
    }
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logoutGoogle = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

// Initialize Firestore
export const db = getFirestore(app);

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
  if (!email || typeof email !== 'string') return 'default_account';
  const clean = email.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
  return clean || 'default_account';
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
  
  if (
    errMsg.includes('offline') || 
    errMsg.includes('client is offline') || 
    errMsg.includes('unavailable') || 
    errMsg.includes('network')
  ) {
    console.warn(`[Firestore Offline] ${operationType} on ${path || 'unknown'}: ${errMsg}`);
    return;
  }

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

/**
 * Syncs a single worker to the shared workspace in Firestore
 */
export async function syncWorkerToWorkspace(workspaceId: string, person: Person): Promise<void> {
  if (!workspaceId || typeof workspaceId !== 'string' || !person?.id) return;
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return;
  const workerRef = doc(db, 'workspaces', cleanWsId, 'workers', String(person.id));
  const sanitized = sanitizeForFirestore(person);

  try {
    await setDoc(workerRef, {
      ...sanitized,
      _lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `workspaces/${cleanWsId}/workers/${person.id}`);
  }
}

/**
 * Deletes a worker from the shared workspace in Firestore
 */
export async function deleteWorkerFromWorkspace(workspaceId: string, personId: number): Promise<void> {
  if (!workspaceId || typeof workspaceId !== 'string' || !personId) return;
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return;
  const workerRef = doc(db, 'workspaces', cleanWsId, 'workers', String(personId));
  try {
    await deleteDoc(workerRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `workspaces/${cleanWsId}/workers/${personId}`);
  }
}

/**
 * Syncs a deleted worker to the workspace trash bin in Firestore
 */
export async function syncDeletedWorkerToWorkspace(workspaceId: string, deletedPerson: DeletedPerson): Promise<void> {
  if (!workspaceId || typeof workspaceId !== 'string' || !deletedPerson?.person?.id) return;
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return;
  const trashRef = doc(db, 'workspaces', cleanWsId, 'trash', String(deletedPerson.person.id));
  const sanitizedPerson = sanitizeForFirestore(deletedPerson.person);

  try {
    await setDoc(trashRef, {
      person: sanitizedPerson,
      fechaEliminacion: deletedPerson.fechaEliminacion || new Date().toISOString(),
      _lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `workspaces/${cleanWsId}/trash/${deletedPerson.person.id}`);
  }
}

/**
 * Permanently removes a worker from the workspace trash bin
 */
export async function deleteFromWorkspaceTrash(workspaceId: string, personId: number): Promise<void> {
  if (!workspaceId || typeof workspaceId !== 'string' || !personId) return;
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return;
  const trashRef = doc(db, 'workspaces', cleanWsId, 'trash', String(personId));
  try {
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
  if (!workspaceId || typeof workspaceId !== 'string') return { workers: [], trash: [], settings: null, workspace: null };
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return { workers: [], trash: [], settings: null, workspace: null };

  // 1. Workspace meta
  let workspace: Workspace | null = null;
  try {
    const wsSnap = await getDoc(doc(db, 'workspaces', cleanWsId));
    if (wsSnap.exists()) {
      workspace = wsSnap.data() as Workspace;
    }
  } catch (e) {
    console.warn("Could not fetch workspace metadata:", e);
  }

  // 2. Workers
  const workers: Person[] = [];
  try {
    const workersRef = collection(db, 'workspaces', cleanWsId, 'workers');
    const workersSnap = await getDocs(workersRef);
    workersSnap.forEach(docSnap => {
      const data = docSnap.data();
      delete data._lastUpdated;
      workers.push(data as Person);
    });
  } catch (error) {
    console.warn(`Could not fetch workspace workers (workspaces/${cleanWsId}/workers):`, error);
  }

  // 3. Trash
  const trash: DeletedPerson[] = [];
  try {
    const trashRef = collection(db, 'workspaces', cleanWsId, 'trash');
    const trashSnap = await getDocs(trashRef);
    trashSnap.forEach(docSnap => {
      const data = docSnap.data();
      delete data._lastUpdated;
      trash.push(data as DeletedPerson);
    });
  } catch (error) {
    console.warn(`Could not fetch workspace trash (workspaces/${cleanWsId}/trash):`, error);
  }

  // 4. Settings
  let settings: UserAccountSettings | null = null;
  try {
    const settingsDoc = await getDoc(doc(db, 'workspaces', cleanWsId, 'settings', 'app_config'));
    if (settingsDoc.exists()) {
      settings = settingsDoc.data() as UserAccountSettings;
    }
  } catch (e) {
    console.warn("Could not fetch workspace settings:", e);
  }

  return { workers, trash, settings, workspace };
}

/**
 * Subscribes to real-time changes in workers for a workspace
 */
export function subscribeToWorkspaceWorkers(
  workspaceId: string, 
  onUpdate: (workers: Person[]) => void,
  onError?: (err: any) => void
): Unsubscribe {
  if (!workspaceId || typeof workspaceId !== 'string') return () => {};
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return () => {};
  const workersRef = collection(db, 'workspaces', cleanWsId, 'workers');

  return onSnapshot(workersRef, (snapshot) => {
    const workers: Person[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      delete data._lastUpdated;
      workers.push(data as Person);
    });
    onUpdate(workers);
  }, (error) => {
    console.error("Error subscribing to workspace workers:", error);
    if (onError) onError(error);
  });
}

/**
 * Subscribes to real-time changes in trash for a workspace
 */
export function subscribeToWorkspaceTrash(
  workspaceId: string, 
  onUpdate: (trash: DeletedPerson[]) => void,
  onError?: (err: any) => void
): Unsubscribe {
  if (!workspaceId || typeof workspaceId !== 'string') return () => {};
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return () => {};
  const trashRef = collection(db, 'workspaces', cleanWsId, 'trash');

  return onSnapshot(trashRef, (snapshot) => {
    const trash: DeletedPerson[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      delete data._lastUpdated;
      trash.push(data as DeletedPerson);
    });
    onUpdate(trash);
  }, (error) => {
    console.error("Error subscribing to workspace trash:", error);
    if (onError) onError(error);
  });
}

/**
 * Saves custom catalogs/settings to the workspace in Firestore
 */
export async function syncWorkspaceSettings(workspaceId: string, settings: UserAccountSettings): Promise<void> {
  if (!workspaceId || typeof workspaceId !== 'string') return;
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return;
  const settingsRef = doc(db, 'workspaces', cleanWsId, 'settings', 'app_config');
  const sanitized = sanitizeForFirestore(settings);
  try {
    await setDoc(settingsRef, {
      ...sanitized,
      lastUpdated: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    console.warn("Error saving workspace settings to Firestore:", error);
  }
}

/**
 * Subscribes to real-time changes of workspace settings/catalogs
 */
export function subscribeToWorkspaceSettings(
  workspaceId: string,
  onUpdate: (settings: UserAccountSettings) => void
): Unsubscribe {
  if (!workspaceId || typeof workspaceId !== 'string') return () => {};
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return () => {};
  const settingsRef = doc(db, 'workspaces', cleanWsId, 'settings', 'app_config');

  return onSnapshot(settingsRef, (docSnap) => {
    if (docSnap.exists()) {
      onUpdate(docSnap.data() as UserAccountSettings);
    }
  }, (error) => {
    console.warn("Error subscribing to workspace settings:", error);
  });
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
    console.warn("Could not register workspace session:", error);
    return sessionId;
  }
}

/**
 * Unregisters an active device session from a workspace
 */
export async function unregisterWorkspaceSession(workspaceId: string, sessionId: string): Promise<void> {
  if (!workspaceId || typeof workspaceId !== 'string' || !sessionId) return;
  const cleanWsId = workspaceId.trim();
  if (!cleanWsId) return;
  const sessionRef = doc(db, 'workspaces', cleanWsId, 'sessions', sessionId);
  try {
    await deleteDoc(sessionRef);
  } catch (error) {
    console.warn("Could not unregister workspace session:", error);
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
  const sessionsRef = collection(db, 'workspaces', workspaceId, 'sessions');

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
