import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  getDocFromServer,
  enableNetwork,
  setLogLevel,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  deleteDoc,
  updateDoc,
  query,
  where,
  Unsubscribe,
  serverTimestamp,
} from 'firebase/firestore';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { Person, DeletedPerson, PdfCustomConfig, UserAccount } from '../../types';
import firebaseConfig from '../../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => onAuthStateChanged(auth, user => {
  if (user) onAuthSuccess?.(user, null);
  else onAuthFailure?.();
});

export const getAccessToken = async (): Promise<string | null> => null;

/** Google/social authentication is intentionally disabled. */
export async function googleSignIn(): Promise<{ accessToken: string }> {
  throw new Error('Google Sign-In está deshabilitado. Usa correo electrónico y contraseña.');
}
export async function logoutGoogle(): Promise<void> {
  throw new Error('Google Sign-In está deshabilitado.');
}

export const db = (() => {
  try {
    if (typeof window !== 'undefined') {
      const instance = initializeFirestore(app, { experimentalForceLongPolling: true }, firebaseConfig.firestoreDatabaseId);
      setLogLevel('silent');
      return instance;
    }
  } catch (e) {
    console.warn('initializeFirestore fallback to getFirestore:', e);
  }
  return getFirestore(app, firebaseConfig.firestoreDatabaseId);
})();

if (typeof window !== 'undefined') {
  enableNetwork(db).catch(() => {});
  getDocFromServer(doc(db, 'test', 'connection')).catch(() => {});
}

export enum OperationType {
  CREATE = 'create', UPDATE = 'update', DELETE = 'delete', LIST = 'list', GET = 'get', WRITE = 'write'
}

export function sanitizeForFirestore<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  const clean: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'documentos' || value === undefined) continue;
    if (value instanceof Date) clean[key] = value;
    else if (Array.isArray(value)) clean[key] = value.filter(v => v !== undefined).map(v => v && typeof v === 'object' && !(v instanceof Date) ? sanitizeForFirestore(v) : v);
    else if (value && typeof value === 'object') clean[key] = sanitizeForFirestore(value as any);
    else clean[key] = value;
  }
  return clean;
}

export function canonicalizeEmailKey(email: unknown): string {
  if (!email || typeof email !== 'string') return 'unknown';
  return email.trim().toLowerCase().replace(/[^a-z0-9]/g, '_') || 'unknown';
}

export function isQuotaExceeded(): boolean { return false; }
export async function markQuotaExceeded(): Promise<void> {}

export interface WorkspaceMember { email: string; role: 'editor' | 'viewer'; addedAt: string; name?: string; }
export interface Workspace {
  id: string; name: string; ownerEmail: string; ownerUid: string; ownerName: string;
  ownerPhoto?: string; sharedWith: WorkspaceMember[]; sharedWithEmails: string[];
  accessCode: string; createdAt: string; lastSyncAt: string;
}
export interface DeviceSession { id: string; deviceName: string; userEmail: string; lastActive: string; }
export interface UserAccountSettings {
  savedObras?: string[]; savedLugares?: string[]; savedSitios?: string[]; savedTelefonos?: string[];
  savedCategorias?: string[]; workStartHour?: string; workEndHour?: string;
  pdfCustomConfig?: PdfCustomConfig; subcontratas?: any[]; lastUpdated?: string;
}
export const DEFAULT_WORKSPACE_ID = 'legacy-disabled';

const userWorkers = (uid: string) => collection(db, 'users', uid, 'workers');
const userTrash = (uid: string) => collection(db, 'users', uid, 'trash');
const userSettings = (uid: string) => doc(db, 'users', uid, 'settings', 'main');

export async function createFirestoreWorker(uid: string, person: Person): Promise<void> {
  if (!uid) throw new Error('Usuario no autenticado');
  const ref = doc(userWorkers(uid), String(person.id));
  await setDoc(ref, sanitizeForFirestore({ ...person, id: person.id, ownerId: uid, createdBy: uid, createdAt: serverTimestamp(), updatedBy: uid, updatedAt: serverTimestamp() }), { merge: true });
}

export async function updateFirestoreWorker(uid: string, personId: number, person: Partial<Person>): Promise<void> {
  if (!uid) throw new Error('Usuario no autenticado');
  await updateDoc(doc(userWorkers(uid), String(personId)), sanitizeForFirestore({ ...person, updatedBy: uid, updatedAt: serverTimestamp() }));
}

export async function deleteFirestoreWorker(uid: string, personId: number, deletedRecord?: DeletedPerson): Promise<void> {
  if (!uid) throw new Error('Usuario no autenticado');
  await deleteDoc(doc(userWorkers(uid), String(personId)));
  if (deletedRecord) await syncDeletedWorkerToAccount(uid, deletedRecord);
}

