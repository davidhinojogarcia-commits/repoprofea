import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

export type FirestoreRecord = DocumentData & {
  ownerId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function requireUserId(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Debes iniciar sesión para realizar esta operación.');
  return uid;
}

export async function createDocument<T extends FirestoreRecord>(collectionName: string, id: string, data: Omit<T, 'createdAt' | 'updatedAt'>): Promise<void> {
  const uid = requireUserId();
  const ref = doc(db, collectionName, id);
  await setDoc(ref, { ...data, ownerId: data.ownerId || uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

export async function updateDocument<T extends DocumentData>(collectionName: string, id: string, data: Partial<T>): Promise<void> {
  requireUserId();
  await updateDoc(doc(db, collectionName, id), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteDocument(collectionName: string, id: string): Promise<void> {
  requireUserId();
  await deleteDoc(doc(db, collectionName, id));
}

export async function getDocument<T = DocumentData>(collectionName: string, id: string): Promise<T | null> {
  requireUserId();
  const snapshot = await getDoc(doc(db, collectionName, id));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as T) : null;
}

export async function getDocuments<T = DocumentData>(collectionName: string, options: { allForAdmin?: boolean; limitCount?: number } = {}): Promise<T[]> {
  const uid = requireUserId();
  const constraints = options.allForAdmin ? [] : [where('ownerId', '==', uid)];
  if (options.limitCount) constraints.push(limit(options.limitCount) as never);
  const snapshot = await getDocs(query(collection(db, collectionName), ...constraints));
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() } as T));
}

export function subscribeToDocuments<T = DocumentData>(collectionName: string, onUpdate: (items: T[]) => void, options: { allForAdmin?: boolean } = {}, onError?: (error: Error) => void): Unsubscribe {
  const uid = requireUserId();
  const constraints = options.allForAdmin ? [] : [where('ownerId', '==', uid)];
  return onSnapshot(
    query(collection(db, collectionName), ...constraints),
    snapshot => onUpdate(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as T))),
    error => onError?.(error)
  );
}

export async function getSharedDocuments<T = DocumentData>(collectionName: string): Promise<T[]> {
  const uid = requireUserId();
  const permissions = await getDocs(query(collection(db, 'dataPermissions'), where('userId', '==', uid), where('resourceType', '==', collectionName)));
  const allowedIds = permissions.docs.filter(item => item.data().canRead === true).map(item => item.data().resourceId);
  if (allowedIds.length === 0) return [];

  const results: T[] = [];
  for (const chunk of Array.from({ length: Math.ceil(allowedIds.length / 10) }, (_, index) => allowedIds.slice(index * 10, index * 10 + 10))) {
    const snapshot = await getDocs(query(collection(db, collectionName), where('__name__', 'in', chunk)));
    results.push(...snapshot.docs.map(item => ({ id: item.id, ...item.data() } as T)));
  }
  return results;
}
