import { getSessionUser, supabase } from '../lib/supabase';
export type SaeAlignmentDefault = { version: 1; ownerId: string; x: number; y: number };
export function parseSaeAlignmentDefault(value: unknown, ownerId: string): SaeAlignmentDefault | null {
  const v = value as Partial<SaeAlignmentDefault> | null;
  if (!v || v.version !== 1 || v.ownerId !== ownerId || typeof v.x !== 'number' || typeof v.y !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
  return { version: 1, ownerId, x: v.x, y: v.y };
}
export async function loadSaeAlignmentDefault(ownerId: string): Promise<SaeAlignmentDefault | null> {
  const rows = await supabase.query('user_settings', { query: `user_id=eq.${encodeURIComponent(ownerId)}&select=alignment:settings->saeReportAlignment&limit=1`, networkOnly: true });
  return parseSaeAlignmentDefault(rows?.[0]?.alignment, ownerId);
}
export async function saveSaeAlignmentDefault(x: number, y: number): Promise<void> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Las coordenadas SAE deben ser números válidos.');
  const user = await getSessionUser();
  if (!user) throw new Error('Debes iniciar sesión para guardar la posición predeterminada.');
  const value: SaeAlignmentDefault = {version:1, ownerId:user.id, x:Math.round(x*100)/100, y:Math.round(y*100)/100};
  const result = await supabase.rpc('patch_user_settings', {p_patch:{saeReportAlignment:value}});
  if ((await getSessionUser())?.id !== user.id) throw new Error('La cuenta ha cambiado. Vuelve a comprobar la posición.');
  const saved = parseSaeAlignmentDefault(result?.saeReportAlignment, user.id);
  if (!saved || saved.x !== value.x || saved.y !== value.y) throw new Error('No se pudo verificar la posición predeterminada. El ajuste del informe se conserva; vuelve a guardar.');
}
