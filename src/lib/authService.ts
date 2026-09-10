import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

export type AppRole = 'admin' | 'user';

export interface AuthProfile {
  uid: string;
  email: string;
  nombre?: string;
  apellidos?: string;
  role: AppRole;
  active: boolean;
}

export async function configureAuthPersistence(): Promise<void> {
  await setPersistence(auth, browserLocalPersistence);
}

async function readUserProfile(user: User): Promise<AuthProfile | null> {
  const snapshot = await getDoc(doc(db, 'users', user.uid));
  if (!snapshot.exists()) return null;

  const data = snapshot.data() as Partial<AuthProfile> & { email?: string; active?: boolean; role?: string };
  if (data.role !== 'admin' && data.role !== 'user') return null;
  if (data.active !== true) return null;

  return {
    uid: user.uid,
    email: data.email || user.email || '',
    nombre: data.nombre,
    apellidos: data.apellidos,
    role: data.role,
    active: true,
  };
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  await configureAuthPersistence();
  const normalizedEmail = email.trim().toLowerCase();
  const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);

  try {
    // Firebase Authentication proves the identity; the user's Firestore profile is
    // the application's single source of truth for role and active status.
    const profile = await readUserProfile(credential.user);
    if (!profile) {
      throw Object.assign(new Error('La cuenta existe en Firebase Auth, pero no tiene un perfil de usuario autorizado en Firestore.'), {
        code: 'auth/missing-role',
      });
    }

    return credential.user;
  } catch (error) {
    await signOut(auth).catch(() => {});
    throw error;
  }
}

// Compatibility name kept for existing callers; both use the same email/password flow.
export const signInWithEmailPassword = signInWithEmail;

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export function subscribeToAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export async function getCurrentRole(): Promise<AppRole | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const profile = await readUserProfile(user);
  return profile?.role || null;
}

export async function getUserProfile(): Promise<AuthProfile | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return readUserProfile(user);
}

export async function sendResetPassword(_email: string): Promise<void> {
  // Public password reset is intentionally not exposed in the login UI.
  throw Object.assign(new Error('El restablecimiento de contraseña debe gestionarlo un administrador.'), {
    code: 'auth/admin-only-password-reset',
  });
}

export async function registerEmailPassword(): Promise<never> {
  throw Object.assign(new Error('El registro público está deshabilitado.'), { code: 'auth/operation-not-allowed' });
}

export function authErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Correo electrónico o contraseña incorrectos.';
    case 'auth/user-disabled':
      return 'Esta cuenta está desactivada. Contacta con un administrador.';
    case 'auth/missing-role':
      return 'La cuenta está creada, pero todavía no tiene un perfil autorizado en Firestore.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
    case 'auth/network-request-failed':
      return 'Error de conexión con Firebase. Comprueba tu conexión a internet.';
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'La cuenta no tiene permisos suficientes para completar la operación.';
    default:
      return 'No se ha podido iniciar sesión. Inténtalo de nuevo.';
  }
}