import {
  apiError,
  authenticateRequest,
  decryptToken,
  deleteConnection,
  getConnection,
  requireServerConfig,
} from '../src/server/gmailOAuth';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return res.status(405).json({ ok: false, message: 'Método no permitido.' });
  }
  try {
    requireServerConfig();
    const user = await authenticateRequest(req);
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
  } catch (error) {
    return apiError(res, error, 'No se pudo desconectar Gmail.');
  }
}
