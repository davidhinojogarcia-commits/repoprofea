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
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const channel = supabase.channel(`worker-pair-${id}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'worker_card_pair_results', filter: `session_id=eq.${id}` }, (payload: any) => {
      const worker = Number(payload.new?.worker_id); const event = Number(payload.new?.id);
      if (Number.isSafeInteger(worker) && Number.isSafeInteger(event)) onWorker(worker, event);
    }).subscribe(status => {
      if (status === 'SUBSCRIBED') readyResolve();
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') readyReject(new Error('Canal no disponible'));
      onStatus(status);
    });
  return { ready, unsubscribe: () => { void supabase.removeChannel(channel as any); } };
}
