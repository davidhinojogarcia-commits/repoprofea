from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'{label}: pattern not found')
    return text.replace(old, new, 1)


# -----------------------------------------------------------------------------
# 1) PDF signatures: no preventive-resource signature + blank means omitted
# -----------------------------------------------------------------------------
def patch_defaults():
    path = Path('src/lib/subcontratasDefaults.ts')
    text = path.read_text()

    text = replace_once(
        text,
        """  options?: {\n    tecnicoNombre?: string;\n    coordinadorNombre?: string;\n    empresaCoordinacion?: string;\n    recursoPreventivoObra?: string;\n    recursoPreventivoCategoria?: string;\n  }""",
        """  options?: {\n    tecnicoNombre?: string;\n    coordinadorNombre?: string;\n    empresaCoordinacion?: string;\n    supervisorNombre?: string;\n    recursoPreventivoObra?: string;\n    recursoPreventivoCategoria?: string;\n  }""",
        'individual options supervisor'
    )

    text = replace_once(
        text,
        """  const effectiveTecnico = options?.tecnicoNombre?.trim() || defaultCfg.tecnicoNombre || 'David Hinojo García';\n  const effectiveCoordinador = options?.coordinadorNombre?.trim() || defaultCfg.coordinadorNombre || 'David Hinojo García';\n  const effectiveEmpresa = options?.empresaCoordinacion?.trim() || defaultCfg.empresaCoordinacion || 'Área de Cooperación - Excma. Diputación Provincial de Cádiz';\n  const effectiveRecursoNombre = options?.recursoPreventivoObra?.trim() || sub.recursoPreventivo?.trim() || obraRecurso?.recursoPreventivoNombre || '';\n  const effectiveRecursoCategoria = options?.recursoPreventivoCategoria?.trim() || obraRecurso?.recursoPreventivoCategoria || 'Encargado de Obra';\n\n  const config = getStoredPdfConfig();\n  const compliance = getSubcontrataCompliance(sub);\n  const supNombre = supervisorResponsable || sub.supervisorResponsable || defaultCfg.supervisorNombre || 'Supervisor Responsable';""",
        """  // Nullish coalescing is intentional: an explicit empty string means \"do not render this signature\".\n  const effectiveTecnico = (options?.tecnicoNombre ?? defaultCfg.tecnicoNombre ?? '').trim();\n  const effectiveCoordinador = (options?.coordinadorNombre ?? defaultCfg.coordinadorNombre ?? '').trim();\n  const effectiveEmpresa = (options?.empresaCoordinacion ?? defaultCfg.empresaCoordinacion ?? '').trim();\n  const effectiveSupervisorFirma = (options?.supervisorNombre ?? defaultCfg.supervisorNombre ?? '').trim();\n  const effectiveRecursoNombre = options?.recursoPreventivoObra?.trim() || sub.recursoPreventivo?.trim() || obraRecurso?.recursoPreventivoNombre || '';\n  const effectiveRecursoCategoria = options?.recursoPreventivoCategoria?.trim() || obraRecurso?.recursoPreventivoCategoria || 'Encargado de Obra';\n\n  const config = getStoredPdfConfig();\n  const compliance = getSubcontrataCompliance(sub);\n  // Metadata keeps using the record supervisor; signature visibility is controlled only by reporteConfig.\n  const supNombre = supervisorResponsable || sub.supervisorResponsable || defaultCfg.supervisorNombre || 'Supervisor Responsable';""",
        'individual effective signature config'
    )

    start = text.index('    // Signature boxes\n', text.index('// Footer & Signatures Block'))
    end = text.index('  // Page Numbers\n', start)
    new_block = """    // Signature boxes: only explicitly configured signers are rendered.\n    // Recurso Preventivo is deliberately excluded from Reporte Técnico signatures.\n    const signatures = [\n      { label: 'Por el Supervisor de obra:', name: effectiveSupervisorFirma },\n      { label: 'Por el Técnico de Obra:', name: effectiveTecnico },\n      { label: 'Coordinación de Seguridad y Salud:', name: effectiveCoordinador }\n    ].filter(signature => signature.name.trim().length > 0);\n\n    if (signatures.length > 0) {\n      const gap = 3;\n      const boxW = (contentWidth - gap * (signatures.length - 1)) / signatures.length;\n      signatures.forEach((signature, index) => {\n        const x = marginLeft + index * (boxW + gap);\n        doc.roundedRect(x, sigY, boxW, 21, 1.5, 1.5, 'S');\n        doc.setFont('helvetica', 'bold');\n        doc.setFontSize(6.5);\n        doc.setTextColor(15, 23, 42);\n        doc.text(signature.label, x + 2, sigY + 4, { maxWidth: boxW - 4 });\n        doc.setFont('helvetica', 'normal');\n        doc.setFontSize(5.8);\n        doc.setTextColor(71, 85, 105);\n        doc.text(`Fdo: ${signature.name}`, x + 2, sigY + 17, { maxWidth: boxW - 4 });\n      });\n    }\n  }\n\n"""
    text = text[:start] + new_block + text[end:]

    text = replace_once(
        text,
        """export interface ObraConsolidatedReportOptions {\n  tecnicoNombre?: string;\n  coordinadorNombre?: string;\n  empresaCoordinacion?: string;\n  recursoPreventivoObra?: string;\n  recursoPreventivoCategoria?: string;""",
        """export interface ObraConsolidatedReportOptions {\n  tecnicoNombre?: string;\n  coordinadorNombre?: string;\n  empresaCoordinacion?: string;\n  supervisorNombre?: string;\n  recursoPreventivoObra?: string;\n  recursoPreventivoCategoria?: string;""",
        'consolidated options supervisor'
    )

    # Locate effectiveOptions initialization and append explicit signatures nearby without relying on its exact formatting.
    marker = "  const supNombre = supervisorNombre || (subcontratasInObra[0]?.supervisorResponsable) || 'Dirección Facultativa / Supervisión Técnica';"
    text = replace_once(
        text,
        marker,
        marker + "\n  const consolidatedSupervisorFirma = (options?.supervisorNombre ?? '').trim();\n  const consolidatedTecnicoFirma = (options?.tecnicoNombre ?? '').trim();\n  const consolidatedCoordinadorFirma = (options?.coordinadorNombre ?? '').trim();",
        'consolidated explicit signature config'
    )

    start = text.index('  if (effectiveOptions.recursoPreventivoObra) {', text.index('// Footer & Signatures Block on last page'))
    end = text.index('  // Global Page Numbers & Official Footer\n', start)
    new_consolidated = """  // Only configured report signers are shown. Preventive-resource data remains useful\n  // elsewhere in CAE but is never a Reporte Técnico signature.\n  const consolidatedSignatures = [\n    { label: 'Por el Supervisor de obra:', name: consolidatedSupervisorFirma },\n    { label: 'Por el Técnico de Obra:', name: consolidatedTecnicoFirma },\n    { label: 'Coordinación de Seguridad y Salud:', name: consolidatedCoordinadorFirma }\n  ].filter(signature => signature.name.trim().length > 0);\n\n  if (consolidatedSignatures.length > 0) {\n    const gap = 3;\n    const boxW = (contentWidth - gap * (consolidatedSignatures.length - 1)) / consolidatedSignatures.length;\n    consolidatedSignatures.forEach((signature, index) => {\n      const x = marginLeft + index * (boxW + gap);\n      sigDoc.roundedRect(x, sigBoxY, boxW, 22, 1.5, 1.5, 'S');\n      sigDoc.setFont('helvetica', 'bold');\n      sigDoc.setFontSize(6.5);\n      sigDoc.setTextColor(15, 23, 42);\n      sigDoc.text(signature.label, x + 2, sigBoxY + 4, { maxWidth: boxW - 4 });\n      sigDoc.setFont('helvetica', 'normal');\n      sigDoc.setFontSize(5.8);\n      sigDoc.setTextColor(71, 85, 105);\n      sigDoc.text(`Fdo: ${signature.name}`, x + 2, sigBoxY + 18, { maxWidth: boxW - 4 });\n    });\n  }\n\n"""
    text = text[:start] + new_consolidated + text[end:]
    path.write_text(text)


