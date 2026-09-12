from pathlib import Path

# Remove obsolete personnel-comparison wording/state from the CAE result tabs.
p = Path('components/FileUploaderIA.tsx')
s = p.read_text()
old = """                <span>Cotejo de Operarios vs Obra Actual</span>\n                {detectedPersonnelCount > 0 ? (\n                  <span className=\"px-1.5 py-0.2 bg-rose-600 text-white text-[10px] rounded-full animate-pulse\">\n                    {detectedPersonnelCount} no autorizado(s)\n                  </span>\n                ) : lastAnalysisResults.comparativaTrabajadores ? (\n                  <span className=\"px-1.5 py-0.2 bg-emerald-600 text-white text-[10px] rounded-full\">\n                    ✓ Verificado\n                  </span>\n                ) : null}\n"""
new = """                <span>Personal detectado en expediente</span>\n                {detectedPersonnelCount > 0 && (\n                  <span className=\"px-1.5 py-0.5 bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-[10px] rounded-full\">\n                    {detectedPersonnelCount} detectado(s)\n                  </span>\n                )}\n"""
if old not in s:
    raise SystemExit('FileUploaderIA obsolete personnel tab block not found')
s = s.replace(old, new, 1)
if 'comparativaTrabajadores' in s or 'currentObraWorkers' in s:
    raise SystemExit('Obsolete principal-workforce comparison reference remains in FileUploaderIA')
p.write_text(s)

# On every opening, select the first category actually present in the configured
# checklist. This keeps custom checklists from opening on an empty category.
p = Path('components/ChecklistReviewModal.tsx')
s = p.read_text()
old = """    if (isOpen) {\n      setItems(initialChanges.map(i => ({ ...i })));\n    }\n"""
new = """    if (isOpen) {\n      setItems(initialChanges.map(i => ({ ...i })));\n      setActiveCategory(initialChanges[0]?.categoria || 'empresa');\n    }\n"""
if old not in s:
    raise SystemExit('Checklist review opening effect not found')
s = s.replace(old, new, 1)
p.write_text(s)

print('Final PR polish applied.')
