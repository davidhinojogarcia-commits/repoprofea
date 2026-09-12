from pathlib import Path
import re

api_path = Path('api/analyze-subcontractor-docs.ts')
api = api_path.read_text()

# Extend worker evidence shape inside each analysed checklist item.
api = api.replace(
"type KeyDatum = { etiqueta?: string; valor?: string };\n",
"type KeyDatum = { etiqueta?: string; valor?: string };\n\ntype WorkerEvidence = {\n  nombre?: string;\n  dni?: string;\n  estado?: string;\n  evidencia?: string;\n  fechaDesde?: string;\n  fechaHasta?: string;\n  equipo?: string;\n  autorizacion?: string;\n};\n",
1)
api = api.replace(
"  datosClave?: KeyDatum[];\n",
"  datosClave?: KeyDatum[];\n  trabajadoresRelacionados?: WorkerEvidence[];\n",
1)

schema_anchor = "          datosClave: {\n            type: Type.ARRAY,\n            items: {\n              type: Type.OBJECT,\n              properties: {\n                etiqueta: { type: Type.STRING },\n                valor: { type: Type.STRING }\n              }\n            }\n          }"
worker_schema = schema_anchor + ",\n          trabajadoresRelacionados: {\n            type: Type.ARRAY,\n            items: {\n              type: Type.OBJECT,\n              properties: {\n                nombre: { type: Type.STRING },\n                dni: { type: Type.STRING },\n                estado: { type: Type.STRING },\n                evidencia: { type: Type.STRING },\n                fechaDesde: { type: Type.STRING },\n                fechaHasta: { type: Type.STRING },\n                equipo: { type: Type.STRING },\n                autorizacion: { type: Type.STRING }\n              }\n            }\n          }"
if schema_anchor in api and 'trabajadoresRelacionados' not in api[api.index(schema_anchor):api.index(schema_anchor)+1600]:
    api = api.replace(schema_anchor, worker_schema, 1)

prompt_marker = "14. En observaciones resume la conclusión técnica y cualquier incidencia. La decisión final siempre es humana."
prompt_extra = prompt_marker + "\n15. INTERRELACIONA todos los documentos por persona usando DNI/NIE como clave principal y nombre como apoyo. Para altas_ss, formacion_prl, aptitud_medica y entrega_epis devuelve trabajadoresRelacionados con TODAS las personas visibles en el documento, su estado concreto y la evidencia.\n16. En autorizacion_maquinaria identifica trabajador, DNI, máquina/herramienta/equipo, alcance de la autorización y vigencia. No presupongas que una autorización sirve para otro equipo.\n17. En recurso_preventivo identifica la persona designada, DNI si aparece, formación/capacitación, obra y vigencia.\n18. Para marcado_ce_maquinaria y seguro_itv_maquinaria relaciona cada máquina/vehículo/equipo con matrícula o número de serie, seguro, ITV/revisión y operador si figura.\n19. Para libro_subcontratacion, adhesion_pss, evaluacion_especifica y cualquier otro punto del checklist extrae empresa, obra, fechas, firmantes, sellos, alcance y referencias documentales. No omitas un punto por no estar incluido en los ejemplos anteriores.\n20. El objetivo final es poder construir una matriz por trabajador: alta/ITA, PRL, aptitud médica, EPIs y autorizaciones específicas. Si un trabajador aparece sin acreditar uno de esos requisitos, la incidencia debe quedar explícita en la evidencia del requisito correspondiente."
api = api.replace(prompt_marker, prompt_extra, 1)

# Preserve worker evidence in normalized result.
result_anchor = "          observaciones: [raw.observaciones, structuredEvidenceText(raw)].filter(Boolean).join(' | '),"
if result_anchor in api:
    api = api.replace(result_anchor, result_anchor + "\n          trabajadoresRelacionados: Array.isArray(raw.trabajadoresRelacionados) ? raw.trabajadoresRelacionados : [],", 1)

