from pathlib import Path

path = Path("components/Configuracion.tsx")
text = path.read_text(encoding="utf-8")

def replace_once(old: str, new: str) -> None:
    global text
    if old not in text:
        raise SystemExit("Expected Configuracion target not found")
    text = text.replace(old, new, 1)

replace_once(
'''  const [editingObraRecurso, setEditingObraRecurso] = useState<{
    obra: string;
    recurso: string;
    categoria: string;
  } | null>(null);''',
'''  const [editingObraRecurso, setEditingObraRecurso] = useState<{
    obra: string;
    nombre: string;
    recurso: string;
    categoria: string;
  } | null>(null);'''
)

replace_once(
'''    const { obra, recurso, categoria } = editingObraRecurso;
    if (!recurso.trim()) {
      if (setToast) setToast({ message: 'El nombre del Recurso Preventivo no puede estar vacío.', type: 'error' });
      return;
    }
    saveStoredObraRecursoPreventivo(obra, recurso.trim(), categoria.trim());
    setObrasRecursos(getStoredObrasRecursosPreventivos());
    setEditingObraRecurso(null);
    if (setToast) {
      setToast({ message: `Recurso Preventivo de "${obra}" actualizado correctamente.`, type: 'success' });
    }''',
'''    const { obra, nombre, recurso, categoria } = editingObraRecurso;
    const trimmedNombre = nombre.trim();
    if (!trimmedNombre) {
      if (setToast) setToast({ message: 'El nombre de la obra no puede estar vacío.', type: 'error' });
      return;
    }
    if (!recurso.trim()) {
      if (setToast) setToast({ message: 'El nombre del Recurso Preventivo no puede estar vacío.', type: 'error' });
      return;
    }
    if (trimmedNombre.toLowerCase() !== obra.toLowerCase() && savedObras.some(o => o.toLowerCase() === trimmedNombre.toLowerCase())) {
      if (setToast) setToast({ message: 'Ya existe otra obra registrada con ese nombre.', type: 'error' });
      return;
    }

    if (trimmedNombre !== obra) {
      setSavedObras(prev => prev.map(item => item === obra ? trimmedNombre : item).sort((a, b) => a.localeCompare(b)));
      deleteStoredObraRecursoPreventivo(obra);
    }
    saveStoredObraRecursoPreventivo(trimmedNombre, recurso.trim(), categoria.trim());
    setObrasRecursos(getStoredObrasRecursosPreventivos());
    setEditingObraRecurso(null);
    if (setToast) {
      setToast({ message: `Obra "${trimmedNombre}" actualizada correctamente.`, type: 'success' });
    }'''
)

replace_once(
'''                                  onClick={() => setEditingObraRecurso({
                                    obra,
                                    recurso: recursoData?.recursoPreventivoNombre || '',
                                    categoria: recursoData?.recursoPreventivoCategoria || 'Encargado de Obra'
                                  })}''',
'''                                  onClick={() => setEditingObraRecurso({
                                    obra,
                                    nombre: obra,
                                    recurso: recursoData?.recursoPreventivoNombre || '',
                                    categoria: recursoData?.recursoPreventivoCategoria || 'Encargado de Obra'
                                  })}'''
)

replace_once(
'''                                  title="Editar Recurso Preventivo"''',
'''                                  title="Editar obra"'''
)

replace_once(
'''              {/* Modal para Editar Recurso Preventivo de Obra */}''',
'''              {/* Modal para Editar Obra y Recurso Preventivo */}'''
)

replace_once(
'''                            Recurso Preventivo Asignado''',
'''                            Editar Obra'''
)

replace_once(
'''                            {editingObraRecurso.obra}''',
'''                            Modifica los datos de la obra y su recurso preventivo'''
)

replace_once(
'''                    <form onSubmit={handleSaveEditObraRecurso} className="space-y-4">
                      <div>''',
'''                    <form onSubmit={handleSaveEditObraRecurso} className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                          Nombre de la Obra *
                        </label>
                        <input
                          type="text"
                          required
                          value={editingObraRecurso.nombre}
                          onChange={(e) => setEditingObraRecurso({ ...editingObraRecurso, nombre: e.target.value })}
                          placeholder="Nombre de la obra"
                          className="w-full px-3.5 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                        />
                      </div>

                      <div>'''
)

replace_once(
'''                          <span>Guardar Recurso</span>''',
'''                          <span>Guardar Cambios</span>'''
)

path.write_text(text, encoding="utf-8")
