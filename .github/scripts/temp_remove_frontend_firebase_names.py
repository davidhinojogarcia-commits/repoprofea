from pathlib import Path
import re

root = Path('.')
old = Path('src/lib/firebase.ts')
if not old.exists():
    raise SystemExit('No existe src/lib/firebase.ts')
content = old.read_text()
content = content.replace("// Capa temporal de compatibilidad para imports históricos. No usa Firebase SDK ni Firestore.", "// Adaptador de datos Supabase para trabajadores, papelera y ajustes.")
content = content.replace('sanitizeForFirestore', 'sanitizeForDatabase')
# La tabla normalizada trabajadores sustituye definitivamente a workers.
content = content.replace("supabase.query('workers'", "supabase.query('trabajadores'")
content = content.replace("select=owner_id,id&owner_id=", "select=owner_id,id&owner_id=")
# Completar las columnas tipadas además del JSON de compatibilidad.
old_worker_row = """function workerRow(p: Person, ownerId: string) {\n  const now = new Date().toISOString();\n  return {\n    owner_id: ownerId,\n    id: Number(p.id),\n    data: sanitizeForDatabase(p),\n    created_by: ownerId,\n    created_at: p.fechaRegistro || now,\n    updated_by: ownerId,\n    updated_at: now,\n  };\n}"""
new_worker_row = """function workerFields(p: Partial<Person>) {\n  return {\n    obra_id: (p as any).obraId || (p as any).obra_id || null,\n    supervisor_responsable: p.supervisorResponsable || '', num_oferta: p.numOferta || '', obra: p.obra || '',\n    categoria: p.categoria || '', quincena: p.quincena || '', apellidos_nombre: p.apellidosNombre || '', dni: p.dni || '',\n    fecha_nacimiento: p.fechaNacimiento || '', periodo_inicio: p.periodoInicio || '', periodo_fin: p.periodoFin || '',\n    telefono: p.telefono || '', calzado: p.calzado || '', formacion: p.formacion || '', lugar_formacion: p.lugarFormacion || null,\n    cita_dia: p.citaDia || '', cita_hora: p.citaHora || '', sitio_reconocimiento: p.sitioReconocimiento || '',\n    documentacion_completa: p.documentacionCompleta || '', observaciones: p.observaciones || null, fecha_registro: p.fechaRegistro || '',\n    necesita_reconocimiento: p.necesitaReconocimiento || null, aptitud_medica: p.aptitudMedica || null,\n    limitaciones_aptitud: p.limitacionesAptitud || null, reconocimiento_estado: p.reconocimientoEstado || null,\n    reconocimiento_fecha: p.reconocimientoFecha || null, reconocimiento_validez: p.reconocimientoValidez || null,\n    reconocimiento_limitaciones: p.reconocimientoLimitaciones || null, reconocimiento_observaciones: p.reconocimientoObservaciones || null,\n  };\n}\n\nfunction workerRow(p: Person, ownerId: string) {\n  const now = new Date().toISOString();\n  return {\n    owner_id: ownerId, id: Number(p.id), ...workerFields(p), data: sanitizeForDatabase(p),\n    created_by: ownerId, created_at: p.fechaRegistro || now, updated_by: ownerId, updated_at: now,\n  };\n}"""
if old_worker_row not in content:
    raise SystemExit('No se encontró workerRow esperado')
content = content.replace(old_worker_row, new_worker_row)
old_patch = "body: { data: merged, updated_by: ownerId, updated_at: new Date().toISOString() }"
new_patch = "body: { ...workerFields(merged), data: merged, updated_by: ownerId, updated_at: new Date().toISOString() }"
if old_patch not in content:
    raise SystemExit('No se encontró PATCH de trabajador esperado')
content = content.replace(old_patch, new_patch)
Path('src/lib/supabaseData.ts').write_text(content)

for p in list(root.rglob('*.ts')) + list(root.rglob('*.tsx')):
    if any(part in {'node_modules', '.git'} for part in p.parts):
        continue
    if p in {old, Path('src/lib/supabaseData.ts')}:
        continue
    s = p.read_text()
    before = s
    replacements = {
        "./src/lib/firebase'": "./src/lib/supabaseData'",
        '"./src/lib/firebase"': '"./src/lib/supabaseData"',
        "../src/lib/firebase'": "../src/lib/supabaseData'",
        '"../src/lib/firebase"': '"../src/lib/supabaseData"',
        "../lib/firebase'": "../lib/supabaseData'",
        '"../lib/firebase"': '"../lib/supabaseData"',
        "./lib/firebase'": "./lib/supabaseData'",
        '"./lib/firebase"': '"./lib/supabaseData"',
        "./firebase'": "./supabaseData'",
        '"./firebase"': '"./supabaseData"',
        "../src/services/firestoreService'": "../src/services/databaseService'",
        '"../src/services/firestoreService"': '"../src/services/databaseService"',
        "./src/services/firestoreService'": "./src/services/databaseService'",
        '"./src/services/firestoreService"': '"./src/services/databaseService"',
        "./firestoreService'": "./databaseService'",
        '"./firestoreService"': '"./databaseService"',
    }
    for a, b in replacements.items():
        s = s.replace(a, b)
    # Quitar el único tipo histórico de Firebase; las suscripciones locales devuelven una función cleanup.
    s = re.sub(r"^import\s+type\s+\{\s*Unsubscribe\s*\}\s+from\s+['\"]firebase/firestore['\"];?\s*$", "type Unsubscribe = () => void;", s, flags=re.M)
    s = s.replace('actualizado en Firebase Firestore.', 'actualizado en Supabase.')
    s = s.replace('actualizados en Firestore.', 'actualizados en Supabase.')
    s = s.replace('Error de Firestore', 'Error de Supabase')
    s = s.replace('error de Firestore', 'error de Supabase')
    s = s.replace('desde Firebase.', 'desde Supabase.')
    s = s.replace('desde Firestore.', 'desde Supabase.')
    s = s.replace('en Firebase.', 'en Supabase.')
    s = s.replace('en Firestore.', 'en Supabase.')
    if s != before:
        p.write_text(s)

old.unlink()
alias = Path('src/services/firestoreService.ts')
if alias.exists():
    alias.unlink()

schema = Path('src/db/schema.ts')
if schema.exists():
    s = schema.read_text().replace('authenticated via Firebase Auth', 'authenticated via Supabase Auth').replace('Firebase Auth UID', 'Supabase Auth user ID')
    schema.write_text(s)
