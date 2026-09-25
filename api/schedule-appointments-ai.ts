import { GoogleGenAI } from '@google/genai';

type Appointment = {
  citaDia: string;
  citaHora: string;
  sitioReconocimiento: string;
  obra?: string;
  numOferta?: string;
  quincena?: string;
  diaComienzo?: string;
  diaFinContrato?: string;
  diaContratacion?: string;
  supervisorResponsable?: string;
  telefonoSupervisor?: string;
};

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/responses';

const normalizeText = (value: unknown) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const pad = (value: number) => String(value).padStart(2, '0');
const isoLocal = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const isValidDate = (value: unknown) => {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y,m,d] = text.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
};

const isValidTime = (value: unknown) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));

const getOutputText = (payload: any): string => {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (typeof part?.text === 'string') return part.text;
    }
  }
  return '';
};

const callGateway = async (prompt: string, schema: any) => {
  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) throw new Error('AI_GATEWAY_UNAVAILABLE');
  const response = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-5.6-sol',
      input: prompt,
      max_output_tokens: 12000,
      text: {
        format: {
          type: 'json_schema',
          name: 'medical_appointment_schedule',
          strict: true,
          schema,
        },
      },
      metadata: { feature: 'profea-medical-appointment-planner' },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`AI_GATEWAY_${response.status}`);
  const text = getOutputText(payload);
  if (!text) throw new Error('AI_GATEWAY_EMPTY');
  return JSON.parse(text);
};

const callGemini = async (prompt: string, schema: any) => {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    '';
  if (!apiKey) throw new Error('GEMINI_UNAVAILABLE');
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: schema as any,
      temperature: 0,
    },
  });
  return JSON.parse(String(response.text || '[]'));
};

const parseExplicitCount = (instructions: string): number | null => {
  const n = normalizeText(instructions);
  const patterns = [
    /(?:cita|citar|planifica|planificar|programa|programar|para)\s+(?:a\s+)?(\d{1,3})\s+(?:trabajadores|personas|citas)/,
    /(\d{1,3})\s+(?:trabajadores|personas|citas)/,
  ];
  for (const pattern of patterns) {
    const match = n.match(pattern);
    if (match) return Math.min(200, Math.max(1, Number(match[1])));
  }
  return null;
};

const inferFallbackDate = (instructions: string): string => {
  const now = new Date();
  const text = normalizeText(instructions);
  if (/\bmanana\b/.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return isoLocal(d);
  }
  const iso = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;
  const dmy = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);
  if (dmy) return `${dmy[3]}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
  return isoLocal(now);
};

const inferFallbackTime = (instructions: string, fallback: string): string => {
  const m = String(instructions || '').match(/(?:a\s+partir\s+de\s+las|a\s+las|desde\s+las)?\s*([01]?\d|2[0-3])[:.]([0-5]\d)/i);
  return m ? `${pad(Number(m[1]))}:${m[2]}` : fallback;
};

const inferInterval = (instructions: string): number => {
  const n = normalizeText(instructions);
  const m = n.match(/cada\s+(\d{1,2})\s*(?:min|minutos)/);
  return m ? Math.max(0, Number(m[1])) : 10;
};

const inferPerSlot = (instructions: string): number => {
  const n = normalizeText(instructions);
  const m = n.match(/de\s+(\d{1,2})\s+en\s+(\d{1,2})/);
  if (m && m[1] === m[2]) return Math.max(1, Number(m[1]));
  const solo = n.match(/(\d{1,2})\s+(?:trabajadores|personas)\s+por\s+cita/);
  return solo ? Math.max(1, Number(solo[1])) : 1;
};

const minutes = (hhmm: string) => {
  const [h,m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const timeFromMinutes = (value: number) => `${pad(Math.floor(value / 60) % 24)}:${pad(value % 60)}`;

const deterministicFallback = (instructions: string, sites: string[], startHour: string, endHour: string): Appointment[] => {
  const count = parseExplicitCount(instructions) || 1;
  const citaDia = inferFallbackDate(instructions);
  const firstTime = inferFallbackTime(instructions, startHour);
  const interval = inferInterval(instructions);
  const perSlot = inferPerSlot(instructions);
  const maxMinutes = minutes(endHour);
  const site = sites[0] || 'Centro de Prevención Diputación de Cádiz';
  const code = String(instructions).match(/\b\d{4,6}\s*(?:GR|EE)\b/i)?.[0]?.replace(/\s+/g,'').toUpperCase() || '';
  const rows: Appointment[] = [];
  for (let i = 0; i < count; i++) {
    const slot = Math.floor(i / perSlot);
    const value = Math.min(minutes(firstTime) + slot * interval, maxMinutes);
    rows.push({
      citaDia,
      citaHora: timeFromMinutes(value),
      sitioReconocimiento: site,
      numOferta: code,
      obra: '',
      diaComienzo: citaDia,
    });
  }
  return rows;
};

const normalizeSchedule = (
  raw: any,
  instructions: string,
  sites: string[],
  startHour: string,
  endHour: string,
): Appointment[] => {
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.schedule) ? raw.schedule : [];
  const expectedCount = parseExplicitCount(instructions);
  const fallbackDate = inferFallbackDate(instructions);
  const fallbackTime = inferFallbackTime(instructions, startHour);
  const fallbackSite = sites[0] || 'Centro de Prevención Diputación de Cádiz';

  let normalized = rows.map((item: any) => ({
    citaDia: isValidDate(item?.citaDia) ? item.citaDia : fallbackDate,
    citaHora: isValidTime(item?.citaHora) ? item.citaHora : fallbackTime,
    sitioReconocimiento: String(item?.sitioReconocimiento || fallbackSite).trim() || fallbackSite,
    obra: String(item?.obra || '').trim(),
    numOferta: String(item?.numOferta || '').trim(),
    quincena: String(item?.quincena || '').trim(),
    diaComienzo: isValidDate(item?.diaComienzo) ? item.diaComienzo : '',
    diaFinContrato: isValidDate(item?.diaFinContrato) ? item.diaFinContrato : '',
    diaContratacion: isValidDate(item?.diaContratacion) ? item.diaContratacion : '',
  })).filter((item: Appointment) => isValidDate(item.citaDia) && isValidTime(item.citaHora));

  if (expectedCount && normalized.length !== expectedCount) {
    const fallback = deterministicFallback(instructions, sites, startHour, endHour);
    if (normalized.length > expectedCount) normalized = normalized.slice(0, expectedCount);
    while (normalized.length < expectedCount) normalized.push(fallback[normalized.length] || fallback[fallback.length - 1]);
  }

  return normalized;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const instructions = String(body.instructions || '').trim();
    if (!instructions) return res.status(400).json({ error: 'Escriba las instrucciones para generar las citas.' });

    const savedSitios = Array.isArray(body.savedSitios)
      ? body.savedSitios.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : [];
    const defaultSite = String(body.defaultSite || '').trim();
    const sites = Array.from(new Set([defaultSite, ...savedSitios].filter(Boolean)));
    const startHour = isValidTime(body.workStartHour) ? body.workStartHour : '08:00';
    const endHour = isValidTime(body.workEndHour) ? body.workEndHour : '15:00';

    const now = new Date();
    const today = isoLocal(now);
    const currentWeekday = now.toLocaleDateString('es-ES', { weekday: 'long' });

    const schema = {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          citaDia: { type: 'string' },
          citaHora: { type: 'string' },
          sitioReconocimiento: { type: 'string' },
          obra: { type: 'string' },
          numOferta: { type: 'string' },
          quincena: { type: 'string' },
          diaComienzo: { type: 'string' },
          diaFinContrato: { type: 'string' },
          diaContratacion: { type: 'string' },
        },
        required: ['citaDia','citaHora','sitioReconocimiento','obra','numOferta','quincena','diaComienzo','diaFinContrato','diaContratacion'],
      },
    };

    const prompt = `Eres el planificador de CITAS DE RECONOCIMIENTO MÉDICO de GestionProfea.