# Add professional per-worker matrix helpers before handler.
handler_anchor = "export default async function handler(req: IncomingMessage, res: ServerResponse) {"
helper = r'''
const cleanIdentity = (value: any): string => String(value || '')
  .toUpperCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9]/g, '');

const WORKER_GLOBAL_REQUIREMENTS = ['altas_ss', 'formacion_prl', 'aptitud_medica', 'entrega_epis'];

function buildWorkerRequirementMatrix(docs: AnalysisItem[], currentWorkers: any[]) {
  const matrix = currentWorkers.map(worker => {
    const dni = cleanIdentity(worker.dni);
    const name = cleanIdentity(worker.apellidosNombre || worker.name);
    const requisitos: Record<string, any> = {};

    for (const docId of WORKER_GLOBAL_REQUIREMENTS) {
      const evidences = docs
        .filter(doc => doc.docId === docId)
        .flatMap(doc => (doc.trabajadoresRelacionados || []).map(rel => ({ ...rel, archivoOrigen: doc.archivoOrigen })));
      const matched = evidences.filter(rel => {
        const relDni = cleanIdentity(rel.dni);
        const relName = cleanIdentity(rel.nombre);
        return (dni && relDni && dni === relDni) || (name && relName && (name.includes(relName) || relName.includes(name)));
      });
      const compliant = matched.some(rel => /conforme|apto|alta|entregado|vigente|autorizado|si|sí/i.test(String(rel.estado || '')) && !/no |baja|caduc|pend|incomplet|deneg/i.test(String(rel.estado || '')));
      requisitos[docId] = {
        estado: matched.length === 0 ? 'no_acreditado' : compliant ? 'conforme' : 'incidencia',
        evidencias: matched
      };
    }

    const maquinaria = docs
      .filter(doc => doc.docId === 'autorizacion_maquinaria')
      .flatMap(doc => (doc.trabajadoresRelacionados || []).map(rel => ({ ...rel, archivoOrigen: doc.archivoOrigen })))
      .filter(rel => {
        const relDni = cleanIdentity(rel.dni);
        const relName = cleanIdentity(rel.nombre);
        return (dni && relDni && dni === relDni) || (name && relName && (name.includes(relName) || relName.includes(name)));
      });
    requisitos.autorizacion_maquinaria = {
      estado: maquinaria.length ? (maquinaria.some(rel => /no autorizado|deneg|caduc|incomplet/i.test(String(rel.estado || ''))) ? 'incidencia' : 'acreditado_si_procede') : 'sin_evidencia_no_bloqueante',
      evidencias: maquinaria
    };

    const incidencias = Object.entries(requisitos)
      .filter(([id, value]: any) => WORKER_GLOBAL_REQUIREMENTS.includes(id) && value.estado !== 'conforme')
      .map(([id, value]: any) => `${id}: ${value.estado}`);

    return {
      trabajadorId: worker.id,
      nombre: worker.apellidosNombre || worker.name || '',
      dni: worker.dni || '',
      categoria: worker.categoria || worker.category || '',
      requisitos,
      enRegla: incidencias.length === 0,
      incidencias
    };
  });
  return matrix;
}

function enrichWorkerChecklistObservations(docs: AnalysisItem[], matrix: any[]) {
  for (const docId of WORKER_GLOBAL_REQUIREMENTS) {
    const relevant = matrix.map(row => ({ row, req: row.requisitos[docId] }));
    const missing = relevant.filter(x => x.req.estado === 'no_acreditado');
    const incidents = relevant.filter(x => x.req.estado === 'incidencia');
    const compliant = relevant.filter(x => x.req.estado === 'conforme');
    const target = docs.find(d => d.docId === docId);
    if (!target && !missing.length && !incidents.length) continue;
    const detailParts = [
      `Matriz por trabajador: ${compliant.length}/${matrix.length} conformes`,
      missing.length ? `Sin acreditar: ${missing.map(x => `${x.row.nombre} (${x.row.dni || 'sin DNI'})`).join(', ')}` : '',
      incidents.length ? `Con incidencia: ${incidents.map(x => `${x.row.nombre} (${x.row.dni || 'sin DNI'})`).join(', ')}` : ''
    ].filter(Boolean);
    if (target) {
      target.observaciones = [target.observaciones, ...detailParts].filter(Boolean).join(' | ');
      if (missing.length || incidents.length) target.estado = 'incompleto';
    }
  }

  const machineTarget = docs.find(d => d.docId === 'autorizacion_maquinaria');
  if (machineTarget) {
    const machineRows = matrix.filter(row => row.requisitos.autorizacion_maquinaria.evidencias.length > 0);
    if (machineRows.length) {
      const details = machineRows.map(row => {
        const ev = row.requisitos.autorizacion_maquinaria.evidencias
          .map((e: any) => [e.equipo || e.autorizacion, e.estado].filter(Boolean).join(': '))
          .filter(Boolean).join(', ');
        return `${row.nombre} (${row.dni || 'sin DNI'}): ${ev || row.requisitos.autorizacion_maquinaria.estado}`;
      });
      machineTarget.observaciones = [machineTarget.observaciones, `Autorizaciones por operario/equipo: ${details.join(' · ')}`].filter(Boolean).join(' | ');
      if (machineRows.some(row => row.requisitos.autorizacion_maquinaria.estado === 'incidencia')) machineTarget.estado = 'incompleto';
    }
  }
}

'''
if handler_anchor in api and 'buildWorkerRequirementMatrix' not in api:
    api = api.replace(handler_anchor, helper + handler_anchor, 1)

