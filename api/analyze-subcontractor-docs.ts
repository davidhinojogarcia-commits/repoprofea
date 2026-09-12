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
  return {
    issued,
    expires,
    expired: diff < 0,
    daysExpired: diff < 0 ? Math.abs(diff) : 0,
    daysRemaining: diff >= 0 ? diff : 0,
    nearExpiry: diff >= 0 && diff <= 30,
  };
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
      workbook.eachSheet((sheet) => {
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
            items: {
              type: Type.OBJECT,
              properties: {
                etiqueta: { type: Type.STRING },
                valor: { type: Type.STRING }
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
          nombre: { type: Type.STRING },
          dni: { type: Type.STRING },
          documento: { type: Type.STRING },
          situacion: { type: Type.STRING },
          fechaDesde: { type: Type.STRING },
          fechaHasta: { type: Type.STRING },
          detalle: { type: Type.STRING }
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
          config: {
            responseMimeType: 'application/json',
            responseSchema,
            temperature: 0.05,
          }
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

  if (officeText) {
    parts.push({ text: `CONTENIDO EXTRAÍDO NATIVAMENTE DEL ARCHIVO ${file.name}:\n${officeText}` });
  } else {
    const split = splitDataUrl(file.base64, file.type || (lower.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'));
    parts.push({ inlineData: { mimeType: split.mimeType, data: split.data } });
  }

  const checklistForPrompt = checklist.map(item => ({
    id: item.id,
    nombre: item.nombre,
    descripcion: item.descripcion || '',
    normativa: item.normativa || '',
    obligatorio: !!item.obligatorio,
    categoria: item.categoria || ''
  }));
  const workerReference = currentWorkers.map(w => ({
    id: w.id,
    nombre: w.apellidosNombre || w.name || '',
    dni: w.dni || '',
    categoria: w.categoria || w.category || ''
  }));

  parts.push({ text: `Eres un analista documental CAE senior y motor OCR multimodal para obras de construcción en España. Tu trabajo es extraer evidencia verificable y preparar una propuesta técnica para revisión humana.

ARCHIVO: ${file.name}
SUBCONTRATA ESPERADA: ${JSON.stringify(subcontrata || {})}
TRABAJADORES DE REFERENCIA DE LA OBRA: ${JSON.stringify(workerReference)}
CHECKLIST LEGAL CONFIGURADO: ${JSON.stringify(checklistForPrompt)}

PROTOCOLO OBLIGATORIO:
1. Examina TODAS las páginas, anexos, tablas, sellos, firmas, códigos, encabezados y pies. Si es imagen/PDF, realiza OCR visual; si es Office, analiza todo el texto y tablas extraídos.
2. No deduzcas cumplimiento por el nombre del archivo. Solo acredita un requisito cuando el contenido lo demuestra.
3. Usa exclusivamente docId existentes en el checklist. Un archivo puede acreditar varios requisitos.
4. Devuelve estado entregado solo con evidencia suficiente y vigente; incompleto si faltan páginas, firma, sello, recibo, vigencia o datos esenciales; caducado si la fecha lo demuestra; pendiente si se menciona pero no se acredita; no_aplica solo cuando el propio documento lo justifique inequívocamente.
5. Nunca inventes. Si un dato no está visible, omítelo. Indica confianza alta/media/baja.
6. Extrae empresa, CIF/NIF, entidad emisora, número de registro/póliza/contrato/certificado, fechas de emisión y vencimiento, periodos de cobertura, importes/capital asegurado, especialidades preventivas, actividades autorizadas, matrícula/equipo y cualquier dato útil para auditoría CAE.
7. REA: extrae nº de inscripción/registro, empresa, CIF, fecha de inscripción/renovación, vigencia o estado, autoridad emisora y actividades/especialidades que consten.
8. CONCIERTO SPRL Y MEMORIA: identifica claramente qué Servicio de Prevención presta el servicio, a qué empresa, modalidad, nº de contrato si existe, especialidades concertadas (Seguridad, Higiene, Ergonomía/Psicosociología, Vigilancia de la Salud), fecha, vigencia y referencia a memoria/anexo.
9. SEGURO RC: identifica aseguradora, tomador, nº de póliza, cobertura/objeto, capital o límite si aparece, fecha inicio/fin; comprueba si se aporta último recibo, nº de recibo, importe/fecha de pago y si parece pagado/vigente.
10. TGSS/AEAT: extrae titular, CIF, resultado positivo/negativo, fecha de expedición y vigencia cuando figure.
11. DOCUMENTOS DE TRABAJADORES: extrae todos los nombres y DNI/NIE legibles, situación de alta/autorización, formación, aptitud, EPI o maquinaria según corresponda, con fechas y evidencia. Contrasta literalmente con la lista de trabajadores de referencia, pero no fuerces coincidencias ambiguas.
12. MAQUINARIA: extrae identificación, matrícula/serie, titular, CE, ITV/revisión, seguro, fechas y operador autorizado cuando conste.
13. En datosClave devuelve pares etiqueta/valor muy concretos y útiles para que aparezcan después en el informe técnico. Evita texto genérico. Ejemplos: "Nº REA", "Servicio de prevención", "Aseguradora", "Nº póliza", "Último recibo", "Vigencia", "Trabajadores incluidos".
14. En observaciones resume la conclusión técnica y cualquier incidencia. La decisión final siempre es humana.

Devuelve exclusivamente JSON conforme al esquema.` });

  const response = await callGemini(ai, parts);
  return JSON.parse(cleanJson(response.text || '{}'));
}

const normalizeIdentity = (value: string) => String(value || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');

function compareWorkers(detected: any[], currentWorkers: any[]) {
  const coincidentes: any[] = [];
  const noRegistradosEnObra: any[] = [];
  const seen = new Set<string>();

  for (const det of detected) {
    const dni = normalizeIdentity(det.dni || '');
    const name = normalizeIdentity(det.nombre || '');
    const dedupeKey = dni || `${name}:${det.archivoOrigen || ''}`;
    if (dedupeKey && seen.has(dedupeKey)) continue;
    if (dedupeKey) seen.add(dedupeKey);

    const found = currentWorkers.find((w: any) => {
      const workerDni = normalizeIdentity(w.dni || '');
      const workerName = normalizeIdentity(w.apellidosNombre || w.name || '');
      if (dni && workerDni && dni === workerDni) return true;
      if (name.length >= 10 && workerName.length >= 10) return workerName.includes(name) || name.includes(workerName);
      return false;
    });

    const item = {
      nombreDetectado: det.nombre || '',
      dniDetectado: det.dni || '',
      archivoOrigen: det.archivoOrigen || '',
      coincideConObra: !!found,
      trabajadorObraId: found?.id,
      nombreEnObra: found?.apellidosNombre || found?.name,
      dniEnObra: found?.dni,
      categoriaEnObra: found?.categoria || found?.category,
      estadoCotejo: found ? 'coincidente' : 'no_registrado',
      detalles: found
        ? `Autorizado/censado en la obra. ${det.situacion || det.detalle || ''}`.trim()
        : `Detectado en documentación pero no localizado inequívocamente en el censo de obra. ${det.situacion || det.detalle || ''}`.trim()
    };
    (found ? coincidentes : noRegistradosEnObra).push(item);
  }

  const pending = currentWorkers.filter((w: any) => !coincidentes.some(c => String(c.trabajadorObraId) === String(w.id))).map((w: any) => ({
    id: Number(w.id) || 0,
    apellidosNombre: w.apellidosNombre || w.name || '',
    dni: w.dni || '',
    categoria: w.categoria || w.category || ''
  }));

  return {
    totalTrabajadoresObra: currentWorkers.length,
    totalDetectadosEnDocs: coincidentes.length + noRegistradosEnObra.length,
    coincidentes,
    noRegistradosEnObra,
    pendientesDeAcreditar: pending,
    porcentajeAcreditacion: currentWorkers.length ? Math.round((coincidentes.length / currentWorkers.length) * 100) : 0
  };
}

const appendWorkerAuditToDocuments = (docs: AnalysisItem[], comparison: any) => {
  const authorized = comparison.coincidentes || [];
  const notAuthorized = comparison.noRegistradosEnObra || [];
  const pending = comparison.pendientesDeAcreditar || [];
  const workerDocIds = new Set(['altas_ss', 'formacion_prl', 'aptitud_medica', 'entrega_epis', 'autorizacion_maquinaria', 'tc1_rlc_mensual']);
  const summarize = (items: any[], max = 14) => items.slice(0, max).map((item: any) => {
    const name = item.nombreEnObra || item.nombreDetectado || item.apellidosNombre || 'Sin nombre';
    const dni = item.dniEnObra || item.dniDetectado || item.dni || '';
    return dni ? `${name} (${dni})` : name;
  }).join(', ');

  for (const doc of docs) {
    if (!workerDocIds.has(doc.docId)) continue;
    const parts = [doc.observaciones || ''];
    if (authorized.length) parts.push(`Trabajadores cotejados/autorizados en obra: ${summarize(authorized)}${authorized.length > 14 ? ` (+${authorized.length - 14})` : ''}.`);
    if (notAuthorized.length) parts.push(`Trabajadores detectados NO localizados en el censo/autorización de obra: ${summarize(notAuthorized)}${notAuthorized.length > 14 ? ` (+${notAuthorized.length - 14})` : ''}.`);
    if (pending.length) parts.push(`Trabajadores del censo sin acreditación encontrada en estos documentos: ${summarize(pending)}${pending.length > 14 ? ` (+${pending.length - 14})` : ''}.`);
    doc.observaciones = parts.filter(Boolean).join(' ');
  }
};

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido.' });

  try {
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) {
      return sendJson(res, 503, {
        error: 'El servicio de análisis IA no dispone todavía de una credencial de Gemini en el entorno del servidor.',
        code: 'AI_CONFIG_MISSING',
        detail: 'Se admite GEMINI_API_KEY y, por compatibilidad, GOOGLE_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY o GEMINI_KEY.'
      });
    }

    const body = await readBody(req);
    const files: InputFile[] = Array.isArray(body.files) ? body.files : [];
    const checklist: ChecklistItem[] = Array.isArray(body.currentChecklist) ? body.currentChecklist : [];
    const currentWorkers: any[] = Array.isArray(body.currentObraWorkers) ? body.currentObraWorkers : [];
    if (!files.length) return sendJson(res, 400, { error: 'No se proporcionaron archivos para analizar.' });
    if (!checklist.length) return sendJson(res, 400, { error: 'No se proporcionó el checklist legal configurado.' });
    if (files.length > 6) return sendJson(res, 400, { error: 'Analice un máximo de 6 archivos por petición. La interfaz los procesa automáticamente por lotes.' });

    const ai = new GoogleGenAI({ apiKey });
    const allDocs: AnalysisItem[] = [];
    const allWorkers: any[] = [];
    const summaries: string[] = [];
    const documentosIlegibles: any[] = [];

    for (const file of files) {
      const parsed = await analyzeOneFile(ai, file, checklist, body.subcontrata || {}, currentWorkers);
      summaries.push(`${file.name}: ${parsed.resumenDiagnostico || 'analizado'}`);

      for (const worker of Array.isArray(parsed.trabajadoresDetectados) ? parsed.trabajadoresDetectados : []) {
        allWorkers.push({ ...worker, archivoOrigen: file.name });
      }

      for (const raw of Array.isArray(parsed.documentosAnalizados) ? parsed.documentosAnalizados : []) {
        const checklistItem = checklist.find(item => item.id === raw.docId);
        if (!checklistItem) continue;
        const expiry = evaluateExpiration(raw.docId, raw.fechaEmision, raw.fechaCaducidad);
        const illegible = raw.esLegible === false;
        let estado: AnalysisItem['estado'] = ['entregado', 'incompleto', 'caducado', 'pendiente', 'no_aplica'].includes(raw.estado) ? raw.estado : 'incompleto';
        if (illegible) estado = 'incompleto';
        else if (expiry.expired) estado = 'caducado';

        const evidence = structuredEvidenceText(raw);
        const observations = [raw.observaciones || '', evidence].filter(Boolean).join(' | ');
        const result: AnalysisItem = {
          docId: raw.docId,
          nombreDetectado: raw.nombreDetectado || checklistItem.nombre,
          estado,
          fechaEmision: expiry.issued || raw.fechaEmision || '',
          fechaCaducidad: expiry.expires || raw.fechaCaducidad || '',
          empresaDetectada: raw.empresaDetectada || '',
          cifDetectado: raw.cifDetectado || '',
          entidadEmisora: raw.entidadEmisora || '',
          datosClave: Array.isArray(raw.datosClave) ? raw.datosClave : [],
          observaciones: observations,
          archivoOrigen: file.name,
          confianza: ['alta', 'media', 'baja'].includes(raw.confianza) ? raw.confianza : 'media',
          esLegible: !illegible,
          motivoIlegible: raw.motivoIlegible || '',
          solicitarReintento: illegible,
          estaCaducado: expiry.expired,
          diasCaducado: expiry.daysExpired,
          diasRestantes: expiry.daysRemaining,
          esProximaCaducidad: expiry.nearExpiry,
          motivoCaducidad: expiry.expired ? `Documento caducado hace ${expiry.daysExpired} días.` : expiry.nearExpiry ? `Caduca en ${expiry.daysRemaining} días.` : ''
        };
        allDocs.push(result);
        if (illegible) documentosIlegibles.push({ archivo: file.name, motivo: result.motivoIlegible || 'OCR insuficiente para verificar el documento.', docRelacionado: raw.docId, confianza: result.confianza });
      }
    }

    const comparison = compareWorkers(allWorkers, currentWorkers);
    appendWorkerAuditToDocuments(allDocs, comparison);

    const alertasCaducidad = allDocs.filter(d => d.estaCaducado || d.esProximaCaducidad).map(d => `${d.nombreDetectado || d.docId}: ${d.motivoCaducidad}`);
    const detectedIds = new Set(allDocs.filter(d => ['entregado', 'no_aplica'].includes(d.estado)).map(d => d.docId));
    const missing = checklist.filter(i => i.obligatorio && !detectedIds.has(i.id)).map(i => i.nombre);
    const hasCriticalIssues = allDocs.some(d => d.estaCaducado || d.estado === 'incompleto') || missing.length > 0 || comparison.noRegistradosEnObra.length > 0;

    const auditSummary = [
      `OCR/IA exhaustivo: ${files.length} archivo(s)`,
      `${allDocs.length} evidencias asociadas al checklist`,
      `${comparison.coincidentes.length} trabajador(es) cotejados`,
      `${comparison.noRegistradosEnObra.length} trabajador(es) detectados no localizados en obra`,
      `${missing.length} requisito(s) obligatorio(s) sin acreditar en esta revisión`
    ].join(' · ');

    return sendJson(res, 200, {
      success: true,
      documentosAnalizados: allDocs,
      resumenDiagnostico: `${auditSummary}. ${summaries.join(' | ')}`,
      veredictoAcceso: hasCriticalIssues ? 'CONDICIONADO' : 'APTO',
      relacionFaltantes: missing,
      comparativaTrabajadores: comparison,
      alertasCaducidad,
      documentosIlegibles,
      textoRequerimiento: '',
      motorAnalisis: 'OCR multimodal + extracción estructurada + cotejo CAE'
    });
  } catch (error: any) {
    console.error('[CAE OCR API]', error);
    return sendJson(res, 500, { error: error?.message || 'Error procesando la documentación CAE con OCR/IA.', code: 'AI_ANALYSIS_FAILED' });
  }
}
