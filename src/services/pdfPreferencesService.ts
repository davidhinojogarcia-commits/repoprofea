import { supabase } from '../lib/supabase';
import type { PdfCustomConfig } from '../../types';

async function requireUser() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('No hay una sesión autenticada.');
  return data.user;
}

export async function loadPdfPreferences(): Promise<Partial<PdfCustomConfig>> {
  const user = await requireUser();
  const rows = await supabase.query('user_settings', {
    query: `user_id=eq.${encodeURIComponent(user.id)}&select=settings&limit=1`,
  });
  const value = rows?.[0]?.settings?.pdfPreferences;
  return value && typeof value === 'object' ? value : {};
}

export async function savePdfPreferences(value: Partial<PdfCustomConfig>): Promise<void> {
  await requireUser();
  await supabase.rpc('patch_user_settings', {
    p_patch: { pdfPreferences: value },
  });
}
