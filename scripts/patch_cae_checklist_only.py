from pathlib import Path

path = Path('components/FileUploaderIA.tsx')
text = path.read_text()

old = '''        if (!doc) {
          const keepNotApplicable = item.estado === 'no_aplica' && !item.obligatorio;
          return {
            docId: item.id,
            nombre: item.nombre,
            categoria: item.categoria,
            normativa: item.normativa,
            obligatorio: item.obligatorio,
            estadoActual: item.estado,
            estadoPropuesto: keepNotApplicable ? 'no_aplica' : 'pendiente',
            fechaEntregaActual: item.fechaEntrega,
            fechaEntregaPropuesta: item.fechaEntrega,
            fechaCaducidadActual: item.fechaCaducidad,
            fechaCaducidadPropuesta: item.fechaCaducidad,
            observacionesActuales: item.observaciones,
            observacionesPropuestas: keepNotApplicable
              ? (item.observaciones || 'No aplica según la configuración actual del checklist.')
              : '[NO LOCALIZADO POR OCR/IA] No se ha encontrado evidencia documental suficiente para acreditar este punto en los archivos aportados.',
            archivoOrigen: keepNotApplicable ? '' : 'No localizado en los documentos aportados',
            esLegible: true,
            validezIA: keepNotApplicable ? 'NO APLICA' : 'NO LOCALIZADO POR OCR/IA',
            confianza: keepNotApplicable ? 'alta' : 'baja',
            selected: true
          } as ProposedChecklistChange;
        }
'''
new = '''        if (!doc) {
          // Sin evidencia en esta carga, el punto del checklist queda exactamente como estaba.
          return {
            docId: item.id,
            nombre: item.nombre,
            categoria: item.categoria,
            normativa: item.normativa,
            obligatorio: item.obligatorio,
            estadoActual: item.estado,
            estadoPropuesto: item.estado,
            fechaEntregaActual: item.fechaEntrega,
            fechaEntregaPropuesta: item.fechaEntrega,
            fechaCaducidadActual: item.fechaCaducidad,
            fechaCaducidadPropuesta: item.fechaCaducidad,
            observacionesActuales: item.observaciones,
            observacionesPropuestas: item.observaciones || '',
            archivoOrigen: '',
            esLegible: true,
            validezIA: item.estado === 'no_aplica' ? 'NO APLICA' : 'SIN CAMBIOS',
            confianza: 'baja',
            selected: false
          } as ProposedChecklistChange;
        }
'''

if old not in text:
    if 'NO LOCALIZADO POR OCR/IA' not in text:
        print('CAE checklist-only patch already applied')
        raise SystemExit(0)
    raise SystemExit('Expected CAE no-evidence block not found')

text = text.replace(old, new, 1)
text = text.replace("        else if (!observaciones) observaciones = `[EVIDENCIA OCR/IA] Documento localizado y cotejado. Archivo: '${doc.archivoOrigen || ''}'.`;", "        else if (!observaciones) observaciones = item.observaciones || '';", 1)
text = text.replace("          : `EVIDENCIA OCR/IA (${doc.confianza || 'media'})`;", "          : `VERIFICADO (${doc.confianza || 'media'})`;", 1)
text = text.replace("          fechaEntregaPropuesta: doc.fechaEmision || item.fechaEntrega || new Date().toISOString().slice(0, 10),", "          fechaEntregaPropuesta: doc.fechaEmision || item.fechaEntrega || '',", 1)
text = text.replace("        detectadoPorIA: confirmed.estadoPropuesto !== 'pendiente' && confirmed.archivoOrigen !== 'No localizado en los documentos aportados',", "        detectadoPorIA: !!confirmed.archivoOrigen && confirmed.estadoPropuesto !== 'pendiente',", 1)
text = text.replace("        validezIA: confirmed.validezIA || (confirmed.estadoPropuesto === 'caducado' ? 'CADUCADO' : confirmed.estadoPropuesto === 'pendiente' ? 'NO LOCALIZADO POR OCR/IA' : 'Verificado por IA'),", "        validezIA: confirmed.validezIA || (confirmed.estadoPropuesto === 'caducado' ? 'CADUCADO' : confirmed.estadoPropuesto === 'pendiente' ? 'PENDIENTE' : 'VERIFICADO'),", 1)
text = text.replace("                Importe la documentación completa de la subcontrata: la IA extrae evidencias, vigencias y personal detectado exclusivamente desde su propio expediente.", "                Importe documentación y se cotejará exclusivamente contra los puntos del checklist configurado.", 1)
text = text.replace("                La IA comprobará validez de fechas legales y cotejará la lista de operarios con la obra '{subcontrata.obra}'.", "                El análisis solo buscará evidencia para los puntos del checklist. Lo no encontrado no modificará el estado existente.", 1)
text = text.replace("                    <span>Verificar Documentos contra el Checklist Legal</span>", "                    <span>Comprobar Checklist</span>", 1)
text = text.replace("      onToast(`OCR/IA finalizado: ${convertedFiles.length} archivo(s) analizados y ${proposedList.length} puntos del checklist preparados para revisión manual.`, 'success');", "      onToast(`Checklist analizado: ${convertedFiles.length} archivo(s) procesados y ${proposedList.filter(item => item.selected).length} punto(s) con evidencia propuestos para revisión.`, 'success');", 1)

if 'NO LOCALIZADO POR OCR/IA' in text or 'No localizado en los documentos aportados' in text:
    raise SystemExit('Synthetic no-localizado text remains after patch')

path.write_text(text)
print('CAE checklist-only patch applied')
