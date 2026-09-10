from pathlib import Path

p = Path('server.ts')
s = p.read_text()
s = s.replace('import { databaseStore } from "./server/databaseStore";\n', '')
s = s.replace('import { accountStore } from "./server/accountStore";\n', '')
start_marker = '  // --- REAL-TIME MULTI-DEVICE DATABASE SYNC ENDPOINTS ---\n'
end_marker = '  // API endpoint to recognize and extract worker details from document pages\n'
start = s.find(start_marker)
end = s.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('No se encontró bloque legacy database/auth')
s = s[:start] + end_marker + s[end + len(end_marker):]
for forbidden in ('databaseStore', 'accountStore', '/api/database/', '/api/auth/'):
    if forbidden in s:
        raise SystemExit(f'Quedó referencia legacy en server.ts: {forbidden}')
p.write_text(s)

for path in ['server/databaseStore.ts', 'server/accountStore.ts']:
    f = Path(path)
    if f.exists():
        f.unlink()
