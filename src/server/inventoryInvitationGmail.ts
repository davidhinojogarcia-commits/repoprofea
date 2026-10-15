import { PUBLIC_KEY, SERVICE_KEY, SUPABASE_URL, decryptToken, getConnection, refreshGoogleAccessToken, touchSent, type AuthenticatedUser } from './gmailOAuth.js';

const fail = (message: string, status: number, code: string) => Object.assign(new Error(message), { status, code });
const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function rows(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: init.headers || headers });
  if (!response.ok && url.includes('/rpc/inventory_list_park_shares') && [400, 401, 403].includes(response.status)) throw fail('Ya no tienes permisos para compartir este parque.', 403, 'INVENTORY_INVITE_FORBIDDEN');
  if (!response.ok) throw fail('No se pudo comprobar la invitación. Inténtalo de nuevo.', 503, 'INVENTORY_INVITE_LOOKUP_FAILED');
  const result = await response.json();
  if (!Array.isArray(result)) throw fail('No se pudo comprobar la invitación.', 503, 'INVENTORY_INVITE_LOOKUP_FAILED');
  return result;
}

export async function sendInventoryInvitationGmail(user: AuthenticatedUser, authorization: string, invitationId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invitationId)) throw fail('La invitación no es válida.', 400, 'INVENTORY_INVITE_INVALID');
  const params = new URLSearchParams({ select: 'id,park_id,invited_user_id,invited_email,invited_by,status', id: `eq.${invitationId}`, invited_by: `eq.${user.id}`, status: 'eq.pending', limit: '1' });
  const [invitation] = await rows(`${SUPABASE_URL}/rest/v1/inventory_park_invitations?${params}`);
  if (!invitation || invitation.invited_by !== user.id || invitation.status !== 'pending') throw fail('La invitación no está pendiente o no te pertenece.', 404, 'INVENTORY_INVITE_UNAVAILABLE');
  const profileParams = new URLSearchParams({ select: 'id,email,active', id: `in.(${user.id},${invitation.invited_user_id})` });
  const [shares, profiles] = await Promise.all([
    rows(`${SUPABASE_URL}/rest/v1/rpc/inventory_list_park_shares`, { method: 'POST', headers: { apikey: PUBLIC_KEY, Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_park_id: invitation.park_id }) }),
    rows(`${SUPABASE_URL}/rest/v1/profiles?${profileParams}`),
  ]);
  const caller = profiles.find(profile => profile.id === user.id && profile.active === true);
  const recipient = profiles.find(profile => profile.id === invitation.invited_user_id && profile.active === true);
  const member = shares.find(share => share.user_id === user.id && share.status === 'accepted' && (share.is_owner === true || share.role === 'responsable'));
  if (!caller || !member) throw fail('Ya no tienes permisos para compartir este parque.', 403, 'INVENTORY_INVITE_FORBIDDEN');
  const to = String(invitation.invited_email || '').trim();
  if (!recipient || String(recipient.email).toLowerCase() !== to.toLowerCase() || !/^[^@\s,<>]+@[^@\s,<>]+\.[^@\s,<>]+$/.test(to)) throw fail('El destinatario ha cambiado o no está activo. Revisa la invitación antes de enviarla.', 409, 'INVENTORY_INVITE_RECIPIENT_CHANGED');
  const connection = await getConnection(user.id);
  if (!connection?.refresh_token_encrypted) throw fail('Conecta la cuenta Gmail del supervisor en Configuración y vuelve a enviar la invitación.', 409, 'GMAIL_NOT_CONNECTED');
  if (!String(connection.scope || '').split(/\s+/).some(scope => ['gmail.send', 'https://www.googleapis.com/auth/gmail.send', 'https://mail.google.com/'].includes(scope))) throw fail('Renueva la autorización de Gmail en Configuración para permitir el envío.', 403, 'GMAIL_SEND_PERMISSION_REQUIRED');
  const accessToken = await refreshGoogleAccessToken(decryptToken(connection.refresh_token_encrypted));
  // Only a trusted server setting may change the destination, never request input/Host.
  const app = new URL(process.env.INVENTORY_APP_URL || 'https://gestionprofea.vercel.app/');
  if (app.protocol !== 'https:' || app.username || app.password) throw fail('La dirección de la aplicación necesita revisión.', 503, 'INVENTORY_INVITE_URL_INVALID');
  const target = new URL('/', app.origin);
  target.searchParams.set('inventoryInvite', invitation.id);
  const subject = Buffer.from('GestionProfea · Invitación al parque', 'utf8').toString('base64');
  const body = ['Te han invitado a compartir un parque de herramientas y maquinaria en GestionProfea.', '', 'Abre este enlace e inicia sesión con el correo al que se ha dirigido esta invitación:', target.toString(), '', 'En Herramientas y maquinaria, pulsa «Aceptar y compartir».', 'El enlace no concede acceso automáticamente. La invitación requiere tu aceptación y el acceso permanecerá hasta su revocación.'].join('\n');
  const mime = [`To: ${to}`, `Subject: =?UTF-8?B?${subject}?=`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', Buffer.from(body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'), ''].join('\r\n');
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: Buffer.from(mime, 'utf8').toString('base64url') }) });
  const sent = await response.json().catch(() => ({}));
  if (response.status === 401) throw fail('Google ha rechazado la autorización de Gmail. Renuévala en Configuración.', 401, 'GMAIL_RECONNECT_REQUIRED');
  if (response.status === 403 && sent?.error?.errors?.some((error: any) => error.reason === 'insufficientPermissions')) throw fail('Renueva Gmail en Configuración para autorizar el envío.', 403, 'GMAIL_SEND_PERMISSION_REQUIRED');
  if (response.status === 429) throw fail('Gmail ha limitado temporalmente los envíos. Inténtalo más tarde.', 429, 'GMAIL_RATE_LIMITED');
  if (!response.ok || typeof sent.id !== 'string' || !sent.id.trim()) throw fail('Gmail no confirmó el envío. Comprueba Enviados antes de reintentarlo.', 502, 'GMAIL_INVITE_SEND_UNCONFIRMED');
  await touchSent(user.id);
  return { ok: true, delivery: 'sent', provider: 'gmail', messageId: sent.id, from: connection.email };
}
