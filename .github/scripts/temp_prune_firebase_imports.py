from pathlib import Path
import re

p = Path('App.tsx')
s = p.read_text()

# Recorta únicamente imports nombrados procedentes del módulo legacy firebase.ts.
# El patrón no puede atravesar otros imports porque excluye llaves en el cuerpo.
pat = re.compile(r"import\s*\{(?P<body>[^{}]*)\}\s*from './src/lib/firebase';\n?", re.S)
matches = list(pat.finditer(s))
if not matches:
    raise SystemExit('No se encontraron imports de firebase.ts')

without = pat.sub('', s)
rebuilt = without
imports_to_insert = []
for m in matches:
    names = []
    for raw in m.group('body').split(','):
        item = raw.strip()
        if not item:
            continue
        if not re.match(r'^[A-Za-z_$][\w$]*(?:\s+as\s+[A-Za-z_$][\w$]*)?$', item):
            raise SystemExit(f'Import inesperado: {item!r}')
        local = item.split(' as ')[-1].strip()
        if re.search(rf'\b{re.escape(local)}\b', without):
            names.append(item)
    if names:
        imports_to_insert.extend(names)

imports_to_insert = list(dict.fromkeys(imports_to_insert))
if imports_to_insert:
    firebase_import = "import {\n  " + ",\n  ".join(imports_to_insert) + "\n} from './src/lib/firebase';\n"
    # Insertar después del import React inicial.
    react_end = rebuilt.find("\n", rebuilt.find("import React")) + 1
    rebuilt = rebuilt[:react_end] + firebase_import + rebuilt[react_end:]

rebuilt = rebuilt.replace('// Guarantee collision-free worker IDs across local state and cloud sync', '// Garantiza IDs numéricos únicos durante la compatibilidad con registros históricos')
p.write_text(rebuilt)
