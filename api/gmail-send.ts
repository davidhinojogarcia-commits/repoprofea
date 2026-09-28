import {
  apiError,
  authenticateRequest,
  decryptToken,
  getConnection,
  refreshGoogleAccessToken,
  requireServerConfig,
  touchSent,
} from '../src/server/gmailOAuth';

const cleanHeader = (value: unknown) => String(value || '').replace(/[\r\n]+/g, ' ').trim();
const encodeHeader = (value: string) => `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
const wrapBase64 = (value: string) => value.replace(/(.{76})/g, '$1\r\n');

function buildMime(input: {
  to: string;
  subject: string;
  body: string;
  filename: string;
  pdfBase64: string;
}) {
  const boundary = `profea_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const filename = cleanHeader(input.filename || 'documento.pdf').replace(/"/g, '');
  const subject = encodeHeader(cleanHeader(input.subject));
  return [
    `To: ${cleanHeader(input.to)}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(String(input.body || ''), 'utf8').toString('base64')),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${filename}"`,
    '',
    wrapBase64(input.pdfBase64),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Método no permitido.' });
  }

  try {
    requireServerConfig();
    const user = await authenticateRequest(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const to = String(body.to || '').trim();
    const subject = String(body.subject || '').trim();
    const messageBody = String(body.body || '');
    const filename = String(body.filename || 'documento.pdf').trim();
    const pdfBase64 = String(body.pdfBase64 || '').replace(/^data:application\/pdf;base64,/, '').trim();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+(?:\s*,\s*[^@\s]+@[^@\s]+\.[^@\s]+)*$/.test(to)) {
      return res.status(400).json({ ok: false, message: 'El destinatario no es válido.' });
    }
    if (!subject) return res.status(400).json({ ok: false, message: 'El asunto está vacío.' });
    if (!pdfBase64) return res.status(400).json({ ok: false, message: 'No se ha recibido el PDF adjunto.' });
    if (pdfBase64.length > 14 * 1024 * 1024) {
      return res.status(413).json({ ok: false, message: 'El PDF es demasiado grande para enviarlo desde GestionProfea.' });
    }

    const connection = await getConnection(user.id);
    if (!connection?.refresh_token_encrypted) {
      return res.status(409).json({ ok: false, code: 'GMAIL_NOT_CONNECTED', message: 'Conecta primero la cuenta Gmail del supervisor en Configuración.' });
    }

    const refreshToken = decryptToken(connection.refresh_token_encrypted);
    const accessToken = await refreshGoogleAccessToken(refreshToken);
    const mime = buildMime({ to, subject, body: messageBody, filename, pdfBase64 });
    const raw = Buffer.from(mime, 'utf8').toString('base64url');

    const sendResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });
    const sent: any = await sendResponse.json().catch(() => ({}));
    if (!sendResponse.ok || !sent.id) {
      console.error('[gmail-send] Google response:', sent);
      throw new Error('Gmail no pudo enviar el correo. Revisa la autorización de la cuenta.');
    }

    await touchSent(user.id);
    return res.status(200).json({
      ok: true,
      messageId: sent.id,
      threadId: sent.threadId || null,
      from: connection.email,
    });
  } catch (error) {
    return apiError(res, error, 'No se pudo enviar el correo mediante Gmail.');
  }
}
