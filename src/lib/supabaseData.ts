import { normalizeSupabaseUser, supabase, type SupabaseUser } from './supabase';

// Estado mínimo compartido para los módulos que todavía leen el usuario autenticado.
// Toda la persistencia y renovación de sesión la gestiona el SDK oficial de Supabase.
export const auth = { currentUser: null as SupabaseUser | null };

const authSubscription = supabase.auth.onAuthStateChange((_event, session) => {
  auth.currentUser = session?.user ? normalizeSupabaseUser(session.user) : null;
});

// INITIAL_SESSION initializes this state. An additional getUser request can
// resolve after SIGNED_OUT/account switch and resurrect the previous identity.

export const disposeSupabaseDataAuth = () => authSubscription.data.subscription.unsubscribe();
