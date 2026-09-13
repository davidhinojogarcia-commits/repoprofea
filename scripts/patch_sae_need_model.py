from pathlib import Path

path = Path('components/SaeSection.tsx')
text = path.read_text(encoding='utf-8')

old_type = """type NeedForm = {\n  obra: string;\n  codigoObra: string;\n  mes: string;\n  ano: string;\n  categorias: { categoria: string; cantidad: number }[];\n};"""
new_type = """type NeedForm = {\n  obra: string;\n  codigoObra: string;\n  mes: string;\n  ano: string;\n  categorias: { categoria: string; cantidad: number }[];\n  notas: string;\n};"""
if old_type in text:
    text = text.replace(old_type, new_type, 1)

old_empty = """  categorias: [{ categoria: '', cantidad: 1 }],\n};"""
new_empty = """  categorias: [{ categoria: '', cantidad: 1 }],\n  notas: '',\n};"""
if old_empty in text:
    text = text.replace(old_empty, new_empty, 1)

old_state = """  const [needForm, setNeedForm] = useState<NeedForm>(emptyNeed);\n  const [showNeedForm, setShowNeedForm] = useState(false);"""
new_state = """  const [needForm, setNeedForm] = useState<NeedForm>(emptyNeed);\n  const [pendingImportedNeeds, setPendingImportedNeeds] = useState<NeedForm[]>([]);\n  const [showNeedForm, setShowNeedForm] = useState(false);"""
if old_state in text:
    text = text.replace(old_state, new_state, 1)

start = text.find("  const handleNeedFile = async (file?: File) => {")
end = text.find("\n  const saveNeed = async () => {", start)
if start < 0 or end < 0:
    raise SystemExit('No se encontró handleNeedFile')
new_handle = r'''  const handleNeedFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setProgress('Analizando necesidad de contratación…');
    try {
      const parsed = await parseSaeNeedFile(file, setProgress);
      const units = parsed.detectedNeeds?.length ? parsed.detectedNeeds : [parsed];
      const forms: NeedForm[] = units.map(item => ({
        obra: item.obra,
        codigoObra: item.codigoObra,
        mes: item.mes,
        ano: item.ano ? String(item.ano) : String(new Date().getFullYear()),
        categorias: item.categorias.length ? item.categorias : [{ categoria: '', cantidad: 1 }],
        notas: item.notas || '',
      }));
      setNeedForm(forms[0]);
      setPendingImportedNeeds(forms.slice(1));
      setShowNeedForm(true);
      onToast(
        forms.length > 1
          ? `${forms.length} necesidades/obras detectadas. Revise y confirme cada una por separado.`
          : 'Necesidad analizada. Revise los datos antes de confirmar.',
        'success'
      );
    } catch (e: any) {
      onToast(e.message || 'No se pudo analizar el documento.', 'error');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };
'''
text = text[:start] + new_handle + text[end:]

old_filter = "const validCategories = needForm.categorias.filter(c => c.categoria.trim() && c.cantidad > 0);"
new_filter = "const validCategories = needForm.categorias.filter(c => c.categoria.trim() && (c.cantidad > 0 || /PENDIENTE/i.test(c.categoria)));"
if old_filter not in text:
    raise SystemExit('No se encontró filtro de categorías')
text = text.replace(old_filter, new_filter, 1)

old_after_create = """      setShowNeedForm(false);\n      setNeedForm(emptyNeed);\n      setSelectedNeedId(created.id);\n      await refresh(created.id);\n      setActiveStep(2);\n      onToast('Necesidad SAE creada correctamente.', 'success');"""
new_after_create = """      setSelectedNeedId(created.id);\n      await refresh(created.id);\n      if (pendingImportedNeeds.length) {\n        const [next, ...rest] = pendingImportedNeeds;\n        setNeedForm(next);\n        setPendingImportedNeeds(rest);\n        setShowNeedForm(true);\n        setActiveStep(1);\n        onToast(`Necesidad ${created.codigoObra || created.obra} guardada. Quedan ${rest.length + 1} por revisar del mismo documento.`, 'success');\n      } else {\n        setShowNeedForm(false);\n        setNeedForm(emptyNeed);\n        setActiveStep(2);\n        onToast('Necesidad SAE creada correctamente.', 'success');\n      }"""
if old_after_create not in text:
    raise SystemExit('No se encontró bloque posterior a crear necesidad')
text = text.replace(old_after_create, new_after_create, 1)

