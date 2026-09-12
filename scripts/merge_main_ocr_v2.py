from pathlib import Path

p = Path('api/analyze-subcontractor-docs.ts')
s = p.read_text()

old = """    const comparison = compareWorkers(allWorkers, Array.isArray(body.currentObraWorkers) ? body.currentObraWorkers : []);\n\n    return sendJson(res, 200, {\n"""
new = """    // Personnel belongs exclusively to the subcontractor dossier. Never compare or\n    // enrich it with the principal contractor workforce. Keep only OCR/assessment\n    // detections and let the human reviewer confirm the relationship.\n    const uniqueWorkers = allWorkers.filter((worker, index, list) => {\n      const key = `${cleanIdentity(worker?.dni)}|${cleanIdentity(worker?.nombre)}`;\n      return key !== '|' && list.findIndex(candidate => `${cleanIdentity(candidate?.dni)}|${cleanIdentity(candidate?.nombre)}` === key) === index;\n    });\n\n    return sendJson(res, 200, {\n"""
if old not in s:
    raise SystemExit('OCR v2 comparison anchor not found')
s = s.replace(old, new, 1)

old = "      comparativaTrabajadores: comparison,\n"
new = "      trabajadoresDetectados: uniqueWorkers,\n"
if old not in s:
    raise SystemExit('OCR v2 response comparison anchor not found')
s = s.replace(old, new, 1)

# Remove the obsolete worker-comparison helper so there is no accidental route
# back to the principal workforce in future edits.
start = s.find('function compareWorkers(detected: any[], currentWorkers: any[]) {')
end = s.find('\n\nconst validateInputs =', start)
if start != -1 and end != -1:
    s = s[:start] + s[end+2:]

p.write_text(s)
print('Integrated OCR-first v2 while preserving subcontractor personnel isolation.')
