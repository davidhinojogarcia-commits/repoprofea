from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'Missing pattern for {label}')
    return text.replace(old, new, 1)

# -----------------------------------------------------------------------------
# 1) CAE API: personnel belongs to the subcontractor dossier, never to the
#    principal contractor workforce. Return OCR-detected personnel directly.
# -----------------------------------------------------------------------------
api = Path('api/analyze-subcontractor-docs.ts')
s = api.read_text()

# Fallback: keep signature but stop depending on the principal workforce. Extract
# DNI/NIEs heuristically from native office text when Gemini is unavailable.
old_loop = """    for (const worker of currentWorkers) {\n      const dni = normalizeSearchText(worker?.dni || '');\n      const name = normalizeSearchText(worker?.apellidosNombre || worker?.name || '');\n      if ((dni && searchable.includes(dni)) || (name.length > 5 && searchable.includes(name))) {\n        trabajadoresDetectados.push({\n          nombre: worker.apellidosNombre || worker.name || '',\n          dni: worker.dni || '',\n          archivoOrigen: file.name\n        });\n      }\n    }\n"""
new_loop = """    // Personnel is extracted only from the subcontractor's own dossier.\n    // In fallback mode we can safely recover DNI/NIE identifiers from native text;\n    // the human reviewer remains responsible for confirming identity/name.\n    const rawText = officeText || '';\n    const workerIds = rawText.match(/\\b(?:[XYZxyz]\\s*[- ]?\\s*\\d{7}\\s*[- ]?\\s*[A-Za-z]|\\d{8}\\s*[- ]?\\s*[A-Za-z])\\b/g) || [];\n    for (const rawDni of workerIds) {\n      const dni = rawDni.replace(/[\\s-]/g, '').toUpperCase();\n      trabajadoresDetectados.push({\n        nombre: 'Nombre pendiente de revisión manual',\n        dni,\n        archivoOrigen: file.name\n      });\n    }\n"""
s = replace_once(s, old_loop, new_loop, 'fallback worker extraction')

s = replace_once(
    s,
    "    comparativaTrabajadores: compareWorkers(uniqueWorkers, currentWorkers),",
    "    trabajadoresDetectados: uniqueWorkers,",
    'fallback personnel response'
)

s = replace_once(
    s,
    "    const comparison = compareWorkers(allWorkers, Array.isArray(body.currentObraWorkers) ? body.currentObraWorkers : []);",
    "    const uniqueWorkers = allWorkers.filter((worker, index, list) => {\n      const key = `${String(worker.dni || '').replace(/[\\s-]/g, '').toUpperCase()}|${String(worker.nombre || '').trim().toUpperCase()}`;\n      return list.findIndex(candidate => `${String(candidate.dni || '').replace(/[\\s-]/g, '').toUpperCase()}|${String(candidate.nombre || '').trim().toUpperCase()}` === key) === index;\n    });",
    'AI personnel dedupe'
)
s = replace_once(
    s,
    "      comparativaTrabajadores: comparison,",
    "      trabajadoresDetectados: uniqueWorkers,",
    'AI personnel response'
)
api.write_text(s)

# -----------------------------------------------------------------------------
# 2) FileUploaderIA: remove comparison against principal workforce and show the
#    personnel found in the subcontractor documentation as its own CAE block.
# -----------------------------------------------------------------------------
p = Path('components/FileUploaderIA.tsx')
s = p.read_text()

# Remove no-longer-valid imported comparison types and principal workforce prop.
s = s.replace("  Person,\n  WorkerObraComparisonSummary,\n  WorkerComparisonItem,\n", "")
s = s.replace("  currentObraWorkers?: Person[];\n", "")
s = s.replace("  currentObraWorkers = [],\n", "")

s = replace_once(
    s,
    "    comparativaTrabajadores?: WorkerObraComparisonSummary;",
    "    personalDetectado?: { nombre: string; dni?: string; archivoOrigen?: string }[];",
    'local result personnel type'
)

s = s.replace("      const aggregatedWorkers: WorkerComparisonItem[] = [];\n", "      const aggregatedWorkers: { nombre: string; dni?: string; archivoOrigen?: string }[] = [];\n")
s = s.replace("      let latestWorkerComparison: WorkerObraComparisonSummary | undefined;\n", "")

request_workers = """            currentChecklist: subcontrata.checklist,\n            currentObraWorkers: (currentObraWorkers || []).map(w => ({\n              id: w.id,\n              name: w.name,\n              apellidosNombre: w.name,\n              dni: w.dni,\n              category: w.category,\n              categoria: w.category,\n              role: w.role,\n              obra: w.obra\n            }))\n"""
s = replace_once(s, request_workers, "            currentChecklist: subcontrata.checklist\n", 'remove principal workforce from CAE request')