# -----------------------------------------------------------------------------
# 2) Firmas modal + pass supervisor config into both PDF generators
# -----------------------------------------------------------------------------
def patch_section():
    path = Path('components/SubcontratasSection.tsx')
    text = path.read_text()

    text = replace_once(
        text,
        """          tecnicoNombre: reporteConfig.tecnicoNombre,\n          coordinadorNombre: reporteConfig.coordinadorNombre,\n          empresaCoordinacion: reporteConfig.empresaCoordinacion""",
        """          tecnicoNombre: reporteConfig.tecnicoNombre,\n          coordinadorNombre: reporteConfig.coordinadorNombre,\n          empresaCoordinacion: reporteConfig.empresaCoordinacion,\n          supervisorNombre: reporteConfig.supervisorNombre""",
        'individual pass supervisor'
    )
    text = replace_once(
        text,
        """        tecnicoNombre: reporteConfig.tecnicoNombre,\n        coordinadorNombre: reporteConfig.coordinadorNombre,\n        empresaCoordinacion: reporteConfig.empresaCoordinacion""",
        """        tecnicoNombre: reporteConfig.tecnicoNombre,\n        coordinadorNombre: reporteConfig.coordinadorNombre,\n        empresaCoordinacion: reporteConfig.empresaCoordinacion,\n        supervisorNombre: reporteConfig.supervisorNombre""",
        'consolidated pass supervisor'
    )

    text = replace_once(
        text,
        'Configure el Técnico de Obra, Coordinador de Seguridad y Salud, Empresa de Coordinación y Supervisor de obra.',
        'Configure únicamente las firmas que deban aparecer. Deje cualquier casilla de firma en blanco para omitirla del PDF.',
        'firmas helper copy'
    )

    # The three signer fields must be optional. Company is optional metadata as well.
    text = text.replace('                    Nombre y Apellidos del Técnico de Obra *', '                    Nombre y Apellidos del Técnico de Obra')
    # Restrict required removals to this form body.
    form_start = text.index('id="form-firmas-reporte"')
    form_end = text.index('</form>', form_start)
    form_chunk = text[form_start:form_end]
    form_chunk = form_chunk.replace('                    required\n', '')
    form_chunk = form_chunk.replace(
        'Este nombre se imprimirá en la casilla <strong>"Por el Técnico"</strong> en todos los Reportes Técnicos oficiales en PDF.',
        'Si queda en blanco, la firma <strong>"Por el Técnico"</strong> no aparecerá en el PDF.'
    )
    form_chunk = form_chunk.replace(
        'Técnico competente responsable de la coordinación de seguridad y salud en fase de ejecución.',
        'Si queda en blanco, no se mostrará ninguna firma de Coordinación de Seguridad y Salud.'
    )
    form_chunk = form_chunk.replace(
        'Razón social de la empresa o administración pública que se imprime junto al coordinador.',
        'Dato informativo opcional de coordinación. No sustituye al nombre del firmante ni crea una firma por sí mismo.'
    )
    form_chunk = form_chunk.replace(
        'Nombre del Supervisor de obra que encabeza la primera casilla oficial en los informes.',
        'Si queda en blanco, la firma de Supervisor de obra no aparecerá en el PDF.'
    )
    text = text[:form_start] + form_chunk + text[form_end:]

    preview_start = text.index('              {/* Live Signature Preview */}')
    preview_end = text.index('            </div>\n\n            {/* Footer */}', preview_start)
    new_preview = """              {/* Live Signature Preview */}\n              <div className=\"border-t border-slate-200 dark:border-slate-800 pt-5 space-y-3\">\n                <div className=\"flex flex-col sm:flex-row sm:items-center justify-between gap-2\">\n                  <h3 className=\"text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2\">\n                    <Eye className=\"w-4 h-4 text-blue-600 dark:text-blue-400\" />\n                    Vista Previa de Firmas del Reporte Técnico PDF\n                  </h3>\n                  <span className=\"text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800\">\n                    {[reporteConfig.supervisorNombre, reporteConfig.tecnicoNombre, reporteConfig.coordinadorNombre].filter(value => value?.trim()).length} firmas configuradas\n                  </span>\n                </div>\n\n                {[reporteConfig.supervisorNombre, reporteConfig.tecnicoNombre, reporteConfig.coordinadorNombre].some(value => value?.trim()) ? (\n                  <div className=\"grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-slate-100/70 dark:bg-slate-950/50 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800\">\n                    {reporteConfig.supervisorNombre?.trim() && (\n                      <div className=\"bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg overflow-hidden flex flex-col justify-between shadow-2xs\">\n                        <div className=\"bg-[#00548e] text-white text-[10px] font-extrabold px-2 py-1 text-center tracking-wider uppercase\">SUPERVISOR DE OBRA</div>\n                        <div className=\"h-14 flex items-center justify-center text-slate-300 dark:text-slate-600 text-xs italic\">[Espacio para Firma]</div>\n                        <div className=\"p-2 border-t border-slate-100 dark:border-slate-800 text-center bg-slate-50/50 dark:bg-slate-800/30\">\n                          <span className=\"text-[11px] font-bold text-slate-800 dark:text-slate-200 block truncate\">Fdo: {reporteConfig.supervisorNombre}</span>\n                        </div>\n                      </div>\n                    )}\n                    {reporteConfig.tecnicoNombre?.trim() && (\n                      <div className=\"bg-white dark:bg-slate-900 border-2 border-blue-500 dark:border-blue-400 rounded-lg overflow-hidden flex flex-col justify-between shadow-xs\">\n                        <div className=\"bg-blue-700 text-white text-[10px] font-extrabold px-2 py-1 text-center tracking-wider uppercase flex items-center justify-center gap-1\">\n                          <UserCheck className=\"w-3 h-3\" /> POR EL TÉCNICO\n                        </div>\n                        <div className=\"h-14 flex items-center justify-center text-slate-300 dark:text-slate-600 text-xs italic\">[Espacio para Firma]</div>\n                        <div className=\"p-2 border-t border-slate-100 dark:border-slate-800 text-center bg-blue-50/50 dark:bg-blue-950/40\">\n                          <span className=\"text-[11px] font-bold text-blue-900 dark:text-blue-200 block truncate\">Fdo: {reporteConfig.tecnicoNombre}</span>\n                        </div>\n                      </div>\n                    )}\n                    {reporteConfig.coordinadorNombre?.trim() && (\n                      <div className=\"bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg overflow-hidden flex flex-col justify-between shadow-2xs\">\n                        <div className=\"bg-[#00548e] text-white text-[10px] font-extrabold px-2 py-1 text-center tracking-wider uppercase\">COORDINACIÓN SEG. Y SALUD</div>\n                        <div className=\"h-14 flex items-center justify-center text-slate-300 dark:text-slate-600 text-xs italic\">[Espacio para Firma]</div>\n                        <div className=\"p-2 border-t border-slate-100 dark:border-slate-800 text-center bg-slate-50/50 dark:bg-slate-800/30\">\n                          <span className=\"text-[11px] font-bold text-slate-800 dark:text-slate-200 block truncate\">Fdo: {reporteConfig.coordinadorNombre}</span>\n                        </div>\n                      </div>\n                    )}\n                  </div>\n                ) : (\n                  <div className=\"p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-500 dark:text-slate-400\">\n                    No se incluirá ninguna firma en el documento exportado. Introduzca un nombre solo en las firmas que necesite.\n                  </div>\n                )}\n                <p className=\"text-[11px] text-slate-500 dark:text-slate-400\">\n                  El Recurso Preventivo forma parte de la documentación CAE, pero no se incluye como firmante del Reporte Técnico.\n                </p>\n              </div>\n"""
    text = text[:preview_start] + new_preview + text[preview_end:]
    path.write_text(text)


