import { GoogleGenAI, Type } from '@google/genai';

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/responses';

const stripDataUrl = (value: string) => {
  const comma = value.indexOf(',');
  return comma >= 0 ? value.slice(comma + 1) : value;
};

const normalizeMime = (value?: string) => {
  if (!value) return 'application/pdf';
  const clean = value.split(';')[0].trim().toLowerCase();
  if (clean === 'image/jpg') return 'image/jpeg';
  return clean;
};

const normalizeText = (value: unknown) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const parseJsonArray = (raw: string): any[] => {
  const clean = String(raw || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!clean) return [];
  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.records)) return parsed.records;
    if (Array.isArray(parsed?.items)) return parsed.items;
  } catch {}

  const first = clean.indexOf('[');
  const last = clean.lastIndexOf(']');
  if (first >= 0 && last > first) {
    const parsed = JSON.parse(clean.slice(first, last + 1));
    return Array.isArray(parsed) ? parsed : [];
  }
  throw new Error('La IA no devolvió un formato de datos válido.');
};

const gatewaySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    records: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          apellidosNombre: { type: 'string' }, dni: { type: 'string' }, resultado: { type: 'string' },
          limitaciones: { type: 'string' }, fechaReconocimiento: { type: 'string' }, validez: { type: 'string' },
          centroMedico: { type: 'string' }, observaciones: { type: 'string' }, confianza: { type: 'string' }, archivoOrigen: { type: 'string' }
        },
        required: ['apellidosNombre','dni','resultado','limitaciones','fechaReconocimiento','validez','centroMedico','observaciones','confianza','archivoOrigen']
      }
    }
  },
  required: ['records']
};

