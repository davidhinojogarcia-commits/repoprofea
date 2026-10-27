import { supabase } from '../lib/supabase';

function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hash(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function createCardPairing() {
  const secret = newSecret();
  const result = await supabase.rpc('worker_card_pair_create', { p_pair_hash: await hash(secret) });
  if (!result?.id || !result?.expires_at) throw new Error('No se pudo crear la vinculación.');
  return { id: String(result.id), expiresAt: String(result.expires_at), url: `${location.origin}/#card-pair=${secret}` };
}
export async function connectCardPairing(pairToken: string) {
  const secret = newSecret();
  const result = await supabase.rpc('worker_card_pair_connect', { p_pair_token: pairToken, p_mobile_hash: await hash(secret) });
  if (!result?.valid) throw new Error('Vinculación no válida o caducada.');
  return secret;
}
export async function sendPairedCard(secret: string, token: string) {
  return (await supabase.rpc('worker_card_pair_submit', { p_mobile_token: secret, p_worker_token: token })) === true;
}
export async function closeCardPairing(id: string) { await supabase.rpc('worker_card_pair_close', { p_id: id }); }
export function watchCardPairing(id: string, onWorker: (workerId: number, eventId: number) => void, onStatus: (status: string) => void) {
  let readyResolve: () => void = () => {};
  let readyReject: (error: Error) => void = () => {};
  let active = true;
  let latest = 0;
  let reconciling = false;
  let rerun = false;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const deliver = (row: any) => {
    const worker = Number(row?.worker_id); const event = Number(row?.id);
    if (!active || !Number.isSafeInteger(worker) || worker <= 0 || !Number.isSafeInteger(event) || event <= latest) return;
    latest = event;
    onWorker(worker, event);
  };
  // Only reconcile the newest result: stale events must not replace the latest
  // worker selected. Query the RLS-protected table after each reconnection.
  const reconcile = async () => {
    if (reconciling) { rerun = true; return; }
    reconciling = true;
    try {
      do {
        rerun = false;
        const rows = await supabase.query('worker_card_pair_results', {
          query: `session_id=eq.${encodeURIComponent(id)}&select=id,worker_id&order=id.desc&limit=1`,
          fresh: true, networkOnly: true,
        });
        if (active && Array.isArray(rows) && rows[0]) deliver(rows[0]);
      } while (active && rerun);
    } catch { if (active) onStatus('RECONCILE_ERROR'); }
    finally { reconciling = false; }
  };
  const channel = supabase.channel(`worker-pair-${id}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'worker_card_pair_results', filter: `session_id=eq.${id}` }, (payload: any) => deliver(payload.new))
    .subscribe(status => {
      if (!active) return;
      if (status === 'SUBSCRIBED') { readyResolve(); void reconcile(); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') readyReject(new Error('Canal no disponible'));
      onStatus(status);
    });
  return { ready, unsubscribe: () => { active = false; void supabase.removeChannel(channel as any); } };
}
