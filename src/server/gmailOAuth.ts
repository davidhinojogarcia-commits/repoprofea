import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://oanurwzoymkmwmxoyzqi.supabase.co';
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
export const PUBLIC_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_bvx-RBb1Kvz9sfo0LXY3iQ_WHzw6ee2';

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID || '';
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET || '';
export const TOKEN_SECRET = process.env.GMAIL_TOKEN_ENCRYPTION_KEY || '';
export const STATE_SECRET = process.env.GMAIL_OAUTH_STATE_SECRET || TOKEN_SECRET;

export type AuthenticatedUser = { id: string; email: string };

const jsonHeaders = { 'Content-Type': 'application/json' };

export function getServerConfigStatus() {
  const missing: string[] = [];
  if (!SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!GOOGLE_CLIENT_ID) missing.push('GOOGLE_GMAIL_CLIENT_ID');
  if (!GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_GMAIL_CLIENT_SECRET');
  if (!TOKEN_SECRET) missing.push('GMAIL_TOKEN_ENCRYPTION_KEY');
  if (!STATE_SECRET) missing.push('GMAIL_OAUTH_STATE_SECRET');
  return { configured: missing.length === 0, missing };
}

export function requireServerConfig() {
  const status = getServerConfigStatus();
  if (!status.configured) {
    throw Object.assign(
      new Error('La conexión Gmail del servidor todavía no está configurada.'),
      { status: 503, code: 'GMAIL_SERVER_NOT_CONFIGURED', missing: status.missing },
    );
  }
}

export async function authenticateRequest(req: any): Promise<AuthenticatedUser> {
  const auth = String(req.headers?.authorization || '');
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw Object.assign(new Error('Sesión no válida.'), { status: 401 });

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw Object.assign(new Error('Sesión no válida o caducada.'), { status: 401 });
  const user: any = await response.json();
  const email = String(user?.email || '').trim().toLowerCase();
  if (!user?.id || !email) throw Object.assign(new Error('La cuenta autenticada no tiene correo electrónico.'), { status: 401 });
  return { id: String(user.id), email };
}

function serviceHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    ...jsonHeaders,
    ...extra,
  };
}

export async function getConnection(userId: string): Promise<any | null> {
  const params = new URLSearchParams({ select: '*', user_id: `eq.${userId}`, limit: '1' });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?${params.toString()}`, {
    headers: serviceHeaders(),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`No se pudo consultar la conexión Gmail. ${body}`);
  }
  const rows: any[] = await response.json();
  return rows[0] || null;
}

export async function upsertConnection(input: {
  userId: string;
  email: string;
  refreshTokenEncrypted: string;
  scope?: string;
}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?on_conflict=user_id`, {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({
      user_id: input.userId,
      email: input.email.toLowerCase(),
      refresh_token_encrypted: input.refreshTokenEncrypted,
      scope: input.scope || 'https://www.googleapis.com/auth/gmail.send',
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`No se pudo guardar la conexión Gmail. ${body}`);
  }
}

export async function deleteConnection(userId: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
  });
  if (!response.ok) throw new Error('No se pudo eliminar la conexión Gmail.');
}

export async function touchSent(userId: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  }).catch(() => undefined);
}

function keyFromSecret(secret: string) {
  return createHash('sha256').update(secret).digest();
}

export function encryptToken(value: string) {
  requireServerConfig();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(TOKEN_SECRET), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map(part => part.toString('base64url')).join('.');
}

export function decryptToken(value: string) {
  requireServerConfig();
  const [ivRaw, tagRaw, cipherRaw] = String(value || '').split('.');
  if (!ivRaw || !tagRaw || !cipherRaw) throw new Error('Token Gmail almacenado con formato no válido.');
  const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(TOKEN_SECRET), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

type OAuthState = {
  uid: string;
  expectedEmail: string;
  exp: number;
  nonce: string;
};

export function createOAuthState(user: AuthenticatedUser, expectedEmail: string): string {
  requireServerConfig();
  const payload: OAuthState = {
    uid: user.id,
    expectedEmail: expectedEmail.toLowerCase(),
    exp: Date.now() + 10 * 60 * 1000,
    nonce: randomBytes(16).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', STATE_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyOAuthState(state: string): OAuthState {
  requireServerConfig();
  const [encoded, signature] = String(state || '').split('.');
  if (!encoded || !signature) throw new Error('Estado OAuth no válido.');
  const expected = createHmac('sha256', STATE_SECRET).update(encoded).digest();
  const received = Buffer.from(signature, 'base64url');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error('Estado OAuth no válido.');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as OAuthState;
  if (!payload.uid || !payload.expectedEmail || !payload.exp || payload.exp < Date.now()) throw new Error('La autorización de Gmail ha caducado. Vuelve a iniciarla.');
  return payload;
}

const CANONICAL_GMAIL_OAUTH_REDIRECT_URI =
  'https://gestionprofea.vercel.app/api/gmail-oauth-callback';

export function oauthRedirectUri(req: any) {
  const configured = String(process.env.GMAIL_OAUTH_REDIRECT_URI || '').trim();
  if (configured) return configured;

  const proto = String(req.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  const host = String(req.headers?.host || '').trim();
  if (!host) throw new Error('No se pudo determinar la URL de retorno OAuth.');

  // En desarrollo local conservamos el callback del host actual. En cualquier
  // despliegue de Vercel usamos la URL canónica de producción para evitar que
  // previews, aliases o dominios temporales provoquen redirect_uri_mismatch.
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) {
    return `${proto}://${host}/api/gmail-oauth-callback`;
  }

  return CANONICAL_GMAIL_OAUTH_REDIRECT_URI;
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  requireServerConfig();
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  }).catch(()=>{throw Object.assign(new Error('Google no pudo renovar el acceso a Gmail en este momento.'),{status:503,code:'GMAIL_TEMPORARILY_UNAVAILABLE'});});
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    if (data.error === 'invalid_grant') {
      throw Object.assign(new Error('Google ha caducado o revocado el permiso de Gmail. Pulsa «Volver a autorizar Gmail» para recuperarlo.'), {
        status: 401, code: 'GMAIL_RECONNECT_REQUIRED',
      });
    }
    if (data.error === 'invalid_client' || data.error === 'unauthorized_client') {
      throw Object.assign(new Error('La configuración de Gmail del servidor necesita revisión. Inténtalo cuando se haya corregido.'), {
        status: 503, code: 'GMAIL_OAUTH_CONFIG_ERROR',
      });
    }
    throw Object.assign(new Error('Google no pudo renovar el acceso a Gmail en este momento. Inténtalo de nuevo.'), {
      status: 503, code: 'GMAIL_TEMPORARILY_UNAVAILABLE',
    });
  }
  return String(data.access_token);
}

export function apiError(res: any, error: any, fallback = 'No se pudo completar la operación.') {
  const status = Number(error?.status || 500);
  const code = String(error?.code || '');
  if (code === 'GMAIL_SERVER_NOT_CONFIGURED') {
    console.warn('[gmail-api] Módulo Gmail no configurado en este entorno.');
  } else if (status >= 500) {
    console.error('[gmail-api]', error);
  } else {
    console.warn('[gmail-api]', error?.message || error);
  }
  return res.status(status >= 400 && status < 600 ? status : 500).json({
    ok: false,
    code: code || undefined,
    message: error?.message || fallback,
  });
}
