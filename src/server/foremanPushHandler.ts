import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { createHash } from 'node:crypto';

export function allowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(u.hostname);
  } catch { return false; }
}

type Dependencies = { client: (jwt: string) => any; send: typeof webpush.sendNotification; env: NodeJS.ProcessEnv };
export function createForemanPushHandler(deps: Dependencies) {
  return async (req: any, res: any) => {
    res.setHeader('Cache-Control', 'no-store');
    const publicKey = deps.env.FOREMAN_PUSH_VAPID_PUBLIC_KEY;
    const privateKey = deps.env.FOREMAN_PUSH_VAPID_PRIVATE_KEY;
    const subject = deps.env.FOREMAN_PUSH_VAPID_SUBJECT;
    const configured = Boolean(publicKey && privateKey && subject);
    if (req.method === 'GET') return res.status(200).json({ configured, publicKey: configured ? publicKey : null });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    const jwt = String(req.headers.authorization || '').match(/^Bearer (\S+)$/)?.[1];
    if (!jwt) return res.status(401).json({ error: 'Sesión necesaria' });
    try {
      const client = deps.client(jwt);
      const { data: auth, error: authError } = await client.auth.getUser(jwt);
      if (authError || !auth?.user) return res.status(401).json({ error: 'Sesión no válida' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body?.documentId || '')) return res.status(400).json({ error: 'Documento no válido' });
      if (!configured) return res.status(200).json({ status: 'unconfigured', accepted: 0, failed: 0 });
      const { data: batch, error } = await client.rpc('claim_foreman_document_push', { p_document_id: body.documentId });
      if (error) return res.status(403).json({ error: 'No se pudo autorizar el aviso de este documento' });
      let accepted = Number(batch.accepted || 0), failed = Number(batch.failed || 0);
      const labels: Record<string,string> = {inicio:'Inicio / Incorporación',control_presencia:'Control de presencia',epis:'Entrega de EPIs',formacion:'Formación',maquinaria:'Maquinaria',autorizacion_uso_maquinaria:'Autorización de maquinaria'};
      const pending = batch.deliveries || [];
      // Bounded fan-out; every result is persisted before reporting acceptance.
      for (let offset = 0; offset < pending.length; offset += 4) {
        await Promise.all(pending.slice(offset, offset + 4).map(async (delivery: any) => {
          let statusCode = 0;
          if (allowedPushEndpoint(delivery.endpoint)) {
            try {
              const response = await deps.send({ endpoint: delivery.endpoint, keys: delivery.keys }, JSON.stringify({
                title: `Nuevo documento · ${String(batch.obra).slice(0, 100)}`,
                body: `${labels[batch.documentType] || 'Documento nuevo'}. Periodo: ${String(batch.period || 'sin periodo').slice(0, 60)}. Ábrelo para revisarlo.`,
                url: `/encargados?document=${body.documentId}`, documentId: body.documentId,
                tag: `foreman-${body.documentId}`, kind: 'FOREMAN_DOCUMENT_AVAILABLE',
              }), { vapidDetails: { subject: subject!, publicKey: publicKey!, privateKey: privateKey! }, TTL: 86400, timeout: 8000,
                topic: createHash('sha256').update(`${body.documentId}:${batch.assignedAt}`).digest('base64url').slice(0, 32) });
              statusCode = response.statusCode;
            } catch (error: any) { statusCode = Number(error?.statusCode || 0); }
          }
          const { error: finishError } = await client.rpc('finish_foreman_document_push', {
            p_delivery_id: delivery.id, p_lease: delivery.lease, p_status_code: statusCode,
          });
          if (!finishError && statusCode >= 200 && statusCode < 300) accepted++; else failed++;
        }));
      }
      return res.status(200).json({ status: failed ? 'partial' : batch.total === 0 ? 'no_devices' : batch.inFlight > 0 ? 'pending' : 'accepted', accepted, failed, total: batch.total });
    } catch { return res.status(503).json({ error: 'No se pudo confirmar el aviso móvil. El documento conserva su estado.' }); }
  };
}
export const foremanPushHandler = createForemanPushHandler({
  env: process.env, send: webpush.sendNotification,
  client: jwt => createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://oanurwzoymkmwmxoyzqi.supabase.co',
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_bvx-RBb1Kvz9sfo0LXY3iQ_WHzw6ee2',
    { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } }),
});
