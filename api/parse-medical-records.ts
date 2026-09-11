import { GoogleGenAI, Type } from '@google/genai';

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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'La clave GEMINI_API_KEY no está configurada en Vercel.'
      });
    }

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

    const parts: any[] = [];
    for (const file of incomingFiles) {
      const fileBase64 = String(file?.fileBase64 || file?.base64 || file?.data || '');
      if (!fileBase64) continue;

      const filename = String(file?.filename || file?.fileName || 'documento');
      const mimeType = normalizeMime(file?.mimeType || file?.type || fileBase64.match(/^data:([^;]+);base64,/)?.[1]);

      parts.push({ text: `Archivo origen: ${filename}` });
      parts.push({
        inlineData: {
          mimeType,
          data: stripDataUrl(fileBase64)
        }
      });
    }

    if (!parts.some(part => part.inlineData)) {
      return res.status(400).json({ error: 'Los archivos recibidos no contienen datos válidos.' });
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

    parts.push({
      text: `Analiza conjuntamente los documentos anteriores. Son relaciones o certificados de reconocimientos médicos / vigilancia de la salud de trabajadores PROFEA.

Extrae TODOS los trabajadores que aparezcan y devuelve únicamente un array JSON.

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

La aplicación vinculará después por nombre con su plantilla. Como ayuda, estos son nombres existentes en la plantilla, sin que debas forzar coincidencias: ${workerNames.join(' | ')}`
    });

    const ai = new GoogleGenAI({ apiKey });
    const response = await callGemini(ai, { parts });
    const records = parseJsonArray(response.text || '[]')
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

    return res.status(200).json({ success: true, records });
  } catch (error: any) {
    console.error('[parse-medical-records]', error);
    const raw = String(error?.message || error || '');
    let message = 'Error al procesar los reconocimientos médicos con IA.';

    if (/429|RESOURCE_EXHAUSTED/i.test(raw)) {
      message = 'Se ha alcanzado temporalmente el límite de solicitudes de Gemini. Vuelva a intentarlo en unos instantes.';
    } else if (/503|UNAVAILABLE|high demand|overload/i.test(raw)) {
      message = 'Gemini está temporalmente saturado. Vuelva a intentarlo en unos segundos.';
    } else if (/API key|GEMINI_API_KEY|credential/i.test(raw)) {
      message = 'La configuración de Gemini en el servidor no es válida.';
    } else if (raw) {
      message = raw;
    }

    return res.status(500).json({ error: message });
  }
}
