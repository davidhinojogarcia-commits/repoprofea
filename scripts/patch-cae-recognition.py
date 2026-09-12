from pathlib import Path
import re

path = Path('api/analyze-subcontractor-docs.ts')
text = path.read_text(encoding='utf-8')

old_analyze = """async function analyzeOcr(file: InputFile, ocr: OcrDocument, checklist: ChecklistItem[], subcontrata: any): Promise<{ raw: any; provider: Provider }> {
  const prompt = analysisPrompt(file, ocr, checklist, subcontrata);
  try {
    const raw = await callGateway('openai/gpt-5.6-sol', prompt, analysisSchema, 'cae_document_assessment', 8_000);
    return { raw, provider: 'vercel-ai-gateway' };
  } catch (gatewayError) {
    const key = geminiKey();
    if (!key) throw gatewayError;
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash', contents: prompt,
      config: { responseMimeType: 'application/json', responseSchema: analysisSchema as any, temperature: 0 }
    });
    return { raw: JSON.parse(String(response.text || '{}')), provider: 'gemini' };
  }
}
"""

new_analyze = """async function analyzeOcr(file: InputFile, ocr: OcrDocument, checklist: ChecklistItem[], subcontrata: any): Promise<{ raw: any; provider: Provider }> {
  const prompt = analysisPrompt(file, ocr, checklist, subcontrata);
  let gatewayError: unknown = new Error('AI_GATEWAY_UNAVAILABLE');
  for (const model of ['openai/gpt-5.6-sol', 'anthropic/claude-sonnet-5', 'google/gemini-2.5-flash']) {
    try {
      const raw = await callGateway(model, prompt, analysisSchema, 'cae_document_assessment', 8_000);
      return { raw, provider: 'vercel-ai-gateway' };
    } catch (error) {
      gatewayError = error;
      console.warn(`[CAE] Cotejo IA falló con ${model} para ${file.name}:`, error instanceof Error ? error.message : 'error');
    }
  }

  const key = geminiKey();
  if (!key) throw gatewayError;
  const ai = new GoogleGenAI({ apiKey: key });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash', contents: prompt,
    config: { responseMimeType: 'application/json', responseSchema: analysisSchema as any, temperature: 0 }
  });
  return { raw: JSON.parse(String(response.text || '{}')), provider: 'gemini' };
}
"""

