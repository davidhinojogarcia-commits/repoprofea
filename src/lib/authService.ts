import { supabase, type SupabaseUser } from './supabase';
import { auth } from './firebase';

export type AppRole = 'admin' | 'user';
export interface AuthProfile {
  uid: string;
  email: string;
  nombre?: string;
  apellidos?: string;
  role: AppRole;
  active: boolean;
}
export type User = SupabaseUser;

export async function configureAuthPersistence(): Promise<void> {
  await supabase.auth.getSession();
}

async function readUserProfile(user: SupabaseUser): Promise<AuthProfile | null> {
  const rows = await supabase.query('profiles', {
    query: `select=id,email,nombre,apellidos,role,active&id=eq.${encodeURIComponent(user.id)}`,
  });
  const data = rows?.[0];
  if (!data || (data.role !== 'admin' && data.role !== 'user') || data.active !== true) return null;
  return {
    uid: user.id,
    email: data.email || user.email || '',
    nombre: data.nombre || '',
    apellidos: data.apellidos || '',
    role: data.role,
    active: true,
  };
}

async function runLegacyMigration(accessToken: string): Promise<void> {
  try {
    const response = await fetch('/api/migrate-legacy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Migración legacy automática:', body?.error || `HTTP ${response.status}`);
    }
  } catch (error) {
    console.error('Migración legacy automática:', error);
  }
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  await configureAuthPersistence();
  const normalizedEmail = email.trim().toLowerCase();
  try {
    const { data, error } = await supabase.auth.signInWithPassword(normalizedEmail, password);
    if (error) throw error;

    const profile = await readUserProfile(data.user);
    if (!profile) {
      await supabase.auth.signOut();
      throw Object.assign(
        new Error('La cuenta existe, pero no tiene un perfil activo autorizado en Supabase.'),
        { code: 'auth/missing-role' },
      );
    }

    await supabase.query('profiles', {
      method: 'PATCH',
      prefer: 'return=minimal',
      query: `id=eq.${encodeURIComponent(data.user.id)}`,
      body: { last_access_at: new Date().toISOString() },
    });

    await supabase.query('audit_logs', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        user_id: data.user.id,
        user_email: data.user.email || '',
        action: 'LOGIN',
        resource_type: 'auth',
        resource_id: data.user.id,
        details: {},
      },
    }).catch(() => {});

    auth.currentUser = data.user;

    if (profile.role === 'admin') {
      const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
      if (accessToken) void runLegacyMigration(accessToken);
    }

    return data.user;
  } catch (error) {
    await supabase.auth.signOut().catch(() => {});
    auth.currentUser = null;
    throw error;
  }
}

export const signInWithEmailPassword = signInWithEmail;

export async function signOutUser() {
  await supabase.auth.signOut();
  auth.currentUser = null;
}

export function subscribeToAuth(callback: (user: User | null) => void) {
  const sub = supabase.auth.onAuthStateChange(user => {
    auth.currentUser = user;
    callback(user);
  });
  return () => sub.data.subscription.unsubscribe();
}

export async function getCurrentRole(): Promise<AppRole | null> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return null;
  const profile = await readUserProfile(user);
  return profile?.role || null;
}

export async function getUserProfile(): Promise<AuthProfile | null> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return null;
  return readUserProfile(user);
}

export async function sendResetPassword(_email: string): Promise<void> {
  throw Object.assign(
    new Error('El restablecimiento de contraseña debe gestionarlo un administrador.'),
    { code: 'auth/admin-only-password-reset' },
  );
}

export async function registerEmailPassword(): Promise<never> {
  throw Object.assign(new Error('El registro público está deshabilitado.'), { code: 'auth/operation-not-allowed' });
}

export function authErrorMessage(error: unknown): string {
  const code = (error as any)?.code;
  const status = (error as any)?.status;
  if (code === 'invalid_credentials' || code === 'invalid_grant' || status === 400) return 'Correo electrónico o contraseña incorrectos.';
  if (code === 'auth/missing-role') return 'La cuenta está creada, pero no tiene un perfil activo autorizado en Supabase.';
  if (code === 'user_banned') return 'Esta cuenta está desactivada. Contacta con un administrador.';
  if (code === 'auth/network-request-failed') return 'Error de conexión con Supabase. Comprueba tu conexión a internet.';
  if (status === 401 || status === 403) return 'La cuenta no tiene permisos suficientes para completar la operación.';
  return 'No se ha podido iniciar sesión. Inténtalo de nuevo.';
}
