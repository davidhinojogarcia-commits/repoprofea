import {
  GOOGLE_CLIENT_ID,
  apiError,
  authenticateRequest,
  createOAuthState,
  decryptToken,
  deleteConnection,
  getConnection,
  oauthRedirectUri,
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
  try {
    requireServerConfig();
    const user = await authenticateRequest(req);
    const action = String(req.query?.action || '').trim();

    if (action === 'status' && req.method === 'GET') {
      const connection = await getConnection(user.id);
      return res.status(200).json({
        ok: true,
        connected: Boolean(connection),
        email: connection?.email || '',
        connectedAt: connection?.connected_at || null,
        lastSentAt: connection?.last_sent_at || null,
      });
    }

    if (action === 'start' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const expectedEmail = String(body.email || user.email).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(expectedEmail)) {
        return res.status(400).json({ ok: false, message: 'El correo del supervisor no es válido.' });
      }
      const redirectUri = oauthRedirectUri(req);
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        scope: [
          'openid',
          'email',
          'profile',
          'https://www.googleapis.com/auth/gmail.send',
        ].join(' '),
        state: createOAuthState(user, expectedEmail),
        login_hint: expectedEmail,
      });
      return res.status(200).json({
        ok: true,
        authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      });
    }

    if (action === 'disconnect' && req.method === 'DELETE') {
      const connection = await getConnection(user.id);
      if (connection?.refresh_token_encrypted) {
        try {
          const token = decryptToken(connection.refresh_token_encrypted);
          await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          });
        } catch (error) {
          console.warn('[gmail-disconnect] No se pudo revocar el token en Google; se elimina igualmente la conexión local.', error);
        }
      }
      await deleteConnection(user.id);
      return res.status(200).json({ ok: true });
    }

    if (action === 'send' && req.method === 'POST') {
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
        return res.status(409).json({
          ok: false,
          code: 'GMAIL_NOT_CONNECTED',
          message: 'Conecta primero la cuenta Gmail del supervisor en Configuración.',
        });
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
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ ok: false, message: 'Acción o método no permitido.' });
  } catch (error) {
    return apiError(res, error, 'No se pudo completar la operación con Gmail.');
  }
}
