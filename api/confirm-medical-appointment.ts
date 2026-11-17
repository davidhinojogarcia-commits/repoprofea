import { reportOperationalError } from '../src/lib/operationalLog.js';
import { createHash } from 'node:crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://oanurwzoymkmwmxoyzqi.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';

const fail = (res: any, status: number, message: string) => res.status(status).json({ ok: false, message });

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Método no permitido.');
  }
  if (!SERVICE_KEY) return fail(res, 503, 'La confirmación automática no está configurada en el servidor.');

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const token = String(body.token || '').trim();
    const status = String(body.status || '').trim().toLowerCase();
    if (token.length < 32) return fail(res, 400, 'El enlace de confirmación no es válido.');
    if (!['confirmada', 'no_puede_asistir'].includes(status)) return fail(res, 400, 'La respuesta no es válida.');

    const hash = createHash('sha256').update(token).digest('hex');
    const query = new URLSearchParams();
    query.set('select', 'owner_id,id,cita_dia,cita_hora,data');
    query.set('data->>confirmacionCitaTokenHash', `eq.${hash}`);
    query.set('limit', '1');

    const found = await fetch(`${SUPABASE_URL}/rest/v1/trabajadores?${query.toString()}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!found.ok) return fail(res, 500, 'No se pudo validar el enlace de confirmación.');
    const rows = await found.json();
    const worker = Array.isArray(rows) ? rows[0] : null;
    if (!worker) return fail(res, 404, 'El enlace de confirmación no es válido o ya no corresponde a una cita activa.');

    const data = worker.data && typeof worker.data === 'object' ? worker.data : {};
    const expires = Date.parse(String(data.confirmacionCitaTokenExpira || ''));
    if (!Number.isFinite(expires) || expires < Date.now()) return fail(res, 410, 'El enlace de confirmación ha caducado.');
    if (String(data.confirmacionCitaTokenDia || '') !== String(worker.cita_dia || '') || String(data.confirmacionCitaTokenHora || '') !== String(worker.cita_hora || '')) {
      return fail(res, 409, 'La cita ha cambiado desde que se envió este enlace. Utiliza el mensaje más reciente.');
    }

    const nextData = {
      ...data,
      confirmacionCitaEstado: status,
      confirmacionCitaFecha: new Date().toISOString(),
      confirmacionCitaOrigen: 'enlace_trabajador',
    };
    const patch = new URLSearchParams();
    patch.set('owner_id', `eq.${worker.owner_id}`);
    patch.set('id', `eq.${worker.id}`);
    const updated = await fetch(`${SUPABASE_URL}/rest/v1/trabajadores?${patch.toString()}`, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ data: nextData, updated_at: new Date().toISOString() }),
    });
    if (!updated.ok) return fail(res, 500, 'No se pudo registrar la respuesta de la cita.');

    return res.status(200).json({ ok: true, status });
  } catch (error) {
    reportOperationalError('[medical-confirmation-api]', error);
    return fail(res, 500, 'No se pudo registrar la respuesta.');
  }
}