export async function restoreFirestoreWorker(uid: string, person: Person): Promise<void> {
  if (!uid) throw new Error('Usuario no autenticado');
  await createFirestoreWorker(uid, person);
  await deleteDoc(doc(userTrash(uid), String(person.id))).catch(() => {});
}

export async function permanentDeleteFirestoreWorker(uid: string, personId: number): Promise<void> {
  if (!uid) throw new Error('Usuario no autenticado');
  await deleteDoc(doc(userTrash(uid), String(personId)));
}

export function subscribeToFirestoreWorkers(uid: string, callback: (workers: Person[]) => void): Unsubscribe {
  if (!uid) return () => {};
  return onSnapshot(userWorkers(uid), snap => callback(snap.docs.map(d => ({ ...d.data(), id: Number(d.id) } as Person))));
}
export async function fetchFirestoreWorkers(uid: string): Promise<Person[]> {
  if (!uid) return [];
  const snap = await getDocs(userWorkers(uid));
  return snap.docs.map(d => ({ ...d.data(), id: Number(d.id) } as Person));
}
export async function syncDeletedWorkerToAccount(uid: string, deletedPerson: DeletedPerson): Promise<void> {
  if (!uid) throw new Error('Usuario no autenticado');
  await setDoc(doc(userTrash(uid), String(deletedPerson.id)), sanitizeForFirestore({ ...deletedPerson, ownerId: uid, createdBy: uid, createdAt: serverTimestamp(), updatedBy: uid, updatedAt: serverTimestamp() }), { merge: true });
}
export async function fetchAccountTrash(uid: string): Promise<DeletedPerson[]> {
  if (!uid) return [];
  const snap = await getDocs(userTrash(uid));
  return snap.docs.map(d => ({ ...d.data(), id: Number(d.id) } as DeletedPerson));
}
export async function deleteFromAccountTrash(uid: string, personId: number): Promise<void> {
  if (!uid) throw new Error('Usuario no autenticado');
  await deleteDoc(doc(userTrash(uid), String(personId)));
}
export async function fetchUserAccountSettings(uid: string): Promise<UserAccountSettings> {
  if (!uid) return {};
  const snap = await getDoc(userSettings(uid));
  return snap.exists() ? snap.data() as UserAccountSettings : {};
}
export async function saveUserAccountSettings(uid: string, settings: UserAccountSettings): Promise<void> {
  if (!uid) throw new Error('Usuario no autenticado');
  await setDoc(userSettings(uid), sanitizeForFirestore({ ...settings, updatedBy: uid, updatedAt: serverTimestamp() }), { merge: true });
}

export async function fetchAccountData(uid?: string): Promise<any> {
  const id = uid || auth.currentUser?.uid || '';
  return { workers: await fetchFirestoreWorkers(id), trash: await fetchAccountTrash(id), settings: await fetchUserAccountSettings(id) };
}
export function subscribeToAccountWorkers(uid: string, cb: (workers: Person[]) => void): Unsubscribe { return subscribeToFirestoreWorkers(uid, cb); }
export function subscribeToAccountTrash(uid: string, cb: (trash: DeletedPerson[]) => void): Unsubscribe {
  if (!uid) return () => {};
  return onSnapshot(userTrash(uid), snap => cb(snap.docs.map(d => ({ ...d.data(), id: Number(d.id) } as DeletedPerson))));
}
export async function syncAccountSettings(uid: string, settings: UserAccountSettings): Promise<void> { return saveUserAccountSettings(uid, settings); }
export function subscribeToAccountSettings(uid: string, cb: (settings: UserAccountSettings) => void): Unsubscribe {
  if (!uid) return () => {};
  return onSnapshot(userSettings(uid), snap => cb(snap.exists() ? snap.data() as UserAccountSettings : {}));
}
export async function registerAccountSession(..._args: any[]): Promise<void> {}
export async function unregisterAccountSession(..._args: any[]): Promise<void> {}
export function subscribeToAccountSessions(..._args: any[]): Unsubscribe { return () => {}; }

export async function getOrCreateUserAccount(user: { uid: string; email: string; displayName?: string | null }): Promise<UserAccount> {
  return { id: user.uid, email: user.email, name: user.displayName || user.email, photoURL: '', createdAt: new Date().toISOString(), lastSyncAt: new Date().toISOString() } as UserAccount;
}
export async function getUserAccountByEmail(email: string): Promise<UserAccount | null> {
  const u = auth.currentUser;
  return u && (u.email || '').toLowerCase() === email.trim().toLowerCase() ? getOrCreateUserAccount(u) : null;
}
export async function fetchSharedAccountsForEmail(email: string): Promise<UserAccount[]> { const a = await getUserAccountByEmail(email); return a ? [a] : []; }
export async function syncWorkerToAccount(_accountId: string, person: Person): Promise<void> { return createFirestoreWorker(auth.currentUser?.uid || '', person); }
export async function deleteWorkerFromAccount(_accountId: string, id: number, deleted?: DeletedPerson): Promise<void> { return deleteFirestoreWorker(auth.currentUser?.uid || '', id, deleted); }

