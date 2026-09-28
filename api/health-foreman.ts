const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://oanurwzoymkmwmxoyzqi.supabase.co';
const PUBLIC_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_bvx-RBb1Kvz9sfo0LXY3iQ_WHzw6ee2';

async function probe(path: string, init: RequestInit = {}) {
  try {
    const response = await fetch(`${SUPABASE_URL}${path}`, {
      ...init,
      headers: {
        apikey: PUBLIC_KEY,
        Authorization: `Bearer ${PUBLIC_KEY}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, body: text.slice(0, 500) };
  } catch (error: any) {
    return { status: 0, ok: false, body: error?.message || String(error) };
  }
}

export default async function handler(_req: any, res: any) {
  const [mandatory, portal, gmailConnections, finalizeRpc] = await Promise.all([
    probe('/rest/v1/foreman_mandatory_documents?select=id&limit=1'),
    probe('/rest/v1/foreman_portal_access?select=id&limit=1'),
    probe('/rest/v1/gmail_connections?select=user_id&limit=1'),
    probe('/rest/v1/rpc/finalize_foreman_mandatory_document', {
      method: 'POST',
      body: JSON.stringify({ p_token: 'diagnostic-invalid', p_document_id: '00000000-0000-0000-0000-000000000000' }),
    }),
  ]);
  res.setHeader('Cache-Control','no-store');
  return res.status(200).json({ mandatory, portal, gmailConnections, finalizeRpc });
}
