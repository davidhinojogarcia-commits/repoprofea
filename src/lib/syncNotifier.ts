// Compatibilidad temporal mientras se retiran llamadas legacy.
// Supabase persiste directamente; no existe sincronización manual que disparar.
export function notifyDatabaseSync(): void {
  // no-op intencionado
}
