import { collection, deleteDoc, doc, getDocs, query, where, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

export interface DataPermission {
  resourceType: string;
  resourceId: string;
  ownerId: string;
  userId: string;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

function adminOnly(): void {
  // Security is enforced by Firestore Rules/Cloud Functions; this check only avoids accidental UI calls.
  if (!auth.currentUser) throw new Error('Debes iniciar sesión.');
}

export async function listPermissionsForResource(resourceType: string, resourceId: string): Promise<DataPermission[]> {
  adminOnly();
  const snap = await getDocs(query(collection(db, 'dataPermissions'), where('resourceType', '==', resourceType), where('resourceId', '==', resourceId)));
  return snap.docs.map(item => item.data() as DataPermission);
}

export async function grantDataPermission(permission: DataPermission): Promise<void> {
  adminOnly();
  const id = `${permission.resourceId}_${permission.userId}`;
  await setDoc(doc(db, 'dataPermissions', id), permission);
}

export async function revokeDataPermission(resourceId: string, userId: string): Promise<void> {
  adminOnly();
  await deleteDoc(doc(db, 'dataPermissions', `${resourceId}_${userId}`));
}