comparison_collect = """        if (data.comparativaTrabajadores) {\n          latestWorkerComparison = data.comparativaTrabajadores;\n          aggregatedWorkers.push(...(data.comparativaTrabajadores.coincidentes || []), ...(data.comparativaTrabajadores.noRegistradosEnObra || []));\n        }\n"""
s = replace_once(
    s,
    comparison_collect,
    """        if (Array.isArray(data.trabajadoresDetectados)) {\n          aggregatedWorkers.push(...data.trabajadoresDetectados.map((worker: any) => ({\n            nombre: worker.nombre || 'Nombre pendiente de revisión',\n            dni: worker.dni || '',\n            archivoOrigen: worker.archivoOrigen || file.name\n          })));\n        }\n""",
    'collect detected subcontractor personnel'
)

# Dedupe personnel before creating final result.
needle = "      const consolidatedSummary = `OCR/IA completado sobre ${convertedFiles.length} archivo(s). Checklist evaluado: ${proposedList.length} puntos; ${deliveredCount} con evidencia conforme; ${missing.length} pendientes/incidencias; ${expiredCount} caducados; ${unreadableCount} ilegibles. Revisión humana obligatoria antes de aplicar.`;\n"
insert = needle + """      const personalDetectado = aggregatedWorkers.filter((worker, index, list) => {\n        const key = `${String(worker.dni || '').replace(/[\\s-]/g, '').toUpperCase()}|${String(worker.nombre || '').trim().toUpperCase()}`;\n        return list.findIndex(candidate => `${String(candidate.dni || '').replace(/[\\s-]/g, '').toUpperCase()}|${String(candidate.nombre || '').trim().toUpperCase()}` === key) === index;\n      });\n"""
s = replace_once(s, needle, insert, 'dedupe detected personnel')

s = replace_once(s, "        comparativaTrabajadores: latestWorkerComparison,", "        personalDetectado,", 'store detected personnel')
s = replace_once(
    s,
    "      else if (latestWorkerComparison?.noRegistradosEnObra?.length) setActiveResultTab('operarios');",
    "      else if (personalDetectado.length > 0) setActiveResultTab('operarios');",
    'personnel tab activation'
)
s = replace_once(
    s,
    "  const unauthorizedWorkersCount = lastAnalysisResults?.comparativaTrabajadores?.noRegistradosEnObra.length || 0;",
    "  const detectedPersonnelCount = lastAnalysisResults?.personalDetectado?.length || 0;",
    'personnel count'
)

s = s.replace(
    "Arrastre PDFs para extraer datos, validar vigencias reales (TGSS, AEAT, REA) y comparar automáticamente la lista de operarios contra la obra actual.",
    "Importe la documentación completa de la subcontrata: la IA extrae evidencias, vigencias y personal detectado exclusivamente desde su propio expediente."
)
s = s.replace("✓ Filtro Anti-Personal Propio", "✓ Personal extraído del expediente")

# Replace the complete old personnel-comparison tab with dossier personnel view.
start_marker = "            {/* TAB 3: Cotejo de Operarios vs Obra Actual */}"
end_marker = "            {/* TAB 4:"
start = s.find(start_marker)
end = s.find(end_marker, start)
if start == -1 or end == -1:
    raise SystemExit('Could not locate operarios tab boundaries')
new_tab = """            {/* TAB 3: Personal detectado exclusivamente en el expediente de la subcontrata */}\n            {activeResultTab === 'operarios' && (\n              <div className=\"space-y-3\">\n                <div className=\"ui-surface-soft p-4\">\n                  <div className=\"flex items-start gap-3\">\n                    <Users className=\"w-5 h-5 text-[var(--ui-brand-700)] shrink-0 mt-0.5\" />\n                    <div>\n                      <h4 className=\"text-sm font-bold text-slate-900 dark:text-slate-100\">Personal detectado en la documentación de la subcontrata</h4>\n                      <p className=\"text-xs text-slate-500 dark:text-slate-400 mt-1\">Esta relación procede únicamente de los archivos aportados por <strong>{subcontrata.nombreEmpresa}</strong>. No se cruza ni se completa con la plantilla propia del contratista principal.</p>\n                    </div>\n                  </div>\n                </div>\n\n                {(lastAnalysisResults.personalDetectado?.length || 0) > 0 ? (\n                  <div className=\"grid grid-cols-1 md:grid-cols-2 gap-2.5\">\n                    {lastAnalysisResults.personalDetectado!.map((worker, index) => (\n                      <div key={`${worker.dni || worker.nombre}_${index}`} className=\"ui-surface p-3 flex items-start gap-3\">\n                        <div className=\"mt-0.5 h-8 w-8 rounded-full bg-[var(--ui-brand-50)] text-[var(--ui-brand-700)] flex items-center justify-center shrink-0\">\n                          <UserCheck className=\"w-4 h-4\" />\n                        </div>\n                        <div className=\"min-w-0\">\n                          <div className=\"font-bold text-sm text-slate-900 dark:text-slate-100 truncate\">{worker.nombre || 'Nombre pendiente de revisión'}</div>\n                          <div className=\"text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5\">DNI/NIE: {worker.dni || 'No extraído'}</div>\n                          {worker.archivoOrigen && <div className=\"text-[11px] text-slate-400 dark:text-slate-500 mt-1 truncate\">Fuente: {worker.archivoOrigen}</div>}\n                        </div>\n                      </div>\n                    ))}\n                  </div>\n                ) : (\n                  <div className=\"ui-surface-soft p-4 text-xs text-slate-500 dark:text-slate-400\">No se ha podido extraer una relación nominal de personal de los documentos analizados. Esto no implica que no exista: revise manualmente el expediente.</div>\n                )}\n              </div>\n            )}\n\n"""
s = s[:start] + new_tab + s[end:]

