from pathlib import Path
import re

# App: trabajadores normalizados, CRUD directo y sin ramas de sincronización legacy.
p = Path('App.tsx')
s = p.read_text()
s = re.sub(r"import \{\n  syncWorkerToAccount,\n  syncWorkerToWorkspace,\n  DEFAULT_WORKSPACE_ID,\n  syncWorkerToCloud,\n  deleteWorkerFromCloud,\n  syncDeletedWorkerToCloud,\n  fetchGroupData,\n  auth\n\} from './src/lib/supabaseData';", "import { auth } from './src/lib/supabaseData';", s)
s = s.replace("'workers'", "'trabajadores'")
if 'const handleEmptyTrash' not in s:
    marker = "  const handleEdit = (person: Person) => {"
    insert = """  const handleEmptyTrash = async () => {\n    if (!deletedPeople.length) return;\n    if (!window.confirm(`¿Está seguro de que desea vaciar la Papelera? Se eliminarán definitivamente ${deletedPeople.length} registros.`)) return;\n    try {\n      for (const item of deletedPeople) await deleteDocument('trash', item.person.id);\n      setToast({ message: 'Papelera vaciada correctamente', type: 'success' });\n    } catch (error) {\n      console.error('Error vaciando la papelera en Supabase:', error);\n      setToast({ message: 'No se pudo vaciar completamente la Papelera.', type: 'error' });\n    }\n  };\n\n"""
    if marker not in s: raise SystemExit('marker handleEdit not found')
    s = s.replace(marker, insert + marker)

start = s.index("  const handleUpdatePerson = (updatedPerson: Person) => {")
end = s.index("  const handleBulkEditStart", start)
s = s[:start] + """  const handleUpdatePerson = async (updatedPerson: Person) => {\n    try {\n      await updateDocument('trabajadores', updatedPerson.id, updatedPerson as any);\n      updateAutocompleteLists(updatedPerson);\n      setEditingPerson(null);\n      setToast({ message: 'Registro actualizado correctamente', type: 'success' });\n    } catch (error) {\n      console.error('Error actualizando trabajador en Supabase:', error);\n      setToast({ message: 'No se pudo actualizar el registro.', type: 'error' });\n    }\n  };\n\n""" + s[end:]

start = s.index("  const handleUpdateMultiplePeople = (updates: Partial<Person>, selectedIds: number[]) => {")
end = s.index("  const handleTogglePersonSync", start)
s = s[:start] + """  const handleUpdateMultiplePeople = async (updates: Partial<Person>, selectedIds: number[]) => {\n    const selected = people.filter(p => selectedIds.includes(p.id));\n    try {\n      const updated = selected.map(p => ({ ...p, ...updates }));\n      await Promise.all(updated.map(person => updateDocument('trabajadores', person.id, person as any)));\n      const samplePerson = updated[0];\n      if (samplePerson) updateAutocompleteLists(samplePerson);\n      setBulkEditingPeople(null);\n      setToast({ message: `${updated.length} registros actualizados correctamente`, type: 'success' });\n    } catch (error) {\n      console.error('Error en edición masiva en Supabase:', error);\n      setToast({ message: 'No se pudieron actualizar todos los registros.', type: 'error' });\n    }\n  };\n\n""" + s[end:]

start = s.index("  const handleTogglePersonSync = async (id: number) => {")
end = s.index("  const stats: StatsData", start)
s = s[:start] + """  const handleTogglePersonSync = async (_id: number) => {\n    setToast({ message: 'La compartición de registros se gestiona desde Administración > Permisos.', type: 'success' });\n  };\n\n""" + s[end:]
s = s.replace('{/* Database synchronization feedback alert (green for success, red for error) */}', '{/* Persistencia directa en Supabase */}')
p.write_text(s)

# Configuración y backups: colección definitiva.
for name in ['components/Configuracion.tsx','src/services/backupExportService.ts']:
    q=Path(name); t=q.read_text().replace("'workers'", "'trabajadores'"); q.write_text(t)

