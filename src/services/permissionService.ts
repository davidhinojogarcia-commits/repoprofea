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

function requireSignedIn(): void {
  if (!auth.currentUser) throw new Error('Debes iniciar sesión.');
}

function permissionId(resourceType: string, resourceId: string, userId: string): string {
  return `${resourceType}_${resourceId}_${userId}`;
}

export async function listPermissionsForResource(resourceType: string, resourceId: string): Promise<DataPermission[]> {
  requireSignedIn();
  const snap = await getDocs(query(collection(db, 'dataPermissions'), where('resourceType', '==', resourceType), where('resourceId', '==', resourceId)));
  return snap.docs.map(item => item.data() as DataPermission);
}

export async function grantDataPermission(permission: DataPermission): Promise<void> {
  requireSignedIn();
  await setDoc(doc(db, 'dataPermissions', permissionId(permission.resourceType, permission.resourceId, permission.userId)), permission);
}

export async function revokeDataPermission(resourceType: string, resourceId: string, userId: string): Promise<void> {
  requireSignedIn();
  await deleteDoc(doc(db, 'dataPermissions', permissionId(resourceType, resourceId, userId)));
}
