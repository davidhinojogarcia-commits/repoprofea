import type { IncomingMessage, ServerResponse } from 'http';
import { GoogleGenAI, Type } from '@google/genai';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';

type ChecklistItem = {
  id: string;
  nombre: string;
  descripcion?: string;
  normativa?: string;
  obligatorio?: boolean;
  categoria?: string;
  estado?: string;
};

type InputFile = { name: string; type?: string; base64: string };
type KeyDatum = { etiqueta?: string; valor?: string };
type WorkerEvidence = {
  nombre?: string;
  dni?: string;
  estado?: string;
  evidencia?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  equipo?: string;
  autorizacion?: string;
};

type AnalysisItem = {
  docId: string;
  nombreDetectado?: string;
  estado: 'pendiente' | 'entregado' | 'caducado' | 'incompleto' | 'no_aplica';
  fechaEmision?: string;
  fechaCaducidad?: string;
  empresaDetectada?: string;
  cifDetectado?: string;
  entidadEmisora?: string;
  observaciones?: string;
  datosClave?: KeyDatum[];
  trabajadoresRelacionados?: WorkerEvidence[];
  archivoOrigen?: string;
  confianza?: 'alta' | 'media' | 'baja';
  esLegible?: boolean;
  motivoIlegible?: string;
  solicitarReintento?: boolean;
  estaCaducado?: boolean;
  diasCaducado?: number;
  diasRestantes?: number;
  esProximaCaducidad?: boolean;
  motivoCaducidad?: string;
};

const WORKER_GLOBAL_REQUIREMENTS = ['altas_ss', 'formacion_prl', 'aptitud_medica', 'entrega_epis'];

const readBody = async (req: IncomingMessage): Promise<any> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const sendJson = (res: ServerResponse, status: number, data: any) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
};

const resolveGeminiApiKey = (): string =>
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  process.env.GEMINI_KEY ||
  process.env.VITE_GEMINI_API_KEY ||
  '';

