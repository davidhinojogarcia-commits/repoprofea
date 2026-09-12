from pathlib import Path

sub_path = Path('components/SubcontratasSection.tsx')
text = sub_path.read_text()

text = text.replace(
"import { Subcontratista, SubcontrataDocItem, SubcontrataDocEstado, SubcontrataEstadoExpediente, Person, ReporteTecnicoConfig } from '../types';",
"import { Subcontratista, SubcontrataDocItem, SubcontrataDocEstado, SubcontrataEstadoExpediente, ReporteTecnicoConfig } from '../types';",
1,
)
text = text.replace("  workers?: Person[];\n", "", 1)
text = text.replace("  workers = [],\n", "", 1)

worker_block = """  // Workers belonging to the active subcontractor's obra
  const activeObraWorkers = useMemo(() => {
    const allWorkers = workers || [];
    if (!activeSubcontrata?.obra) return allWorkers;
    const cleanSubObra = activeSubcontrata.obra.trim().toLowerCase();
    const matched = allWorkers.filter(w => (w.obra || '').trim().toLowerCase() === cleanSubObra);
    return matched.length > 0 ? matched : allWorkers;
  }, [workers, activeSubcontrata?.obra]);

"""
if worker_block not in text:
    raise SystemExit('activeObraWorkers block not found')
text = text.replace(worker_block, "", 1)

text = text.replace(
"                currentObraWorkers={activeObraWorkers}",
"                // CAE de subcontratas: nunca mezclar la plantilla propia del contratista principal.\n                // El personal de la subcontrata se obtiene únicamente de su documentación aportada.\n                currentObraWorkers={[]}",
1,
)
sub_path.write_text(text)

app_path = Path('App.tsx')
app = app_path.read_text()
app = app.replace("                workers={visiblePeople}\n", "", 1)
app_path.write_text(app)

print('Principal-contractor workers isolated from subcontractor CAE analysis.')
