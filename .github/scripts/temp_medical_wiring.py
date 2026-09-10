from pathlib import Path

p = Path('App.tsx')
s = p.read_text()
s = s.replace("import { createDocument } from './src/services/databaseService';", "import { createDocument, updateDocument } from './src/services/databaseService';", 1)
anchor = "import { importWorkersAtomic } from './src/services/workerImportService';"
if "medicalRecognitionService" not in s:
    s = s.replace(anchor, anchor + "\nimport { persistMedicalRecognition } from './src/services/medicalRecognitionService';", 1)
old = '''                onUpdatePeople={(updatedPeople) => {\n                  setPeople(updatedPeople);\n                  \n                  // Sync individual changed workers to cloud if connected\n                  if (isSyncing && groupId.trim() && !isOffline) {\n                    const changed = updatedPeople.filter(p => {\n                      const original = people.find(o => o.id === p.id);\n                      return !original || JSON.stringify(original) !== JSON.stringify(p);\n                    });\n                    changed.forEach(p => {\n                      syncWorkerToCloud(groupId, { ...p, sincronizadoEnNube: true }).catch(err => {\n                        console.error("Error syncing during appointment update:", err);\n                      });\n                    });\n                  }\n                }}'''
new = '''                onUpdatePeople={(updatedPeople) => {\n                  const changed = updatedPeople.filter(p => {\n                    const original = people.find(o => o.id === p.id);\n                    return !original || JSON.stringify(original) !== JSON.stringify(p);\n                  });\n                  void Promise.all(changed.map(async p => {\n                    await updateDocument('workers', p.id, { ...p, sincronizadoEnNube: true } as any);\n                    await persistMedicalRecognition(p);\n                  })).then(() => {\n                    setPeople(updatedPeople.map(p => ({ ...p, sincronizadoEnNube: true })));\n                  }).catch(error => {\n                    console.error('Error guardando reconocimientos en Supabase:', error);\n                    setToast({ message: 'No se han podido guardar los cambios médicos en la base de datos.', type: 'error' });\n                  });\n                }}'''
if old not in s:
    raise SystemExit('medical update block not found')
s = s.replace(old, new, 1)
p.write_text(s)
