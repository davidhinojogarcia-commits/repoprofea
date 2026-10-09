import { getSessionUser, supabase } from '../lib/supabase';

export type AuditAction = 'LOGIN';

/**
 * Auditoría mínima: solo registra accesos.
 * Cualquier evento distinto de LOGIN se ignora para no generar escrituras
 * adicionales ni consumo innecesario en Supabase.
 */
export async function writeAuditLog(
  action: string,
  resourceType = '',
  resourceId = '',
  details?: Record<string, unknown>,
) {
  if (action !== 'LOGIN') return;
  const user = await getSessionUser();
  if (!user) return;
  await supabase.query('audit_logs', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      user_id: user.id,
      user_email: user.email || '',
      action: 'LOGIN',
      resource_type: resourceType || 'auth',
      resource_id: resourceId || user.id,
      details: details || {},
    },
  });
}
