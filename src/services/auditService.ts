import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

export type AuditAction = 'LOGIN' | 'CREATE' | 'UPDATE' | 'DELETE' | 'CREATE_USER' | 'UPDATE_USER' | 'DELETE_USER' | 'UPDATE_PERMISSIONS';

export async function writeAuditLog(action: AuditAction, resourceType: string, resourceId: string, details?: Record<string, unknown>): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  await addDoc(collection(db, 'auditLogs'), {
    userId: user.uid,
    userEmail: user.email || '',
    action,
    resourceType,
    resourceId,
    timestamp: serverTimestamp(),
    details: details || {},
  });
}
