import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

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

async function requireAdmin(request: Parameters<typeof onCall>[0] extends never ? never : any) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  if (request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo un administrador puede realizar esta operación.');
  }
}

export const createManagedUser = onCall(async request => {
  await requireAdmin(request);
  const { email, password, nombre = '', apellidos = '', role = 'user' } = request.data ?? {};

  if (typeof email !== 'string' || typeof password !== 'string' || password.length < 6) {
    throw new HttpsError('invalid-argument', 'Email y una contraseña temporal de al menos 6 caracteres son obligatorios.');
  }
  const safeRole: Role = role === 'admin' ? 'admin' : 'user';

  try {
    const created = await auth.createUser({
      email: email.trim().toLowerCase(),
      password,
      displayName: `${String(nombre).trim()} ${String(apellidos).trim()}`.trim(),
      disabled: false,
    });

    await auth.setCustomUserClaims(created.uid, { role: safeRole });
    const batch = db.batch();
    batch.set(db.doc(`users/${created.uid}`), {
      uid: created.uid,
      email: created.email,
      nombre: String(nombre).trim(),
      apellidos: String(apellidos).trim(),
      role: safeRole,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: request.auth!.uid,
    });
    batch.set(db.doc(`userPermissions/${created.uid}`), { modules: defaultModules });
    batch.set(db.collection('auditLogs').doc(), {
      userId: request.auth!.uid,
      action: 'CREATE_USER',
      resourceType: 'user',
      resourceId: created.uid,
      timestamp: FieldValue.serverTimestamp(),
      details: { email: created.email, role: safeRole },
    });
    await batch.commit();

    return { uid: created.uid, email: created.email, role: safeRole };
  } catch (error: any) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error?.message || 'No se pudo crear el usuario.');
  }
});

export const setManagedUserRole = onCall(async request => {
  await requireAdmin(request);
  const { uid, role } = request.data ?? {};
  if (typeof uid !== 'string' || (role !== 'admin' && role !== 'user')) {
    throw new HttpsError('invalid-argument', 'Usuario o rol no válidos.');
  }
  await auth.setCustomUserClaims(uid, { role });
  await db.doc(`users/${uid}`).set({ role }, { merge: true });
  await db.collection('auditLogs').add({
    userId: request.auth!.uid,
    action: 'UPDATE_USER',
    resourceType: 'user',
    resourceId: uid,
    timestamp: FieldValue.serverTimestamp(),
    details: { role },
  });
  return { ok: true };
});

export const setManagedUserActive = onCall(async request => {
  await requireAdmin(request);
  const { uid, active } = request.data ?? {};
  if (typeof uid !== 'string' || typeof active !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Usuario o estado no válidos.');
  }
  await auth.updateUser(uid, { disabled: !active });
  await db.doc(`users/${uid}`).set({ active }, { merge: true });
  await db.collection('auditLogs').add({
    userId: request.auth!.uid,
    action: 'UPDATE_USER',
    resourceType: 'user',
    resourceId: uid,
    timestamp: FieldValue.serverTimestamp(),
    details: { active },
  });
  return { ok: true };
});

export const deleteManagedUser = onCall(async request => {
  await requireAdmin(request);
  const { uid } = request.data ?? {};
  if (typeof uid !== 'string' || uid === request.auth!.uid) {
    throw new HttpsError('invalid-argument', 'No puedes eliminar tu propia cuenta de administrador.');
  }
  await auth.deleteUser(uid);
  await db.doc(`users/${uid}`).delete();
  await db.doc(`userPermissions/${uid}`).delete();
  await db.collection('auditLogs').add({
    userId: request.auth!.uid,
    action: 'DELETE_USER',
    resourceType: 'user',
    resourceId: uid,
    timestamp: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const updateManagedPermissions = onCall(async request => {
  await requireAdmin(request);
  const { uid, modules } = request.data ?? {};
  if (typeof uid !== 'string' || !modules || typeof modules !== 'object') {
    throw new HttpsError('invalid-argument', 'Permisos no válidos.');
  }
  await db.doc(`userPermissions/${uid}`).set({ modules }, { merge: false });
  await db.collection('auditLogs').add({
    userId: request.auth!.uid,
    action: 'UPDATE_PERMISSIONS',
    resourceType: 'userPermissions',
    resourceId: uid,
    timestamp: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});