# Replace any visible metric label/count variable that still references unauthorized workers.
s = s.replace('unauthorizedWorkersCount', 'detectedPersonnelCount')
s = s.replace('Operarios no autorizados', 'Personal detectado')
s = s.replace('No autorizados', 'Personal detectado')

p.write_text(s)

# -----------------------------------------------------------------------------
# 3) Review modal: three explicit work blocks (Empresa / Personal / Maquinaria),
#    while retaining human confirmation and per-item editing.
# -----------------------------------------------------------------------------
p = Path('components/ChecklistReviewModal.tsx')
s = p.read_text()
s = replace_once(
    s,
    "  const [items, setItems] = useState<ProposedChecklistChange[]>([]);",
    "  const [items, setItems] = useState<ProposedChecklistChange[]>([]);\n  const [activeCategory, setActiveCategory] = useState<SubcontrataDocCategoria>('empresa');",
    'review category state'
)

# Keep valid category on open and compute mapped indices for editing original array.
needle = "  const selectedCount = items.filter(i => i.selected).length;\n"
extra = """  const categoryMeta: { id: SubcontrataDocCategoria; label: string; description: string }[] = [\n    { id: 'empresa', label: '1. Empresa', description: 'REA, seguros, certificados, prevención y documentación societaria' },\n    { id: 'trabajadores', label: '2. Personal', description: 'Altas, formación, aptitud médica, EPIs y acreditaciones nominales' },\n    { id: 'maquinaria', label: '3. Maquinaria y equipos', description: 'Marcado CE, seguros, ITV, revisiones y documentación técnica' }\n  ];\n  const visibleItems = items.map((item, index) => ({ item, index })).filter(({ item }) => item.categoria === activeCategory);\n""" + needle
s = replace_once(s, needle, extra, 'review category metadata')

# Add category navigation between notice and list.
list_marker = "        {/* List of Proposed Changes */}\n        <div className=\"flex-1 overflow-y-auto p-4 sm:p-6 space-y-4\">\n"
category_nav = """        {/* Revisión por bloques CAE */}\n        <div className=\"px-4 sm:px-6 pt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 shrink-0\">\n          {categoryMeta.map(category => {\n            const count = items.filter(item => item.categoria === category.id).length;\n            const incidents = items.filter(item => item.categoria === category.id && !['entregado', 'no_aplica'].includes(item.estadoPropuesto)).length;\n            const active = activeCategory === category.id;\n            return (\n              <button\n                key={category.id}\n                type=\"button\"\n                onClick={() => setActiveCategory(category.id)}\n                className={`text-left rounded-xl border p-3 transition-all ${active ? 'border-[var(--ui-brand-400)] bg-[var(--ui-brand-50)] shadow-sm' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'}`}\n              >\n                <div className=\"flex items-center justify-between gap-2\">\n                  <span className={`text-xs font-black ${active ? 'text-[var(--ui-brand-800)]' : 'text-slate-800 dark:text-slate-100'}`}>{category.label}</span>\n                  <span className={incidents ? 'ui-status ui-status--warn' : 'ui-status ui-status--ok'}>{incidents ? `${incidents} revisar` : `${count} revisados`}</span>\n                </div>\n                <p className=\"text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-4\">{category.description}</p>\n              </button>\n            );\n          })}\n        </div>\n\n""" + list_marker
s = replace_once(s, list_marker, category_nav, 'review category navigation')
s = replace_once(s, "          {items.map((item, index) => {", "          {visibleItems.map(({ item, index }) => {", 'filter review items by category')

