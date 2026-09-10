from pathlib import Path

root = Path('.')
old = Path('src/lib/firebase.ts')
if not old.exists():
    raise SystemExit('No existe src/lib/firebase.ts')
content = old.read_text()
content = content.replace("// Capa temporal de compatibilidad para imports históricos. No usa Firebase SDK ni Firestore.", "// Adaptador de datos Supabase para el estado histórico de trabajadores, papelera y ajustes.")
content = content.replace('sanitizeForFirestore', 'sanitizeForDatabase')
Path('src/lib/supabaseData.ts').write_text(content)

# Cambia imports de la fachada Firebase a la fachada Supabase y los imports del alias Firestore
# al servicio de base de datos real.
for p in list(root.rglob('*.ts')) + list(root.rglob('*.tsx')):
    if any(part in {'node_modules', '.git'} for part in p.parts):
        continue
    if p in {old, Path('src/lib/supabaseData.ts')}:
        continue
    s = p.read_text()
    before = s
    s = s.replace("./src/lib/firebase'", "./src/lib/supabaseData'")
    s = s.replace('"./src/lib/firebase"', '"./src/lib/supabaseData"')
    s = s.replace("../src/lib/firebase'", "../src/lib/supabaseData'")
    s = s.replace('"../src/lib/firebase"', '"../src/lib/supabaseData"')
    s = s.replace("../lib/firebase'", "../lib/supabaseData'")
    s = s.replace('"../lib/firebase"', '"../lib/supabaseData"')
    s = s.replace("./lib/firebase'", "./lib/supabaseData'")
    s = s.replace('"./lib/firebase"', '"./lib/supabaseData"')
    s = s.replace("../src/services/firestoreService'", "../src/services/databaseService'")
    s = s.replace('"../src/services/firestoreService"', '"../src/services/databaseService"')
    s = s.replace("./src/services/firestoreService'", "./src/services/databaseService'")
    s = s.replace('"./src/services/firestoreService"', '"./src/services/databaseService"')
    s = s.replace("./firestoreService'", "./databaseService'")
    s = s.replace('"./firestoreService"', '"./databaseService"')
    # Mensajes visibles obsoletos.
    s = s.replace('actualizado en Firebase Firestore.', 'actualizado en Supabase.')
    s = s.replace('actualizados en Firestore.', 'actualizados en Supabase.')
    s = s.replace('Error de Firestore', 'Error de Supabase')
    s = s.replace('error de Firestore', 'error de Supabase')
    if s != before:
        p.write_text(s)

old.unlink()
alias = Path('src/services/firestoreService.ts')
if alias.exists():
    alias.unlink()

# Comentarios de esquema que aún describían Firebase Auth.
schema = Path('src/db/schema.ts')
if schema.exists():
    s = schema.read_text().replace('authenticated via Firebase Auth', 'authenticated via Supabase Auth').replace('Firebase Auth UID', 'Supabase Auth user ID')
    schema.write_text(s)
