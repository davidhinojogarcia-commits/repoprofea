from pathlib import Path

server = Path('server.ts')
s = server.read_text()
line = 'import { syncFromFirestoreDatabase } from "./server/firestoreSync";\n'
if line not in s:
    raise SystemExit('No se encontró import de FirestoreSync')
if s.count('syncFromFirestoreDatabase') != 1:
    raise SystemExit('FirestoreSync aún tiene usos runtime; no se elimina automáticamente')
server.write_text(s.replace(line, '', 1))

legacy = Path('server/firestoreSync.ts')
if not legacy.exists():
    raise SystemExit('No existe server/firestoreSync.ts')
legacy.unlink()
