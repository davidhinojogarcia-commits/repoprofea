import { apiError, authenticateRequest, getConnection, requireServerConfig } from '../src/server/gmailOAuth';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: 'Método no permitido.' });
  }
  try {
    requireServerConfig();
    const user = await authenticateRequest(req);
    const connection = await getConnection(user.id);
    return res.status(200).json({
      ok: true,
      connected: Boolean(connection),
      email: connection?.email || '',
      connectedAt: connection?.connected_at || null,
      lastSentAt: connection?.last_sent_at || null,
    });
  } catch (error) {
    return apiError(res, error, 'No se pudo consultar la conexión Gmail.');
  }
}