# Compute matrix after all files have been analysed and expose it to the frontend.
comparison_anchor = "    const comparison = compareWorkers(allWorkers, Array.isArray(body.currentObraWorkers) ? body.currentObraWorkers : []);"
replacement = "    const currentWorkers = Array.isArray(body.currentObraWorkers) ? body.currentObraWorkers : [];\n    const comparison = compareWorkers(allWorkers, currentWorkers);\n    const matrizCumplimientoTrabajadores = buildWorkerRequirementMatrix(allDocs, currentWorkers);\n    enrichWorkerChecklistObservations(allDocs, matrizCumplimientoTrabajadores);\n    const evidenciasTrabajadores = allDocs.flatMap(doc => (doc.trabajadoresRelacionados || []).map(rel => ({ ...rel, docId: doc.docId, archivoOrigen: doc.archivoOrigen })));"
api = api.replace(comparison_anchor, replacement, 1)

return_anchor = "      documentosIlegibles,\n      textoRequerimiento: ''"
if return_anchor in api:
    api = api.replace(return_anchor, "      documentosIlegibles,\n      matrizCumplimientoTrabajadores,\n      evidenciasTrabajadores,\n      textoRequerimiento: ''", 1)

api_path.write_text(api)

# Frontend: aggregate per-file worker evidence and enforce the union of all imported documents.
front_path = Path('components/FileUploaderIA.tsx')
front = front_path.read_text()
front = front.replace(
"      const aggregatedWorkers: WorkerComparisonItem[] = [];\n",
"      const aggregatedWorkers: WorkerComparisonItem[] = [];\n      const aggregatedWorkerEvidence: any[] = [];\n",
1)
front = front.replace(
"        aggregatedDocs.push(...(Array.isArray(data.documentosAnalizados) ? data.documentosAnalizados : []));\n",
"        aggregatedDocs.push(...(Array.isArray(data.documentosAnalizados) ? data.documentosAnalizados : []));\n        aggregatedWorkerEvidence.push(...(Array.isArray(data.evidenciasTrabajadores) ? data.evidenciasTrabajadores : []));\n",
1)