# databaseService: CRUD tipado para trabajadores.
p = Path('src/services/databaseService.ts')
s = p.read_text()
s = s.replace("  works: 'obras', obras: 'obras',", "  works: 'obras', obras: 'obras',\n  workers: 'trabajadores', trabajadores: 'trabajadores',")
s = s.replace("const isLegacyNumericTable = (table: string) => table === 'workers' || table === 'trash';", "const isLegacyNumericTable = (table: string) => table === 'trash';")
needle = "  if (isLegacyNumericTable(table)) return { data };\n  if (table === 'obras') return {"
replacement = """  if (isLegacyNumericTable(table)) return { data };\n  if (table === 'trabajadores') return {\n    obra_id: value.obraId || value.obra_id || await resolveObraId(value.obra),\n    supervisor_responsable: value.supervisorResponsable || '', num_oferta: value.numOferta || '', obra: value.obra || '',\n    categoria: value.categoria || '', quincena: value.quincena || '', apellidos_nombre: value.apellidosNombre || '', dni: value.dni || '',\n    fecha_nacimiento: value.fechaNacimiento || '', periodo_inicio: value.periodoInicio || '', periodo_fin: value.periodoFin || '',\n    telefono: value.telefono || '', calzado: value.calzado || '', formacion: value.formacion || '', lugar_formacion: value.lugarFormacion || null,\n    cita_dia: value.citaDia || '', cita_hora: value.citaHora || '', sitio_reconocimiento: value.sitioReconocimiento || '',\n    documentacion_completa: value.documentacionCompleta || '', observaciones: value.observaciones || null, fecha_registro: value.fechaRegistro || '',\n    necesita_reconocimiento: value.necesitaReconocimiento || null, aptitud_medica: value.aptitudMedica || null,\n    limitaciones_aptitud: value.limitacionesAptitud || null, reconocimiento_estado: value.reconocimientoEstado || null,\n    reconocimiento_fecha: value.reconocimientoFecha || null, reconocimiento_validez: value.reconocimientoValidez || null,\n    reconocimiento_limitaciones: value.reconocimientoLimitaciones || null, reconocimiento_observaciones: value.reconocimientoObservaciones || null, data\n  };\n  if (table === 'obras') return {"""
if needle not in s: raise SystemExit('database serialize marker missing')
s = s.replace(needle,replacement)
needle = "  const body = isLegacyNumericTable(table)\n    ? { owner_id: user.id, id: Number(id), ...serialized, created_by: user.id, updated_by: user.id }\n    : { id: String(id), ...serialized };"
replacement = """  const body = table === 'trabajadores'\n    ? { owner_id: user.id, id: Number(id), ...serialized, created_by: user.id, updated_by: user.id }\n    : isLegacyNumericTable(table)\n      ? { owner_id: user.id, id: Number(id), ...serialized, created_by: user.id, updated_by: user.id }\n      : { id: String(id), ...serialized };"""
if needle not in s: raise SystemExit('database body marker missing')
s=s.replace(needle,replacement)
s=s.replace("  if (isLegacyNumericTable(table)) body.updated_by = user.id;", "  if (isLegacyNumericTable(table) || table === 'trabajadores') body.updated_by = user.id;")
p.write_text(s)

# Eliminar nombres de compatibilidad Firestore del adaptador Supabase y sus consumidores.
repls = {
 'createFirestoreWorker':'createWorkerRecord','updateFirestoreWorker':'updateWorkerRecord','deleteFirestoreWorker':'deleteWorkerRecord',
 'restoreFirestoreWorker':'restoreWorkerRecord','permanentDeleteFirestoreWorker':'permanentDeleteWorkerRecord',
 'fetchFirestoreWorkers':'fetchWorkerRecords','subscribeToFirestoreWorkers':'subscribeToWorkerRecords'
}
for p in list(Path('.').rglob('*.ts')) + list(Path('.').rglob('*.tsx')):
    if any(x in {'.git','node_modules'} for x in p.parts): continue
    s=p.read_text()
    for a,b in repls.items(): s=s.replace(a,b)
    p.write_text(s)

# Corregir persistencia del reporte técnico y tipo de recurso preventivo.
p=Path('components/SubcontratasSection.tsx'); s=p.read_text()
s=s.replace("saveStoredReporteTecnicoConfig(reporteConfig);\n                  setIsFirmasModalOpen(false);\n                  onToast('Configuración de firmas del Reporte Técnico guardada correctamente.', 'success');", "void saveSubcontrataSettings({ reporteConfig }).then(() => onToast('Configuración de firmas del Reporte Técnico guardada correctamente.', 'success')).catch(error => { console.error(error); onToast('No se pudo guardar la configuración del Reporte Técnico.', 'error'); });\n                  setIsFirmasModalOpen(false);")
p.write_text(s)
p=Path('src/lib/subcontratasDefaults.ts'); s=p.read_text()
s=s.replace("[obra.trim()]: {\n      recursoPreventivoNombre:", "[obra.trim()]: {\n      obra: obra.trim(),\n      recursoPreventivoNombre:")
p.write_text(s)
