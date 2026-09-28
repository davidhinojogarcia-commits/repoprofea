import {
  GOOGLE_CLIENT_ID,
  apiError,
  authenticateRequest,
  createOAuthState,
  oauthRedirectUri,
  requireServerConfig,
} from '../src/server/gmailOAuth';

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
  } catch (error) {
    return apiError(res, error, 'No se pudo iniciar la autorización de Gmail.');
  }
}