# Institutionalize the AI review header (remove indigo/amber decoration).
s = s.replace("bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900", "bg-[var(--ui-gradient-brand)]")
s = s.replace("<Sparkles className=\"w-6 h-6 text-amber-300 animate-pulse\" />", "<Sparkles className=\"w-6 h-6 text-white\" />")
s = s.replace("bg-amber-400 text-slate-950", "bg-white/15 text-white border border-white/20")
p.write_text(s)

# -----------------------------------------------------------------------------
# 4) Performance: lazy-load the heaviest route-only modules. This materially
#    reduces work on first render without changing any route or data flow.
# -----------------------------------------------------------------------------
p = Path('App.tsx')
s = p.read_text()
s = s.replace("import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';", "import React, { Suspense, lazy, useState, useEffect, useMemo, useCallback, useRef } from 'react';")
heavy = {
    "import { Configuracion } from './components/Configuracion';\n": "Configuracion",
    "import { Papelera } from './components/Papelera';\n": "Papelera",
    "import { GestionCitas } from './components/GestionCitas';\n": "GestionCitas",
    "import { CalendarioIntegrado } from './components/CalendarioIntegrado';\n": "CalendarioIntegrado",
    "import { SubcontratasSection } from './components/SubcontratasSection';\n": "SubcontratasSection",
    "import { AdminPanel } from './components/AdminPanel';\n": "AdminPanel",
}
for line in heavy:
    if line not in s:
        raise SystemExit(f'Missing heavy import: {line.strip()}')
    s = s.replace(line, '')

anchor = "import { compressToGzip } from './src/lib/compression';\n"
lazy_defs = anchor + "\n" + "\n".join([
    f"const {name} = lazy(() => import('./components/{name}').then(module => ({{ default: module.{name} }})));"
    for name in heavy.values()
]) + "\n"
s = replace_once(s, anchor, lazy_defs, 'lazy definitions')

watermark_end = """const WatermarkLogo = () => (\n  <div className=\"fixed bottom-6 right-8 pointer-events-none select-none z-0\">\n"""
# Insert fallback immediately before WatermarkLogo to avoid touching its body.
if "const WatermarkLogo = () => (" not in s:
    raise SystemExit('Watermark anchor missing')
s = s.replace("const WatermarkLogo = () => (", "const ViewLoadingFallback = () => (\n  <div className=\"ui-surface p-8 min-h-48 flex items-center justify-center\">\n    <div className=\"flex items-center gap-3 text-sm font-semibold text-[var(--ui-text-muted)]\">\n      <RefreshCw className=\"w-4 h-4 animate-spin text-[var(--ui-brand-700)]\" />\n      Cargando módulo…\n    </div>\n  </div>\n);\n\nconst WatermarkLogo = () => (", 1)

# Wrap route blocks for lazy modules.
def wrap_route(text: str, view: str, component: str, next_view: str) -> str:
    start_marker = f"          {{activeView === '{view}' && ("
    next_marker = f"          {{activeView === '{next_view}' && ("
    start = text.find(start_marker)
    end = text.find(next_marker, start)
    if start == -1 or end == -1:
        raise SystemExit(f'Route markers missing for {view}')
    block = text[start:end]
    open_pat = f"{start_marker}\n"
    block = replace_once(block, open_pat, open_pat + "            <Suspense fallback={<ViewLoadingFallback />}>\n", f'open Suspense {view}')
    close_pat = "          )}\n\n"
    idx = block.rfind(close_pat)
    if idx == -1:
        raise SystemExit(f'Close marker missing for {view}')
    block = block[:idx] + "            </Suspense>\n" + block[idx:]
    return text[:start] + block + text[end:]

s = wrap_route(s, 'configuracion', 'Configuracion', 'administracion')
s = wrap_route(s, 'administracion', 'AdminPanel', 'papelera')
s = wrap_route(s, 'papelera', 'Papelera', 'calendario')
s = wrap_route(s, 'calendario', 'CalendarioIntegrado', 'citas')
s = wrap_route(s, 'citas', 'GestionCitas', 'subcontratas')
# Subcontratas is followed by editingPerson, not a view.
start_marker = "          {activeView === 'subcontratas' && ("
next_marker = "          {editingPerson && ("
start = s.find(start_marker)
end = s.find(next_marker, start)
if start == -1 or end == -1:
    raise SystemExit('Route markers missing for subcontratas')
block = s[start:end]
block = replace_once(block, start_marker + "\n", start_marker + "\n            <Suspense fallback={<ViewLoadingFallback />}>\n", 'open Suspense subcontratas')
idx = block.rfind("          )}\n\n")
if idx == -1:
    raise SystemExit('Close marker missing for subcontratas')
block = block[:idx] + "            </Suspense>\n" + block[idx:]
s = s[:start] + block + s[end:]
p.write_text(s)

print('Final UI/CAE refactor transformations applied successfully.')
