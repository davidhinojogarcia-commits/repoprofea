import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
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
  id?: string;
  ownerId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type ListOptions = {
  allForAdmin?: boolean;
  includeShared?: boolean;
  limitCount?: number;
};

function requireUserId(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Debes iniciar sesión para realizar esta operación.');
  return uid;
}

async function isAdmin(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  const token = await user.getIdTokenResult();
  return token.claims.role === 'admin';
}

function withId<T = DocumentData>(item: { id: string; data: () => DocumentData }): T {
  return { id: item.id, ...item.data() } as T;
}

export async function createDocument<T extends FirestoreRecord>(
  collectionName: string,
  id: string,
  data: Omit<T, 'createdAt' | 'updatedAt' | 'ownerId'> & { ownerId?: string },
): Promise<void> {
  const uid = requireUserId();
  const ownerId = data.ownerId || uid;
  if (ownerId !== uid && !(await isAdmin())) {
    throw new Error('No puedes crear datos a nombre de otro usuario.');
  }

  await setDoc(doc(db, collectionName, id), {
    ...data,
    ownerId,
    createdBy: uid,
    updatedBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateDocument<T extends DocumentData>(
  collectionName: string,
  id: string,
  data: Partial<T>,
): Promise<void> {
  const uid = requireUserId();
  const ref = doc(db, collectionName, id);
  const existing = await getDoc(ref);
  if (!existing.exists()) throw new Error('El registro que intentas modificar no existe.');

  const current = existing.data();
  if (data.ownerId !== undefined && data.ownerId !== current.ownerId) {
    throw new Error('El propietario del registro no puede modificarse.');
  }

  await updateDoc(ref, {
    ...data,
    ownerId: current.ownerId,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteDocument(collectionName: string, id: string): Promise<void> {
  requireUserId();
  await deleteDoc(doc(db, collectionName, id));
}

export async function getDocument<T = DocumentData>(collectionName: string, id: string): Promise<T | null> {
  requireUserId();
  const snapshot = await getDoc(doc(db, collectionName, id));
  return snapshot.exists() ? withId<T>(snapshot) : null;
}

export async function getDocuments<T = DocumentData>(collectionName: string, options: ListOptions = {}): Promise<T[]> {
  const uid = requireUserId();
  const admin = options.allForAdmin || await isAdmin();
  const constraints = admin ? [] : [where('ownerId', '==', uid)];
  if (options.limitCount) constraints.push(limit(options.limitCount) as never);

  const snapshot = await getDocs(query(collection(db, collectionName), ...constraints));
  const own = snapshot.docs.map(item => withId<T>(item));
  if (admin || !options.includeShared) return own;

  const shared = await getSharedDocuments<T>(collectionName);
  const seen = new Set(own.map(item => String((item as DocumentData).id)));
  return [...own, ...shared.filter(item => !seen.has(String((item as DocumentData).id)))];
}

export function subscribeToDocuments<T = DocumentData>(
  collectionName: string,
  onUpdate: (items: T[]) => void,
  options: { allForAdmin?: boolean } = {},
  onError?: (error: Error) => void,
): Unsubscribe {
  const uid = requireUserId();
  let active = true;
  const constraints = options.allForAdmin ? [] : [where('ownerId', '==', uid)];
  const unsubscribe = onSnapshot(
    query(collection(db, collectionName), ...constraints),
    async snapshot => {
      if (!active) return;
      try {
        const own = snapshot.docs.map(item => withId<T>(item));
        if (options.allForAdmin || !(await isAdmin())) {
          const shared = options.allForAdmin ? [] : await getSharedDocuments<T>(collectionName);
          const seen = new Set(own.map(item => String((item as DocumentData).id)));
          onUpdate([...own, ...shared.filter(item => !seen.has(String((item as DocumentData).id)))]);
        } else {
          onUpdate(own);
        }
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    },
    error => onError?.(error),
  );

  return () => {
    active = false;
    unsubscribe();
  };
}

export async function getSharedDocuments<T = DocumentData>(collectionName: string): Promise<T[]> {
  const uid = requireUserId();
  const permissions = await getDocs(
    query(
      collection(db, 'dataPermissions'),
      where('userId', '==', uid),
      where('resourceType', '==', collectionName),
      where('canRead', '==', true),
    ),
  );
  const allowedIds = permissions.docs.map(item => String(item.data().resourceId)).filter(Boolean);
  if (allowedIds.length === 0) return [];

  const results: T[] = [];
  for (let index = 0; index < allowedIds.length; index += 10) {
    const chunk = allowedIds.slice(index, index + 10);
    const snapshot = await getDocs(query(collection(db, collectionName), where('__name__', 'in', chunk)));
    results.push(...snapshot.docs.map(item => withId<T>(item)));
  }
  return results;
}
