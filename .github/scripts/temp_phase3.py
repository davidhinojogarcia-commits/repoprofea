from pathlib import Path

# Make the worker import truly atomic through the Supabase RPC.
p = Path('App.tsx')
s = p.read_text()
s = s.replace("import { createDocument } from './src/services/databaseService';", "import { createDocument } from './src/services/databaseService';\nimport { importWorkersAtomic } from './src/services/workerImportService';", 1)
old = """    try {\n      for (const person of formattedWorkers) {\n        await createDocument('workers', person.id, person as any);\n      }\n    } catch (error) {"""
new = """    try {\n      await importWorkersAtomic(formattedWorkers);\n    } catch (error) {"""
if old not in s:
    raise SystemExit('No se encontró el bucle de importación a reemplazar')
s = s.replace(old, new, 1)
p.write_text(s)

# Namespace child document IDs by their parent subcontrata to prevent template-ID collisions.
p = Path('src/services/databaseService.ts')
s = p.read_text()
old = "    const itemId = String(item.id || `${subcontrataId}_${index + 1}`);\n"
new = "    const sourceId = String(item.id || `item_${index + 1}`);\n    const itemId = `${subcontrataId}:${sourceId}`;\n"
if old not in s:
    raise SystemExit('No se encontró el identificador de checklist')
s = s.replace(old, new, 1)
p.write_text(s)