// Legacy workspace API is retained only as a type-compatible facade; business data is stored under users/{uid}.
export async function getOrCreateUserWorkspace(user: any): Promise<Workspace> { return { id: user.uid, name: user.displayName || user.email, ownerEmail: user.email, ownerUid: user.uid, ownerName: user.displayName || user.email, sharedWith: [], sharedWithEmails: [user.email], accessCode: '', createdAt: new Date().toISOString(), lastSyncAt: new Date().toISOString() }; }
export async function getWorkspaceByIdOrEmail(_id: string): Promise<Workspace | null> { const u = auth.currentUser; return u ? getOrCreateUserWorkspace(u) : null; }
export async function fetchSharedWorkspacesForEmail(_email: string): Promise<Workspace[]> { const u = auth.currentUser; return u ? [await getOrCreateUserWorkspace(u)] : []; }
export async function findWorkspaceByAccessCode(_code: string): Promise<Workspace | null> { const u = auth.currentUser; return u ? getOrCreateUserWorkspace(u) : null; }
export async function addMemberToWorkspace(..._args: any[]): Promise<void> {}
export async function updateMemberRoleInWorkspace(..._args: any[]): Promise<void> {}
export async function removeMemberFromWorkspace(..._args: any[]): Promise<void> {}
export function subscribeToWorkspaceMeta(..._args: any[]): Unsubscribe { return () => {}; }
export async function syncWorkerToWorkspace(_workspaceId: string, p: Person): Promise<void> { return syncWorkerToAccount(_workspaceId, p); }
export async function deleteWorkerFromWorkspace(_workspaceId: string, id: number, d?: DeletedPerson): Promise<void> { return deleteWorkerFromAccount(_workspaceId, id, d); }
export async function syncDeletedWorkerToWorkspace(_workspaceId: string, d: DeletedPerson): Promise<void> { return syncDeletedWorkerToAccount(auth.currentUser?.uid || '', d); }
export async function deleteFromWorkspaceTrash(_workspaceId: string, id: number): Promise<void> { return deleteFromAccountTrash(auth.currentUser?.uid || '', id); }
export async function fetchWorkspaceData(_workspaceId: string): Promise<any> { return fetchAccountData(); }
export function subscribeToWorkspaceWorkers(..._args: any[]): Unsubscribe { return subscribeToAccountWorkers(auth.currentUser?.uid || '', _args[1] || (() => {})); }
export function subscribeToWorkspaceTrash(..._args: any[]): Unsubscribe { return subscribeToAccountTrash(auth.currentUser?.uid || '', _args[1] || (() => {})); }
export function subscribeToWorkspaceSettings(..._args: any[]): Unsubscribe { return subscribeToAccountSettings(auth.currentUser?.uid || '', _args[1] || (() => {})); }
export async function syncWorkspaceSettings(..._args: any[]): Promise<void> { return saveUserAccountSettings(auth.currentUser?.uid || '', _args[1] || {}); }
export async function registerWorkspaceSession(..._args: any[]): Promise<void> {}
export async function unregisterWorkspaceSession(..._args: any[]): Promise<void> {}
export function subscribeToWorkspaceSessions(..._args: any[]): Unsubscribe { return () => {}; }

export async function getOrCreateSyncGroup(..._args: any[]): Promise<any> { return { id: auth.currentUser?.uid || '', ownerUid: auth.currentUser?.uid || '' }; }
export async function syncWorkerToCloud(_groupId: string, p: Person): Promise<void> { return createFirestoreWorker(auth.currentUser?.uid || '', p); }
export async function deleteWorkerFromCloud(_groupId: string, id: number, d?: DeletedPerson): Promise<void> { return deleteFirestoreWorker(auth.currentUser?.uid || '', id, d); }
export async function syncDeletedWorkerToCloud(_groupId: string, d: DeletedPerson): Promise<void> { return syncDeletedWorkerToAccount(auth.currentUser?.uid || '', d); }
export async function deleteFromCloudTrash(_groupId: string, id: number): Promise<void> { return deleteFromAccountTrash(auth.currentUser?.uid || '', id); }
export async function fetchGroupData(..._args: any[]): Promise<any> { return fetchAccountData(); }
export function subscribeToWorkers(..._args: any[]): Unsubscribe { return subscribeToAccountWorkers(auth.currentUser?.uid || '', _args[1] || (() => {})); }
export function subscribeToTrash(..._args: any[]): Unsubscribe { return subscribeToAccountTrash(auth.currentUser?.uid || '', _args[1] || (() => {})); }
export async function registerSession(..._args: any[]): Promise<void> {}
export async function unregisterSession(..._args: any[]): Promise<void> {}
export function subscribeToSessions(..._args: any[]): Unsubscribe { return () => {}; }
export async function checkGroupExists(..._args: any[]): Promise<boolean> { return true; }