new_block = r'''const semanticConcepts: Array<{ keys: string[]; aliases: string[]; strong: string[][] }> = [
  { keys: ['rea', 'registro empresas acreditadas', 'empresa acreditada'], aliases: ['registro de empresas acreditadas', 'certificado rea', 'inscripcion rea', 'empresa acreditada'], strong: [['registro de empresas acreditadas']] },
  { keys: ['adhesion', 'plan seguridad', 'pss'], aliases: ['adhesion al plan de seguridad', 'plan de seguridad y salud', 'acta de adhesion'], strong: [['plan de seguridad y salud']] },
  { keys: ['seguro', 'responsabilidad civil'], aliases: ['responsabilidad civil', 'poliza de seguro', 'seguro de responsabilidad civil'], strong: [['responsabilidad civil'], ['poliza']] },
  { keys: ['tgss', 'seguridad social'], aliases: ['tesoreria general de la seguridad social', 'corriente en las obligaciones de seguridad social'], strong: [['tesoreria general', 'seguridad social']] },
  { keys: ['aeat', 'tributaria', 'hacienda'], aliases: ['agencia estatal de administracion tributaria', 'obligaciones tributarias', 'corriente obligaciones tributarias'], strong: [['agencia estatal', 'tributaria']] },
  { keys: ['reconocimiento medico', 'aptitud medica', 'vigilancia salud', 'apto'], aliases: ['aptitud medica', 'apto medico', 'vigilancia de la salud', 'reconocimiento medico'], strong: [['aptitud'], ['vigilancia de la salud']] },
  { keys: ['formacion prl', 'prevencion riesgos', 'curso prl'], aliases: ['formacion en prevencion', 'prevencion de riesgos laborales', 'curso prl', 'tarjeta profesional de la construccion'], strong: [['prevencion', 'formacion']] },
  { keys: ['epis', 'equipos proteccion'], aliases: ['entrega de epis', 'equipos de proteccion individual', 'entrega de equipos de proteccion'], strong: [['proteccion individual']] },
  { keys: ['altas ss', 'rnt', 'rlc', 'trabajadores alta'], aliases: ['informe de trabajadores en alta', 'relacion nominal de trabajadores', 'rnt', 'rlc'], strong: [['trabajadores', 'seguridad social']] },
  { keys: ['recurso preventivo'], aliases: ['recurso preventivo', 'designacion de recurso preventivo'], strong: [['recurso preventivo']] },
  { keys: ['evaluacion riesgos', 'planificacion preventiva'], aliases: ['evaluacion de riesgos', 'planificacion preventiva'], strong: [['evaluacion de riesgos']] },
  { keys: ['libro subcontratacion'], aliases: ['libro de subcontratacion', 'diligencia de habilitacion'], strong: [['libro de subcontratacion']] },
  { keys: ['servicio prevencion', 'sprl', 'concierto prevencion'], aliases: ['servicio de prevencion ajeno', 'concierto de prevencion'], strong: [['servicio de prevencion']] },
  { keys: ['marcado ce', 'declaracion conformidad'], aliases: ['declaracion ce de conformidad', 'marcado ce'], strong: [['conformidad']] },
  { keys: ['itv', 'maquinaria'], aliases: ['inspeccion tecnica', 'itv', 'seguro de maquinaria'], strong: [['inspeccion tecnica']] }
];

const conceptsForItem = (item: ChecklistItem) => {
  const fingerprint = normalizeText(`${item.id} ${item.nombre} ${item.descripcion || ''} ${item.normativa || ''} ${item.categoria || ''}`);
  return semanticConcepts.filter(concept => concept.keys.some(key => fingerprint.includes(normalizeText(key))));
};

const strongDeterministicEvidence = (item: ChecklistItem, searchable: string) => {
  const concepts = conceptsForItem(item);
  return concepts.some(concept => concept.strong.some(group => group.every(term => searchable.includes(normalizeText(term)))));
};

function deterministicAssessment(file: InputFile, ocr: OcrDocument, checklist: ChecklistItem[]) {
  const searchable = normalizeText(ocr.plainText);
  const fileName = normalizeText(file.name);
  const documents = checklist.flatMap(item => {
    const concepts = conceptsForItem(item);
    const phrases = [item.nombre, item.descripcion || '', ...concepts.flatMap(concept => concept.aliases)]
      .map(normalizeText)
      .filter(value => value.length > 4);
    const evidencePhrase = phrases.find(phrase => searchable.includes(phrase));
    if (!evidencePhrase) return [];

    const strong = strongDeterministicEvidence(item, searchable);
    const filenameSupports = concepts.some(concept => concept.keys.some(key => fileName.includes(normalizeText(key))))
      || phrases.some(phrase => phrase.length > 5 && fileName.includes(phrase));

    return [{
      docId: item.id,
      state: strong && ocr.legible ? 'entregado' : (ocr.legible ? 'incompleto' : 'pendiente'),
      issuedDate: '', expiryDate: '', company: '', taxId: '',
      evidence: evidencePhrase,
      evidencePage: 1,
      observations: strong
        ? 'Evidencia textual compatible con este punto del checklist detectada en el contenido del documento.'
        : filenameSupports
          ? 'El nombre del archivo orienta el tipo documental, pero la propuesta se basa en coincidencia real dentro del contenido extraído.'
          : 'Coincidencia textual detectada en el contenido; requiere revisión humana.',
      confidence: strong ? 'media' : 'baja'
    }];
  });

  return {
    documents,
    workers: ocr.workers || [],
    summary: documents.length ? `Se encontraron evidencias para ${documents.length} punto(s) del checklist en este archivo.` : ''
  };
}

'''

if old_analyze not in text:
    raise SystemExit('analyzeOcr block not found')
text = text.replace(old_analyze, new_analyze, 1)

pattern = re.compile(r"const strongDeterministicEvidence = .*?\nconst validateDocuments =", re.S)
if not pattern.search(text):
    raise SystemExit('deterministic block not found')
text = pattern.sub(new_block + 'const validateDocuments =', text, count=1)

old_summary = "      summaries.push(`${file.name}: ${String(assessed?.summary || ocr.observations || 'analizado')}`);"
new_summary = "      const fileSummary = String(assessed?.summary || '').trim();\n      if (fileSummary) summaries.push(fileSummary);"
if old_summary not in text:
    raise SystemExit('summary line not found')
text = text.replace(old_summary, new_summary, 1)
text = text.replace("      resumenDiagnostico: summaries.join(' | '),", "      resumenDiagnostico: summaries.length ? summaries.join(' ') : 'Expediente procesado contra el checklist configurado.',", 1)
text = text.replace("      engineVersion: '2.2.0',", "      engineVersion: '2.3.0',", 1)
text = text.replace("{ error: message, engineVersion: '2.2.0' }", "{ error: message, engineVersion: '2.3.0' }", 1)

path.write_text(text, encoding='utf-8')
print('CAE recognition patch applied safely')
