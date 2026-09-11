import { supabase, type SupabaseUser } from './supabase';

// Estado mínimo compartido para los módulos que todavía leen el usuario autenticado.
// Toda la persistencia de negocio vive en servicios Supabase específicos.
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
