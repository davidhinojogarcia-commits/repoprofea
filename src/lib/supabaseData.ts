import { normalizeSupabaseUser, supabase, type SupabaseUser } from './supabase';

// Estado mínimo compartido para los módulos que todavía leen el usuario autenticado.
// Toda la persistencia y renovación de sesión la gestiona el SDK oficial de Supabase.
export const auth = { currentUser: null as SupabaseUser | null };

const authSubscription = supabase.auth.onAuthStateChange((_event, session) => {
  auth.currentUser = session?.user ? normalizeSupabaseUser(session.user) : null;
});

void supabase.auth.getUser().then(({ data }) => {
  auth.currentUser = data.user ? normalizeSupabaseUser(data.user) : null;
}).catch(() => {
  auth.currentUser = null;
});

export const disposeSupabaseDataAuth = () => authSubscription.data.subscription.unsubscribe();
