from pathlib import Path
import re

p = Path('App.tsx')
s = p.read_text()

s = s.replace("import { createDocument, updateDocument } from './src/services/databaseService';", "import { createDocument, updateDocument, subscribeToDocuments } from './src/services/databaseService';")

old_offline = '''  useEffect(() => {\n    const handleOnline = () => {\n      setIsOffline(false);\n      setToast({ message: 'Conexión recuperada.', type: 'success' });\n    };\n    const handleOffline = () => {\n      setIsOffline(true);\n      setToast({ message: 'Sin conexión a internet. Los cambios se aplicarán cuando se recupere la conexión.', type: 'error' });\n    };\n    window.addEventListener('online', handleOnline);\n    window.addEventListener('offline', handleOffline);\n    return () => {\n      window.removeEventListener('online', handleOnline);\n      window.removeEventListener('offline', handleOffline);\n    };\n  }, []);\n'''
s = s.replace(old_offline, '')

old_workers = '''  // Firestore is the permanent source of truth.\n  useEffect(() => {\n    const uid = auth.currentUser?.uid;\n    if (!uid) return;\n    const unsubscribe = subscribeToAccountWorkers(uid, workers => {\n      setPeople(workers.map(w => ({ ...w, sincronizadoEnNube: true })));\n    }, error => {\n      console.error('Error leyendo trabajadores de Firestore:', error);\n      setToast({ message: 'Error al leer los trabajadores desde Firebase.', type: 'error' });\n    });\n    return () => unsubscribe();\n  }, []);\n'''
new_workers = '''  // Supabase es la única fuente de verdad de trabajadores.\n  useEffect(() => {\n    if (!auth.currentUser?.uid) return;\n    const unsubscribe = subscribeToDocuments<Person>('workers', workers => {\n      setPeople(workers.map(worker => ({ ...worker, sincronizadoEnNube: true })));\n    }, { includeShared: true }, error => {\n      console.error('Error leyendo trabajadores de Supabase:', error);\n      setToast({ message: 'Error al leer los trabajadores desde Supabase.', type: 'error' });\n    });\n    return () => unsubscribe();\n  }, []);\n'''
if old_workers not in s:
    raise SystemExit('No se encontró el bloque legacy de lectura de trabajadores')
s = s.replace(old_workers, new_workers)

# Depura exclusivamente nombres no usados del gran import legacy de ./src/lib/firebase.
# Se conserva cualquier símbolo con al menos una referencia real fuera del propio import.
pattern = re.compile(r"import \{\n(?P<body>.*?)\n\} from './src/lib/firebase';", re.S)
for m in list(pattern.finditer(s)):
    body = m.group('body')
    names = []
    for raw in body.split(','):
        name = raw.strip()
        if not name or '\n' in name:
            continue
        names.append(name)
    if len(names) < 8:
        continue
    keep = []
    for name in names:
        ident = name.split(' as ')[-1].strip()
        # Más de una aparición = import + uso real.
        if len(re.findall(rf'\b{re.escape(ident)}\b', s)) > 1:
            keep.append(name)
    replacement = "import {\n  " + ",\n  ".join(keep) + "\n} from './src/lib/firebase';" if keep else ''
    s = s[:m.start()] + replacement + s[m.end():]
    break

p.write_text(s)