# -----------------------------------------------------------------------------
# 3) OCR frontend: every selected file, aggregate evidence, complete checklist
# -----------------------------------------------------------------------------
def patch_uploader():
    path = Path('components/FileUploaderIA.tsx')
    text = path.read_text()

    start = text.index('  // Convert files to base64 and execute AI verification\n')
    end = text.index('  const handleApplyReviewedChanges =', start)

    handler = r'''  // Convert every imported file to base64, OCR it independently, aggregate the evidence,
  // and propose a state for every checklist point. Nothing is accepted until human review.
  const handleExecuteAIAnalysis = async () => {
    if (selectedFiles.length === 0) {
      onToast('Seleccione o arrastre al menos un documento para cotejar.', 'error');
      return;
    }

    setIsAnalyzing(true);
    setLastAnalysisResults(null);

    try {
      const convertedFiles = await Promise.all(selectedFiles.map(file => new Promise<{ name: string; type: string; base64: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve({ name: file.name, type: file.type || 'application/octet-stream', base64: reader.result as string });
        reader.onerror = reject;
        reader.readAsDataURL(file);
      })));

      const aggregatedDocs: SubcontrataDocAnalysisResult[] = [];
      const aggregatedIllegible: DocumentoIlegibleAlerta[] = [];
      const aggregatedWorkers: WorkerComparisonItem[] = [];
      const summaries: string[] = [];
      const expiryAlerts: string[] = [];
      let latestWorkerComparison: WorkerObraComparisonSummary | undefined;

      // One OCR request per file is intentional: it avoids a large-document request masking pages
      // from other files and guarantees explicit progress/coverage for every imported document.
      for (let index = 0; index < convertedFiles.length; index += 1) {
        const file = convertedFiles[index];
        setAnalysisProgress(`OCR + IA ${index + 1}/${convertedFiles.length}: analizando todas las páginas de ${file.name}...`);

        const response = await fetch('/api/analyze-subcontractor-docs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: [file],
            subcontrata: {
              nombreEmpresa: subcontrata.nombreEmpresa,
              cif: subcontrata.cif,
              obra: subcontrata.obra,
              supervisorResponsable: subcontrata.supervisorResponsable
            },
            currentChecklist: subcontrata.checklist,
            currentObraWorkers: (currentObraWorkers || []).map(w => ({
              id: w.id,
              name: w.name,
              apellidosNombre: w.name,
              dni: w.dni,
              category: w.category,
              categoria: w.category,
              role: w.role,
              obra: w.obra
            }))
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Error OCR/IA en ${file.name} (${response.status})`);
        }
        const data = await response.json();
        if (!data.success) throw new Error(data.error || `No se pudo analizar ${file.name}.`);

        aggregatedDocs.push(...(Array.isArray(data.documentosAnalizados) ? data.documentosAnalizados : []));
        aggregatedIllegible.push(...(Array.isArray(data.documentosIlegibles) ? data.documentosIlegibles : []));
        expiryAlerts.push(...(Array.isArray(data.alertasCaducidad) ? data.alertasCaducidad : []));
        if (data.resumenDiagnostico) summaries.push(data.resumenDiagnostico);
        if (data.comparativaTrabajadores) {
          latestWorkerComparison = data.comparativaTrabajadores;
          aggregatedWorkers.push(...(data.comparativaTrabajadores.coincidentes || []), ...(data.comparativaTrabajadores.noRegistradosEnObra || []));
        }
      }

      setAnalysisProgress('Consolidando evidencias OCR contra cada punto del checklist legal...');

      // Prefer the strongest evidence when several files refer to the same requirement.
      const rank: Record<SubcontrataDocEstado, number> = {
        entregado: 5,
        no_aplica: 4,
        incompleto: 3,
        caducado: 2,
        pendiente: 1
      };
      const bestEvidence = new Map<string, SubcontrataDocAnalysisResult>();
      aggregatedDocs.forEach(doc => {
        const previous = bestEvidence.get(doc.docId);
        const previousScore = previous ? (rank[previous.estado] || 0) + (previous.confianza === 'alta' ? 0.4 : previous.confianza === 'media' ? 0.2 : 0) : -1;
        const nextScore = (rank[doc.estado] || 0) + (doc.confianza === 'alta' ? 0.4 : doc.confianza === 'media' ? 0.2 : 0);
        if (!previous || nextScore > previousScore) bestEvidence.set(doc.docId, doc);
      });

      const proposedList: ProposedChecklistChange[] = subcontrata.checklist.map(item => {
        const doc = bestEvidence.get(item.id);
        if (!doc) {
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

        let finalEstado: SubcontrataDocEstado = doc.estaCaducado ? 'caducado' : (doc.estado || 'entregado');
        if (doc.esLegible === false || doc.solicitarReintento) finalEstado = 'incompleto';
        let observaciones = doc.observaciones || '';
        if (doc.estaCaducado) observaciones = `[INCIDENCIA / CADUCADO] ${doc.motivoCaducidad || 'Documento vencido'}. Archivo: '${doc.archivoOrigen || ''}'.`;
        else if (doc.esLegible === false || doc.solicitarReintento) observaciones = `[INCIDENCIA / ILEGIBLE] ${doc.motivoIlegible || 'OCR insuficiente o documento incompleto'}. Archivo: '${doc.archivoOrigen || ''}'.`;
        else if (doc.esProximaCaducidad) observaciones = `[PRÓXIMA CADUCIDAD] ${doc.motivoCaducidad || 'Vence en menos de 30 días'}. Archivo: '${doc.archivoOrigen || ''}'.`;
        else if (!observaciones) observaciones = `[EVIDENCIA OCR/IA] Documento localizado y cotejado. Archivo: '${doc.archivoOrigen || ''}'.`;

        const validezText = doc.esLegible === false || doc.solicitarReintento
          ? 'ILEGIBLE / REQUIERE REVISIÓN'
          : doc.estaCaducado
          ? `CADUCADO (${doc.diasCaducado ?? 0} días)`
          : doc.esProximaCaducidad
          ? `PRÓXIMA CADUCIDAD (${doc.diasRestantes ?? 0} días)`
          : `EVIDENCIA OCR/IA (${doc.confianza || 'media'})`;

        return {
          docId: item.id,
          nombre: item.nombre,
          categoria: item.categoria,
          normativa: item.normativa,
          obligatorio: item.obligatorio,
          estadoActual: item.estado,
          estadoPropuesto: finalEstado,
          fechaEntregaActual: item.fechaEntrega,
          fechaEntregaPropuesta: doc.fechaEmision || item.fechaEntrega || new Date().toISOString().slice(0, 10),
          fechaCaducidadActual: item.fechaCaducidad,
          fechaCaducidadPropuesta: doc.fechaCaducidad || item.fechaCaducidad || '',
          observacionesActuales: item.observaciones,
          observacionesPropuestas: observaciones,
          archivoOrigen: doc.archivoOrigen,
          estaCaducado: doc.estaCaducado,
          diasCaducado: doc.diasCaducado,
          diasRestantes: doc.diasRestantes,
          esProximaCaducidad: doc.esProximaCaducidad,
          motivoCaducidad: doc.motivoCaducidad,
          motivoIlegible: doc.motivoIlegible,
          esLegible: doc.esLegible !== false,
          validezIA: validezText,
          confianza: doc.confianza,
          selected: true
        } as ProposedChecklistChange;
      });

      const missing = proposedList
        .filter(item => item.obligatorio && !['entregado', 'no_aplica'].includes(item.estadoPropuesto))
        .map(item => item.nombre);
      const unreadableCount = proposedList.filter(item => item.esLegible === false).length;
      const expiredCount = proposedList.filter(item => item.estaCaducado).length;
      const deliveredCount = proposedList.filter(item => item.estadoPropuesto === 'entregado').length;

      const consolidatedSummary = `OCR/IA completado sobre ${convertedFiles.length} archivo(s). Checklist evaluado: ${proposedList.length} puntos; ${deliveredCount} con evidencia conforme; ${missing.length} pendientes/incidencias; ${expiredCount} caducados; ${unreadableCount} ilegibles. Revisión humana obligatoria antes de aplicar.`;
      setLastAnalysisResults({
        resumen: consolidatedSummary + (summaries.length ? ` ${summaries.join(' ')}` : ''),
        veredicto: missing.length === 0 ? 'APTO' : 'CONDICIONADO',
        faltantes: missing,
        analizados: aggregatedDocs,
        comparativaTrabajadores: latestWorkerComparison,
        alertasCaducidad: Array.from(new Set(expiryAlerts)),
        documentosIlegibles: aggregatedIllegible
      });

      if (aggregatedIllegible.length > 0) setActiveResultTab('legibilidad');
      else if (latestWorkerComparison?.noRegistradosEnObra?.length) setActiveResultTab('operarios');
      else if (expiredCount > 0) setActiveResultTab('caducidades');
      else setActiveResultTab('resumen');

      setProposedChanges(proposedList);
      setPendingAnalysisData({
        resumenDiagnostico: consolidatedSummary,
        veredictoAcceso: missing.length === 0 ? 'APTO' : 'CONDICIONADO',
        relacionFaltantes: missing
      });
      setIsReviewModalOpen(true);
      onToast(`OCR/IA finalizado: ${convertedFiles.length} archivo(s) analizados y ${proposedList.length} puntos del checklist preparados para revisión manual.`, 'success');
    } catch (err: any) {
      console.error('Error during AI verification:', err);
      onToast(err.message || 'Error al cotejar los documentos con OCR/IA.', 'error');
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress('');
    }
  };

'''
    text = text[:start] + handler + text[end:]

    # Missing evidence must not be described as a successfully detected document.
    old = """        detectadoPorIA: true,\n        validezIA: confirmed.validezIA || (confirmed.estadoPropuesto === 'caducado' ? 'CADUCADO' : 'Verificado por IA'),"""
    new = """        detectadoPorIA: confirmed.estadoPropuesto !== 'pendiente' && confirmed.archivoOrigen !== 'No localizado en los documentos aportados',\n        validezIA: confirmed.validezIA || (confirmed.estadoPropuesto === 'caducado' ? 'CADUCADO' : confirmed.estadoPropuesto === 'pendiente' ? 'NO LOCALIZADO POR OCR/IA' : 'Verificado por IA'),"""
    text = replace_once(text, old, new, 'pending AI detection flag')
    path.write_text(text)


