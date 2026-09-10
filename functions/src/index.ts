import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

initializeApp();
const db = getFirestore();
const auth = getAuth();
type Role = 'admin' | 'user';
type PermissionAction = 'read' | 'create' | 'update' | 'delete';

const INITIAL_ADMIN_EMAIL = (process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
const MODULES = ['contratacion', 'trabajadores', 'obras', 'reconocimientos', 'subcontratas', 'citas'] as const;

const defaultModules = Object.fromEntries(
  MODULES.map(module => [module, { read: true, create: true, update: true, delete: true }])
);

function requireAdmin(request: CallableRequest<unknown>): void {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  if (request.auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'Solo un administrador puede realizar esta operación.');
}

async function audit(userId: string, action: string, resourceType: string, resourceId: string, details?: unknown) {
  const user = await auth.getUser(userId);
  await db.collection('auditLogs').add({
    userId,
    userEmail: user.email || '',
    action,
    resourceType,
    resourceId,
    timestamp: FieldValue.serverTimestamp(),
    ...(details === undefined ? {} : { details }),
  });
}

async function countAdmins(): Promise<number> {
  const snapshot = await db.collection('users').where('role', '==', 'admin').get();
  return snapshot.size;
}

function validateModules(modules: unknown): asserts modules is Record<string, Record<PermissionAction, boolean>> {
  if (!modules || typeof modules !== 'object' || Array.isArray(modules)) throw new HttpsError('invalid-argument', 'Permisos no válidos.');
  const input = modules as Record<string, unknown>;
  for (const module of MODULES) {
    const value = input[module];
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpsError('invalid-argument', `Permisos inválidos para ${module}.`);
    for (const action of ['read', 'create', 'update', 'delete'] as PermissionAction[]) {
      if (typeof (value as Record<string, unknown>)[action] !== 'boolean') {
        throw new HttpsError('invalid-argument', `Permiso ${module}.${action} no válido.`);
      }
    }
  }
}

/** One-time bootstrap for the already-created initial Firebase Auth account. */
export const bootstrapFirstAdmin = onCall(async request => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  if (!INITIAL_ADMIN_EMAIL) throw new HttpsError('failed-precondition', 'El alta inicial del administrador no está configurada.');
  const callerEmail = (request.auth.token.email || '').trim().toLowerCase();
  if (callerEmail !== INITIAL_ADMIN_EMAIL) throw new HttpsError('permission-denied', 'Esta cuenta no está autorizada para el alta inicial.');

  const existing = await db.doc(`users/${request.auth.uid}`).get();
  const adminCount = await countAdmins();
  if (adminCount > 0 && (!existing.exists || existing.data()?.role !== 'admin')) {
    throw new HttpsError('failed-precondition', 'El administrador inicial ya está configurado.');
  }

  const user = await auth.getUser(request.auth.uid);
  await auth.setCustomUserClaims(request.auth.uid, { ...(user.customClaims || {}), role: 'admin' });
  await db.doc(`users/${request.auth.uid}`).set({
    uid: request.auth.uid,
    email: user.email || callerEmail,
    nombre: user.displayName || existing.data()?.nombre || '',
    apellidos: existing.data()?.apellidos || '',
    role: 'admin',
    active: true,
    createdAt: existing.data()?.createdAt || FieldValue.serverTimestamp(),
    createdBy: existing.data()?.createdBy || request.auth.uid,
  }, { merge: true });
  await db.doc(`userPermissions/${request.auth.uid}`).set({ modules: defaultModules }, { merge: false });
  if (adminCount === 0 || existing.data()?.role !== 'admin') {
    await audit(request.auth.uid, 'CREATE_USER', 'user', request.auth.uid, { bootstrap: true });
  }
  return { ok: true, role: 'admin' as const };
});

/** Records a successful login using trusted server time and writes the audit event. */
export const touchLogin = onCall(async request => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  const user = await auth.getUser(request.auth.uid);
  const profile = await db.doc(`users/${request.auth.uid}`).get();
  if (profile.exists && profile.data()?.active === false) {
    throw new HttpsError('permission-denied', 'Esta cuenta está desactivada.');
  }
  await db.doc(`users/${request.auth.uid}`).set({ lastAccessAt: FieldValue.serverTimestamp() }, { merge: true });
  await audit(request.auth.uid, 'LOGIN', 'auth', request.auth.uid);
  return { ok: true, email: user.email || '' };
});

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
    await batch.commit();
    await audit(request.auth!.uid, 'CREATE_USER', 'user', created.uid, { email: created.email, role: safeRole });
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
  if (uid === request.auth!.uid && role !== 'admin') throw new HttpsError('failed-precondition', 'No puedes quitarte el rol de administrador.');
  if (role !== 'admin' && (await countAdmins()) <= 1) throw new HttpsError('failed-precondition', 'Debe existir al menos un administrador.');
  const target = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, { ...(target.customClaims || {}), role });
  await db.doc(`users/${uid}`).set({ role }, { merge: true });
  await audit(request.auth!.uid, 'UPDATE_USER', 'user', uid, { role });
  return { ok: true };
});

export const setManagedUserActive = onCall(async request => {
  requireAdmin(request);
  const { uid, active } = request.data ?? {};
  if (typeof uid !== 'string' || typeof active !== 'boolean') throw new HttpsError('invalid-argument', 'Usuario o estado no válidos.');
  if (uid === request.auth!.uid && !active) throw new HttpsError('failed-precondition', 'No puedes desactivar tu propia cuenta.');
  if (!active && (await countAdmins()) <= 1) {
    const target = await auth.getUser(uid);
    if (target.customClaims?.role === 'admin') throw new HttpsError('failed-precondition', 'Debe existir al menos un administrador activo.');
  }
  await auth.updateUser(uid, { disabled: !active });
  await db.doc(`users/${uid}`).set({ active }, { merge: true });
  await audit(request.auth!.uid, 'UPDATE_USER', 'user', uid, { active });
  return { ok: true };
});

export const deleteManagedUser = onCall(async request => {
  requireAdmin(request);
  const { uid } = request.data ?? {};
  if (typeof uid !== 'string' || uid === request.auth!.uid) throw new HttpsError('invalid-argument', 'No puedes eliminar tu propia cuenta de administrador.');
  const target = await auth.getUser(uid);
  if (target.customClaims?.role === 'admin' && (await countAdmins()) <= 1) throw new HttpsError('failed-precondition', 'Debe existir al menos un administrador.');
  await auth.deleteUser(uid);
  await db.doc(`users/${uid}`).delete();
  await db.doc(`userPermissions/${uid}`).delete();
  await audit(request.auth!.uid, 'DELETE_USER', 'user', uid);
  return { ok: true };
});

export const updateManagedPermissions = onCall(async request => {
  requireAdmin(request);
  const { uid, modules } = request.data ?? {};
  if (typeof uid !== 'string') throw new HttpsError('invalid-argument', 'Usuario no válido.');
  validateModules(modules);
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
    if (!user.email) throw new Error('El usuario no tiene correo.');
    const link = await auth.generatePasswordResetLink(user.email);
    await audit(request.auth!.uid, 'UPDATE_USER', 'user', uid, { action: 'PASSWORD_RESET_REQUESTED' });
    return { email: user.email, resetLink: link };
  } catch (error: any) {
    throw new HttpsError('internal', error?.message || 'No se pudo generar el restablecimiento de contraseña.');
  }
});
