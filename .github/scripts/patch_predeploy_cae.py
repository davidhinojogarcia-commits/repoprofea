from pathlib import Path

p = Path('components/SubcontratasSection.tsx')
text = p.read_text(encoding='utf-8')

helper_anchor = """  // Quick toggle status for checklist item
  const handleToggleStatus = (subId: string, itemId: string, newStatus: SubcontrataDocEstado) => {
    handleUpdateChecklistItem(subId, itemId, { estado: newStatus });
  };
"""
helper_replacement = helper_anchor + """

  const handleLibroSubcontratacionStatus = (subId: string, estado: 'registrado' | 'no_registrado') => {
    setSubcontratistas(prev => prev.map(sub => {
      if (sub.id !== subId) return sub;
      const updatedChecklist = sub.checklist.map(item => {
        if (item.id !== 'libro_subcontratacion') return item;
        const registrado = estado === 'registrado';
        return {
          ...item,
          estado: registrado ? 'entregado' : 'pendiente',
          fechaEntrega: registrado ? (item.fechaEntrega || new Date().toISOString().slice(0, 10)) : undefined,
        } as SubcontrataDocItem;
      });
      const tempSub: Subcontratista = {
        ...sub,
        libroSubcontratacionEstado: estado,
        checklist: updatedChecklist,
      };
      const comp = getSubcontrataCompliance(tempSub);
      return {
        ...tempSub,
        estadoExpediente: comp.estadoSugerido,
        fechaActualizacion: new Date().toISOString(),
      };
    }));
  };
"""
if 'const handleLibroSubcontratacionStatus' not in text:
    if helper_anchor not in text:
        raise SystemExit('handleToggleStatus anchor not found')
    text = text.replace(helper_anchor, helper_replacement, 1)

status_start = """                            {/* Status Selector Buttons */}
                            <div className=\"flex items-center gap-1.5 shrink-0\">"""
status_new = """                            {item.id === 'libro_subcontratacion' && (
                              <div className=\"flex flex-col gap-1.5 shrink-0 min-w-[190px]\">
                                <label className=\"text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400\">
                                  Estado del Libro
                                </label>
                                <select
                                  value={activeSubcontrata.libroSubcontratacionEstado || (isDelivered ? 'registrado' : 'no_registrado')}
                                  onChange={e => handleLibroSubcontratacionStatus(activeSubcontrata.id, e.target.value as 'registrado' | 'no_registrado')}
                                  className={`px-3 py-2 text-xs font-bold rounded-lg border cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                                    (activeSubcontrata.libroSubcontratacionEstado || (isDelivered ? 'registrado' : 'no_registrado')) === 'registrado'
                                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                                      : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-800'
                                  }`}
                                  aria-label=\"Estado del Libro de Subcontratación\"
                                >
                                  <option value=\"registrado\">Registrado</option>
                                  <option value=\"no_registrado\">No registrado</option>
                                </select>
                              </div>
                            )}

                            {/* Status Selector Buttons */}
                            {item.id !== 'libro_subcontratacion' && (
                            <div className=\"flex items-center gap-1.5 shrink-0\">"""
if "Estado del Libro" not in text:
    if status_start not in text:
        raise SystemExit('status selector start anchor not found')
    text = text.replace(status_start, status_new, 1)

end_anchor = """                              </button>
                            </div>
                          </div>

                          {/* Editable fields: dates and observations */}"""
end_new = """                              </button>
                            </div>
                            )}
                          </div>

                          {/* Editable fields: dates and observations */}"""
if "item.id !== 'libro_subcontratacion' && (" in text:
    # Only close the conditional if it has not been closed already.
    marker = "</div>\n                            )}\n                          </div>\n\n                          {/* Editable fields: dates and observations */}"
    if marker not in text:
        if end_anchor not in text:
            raise SystemExit('status selector end anchor not found')
        text = text.replace(end_anchor, end_new, 1)

p.write_text(text, encoding='utf-8')
