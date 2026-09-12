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
  } catch {
    // Continue with extraction fallback.
  }

  const first = clean.indexOf('[');
  const last = clean.lastIndexOf(']');
  if (first >= 0 && last > first) {
    try {
      const parsed = JSON.parse(clean.slice(first, last + 1));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // Continue.
    }
  }

  throw new Error('La IA no devolvió un formato de datos válido.');
};

const gatewaySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    records: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          apellidosNombre: { type: 'string' },
          dni: { type: 'string' },
          resultado: { type: 'string' },
          limitaciones: { type: 'string' },
          fechaReconocimiento: { type: 'string' },
          validez: { type: 'string' },
          centroMedico: { type: 'string' },
          observaciones: { type: 'string' },
          confianza: { type: 'string' },
          archivoOrigen: { type: 'string' }
        },
        required: [
          'apellidosNombre',
          'dni',
          'resultado',
          'limitaciones',
          'fechaReconocimiento',
          'validez',
          'centroMedico',
          'observaciones',
          'confianza',
          'archivoOrigen'
        ]
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

const callGateway = async (model: string, input: any) => {
  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) throw new Error('AI_GATEWAY_UNAVAILABLE');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 110_000);
  try {
    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        input,
        max_output_tokens: 12_000,
        text: {
          format: {
            type: 'json_schema',
            name: 'medical_records',
            strict: true,
            schema: gatewaySchema
          }
        },
        metadata: {
          feature: 'profea-medical-records'
        }
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`AI_GATEWAY_${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
    }

    const text = getGatewayText(payload);
    if (!text) throw new Error('AI_GATEWAY_EMPTY_RESPONSE');
    return text;
  } finally {
    clearTimeout(timeout);
  }
};

const callGemini = async (ai: GoogleGenAI, contents: any) => {
  const models = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  let lastError: any;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await ai.models.generateContent({
          model,
          contents,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  apellidosNombre: { type: Type.STRING },
                  dni: { type: Type.STRING },
                  resultado: { type: Type.STRING },
                  limitaciones: { type: Type.STRING },
                  fechaReconocimiento: { type: Type.STRING },
                  validez: { type: Type.STRING },
                  centroMedico: { type: Type.STRING },
                  observaciones: { type: Type.STRING },
                  confianza: { type: Type.STRING },
                  archivoOrigen: { type: Type.STRING }
                },
                required: ['apellidosNombre', 'resultado']
              }
            }
          }
        });
      } catch (error: any) {
        lastError = error;
        const message = String(error?.message || error);
        const transient = /429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand|overload/i.test(message);
        if (!transient) break;
        await new Promise(resolve => setTimeout(resolve, 700 + Math.floor(Math.random() * 500)));
      }
    }
  }

  throw lastError || new Error('No se pudo contactar con el servicio de IA.');
};

const geminiKey = () =>
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  '';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const incomingFiles = Array.isArray(body.files) && body.files.length
      ? body.files
      : body.fileBase64
        ? [{
            fileBase64: body.fileBase64,
            mimeType: body.mimeType || body.fileMimeType || 'application/pdf',
            filename: body.filename || body.fileName || 'documento'
          }]
        : body.pdfBase64
          ? [{
              fileBase64: body.pdfBase64,
              mimeType: 'application/pdf',
              filename: body.filename || body.fileName || 'documento.pdf'
            }]
          : [];

    if (!incomingFiles.length) {
      return res.status(400).json({ error: 'No se ha recibido ningún documento para analizar.' });
    }

    const knownWorkers = Array.isArray(body.existingWorkers)
      ? body.existingWorkers
      : Array.isArray(body.people)
        ? body.people
        : [];

    const workerNames = knownWorkers
      .map((worker: any) => worker?.apellidosNombre)
      .filter(Boolean)
      .slice(0, 1200);

    const prompt = `Analiza conjuntamente los documentos adjuntos. Son relaciones o certificados de reconocimientos médicos / vigilancia de la salud de trabajadores PROFEA.

Extrae TODOS los trabajadores que aparezcan.

Para cada registro usa estos campos:
- apellidosNombre: nombre completo tal como aparece en el documento.
- dni: solo si aparece explícitamente; si no aparece, cadena vacía.
- resultado: uno de "Apto", "No Apto", "Apto con Limitación" o "Pendiente". Interpreta expresiones equivalentes del certificado.
- limitaciones: texto literal o resumen fiel de las restricciones cuando existan; si no, cadena vacía.
- fechaReconocimiento: formato YYYY-MM-DD siempre que pueda deducirse con seguridad; si no, cadena vacía.
- validez: año o periodo de validez indicado; si no aparece, cadena vacía.
- centroMedico: servicio de prevención, centro o entidad emisora si consta; si no, "No especificado".
- observaciones: información relevante adicional del resultado.
- confianza: "alta", "media" o "baja".
- archivoOrigen: nombre del archivo del que procede el registro.

No inventes DNI ni fechas. No descartes un trabajador porque no aparezca DNI. Si el documento contiene varios listados o varias páginas, procesa todos los registros. Si hay duplicados exactos del mismo trabajador dentro del mismo documento, conserva una sola entrada.

La aplicación vinculará después por nombre con su plantilla. Como ayuda, estos son nombres existentes en la plantilla, sin que debas forzar coincidencias: ${workerNames.join(' | ')}`;

    const gatewayContent: any[] = [{ type: 'input_text', text: prompt }];
    const geminiParts: any[] = [];

    for (const file of incomingFiles) {
      const fileBase64 = String(file?.fileBase64 || file?.base64 || file?.data || '');
      if (!fileBase64) continue;

      const filename = String(file?.filename || file?.fileName || 'documento');
      const mimeType = normalizeMime(file?.mimeType || file?.type || fileBase64.match(/^data:([^;]+);base64,/)?.[1]);
      const rawBase64 = stripDataUrl(fileBase64);
      const dataUrl = fileBase64.startsWith('data:')
        ? fileBase64
        : `data:${mimeType};base64,${rawBase64}`;

      if (mimeType === 'application/pdf') {
        gatewayContent.push({ type: 'input_file', filename, file_data: dataUrl });
      } else if (mimeType.startsWith('image/')) {
        gatewayContent.push({ type: 'input_image', image_url: dataUrl, detail: 'high' });
      }

      geminiParts.push({ text: `Archivo origen: ${filename}` });
      geminiParts.push({
        inlineData: {
          mimeType,
          data: rawBase64
        }
      });
    }

    if (gatewayContent.length === 1 || !geminiParts.some(part => part.inlineData)) {
      return res.status(400).json({ error: 'Los archivos recibidos no contienen datos válidos.' });
    }

    let rawText = '';
    let provider = 'vercel-ai-gateway';
    let gatewayError: any;

    for (const model of ['google/gemini-2.5-flash', 'anthropic/claude-sonnet-5', 'openai/gpt-5.6-sol']) {
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
      if (!apiKey) {
        throw gatewayError || new Error('No hay un proveedor de IA disponible en el servidor.');
      }

      provider = 'gemini-direct';
      geminiParts.push({ text: prompt });
      const ai = new GoogleGenAI({ apiKey });
      const response = await callGemini(ai, { parts: geminiParts });
      rawText = response.text || '[]';
    }

    const records = parseJsonArray(rawText)
      .filter(record => record && String(record.apellidosNombre || '').trim())
      .map(record => ({
        dni: String(record.dni || ''),
        apellidosNombre: String(record.apellidosNombre || '').trim(),
        resultado: String(record.resultado || 'Pendiente'),
        limitaciones: String(record.limitaciones || ''),
        fechaReconocimiento: String(record.fechaReconocimiento || ''),
        validez: String(record.validez || ''),
        centroMedico: String(record.centroMedico || 'No especificado'),
        observaciones: String(record.observaciones || ''),
        confianza: ['alta', 'media', 'baja'].includes(String(record.confianza || '').toLowerCase())
          ? String(record.confianza).toLowerCase()
          : 'media',
        archivoOrigen: String(record.archivoOrigen || '')
      }));

    return res.status(200).json({ success: true, records, provider });
  } catch (error: any) {
    console.error('[parse-medical-records]', error);
    const raw = String(error?.message || error || '');
    let message = 'Error al procesar los reconocimientos médicos con IA.';

    if (/429|RESOURCE_EXHAUSTED/i.test(raw)) {
      message = 'Se ha alcanzado temporalmente el límite de solicitudes de IA. Vuelva a intentarlo en unos instantes.';
    } else if (/503|UNAVAILABLE|high demand|overload/i.test(raw)) {
      message = 'El servicio de IA está temporalmente saturado. Vuelva a intentarlo en unos segundos.';
    } else if (/API key|GEMINI_API_KEY|credential/i.test(raw)) {
      message = 'La configuración del proveedor de IA en el servidor no es válida.';
    } else if (/AI_GATEWAY_UNAVAILABLE|No hay un proveedor de IA disponible/i.test(raw)) {
      message = 'No hay un proveedor de IA disponible en el servidor. Revise la configuración de Vercel.';
    } else if (raw) {
      message = raw;
    }

    return res.status(500).json({ error: message });
  }
}
