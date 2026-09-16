import { supabase } from '../lib/supabase';

export type RemoteScannerSession = {
  id: string;
  token: string;
  expiresAt: string;
  pairingUrl: string;
};

const TOKEN_STORAGE = 'profea-remote-scanner-token-v1';
const SESSION_STORAGE = 'profea-remote-scanner-session-v1';

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const randomToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
};

const endOfTodayIso = () => {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
};

const pairingUrlFor = (token: string) => `${window.location.origin}/?remote-scanner=${encodeURIComponent(token)}`;

export async function getOrCreateDailyRemoteScannerSession(): Promise<RemoteScannerSession> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) throw new Error('Debes iniciar sesión para vincular el escáner móvil.');

  const savedToken = localStorage.getItem(TOKEN_STORAGE) || '';
  const savedId = localStorage.getItem(SESSION_STORAGE) || '';
  if (savedToken && savedId) {
    try {
      const rows = await supabase.query('scanner_sessions', {
        query: `id=eq.${encodeURIComponent(savedId)}&owner_id=eq.${encodeURIComponent(user.id)}&status=eq.active&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,expires_at&limit=1`,
      });
      if (Array.isArray(rows) && rows[0]) {
        return { id: rows[0].id, token: savedToken, expiresAt: rows[0].expires_at, pairingUrl: pairingUrlFor(savedToken) };
      }
    } catch {
      // La migración puede no estar aplicada todavía; se tratará al crear la sesión.
    }
  }

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = endOfTodayIso();

  // Cerramos sesiones anteriores del usuario para evitar QR simultáneos no controlados.
  try {
    await supabase.query('scanner_sessions', {
      method: 'PATCH',
      query: `owner_id=eq.${encodeURIComponent(user.id)}&status=eq.active`,
      body: { status: 'closed' },
      prefer: 'return=minimal',
    });
  } catch {
    // Continúa: el insert devolverá un error más claro si falta la migración.
  }

  const created = await supabase.query('scanner_sessions', {
    method: 'POST',
    body: { owner_id: user.id, token_hash: tokenHash, expires_at: expiresAt, status: 'active' },
    prefer: 'return=representation',
  });
  const row = Array.isArray(created) ? created[0] : created;
  if (!row?.id) throw new Error('No se ha podido crear la sesión del escáner móvil.');

  localStorage.setItem(TOKEN_STORAGE, token);
  localStorage.setItem(SESSION_STORAGE, row.id);
  return { id: row.id, token, expiresAt: row.expires_at || expiresAt, pairingUrl: pairingUrlFor(token) };
}

export async function closeRemoteScannerSession(sessionId: string) {
  await supabase.query('scanner_sessions', {
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(sessionId)}`,
    body: { status: 'closed' },
    prefer: 'return=minimal',
  });
  localStorage.removeItem(TOKEN_STORAGE);
  localStorage.removeItem(SESSION_STORAGE);
}

export function subscribeToRemoteScannerCaptures(
  sessionId: string,
  onCapture: (capture: { id: string; imageData: string; fileName: string }) => void,
) {
  // Supabase no permite añadir callbacks postgres_changes después de subscribe().
  // Un topic único por montaje evita reutilizar accidentalmente un canal ya suscrito.
  const instanceId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = supabase
    .channel(`scanner-captures-${sessionId}-${instanceId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scanner_captures', filter: `session_id=eq.${sessionId}` }, async (payload: any) => {
      const row = payload.new;
      if (!row?.id || !row?.image_data) return;
      onCapture({ id: row.id, imageData: row.image_data, fileName: row.file_name || 'Captura_movil.jpg' });
      try {
        await supabase.query('scanner_captures', { method: 'DELETE', query: `id=eq.${encodeURIComponent(row.id)}` });
      } catch {
        // No bloquea la recepción; la limpieza puede repetirse más tarde.
      }
    })
    .subscribe();

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    void supabase.removeChannel(channel as any);
  };
}
