from pathlib import Path

# 1) Subcontratas: direct Supabase service, no Firebase auth/service aliases.
p = Path('components/SubcontratasSection.tsx')
s = p.read_text()
s = s.replace("import { auth } from '../src/lib/firebase';\nimport { createDocument, deleteDocument, updateDocument, subscribeToDocuments } from '../src/services/firestoreService';\nimport type { Unsubscribe } from 'firebase/firestore';", "import { createDocument, deleteDocument, updateDocument, subscribeToDocuments } from '../src/services/databaseService';", 1)
s = s.replace("    if (!auth.currentUser || suppressSubPersistenceRef.current || !hydratedSubcontratasRef.current) return;", "    if (suppressSubPersistenceRef.current || !hydratedSubcontratasRef.current) return;", 1)
s = s.replace("await createDocument('subcontractors', item.id, item as any)", "await createDocument('subcontratas', item.id, item as any)")
s = s.replace("await updateDocument('subcontractors', item.id, item as any)", "await updateDocument('subcontratas', item.id, item as any)")
s = s.replace("await deleteDocument('subcontractors', old.id)", "await deleteDocument('subcontratas', old.id)")
s = s.replace("      console.error('Error guardando subcontratas en Firestore:', error);\n      onToast('No se pudieron guardar los cambios de subcontratas en Firebase.', 'error');", "      console.error('Error guardando subcontratas en Supabase:', error);\n      onToast('No se pudieron guardar los cambios de subcontratas en Supabase.', 'error');", 1)
s = s.replace("    const uid = auth.currentUser?.uid;\n    if (!uid) return;\n    const unsubscribe: Unsubscribe = subscribeToDocuments<Subcontratista>('subcontractors', items => {", "    const unsubscribe = subscribeToDocuments<Subcontratista>('subcontratas', items => {", 1)
s = s.replace("      console.error('Error leyendo subcontratas de Firestore:', error);\n      onToast('No se pudieron cargar las subcontratas desde Firebase.', 'error');", "      console.error('Error leyendo subcontratas de Supabase:', error);\n      onToast('No se pudieron cargar las subcontratas desde Supabase.', 'error');", 1)
p.write_text(s)

# 2) App registration: persist first in Supabase, then update UI and show success.
p = Path('App.tsx')
s = p.read_text()
start = s.find("  const handleRegister = (personData: Omit<Person, 'id' | 'fechaRegistro'>) => {")
end = s.find("\n\n  const commitAddMultipleWorkers = async (", start)
if start < 0 or end < 0:
    raise SystemExit('No se encontró handleRegister legacy')
old = s[start:end]
new = """  const handleRegister = async (personData: Omit<Person, 'id' | 'fechaRegistro'>) => {\n    // Si la persona ya estuvo registrada anteriormente sin formación, se actualiza a 'Sí'\n    const cleanDni = personData.dni ? personData.dni.trim().toUpperCase().replace(/[\\s-]/g, '') : '';\n    const cleanName = personData.apellidosNombre ? personData.apellidosNombre.trim().toLowerCase() : '';\n    const hadPreviousNoFormacion = people.some(p => {\n      const pDni = p.dni ? p.dni.trim().toUpperCase().replace(/[\\s-]/g, '') : '';\n      const pName = p.apellidosNombre ? p.apellidosNombre.trim().toLowerCase() : '';\n      const match = (cleanDni && pDni === cleanDni) || (cleanName && pName === cleanName);\n      return match && (p.formacion === 'No' || p.formacion === 'Sin formación' || !p.formacion);\n    });\n\n    const finalPersonData = hadPreviousNoFormacion ? { ...personData, formacion: 'Sí' } : personData;\n    const newPerson: Person = {\n      ...finalPersonData,\n      id: Date.now() + Math.floor(Math.random() * 100000) + 1,\n      fechaRegistro: new Date().toISOString(),\n      sincronizadoEnNube: true\n    };\n\n    try {\n      await createDocument('workers', newPerson.id, newPerson as any);\n    } catch (error) {\n      console.error('Error guardando trabajador en Supabase:', error);\n      setToast({ message: 'No se ha podido guardar el trabajador en la base de datos.', type: 'error' });\n      return;\n    }\n\n    setPeopleWithHistory(prev => [...prev, newPerson]);\n    updateAutocompleteLists(finalPersonData);\n    setToast({ message: 'Registro guardado correctamente', type: 'success' });\n  };"""
s = s[:start] + new + s[end:]
# The import flow no longer depends on legacy sync flags merely to set a status marker.
s = s.replace("    const isAutoSync = (isSyncing || !!googleUser?.uid || !!currentEffectiveWorkspaceId) && syncMode === 'auto' && !isOffline;\n", "", 1)
s = s.replace("      sincronizadoEnNube: isAutoSync\n", "      sincronizadoEnNube: true\n", 1)
p.write_text(s)
