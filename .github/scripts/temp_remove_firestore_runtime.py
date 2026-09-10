from pathlib import Path

server = Path('server.ts')
s = server.read_text()
line = 'import { syncFromFirestoreDatabase } from "./server/firestoreSync";\n'
if line not in s:
    raise SystemExit('No se encontró import de FirestoreSync')
s = s.replace(line, '', 1)

start_marker = '  // Endpoints for explicit and complete Firestore database synchronization\n'
end_marker = '  // --- USER AUTHENTICATION & MULTI-ACCOUNT MANAGEMENT ENDPOINTS ---\n'
start = s.find(start_marker)
end = s.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('No se encontró bloque de endpoints Firestore')
s = s[:start] + end_marker + s[end + len(end_marker):]
if 'syncFromFirestoreDatabase' in s or '/api/database/sync-from-firestore' in s or '/api/database/firestore-status' in s:
    raise SystemExit('Quedaron referencias Firestore en server.ts')
server.write_text(s)

legacy = Path('server/firestoreSync.ts')
if not legacy.exists():
    raise SystemExit('No existe server/firestoreSync.ts')
legacy.unlink()
