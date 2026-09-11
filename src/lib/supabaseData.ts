import { supabase, type SupabaseUser } from './supabase';

// Estado mínimo de compatibilidad para los pocos módulos que todavía leen el usuario actual.
// Toda la persistencia de negocio vive en los servicios Supabase específicos.
export const auth = { currentUser: null as SupabaseUser | null };

const authSubscription = supabase.auth.onAuthStateChange(user => {
  auth.currentUser = user;
});

void supabase.auth.getUser().then(({ data }) => {
  auth.currentUser = data.user;
}).catch(() => {
  auth.currentUser = null;
});

export const disposeSupabaseDataAuth = () => authSubscription.data.subscription.unsubscribe();

export const getAccessToken = async () =>
  (await supabase.auth.getSession()).data.session?.access_token || null;

export async function googleSignIn(): Promise<{ accessToken: string }> {
  throw new Error('Google Sign-In está deshabilitado. Usa correo electrónico y contraseña.');
}

export async function logoutGoogle() {
  await supabase.auth.signOut();
  auth.currentUser = null;
}