const cleanJson = (value: string) => String(value || '')
  .trim()
  .replace(/^```json\s*/i, '')
  .replace(/^```\s*/i, '')
  .replace(/\s*```$/, '')
  .trim();

const splitDataUrl = (input: string, fallbackMime = 'application/octet-stream') => {
  const match = String(input || '').match(/^data:([^;,]+);base64,(.+)$/s);
  return match ? { mimeType: match[1], data: match[2] } : { mimeType: fallbackMime, data: input || '' };
};

const cleanIdentity = (value: any): string => String(value || '')
  .toUpperCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9]/g, '');

const isoDate = (raw?: string): string => {
  if (!raw) return '';
  const value = String(raw).trim();
  const dmy = value.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    return `${year}-${String(Number(dmy[2])).padStart(2, '0')}-${String(Number(dmy[1])).padStart(2, '0')}`;
  }
  const ymd = value.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${String(Number(ymd[2])).padStart(2, '0')}-${String(Number(ymd[3])).padStart(2, '0')}`;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

const evaluateExpiration = (docId: string, issuedRaw?: string, expiresRaw?: string) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let expires = isoDate(expiresRaw);
  const issued = isoDate(issuedRaw);
  if (!expires && issued) {
    const d = new Date(`${issued}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      if (docId === 'cert_tgss') d.setMonth(d.getMonth() + 3);
      else if (['cert_aeat', 'aptitud_medica', 'seguro_rc', 'seguro_itv_maquinaria'].includes(docId)) d.setFullYear(d.getFullYear() + 1);
      else if (docId === 'rea') d.setFullYear(d.getFullYear() + 3);
      else return { issued, expires: '', expired: false, daysExpired: 0, daysRemaining: 9999, nearExpiry: false };
      expires = d.toISOString().slice(0, 10);
    }
  }
  if (!expires) return { issued, expires: '', expired: false, daysExpired: 0, daysRemaining: 9999, nearExpiry: false };
  const exp = new Date(`${expires}T00:00:00`);
  const diff = Math.round((exp.getTime() - today.getTime()) / 86400000);
  return { issued, expires, expired: diff < 0, daysExpired: diff < 0 ? Math.abs(diff) : 0, daysRemaining: diff >= 0 ? diff : 0, nearExpiry: diff >= 0 && diff <= 30 };
};

async function extractOfficeText(file: InputFile): Promise<string> {
  const { data } = splitDataUrl(file.base64, file.type || 'application/octet-stream');
  const buffer = Buffer.from(data, 'base64');
  const lower = file.name.toLowerCase();
  try {
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const rows: string[] = [];
      workbook.eachSheet(sheet => {
        rows.push(`HOJA: ${sheet.name}`);
        sheet.eachRow((row, rowNumber) => {
          const values = (row.values as any[]).slice(1).map(v => {
            if (typeof v === 'object' && v && 'text' in v) return String((v as any).text || '');
            if (typeof v === 'object' && v && 'result' in v) return String((v as any).result || '');
            return String(v ?? '');
          }).filter(Boolean);
          if (values.length) rows.push(`Fila ${rowNumber}: ${values.join(' | ')}`);
        });
      });
      return rows.join('\n').slice(0, 140000);
    }
    if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
      const result = await mammoth.extractRawText({ buffer });
      return (result.value || '').slice(0, 140000);
    }
  } catch (error) {
    console.warn(`[CAE OCR] No se pudo extraer texto nativo de ${file.name}:`, error);
  }
  return '';
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    documentosAnalizados: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          docId: { type: Type.STRING },
          nombreDetectado: { type: Type.STRING },
          estado: { type: Type.STRING },
          fechaEmision: { type: Type.STRING },
          fechaCaducidad: { type: Type.STRING },
          empresaDetectada: { type: Type.STRING },
          cifDetectado: { type: Type.STRING },
          entidadEmisora: { type: Type.STRING },
          observaciones: { type: Type.STRING },
          confianza: { type: Type.STRING },
          esLegible: { type: Type.BOOLEAN },
          motivoIlegible: { type: Type.STRING },
          datosClave: {
            type: Type.ARRAY,
            items: { type: Type.OBJECT, properties: { etiqueta: { type: Type.STRING }, valor: { type: Type.STRING } } }
          },
          trabajadoresRelacionados: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                nombre: { type: Type.STRING },
                dni: { type: Type.STRING },
                estado: { type: Type.STRING },
                evidencia: { type: Type.STRING },
                fechaDesde: { type: Type.STRING },
                fechaHasta: { type: Type.STRING },
                equipo: { type: Type.STRING },
                autorizacion: { type: Type.STRING }
              }
            }
          }
        },
        required: ['docId', 'estado', 'confianza', 'esLegible']
      }
    },
    trabajadoresDetectados: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          nombre: { type: Type.STRING }, dni: { type: Type.STRING }, documento: { type: Type.STRING }, situacion: { type: Type.STRING }, fechaDesde: { type: Type.STRING }, fechaHasta: { type: Type.STRING }, detalle: { type: Type.STRING }
        },
        required: ['nombre']
      }
    },
    resumenDiagnostico: { type: Type.STRING }
  },
  required: ['documentosAnalizados', 'trabajadoresDetectados', 'resumenDiagnostico']
};

const structuredEvidenceText = (raw: any): string => {
  const details: string[] = [];
  if (raw.entidadEmisora) details.push(`Entidad/Emisor: ${raw.entidadEmisora}`);
  for (const item of Array.isArray(raw.datosClave) ? raw.datosClave : []) {
    const key = String(item?.etiqueta || '').trim();
    const value = String(item?.valor || '').trim();
    if (key && value) details.push(`${key}: ${value}`);
  }
  return details.length ? `Datos extraídos por OCR/IA: ${details.join(' · ')}` : '';
};

async function callGemini(ai: GoogleGenAI, parts: any[]) {
  const models = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'];
  let lastError: any;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await ai.models.generateContent({
          model,
          contents: { parts },
          config: { responseMimeType: 'application/json', responseSchema, temperature: 0.05 }
        });
      } catch (error: any) {
        lastError = error;
        const transient = /429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|overload|high demand|timeout/i.test(String(error?.message || error));
        if (!transient) break;
        await new Promise(resolve => setTimeout(resolve, 650 + attempt * 700));
      }
    }
  }
  throw lastError || new Error('No se pudo completar el análisis OCR/IA.');
}

async function analyzeOneFile(ai: GoogleGenAI, file: InputFile, checklist: ChecklistItem[], subcontrata: any, currentWorkers: any[]) {
  const lower = file.name.toLowerCase();
  const officeText = await extractOfficeText(file);
  const parts: any[] = [];
  if (officeText) parts.push({ text: `CONTENIDO EXTRAÍDO NATIVAMENTE DEL ARCHIVO ${file.name}:\n${officeText}` });
  else {
    const split = splitDataUrl(file.base64, file.type || (lower.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'));
    parts.push({ inlineData: { mimeType: split.mimeType, data: split.data } });
  }

  const checklistForPrompt = checklist.map(item => ({ id: item.id, nombre: item.nombre, descripcion: item.descripcion || '', normativa: item.normativa || '', obligatorio: !!item.obligatorio, categoria: item.categoria || '' }));
  const workerReference = currentWorkers.map(w => ({ id: w.id, nombre: w.apellidosNombre || w.name || '', dni: w.dni || '', categoria: w.categoria || w.category || '' }));

  parts.push({ text: `Eres un analista documental CAE senior y motor OCR multimodal para obras de construcción en España. Debes extraer evidencia verificable, relacionarla entre documentos y preparar una propuesta técnica para revisión humana.\n\nARCHIVO: ${file.name}\nSUBCONTRATA ESPERADA: ${JSON.stringify(subcontrata || {})}\nTRABAJADORES DE REFERENCIA DE LA OBRA: ${JSON.stringify(workerReference)}\nCHECKLIST LEGAL CONFIGURADO: ${JSON.stringify(checklistForPrompt)}\n\nPROTOCOLO OBLIGATORIO:\n1. Examina TODAS las páginas, anexos, tablas, sellos, firmas, códigos, encabezados y pies. Si es imagen/PDF, realiza OCR visual; si es Office, analiza todo el texto y tablas extraídos.\n2. No deduzcas cumplimiento por el nombre del archivo. Solo acredita un requisito cuando el contenido lo demuestra.\n3. Usa exclusivamente docId existentes en el checklist. Un archivo puede acreditar varios requisitos.\n4. Evalúa TODOS los puntos relevantes del checklist, no solo REA, SPRL o RC. Incluye libro de subcontratación, adhesión al PSS, TGSS, AEAT, evaluación específica, recurso preventivo, altas/ITA/RNT/RLC, PRL, aptitud médica, EPIs, autorizaciones de maquinaria, marcado CE, seguro/ITV y cualquier requisito personalizado presente.\n5. estado entregado solo con evidencia suficiente y vigente; incompleto si faltan páginas, firma, sello, recibo, vigencia o datos esenciales; caducado si la fecha lo demuestra; pendiente si se menciona pero no se acredita; no_aplica solo con justificación inequívoca.\n6. Nunca inventes. Si un dato no está visible, omítelo. Indica confianza alta/media/baja.\n7. Extrae empresa, CIF/NIF, entidad emisora, nº registro/póliza/contrato/certificado, fechas, coberturas, importes, especialidades preventivas, actividades, matrículas/series, firmantes y cualquier dato útil para auditoría CAE.\n8. REA: nº inscripción, empresa, CIF, alta/renovación, vigencia/estado, autoridad y actividades.\n9. SPRL y memoria: servicio de prevención, empresa cubierta, modalidad, nº contrato, especialidades concertadas, vigencia y referencia a memoria/anexo.\n10. Seguro RC: aseguradora, tomador, nº póliza, coberturas, capital/límites, inicio/fin y último recibo con fecha/importe/pago.\n11. TGSS/AEAT: titular, CIF, resultado, fecha de expedición y vigencia.\n12. INTERRELACIONA los documentos personales usando DNI/NIE como clave principal y nombre como apoyo. Para altas_ss, formacion_prl, aptitud_medica y entrega_epis devuelve trabajadoresRelacionados con todas las personas visibles, estado concreto y evidencia.\n13. En autorizacion_maquinaria identifica trabajador, DNI, máquina/herramienta/equipo, alcance y vigencia. Una autorización para un equipo NO acredita otro diferente.\n14. En recurso_preventivo identifica persona designada, DNI, formación/capacitación, obra y vigencia.\n15. En marcado_ce_maquinaria y seguro_itv_maquinaria identifica cada máquina/vehículo/equipo, matrícula/serie, titular, seguro, ITV/revisión y operador cuando conste.\n16. En libro_subcontratacion, adhesion_pss y evaluacion_especifica extrae empresa, obra, fechas, firmantes, sellos, alcance y referencias.\n17. En datosClave devuelve pares etiqueta/valor concretos para el informe: Nº REA, Servicio de prevención, Aseguradora, Nº póliza, Último recibo, Vigencia, trabajadores incluidos, etc.\n18. En observaciones explica cualquier discordancia entre empresa, CIF, obra, fechas, trabajadores o equipos y deja claro el motivo de la incidencia.\n19. La revisión humana es obligatoria y la salida no constituye aprobación jurídica definitiva.\n\nDevuelve exclusivamente JSON conforme al esquema.` });

  const response = await callGemini(ai, parts);
  return JSON.parse(cleanJson(response.text || '{}'));
}

function relationMatchesWorker(rel: WorkerEvidence, worker: any): boolean {
  const dni = cleanIdentity(worker.dni);
  const name = cleanIdentity(worker.apellidosNombre || worker.name);
  const relDni = cleanIdentity(rel.dni);
  const relName = cleanIdentity(rel.nombre);
  return Boolean((dni && relDni && dni === relDni) || (name && relName && (name.includes(relName) || relName.includes(name))));
}

function relationIsCompliant(rel: WorkerEvidence): boolean {
  const value = `${rel.estado || ''} ${rel.autorizacion || ''}`.toLowerCase();
  if (/no autorizado|no apto|baja|caduc|pend|incomplet|deneg|no conforme|rechaz/i.test(value)) return false;
  return /conforme|apto|alta|vigente|autorizado|entregado|correct|activo|activa|si|sí/i.test(value) || value.trim().length > 0;
}

function enrichWorkerRequirementStatus(docs: AnalysisItem[], currentWorkers: any[]) {
  for (const docId of WORKER_GLOBAL_REQUIREMENTS) {
    const matchingDocs = docs.filter(doc => doc.docId === docId);
    if (!matchingDocs.length) continue;
    const relations = matchingDocs.flatMap(doc => doc.trabajadoresRelacionados || []);
    const missing: string[] = [];
    const incidents: string[] = [];
    const compliant: string[] = [];
    for (const worker of currentWorkers) {
      const rels = relations.filter(rel => relationMatchesWorker(rel, worker));
      const label = `${worker.apellidosNombre || worker.name || 'Trabajador'} (${worker.dni || 'sin DNI'})`;
      if (!rels.length) missing.push(label);
      else if (rels.some(relationIsCompliant)) compliant.push(label);
      else incidents.push(label);
    }
    const summary = [
      `Control individual: ${compliant.length}/${currentWorkers.length} trabajadores conformes`,
      missing.length ? `Sin acreditar en este requisito: ${missing.join(', ')}` : '',
      incidents.length ? `Con incidencia: ${incidents.join(', ')}` : ''
    ].filter(Boolean).join(' · ');
    for (const doc of matchingDocs) {
      doc.observaciones = [doc.observaciones, summary].filter(Boolean).join(' | ');
      if (missing.length || incidents.length) doc.estado = 'incompleto';
    }
  }

  const machineDocs = docs.filter(doc => doc.docId === 'autorizacion_maquinaria');
  if (machineDocs.length) {
    const lines = machineDocs.flatMap(doc => doc.trabajadoresRelacionados || []).map(rel => `${rel.nombre || 'Operario'} (${rel.dni || 'sin DNI'})${rel.equipo ? ` · ${rel.equipo}` : ''}: ${rel.estado || rel.autorizacion || 'evidencia detectada'}`);
    if (lines.length) for (const doc of machineDocs) doc.observaciones = [doc.observaciones, `Autorizaciones específicas por operario/equipo: ${lines.join(' · ')}`].filter(Boolean).join(' | ');
    if (machineDocs.some(doc => (doc.trabajadoresRelacionados || []).some(rel => !relationIsCompliant(rel)))) machineDocs.forEach(doc => { doc.estado = 'incompleto'; });
  }
}

function compareWorkers(detected: any[], currentWorkers: any[]) {
  const coincidentes: any[] = [];
  const noRegistradosEnObra: any[] = [];
  for (const det of detected) {
    const dni = cleanIdentity(det.dni || '');
    const name = cleanIdentity(det.nombre || '');
    const found = currentWorkers.find((w: any) => (dni && cleanIdentity(w.dni) === dni) || (name && cleanIdentity(w.apellidosNombre || w.name).includes(name.slice(0, Math.min(name.length, 12)))));
    const item = {
      nombreDetectado: det.nombre || '', dniDetectado: det.dni || '', archivoOrigen: det.archivoOrigen || '', coincideConObra: !!found, trabajadorObraId: found?.id,
      nombreEnObra: found?.apellidosNombre || found?.name, dniEnObra: found?.dni, categoriaEnObra: found?.categoria || found?.category,
      estadoCotejo: found ? 'coincidente' : 'no_registrado', detalles: found ? 'Coincidencia encontrada en el censo de la obra.' : 'No se ha encontrado coincidencia inequívoca en el censo de la obra.'
    };
    (found ? coincidentes : noRegistradosEnObra).push(item);
  }
  const pending = currentWorkers.filter((w: any) => !coincidentes.some(c => String(c.trabajadorObraId) === String(w.id))).map((w: any) => ({ id: Number(w.id) || 0, apellidosNombre: w.apellidosNombre || w.name || '', dni: w.dni || '', categoria: w.categoria || w.category || '' }));
  return { totalTrabajadoresObra: currentWorkers.length, totalDetectadosEnDocs: detected.length, coincidentes, noRegistradosEnObra, pendientesDeAcreditar: pending, porcentajeAcreditacion: currentWorkers.length ? Math.round((coincidentes.length / currentWorkers.length) * 100) : 0 };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido.' });
  try {
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) return sendJson(res, 500, { error: 'No hay credencial de Gemini configurada en el servidor. Configure GEMINI_API_KEY (o GOOGLE_API_KEY) en el entorno de Vercel.' });

    const body = await readBody(req);
    const files: InputFile[] = Array.isArray(body.files) ? body.files : [];
    const checklist: ChecklistItem[] = Array.isArray(body.currentChecklist) ? body.currentChecklist : [];
    const currentWorkers = Array.isArray(body.currentObraWorkers) ? body.currentObraWorkers : [];
    if (!files.length) return sendJson(res, 400, { error: 'No se proporcionaron archivos para analizar.' });
    if (!checklist.length) return sendJson(res, 400, { error: 'No se proporcionó el checklist legal configurado.' });
    if (files.length > 6) return sendJson(res, 400, { error: 'Analice un máximo de 6 archivos por petición.' });

    const ai = new GoogleGenAI({ apiKey });
    const allDocs: AnalysisItem[] = [];
    const allWorkers: any[] = [];
    const summaries: string[] = [];
    const documentosIlegibles: any[] = [];

    for (const file of files) {
      const parsed = await analyzeOneFile(ai, file, checklist, body.subcontrata || {}, currentWorkers);
      summaries.push(`${file.name}: ${parsed.resumenDiagnostico || 'analizado'}`);
      for (const worker of Array.isArray(parsed.trabajadoresDetectados) ? parsed.trabajadoresDetectados : []) allWorkers.push({ ...worker, archivoOrigen: file.name });
      for (const raw of Array.isArray(parsed.documentosAnalizados) ? parsed.documentosAnalizados : []) {
        if (!checklist.some(item => item.id === raw.docId)) continue;
        const expiry = evaluateExpiration(raw.docId, raw.fechaEmision, raw.fechaCaducidad);
        const illegible = raw.esLegible === false;
        let estado: AnalysisItem['estado'] = ['entregado', 'incompleto', 'caducado', 'pendiente', 'no_aplica'].includes(raw.estado) ? raw.estado : 'incompleto';
        if (illegible) estado = 'incompleto'; else if (expiry.expired) estado = 'caducado';
        const result: AnalysisItem = {
          docId: raw.docId,
          nombreDetectado: raw.nombreDetectado || checklist.find(i => i.id === raw.docId)?.nombre,
          estado,
          fechaEmision: expiry.issued || raw.fechaEmision || '', fechaCaducidad: expiry.expires || raw.fechaCaducidad || '',
          empresaDetectada: raw.empresaDetectada || '', cifDetectado: raw.cifDetectado || '', entidadEmisora: raw.entidadEmisora || '',
          observaciones: [raw.observaciones, structuredEvidenceText(raw)].filter(Boolean).join(' | '),
          datosClave: Array.isArray(raw.datosClave) ? raw.datosClave : [],
          trabajadoresRelacionados: Array.isArray(raw.trabajadoresRelacionados) ? raw.trabajadoresRelacionados : [],
          archivoOrigen: file.name,
          confianza: ['alta', 'media', 'baja'].includes(raw.confianza) ? raw.confianza : 'media',
          esLegible: !illegible, motivoIlegible: raw.motivoIlegible || '', solicitarReintento: illegible,
          estaCaducado: expiry.expired, diasCaducado: expiry.daysExpired, diasRestantes: expiry.daysRemaining, esProximaCaducidad: expiry.nearExpiry,
          motivoCaducidad: expiry.expired ? `Documento caducado hace ${expiry.daysExpired} días.` : expiry.nearExpiry ? `Caduca en ${expiry.daysRemaining} días.` : ''
        };
        allDocs.push(result);
        if (illegible) documentosIlegibles.push({ archivo: file.name, motivo: result.motivoIlegible || 'OCR insuficiente para verificar el documento.', docRelacionado: raw.docId, confianza: result.confianza });
      }
    }

    enrichWorkerRequirementStatus(allDocs, currentWorkers);
    const comparison = compareWorkers(allWorkers, currentWorkers);
    const evidenciasTrabajadores = allDocs.flatMap(doc => (doc.trabajadoresRelacionados || []).map(rel => ({ ...rel, docId: doc.docId, archivoOrigen: doc.archivoOrigen })));
    const alertasCaducidad = allDocs.filter(d => d.estaCaducado || d.esProximaCaducidad).map(d => `${d.nombreDetectado || d.docId}: ${d.motivoCaducidad}`);
    const workerIncidences = allDocs.filter(d => WORKER_GLOBAL_REQUIREMENTS.includes(d.docId) && d.estado === 'incompleto').length;

    return sendJson(res, 200, {
      success: true,
      documentosAnalizados: allDocs,
      resumenDiagnostico: `${summaries.join(' | ')}${currentWorkers.length ? ` | Cotejo individual: ${currentWorkers.length} trabajador(es), ${workerIncidences} requisito(s) personales con incidencias en los documentos analizados.` : ''}`,
      veredictoAcceso: allDocs.some(d => d.estaCaducado || d.estado === 'incompleto') ? 'CONDICIONADO' : 'APTO',
      relacionFaltantes: [], comparativaTrabajadores: comparison, evidenciasTrabajadores, alertasCaducidad, documentosIlegibles, textoRequerimiento: ''
    });
  } catch (error: any) {
    console.error('[CAE OCR API]', error);
    return sendJson(res, 500, { error: error?.message || 'Error procesando la documentación CAE con OCR/IA.' });
  }
}
