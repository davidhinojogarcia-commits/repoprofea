from pathlib import Path

p = Path('src/lib/driveBackup.ts')
s = p.read_text()
anchor = "import { Person, DeletedPerson } from '../../types';"
imp = "import { buildSupabaseSystemBackup } from '../services/backupExportService';"
if imp not in s:
    s = s.replace(anchor, anchor + "\n" + imp, 1)

start = s.find('/**\n * Construye el objeto completo con todos los datos del sistema para respaldo\n */')
end = s.find('/**\n * Busca o crea una carpeta en Google Drive', start)
if start < 0 or end < 0:
    raise SystemExit('No se encontró bloque buildCompleteSystemBackup')
new = '''/**
 * Construye la copia completa leyendo directamente de Supabase.
 * Los parámetros históricos se conservan temporalmente para no romper la UI,
 * pero los datos empresariales nunca se toman del estado local.
 */
export async function buildCompleteSystemBackup(data: {
  people: Person[];
  deletedPeople: DeletedPerson[];
  savedObras: string[];
  savedLugares: string[];
  savedSitios: string[];
  savedTelefonos: string[];
  savedCategorias: string[];
  workStartHour?: string;
  workEndHour?: string;
  accountEmail?: string;
}) {
  return buildSupabaseSystemBackup(data.accountEmail || '');
}

'''
s = s[:start] + new + s[end:]
if "localStorage.getItem('profea_subcontratas_v1')" in s:
    raise SystemExit('Quedó lectura local de subcontratas en Drive backup')
p.write_text(s)

p = Path('App.tsx')
s = p.read_text()
old = '      const backupData = buildCompleteSystemBackup({' 
new = '      const backupData = await buildCompleteSystemBackup({' 
if old not in s:
    raise SystemExit('No se encontró llamada Drive backup en App')
s = s.replace(old, new, 1)
p.write_text(s)
