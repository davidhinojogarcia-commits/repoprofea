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

const INITIAL_ADMIN_EMAIL = 'davidhinojogarcia@gmail.com';

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
    // The first admin can be provisioned automatically, but do not call the
    // bootstrap function on every subsequent login once the claim exists.
    if (normalizedEmail === INITIAL_ADMIN_EMAIL) {
      const token = await credential.user.getIdTokenResult();
      const role = token.claims.role;
      if (role !== 'admin') {
        await bootstrapFirstAdmin({});
        await credential.user.getIdToken(true);
      }
    }

    // Keep last-access/audit data server-side. If this fails, do not leave a
    // partially authenticated session active in the UI.
    await touchLogin({});
    return credential.user;
  } catch (error) {
    await signOut(auth).catch(() => {});
    throw error;
  }
}

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

export function authErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Correo electrónico o contraseña incorrectos.';
    case 'auth/user-disabled':
      return 'Esta cuenta está desactivada. Contacta con un administrador.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
    case 'auth/network-request-failed':
      return 'Error de conexión con Firebase. Comprueba tu conexión a internet.';
    case 'functions/permission-denied':
      return 'La cuenta no tiene permisos de administrador configurados.';
    case 'functions/failed-precondition':
      return 'La configuración inicial de la cuenta no se ha podido completar.';
    case 'functions/not-found':
    case 'functions/unavailable':
      return 'Firebase Auth ha aceptado el acceso, pero el servicio de autorización del servidor no está disponible. Hay que desplegar las Cloud Functions.';
    case 'functions/internal':
      return 'Firebase Auth ha aceptado el acceso, pero no se pudo completar la configuración del usuario en el servidor.';
    default:
      return 'No se ha podido iniciar sesión. Inténtalo de nuevo.';
  }
}
