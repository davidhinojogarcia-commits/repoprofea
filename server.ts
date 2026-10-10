import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { PROFEA_TUTOR_VIEW_LABELS, PROFEA_TUTOR_KNOWLEDGE_VERSION } from "./src/lib/profeaTutorKnowledge";
import { authenticateTutorRequest, composeTutorResponseLocal, executeTutorConfirmation, executeTutorTools, normalizeTutorContext, planTutorRequestLocal, TUTOR_AGENT_VERSION } from "./src/server/profeaTutorAgent";

// Helper to extract clean text/tables from Excel (.xlsx/.xls) and Word (.docx/.doc) buffers
async function extractTextFromOfficeBuffer(buffer: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  try {
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const rowsText: string[] = [];
      workbook.eachSheet((worksheet, sheetId) => {
        rowsText.push(`--- HOJA ${sheetId}: ${worksheet.name} ---`);
        worksheet.eachRow((row, rowNumber) => {
          const values: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            let val = '';
            if (cell.value !== null && cell.value !== undefined) {
              if (typeof cell.value === 'object' && 'result' in (cell.value as any)) {
                val = String((cell.value as any).result || '');
              } else if (typeof cell.value === 'object' && 'text' in (cell.value as any)) {
                val = String((cell.value as any).text || '');
              } else {
                val = String(cell.value);
              }
            }
            values.push(val.trim());
          });
          if (values.some(v => v.length > 0)) {
            rowsText.push(`Fila ${rowNumber}: ` + values.join(' | '));
          }
        });
      });
      return rowsText.join('\n');
    } else if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    }
  } catch (err) {
    console.warn(`[Office Parser] No se pudo extraer texto nativo de ${filename}:`, err);
  }
  return '';
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Setup body parser limits for handling high-resolution document images
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Lazy loader for Gemini API client to prevent crashing on server startup when the key is not defined yet (e.g. during deployment/health checks)
  const getGeminiClient = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("El servicio de análisis automático no está configurado en el servidor.");
    }
    return new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  };

  // Helper to strip markdown code blocks and clean JSON string
  const cleanJsonText = (text: string): string => {
    let clean = (text || "").trim();
    if (clean.startsWith("```json")) {
      clean = clean.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
    } else if (clean.startsWith("```")) {
      clean = clean.replace(/^```\s*/, "").replace(/\s*```$/, "").trim();
    }
    return clean;
  };

  // Helper to robustly extract and parse JSON arrays, recovering from token limits or truncation
  const robustParseJsonArray = (rawText: string): any[] => {
    if (!rawText || !rawText.trim()) return [];
    const clean = cleanJsonText(rawText);

    // 1. Direct parse attempt
    try {
      const res = JSON.parse(clean);
      if (Array.isArray(res)) return res;
      if (res && Array.isArray((res as any).records)) return (res as any).records;
      if (res && Array.isArray((res as any).items)) return (res as any).items;
      if (res && Array.isArray((res as any).workers)) return (res as any).workers;
    } catch {
      // Continue to bracket and repair parsing
    }

    // 2. Find start of JSON array
    const firstBracket = clean.indexOf('[');
    if (firstBracket !== -1) {
      const lastBracket = clean.lastIndexOf(']');
      if (lastBracket > firstBracket) {
        try {
          const slice = clean.substring(firstBracket, lastBracket + 1);
          const res = JSON.parse(slice);
          if (Array.isArray(res)) return res;
        } catch {
          // Fall through to truncated recovery
        }
      }

      // 3. Truncated recovery: scan backwards from the end for the last fully closed object '}'
      let endSearch = clean.lastIndexOf('}');
      while (endSearch > firstBracket) {
        const candidate = clean.substring(firstBracket, endSearch + 1).trim() + ']';
        try {
          const parsed = JSON.parse(candidate);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.warn(`Successfully recovered ${parsed.length} records from truncated JSON stream.`);
            return parsed;
          }
        } catch {
          // Step back to try earlier closing brace
        }
        endSearch = clean.lastIndexOf('}', endSearch - 1);
      }
    }

    // 4. Object regex extractor fallback for damaged JSON streams
    const objectRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
    const recovered: any[] = [];
    let match;
    while ((match = objectRegex.exec(clean)) !== null) {
      try {
        const obj = JSON.parse(match[0]);
        if (obj && typeof obj === 'object' && (obj.apellidosNombre || obj.nombre || obj.dni || obj.resultado)) {
          recovered.push(obj);
        }
      } catch {
        // Ignore unparseable object fragments
      }
    }

    if (recovered.length > 0) {
      console.warn(`Recovered ${recovered.length} records via regex object matching.`);
      return recovered;
    }

    throw new Error("El servicio automático no devolvió un formato válido.");
  };

  // Resilient caller for Gemini API with automatic exponential backoff, jitter, and fallback models
  interface GeminiCallOptions {
    contents: any;
    config?: any;
    preferredModel?: string;
  }

  const callGeminiWithRetry = async (ai: GoogleGenAI, options: GeminiCallOptions) => {
    // Primary model and robust fallback models (gemini-flash-latest has highest availability)
    const candidateModels = [
      options.preferredModel || "gemini-flash-latest",
      "gemini-flash-latest",
      "gemini-3.1-flash-lite",
      "gemini-3.8-flash",
    ].filter((m, idx, arr) => arr.indexOf(m) === idx);

    let lastError: any = null;

    for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
      const model = candidateModels[mIdx];
      const hasAlternativeModel = mIdx < candidateModels.length - 1;
      const maxRetries = 2;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: options.contents,
            config: options.config,
          });
          return response;
        } catch (err: any) {
          lastError = err;
          const msg = err?.message || String(err);
          const status = err?.status || err?.code;
          const is503HighDemand =
            msg.includes("503") ||
            msg.includes("high demand") ||
            msg.includes("UNAVAILABLE") ||
            msg.includes("Overloaded") ||
            msg.includes("Spikes in demand") ||
            status === 503;

          const isRateLimit =
            msg.includes("429") ||
            msg.includes("RESOURCE_EXHAUSTED") ||
            status === 429;

          // If a model is experiencing 503 high demand and we have alternative models, switch immediately
          if (is503HighDemand && hasAlternativeModel) {
            console.log(`[Gemini API] Modelo '${model}' experimentando alta demanda (503). Conmutando de inmediato a modelo de respaldo...`);
            break;
          }

          if ((is503HighDemand || isRateLimit) && attempt < maxRetries) {
            const backoffMs = 1000 * attempt + Math.floor(Math.random() * 300);
            console.log(`[Gemini API] Reintentando en ${backoffMs}ms...`);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }

          break;
        }
      }
    }

    // Format human-friendly error if all retries and fallback models failed
    let userFriendlyMsg = "El servicio de análisis automático está experimentando alta demanda momentáneamente. Por favor, vuelva a intentarlo en unos segundos.";
    const rawErrorString = lastError?.message || String(lastError);

    if (rawErrorString.includes("429") || rawErrorString.includes("RESOURCE_EXHAUSTED")) {
      userFriendlyMsg = "Límite de solicitudes del servicio automático alcanzado temporalmente. Por favor, espere unos instantes antes de volver a intentarlo.";
    } else {
      try {
        const jsonMatch = rawErrorString.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed?.error?.message) {
            if (parsed.error.code === 503 || parsed.error.status === "UNAVAILABLE" || parsed.error.message.includes("high demand")) {
              userFriendlyMsg = "El servicio de análisis automático está experimentando alta demanda momentáneamente. Por favor, vuelva a intentarlo en unos segundos.";
            } else {
              userFriendlyMsg = `Error del servicio de análisis: ${parsed.error.message}`;
            }
          }
        }
      } catch {
        // fallback to userFriendlyMsg
      }
    }

    const enhancedErr = new Error(userFriendlyMsg);
    (enhancedErr as any).originalError = lastError;
    throw enhancedErr;
  };

  // Local, context-aware operational agent endpoint for the in-app Tutor PROFEA.
  // It intentionally does not call Gemini or any external language-model provider.
  app.post("/api/profea-tutor", async (req, res) => {
    try {
      const question = String(req.body?.question || "").trim();
      if (!question) return res.status(400).json({ error: "Escribe una pregunta sobre GestionProfea." });
      if (question.length > 1800) return res.status(400).json({ error: "La pregunta es demasiado larga." });

      const auth = await authenticateTutorRequest(req.get("authorization"));
      const context = normalizeTutorContext({
        ...(req.body?.context || {}),
        currentView: req.body?.currentView,
        currentViewLabel: req.body?.currentViewLabel,
        guidedMode: Boolean(req.body?.guidedMode),
      });
      const rawTaskState = req.body?.taskState && typeof req.body.taskState === "object" ? req.body.taskState : {};
      const taskState = {
        title: String(rawTaskState?.title || "").slice(0, 180),
        currentStep: Math.max(0, Number(rawTaskState?.currentStep) || 0),
        totalSteps: Math.max(0, Number(rawTaskState?.totalSteps) || 0),
        status: ["idle","active","diagnostic","completed"].includes(String(rawTaskState?.status))
          ? rawTaskState.status
          : "idle",
        nextAction: String(rawTaskState?.nextAction || "").slice(0, 500),
      } as const;
      const requestId = String(req.body?.requestId || "").trim().slice(0, 180) || `tutor-${Date.now()}`;
      const confirmationToken = String(req.body?.confirmationToken || "").trim().slice(0, 6000);

      let plan = planTutorRequestLocal(question, context, taskState);
      const toolResults = confirmationToken
        ? [await executeTutorConfirmation({ confirmationToken, context, token: auth.token, userId: auth.userId })]
        : plan.toolCalls.length
          ? await executeTutorTools(plan.toolCalls, context, auth.token, requestId, question, auth.userId)
          : [];
      plan = composeTutorResponseLocal(plan, toolResults);

      const clientActions = toolResults.flatMap(result => result.clientAction ? [result.clientAction] : []);
      const pendingConfirmation = toolResults.find(result => result.confirmation)?.confirmation || null;
      const allowedViews = Object.keys(PROFEA_TUTOR_VIEW_LABELS);
      const suggestedView = allowedViews.includes(String(plan.suggestedView || "")) ? String(plan.suggestedView) : "";

      res.json({
        success: true,
        provider: "local",
        agentVersion: TUTOR_AGENT_VERSION,
        knowledgeVersion: PROFEA_TUTOR_KNOWLEDGE_VERSION,
        answer: plan.answer,
        verified: toolResults.length > 0 && toolResults.every(result => result.verified),
        toolResults: toolResults.map(result => ({
          name: result.name,
          ok: result.ok,
          verified: result.verified,
          summary: result.summary,
          data: result.data,
          error: result.error,
        })),
        pendingConfirmation,
        clientActions,
        suggestedView,
        suggestedLabel: suggestedView ? String(PROFEA_TUTOR_VIEW_LABELS[suggestedView as keyof typeof PROFEA_TUTOR_VIEW_LABELS] || "") : "",
        followUps: plan.followUps.slice(0, 4),
        progressHint: plan.progressHint.slice(0, 180),
        taskTitle: plan.taskTitle.slice(0, 180),
        currentStep: Math.max(0, Number(plan.currentStep) || 0),
        totalSteps: Math.max(0, Number(plan.totalSteps) || 0),
        taskStatus: plan.taskStatus,
        nextAction: plan.nextAction.slice(0, 500),
        checkQuestion: plan.checkQuestion.slice(0, 240),
        checkOptions: plan.checkOptions.slice(0, 4),
      });
    } catch (error: any) {
      console.error("Error en Tutor PROFEA local:", error);
      const status = Number(error?.status) || 500;
      res.status(status === 401 || status === 403 ? status : 500).json({
        error: status === 401 ? "La sesión ha caducado. Vuelve a iniciar sesión." : "No se pudo consultar el Tutor PROFEA en este momento.",
      });
    }
  });

  // API endpoint to recognize and extract worker details from document pages
  app.post("/api/recognize-workers", async (req, res) => {
    try {
      const { images } = req.body;
      if (!images || !Array.isArray(images) || images.length === 0) {
        return res.status(400).json({ error: "No se proporcionaron imágenes para procesar." });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ 
          error: "El servicio de análisis automático no está configurado en el servidor." 
        });
      }

      const ai = getGeminiClient();
      const parts: any[] = [];

      for (const base64Data of images) {
        const matches = base64Data.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
        if (matches) {
          parts.push({
            inlineData: {
              mimeType: matches[1],
              data: matches[2]
            }
          });
        } else {
          parts.push({
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Data
            }
          });
        }
      }

      parts.push({
        text: `Analiza detalladamente las imágenes adjuntas. Corresponden a documentos del plan PROFEA o contratación laboral en España.
Extrae la información de todos los trabajadores que se aportan en las imágenes y devuélvelos organizados en un array.

Para cada trabajador, extrae los siguientes campos:
- apellidosNombre: Apellidos y Nombre (formato: "Apellidos, Nombre", ej: "García López, Juan")
- dni: DNI, NIF o NIE (ej: "12345678A" o "X1234567Y"). Limpia espacios y guiones.
- nuss: Número de la Seguridad Social (ej: "411234567890"), si está disponible.
- categoria: Puesto de trabajo, cargo o categoría profesional (ej: "Peón", "Oficial de 1ª", "Capatáz"), si está disponible.
- telefono: Teléfono de contacto, si está disponible.
- correo: Correo electrónico, si está disponible.
- obra: Obra, proyecto o servicio de contratación, si aparece.
- municipio: Municipio o localidad, si aparece.
- fechaInicio: Fecha de inicio en formato ISO "YYYY-MM-DD" o aproximada, si está disponible.
- duracionContrato: Duración aproximada (ej. "15 días", "1 mes"), si está disponible.

Devuelve la información estrictamente como un array JSON de objetos con estos campos exactos. No incluyas explicaciones adicionales ni bloques markdown fuera del JSON.`
      });

      const response = await callGeminiWithRetry(ai, {
        preferredModel: "gemini-flash-latest",
        contents: { parts },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                apellidosNombre: { type: Type.STRING },
                dni: { type: Type.STRING },
                nuss: { type: Type.STRING },
                categoria: { type: Type.STRING },
                telefono: { type: Type.STRING },
                correo: { type: Type.STRING },
                obra: { type: Type.STRING },
                municipio: { type: Type.STRING },
                fechaInicio: { type: Type.STRING },
                duracionContrato: { type: Type.STRING }
              },
              required: ["apellidosNombre"]
            }
          }
        }
      });

      const rawJson = cleanJsonText(response.text || "[]");
      const workers: any[] = robustParseJsonArray(rawJson);
      res.json({ success: true, workers });
    } catch (error: any) {
      console.error("Error recognizing workers:", error);
      res.status(500).json({ error: error.message || "Error procesando el reconocimiento automático." });
    }
  });

  // API endpoint to parse a PDF document and extract workers details
  app.post("/api/parse-pdf", async (req, res) => {
    try {
      const { fileBase64 } = req.body;
      if (!fileBase64) {
        return res.status(400).json({ error: "No se proporcionó el archivo PDF." });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ 
          error: "El servicio de análisis automático no está configurado en el servidor." 
        });
      }

      const ai = getGeminiClient();
      
      const cleanBase64 = fileBase64.replace(/^data:application\/pdf;base64,/, "");

      const response = await callGeminiWithRetry(ai, {
        preferredModel: "gemini-flash-latest",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: "application/pdf",
                data: cleanBase64
              }
            },
            {
              text: `Analiza detenidamente el documento PDF adjunto, que contiene una relación de trabajadores contratados (probablemente del plan PROFEA).
Tu tarea es extraer de forma precisa toda la información de cada uno de los trabajadores listados en el PDF.

El PDF exportado tiene secciones o tablas estructuradas donde:
- El SUPERVISOR (responsable de la obra/proyecto) se indica cerca de la parte superior del documento (por ejemplo, 'SUPERVISOR: ...').
- La QUINCENA se indica en la cabecera (por ejemplo, 'QUINCENA: ...').
- La OBRA se indica en la cabecera (por ejemplo, 'OBRA: ...').
- Para cada trabajador de la tabla, las columnas contienen:
  * Oferta y Categoría: numOferta y categoria (por ejemplo, en 'OFERTA / CAT.' aparece el número de oferta y abajo la categoría como 'Peón', 'Oficial', etc.)
  * Trabajador, DNI y Nacimiento: apellidosNombre, dni y fechaNacimiento (el nombre completo, el DNI/NIE, y la fecha de nacimiento precedida por 'Nac:' o similar)
  * Periodo de Contrato: periodoInicio y periodoFin (las fechas de inicio y fin, por ejemplo 'Del 15/02/2026 Al 28/02/2026')
  * Contacto y Talla: telefono y calzado (por ejemplo, teléfono precedido por 'Tel:' y talla de calzado / calzado precedido por 'Talla:')
  * Seguridad y Formación: formacion ('Sí' o 'No') y lugarFormacion (por ejemplo, 'Formación: Sí', 'Lugar: ...')
  * Reconocimiento Médico: citaDia, citaHora y sitioReconocimiento (por ejemplo, 'Día: 13/02/2026', 'Hora: 08:30', 'Centro: ...')
  * Documentación y Observaciones: documentacionCompleta ('Sí' o 'No', basado en si dice 'OK'/'Completa'/'Completo' o 'PENDIENTE') y observaciones (por ejemplo, notas u observaciones precedidas por 'Obs:')

Instrucciones de formato para los campos de fecha:
- Convierte todas las fechas al formato estándar 'YYYY-MM-DD'. Por ejemplo, '13/02/2026' o '13-02-2026' debe convertirse en '2026-02-13'.
- Convierte los campos de tipo Sí/No ('formacion', 'documentacionCompleta', 'necesitaReconocimiento') estrictamente a las cadenas 'Sí' o 'No' (con tilde).

Genera y devuelve la información de todos los trabajadores encontrados en el PDF respetando el esquema JSON solicitado.`
            }
          ]
        },
        config: {
          maxOutputTokens: 65536,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                supervisorResponsable: { type: Type.STRING },
                numOferta: { type: Type.STRING },
                obra: { type: Type.STRING },
                categoria: { type: Type.STRING },
                quincena: { type: Type.STRING },
                apellidosNombre: { type: Type.STRING },
                dni: { type: Type.STRING },
                fechaNacimiento: { type: Type.STRING },
                periodoInicio: { type: Type.STRING },
                periodoFin: { type: Type.STRING },
                telefono: { type: Type.STRING },
                calzado: { type: Type.STRING },
                formacion: { type: Type.STRING },
                lugarFormacion: { type: Type.STRING },
                citaDia: { type: Type.STRING },
                citaHora: { type: Type.STRING },
                sitioReconocimiento: { type: Type.STRING },
                documentacionCompleta: { type: Type.STRING },
                observaciones: { type: Type.STRING },
                necesitaReconocimiento: { type: Type.STRING }
              },
              required: ["apellidosNombre", "dni"]
            }
          }
        }
      });

      const rawJson = cleanJsonText(response.text || "[]");
      const workers: any[] = robustParseJsonArray(rawJson);
      res.json({ success: true, workers });
    } catch (error: any) {
      console.error("Error parsing PDF workers:", error);
      res.status(500).json({ error: error.message || "Error al procesar el PDF automáticamente." });
    }
  });

  // API endpoint to analyze inventory Excel files and normalize equipment records
  app.post("/api/inventory/analyze-excel", async (req, res) => {
    try {
      const { fileBase64, filename } = req.body || {};
      if (!fileBase64 || !filename) {
        return res.status(400).json({ error: "No se proporcionó un archivo Excel válido." });
      }
      if (!/\.xlsx?$/i.test(String(filename))) {
        return res.status(400).json({ error: "El archivo debe estar en formato Excel (.xlsx o .xls)." });
      }
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "El servicio de análisis automático no está configurado en el servidor." });
      }

      const cleanBase64 = String(fileBase64).replace(/^data:.*;base64,/, "");
      const buffer = Buffer.from(cleanBase64, "base64");
      const extractedText = await extractTextFromOfficeBuffer(buffer, String(filename));
      if (!extractedText.trim()) {
        return res.status(400).json({ error: "No se pudo leer contenido utilizable del Excel." });
      }

      const ai = getGeminiClient();
      const response = await callGeminiWithRetry(ai, {
        preferredModel: "gemini-flash-latest",
        contents: {
          parts: [{
            text: `Analiza el contenido de este Excel de inventario de herramientas y maquinaria.
Debes detectar TODAS las filas que representen una máquina, herramienta, equipo o lote real, aunque los encabezados cambien de nombre, haya varias hojas o existan columnas sin título.

Devuelve un array JSON, un objeto por equipo, con estos campos:
- codigo: código interno, referencia, número de inventario o identificador visible.
- categoria: categoría o familia del equipo.
- nombre: nombre claro del equipo. OBLIGATORIO.
- marca: marca/fabricante.
- modelo: modelo.
- numeroSerie: número de serie.
- matricula: matrícula si existe.
- cantidad: cantidad numérica; por defecto 1.
- tipoGestion: "individual" o "lote". Usa "lote" si la fila representa varias unidades indistinguibles; si no, "individual".
- estado: uno de "Disponible", "Asignada a obra", "En traslado", "Averiada", "En reparación", "Pendiente de revisión", "Fuera de servicio", "Baja". Si no consta, usa "Disponible".
- ubicacionActual: ubicación, nave, almacén, obra o destino actual si aparece.
- observaciones: notas útiles no encajadas en otros campos.
- detalles: objeto JSON con cualquier dato técnico adicional relevante del Excel que no encaje en los campos anteriores.

Reglas:
1. No inventes números de serie, matrículas, marcas, modelos ni códigos.
2. No generes filas de títulos, totales, subtotales, separadores o cabeceras.
3. Conserva todos los equipos detectados; no agrupes equipos distintos.
4. Si dos filas del Excel son claramente el mismo equipo repetido, devuelve una sola versión con los datos más completos.
5. Limpia espacios y saltos innecesarios.
6. Devuelve únicamente JSON válido.

CONTENIDO EXTRAÍDO DEL EXCEL:
${extractedText.slice(0, 120000)}`
          }]
        },
        config: {
          maxOutputTokens: 65536,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                codigo: { type: Type.STRING },
                categoria: { type: Type.STRING },
                nombre: { type: Type.STRING },
                marca: { type: Type.STRING },
                modelo: { type: Type.STRING },
                numeroSerie: { type: Type.STRING },
                matricula: { type: Type.STRING },
                cantidad: { type: Type.NUMBER },
                tipoGestion: { type: Type.STRING },
                estado: { type: Type.STRING },
                ubicacionActual: { type: Type.STRING },
                observaciones: { type: Type.STRING },
                detalles: { type: Type.OBJECT }
              },
              required: ["nombre"]
            }
          }
        }
      });

      const items = robustParseJsonArray(response.text || "[]")
        .filter((item: any) => item && String(item.nombre || "").trim())
        .map((item: any) => ({
          codigo: String(item.codigo || "").trim(),
          categoria: String(item.categoria || "OTROS").trim() || "OTROS",
          nombre: String(item.nombre || "").trim(),
          marca: String(item.marca || "").trim(),
          modelo: String(item.modelo || "").trim(),
          numeroSerie: String(item.numeroSerie || "").trim(),
          matricula: String(item.matricula || "").trim(),
          cantidad: Math.max(1, Number(item.cantidad || 1)),
          tipoGestion: item.tipoGestion === "lote" ? "lote" : "individual",
          estado: String(item.estado || "Disponible").trim() || "Disponible",
          ubicacionActual: String(item.ubicacionActual || "").trim(),
          observaciones: String(item.observaciones || "").trim(),
          detalles: item.detalles && typeof item.detalles === "object" ? item.detalles : {}
        }));

      res.json({ success: true, items, count: items.length });
    } catch (error: any) {
      console.error("Error analyzing inventory Excel:", error);
      res.status(500).json({ error: error?.message || "No se pudo analizar automáticamente el inventario Excel." });
    }
  });

  // API endpoint to schedule medical appointments using AI
  app.post("/api/schedule-appointments-ai", async (req, res) => {
    try {
      const { workers = [], instructions, savedSitios, workStartHour, workEndHour } = req.body;
      if (!instructions || typeof instructions !== "string" || !instructions.trim()) {
        return res.status(400).json({ error: "No se proporcionaron instrucciones para la programación de citas." });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ 
          error: "El servicio de análisis automático no está configurado en el servidor." 
        });
      }

      // Default workday hours if not supplied
      const startHour = workStartHour || '08:00';
      const endHour = workEndHour || '15:00';

      // Dynamically get the current date to resolve relative dates like "mañana", "lunes que viene", "este viernes"
      const now = new Date();
      const currentDateStr = now.toISOString().split('T')[0];
      const currentDayOfWeek = now.toLocaleDateString('es-ES', { weekday: 'long' });
      const currentMonthName = now.toLocaleDateString('es-ES', { month: 'long' });
      const currentYear = now.getFullYear();

      const promptText = `
Eres un asistente avanzado de planificación de citas médicas para el sistema de contratación PROFEA de la Diputación de Cádiz.
Tu tarea es comprender, analizar y procesar una orden de planificación de citas médicas libre en lenguaje natural dada por el usuario, y generar una lista de citas médicas planificadas de manera óptima según sus instrucciones.

Las citas médicas son ANÓNIMAS ya que aún no se ha contratado formalmente a los trabajadores (se les entrega el resguardo en blanco para rellenar a mano el día de la firma de su contrato). Por tanto, tu trabajo es calcular y distribuir la cantidad exacta de citas requeridas en la orden, con sus correspondientes fechas, horas escalonadas, número de obra/oferta y centro médico.

CONTEXTO TEMPORAL ACTUAL (¡Usa esto para calcular fechas relativas con total exactitud!):
- Hoy es: ${currentDayOfWeek}, ${currentDateStr} (Año: ${currentYear}, Mes actual: ${currentMonthName})
- Si el usuario dice "lunes que viene", calcula qué fecha YYYY-MM-DD corresponde al próximo lunes a partir de hoy (${currentDateStr}).
- Si dice "mañana", corresponde a la fecha de mañana.
- Si dice "este viernes", calcula el viernes de la semana en curso.
- Si menciona un día sin año/mes (ej: "el día 13", "13-02-2026"), tradúcelo a la fecha correspondiente.

CENTROS MÉDICOS GUARDADOS / RECOMENDADOS:
${savedSitios && Array.isArray(savedSitios) && savedSitios.length > 0 ? savedSitios.map((s: string) => `- ${s}`).join('\n') : '- Centro de Prevención Diputación de Cádiz'}

ORDEN / INSTRUCCIÓN LIBRE DEL USUARIO:
"${instructions}"

JORNADA LABORAL DE CITAS MÉDICAS CONFIGURADA POR EL USUARIO:
- Hora de inicio de jornada: ${startHour}
- Hora de finalización de jornada: ${endHour}

REGLAS DE ANÁLISIS COMPRENSIVO (Cómo interpretar la orden libre):
1. CANTIDAD DE CITAS A GENERAR:
   - Analiza la instrucción libre y extrae el número de trabajadores que se desea citar (ej. "Cita a 11 trabajadores..." -> generarás exactamente 11 objetos/citas en la lista).
   - Si no se especifica una cantidad exacta de trabajadores pero se intuyen varios, genera por defecto 10 citas. Si es para un solo trabajador en particular (ej. "Cita para el día 13..."), genera 1 cita.

2. PLANIFICACIÓN DE FECHAS (citaDia):
   - Formato de salida obligatorio: "YYYY-MM-DD".
   - Traduce cualquier fecha mencionada (ej: "13-02-2026", "13 de febrero") a su formato ISO "YYYY-MM-DD" con total exactitud.

3. PLANIFICACIÓN DE HORARIOS (citaHora):
   - Formato de salida obligatorio: "HH:MM" (formato de 24 horas, ej. "08:10", "09:00", "13:30").
   - Si la orden menciona una hora específica (ej: "a las 08:10 horas" o "a partir de las 08:10"), la primera cita debe agendarse a esa hora.
   - Si se planifican múltiples trabajadores para el mismo día y lugar, y la orden pide agruparlos o distribuirlos en el tiempo (ej. "de 2 en 2 cada 10 minutos"), calcula las horas subsecuentes de forma matemática. Por ejemplo, para "11 trabajadores, a las 08:10, de 2 en 2 cada 10 min":
     - Cita 1 y 2: 08:10
     - Cita 3 y 4: 08:20
     - Cita 5 y 6: 08:30
     - Cita 7 y 8: 08:40
     - Cita 9 y 10: 08:50
     - Cita 11: 09:00
   - Si no se especifica intervalo ni distribución, pon la misma hora para todos o distribúyelos en intervalos de 5 o 10 minutos para evitar saturación del centro médico.
   - Respeta siempre la jornada configurada (${startHour} a ${endHour}).

4. NÚMERO DE OBRA / OFERTA (numOferta) Y LOCALIDAD (obra):
   - Extrae el número de obra/oferta mencionado en las instrucciones (ej. "obra nº 11002GR" o "11002GR"). Devuelve este código como "numOferta".
   - Extrae la localidad o el nombre de la obra mencionado (ej. "BORNOS", "Jerez"). Devuelve este valor como "obra".
   - Si no se menciona ningún número de obra o localidad, usa "11002GR" y "BORNOS" como valores predeterminados seguros para el PROFEA de la provincia de Cádiz.

5. DÍA DE COMIENZO DE LA OBRA (diaComienzo):
   - Analiza si la instrucción libre menciona la fecha de comienzo de la obra, inicio de los trabajos, o fecha de incorporación del personal (ej. "obra empieza el día 16", "comienzo el lunes que viene", "comienzo de obra el 16-02-2026").
   - Traduce cualquier fecha mencionada a su formato ISO "YYYY-MM-DD".
   - Si no se especifica ninguna fecha de comienzo de obra, calcúlala de forma lógica e inteligente: generalmente es de 2 a 3 días hábiles después de la cita médica, o el lunes inmediatamente posterior si la cita es un jueves o viernes.

6. SELECCIÓN DEL CENTRO MÉDICO (sitioReconocimiento):
   - Si el usuario menciona un centro de citas específico en su orden libre (ej: "UNIDAD MOVIL UBICADA EN BORNOS...", "en el Centro de Prevención"), extrae y usa exactamente ese nombre de centro completo.
   - Si no se especifica ningún centro en las instrucciones, usa el primer Centro Médico de la lista recomendada o el "Centro de Prevención Diputación de Cádiz".

IMPORTANTE:
Retorna únicamente el array de objetos JSON que cumpla el formato requerido. No incluyas explicaciones en texto plano, ni comentarios ni bloques markdown fuera del JSON estructurado.
`;

      const ai = getGeminiClient();
      const response = await callGeminiWithRetry(ai, {
        preferredModel: "gemini-flash-latest",
        contents: promptText,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                citaDia: { type: Type.STRING, description: "Día de la cita en formato YYYY-MM-DD." },
                citaHora: { type: Type.STRING, description: "Hora de la cita en formato HH:MM (24 horas)." },
                sitioReconocimiento: { type: Type.STRING, description: "Nombre del centro médico donde se realizará el reconocimiento." },
                numOferta: { type: Type.STRING, description: "Número de obra/oferta extraído, ej: 11002GR." },
                obra: { type: Type.STRING, description: "Localidad o nombre de la obra extraído, ej: BORNOS." },
                supervisorResponsable: { type: Type.STRING, description: "Supervisor responsable de la obra si se menciona, o vacío." },
                diaComienzo: { type: Type.STRING, description: "Fecha de comienzo de la obra o fecha de incorporación en formato YYYY-MM-DD." }
              },
              required: ["citaDia", "citaHora", "sitioReconocimiento", "diaComienzo"]
            }
          }
        }
      });

      const rawJson = cleanJsonText(response.text || "[]");
      let schedule: any[] = [];
      try {
        schedule = JSON.parse(rawJson);
      } catch {
        const match = rawJson.match(/\[[\s\S]*\]/);
        schedule = match ? JSON.parse(match[0]) : [];
      }
      res.json({ success: true, schedule });
    } catch (error: any) {
      console.error("Error scheduling appointments with AI:", error);
      res.status(500).json({ error: error.message || "Error al procesar la planificación automática." });
    }
  });

  // Helper functions for validating Spanish identity documents and dates
  function validateSpanishDni(dniRaw?: string): { isValid: boolean; normalized: string; error?: string } {
    if (!dniRaw || !dniRaw.trim()) {
      return { isValid: false, normalized: '', error: 'DNI ausente en el documento' };
    }
    const clean = dniRaw.trim().toUpperCase().replace(/[\s.-]/g, '');
    const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';

    // DNI: 8 digits + 1 letter
    const dniMatch = clean.match(/^(\d{8})([A-Z])$/);
    if (dniMatch) {
      const num = parseInt(dniMatch[1], 10);
      const expectedLetter = letters[num % 23];
      if (dniMatch[2] !== expectedLetter) {
        return {
          isValid: false,
          normalized: clean,
          error: `DNI con letra de control discordante: tiene '${dniMatch[2]}' y se esperaba '${expectedLetter}'`
        };
      }
      return { isValid: true, normalized: clean };
    }

    // NIE: X, Y, Z + 7 digits + 1 letter
    const nieMatch = clean.match(/^([XYZ])(\d{7})([A-Z])$/);
    if (nieMatch) {
      let prefix = '0';
      if (nieMatch[1] === 'Y') prefix = '1';
      else if (nieMatch[1] === 'Z') prefix = '2';
      const num = parseInt(prefix + nieMatch[2], 10);
      const expectedLetter = letters[num % 23];
      if (nieMatch[3] !== expectedLetter) {
        return {
          isValid: false,
          normalized: clean,
          error: `NIE con letra de control discordante: tiene '${nieMatch[3]}' y se esperaba '${expectedLetter}'`
        };
      }
      return { isValid: true, normalized: clean };
    }

    return {
      isValid: false,
      normalized: clean,
      error: `Formato DNI/NIE no reglamentario (${clean.length} caracteres: se esperan 8 dígitos + letra o NIE)`
    };
  }

  function validateMedicalDate(dateRaw?: string): { isValid: boolean; normalized: string; error?: string } {
    if (!dateRaw || !dateRaw.trim()) {
      return { isValid: false, normalized: '', error: 'Fecha de reconocimiento médico no detectada' };
    }
    let clean = dateRaw.trim();
    // Convert DD/MM/YYYY or DD-MM-YYYY to YYYY-MM-DD
    const esMatch = clean.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})$/);
    if (esMatch) {
      const day = esMatch[1].padStart(2, '0');
      const month = esMatch[2].padStart(2, '0');
      clean = `${esMatch[3]}-${month}-${day}`;
    }

    const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!isoMatch) {
      return { isValid: false, normalized: clean, error: `Formato de fecha inválido (${clean}), se espera AAAA-MM-DD` };
    }
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2020 || year > 2035) {
      return { isValid: false, normalized: clean, error: `Fecha de reconocimiento anómala o fuera de rango (${clean})` };
    }
    return { isValid: true, normalized: clean };
  }

  /**
   * Robust parser for Spanish and ISO date formats (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, textual months)
   * Avoids invalid date swaps and NaN issues in expiration calculations.
   */
  function parseSpanishOrIsoDate(dateRaw?: string): { date: Date | null; iso: string; isValid: boolean } {
    if (!dateRaw || typeof dateRaw !== 'string') {
      return { date: null, iso: '', isValid: false };
    }
    const s = dateRaw.trim();
    if (!s || /^(n[\/\\]a|no aplica|permanente|indefinid[oa]|duraci[oó]n|en vigor|vigente|-)$/i.test(s)) {
      return { date: null, iso: '', isValid: false };
    }

    // 1. DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    const dmyMatch = s.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4})/);
    if (dmyMatch) {
      const day = parseInt(dmyMatch[1], 10);
      const month = parseInt(dmyMatch[2], 10);
      let year = parseInt(dmyMatch[3], 10);
      if (year < 100) year += year > 50 ? 1900 : 2000;
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1990 && year <= 2099) {
        const padM = String(month).padStart(2, '0');
        const padD = String(day).padStart(2, '0');
        const iso = `${year}-${padM}-${padD}`;
        const d = new Date(year, month - 1, day);
        if (!isNaN(d.getTime())) {
          return { date: d, iso, isValid: true };
        }
      }
    }

    // 2. YYYY-MM-DD or YYYY/MM/DD
    const ymdMatch = s.match(/^(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})/);
    if (ymdMatch) {
      const year = parseInt(ymdMatch[1], 10);
      const month = parseInt(ymdMatch[2], 10);
      const day = parseInt(ymdMatch[3], 10);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1990 && year <= 2099) {
        const padM = String(month).padStart(2, '0');
        const padD = String(day).padStart(2, '0');
        const iso = `${year}-${padM}-${padD}`;
        const d = new Date(year, month - 1, day);
        if (!isNaN(d.getTime())) {
          return { date: d, iso, isValid: true };
        }
      }
    }

    // 3. Spanish text date e.g. "15 de mayo de 2026", "23 de octubre 2026"
    const spanishMonths: Record<string, number> = {
      enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
      julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
    };
    const textMatch = s.match(/(\d{1,2})\s+(?:de\s+)?([a-záéíóú]+)\s+(?:de\s+)?(\d{4})/i);
    if (textMatch) {
      const day = parseInt(textMatch[1], 10);
      const mName = textMatch[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const month = spanishMonths[mName];
      const year = parseInt(textMatch[3], 10);
      if (month && day >= 1 && day <= 31 && year >= 1990 && year <= 2099) {
        const padM = String(month).padStart(2, '0');
        const padD = String(day).padStart(2, '0');
        const iso = `${year}-${padM}-${padD}`;
        const d = new Date(year, month - 1, day);
        if (!isNaN(d.getTime())) {
          return { date: d, iso, isValid: true };
        }
      }
    }

    // 4. Standard Date fallback
    const dFallback = new Date(s);
    if (!isNaN(dFallback.getTime()) && dFallback.getFullYear() >= 1990 && dFallback.getFullYear() <= 2099) {
      const iso = dFallback.toISOString().slice(0, 10);
      return { date: dFallback, iso, isValid: true };
    }

    return { date: null, iso: '', isValid: false };
  }

  // API endpoint to parse medical recognition records with LLM-assisted validation (supports multi-file batch analysis)
  app.post("/api/parse-medical-records", async (req, res) => {
    try {
      const existingWorkers = req.body.existingWorkers || req.body.people || [];

      // Support both multiple files in req.body.files and single file in req.body.fileBase64/pdfBase64
      let rawFilesList: any[] = [];
      if (Array.isArray(req.body.files) && req.body.files.length > 0) {
        rawFilesList = req.body.files;
      } else {
        const singleFile = req.body.fileBase64 || req.body.pdfBase64 || req.body.base64 || req.body.file;
        if (singleFile && typeof singleFile === "string" && singleFile.trim()) {
          rawFilesList = [{
            fileBase64: singleFile,
            filename: req.body.filename || "documento_medico.pdf",
            mimeType: req.body.mimeType || "application/pdf"
          }];
        }
      }

      if (rawFilesList.length === 0) {
        return res.status(400).json({ error: "No se proporcionó ningún archivo para analizar." });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ 
          error: "El servicio de análisis automático no está configurado en el servidor." 
        });
      }

      // Sanitize, decode, and detect MIME types for all files
      const preparedFiles: Array<{ cleanBase64: string; mimeType: string; filename: string; isOffice?: boolean; officeText?: string }> = [];

      for (let i = 0; i < rawFilesList.length; i++) {
        const item = rawFilesList[i];
        let raw = (item.fileBase64 || item.pdfBase64 || item.base64 || item.file || '').trim();
        if (!raw) continue;

        let mimeType = item.mimeType || "application/pdf";
        const fname = item.filename || `documento_${i + 1}.pdf`;

        // Strip data: URI prefix if present
        if (raw.startsWith("data:")) {
          const matches = raw.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            mimeType = matches[1];
            raw = matches[2];
          } else if (raw.includes(",")) {
            raw = raw.split(",")[1];
          }
        } else if (raw.includes(",")) {
          raw = raw.split(",")[1];
        }

        // Clean whitespace and linebreaks
        raw = raw.replace(/[\r\n\s]/g, "");

        let isOffice = false;
        let officeText = '';

        // Auto-detect MIME type from magic bytes or filename
        if (raw.startsWith("JVBERi")) {
          mimeType = "application/pdf";
        } else if (raw.startsWith("iVBORw")) {
          mimeType = "image/png";
        } else if (raw.startsWith("/9j/")) {
          mimeType = "image/jpeg";
        } else if (raw.startsWith("UklGR")) {
          mimeType = "image/webp";
        } else if (fname) {
          const lower = fname.toLowerCase();
          if (lower.endsWith(".png")) mimeType = "image/png";
          else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mimeType = "image/jpeg";
          else if (lower.endsWith(".webp")) mimeType = "image/webp";
          else if (lower.endsWith(".pdf")) mimeType = "application/pdf";
          else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
            mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            isOffice = true;
          } else if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
            mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            isOffice = true;
          }
        }

        if (isOffice && raw) {
          try {
            const buf = Buffer.from(raw, 'base64');
            officeText = await extractTextFromOfficeBuffer(buf, fname);
          } catch (e) {
            console.warn(`[Medical Records] Error extrayendo office text de ${fname}:`, e);
          }
        }

        if (raw) {
          preparedFiles.push({
            cleanBase64: raw,
            mimeType,
            filename: fname,
            isOffice,
            officeText
          });
        }
      }

      if (preparedFiles.length === 0) {
        return res.status(400).json({ error: "Ninguno de los archivos proporcionados contiene datos válidos." });
      }

      const currentYear = new Date().getFullYear().toString();
      const ai = getGeminiClient();

      const workersContext = existingWorkers.length > 0
        ? `LISTA DE TRABAJADORES CONTRATADOS EN LA PLANTILLA MUNICIPAL:
(NOTA CLAVE: En los listados de reconocimientos médicos NO figuran los DNI. Utiliza esta lista para contrastar, vincular y normalizar a los trabajadores EXCLUSIVAMENTE POR SU NOMBRE Y APELLIDOS):
${existingWorkers.map((w: any) => `- Nombre y Apellidos: "${w.apellidosNombre || ''}" | DNI plantilla: "${w.dni || ''}" | Obra: "${w.obra || ''}" (ID: ${w.id})`).join('\n')}`
        : '';

      const filenamesSummary = preparedFiles.map((f, i) => `[Archivo ${i + 1}]: "${f.filename}"`).join(', ');

      const promptText = `
Eres un especialista en Vigilancia de la Salud Laboral, Prevención de Riesgos Laborales (PRL) y Peritaje Documental para el Plan PROFEA de la Diputación de Cádiz.

Tu misión es:
1. Analizar exhaustivamente TODOS los documentos adjuntos (${preparedFiles.length} archivo(s): ${filenamesSummary}), que contienen RECONOCIMIENTOS MÉDICOS / ACTAS DE APTITUD MÉDICA / INFORMES DE SALUD (emitidos por Quirónprevención, Cualtis, Previs, Valora, Aspren u otros servicios médicos acreditados).
2. Extraer a CADA TRABAJADOR incluido en CUALQUIERA de los documentos aportados con precisión OCR milimétrica.
3. CONSOLIDACIÓN MULTI-ARCHIVO:
   - Procesa y analiza todos los documentos aportados CONJUNTAMENTE en una sola lista unificada.
   - Para cada trabajador extraído, indica en el campo 'archivoOrigen' el nombre exacto del archivo del que procede (ej: "${preparedFiles[0]?.filename || 'archivo.pdf'}").
   - Si un mismo trabajador aparece en varios documentos, unifica su registro conservando la información más completa y la fecha de reconocimiento más reciente.
4. CRÍTICO - IDENTIFICACIÓN EXCLUSIVAMENTE POR NOMBRE Y APELLIDOS:
   En los listados, actas y certificados de reconocimientos médicos NO CONSTAN LOS DNI de los trabajadores. Por tanto:
   - NUNCA busques por DNI ni exijas la presencia de DNI en el documento.
   - Identifica y empareja a cada trabajador ÚNICA Y EXCLUSIVAMENTE por su NOMBRE Y APELLIDOS (que pueden constar como 'Apellidos, Nombre' o 'Nombre Apellidos').
   - Si un trabajador coincide por Nombre y Apellidos con alguien de la plantilla municipal facilitada, puedes incorporar el DNI de la plantilla. Si no coincide o no consta en el documento, deja el campo dni vacío ("").
   - NUNCA marques la ausencia de DNI como error, anomalía ni inconsistencia.

REGLAS DE EXTRACCIÓN Y VALIDACIÓN DE CAMPOS:

1. TRABAJADOR (apellidosNombre):
   - Apellidos y Nombre tal como consten en el documento (ej: "GARCÍA LÓPEZ, JUAN").

2. DNI / NIE / NIF (dni):
   - En los listados médicos NO constan los DNI. Deja este campo vacío ("") o tómalo de la plantilla si coincide el Nombre y Apellidos.
   - dniValido: Siempre true (la ausencia de DNI en listados de reconocimientos médicos es completamente normal y reglamentaria).

3. ESTADO DE APTITUD MÉDICA (resultado):
   Clasifica OBLIGATORIAMENTE en uno de estos valores:
   - "Apto": El trabajador es APTO sin ninguna restricción médica.
   - "No Apto": El trabajador NO es apto para el trabajo/obra.
   - "Apto con Limitación": El trabajador es apto pero presenta limitaciones psicofísicas, restricciones de carga o adaptaciones de puesto.
   - "Pendiente": Si el examen está pendiente de resultados de laboratorio o pruebas adicionales.

4. LIMITACIONES ESPECÍFICAS (limitaciones):
   - Si el trabajador es "Apto con Limitación", extrae de forma concisa y clara las limitaciones o precauciones médicas indicadas (ejemplos: 'Evitar cargas > 15 kg', 'No trabajos en altura > 2 m', 'Evitar posturas forzadas de tronco', 'Uso de gafas de seguridad').
   - Si es "Apto" o "No Apto", deja este campo vacío ("").

5. FECHA DEL RECONOCIMIENTO (fechaReconocimiento):
   - Fecha en que se realizó el examen médico o fecha de emisión del acta médica (formato estándar 'YYYY-MM-DD').
   - fechaValida: true si es una fecha reconocible; false si está ausente o ilegible.

6. VALIDEZ (validez):
   - Año de vigencia (habitualmente anual: "${currentYear}") o fecha límite concreta si viene especificada.

7. CENTRO MÉDICO O SERVICIO DE PREVENCIÓN (centroMedico):
   - Nombre del centro emisor o servicio de prevención (ej: 'Quirónprevención', 'Cualtis', 'Previs', 'Valora Prevención').

8. ARCHIVO ORIGEN (archivoOrigen):
   - Nombre exacto del archivo del que procede este registro.

9. NIVEL DE CONFIANZA DEL OCR (confianza):
   - 'alta', 'media' o 'baja'.

10. INCONSISTENCIAS DETECTADAS (inconsistencias):
   - Array de cadenas breves con advertencias detectadas (ej: "Fecha de reconocimiento no indicada", "Centro emisor desconocido"). No incluyas advertencias sobre falta de DNI.

${workersContext}

Devuelve única y estrictamente un array JSON estructurado conforme al esquema definido.
`;

      const promptParts: any[] = [];

      // Append inlineData for images/PDFs, or text parts for Office (Excel / Word)
      preparedFiles.forEach((file) => {
        if (file.isOffice && file.officeText) {
          promptParts.push({
            text: `[DOCUMENTO TABULAR / HOJA DE CÁLCULO / TEXTO PROCESADO: "${file.filename}"]:\n${file.officeText}`
          });
        } else {
          promptParts.push({
            inlineData: {
              mimeType: file.mimeType,
              data: file.cleanBase64
            }
          });
        }
      });

      // Append text instruction
      promptParts.push({
        text: promptText
      });

      const response = await callGeminiWithRetry(ai, {
        preferredModel: "gemini-flash-latest",
        contents: {
          parts: promptParts
        },
        config: {
          maxOutputTokens: 65536,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                dni: { type: Type.STRING },
                apellidosNombre: { type: Type.STRING },
                resultado: { 
                  type: Type.STRING,
                  description: "Debe ser: 'Apto', 'No Apto', 'Apto con Limitación' o 'Pendiente'"
                },
                limitaciones: { type: Type.STRING },
                fechaReconocimiento: { type: Type.STRING },
                validez: { type: Type.STRING },
                centroMedico: { type: Type.STRING },
                archivoOrigen: { 
                  type: Type.STRING,
                  description: "Nombre del archivo del que se extrajo el registro"
                },
                observaciones: { type: Type.STRING },
                confianza: { 
                  type: Type.STRING,
                  description: "Nivel de confianza: 'alta', 'media' o 'baja'"
                },
                dniValido: { type: Type.BOOLEAN },
                fechaValida: { type: Type.BOOLEAN },
                centroValido: { type: Type.BOOLEAN },
                inconsistencias: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ["apellidosNombre"]
            }
          }
        }
      });

      const rawRecords: any[] = robustParseJsonArray(response.text || "[]");

      // Perform deep algorithmic validation layer to cross-check OCR fields
      const validatedRecords = rawRecords.map((item: any) => {
        const inconsistencias: string[] = Array.isArray(item.inconsistencias) 
          ? item.inconsistencias.filter((inc: string) => !inc.toLowerCase().includes('dni') && !inc.toLowerCase().includes('nif')) 
          : [];
        
        // 1. DNI: En listados de reconocimientos médicos los DNI NO constan.
        // Por tanto, dniValido es true por defecto y nunca se marca como inconsistencia.
        let normalizedDni = '';
        if (item.dni && typeof item.dni === 'string' && item.dni.trim()) {
          const dniCheck = validateSpanishDni(item.dni);
          normalizedDni = dniCheck.normalized || item.dni.trim().toUpperCase();
        }
        const dniValido = true;

        // 2. Date verification
        const dateCheck = validateMedicalDate(item.fechaReconocimiento);
        const fechaValida = item.fechaValida !== false && dateCheck.isValid;
        if (!dateCheck.isValid && !inconsistencias.some(inc => inc.toLowerCase().includes('fecha'))) {
          inconsistencias.push(dateCheck.error || 'Fecha de reconocimiento médico no detectada o inválida');
        }

        // 3. Medical center verification
        const rawCentro = (item.centroMedico || '').trim();
        const isUnknownCentro = !rawCentro || 
          ['no especificado', 'desconocido', 'n/a', '-', 'desconocida', 'sin especificar'].includes(rawCentro.toLowerCase());
        const centroValido = item.centroValido !== false && !isUnknownCentro;
        if (isUnknownCentro && !inconsistencias.some(inc => inc.toLowerCase().includes('centro'))) {
          inconsistencias.push('Centro médico emisor no especificado en el documento');
        }

        // 4. Overall confidence assessment (strictly based on readable name, date and aptitude)
        let confianza: 'alta' | 'media' | 'baja' = (item.confianza || 'alta').toLowerCase() as any;
        if (!['alta', 'media', 'baja'].includes(confianza)) {
          confianza = 'alta';
        }
        if (!fechaValida || inconsistencias.length >= 2) {
          confianza = 'baja';
        } else if (!centroValido || inconsistencias.length === 1) {
          if (confianza === 'alta') confianza = 'media';
        }

        // 5. Aptitude fallback
        let resultado = item.resultado || 'Apto';
        if (!['Apto', 'No Apto', 'Apto con Limitación', 'Pendiente'].includes(resultado)) {
          const lowerRes = resultado.toLowerCase();
          if (lowerRes.includes('no apto') || lowerRes.includes('no-apto')) resultado = 'No Apto';
          else if (lowerRes.includes('limitaci') || lowerRes.includes('restricci')) resultado = 'Apto con Limitación';
          else if (lowerRes.includes('apto')) resultado = 'Apto';
          else resultado = 'Pendiente';
        }

        const archivoOrigen = (item.archivoOrigen && typeof item.archivoOrigen === 'string' && item.archivoOrigen.trim())
          ? item.archivoOrigen.trim()
          : (preparedFiles.length === 1 ? preparedFiles[0].filename : (preparedFiles[0]?.filename || ''));

        return {
          dni: normalizedDni || (item.dni || '').trim().toUpperCase(),
          apellidosNombre: (item.apellidosNombre || '').trim(),
          resultado,
          limitaciones: (item.limitaciones || '').trim(),
          fechaReconocimiento: dateCheck.normalized || (item.fechaReconocimiento || '').trim(),
          validez: (item.validez || currentYear).trim(),
          centroMedico: isUnknownCentro ? 'No especificado' : rawCentro,
          archivoOrigen,
          observaciones: (item.observaciones || '').trim(),
          confianza,
          dniValido,
          fechaValida,
          centroValido,
          inconsistencias
        };
      });

      res.json({ 
        success: true, 
        records: validatedRecords,
        totalFiles: preparedFiles.length,
        filenames: preparedFiles.map(f => f.filename)
      });
    } catch (error: any) {
      console.error("Error parsing medical records PDF:", error);
      res.status(500).json({ error: error.message || "Error al procesar automáticamente los reconocimientos médicos del documento." });
    }
  });

  // API endpoint to analyze subcontractor CAE documents with AI (Ley 32/2006, Ley 31/1995, RD 1109/2007, RD 1627/1997)
  app.post("/api/analyze-subcontractor-docs", async (req, res) => {
    try {
      const { files, subcontrata, currentObraWorkers, trabajadoresEmpresaPrincipal } = req.body;
      if (!files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: "No se proporcionaron archivos para analizar." });
      }

      const nombreEmpresa = (subcontrata?.nombreEmpresa || "").trim();
      const cif = (subcontrata?.cif || "").trim().toUpperCase();
      const obra = (subcontrata?.obra || "").trim();
      const supervisor = (subcontrata?.supervisorResponsable || "").trim();
      // Plantilla propia de la entidad principal contratante (PROFEA)
      const empresaPropiaWorkersList = Array.isArray(trabajadoresEmpresaPrincipal)
        ? trabajadoresEmpresaPrincipal
        : (Array.isArray(currentObraWorkers) ? currentObraWorkers : []);
      const obraWorkersList = empresaPropiaWorkersList;

      const today = new Date();
      const todayIso = today.toISOString().slice(0, 10);

      // Deterministic helper for strict expiration evaluation based on Spanish PRL / CAE laws
      // Evita falsos positivos: sólo calcula caducidad legal cuando la normativa española fija un periodo de renovación periódica obligatoria
      const evaluateDocDateStrict = (docId: string, fechaEmision?: string, fechaCaducidad?: string) => {
        const parsedCaducidad = parseSpanishOrIsoDate(fechaCaducidad);
        const parsedEmision = parseSpanishOrIsoDate(fechaEmision);

        let expDate: Date | null = null;
        let esCaducablePorLey = false;
        let expIso = '';

        // 1. Prioridad absoluta: Si el documento tiene fecha de caducidad explícita válida
        if (parsedCaducidad.isValid && parsedCaducidad.date) {
          expDate = parsedCaducidad.date;
          expIso = parsedCaducidad.iso;
          esCaducablePorLey = true;
        }

        // 2. Si no tiene fecha de caducidad explícita, se calcula a partir de la fecha de emisión
        // ÚNICA Y EXCLUSIVAMENTE para los tipos de documentos con periodo de renovación periódica por ley
        if (!expDate && parsedEmision.isValid && parsedEmision.date) {
          const em = parsedEmision.date;
          switch (docId) {
            case 'cert_tgss':
              // Art. 42 Estatuto de los Trabajadores: validez de 3 meses
              expDate = new Date(em);
              expDate.setMonth(expDate.getMonth() + 3);
              esCaducablePorLey = true;
              break;
            case 'cert_aeat':
              // Art. 43.1.f Ley General Tributaria: validez de 12 meses (1 año)
              expDate = new Date(em);
              expDate.setMonth(expDate.getMonth() + 12);
              esCaducablePorLey = true;
              break;
            case 'rea':
              // Ley 32/2006 y RD 1109/2007: validez de 3 años
              expDate = new Date(em);
              expDate.setFullYear(expDate.getFullYear() + 3);
              esCaducablePorLey = true;
              break;
            case 'aptitud_medica':
              // Vigilancia de la salud periódica anual (12 meses)
              expDate = new Date(em);
              expDate.setFullYear(expDate.getFullYear() + 1);
              esCaducablePorLey = true;
              break;
            case 'seguro_rc':
            case 'seguro_itv_maquinaria':
              // Recibo anual de póliza / ITV anual (12 meses)
              expDate = new Date(em);
              expDate.setFullYear(expDate.getFullYear() + 1);
              esCaducablePorLey = true;
              break;
            default:
              // Documentos de vigencia permanente o por obra (Formación PRL, PSS, EPIs, CE, contratos, etc.)
              // ¡NO CADUCAN AL AÑO! Evitar falsos positivos.
              expDate = null;
              esCaducablePorLey = false;
              break;
          }
          if (expDate) {
            expIso = expDate.toISOString().slice(0, 10);
          }
        }

        // Si no tiene fecha de caducidad y no es un documento con renovación periódica obligatoria por ley:
        // Está 100% VIGENTE y conforme a normativa
        if (!expDate || !esCaducablePorLey) {
          return {
            estaCaducado: false,
            diasCaducado: 0,
            diasRestantes: 9999,
            esProximaCaducidad: false,
            fechaCaducidadCalculada: parsedCaducidad.iso || '',
            fechaEmisionNormalizada: parsedEmision.iso || fechaEmision || '',
            motivoCaducidad: 'Documento en vigor y conforme a normativa',
            estado: 'entregado'
          };
        }

        // Cálculo exacto de días respecto a la fecha actual (inicio de día para evitar desfases horarios)
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const expStart = new Date(expDate.getFullYear(), expDate.getMonth(), expDate.getDate());
        const diffTime = expStart.getTime() - todayStart.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        const finalExpStr = expIso || expDate.toISOString().slice(0, 10);

        // Si la fecha de caducidad es estrictamente anterior a hoy:
        if (diffDays < 0) {
          const diasVencido = Math.abs(diffDays);
          return {
            estaCaducado: true,
            diasCaducado: diasVencido,
            diasRestantes: 0,
            esProximaCaducidad: false,
            fechaCaducidadCalculada: finalExpStr,
            fechaEmisionNormalizada: parsedEmision.iso || fechaEmision || '',
            motivoCaducidad: `Documento caducado hace ${diasVencido} días (venció el ${finalExpStr}). Requiere renovación inmediata según ley.`,
            estado: 'caducado'
          };
        }

        // Si vence en los próximos 30 días:
        if (diffDays <= 30) {
          return {
            estaCaducado: false,
            diasCaducado: 0,
            diasRestantes: diffDays,
            esProximaCaducidad: true,
            fechaCaducidadCalculada: finalExpStr,
            fechaEmisionNormalizada: parsedEmision.iso || fechaEmision || '',
            motivoCaducidad: `Vigente, con próxima caducidad en ${diffDays} días (vence el ${finalExpStr}).`,
            estado: 'entregado'
          };
        }

        // Si tiene más de 30 días de vigencia:
        return {
          estaCaducado: false,
          diasCaducado: 0,
          diasRestantes: diffDays,
          esProximaCaducidad: false,
          fechaCaducidadCalculada: finalExpStr,
          fechaEmisionNormalizada: parsedEmision.iso || fechaEmision || '',
          motivoCaducidad: `Vigente y conforme a normativa hasta el ${finalExpStr} (${diffDays} días restantes).`,
          estado: 'entregado'
        };
      };

      // Helper to cross-reference detected worker names & DNIs:
      // STRICT FILTER: Prohíbe y excluye trabajadores de la plantilla de la empresa principal propia de figurar en la subcontrata
      const crossReferenceWorkers = (
        detected: { nombre: string; dni?: string; archivoOrigen?: string }[]
      ) => {
        const normalize = (s: string) =>
          (s || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(w => w.length > 1);

        const cleanDni = (d: string) => (d || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

        const coincidentes: any[] = [];
        const noRegistradosEnObra: any[] = [];
        const trabajadoresEmpresaPrincipalDetectados: any[] = [];

        detected.forEach(det => {
          const detWords = normalize(det.nombre);
          const detDni = cleanDni(det.dni || '');

          // Comprobar si coincide con algún trabajador de la empresa principal propia (PROFEA)
          let matchEmpresaPropia = empresaPropiaWorkersList.find((w: any) => {
            if (detDni && cleanDni(w.dni) === detDni) return true;
            return false;
          });

          if (!matchEmpresaPropia && detWords.length >= 2) {
            matchEmpresaPropia = empresaPropiaWorkersList.find((w: any) => {
              const ownWords = normalize(w.apellidosNombre || w.name);
              if (ownWords.length === 0) return false;
              const common = detWords.filter((dw: string) => ownWords.includes(dw));
              return common.length >= 2 || (common.length >= 1 && detWords.length === 1 && ownWords.length === 1);
            });
          }

          if (matchEmpresaPropia) {
            // ¡ESTRICTAMENTE PROHIBIDO! Es un trabajador de la empresa propia, no de la subcontrata
            const workerBlocked = {
              nombreDetectado: det.nombre,
              dniDetectado: det.dni || matchEmpresaPropia.dni,
              archivoOrigen: det.archivoOrigen,
              coincideConObra: false,
              esTrabajadorEmpresaPrincipal: true,
              prohibidoEnSubcontrata: true,
              trabajadorObraId: matchEmpresaPropia.id,
              nombreEnObra: matchEmpresaPropia.apellidosNombre || matchEmpresaPropia.name,
              dniEnObra: matchEmpresaPropia.dni,
              categoriaEnObra: matchEmpresaPropia.categoria || matchEmpresaPropia.category || 'Operario',
              estadoCotejo: 'empresa_principal_prohibido',
              detalles: `⛔ PROHIBIDO EN SUBCONTRATA: Este trabajador pertenece a la plantilla propia de la entidad principal contratante (PROFEA), NO a la empresa subcontratista "${nombreEmpresa}". Queda terminantemente PROHIBIDA su adscripción al personal de la subcontrata.`
            };
            trabajadoresEmpresaPrincipalDetectados.push(workerBlocked);
            noRegistradosEnObra.push(workerBlocked);
          } else {
            // Es un operario externo de la subcontratista
            coincidentes.push({
              nombreDetectado: det.nombre,
              dniDetectado: det.dni || 'Sin DNI',
              archivoOrigen: det.archivoOrigen,
              coincideConObra: false,
              esTrabajadorEmpresaPrincipal: false,
              prohibidoEnSubcontrata: false,
              estadoCotejo: 'subcontrata_acreditado',
              detalles: `Operario externo adscrito a la empresa subcontratista "${nombreEmpresa}". Documentación identificada.`
            });
          }
        });

        const totalTrabajadoresObra = empresaPropiaWorkersList.length;
        const porcentajeAcreditacion = coincidentes.length > 0 ? 100 : 0;

        return {
          totalTrabajadoresObra,
          totalDetectadosEnDocs: detected.length,
          coincidentes,
          noRegistradosEnObra,
          trabajadoresEmpresaPrincipalDetectados,
          pendientesDeAcreditar: [],
          porcentajeAcreditacion
        };
      };

      // Heuristic fallback analyzer in case Gemini is not available or encounters errors
      const runHeuristicFallback = (filesList: any[]) => {
        const results: any[] = [];
        const detectedDocIds = new Set<string>();
        const detectedWorkers: any[] = [];
        const alertasCaducidad: string[] = [];

        const keywordsMap: { [key: string]: { docId: string; name: string } } = {
          rea: { docId: 'rea', name: 'Inscripción en el REA (Registro de Empresas Acreditadas)' },
          acreditada: { docId: 'rea', name: 'Inscripción en el REA (Registro de Empresas Acreditadas)' },
          libro: { docId: 'libro_subcontratacion', name: 'Libro de Subcontratación / Diligencia y Aprobación Previa' },
          subcontrata: { docId: 'libro_subcontratacion', name: 'Libro de Subcontratación / Diligencia y Aprobación Previa' },
          adhesion: { docId: 'adhesion_pss', name: 'Acta de Adhesión al Plan de Seguridad y Salud (PSS)' },
          pss: { docId: 'adhesion_pss', name: 'Acta de Adhesión al Plan de Seguridad y Salud (PSS)' },
          concierto: { docId: 'concierto_sprl', name: 'Concierto con Servicio de Prevención (SPRL)' },
          prevencion: { docId: 'concierto_sprl', name: 'Concierto con Servicio de Prevención (SPRL)' },
          spa: { docId: 'concierto_sprl', name: 'Concierto con Servicio de Prevención (SPRL)' },
          tgss: { docId: 'cert_tgss', name: 'Certificado de estar al corriente con la Seg. Social (TGSS)' },
          seguridad_social: { docId: 'cert_tgss', name: 'Certificado de estar al corriente con la Seg. Social (TGSS)' },
          aeat: { docId: 'cert_aeat', name: 'Certificado de estar al corriente con Hacienda (AEAT)' },
          hacienda: { docId: 'cert_aeat', name: 'Certificado de estar al corriente con Hacienda (AEAT)' },
          tributaria: { docId: 'cert_aeat', name: 'Certificado de estar al corriente con Hacienda (AEAT)' },
          poliza: { docId: 'seguro_rc', name: 'Póliza y último recibo de Seguro de Resp. Civil (RC)' },
          rc: { docId: 'seguro_rc', name: 'Póliza y último recibo de Seguro de Resp. Civil (RC)' },
          responsabilidad_civil: { docId: 'seguro_rc', name: 'Póliza y último recibo de Seguro de Resp. Civil (RC)' },
          recurso_preventivo: { docId: 'recurso_preventivo', name: 'Designación de Recurso Preventivo' },
          evaluacion: { docId: 'evaluacion_especifica', name: 'Planificación y Evaluación Específica de Riesgos' },
          riesgos: { docId: 'evaluacion_especifica', name: 'Planificación y Evaluación Específica de Riesgos' },
          ita: { docId: 'altas_ss', name: 'Altas en Seguridad Social de los Operarios (ITA/RLC)' },
          rlc: { docId: 'altas_ss', name: 'Altas en Seguridad Social de los Operarios (ITA/RLC)' },
          idc: { docId: 'altas_ss', name: 'Altas en Seguridad Social de los Operarios (ITA/RLC)' },
          alta: { docId: 'altas_ss', name: 'Altas en Seguridad Social de los Operarios (ITA/RLC)' },
          formacion: { docId: 'formacion_prl', name: 'Formación en PRL según Convenio Construcción (TPC)' },
          tpc: { docId: 'formacion_prl', name: 'Formación en PRL según Convenio Construcción (TPC)' },
          curso: { docId: 'formacion_prl', name: 'Formación en PRL según Convenio Construcción (TPC)' },
          aptitud: { docId: 'aptitud_medica', name: 'Certificados de Aptitud Médica Laboral en Vigor' },
          reconocimiento: { docId: 'aptitud_medica', name: 'Certificados de Aptitud Médica Laboral en Vigor' },
          medico: { docId: 'aptitud_medica', name: 'Certificados de Aptitud Médica Laboral en Vigor' },
          epis: { docId: 'entrega_epis', name: 'Justificante de entrega de EPIs' },
          epi: { docId: 'entrega_epis', name: 'Justificante de entrega de EPIs' },
          maquinaria: { docId: 'marcado_ce_maquinaria', name: 'Marcado CE / Adecuación RD 1215/1997 Maquinaria' },
          ce: { docId: 'marcado_ce_maquinaria', name: 'Marcado CE / Adecuación RD 1215/1997 Maquinaria' },
          itv: { docId: 'seguro_itv_maquinaria', name: 'Seguro e ITV de Maquinaria' }
        };

        for (const f of filesList) {
          const fn = (f.name || "").toLowerCase().replace(/[^a-z0-9_]/g, "_");
          let matched = false;

          // Detect unreadable / blurry test files or low quality markers
          const isBlurryFilename = /borros|blur|desenfoc|movido|ilegibl|pixelad|baja_calidad|no_legible/.test(fn);

          for (const [kw, info] of Object.entries(keywordsMap)) {
            if (fn.includes(kw)) {
              // Extract date if present in filename e.g. 2024_05_12 or 20251101
              let dateMatch = fn.match(/(202[0-9])[-_]?([0-1][0-9])[-_]?([0-3][0-9])/);
              let detectedDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : undefined;
              
              const dateEval = evaluateDocDateStrict(info.docId, detectedDate, undefined);
              if (dateEval.estaCaducado) {
                alertasCaducidad.push(`${info.name}: Caducado (${dateEval.motivoCaducidad})`);
              }

              const esLegible = !isBlurryFilename;
              const solicitarReintento = isBlurryFilename || !detectedDate;
              const confianza = isBlurryFilename ? 'baja' : (detectedDate ? 'alta' : 'media');
              const motivoIlegible = isBlurryFilename 
                ? 'Archivo borroso o con baja resolución: no es posible extraer con certeza las fechas de validez ni sellos oficiales.'
                : (!detectedDate ? 'No se detecta fecha fehaciente en el documento con confianza alta.' : undefined);

              results.push({
                docId: info.docId,
                nombreDetectado: info.name,
                estado: solicitarReintento ? 'incompleto' : dateEval.estado,
                fechaEmision: detectedDate || todayIso,
                fechaCaducidad: dateEval.fechaCaducidadCalculada,
                estaCaducado: dateEval.estaCaducado,
                diasCaducado: dateEval.diasCaducado,
                diasRestantes: dateEval.diasRestantes,
                esProximaCaducidad: dateEval.esProximaCaducidad,
                motivoCaducidad: dateEval.motivoCaducidad,
                empresaDetectada: nombreEmpresa,
                cifDetectado: cif,
                observaciones: isBlurryFilename 
                  ? `[ARCHIVO ILEGIBLE]: Imagen borrosa o desenfocada. Se requiere reintento de subida con mayor nitidez.`
                  : `Documento identificado a partir del archivo ${f.name}. ${dateEval.motivoCaducidad}`,
                archivoOrigen: f.name,
                confianza,
                esLegible,
                motivoIlegible,
                solicitarReintento
              });
              detectedDocIds.add(info.docId);
              matched = true;
              break;
            }
          }

          if (!matched) {
            const isBlurry = isBlurryFilename;
            results.push({
              docId: 'otro',
              nombreDetectado: f.name,
              estado: isBlurry ? 'incompleto' : 'entregado',
              empresaDetectada: nombreEmpresa,
              cifDetectado: cif,
              observaciones: isBlurry 
                ? `[ARCHIVO ILEGIBLE]: Imagen borrosa o desenfocada. Solicitar reintento de subida.`
                : `Documento complementario aportado (${f.name}).`,
              archivoOrigen: f.name,
              confianza: isBlurry ? 'baja' : 'media',
              esLegible: !isBlurry,
              motivoIlegible: isBlurry ? 'Documento borroso o desenfocado, ilegible para el análisis automático.' : undefined,
              solicitarReintento: isBlurry
            });
          }
        }

        // Try extracting potential worker names if matched in filename against obraWorkersList
        obraWorkersList.forEach((w: any) => {
          const wTokens = (w.apellidosNombre || '').toLowerCase().split(/\s+/).filter((t: string) => t.length > 2);
          filesList.forEach((f: any) => {
            const fname = (f.name || '').toLowerCase();
            if (wTokens.some((t: string) => fname.includes(t)) || (w.dni && fname.includes(w.dni.toLowerCase()))) {
              detectedWorkers.push({
                nombre: w.apellidosNombre,
                dni: w.dni,
                archivoOrigen: f.name
              });
            }
          });
        });

        const comparativaTrabajadores = crossReferenceWorkers(detectedWorkers);

        const standardMandatory = [
          { id: 'rea', name: 'Inscripción en el REA (Registro de Empresas Acreditadas)' },
          { id: 'libro_subcontratacion', name: 'Libro de Subcontratación / Diligencia Previa' },
          { id: 'adhesion_pss', name: 'Acta de Adhesión al Plan de Seguridad y Salud (PSS)' },
          { id: 'concierto_sprl', name: 'Concierto con Servicio de Prevención (SPRL)' },
          { id: 'cert_tgss', name: 'Certificado de estar al corriente con Seg. Social (TGSS)' },
          { id: 'cert_aeat', name: 'Certificado de estar al corriente con Hacienda (AEAT)' },
          { id: 'seguro_rc', name: 'Póliza y último recibo de Seguro de Resp. Civil (RC)' },
          { id: 'recurso_preventivo', name: 'Designación de Recurso Preventivo' },
          { id: 'evaluacion_especifica', name: 'Planificación Preventiva y Evaluación de Riesgos' },
          { id: 'altas_ss', name: 'Altas en Seguridad Social de los Operarios (ITA/RLC)' },
          { id: 'formacion_prl', name: 'Formación en PRL Convenio Construcción (TPC)' },
          { id: 'aptitud_medica', name: 'Certificados de Aptitud Médica Laboral' },
          { id: 'entrega_epis', name: 'Registro de Entrega de EPIs firmado' }
        ];

        const faltantes = standardMandatory
          .filter(m => !detectedDocIds.has(m.id))
          .map(m => m.name);

        // Add expired docs to missing list
        results.forEach(r => {
          if (r.estaCaducado && !faltantes.includes(r.nombreDetectado)) {
            faltantes.push(`${r.nombreDetectado} (CADUCADO: Vencido el ${r.fechaCaducidad})`);
          }
        });

        const hasExpiredMandatory = results.some(r => r.estaCaducado);
        const hasUnregisteredWorkers = comparativaTrabajadores.noRegistradosEnObra.length > 0;

        let veredictoAcceso: 'APTO' | 'DENEGADO' | 'CONDICIONADO' = 'APTO';
        if (faltantes.length > 4 || hasExpiredMandatory) {
          veredictoAcceso = 'DENEGADO';
        } else if (faltantes.length > 0 || hasUnregisteredWorkers) {
          veredictoAcceso = 'CONDICIONADO';
        }

        return {
          success: true,
          documentosAnalizados: results,
          resumenDiagnostico: `Análisis documental completado: Se han identificado ${results.length} documento(s). Documentos vigentes: ${results.filter(r => !r.estaCaducado).length}. Caducados: ${results.filter(r => r.estaCaducado).length}. Operarios verificados contra la obra: ${comparativaTrabajadores.coincidentes.length} de ${comparativaTrabajadores.totalTrabajadoresObra}.`,
          veredictoAcceso,
          relacionFaltantes: faltantes,
          comparativaTrabajadores,
          alertasCaducidad,
          textoRequerimiento: `Estimados señores de ${nombreEmpresa || 'la subcontrata'}:\n\nRevisada la documentación aportada para la obra '${obra || 'en curso'}', les informamos que para autorizar el acceso según la Ley 32/2006 y RD 1627/1997, queda pendiente de entrega o renovación la siguiente documentación obligatoria:\n\n` +
            faltantes.map((f, i) => `  ${i + 1}. ${f}`).join('\n') +
            (comparativaTrabajadores.noRegistradosEnObra.length > 0
              ? `\n\n⚠️ DISCREPANCIA EN PERSONAL ADSCRITO:\nSe han detectado operarios en la documentación que no constan en el censo oficial de la obra:\n` +
                comparativaTrabajadores.noRegistradosEnObra.map((nr: any, i: number) => `  - ${nr.nombreDetectado} (${nr.dniDetectado})`).join('\n') +
                `\nDeben acreditar su adscripción legal a los trabajos de esta obra.`
              : '') +
            `\n\nRogamos remitan los documentos actualizados a la mayor brevedad antes de la fecha prevista de inicio.\n\nAtentamente,\n${supervisor || 'Dirección Facultativa / Supervisión de Obra'}\nDiputación Provincial de Cádiz - PROFEA`
        };
      };

      // If no Gemini API key, use the heuristic analyzer
      if (!process.env.GEMINI_API_KEY) {
        return res.json(runHeuristicFallback(files));
      }

      // Build multimodal contents for Gemini (supporting PDFs, Images, Excel and Word files)
      const parts: any[] = [];
      const preparedFiles: any[] = [];

      for (let i = 0; i < Math.min(files.length, 15); i++) {
        const fileObj = files[i];
        if (!fileObj.base64) continue;

        let mimeType = fileObj.type || "application/pdf";
        let cleanBase64 = fileObj.base64;

        if (cleanBase64.includes(";base64,")) {
          const match = cleanBase64.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            mimeType = match[1];
            cleanBase64 = match[2];
          }
        }

        const fname = fileObj.name || `doc_${i + 1}.pdf`;
        const lower = fname.toLowerCase();
        let isOffice = false;
        let officeText = '';

        if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
          mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          isOffice = true;
        } else if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
          mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          isOffice = true;
        }

        if (isOffice && cleanBase64) {
          try {
            const buf = Buffer.from(cleanBase64, 'base64');
            officeText = await extractTextFromOfficeBuffer(buf, fname);
          } catch (e) {
            console.warn(`[Subcontratas CAE] Error extrayendo office text de ${fname}:`, e);
          }
        }

        preparedFiles.push({ filename: fname, mimeType, isOffice });

        if (isOffice && officeText) {
          parts.push({
            text: `[CONTENIDO DE TEXTO Y TABLAS EXTRAÍDAS DEL ARCHIVO OFFICE (EXCEL/WORD): "${fname}"]:\n${officeText}`
          });
        } else {
          parts.push({
            inlineData: {
              mimeType: mimeType.includes("image") ? mimeType : "application/pdf",
              data: cleanBase64
            }
          });
        }
      }

      if (parts.length === 0) {
        return res.json(runHeuristicFallback(files));
      }

      // Prepare official company workers string for AI prompt
      const workersPromptList = empresaPropiaWorkersList.length > 0
        ? empresaPropiaWorkersList.map((w: any, idx: number) => `${idx + 1}. ${w.apellidosNombre || w.name} (DNI: ${w.dni || 'N/A'}, Categoría: ${w.categoria || w.category || 'Operario'})`).join('\n')
        : 'No hay trabajadores de la plantilla propia registrados.';

      const promptText = `Eres un auditor técnico superior e inspector de Prevención de Riesgos Laborales (PRL) y Coordinación de Actividades Empresariales (CAE) en obras públicas de construcción en España (Ley 32/2006, RD 1109/2007, Ley 31/1995, RD 1627/1997, RD 171/2004 y Convenio General del Sector de la Construcción).

FECHA DE REFERENCIA ACTUAL DE AUDITORÍA: "${todayIso}" (Año: ${today.getFullYear()}, Mes: ${today.getMonth() + 1}, Día: ${today.getDate()}).

DATOS DEL EXPEDIENTE Y DE LA OBRA:
- Empresa Subcontratista analizada: "${nombreEmpresa || 'Empresa Subcontratista'}"
- CIF de la Subcontrata: "${cif || 'No especificado'}"
- Obra de destino: "${obra || 'Obra municipal PROFEA'}"
- Supervisor / Técnico responsable: "${supervisor || 'Supervisor Técnico'}"
- Archivos aportados: ${preparedFiles.map(f => f.filename).join(', ')}

=============================================================================
🚨 DIRECTIVA ABSOLUTA DE EXCLUSIÓN: TRABAJADORES DE LA EMPRESA PRINCIPAL (PROHIBIDOS EN SUBCONTRATA)
=============================================================================
La siguiente lista corresponde a los trabajadores directos de la PLANTILLA PROPIA DE LA ENTIDAD PRINCIPAL (PROFEA).
${workersPromptList}

PROHIBICIÓN TERMINANTE:
- ESTÁ ESTRICTAMENTE PROHIBIDO que los trabajadores de la empresa principal propia figuren como trabajadores u operarios de la empresa subcontratista "${nombreEmpresa}".
- Los operarios válidos de la subcontrata DEBEN SER PERSONAL EXTERNO propio contratado por la subcontratista "${nombreEmpresa}".
- Si en cualquier documento de la subcontrata (actas, diplomas, firmas, listas) aparece el nombre o DNI de algún trabajador de la empresa principal propia listado arriba:
  * Márcalo obligatoriamente con 'esTrabajadorEmpresaPrincipal': true y 'prohibidoEnSubcontrata': true.
  * NUNCA lo consideres operario acreditado de la empresa subcontratista.
  * Añade en observaciones una advertencia rotunda: "⛔ PROHIBIDO: Este trabajador pertenece a la plantilla propia de la entidad principal contratante (PROFEA), no a la subcontrata."

=============================================================================
CRITERIOS RIGUROSOS DE ANÁLISIS DOCUMENTAL Y PREVENCIÓN DE FALSOS POSITIVOS:
=============================================================================

1. REGLA DE ORO CONTRA FALSOS POSITIVOS:
   - Todo documento presentado se presume VÁLIDO Y EN VIGOR salvo prueba concluyente y fehaciente en contra.
   - Si la fecha de caducidad o validez de un documento es igual o posterior a "${todayIso}", el documento está 100% VIGENTE ('estaCaducado': false, 'estado': 'entregado'). Queda terminantemente PROHIBIDO marcarlo como caducado.
   - Si en el documento figura una fecha futura (por ejemplo, finales de ${today.getFullYear()} o año posterior), el documento es plenamente válido.
   - Ante cualquier ambigüedad razonable, prevalece la VIGENCIA del documento.

2. PROHIBICIÓN DE CONFUNDIR CITAS NORMATIVAS CON FECHAS DEL DOCUMENTO:
   - NUNCA tomes como fecha de emisión o caducidad del documento las fechas de leyes, reales decretos, órdenes ministeriales o convenios colectivos citados en el texto (por ejemplo: "Ley 31/1995, de 8 de noviembre", "RD 1627/1997, de 24 de octubre", "Ley 32/2006, de 18 de octubre", "RD 1109/2007, de 24 de agosto", "Convenio General del Sector de la Construcción 2017-2021", etc.). Esas fechas corresponden a la promulgación histórica de las leyes, NO a la emisión ni caducidad del documento examinado.

3. PROHIBICIÓN DE CONFUNDIR FECHAS PERSONALES O MERCANTILES:
   - NUNCA tomes como fecha del documento la fecha de nacimiento de un trabajador, la fecha de expedición inicial de su DNI/NIE, ni la fecha de constitución de la empresa mercantil.
   - En certificaciones de la Seguridad Social (TGSS) o Hacienda (AEAT), distingue con exactitud:
     * "Fecha de expedición / emisión / firma": fecha en que se emitió el certificado.
     * "Válido hasta / Validez": fecha límite expresa de validez (PRIORIDAD ABSOLUTA).

4. FORMATO ESPAÑOL DE FECHAS (DD/MM/AAAA):
   - En España las fechas se expresan habitualmente como Día/Mes/Año (por ejemplo: 05/11/${today.getFullYear()} es el 5 de noviembre de ${today.getFullYear()}, NO el 11 de mayo). Normaliza siempre las fechas extraídas al formato ISO AAAA-MM-DD.

5. DISTINCIÓN ESTRICTA ENTRE DOCUMENTOS DE RENOVACIÓN PERIÓDICA Y DOCUMENTOS SIN CADUCIDAD ANUAL:
   A) DOCUMENTOS DE VIGENCIA PERMANENTE O POR OBRA (¡NUNCA CADUCAN AL AÑO!):
      - 'formacion_prl': Diplomas de cursos de formación PRL del Convenio de la Construcción (TPC 20h oficio albañilería/electricidad/etc., 60h nivel básico). ¡NO TIENEN CADUCIDAD LEGAL PERIÓDICA! Una formación cursada hace 1, 2, 3 o más años es permanente y plenamente válida. Márcalos siempre como VIGENTES ('estaCaducado': false, 'estado': 'entregado').
      - 'adhesion_pss': Acta formal de adhesión al Plan de Seguridad y Salud. Válida durante toda la ejecución de la obra.
      - 'recurso_preventivo': Acta de designación de Recurso Preventivo. Válida para la obra.
      - 'entrega_epis': Registro y justificante de entrega de Equipos de Protección Individual. Válido para la obra.
      - 'marcado_ce_maquinaria': Declaración de conformidad y Marcado CE de maquinaria. Válido permanentemente para la máquina.
      - 'autorizacion_maquinaria': Autorización de uso de maquinaria. Válida para la obra.
      - 'libro_subcontratacion': Diligencia y aprobación previa del Libro de Subcontratación. Válido para la obra.
      - 'altas_ss': Altas en Seguridad Social (ITA/IDC/RLC). Válidas mientras el trabajador conste de alta.
      - 'contrato_laboral': Contrato de trabajo del operario. Válido según su duración contractual.

   B) DOCUMENTOS CON RENOVACIÓN PERIÓDICA OBLIGATORIA POR LEY (PLAZOS EXACTOS):
      - 'rea' (Registro de Empresas Acreditadas): ¡Validez de 3 AÑOS desde su inscripción o renovación! (Ley 32/2006). Un REA expedido hace 1 o 2 años ESTÁ TOTALMENTE VIGENTE. Solo caduca si han transcurrido más de 3 años.
      - 'cert_aeat' (Hacienda / Agencia Tributaria): ¡Validez de 12 MESES (1 AÑO)! (Art. 43.1.f Ley General Tributaria). Un certificado emitido hace menos de 1 año ESTÁ VIGENTE.
      - 'cert_tgss' (Seguridad Social): Validez de 3 MESES desde su expedición (Art. 42 Estatuto de los Trabajadores).
      - 'aptitud_medica' (Vigilancia de la Salud / Reconocimiento Médico): Validez periódica de 12 MESES (1 AÑO).
      - 'seguro_rc' (Seguro de Responsabilidad Civil): Validez de 12 MESES desde la fecha del último recibo bancario anual o según fecha de vencimiento indicada.
      - 'seguro_itv_maquinaria': Seguro obligatorio e ITV de vehículos/maquinaria. Validez según fecha de vencimiento anual indicada en ficha técnica / póliza.

6. PRIORIDAD DE LA FECHA DE CADUCIDAD IMPRESA:
   - Si en el documento figura expresamente "Válido hasta: [FECHA]", "Fecha de vencimiento: [FECHA]" o similar, y dicha fecha es >= "${todayIso}", el documento está VIGENTE ('estaCaducado': false).

7. EVALUACIÓN DE NITIDEZ Y LEGIBILIDAD:
   - Si el documento es nítido y legible con datos claros: 'esLegible': true, 'solicitarReintento': false, 'confianza': 'alta'.
   - Solo si el documento está borroso, desenfocado o recortado de forma que impide leer sellos o fechas clave: 'esLegible': false, 'solicitarReintento': true, 'confianza': 'baja'.

8. COTEJO DE TRABAJADORES:
   - Extrae los trabajadores de la subcontrata con sus nombres y DNI.
   - Recuerda: Los trabajadores de la empresa principal propia PROFEA deben quedar PROHIBIDOS ('esTrabajadorEmpresaPrincipal': true, 'prohibidoEnSubcontrata': true).

Responde estrictamente en formato JSON según el esquema.`;

      parts.push({ text: promptText });

      const ai = getGeminiClient();
      let response;
      try {
        response = await callGeminiWithRetry(ai, {
          preferredModel: "gemini-flash-latest",
          contents: { parts },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                documentosAnalizados: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      docId: { type: Type.STRING },
                      nombreDetectado: { type: Type.STRING },
                      estado: { type: Type.STRING, enum: ["entregado", "caducado", "incompleto"] },
                      fechaEmision: { type: Type.STRING },
                      fechaCaducidad: { type: Type.STRING },
                      estaCaducado: { type: Type.BOOLEAN },
                      diasCaducado: { type: Type.NUMBER },
                      motivoCaducidad: { type: Type.STRING },
                      empresaDetectada: { type: Type.STRING },
                      cifDetectado: { type: Type.STRING },
                      observaciones: { type: Type.STRING },
                      archivoOrigen: { type: Type.STRING },
                      confianza: { type: Type.STRING, enum: ["alta", "media", "baja"] },
                      esLegible: { type: Type.BOOLEAN },
                      motivoIlegible: { type: Type.STRING },
                      solicitarReintento: { type: Type.BOOLEAN }
                    },
                    required: ["docId", "estado", "observaciones"]
                  }
                },
                trabajadoresDetectados: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      nombre: { type: Type.STRING },
                      dni: { type: Type.STRING },
                      archivoOrigen: { type: Type.STRING },
                      esDeEstaObra: { type: Type.BOOLEAN },
                      esTrabajadorEmpresaPrincipal: { type: Type.BOOLEAN },
                      prohibidoEnSubcontrata: { type: Type.BOOLEAN },
                      observaciones: { type: Type.STRING }
                    },
                    required: ["nombre"]
                  }
                },
                alertasCaducidad: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                },
                resumenDiagnostico: { type: Type.STRING },
                veredictoAcceso: { type: Type.STRING, enum: ["APTO", "DENEGADO", "CONDICIONADO"] },
                relacionFaltantes: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                },
                textoRequerimiento: { type: Type.STRING }
              },
              required: ["documentosAnalizados", "resumenDiagnostico", "veredictoAcceso", "relacionFaltantes", "textoRequerimiento"]
            }
          }
        });
      } catch (geminiError: any) {
        console.warn("[Subcontratas AI] Gemini falló, activando motor de análisis heurístico de respaldo:", geminiError?.message || geminiError);
        return res.json(runHeuristicFallback(files));
      }

      const rawJson = cleanJsonText(response.text || "{}");
      let parsedData: any = {};
      try {
        parsedData = JSON.parse(rawJson);
      } catch (e) {
        const match = rawJson.match(/\{[\s\S]*\}/);
        if (match) {
          parsedData = JSON.parse(match[0]);
        } else {
          return res.json(runHeuristicFallback(files));
        }
      }

      // POST-PROCESSING: Run strict deterministic date, legibility, and worker cross-referencing validation
      const rawDocs = Array.isArray(parsedData.documentosAnalizados) ? parsedData.documentosAnalizados : [];
      const rawWorkers = Array.isArray(parsedData.trabajadoresDetectados) ? parsedData.trabajadoresDetectados : [];

      const alertasCaducidad: string[] = [];
      const faltantesList: string[] = Array.isArray(parsedData.relacionFaltantes) ? [...parsedData.relacionFaltantes] : [];
      const documentosIlegibles: any[] = [];

      const finalizedDocs = rawDocs.map((doc: any) => {
        const dateEval = evaluateDocDateStrict(doc.docId, doc.fechaEmision, doc.fechaCaducidad);

        // DETERMINISTIC SOURCE OF TRUTH: Prevent LLM false positives.
        // If deterministic evaluation shows the document is in vigor (or belongs to non-expiring categories),
        // strictly override any hallucinated 'estaCaducado: true' from the AI model.
        const finalEstaCaducado = dateEval.estaCaducado;
        const finalDiasCaducado = dateEval.diasCaducado;
        const finalMotivo = dateEval.motivoCaducidad;

        // Check blurriness / legibility and high confidence requirement on dates
        const isBlurry = doc.esLegible === false ||
          doc.solicitarReintento === true ||
          (doc.confianza === 'baja' && (!doc.fechaCaducidad && !doc.fechaEmision)) ||
          /borros|blur|desenfoc|ilegibl|baja resoluci|calidad baja|pixelad/i.test(doc.observaciones || '') ||
          /borros|blur|desenfoc|ilegibl/i.test(doc.archivoOrigen || '');

        let finalEstado: 'entregado' | 'caducado' | 'incompleto' = 'entregado';
        if (finalEstaCaducado) {
          finalEstado = 'caducado';
        } else if (isBlurry) {
          finalEstado = 'incompleto';
          documentosIlegibles.push({
            archivo: doc.archivoOrigen || doc.nombreDetectado || 'Archivo desconocido',
            motivo: doc.motivoIlegible || 'Documento borroso o con nitidez insuficiente: no se pueden certificar las fechas de validez con confianza alta.',
            docRelacionado: doc.nombreDetectado || doc.docId,
            confianza: doc.confianza || 'baja'
          });
        } else {
          finalEstado = 'entregado';
        }

        if (finalEstaCaducado) {
          const alertMsg = `${doc.nombreDetectado || doc.docId}: Caducado (venció el ${dateEval.fechaCaducidadCalculada || doc.fechaCaducidad}, hace ${finalDiasCaducado} días).`;
          if (!alertasCaducidad.includes(alertMsg)) {
            alertasCaducidad.push(alertMsg);
          }
          const missingName = `${doc.nombreDetectado || doc.docId} (CADUCADO)`;
          if (!faltantesList.some(f => f.toLowerCase().includes(doc.docId.toLowerCase()))) {
            faltantesList.push(missingName);
          }
        }

        return {
          ...doc,
          estado: finalEstado,
          estaCaducado: finalEstaCaducado,
          diasCaducado: finalDiasCaducado,
          diasRestantes: dateEval.diasRestantes,
          esProximaCaducidad: dateEval.esProximaCaducidad,
          fechaEmision: dateEval.fechaEmisionNormalizada || doc.fechaEmision || '',
          fechaCaducidad: dateEval.fechaCaducidadCalculada || doc.fechaCaducidad || '',
          motivoCaducidad: finalMotivo,
          esLegible: !isBlurry,
          solicitarReintento: isBlurry,
          confianza: isBlurry && doc.confianza === 'alta' ? 'baja' : (doc.confianza || 'alta'),
          motivoIlegible: isBlurry ? (doc.motivoIlegible || 'Documento no legible o borroso: reintente la subida con un escaneo nítido.') : undefined
        };
      });

      // Filter out delivered and valid documents from faltantesList (clean up any LLM hallucinations)
      const cleanFaltantes = faltantesList.filter(f => {
        const isDocDeliveredAndValid = finalizedDocs.some(d =>
          !d.estaCaducado &&
          d.estado === 'entregado' &&
          (f.toLowerCase().includes(d.docId.toLowerCase()) || (d.nombreDetectado && f.toLowerCase().includes(d.nombreDetectado.toLowerCase())))
        );
        return !isDocDeliveredAndValid;
      });

      // Deterministic worker cross-referencing
      const comparativaTrabajadores = crossReferenceWorkers(rawWorkers);

      // Re-evaluate veredictoAcceso based on strict post-processing
      let veredictoFinal: 'APTO' | 'DENEGADO' | 'CONDICIONADO' = parsedData.veredictoAcceso || 'CONDICIONADO';
      const hasExpiredMandatory = finalizedDocs.some((d: any) => d.estaCaducado);
      const hasUnregisteredWorkers = comparativaTrabajadores.noRegistradosEnObra.length > 0;
      const hasUnreadableDocs = documentosIlegibles.length > 0;

      if (hasExpiredMandatory || cleanFaltantes.length > 4) {
        veredictoFinal = 'DENEGADO';
      } else if (hasUnregisteredWorkers || cleanFaltantes.length > 0 || hasUnreadableDocs) {
        veredictoFinal = 'CONDICIONADO';
      } else {
        veredictoFinal = 'APTO';
      }

      res.json({
        success: true,
        documentosAnalizados: finalizedDocs,
        resumenDiagnostico: parsedData.resumenDiagnostico || `Análisis completado: ${finalizedDocs.length} documentos procesados.${hasUnreadableDocs ? ` (${documentosIlegibles.length} documentos requieren reintento por falta de nitidez).` : ''}`,
        veredictoAcceso: veredictoFinal,
        relacionFaltantes: cleanFaltantes,
        comparativaTrabajadores,
        alertasCaducidad,
        documentosIlegibles,
        textoRequerimiento: parsedData.textoRequerimiento || ""
      });
    } catch (error: any) {
      console.error("Error in /api/analyze-subcontractor-docs:", error);
      res.status(500).json({ error: error.message || "Error procesando el análisis de documentación de subcontratas." });
    }
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
