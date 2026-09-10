import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

initializeApp();
const db = getFirestore();
const auth = getAuth();
type Role = 'admin' | 'user';

const defaultModules = {
  contratacion: { read: true, create: true, update: true, delete: true },
  trabajadores: { read: true, create: true, update: true, delete: true },
  obras: { read: true, create: true, update: true, delete: true },
  reconocimientos: { read: true, create: true, update: true, delete: true },
  subcontratas: { read: true, create: true, update: true, delete: true },
  citas: { read: true, create: true, update: true, delete: true },
};

function requireAdmin(request: CallableRequest<unknown>): void {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  if (request.auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'Solo un administrador puede realizar esta operación.');
}

async function audit(adminUid: string, action: string, resourceType: string, resourceId: string, details?: unknown) {
  await db.collection('auditLogs').add({
    userId: adminUid,
    action,
    resourceType,
    resourceId,
    timestamp: FieldValue.serverTimestamp(),
    ...(details === undefined ? {} : { details }),
  });
}

export const createManagedUser = onCall(async request => {
  requireAdmin(request);
  const { email, password, nombre = '', apellidos = '', role = 'user' } = request.data ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || password.length < 6) throw new HttpsError('invalid-argument', 'Email y una contraseña temporal de al menos 6 caracteres son obligatorios.');
  const safeRole: Role = role === 'admin' ? 'admin' : 'user';
  try {
    const created = await auth.createUser({ email: email.trim().toLowerCase(), password, displayName: `${String(nombre).trim()} ${String(apellidos).trim()}`.trim(), disabled: false });
    await auth.setCustomUserClaims(created.uid, { role: safeRole });
    const batch = db.batch();
    batch.set(db.doc(`users/${created.uid}`), { uid: created.uid, email: created.email, nombre: String(nombre).trim(), apellidos: String(apellidos).trim(), role: safeRole, active: true, createdAt: FieldValue.serverTimestamp(), createdBy: request.auth!.uid });
    batch.set(db.doc(`userPermissions/${created.uid}`), { modules: defaultModules });
    batch.set(db.collection('auditLogs').doc(), { userId: request.auth!.uid, action: 'CREATE_USER', resourceType: 'user', resourceId: created.uid, timestamp: FieldValue.serverTimestamp(), details: { email: created.email, role: safeRole } });
    await batch.commit();
    return { uid: created.uid, email: created.email, role: safeRole };
  } catch (error: any) {
    if (error?.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'Ya existe un usuario con ese correo.');
    throw new HttpsError('internal', error?.message || 'No se pudo crear el usuario.');
  }
});

export const setManagedUserRole = onCall(async request => {
  requireAdmin(request);
  const { uid, role } = request.data ?? {};
  if (typeof uid !== 'string' || (role !== 'admin' && role !== 'user')) throw new HttpsError('invalid-argument', 'Usuario o rol no válidos.');
  await auth.setCustomUserClaims(uid, { role });
  await db.doc(`users/${uid}`).set({ role }, { merge: true });
  await audit(request.auth!.uid, 'UPDATE_USER', 'user', uid, { role });
  return { ok: true };
});

export const setManagedUserActive = onCall(async request => {
  requireAdmin(request);
  const { uid, active } = request.data ?? {};
  if (typeof uid !== 'string' || typeof active !== 'boolean') throw new HttpsError('invalid-argument', 'Usuario o estado no válidos.');
  await auth.updateUser(uid, { disabled: !active });
  await db.doc(`users/${uid}`).set({ active }, { merge: true });
  await audit(request.auth!.uid, 'UPDATE_USER', 'user', uid, { active });
  return { ok: true };
});

export const deleteManagedUser = onCall(async request => {
  requireAdmin(request);
  const { uid } = request.data ?? {};
  if (typeof uid !== 'string' || uid === request.auth!.uid) throw new HttpsError('invalid-argument', 'No puedes eliminar tu propia cuenta de administrador.');
  await auth.deleteUser(uid);
  await db.doc(`users/${uid}`).delete();
  await db.doc(`userPermissions/${uid}`).delete();
  await audit(request.auth!.uid, 'DELETE_USER', 'user', uid);
  return { ok: true };
});

export const updateManagedPermissions = onCall(async request => {
  requireAdmin(request);
  const { uid, modules } = request.data ?? {};
  if (typeof uid !== 'string' || !modules || typeof modules !== 'object') throw new HttpsError('invalid-argument', 'Permisos no válidos.');
  await db.doc(`userPermissions/${uid}`).set({ modules }, { merge: false });
  await audit(request.auth!.uid, 'UPDATE_PERMISSIONS', 'userPermissions', uid);
  return { ok: true };
});

export const sendManagedPasswordReset = onCall(async request => {
  requireAdmin(request);
  const { uid } = request.data ?? {};
  if (typeof uid !== 'string') throw new HttpsError('invalid-argument', 'Usuario no válido.');
  try {
    const user = await auth.getUser(uid);
    const link = await auth.generatePasswordResetLink(user.email!);
    await audit(request.auth!.uid, 'UPDATE_USER', 'user', uid, { action: 'PASSWORD_RESET_REQUESTED' });
    return { email: user.email, resetLink: link };
  } catch (error: any) {
    throw new HttpsError('internal', error?.message || 'No se pudo generar el restablecimiento de contraseña.');
  }
});
