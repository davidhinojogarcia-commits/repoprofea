import { createClient, type User } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://oanurwzoymkmwmxoyzqi.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const STORAGE_KEY = 'profea-supabase-auth';

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
  headers.set('Authorization', `Bearer ${token || SUPABASE_KEY}`);

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

export const supabase = {
  get url() { return SUPABASE_URL; },
  get key() { return SUPABASE_KEY; },
  auth: client.auth,
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
    if (error) throw error;
    return data;
  },
};

export { SUPABASE_URL, SUPABASE_KEY, STORAGE_KEY };
