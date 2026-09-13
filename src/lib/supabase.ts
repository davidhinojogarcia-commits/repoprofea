import { createClient, type User } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://oanurwzoymkmwmxoyzqi.supabase.co';
// La publishable key de Supabase está diseñada para usarse en clientes públicos.
// Se mantiene la variable de entorno como primera opción y esta clave como respaldo
// para evitar que la aplicación falle antes de montar React si Vercel no la inyecta.
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_bvx-RBb1Kvz9sfo0LXY3iQ_WHzw6ee2';
const STORAGE_KEY = 'profea-supabase-auth';
const LEGACY_STORAGE_KEY = 'profea-supabase-session';

// Elimina únicamente el antiguo contenedor manual de access/refresh tokens.
// La sesión vigente queda desde ahora bajo el almacenamiento gestionado por supabase-js.
if (typeof window !== 'undefined') {
  try { window.localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* noop */ }
}

export type SupabaseUser = User & { uid: string };

export const normalizeSupabaseUser = (user: User): SupabaseUser => ({
  ...user,
  uid: user.id,
});

const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: STORAGE_KEY,
  },
});

async function getAccessToken(): Promise<string | null> {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session?.access_token || null;
}

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const token = await getAccessToken();
  const headers = new Headers(options.headers);
  headers.set('apikey', SUPABASE_KEY);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const error: any = new Error(data?.msg || data?.message || data?.error_description || data?.error || `Supabase HTTP ${response.status}`);
    error.status = response.status;
    error.code = data?.code || data?.error_code;
    throw error;
  }
  return data;
}

async function edgeFunctionErrorMessage(error: any): Promise<string> {
  try {
    const response = error?.context;
    if (response && typeof response.clone === 'function') {
      const cloned = response.clone();
      const text = await cloned.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          return parsed?.error || parsed?.message || parsed?.msg || error?.message || 'La operación no se pudo completar.';
        } catch {
          return text;
        }
      }
    }
  } catch {
    // Conserva el mensaje original si no se puede leer la respuesta de la Edge Function.
  }
  return error?.message || 'La operación no se pudo completar.';
}

export const supabase = {
  get url() { return SUPABASE_URL; },
  get key() { return SUPABASE_KEY; },
  auth: client.auth,
  storage: client.storage,
  channel(name: string) {
    return client.channel(name);
  },
  removeChannel(channel: ReturnType<typeof client.channel>) {
    return client.removeChannel(channel);
  },
  async query(table: string, options: { method?: string; query?: string; body?: any; prefer?: string } = {}) {
    const headers: Record<string, string> = {};
    if (options.prefer) headers.Prefer = options.prefer;
    return request(`/rest/v1/${table}${options.query ? `?${options.query}` : ''}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  },
  async rpc(name: string, body: any = {}) {
    const { data, error } = await client.rpc(name, body);
    if (error) throw error;
    return data;
  },
  async edgeFunction(name: string, body: any) {
    const { data, error } = await client.functions.invoke(name, { body });
    if (error) {
      const friendly = new Error(await edgeFunctionErrorMessage(error));
      (friendly as any).cause = error;
      throw friendly;
    }
    return data;
  },
};

export { SUPABASE_URL, SUPABASE_KEY, STORAGE_KEY };
