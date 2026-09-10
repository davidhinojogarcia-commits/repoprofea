from pathlib import Path
import re

app = Path('App.tsx')
s = app.read_text()

s = s.replace("import { createDocument, updateDocument, subscribeToDocuments } from './src/services/databaseService';", "import { createDocument, updateDocument, deleteDocument, subscribeToDocuments } from './src/services/databaseService';")

# Papelera: dejar de hidratar/persistir datos de negocio desde localStorage.
s = re.sub(
    r"  const \[deletedPeople, setDeletedPeople\] = useState<DeletedPerson\[\]>\(\(\) => \{.*?\n  \}\);",
    "  const [deletedPeople, setDeletedPeople] = useState<DeletedPerson[]>([]);",
    s,
    count=1,
    flags=re.S,
)

worker_effect_end = "  }, []);\n\n\n  const [searchTerm, setSearchTerm]"
trash_effect = """  }, []);\n\n  // La papelera también se lee automáticamente desde Supabase.\n  useEffect(() => {\n    if (!auth.currentUser?.uid) return;\n    const unsubscribe = subscribeToDocuments<DeletedPerson>('trash', items => {\n      setDeletedPeople(items);\n    }, { includeShared: true }, error => {\n      console.error('Error leyendo la papelera de Supabase:', error);\n      setToast({ message: 'Error al leer la papelera desde Supabase.', type: 'error' });\n    });\n    return () => unsubscribe();\n  }, []);\n\n\n  const [searchTerm, setSearchTerm]"""
if worker_effect_end not in s:
    raise SystemExit('No se encontró el final del listener de trabajadores')
s = s.replace(worker_effect_end, trash_effect, 1)

# Eliminar los dos listeners legacy que copiaban catálogos/subcontratas a workspaces Firestore.
s, n1 = re.subn(
    r"  // Auto-sync catalogs and settings to user workspace in Firestore\n  useEffect\(\(\) => \{.*?\n  \}, \[currentEffectiveWorkspaceId, googleUser\?\.uid, isOffline, savedObras, savedLugares, savedSitios, savedTelefonos, savedCategorias, workStartHour, workEndHour\]\);\n",
    "",
    s,
    count=1,
    flags=re.S,
)
s, n2 = re.subn(
    r"  // Real-time listener for local subcontratas changes to sync to workspace\n  useEffect\(\(\) => \{.*?\n  \}, \[currentEffectiveWorkspaceId, isOffline, savedObras, savedLugares, savedSitios, savedTelefonos, savedCategorias, workStartHour, workEndHour\]\);\n",
    "",
    s,
    count=1,
    flags=re.S,
)
if n1 != 1 or n2 != 1:
    raise SystemExit(f'No se eliminaron listeners legacy: settings={n1}, subcontratas={n2}')

# Los trabajadores/papelera ya no se escriben en localStorage como backend paralelo.
s = re.sub(r"\n  useEffect\(\(\) => \{\n    localStorage\.setItem\('personasPROFEA', JSON\.stringify\(people\)\);\n  \}, \[people\]\);\n", "\n", s, count=1)
s = re.sub(r"\n  useEffect\(\(\) => \{\n    localStorage\.setItem\('personasEliminadasPROFEA', JSON\.stringify\(deletedPeople\)\);\n  \}, \[deletedPeople\]\);\n", "\n", s, count=1)

# Sustituir CRUD de papelera/workspace por operaciones directas Supabase.
def replace_between(text, start, end, replacement):
    a = text.find(start)
    if a < 0: raise SystemExit(f'No encontrado: {start}')
    b = text.find(end, a)
    if b < 0: raise SystemExit(f'No encontrado final: {end}')
    return text[:a] + replacement + text[b:]

