import type { AuthChangeEvent } from '@supabase/supabase-js';
import { getSessionUser, normalizeSupabaseUser, supabase, type SupabaseUser } from './supabase';
import { auth } from './supabaseData';

export type AppRole = 'admin' | 'user';
export interface AuthProfile {
  uid: string;
  email: string;
  nombre?: string;
  apellidos?: string;
  telefono?: string;
  role: AppRole;
  active: boolean;
}
export type User = SupabaseUser;

export async function configureAuthPersistence(): Promise<void> {
  await supabase.auth.getSession();
}

async function readUserProfile(user: SupabaseUser): Promise<AuthProfile | null> {
  const rows = await supabase.query('profiles', {
    query: `select=id,email,nombre,apellidos,telefono,role,active&id=eq.${encodeURIComponent(user.id)}`,
  });
  const data = rows?.[0];
  if (!data || (data.role !== 'admin' && data.role !== 'user') || data.active !== true) return null;
  return {
    uid: user.id,
    email: data.email || user.email || '',
    nombre: data.nombre || '',
    apellidos: data.apellidos || '',
    telefono: data.telefono || '',
    role: data.role,
    active: true,
  };
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  await configureAuthPersistence();
  const normalizedEmail = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });
  if (error) throw error;
  if (!data.user) throw new Error('Supabase no devolvió un usuario autenticado.');

  const user = normalizeSupabaseUser(data.user);
  const profile = await readUserProfile(user);
  if (!profile) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    auth.currentUser = null;
    throw Object.assign(
      new Error('La cuenta existe, pero no tiene un perfil activo autorizado en Supabase.'),
      { code: 'auth/missing-role' },
    );
  }

  // Una sola escritura por login confirmado. La RPC únicamente puede actualizar
  // last_access_at del usuario autenticado, sin exponer otros campos del perfil.
  // Si la migración todavía no está aplicada, el acceso continúa funcionando.
  await supabase.rpc('mark_own_last_access').catch((error) => {
    console.warn('No se pudo registrar el último acceso; comprueba la migración de Supabase.', error);
  });

  await supabase.query('audit_logs', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      user_id: user.id,
      user_email: user.email || '',
      action: 'LOGIN',
      resource_type: 'auth',
      resource_id: user.id,
      details: {},
    },
  }).catch(() => undefined);

  auth.currentUser = user;
  return user;
}

export const signInWithEmailPassword = signInWithEmail;

export async function signOutUser() {
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;
  auth.currentUser = null;
}

export function subscribeToAuth(callback: (user: User | null, event: AuthChangeEvent) => void) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user ? normalizeSupabaseUser(session.user) : null;
    auth.currentUser = user;
    callback(user, event);
  });
  return () => data.subscription.unsubscribe();
}

export async function getCurrentRole(): Promise<AppRole | null> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return null;
  const profile = await readUserProfile(normalizeSupabaseUser(sessionUser));
  return profile?.role || null;
}

export async function getUserProfile(): Promise<AuthProfile | null> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return null;
  return readUserProfile(normalizeSupabaseUser(sessionUser));
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
