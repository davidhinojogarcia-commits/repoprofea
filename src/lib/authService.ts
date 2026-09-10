import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';
import { bootstrapFirstAdmin, touchLogin } from './functions';

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

export async function signInWithEmail(email: string, password: string): Promise<User> {
  await configureAuthPersistence();
  const normalizedEmail = email.trim().toLowerCase();
  const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);

  try {
    // The first account is created in Firebase Auth by the owner/admin. The callable
    // backend then promotes only the configured INITIAL_ADMIN_EMAIL to the first admin.
    let token = await credential.user.getIdTokenResult();
    if (token.claims.role !== 'admin' && token.claims.role !== 'user') {
      try {
        await bootstrapFirstAdmin({});
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (code !== 'functions/permission-denied' && code !== 'functions/failed-precondition') {
          throw error;
        }
      }

      // Claims are written server-side, so the client must force a fresh token before
      // deciding whether this account is authorized to enter the application.
      await credential.user.getIdToken(true);
      token = await credential.user.getIdTokenResult(true);
    }

    const role = token.claims.role;
    if (role !== 'admin' && role !== 'user') {
      throw Object.assign(new Error('La cuenta existe en Firebase Auth, pero todavía no tiene un rol de aplicación.'), {
        code: 'auth/missing-role',
      });
    }

    await touchLogin({});
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
  const token = await user.getIdTokenResult();
  const role = token.claims.role;
  return role === 'admin' || role === 'user' ? role : null;
}

export async function getUserProfile(): Promise<AuthProfile | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const token = await user.getIdTokenResult();
  const role = token.claims.role;
  if (role !== 'admin' && role !== 'user') return null;
  return {
    uid: user.uid,
    email: user.email || '',
    role,
    active: !user.disabled,
    nombre: user.displayName || undefined,
  };
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

export async function bootstrapAdminIfNeeded(): Promise<void> {
  await bootstrapFirstAdmin({});
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
      return 'La cuenta está creada, pero todavía no tiene un rol autorizado. Comprueba la configuración del administrador inicial.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
    case 'auth/network-request-failed':
      return 'Error de conexión con Firebase. Comprueba tu conexión a internet.';
    case 'functions/permission-denied':
      return 'La cuenta no tiene permisos suficientes para completar la operación.';
    case 'functions/failed-precondition':
      return 'La configuración inicial de Firebase no se ha podido completar.';
    case 'functions/not-found':
    case 'functions/unavailable':
      return 'El servicio de autorización del servidor no está disponible. Hay que desplegar las Cloud Functions.';
    case 'functions/internal':
      return 'Firebase Auth ha aceptado el acceso, pero el servidor no pudo completar la operación.';
    default:
      return 'No se ha podido iniciar sesión. Inténtalo de nuevo.';
  }
}