new_delete = """  const handleDelete = async (id: number) => {\n    const personToDelete = people.find(p => p.id === id);\n    if (!personToDelete) return;\n    if (!window.confirm(`¿Está seguro de que desea enviar a la Papelera el registro de ${personToDelete.apellidosNombre}? Se almacenará allí durante 30 días.`)) return;\n\n    const deletedObj: DeletedPerson = { person: personToDelete, fechaEliminacion: new Date().toISOString() };\n    try {\n      await createDocument('trash', id, deletedObj as any);\n      await deleteDocument('workers', id);\n      setToast({ message: 'Registro enviado a la Papelera correctamente', type: 'success' });\n    } catch (error) {\n      console.error('Error enviando trabajador a papelera en Supabase:', error);\n      setToast({ message: 'No se pudo enviar el registro a la Papelera.', type: 'error' });\n    }\n  };\n\n"""
s = replace_between(s, "  const handleDelete = (id: number) => {", "  const handleDeleteMultiple =", new_delete)

new_multi = """  const handleDeleteMultiple = async (ids: number[]) => {\n    if (!ids?.length) return;\n    if (!window.confirm(`¿Está seguro de que desea enviar ${ids.length} registros a la Papelera? Se almacenarán allí durante 30 días.`)) return;\n    const peopleToDelete = people.filter(p => ids.includes(p.id));\n    const fechaEliminacion = new Date().toISOString();\n    try {\n      for (const person of peopleToDelete) {\n        await createDocument('trash', person.id, { person, fechaEliminacion } as any);\n        await deleteDocument('workers', person.id);\n      }\n      setToast({ message: `${peopleToDelete.length} registros enviados a la Papelera correctamente`, type: 'success' });\n    } catch (error) {\n      console.error('Error en baja múltiple de Supabase:', error);\n      setToast({ message: 'No se pudieron enviar todos los registros a la Papelera.', type: 'error' });\n    }\n  };\n\n"""
s = replace_between(s, "  const handleDeleteMultiple =", "  const handleRestorePerson =", new_multi)

new_restore = """  const handleRestorePerson = async (id: number) => {\n    const foundDeleted = deletedPeople.find(dp => dp.person.id === id);\n    if (!foundDeleted) return;\n    try {\n      await createDocument('workers', id, foundDeleted.person as any);\n      await deleteDocument('trash', id);\n      setToast({ message: `Registro de ${foundDeleted.person.apellidosNombre} restaurado correctamente`, type: 'success' });\n    } catch (error) {\n      console.error('Error restaurando trabajador desde Supabase:', error);\n      setToast({ message: 'No se pudo restaurar el registro.', type: 'error' });\n    }\n  };\n\n"""
s = replace_between(s, "  const handleRestorePerson =", "  const handlePermanentDelete =", new_restore)

new_perm = """  const handlePermanentDelete = async (id: number) => {\n    const foundDeleted = deletedPeople.find(dp => dp.person.id === id);\n    if (!foundDeleted) return;\n    if (!window.confirm(`¿Está seguro de que desea eliminar permanentemente el registro de ${foundDeleted.person.apellidosNombre}? Esta acción no se puede deshacer.`)) return;\n    try {\n      await deleteDocument('trash', id);\n      setToast({ message: 'Registro eliminado definitivamente', type: 'success' });\n    } catch (error) {\n      console.error('Error eliminando definitivamente en Supabase:', error);\n      setToast({ message: 'No se pudo eliminar definitivamente el registro.', type: 'error' });\n    }\n  };\n\n"""
s = replace_between(s, "  const handlePermanentDelete =", "  const handleEdit =", new_perm)

app.write_text(s)

# Corregir campo date para reconocimientos: nunca enviar cadena vacía a PostgreSQL date.
db = Path('src/services/databaseService.ts')
d = db.read_text()
d = d.replace("    validez: value.validez || value.reconocimientoValidez || '', centro_medico:", "    validez: dateOrNull(value.validez || value.reconocimientoValidez), centro_medico:")
if d == db.read_text():
    raise SystemExit('No se aplicó corrección de validez')
db.write_text(d)
