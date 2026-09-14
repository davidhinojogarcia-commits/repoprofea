import type { IncomingMessage, ServerResponse } from 'http';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://oanurwzoymkmwmxoyzqi.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_bvx-RBb1Kvz9sfo0LXY3iQ_WHzw6ee2';

const send = (res: ServerResponse, status: number, data: any) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
};

const readBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
};

const normalizePhone = (value: unknown) => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9) digits = `34${digits}`;
  return digits;
};

const formatDate = (value: unknown) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '-');
};

async function getAuthorizedWorker(req: IncomingMessage, workerId: number) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) throw Object.assign(new Error('No autorizado.'), { status: 401 });

  const response = await fetch(`${SUPABASE_URL}/rest/v1/trabajadores?id=eq.${encodeURIComponent(String(workerId))}&select=*&limit=1`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: auth,
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw Object.assign(new Error('No se pudo verificar el trabajador.'), { status: response.status });
  const rows = await response.json();
  if (!rows?.[0]) throw Object.assign(new Error('Trabajador no encontrado o sin permiso.'), { status: 404 });
  return rows[0];
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido.' });

  try {
    const body = await readBody(req);
    const workerId = Number(body.workerId);
    const reminder = body.reminder === true;
    if (!Number.isFinite(workerId) || workerId <= 0) return send(res, 400, { error: 'Trabajador no válido.' });

    const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    const authToken = process.env.TWILIO_AUTH_TOKEN || '';
    const from = process.env.TWILIO_WHATSAPP_FROM || '';
    const contentSid = reminder
      ? (process.env.TWILIO_WHATSAPP_REMINDER_CONTENT_SID || '')
      : (process.env.TWILIO_WHATSAPP_APPOINTMENT_CONTENT_SID || '');

    if (!accountSid || !authToken || !from || !contentSid) {
      return send(res, 503, {
        error: 'WhatsApp Business interactivo aún no está configurado en producción.',
        code: 'WHATSAPP_NOT_CONFIGURED',
      });
    }

    const row = await getAuthorizedWorker(req, workerId);
    const data = row.data || {};
    const phone = normalizePhone(row.telefono || data.telefono);
    if (phone.length < 10) return send(res, 400, { error: 'El trabajador no tiene un teléfono válido.' });

    const name = String(row.apellidos_nombre || data.apellidosNombre || 'Trabajador/a').trim();
    const date = formatDate(row.cita_dia || data.citaDia);
    const time = String(row.cita_hora || data.citaHora || '-').slice(0, 5);
    const site = String(row.sitio_reconocimiento || data.sitioReconocimiento || '-').trim();
    const obra = String(row.obra || data.obra || '-').trim();
    const observations = String(row.observaciones || data.observaciones || 'Sin observaciones').trim() || 'Sin observaciones';

    const form = new URLSearchParams();
    form.set('To', `whatsapp:+${phone}`);
    form.set('From', from.startsWith('whatsapp:') ? from : `whatsapp:${from}`);
    form.set('ContentSid', contentSid);
    form.set('ContentVariables', JSON.stringify({
      '1': name,
      '2': date,
      '3': time,
      '4': site,
      '5': obra,
      '6': observations,
    }));

    const basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const twilio = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const payload = await twilio.json().catch(() => ({}));
    if (!twilio.ok) {
      console.error('[whatsapp-medical-send]', payload);
      return send(res, 502, { error: payload?.message || 'Twilio no pudo enviar el WhatsApp.', code: payload?.code });
    }

    return send(res, 200, {
      success: true,
      sid: payload.sid,
      status: payload.status,
      channel: 'whatsapp',
      interactive: true,
      reminder,
    });
  } catch (error: any) {
    console.error('[whatsapp-medical-send]', error);
    return send(res, error?.status || 500, { error: error?.message || 'No se pudo enviar el WhatsApp.' });
  }
}