# -----------------------------------------------------------------------------
# 4) Institutional UI polish, performance-friendly and scoped
# -----------------------------------------------------------------------------
def create_css():
    Path('institutional-polish.css').write_text(r'''/* PROFEA · Diputación Provincial de Cádiz — institutional UI refinement */
:root {
  --profea-blue: #00548e;
  --profea-blue-strong: #003f6b;
  --profea-blue-soft: #eaf4fa;
  --profea-ink: #17324d;
  --profea-border: #d6e2ea;
  --profea-surface: #ffffff;
  --profea-bg: #f5f8fa;
  --profea-focus: rgba(0, 84, 142, .26);
}

html { background: var(--profea-bg); }
body { text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }

#root button,
#root input,
#root select,
#root textarea { transition-duration: 140ms !important; }

#root button:focus-visible,
#root input:focus-visible,
#root select:focus-visible,
#root textarea:focus-visible,
#root [tabindex]:focus-visible {
  outline: 3px solid var(--profea-focus) !important;
  outline-offset: 2px;
}

#subcontratas-section-container {
  --cae-blue: #00548e;
  --cae-blue-strong: #003f6b;
}

#subcontratas-section-container > .bg-white,
#subcontratas-section-container .lg\:col-span-4 > .bg-white,
#subcontratas-section-container .lg\:col-span-8 .bg-white {
  border-color: var(--profea-border);
}

#subcontratas-section-container h1,
#subcontratas-section-container h2,
#subcontratas-section-container h3 {
  letter-spacing: -0.015em;
}

#subcontratas-section-container #btn-nueva-subcontrata,
#subcontratas-section-container #btn-generar-informe-pdf {
  box-shadow: 0 1px 2px rgba(0, 63, 107, .12), 0 5px 14px rgba(0, 84, 142, .08);
}

#subcontratas-section-container [id^="sub-card-"] {
  contain: layout paint;
  transform: translateZ(0);
}

#subcontratas-section-container [id^="sub-card-"]:hover {
  box-shadow: 0 6px 18px rgba(23, 50, 77, .07);
}

/* AI verifier reads as a deliberate institutional verification workstation. */
#subcontratas-section-container [class*="from-blue-50"][class*="to-indigo-50"],
#subcontratas-section-container [class*="from-sky-50"] {
  border-color: #b9d6e8 !important;
  background-image: linear-gradient(135deg, #f7fbfd 0%, #edf6fb 100%) !important;
}

#subcontratas-section-container [id^="doc-item-"] {
  border-color: #dbe5eb;
  box-shadow: 0 1px 2px rgba(15, 23, 42, .025);
}

#subcontratas-section-container [id^="doc-item-"]:focus-within {
  border-color: #86b8d5;
  box-shadow: 0 0 0 3px rgba(0, 84, 142, .08);
}

/* Make long master/detail screens feel lighter while preserving safe mobile scrolling. */
@media (min-width: 1024px) {
  #subcontratas-section-container .lg\:col-span-4,
  #subcontratas-section-container .lg\:col-span-8 {
    min-width: 0;
  }
  #subcontratas-section-container [id^="doc-item-"] {
    content-visibility: auto;
    contain-intrinsic-size: 150px;
  }
}

@media (max-width: 767px) {
  #subcontratas-section-container { gap: .9rem; }
  #subcontratas-section-container > .bg-white { border-radius: 14px; }
  #subcontratas-section-container h1 { font-size: 1.25rem !important; line-height: 1.25 !important; }
  #subcontratas-section-container .shadow-xl,
  #subcontratas-section-container .shadow-2xl { box-shadow: 0 12px 30px rgba(15, 23, 42, .16) !important; }
  /* Backdrop blur costs frames on iOS during modal scroll. */
  #subcontratas-section-container .backdrop-blur-xs { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}

.dark {
  --profea-border: #27394a;
  --profea-bg: #08121d;
  --profea-surface: #0f1c29;
}
''')

    index_path = Path('index.tsx')
    index = index_path.read_text()
    if "import './institutional-polish.css';" not in index:
        anchor = "import './subcontratas-mobile.css';"
        if anchor not in index:
            raise SystemExit('index css anchor not found')
        index = index.replace(anchor, anchor + "\nimport './institutional-polish.css';", 1)
        index_path.write_text(index)


patch_defaults()
patch_section()
patch_uploader()
create_css()
print('CAE/PDF/UI refinement applied successfully.')
