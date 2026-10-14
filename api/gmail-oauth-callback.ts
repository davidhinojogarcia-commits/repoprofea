import { reportOperationalError } from '../src/lib/operationalLog.js';
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  apiError,
  encryptToken,
  getConnection,
  decryptToken,
  refreshGoogleAccessToken,
  oauthRedirectUri,
  upsertConnection,
  verifyOAuthState,
} from '../src/server/gmailOAuth.js';

const redirectWithResult = (res: any, ok: boolean, message: string) => {
  const params = new URLSearchParams({
    gmail: ok ? 'connected' : 'error',
    gmail_message: message,
  });
  res.statusCode = 302;
  res.setHeader('Location', `/?${params.toString()}`);
  res.end();
};

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Método no permitido.');
  }

  try {
    const code = String(req.query?.code || '').trim();
    const stateRaw = String(req.query?.state || '').trim();
    const oauthError = String(req.query?.error || '').trim();
    if (oauthError) return redirectWithResult(res, false, 'La autorización de Google fue cancelada.');
    if (!code || !stateRaw) return redirectWithResult(res, false, 'La respuesta de Google no es válida.');

    const state = verifyOAuthState(stateRaw);
    const redirectUri = oauthRedirectUri(req);
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const tokenData: any = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error('Google no pudo completar la autorización de Gmail.');
    }

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile: any = await profileResponse.json().catch(() => ({}));
    if (!profileResponse.ok || !profile.email) throw new Error('No se pudo verificar la cuenta de Google.');

    const googleEmail = String(profile.email).trim().toLowerCase();
    if (googleEmail !== state.expectedEmail) {
      throw new Error(`La cuenta autorizada (${googleEmail}) no coincide con el correo del supervisor (${state.expectedEmail}).`);
    }

    let refreshToken = String(tokenData.refresh_token || '').trim();
    if (!refreshToken) {
      const existing = await getConnection(state.uid);
      if (!existing?.refresh_token_encrypted || String(existing.email).toLowerCase() !== googleEmail) {
        throw new Error('Google no devolvió permiso permanente. Desconecta el acceso de GestionProfea en tu cuenta Google y vuelve a autorizar.');
      }
      // Google can omit a new refresh token. Never report success for the old,
      // revoked token or preserve stale scopes after granting read permission.
      await refreshGoogleAccessToken(decryptToken(existing.refresh_token_encrypted));
      await upsertConnection({
        userId: state.uid,
        email: googleEmail,
        refreshTokenEncrypted: existing.refresh_token_encrypted,
        scope: String(tokenData.scope || existing.scope || ''),
      });
      return redirectWithResult(res, true, `Gmail conectado correctamente: ${googleEmail}.`);
    }

    await upsertConnection({
      userId: state.uid,
      email: googleEmail,
      refreshTokenEncrypted: encryptToken(refreshToken),
      scope: String(tokenData.scope || 'https://www.googleapis.com/auth/gmail.send'),
    });

    return redirectWithResult(res, true, `Gmail conectado correctamente: ${googleEmail}.`);
  } catch (error: any) {
    reportOperationalError('[gmail-oauth-callback]', error);
    return redirectWithResult(res, false, error?.message || 'No se pudo conectar Gmail.');
  }
}