report_marker = """      const parsed = await parseSaeReportFile(file, setProgress);\n      if (!parsed.candidates.length) throw new Error('No se han reconocido candidatos. Revise que sea un informe de resultado de selección del SAE.');"""
report_insert = r'''      const parsed = await parseSaeReportFile(file, setProgress);
      if (!parsed.candidates.length) throw new Error('No se han reconocido candidatos. Revise que sea un informe de resultado de selección del SAE.');

      const normalizeWorkCode = (value: string) => norm(value).replace(/[.\s-]+/g, '');
      const expectedWork = normalizeWorkCode(selectedNeed.codigoObra);
      const detectedWork = normalizeWorkCode(parsed.codigoObra);
      if (expectedWork && detectedWork && expectedWork !== detectedWork) {
        throw new Error(`El informe SAE corresponde a la obra ${parsed.codigoObra}, pero la necesidad seleccionada es ${selectedNeed.codigoObra}. Seleccione la necesidad correcta.`);
      }
      if (selectedNeed.mes && parsed.mes && norm(selectedNeed.mes) !== norm(parsed.mes)) {
        throw new Error(`El informe SAE corresponde a ${parsed.mes}, pero la necesidad seleccionada es de ${selectedNeed.mes}.`);
      }
      const ignoredCategoryTokens = new Set(['oficial', 'primera', 'segunda', 'quincena', 'construccion', 'edificios', 'obras', 'publicas']);
      const categoryTokens = (value: string) => norm(value)
        .replace(/cn\s*\d+/g, ' ')
        .split(/[^a-z0-9ñ]+/)
        .filter(token => token.length >= 4 && !ignoredCategoryTokens.has(token));
      const reportTokens = categoryTokens(parsed.categoria);
      if (reportTokens.length && selectedNeed.categorias.length) {
        const compatible = selectedNeed.categorias.some(req => {
          const requiredTokens = categoryTokens(req.categoria);
          return requiredTokens.some(token => reportTokens.includes(token) || reportTokens.some(r => r.includes(token) || token.includes(r)));
        });
        if (!compatible) {
          throw new Error(`La categoría detectada en el informe (${parsed.categoria || 'sin categoría'}) no coincide con las categorías solicitadas para esta necesidad.`);
        }
      }'''
if report_marker not in text:
    raise SystemExit('No se encontró punto de validación de informe')
text = text.replace(report_marker, report_insert, 1)

heading = """          <h2 className=\"font-black text-lg\">Revisión de necesidad de contratación</h2>"""
summary = """          <h2 className=\"font-black text-lg\">Revisión de necesidad de contratación</h2>\n          <div className=\"rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4\">\n            <div className=\"text-[11px] font-black tracking-[0.12em] uppercase text-[#00548E] dark:text-blue-400\">Ofertas mano de obra · {needForm.mes || 'Mes'} {needForm.ano || ''}</div>\n            <div className=\"mt-1 text-base font-black text-slate-900 dark:text-white\">{needForm.codigoObra || 'Código obra'}{needForm.obra ? ` — ${needForm.obra}` : ''}</div>\n            {!!pendingImportedNeeds.length && <div className=\"mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300\">Hay {pendingImportedNeeds.length} obra(s) más detectadas en este mismo documento pendientes de revisión.</div>}\n          </div>"""
if heading not in text:
    raise SystemExit('No se encontró cabecera del formulario')
text = text.replace(heading, summary, 1)

categories_end = """          </div>\n          <div className=\"flex justify-between gap-3\">\n            <button onClick={() => setNeedForm(f => ({ ...f, categorias: [...f.categorias, { categoria: '', cantidad: 1 }] }))} className=\"text-sm font-bold text-[#00548E]\">+ Añadir categoría</button>"""
notes_block = """          </div>\n          <div>\n            <label className=\"block text-xs font-bold text-slate-500 mb-1.5\">Observaciones del modelo de necesidad</label>\n            <textarea value={needForm.notas} onChange={e => setNeedForm(f => ({ ...f, notas: e.target.value }))} rows={2} className=\"ui-input w-full resize-y\" placeholder=\"Continuidades, prórrogas u observaciones del documento…\" />\n          </div>\n          <div className=\"flex justify-between gap-3\">\n            <button onClick={() => setNeedForm(f => ({ ...f, categorias: [...f.categorias, { categoria: '', cantidad: 1 }] }))} className=\"text-sm font-bold text-[#00548E]\">+ Añadir categoría</button>"""
if categories_end not in text:
    raise SystemExit('No se encontró cierre de categorías')
text = text.replace(categories_end, notes_block, 1)

path.write_text(text, encoding='utf-8')
print('SaeSection.tsx actualizado')
