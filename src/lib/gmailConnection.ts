import { supabase } from './supabase';

export type GmailConnectionStatus = {
  connected: boolean;
  email: string;
  connectedAt?: string | null;
  lastSentAt?: string | null;
};

async function authHeaders(extra: Record<string, string> = {}) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('La sesión ha caducado. Vuelve a iniciar sesión.');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = await authHeaders(Object.fromEntries(new Headers(options.headers).entries()));
  const response = await fetch(url, { ...options, headers });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error: any = new Error(data?.message || 'No se pudo completar la operación con Gmail.');
    error.code = data?.code;
    error.status = response.status;
    throw error;
  }
  return data as T;
}

export async function getGmailConnectionStatus(): Promise<GmailConnectionStatus> {
  const result = await api<any>('/api/gmail?action=status', { method: 'GET' });
  return {
    connected: Boolean(result.connected),
    email: String(result.email || ''),
    connectedAt: result.connectedAt || null,
    lastSentAt: result.lastSentAt || null,
  };
}

export async function beginGmailOAuth(email: string) {
  const result = await api<any>('/api/gmail?action=start', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  if (!result.authorizationUrl) throw new Error('No se pudo generar el enlace de autorización de Gmail.');
  window.location.assign(result.authorizationUrl);
}

export async function disconnectGmail() {
  await api('/api/gmail?action=disconnect', { method: 'DELETE' });
}

const fileToBase64 = async (file: File) => {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < buffer.length; offset += chunk) {
    binary += String.fromCharCode(...buffer.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

export async function sendPdfWithConnectedGmail(input: {
  to: string;
  subject: string;
  body: string;
  file: File;
}) {
  const pdfBase64 = await fileToBase64(input.file);
  return api<{ ok: true; messageId: string; threadId?: string | null; from: string }>('/api/gmail?action=send', {
    method: 'POST',
    body: JSON.stringify({
      to: input.to,
      subject: input.subject,
      body: input.body,
      filename: input.file.name,
      pdfBase64,
    }),
  });
}