const getGatewayText = (payload: any): string => {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (typeof part?.text === 'string') return part.text;
    }
  }
  return '';
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const callGateway = async (model: string, input: any) => {
  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) throw new Error('AI_GATEWAY_UNAVAILABLE');
  let lastError: any;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 28_000);
    try {
      const response = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model, input, max_output_tokens: 8_000,
          text: { format: { type: 'json_schema', name: 'medical_records', strict: true, schema: gatewaySchema } },
          metadata: { feature: 'profea-medical-records', attempt: String(attempt + 1) }
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        const text = getGatewayText(payload);
        if (!text) throw new Error('AI_GATEWAY_EMPTY_RESPONSE');
        return text;
      }
      const error = new Error(`AI_GATEWAY_${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
      lastError = error;
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 1) throw error;
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 2500) : 900);
    } catch (error: any) {
      lastError = error;
      const raw = String(error?.message || error || '');
      if (!/429|500|502|503|504|ECONNRESET|ETIMEDOUT|AbortError|UNAVAILABLE|overload|high demand/i.test(raw) || attempt === 1) throw error;
      await sleep(900 + Math.floor(Math.random() * 250));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('AI_GATEWAY_UNAVAILABLE');
};

const callGemini = async (ai: GoogleGenAI, contents: any) => {
  const models = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest'];
  let lastError: any;
  for (const model of models) {
    try {
      return await ai.models.generateContent({
        model, contents,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                apellidosNombre: { type: Type.STRING }, dni: { type: Type.STRING }, resultado: { type: Type.STRING },
                limitaciones: { type: Type.STRING }, fechaReconocimiento: { type: Type.STRING }, validez: { type: Type.STRING },
                centroMedico: { type: Type.STRING }, observaciones: { type: Type.STRING }, confianza: { type: Type.STRING }, archivoOrigen: { type: Type.STRING }
              },
              required: ['apellidosNombre', 'resultado']
            }
          }
        }
      });
    } catch (error: any) {
      lastError = error;
      if (!/429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand|overload/i.test(String(error?.message || error))) break;
      await sleep(700);
    }
  }
  throw lastError || new Error('No se pudo contactar con el servicio de IA.');
};

const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';

const isoDateFromText = (value: string) => {
  const match = value.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/);
  if (!match) return '';
  const day = Number(match[1]); const month = Number(match[2]); const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const extractPdfText = async (base64: string) => {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(stripDataUrl(base64), 'base64')), disableFontFace: true, useSystemFonts: true, verbosity: 0 }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const values = (content.items as any[]).map(item => typeof item?.str === 'string' ? item.str.trim() : '').filter(Boolean);
      if (values.length) pages.push(values.join(' | '));
    }
    return pages.join('\n');
  } catch (error) {
    console.warn('[parse-medical-records] No se pudo extraer texto PDF localmente:', error instanceof Error ? error.message : error);
    return '';
  }
};

const workerTokens = (name: string) => normalizeText(name).split(' ').filter(token => token.length > 1 && !['de','del','la','las','los','el','y'].includes(token));

const findWorkerContext = (text: string, name: string) => {
  const normalized = normalizeText(text);
  const tokens = workerTokens(name);
  if (tokens.length < 2) return '';
  const positions = tokens.map(token => normalized.indexOf(token)).filter(position => position >= 0);
  if (positions.length < Math.max(2, Math.ceil(tokens.length * 0.75))) return '';
  const start = Math.max(0, Math.min(...positions) - 260);
  const end = Math.min(normalized.length, Math.max(...positions) + 420);
  const window = normalized.slice(start, end);
  const hits = tokens.filter(token => window.includes(token)).length;
  return hits >= Math.max(2, Math.ceil(tokens.length * 0.75)) ? window : '';
};

const parseAptitud = (context: string) => {
  const value = normalizeText(context);
  if (/\bno\s+apt[oa]s?\b/.test(value) || /\bno\s+apto\b/.test(value)) return 'No Apto';
  if (/\bapt[oa]s?\s+con\s+(limitacion|limitaciones|restriccion|restricciones)\b/.test(value)) return 'Apto con Limitación';
  if (/\bapt[oa]s?\b/.test(value)) return 'Apto';
  if (/\baptitud\s+(favorable|positiva|correcta)\b/.test(value)) return 'Apto';
  return '';
};

const parseGlobalAptitud = (text: string) => {
  const value = normalizeText(text);
  if (!value) return '';

  // Solo se acepta una aptitud global cuando el propio documento deja claro que
  // el listado completo comparte el mismo resultado. Si aparecen resultados
  // negativos o limitaciones, se obliga a resolver trabajador por trabajador.
  if (/\bno\s+apt[oa]s?\b/.test(value) || /\bapt[oa]s?\s+con\s+(limitacion|limitaciones|restriccion|restricciones)\b/.test(value)) {
    return '';
  }

  const clearlyAptList = [
    /\brelacion\s+de\s+(trabajadores|personas|empleados)\s+apt[oa]s?\b/,
    /\blistado\s+de\s+(trabajadores|personas|empleados)\s+apt[oa]s?\b/,
    /\btrabajadores\s+apt[oa]s?\b/,
    /\btodos\s+apt[oa]s?\b/,
    /\baptitud\s+(favorable|positiva)\b/,
    /\bresultado\s+apt[oa]\b/,
    /\bapt[oa]\s+para\s+(el|la)\s+(puesto|trabajo)\b/
  ].some(pattern => pattern.test(value));

  return clearlyAptList ? 'Apto' : '';
};

const localMedicalFallback = async (files: any[], workers: any[]) => {
  const records: any[] = [];
  for (const file of files) {
    const base64 = String(file?.fileBase64 || file?.base64 || file?.data || '');
    const mimeType = normalizeMime(file?.mimeType || file?.type || 'application/pdf');
    if (!base64) continue;

    // Prefer text/OCR already extracted in the browser. This works for scanned PDFs
    // and images and avoids depending on an external AI provider for basic parsing.
    let text = String(file?.extractedText || '').trim();
    if (normalizeText(text).length < 30 && mimeType === 'application/pdf') {
      text = await extractPdfText(base64);
    }
    if (normalizeText(text).length < 30) continue;
    const filename = String(file?.filename || file?.fileName || 'documento.pdf');
    const globalAptitud = parseGlobalAptitud(text);
    const documentDate = isoDateFromText(text);

    for (const worker of workers) {
      const name = String(worker?.apellidosNombre || '').trim();
      if (!name) continue;
      const context = findWorkerContext(text, name);
      if (!context) continue;

      const localAptitud = parseAptitud(context);
      const resultado = localAptitud || globalAptitud;
      if (!resultado) continue;

      records.push({
        dni: String(worker?.dni || ''), apellidosNombre: name, resultado,
        limitaciones: resultado === 'Apto con Limitación' ? 'Revisar limitaciones indicadas en el documento.' : '',
        fechaReconocimiento: documentDate,
        validez: '', centroMedico: 'No especificado',
        observaciones: localAptitud
          ? 'Resultado localizado junto al trabajador mediante lectura local del PDF.'
          : 'Trabajador incluido en un listado cuya aptitud global figura expresamente en el documento.',
        confianza: localAptitud ? 'alta' : 'media', archivoOrigen: filename
      });
    }
  }
  return records.filter((record, index, list) => list.findIndex(candidate => normalizeText(candidate.apellidosNombre) === normalizeText(record.apellidosNombre) && candidate.archivoOrigen === record.archivoOrigen) === index);
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Método no permitido.' }); }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const incomingFiles = Array.isArray(body.files) && body.files.length ? body.files : body.fileBase64
      ? [{ fileBase64: body.fileBase64, mimeType: body.mimeType || body.fileMimeType || 'application/pdf', filename: body.filename || body.fileName || 'documento' }]
      : body.pdfBase64 ? [{ fileBase64: body.pdfBase64, mimeType: 'application/pdf', filename: body.filename || body.fileName || 'documento.pdf' }] : [];
    if (!incomingFiles.length) return res.status(400).json({ error: 'No se ha recibido ningún documento para analizar.' });

    const knownWorkers = Array.isArray(body.existingWorkers) ? body.existingWorkers : Array.isArray(body.people) ? body.people : [];

    const localRecords = await localMedicalFallback(incomingFiles, knownWorkers);
    if (localRecords.length) {
      return res.status(200).json({ success: true, records: localRecords, provider: 'local-pdf', fallback: true });
    }

    const workerNames = knownWorkers.map((worker: any) => worker?.apellidosNombre).filter(Boolean).slice(0, 1200);
    const prompt = `Analiza conjuntamente los documentos adjuntos. Son relaciones o certificados de reconocimientos médicos / vigilancia de la salud de trabajadores PROFEA.\n\nExtrae TODOS los trabajadores que aparezcan.\n\nPara cada registro usa: apellidosNombre, dni (solo si aparece), resultado (Apto, No Apto, Apto con Limitación o Pendiente), limitaciones, fechaReconocimiento YYYY-MM-DD, validez, centroMedico, observaciones, confianza y archivoOrigen.\n\nNo inventes DNI ni fechas. No descartes trabajadores sin DNI. Procesa todas las páginas y elimina duplicados exactos. Como ayuda, estos son nombres existentes en plantilla, sin forzar coincidencias: ${workerNames.join(' | ')}`;

    const gatewayContent: any[] = [{ type: 'input_text', text: prompt }];
    const geminiParts: any[] = [];
    for (const file of incomingFiles) {
      const fileBase64 = String(file?.fileBase64 || file?.base64 || file?.data || '');
      if (!fileBase64) continue;
      const filename = String(file?.filename || file?.fileName || 'documento');
      const mimeType = normalizeMime(file?.mimeType || file?.type || fileBase64.match(/^data:([^;]+);base64,/)?.[1]);
      const rawBase64 = stripDataUrl(fileBase64);
      const dataUrl = fileBase64.startsWith('data:') ? fileBase64 : `data:${mimeType};base64,${rawBase64}`;
      if (mimeType === 'application/pdf') gatewayContent.push({ type: 'input_file', filename, file_data: dataUrl });
      else if (mimeType.startsWith('image/')) gatewayContent.push({ type: 'input_image', image_url: dataUrl, detail: 'high' });
      geminiParts.push({ text: `Archivo origen: ${filename}` }, { inlineData: { mimeType, data: rawBase64 } });
    }
    if (gatewayContent.length === 1 || !geminiParts.some(part => part.inlineData)) return res.status(400).json({ error: 'Los archivos recibidos no contienen datos válidos.' });

    let rawText = ''; let provider = 'vercel-ai-gateway'; let gatewayError: any;
    for (const model of ['google/gemini-2.5-flash-lite', 'openai/gpt-5.6-sol', 'anthropic/claude-sonnet-5', 'google/gemini-2.5-flash']) {
      try {
        rawText = await callGateway(model, [{ type: 'message', role: 'user', content: gatewayContent }]);
        if (rawText) break;
      } catch (error) {
        gatewayError = error;
        console.warn(`[parse-medical-records] AI Gateway falló con ${model}:`, error instanceof Error ? error.message : error);
      }
    }

    if (!rawText) {
      const apiKey = geminiKey();
      if (!apiKey) throw gatewayError || new Error('No hay un proveedor de IA disponible en el servidor.');
      provider = 'gemini-direct';
      geminiParts.push({ text: prompt });
      const ai = new GoogleGenAI({ apiKey });
      const response = await callGemini(ai, { parts: geminiParts });
      rawText = response.text || '[]';
    }

    const records = parseJsonArray(rawText).filter(record => record && String(record.apellidosNombre || '').trim()).map(record => ({
      dni: String(record.dni || ''), apellidosNombre: String(record.apellidosNombre || '').trim(), resultado: String(record.resultado || 'Pendiente'),
      limitaciones: String(record.limitaciones || ''), fechaReconocimiento: String(record.fechaReconocimiento || ''), validez: String(record.validez || ''),
      centroMedico: String(record.centroMedico || 'No especificado'), observaciones: String(record.observaciones || ''),
      confianza: ['alta','media','baja'].includes(String(record.confianza || '').toLowerCase()) ? String(record.confianza).toLowerCase() : 'media',
      archivoOrigen: String(record.archivoOrigen || '')
    }));
    return res.status(200).json({ success: true, records, provider });
  } catch (error: any) {
    console.error('[parse-medical-records]', error);
    const raw = String(error?.message || error || '');
    let message = 'Error al procesar los reconocimientos médicos.';
    if (/429|RESOURCE_EXHAUSTED/i.test(raw)) message = 'Los proveedores de IA están temporalmente ocupados y el documento no contiene texto local suficiente para procesarlo sin IA. Vuelva a intentarlo en unos instantes.';
    else if (/500|502|503|504|UNAVAILABLE|high demand|overload/i.test(raw)) message = 'Los proveedores de IA están temporalmente ocupados y no ha sido posible aplicar el fallback local a este documento.';
    else if (/API key|GEMINI_API_KEY|credential/i.test(raw)) message = 'La configuración del proveedor de IA en el servidor no es válida.';
    else if (/AI_GATEWAY_UNAVAILABLE|No hay un proveedor de IA disponible/i.test(raw)) message = 'No hay un proveedor de IA disponible y el documento no pudo procesarse localmente.';
    else if (raw) message = raw;
    return res.status(503).json({ error: message, retryable: true });
  }
}