HOY: ${currentWeekday} ${today}
HORARIO PERMITIDO: ${startHour}–${endHour}
CENTROS DISPONIBLES: ${sites.length ? sites.join(' | ') : 'Centro de Prevención Diputación de Cádiz'}

INSTRUCCIÓN DEL SUPERVISOR:
${instructions}

OBJETIVO:
Convierte la instrucción libre en una lista exacta de citas. Interpreta correctamente cantidades, fechas relativas (mañana, próximo lunes, este viernes), horas, agrupaciones ("de 2 en 2"), intervalos ("cada 10 minutos"), centro, localidad/obra, nº de oferta, quincena y fechas de comienzo/contratación/fin si se indican.

REGLAS OBLIGATORIAS:
1. Si el usuario indica N trabajadores/citas, devuelve EXACTAMENTE N objetos.
2. citaDia, diaComienzo, diaFinContrato y diaContratacion: YYYY-MM-DD o cadena vacía si no se indicó (excepto citaDia, que siempre debe existir).
3. citaHora: HH:MM 24 horas. No salgas del horario ${startHour}–${endHour}.
4. Si dice "de X en X cada Y minutos", X personas comparten hora y el siguiente grupo avanza Y minutos.
5. Usa literalmente el centro mencionado. Si no menciona ninguno, usa el primer CENTRO DISPONIBLE.
6. No inventes nombre de obra, nº de oferta, quincena o fechas contractuales. Si no aparecen, devuelve cadena vacía.
7. No incluyas nombres/DNI de trabajadores; estas citas son anónimas.
8. Devuelve solo JSON conforme al esquema.`;

    let raw: any;
    let provider = 'deterministic';
    try {
      raw = await callGateway(prompt, schema);
      provider = 'vercel-ai-gateway';
    } catch (gatewayError) {
      console.warn('[medical-appointments] AI Gateway no disponible:', gatewayError);
      try {
        raw = await callGemini(prompt, schema);
        provider = 'gemini';
      } catch (geminiError) {
        console.warn('[medical-appointments] Gemini no disponible, usando respaldo determinista:', geminiError);
        raw = deterministicFallback(instructions, sites, startHour, endHour);
      }
    }

    const schedule = normalizeSchedule(raw, instructions, sites, startHour, endHour);
    if (!schedule.length) {
      return res.status(422).json({ error: 'No se pudieron interpretar las instrucciones. Indique al menos fecha, cantidad y hora o centro.' });
    }

    return res.status(200).json({
      success: true,
      schedule,
      provider,
      interpretedCount: schedule.length,
    });
  } catch (error: any) {
    console.error('[medical-appointments]', error);
    return res.status(500).json({ error: error?.message || 'No se pudieron generar las citas automáticas.' });
  }
}