old_block = r'''      const bestEvidence = new Map<string, SubcontrataDocAnalysisResult>();
      aggregatedDocs.forEach(doc => {
        const previous = bestEvidence.get(doc.docId);
        const previousScore = previous ? (rank[previous.estado] || 0) + (previous.confianza === 'alta' ? 0.4 : previous.confianza === 'media' ? 0.2 : 0) : -1;
        const nextScore = (rank[doc.estado] || 0) + (doc.confianza === 'alta' ? 0.4 : doc.confianza === 'media' ? 0.2 : 0);
        if (!previous || nextScore > previousScore) bestEvidence.set(doc.docId, doc);
      });
'''
new_block = r'''      const bestEvidence = new Map<string, any>();
      aggregatedDocs.forEach(doc => {
        const previous = bestEvidence.get(doc.docId);
        const previousScore = previous ? (rank[previous.estado] || 0) + (previous.confianza === 'alta' ? 0.4 : previous.confianza === 'media' ? 0.2 : 0) : -1;
        const nextScore = (rank[doc.estado] || 0) + (doc.confianza === 'alta' ? 0.4 : doc.confianza === 'media' ? 0.2 : 0);
        if (!previous || nextScore > previousScore) bestEvidence.set(doc.docId, { ...doc });
        else if (previous) {
          const observations = [previous.observaciones, doc.observaciones].filter(Boolean);
          previous.observaciones = Array.from(new Set(observations)).join(' | ');
          if (!previous.fechaEmision && doc.fechaEmision) previous.fechaEmision = doc.fechaEmision;
          if (!previous.fechaCaducidad && doc.fechaCaducidad) previous.fechaCaducidad = doc.fechaCaducidad;
        }
      });

      // Interrelate all imported files by worker identity. The union of evidence from every
      // file is what decides whether each worker requirement is complete.
      const cleanIdentity = (value: any) => String(value || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');
      const workerRequirementIds = ['altas_ss', 'formacion_prl', 'aptitud_medica', 'entrega_epis'];
      const workerNames = (currentObraWorkers || []).map(w => ({
        id: w.id,
        nombre: (w as any).apellidosNombre || (w as any).name || '',
        dni: (w as any).dni || ''
      }));

      for (const docId of workerRequirementIds) {
        const checklistItem = subcontrata.checklist.find(item => item.id === docId);
        const evidenceForRequirement = aggregatedWorkerEvidence.filter((e: any) => e.docId === docId);
        const missing: string[] = [];
        const incidents: string[] = [];
        const conforming: string[] = [];

        workerNames.forEach(worker => {
          const dni = cleanIdentity(worker.dni);
          const name = cleanIdentity(worker.nombre);
          const matches = evidenceForRequirement.filter((e: any) => {
            const eDni = cleanIdentity(e.dni);
            const eName = cleanIdentity(e.nombre);
            return (dni && eDni && dni === eDni) || (name && eName && (name.includes(eName) || eName.includes(name)));
          });
          if (!matches.length) {
            missing.push(`${worker.nombre} (${worker.dni || 'sin DNI'})`);
            return;
          }
          const isBad = matches.some((e: any) => /no autorizado|no apto|baja|caduc|pend|incomplet|deneg|no conforme/i.test(String(e.estado || '')));
          if (isBad) incidents.push(`${worker.nombre} (${worker.dni || 'sin DNI'})`);
          else conforming.push(`${worker.nombre} (${worker.dni || 'sin DNI'})`);
        });

        let doc: any = bestEvidence.get(docId);
        if (!doc && checklistItem && evidenceForRequirement.length) {
          doc = { docId, nombreDetectado: checklistItem.nombre, estado: 'entregado', confianza: 'media', esLegible: true, observaciones: '', archivoOrigen: 'Varios documentos relacionados' };
          bestEvidence.set(docId, doc);
        }
        if (doc && workerNames.length) {
          const matrixNote = [
            `Control individual: ${conforming.length}/${workerNames.length} trabajadores conformes`,
            missing.length ? `Sin acreditar: ${missing.join(', ')}` : '',
            incidents.length ? `Con incidencia: ${incidents.join(', ')}` : ''
          ].filter(Boolean).join(' · ');
          doc.observaciones = [doc.observaciones, matrixNote].filter(Boolean).join(' | ');
          if (missing.length || incidents.length) doc.estado = 'incompleto';
        }
      }

      const machineEvidence = aggregatedWorkerEvidence.filter((e: any) => e.docId === 'autorizacion_maquinaria');
      if (machineEvidence.length) {
        let machineDoc: any = bestEvidence.get('autorizacion_maquinaria');
        const item = subcontrata.checklist.find(i => i.id === 'autorizacion_maquinaria');
        if (!machineDoc && item) {
          machineDoc = { docId: item.id, nombreDetectado: item.nombre, estado: 'entregado', confianza: 'media', esLegible: true, observaciones: '', archivoOrigen: 'Varios documentos relacionados' };
          bestEvidence.set(item.id, machineDoc);
        }
        if (machineDoc) {
          const lines = machineEvidence.map((e: any) => `${e.nombre || 'Operario'} (${e.dni || 'sin DNI'})${e.equipo ? ` · ${e.equipo}` : ''}: ${e.estado || e.autorizacion || 'evidencia detectada'}`);
          machineDoc.observaciones = [machineDoc.observaciones, `Autorizaciones específicas de maquinaria/herramientas: ${lines.join(' | ')}`].filter(Boolean).join(' | ');
          if (machineEvidence.some((e: any) => /no autorizado|caduc|deneg|incomplet/i.test(String(e.estado || '')))) machineDoc.estado = 'incompleto';
        }
      }
'''
if old_block not in front:
    raise SystemExit('No se encontró el bloque bestEvidence esperado en FileUploaderIA.tsx')
front = front.replace(old_block, new_block, 1)

summary_old = "      const consolidatedSummary = `OCR/IA completado sobre ${convertedFiles.length} archivo(s). Checklist evaluado: ${proposedList.length} puntos; ${deliveredCount} con evidencia conforme; ${missing.length} pendientes/incidencias; ${expiredCount} caducados; ${unreadableCount} ilegibles. Revisión humana obligatoria antes de aplicar.`;"
summary_new = "      const workerGlobalIncidents = workerRequirementIds.reduce((acc, docId) => { const doc: any = bestEvidence.get(docId); return acc + (doc?.estado === 'incompleto' ? 1 : 0); }, 0);\n      const consolidatedSummary = `OCR/IA completado sobre ${convertedFiles.length} archivo(s). Checklist evaluado: ${proposedList.length} puntos; ${deliveredCount} con evidencia conforme; ${missing.length} pendientes/incidencias; ${expiredCount} caducados; ${unreadableCount} ilegibles. Matriz individual de ${workerNames.length} trabajador(es) cotejada en alta/ITA, PRL, aptitud médica y EPIs; ${workerGlobalIncidents} requisito(s) personales presentan incidencias. Revisión humana obligatoria antes de aplicar.`;"
front = front.replace(summary_old, summary_new, 1)
front_path.write_text(front)

print('CAE worker-document matrix refinements applied.')
