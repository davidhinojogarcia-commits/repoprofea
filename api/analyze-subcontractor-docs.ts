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

type AnalysisItem = {
  docId: string;
  nombreDetectado?: string;
  estado: 'pendiente' | 'entregado' | 'caducado' | 'incompleto' | 'no_aplica';
  fechaEmision?: string;
  fechaCaducidad?: string;
  empresaDetectada?: string;
  cifDetectado?: string;
  observaciones?: string;
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

const cleanJson = (value: string) => (value || '')
  .trim()
  .replace(/^```json\s*/i, '')
  .replace(/^```\s*/i, '')
  .replace(/\s*```$/, '')
  .trim();

const splitDataUrl = (input: string, fallbackMime = 'application/octet-stream') => {
  const match = (input || '').match(/^data:([^;,]+);base64,(.+)$/s);
  return match
    ? { mimeType: match[1], data: match[2] }
    : { mimeType: fallbackMime, data: input || '' };
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
      else if (docId === 'cert_aeat' || docId === 'aptitud_medica' || docId === 'seguro_rc' || docId === 'seguro_itv_maquinaria') d.setFullYear(d.getFullYear() + 1);
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
        sheet.eachRow((row) => {
          const values = (row.values as any[]).slice(1).map(v => typeof v === 'object' && v && 'text' in v ? String((v as any).text || '') : String(v ?? '')).filter(Boolean);
          if (values.length) rows.push(values.join(' | '));
        });
      });
      return rows.join('\n').slice(0, 120000);
    }
    if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
      const result = await mammoth.extractRawText({ buffer });
      return (result.value || '').slice(0, 120000);
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
          observaciones: { type: Type.STRING },
          confianza: { type: Type.STRING },
          esLegible: { type: Type.BOOLEAN },
          motivoIlegible: { type: Type.STRING }
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
          dni: { type: Type.STRING }
        },
        required: ['nombre']
      }
    },
    resumenDiagnostico: { type: Type.STRING }
  },
  required: ['documentosAnalizados', 'trabajadoresDetectados', 'resumenDiagnostico']
};

async function analyzeOneFile(ai: GoogleGenAI, file: InputFile, checklist: ChecklistItem[], subcontrata: any) {
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

  parts.push({
    text: `Actúa como motor OCR + analista documental CAE especializado en construcción y normativa española. Analiza EXHAUSTIVAMENTE TODAS LAS PÁGINAS, tablas, sellos, membretes, anexos, firmas, fechas y texto legible del archivo "${file.name}".

SUBCONTRATA ESPERADA:
${JSON.stringify(subcontrata || {})}

CHECKLIST LEGAL CONFIGURADO (usa exclusivamente estos id al clasificar):
${JSON.stringify(checklistForPrompt)}

OBJETIVO:
1. Haz OCR visual real del documento, no te bases en el nombre del archivo.
2. Determina qué puntos del checklist están realmente acreditados por el contenido aportado. Un mismo archivo puede acreditar varios puntos.
3. Para cada punto detectado devuelve un registro con docId exacto, fechas, empresa/CIF si aparecen y una observación breve con la evidencia encontrada.
4. estado solo puede ser: entregado, incompleto, caducado, pendiente o no_aplica. Usa entregado únicamente si hay evidencia suficiente; incompleto si faltan páginas/datos/firmas esenciales o es parcialmente ilegible; pendiente si el documento menciona el requisito pero no lo acredita.
5. Si el archivo es ilegible, marca esLegible=false y explica el motivo. Nunca inventes texto no visible.
6. Extrae trabajadores y DNI/NIE cuando aparezcan relaciones nominales, certificados, RNT/RLC, altas, formación, aptitud médica o EPIs.
7. NO marques como entregado un punto solo por similitud semántica. Exige evidencia documental.
8. Si el documento no corresponde a ningún punto, devuelve documentosAnalizados vacío pero explica qué parece ser.
9. Devuelve fechas preferentemente YYYY-MM-DD.
10. La confianza debe ser alta, media o baja.

La revisión humana es obligatoria: tu salida es una propuesta de cotejo, nunca una aprobación jurídica definitiva.`
  });

  const models = ['gemini-flash-latest', 'gemini-2.5-flash'];
  let lastError: any;
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema,
          temperature: 0.1,
        }
      });
      return JSON.parse(cleanJson(response.text || '{}'));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('No se pudo completar el análisis OCR/IA.');
}

function compareWorkers(detected: any[], currentWorkers: any[]) {
  const clean = (s: string) => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');
  const coincidentes: any[] = [];
  const noRegistradosEnObra: any[] = [];
  for (const det of detected) {
    const dni = clean(det.dni || '');
    const name = clean(det.nombre || '');
    const found = currentWorkers.find((w: any) => (dni && clean(w.dni) === dni) || (name && clean(w.apellidosNombre || w.name).includes(name.slice(0, Math.min(name.length, 12)))));
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
      detalles: found ? 'Coincidencia encontrada en el censo de la obra.' : 'No se ha encontrado coincidencia inequívoca en el censo de la obra.'
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
    totalDetectadosEnDocs: detected.length,
    coincidentes,
    noRegistradosEnObra,
    pendientesDeAcreditar: pending,
    porcentajeAcreditacion: currentWorkers.length ? Math.round((coincidentes.length / currentWorkers.length) * 100) : 0
  };
}

const normalizeSearchText = (value: string) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const fallbackAliases: Record<string, string[]> = {
  rea: ['rea', 'registro empresas acreditadas', 'empresa acreditada'],
  libro_subcontratacion: ['libro subcontratacion', 'diligencia subcontratacion'],
  adhesion_pss: ['adhesion', 'plan seguridad salud', 'pss'],
  concierto_sprl: ['concierto sprl', 'servicio prevencion', 'spa'],
  cert_tgss: ['tgss', 'seguridad social', 'corriente seguridad social'],
  cert_aeat: ['aeat', 'hacienda', 'agencia tributaria'],
  seguro_rc: ['seguro rc', 'responsabilidad civil', 'poliza rc'],
  recurso_preventivo: ['recurso preventivo', 'designacion recurso'],
  evaluacion_especifica: ['evaluacion riesgos', 'planificacion preventiva'],
  altas_ss: ['alta seguridad social', 'ita', 'rlc', 'rnt', 'idc'],
  formacion_prl: ['formacion prl', 'curso prl', 'tpc'],
  aptitud_medica: ['aptitud medica', 'reconocimiento medico', 'vigilancia salud'],
  entrega_epis: ['entrega epis', 'entrega epi'],
  marcado_ce_maquinaria: ['marcado ce', 'declaracion conformidad'],
  seguro_itv_maquinaria: ['itv maquinaria', 'seguro maquinaria'],
};

async function analyzeWithFallback(
  files: InputFile[],
  checklist: ChecklistItem[],
  subcontrata: any,
  currentWorkers: any[]
) {
  const documentosAnalizados: AnalysisItem[] = [];
  const trabajadoresDetectados: any[] = [];
  const detectedIds = new Set<string>();

  for (const file of files) {
    const officeText = await extractOfficeText(file);
    const searchable = normalizeSearchText(`${file.name} ${officeText}`);
    const matches = checklist.filter(item => {
      const aliases = fallbackAliases[item.id] || [];
      const itemName = normalizeSearchText(item.nombre);
      return aliases.some(alias => searchable.includes(normalizeSearchText(alias))) ||
        (itemName.length > 5 && searchable.includes(itemName));
    });

    for (const item of matches) {
      const dateMatch = searchable.match(/\b(20\d{2})[\s._/-]?(0?[1-9]|1[0-2])[\s._/-]?(0?[1-9]|[12]\d|3[01])\b/);
      const issued = dateMatch
        ? `${dateMatch[1]}-${String(Number(dateMatch[2])).padStart(2, '0')}-${String(Number(dateMatch[3])).padStart(2, '0')}`
        : '';
      const expiry = evaluateExpiration(item.id, issued);
      detectedIds.add(item.id);
      documentosAnalizados.push({
        docId: item.id,
        nombreDetectado: item.nombre,
        estado: expiry.expired ? 'caducado' : issued ? 'entregado' : 'incompleto',
        fechaEmision: expiry.issued,
        fechaCaducidad: expiry.expires,
        empresaDetectada: subcontrata?.nombre || subcontrata?.empresa || '',
        cifDetectado: subcontrata?.cif || '',
        observaciones: issued
          ? `Documento identificado mediante el analizador de respaldo: ${file.name}.`
          : `Documento identificado, pero requiere revisión manual de fechas: ${file.name}.`,
        archivoOrigen: file.name,
        confianza: issued ? 'media' : 'baja',
        esLegible: Boolean(officeText),
        motivoIlegible: officeText ? '' : 'Sin OCR visual disponible en el modo de respaldo.',
        solicitarReintento: !issued,
        estaCaducado: expiry.expired,
        diasCaducado: expiry.daysExpired,
        diasRestantes: expiry.daysRemaining,
        esProximaCaducidad: expiry.nearExpiry,
        motivoCaducidad: expiry.expired
          ? `Documento caducado hace ${expiry.daysExpired} días.`
          : expiry.nearExpiry ? `Caduca en ${expiry.daysRemaining} días.` : ''
      });
    }

    // Personnel is extracted only from the subcontractor's own dossier.
    // In fallback mode we can safely recover DNI/NIE identifiers from native text;
    // the human reviewer remains responsible for confirming identity/name.
    const rawText = officeText || '';
    const workerIds = rawText.match(/\b(?:[XYZxyz]\s*[- ]?\s*\d{7}\s*[- ]?\s*[A-Za-z]|\d{8}\s*[- ]?\s*[A-Za-z])\b/g) || [];
    for (const rawDni of workerIds) {
      const dni = rawDni.replace(/[\s-]/g, '').toUpperCase();
      trabajadoresDetectados.push({
        nombre: 'Nombre pendiente de revisión manual',
        dni,
        archivoOrigen: file.name
      });
    }
  }

  const uniqueWorkers = trabajadoresDetectados.filter((worker, index, list) =>
    list.findIndex(candidate => `${candidate.dni}|${candidate.nombre}` === `${worker.dni}|${worker.nombre}`) === index
  );
  const relacionFaltantes = checklist
    .filter(item => item.obligatorio !== false && !detectedIds.has(item.id))
    .map(item => item.nombre);
  const hasProblems = documentosAnalizados.some(item => item.estado === 'caducado' || item.estado === 'incompleto');

  return {
    success: true,
    analysisMode: 'fallback',
    documentosAnalizados,
    resumenDiagnostico: `Análisis de respaldo completado: ${documentosAnalizados.length} documento(s) identificado(s). Revise manualmente los datos marcados con confianza baja.`,
    veredictoAcceso: hasProblems || relacionFaltantes.length ? 'CONDICIONADO' : 'APTO',
    relacionFaltantes,
    trabajadoresDetectados: uniqueWorkers,
    alertasCaducidad: documentosAnalizados
      .filter(item => item.estaCaducado || item.esProximaCaducidad)
      .map(item => `${item.nombreDetectado || item.docId}: ${item.motivoCaducidad}`),
    documentosIlegibles: documentosAnalizados
      .filter(item => !item.esLegible)
      .map(item => ({ archivo: item.archivoOrigen, motivo: item.motivoIlegible, docRelacionado: item.docId, confianza: item.confianza })),
    textoRequerimiento: ''
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido.' });
  try {
    const body = await readBody(req);
    const files: InputFile[] = Array.isArray(body.files) ? body.files : [];
    const checklist: ChecklistItem[] = Array.isArray(body.currentChecklist) ? body.currentChecklist : [];
    if (!files.length) return sendJson(res, 400, { error: 'No se proporcionaron archivos para analizar.' });
    if (!checklist.length) return sendJson(res, 400, { error: 'No se proporcionó el checklist legal configurado.' });
    if (files.length > 6) return sendJson(res, 400, { error: 'Analice un máximo de 6 archivos por petición. La interfaz los procesa automáticamente por lotes.' });

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      const fallback = await analyzeWithFallback(
        files,
        checklist,
        body.subcontrata || {},
        Array.isArray(body.currentObraWorkers) ? body.currentObraWorkers : []
      );
      return sendJson(res, 200, fallback);
    }

    const ai = new GoogleGenAI({ apiKey });
    const allDocs: AnalysisItem[] = [];
    const allWorkers: any[] = [];
    const summaries: string[] = [];
    const documentosIlegibles: any[] = [];

    for (const file of files) {
      const parsed = await analyzeOneFile(ai, file, checklist, body.subcontrata || {});
      summaries.push(`${file.name}: ${parsed.resumenDiagnostico || 'analizado'}`);
      for (const worker of Array.isArray(parsed.trabajadoresDetectados) ? parsed.trabajadoresDetectados : []) {
        allWorkers.push({ ...worker, archivoOrigen: file.name });
      }
      for (const raw of Array.isArray(parsed.documentosAnalizados) ? parsed.documentosAnalizados : []) {
        const exists = checklist.some(item => item.id === raw.docId);
        if (!exists) continue;
        const expiry = evaluateExpiration(raw.docId, raw.fechaEmision, raw.fechaCaducidad);
        const illegible = raw.esLegible === false;
        let estado: AnalysisItem['estado'] = ['entregado', 'incompleto', 'caducado', 'pendiente', 'no_aplica'].includes(raw.estado) ? raw.estado : 'incompleto';
        if (illegible) estado = 'incompleto';
        else if (expiry.expired) estado = 'caducado';
        const result: AnalysisItem = {
          docId: raw.docId,
          nombreDetectado: raw.nombreDetectado || checklist.find(i => i.id === raw.docId)?.nombre,
          estado,
          fechaEmision: expiry.issued || raw.fechaEmision || '',
          fechaCaducidad: expiry.expires || raw.fechaCaducidad || '',
          empresaDetectada: raw.empresaDetectada || '',
          cifDetectado: raw.cifDetectado || '',
          observaciones: raw.observaciones || '',
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

    const uniqueWorkers = allWorkers.filter((worker, index, list) => {
      const key = `${String(worker.dni || '').replace(/[\s-]/g, '').toUpperCase()}|${String(worker.nombre || '').trim().toUpperCase()}`;
      return list.findIndex(candidate => `${String(candidate.dni || '').replace(/[\s-]/g, '').toUpperCase()}|${String(candidate.nombre || '').trim().toUpperCase()}` === key) === index;
    });
    const alertasCaducidad = allDocs.filter(d => d.estaCaducado || d.esProximaCaducidad).map(d => `${d.nombreDetectado || d.docId}: ${d.motivoCaducidad}`);

    return sendJson(res, 200, {
      success: true,
      documentosAnalizados: allDocs,
      resumenDiagnostico: summaries.join(' | '),
      veredictoAcceso: allDocs.some(d => d.estaCaducado || d.estado === 'incompleto') ? 'CONDICIONADO' : 'APTO',
      relacionFaltantes: [],
      trabajadoresDetectados: uniqueWorkers,
      alertasCaducidad,
      documentosIlegibles,
      textoRequerimiento: ''
    });
  } catch (error: any) {
    console.error('[CAE OCR API]', error);
    return sendJson(res, 500, { error: error?.message || 'Error procesando la documentación CAE con OCR/IA.' });
  }
}
