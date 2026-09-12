from pathlib import Path

# 1) FileUploaderIA: finish semantics of subcontractor-only personnel.
p = Path('components/FileUploaderIA.tsx')
s = p.read_text()
old = """                <span>Cotejo de Operarios vs Obra Actual</span>\n                {detectedPersonnelCount > 0 ? (\n                  <span className=\"px-1.5 py-0.2 bg-rose-600 text-white text-[10px] rounded-full animate-pulse\">\n                    {detectedPersonnelCount} no autorizado(s)\n                  </span>\n                ) : lastAnalysisResults.comparativaTrabajadores ? (\n                  <span className=\"px-1.5 py-0.2 bg-emerald-600 text-white text-[10px] rounded-full\">\n                    ✓ Verificado\n                  </span>\n                ) : null}\n"""
new = """                <span>Personal detectado en expediente</span>\n                {detectedPersonnelCount > 0 && (\n                  <span className=\"px-1.5 py-0.5 bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-[10px] rounded-full\">\n                    {detectedPersonnelCount} detectado(s)\n                  </span>\n                )}\n"""
if old not in s:
    raise SystemExit('FileUploaderIA obsolete personnel tab block not found')
s = s.replace(old, new, 1)
if 'comparativaTrabajadores' in s or 'currentObraWorkers' in s:
    raise SystemExit('Obsolete comparison reference remains in FileUploaderIA after patch')
p.write_text(s)

# 2) SubcontratasSection: remove stale empty prop entirely (interface is already gone).
p = Path('components/SubcontratasSection.tsx')
s = p.read_text()
old = """                // CAE de subcontratas: nunca mezclar la plantilla propia del contratista principal.\n                // El personal de la subcontrata se obtiene únicamente de su documentación aportada.\n                currentObraWorkers={[]}\n"""
if old not in s:
    raise SystemExit('Subcontratas stale currentObraWorkers block not found')
s = s.replace(old, '', 1)
p.write_text(s)

# 3) Review modal: on every opening use the first actually configured category.
p = Path('components/ChecklistReviewModal.tsx')
s = p.read_text()
old = """    if (isOpen) {\n      setItems(initialChanges.map(i => ({ ...i })));\n    }\n"""
new = """    if (isOpen) {\n      setItems(initialChanges.map(i => ({ ...i })));\n      setActiveCategory(initialChanges[0]?.categoria || 'empresa');\n    }\n"""
if old not in s:
    raise SystemExit('Checklist review opening effect not found')
s = s.replace(old, new, 1)
p.write_text(s)

print('CAE final polish retry applied successfully.')
