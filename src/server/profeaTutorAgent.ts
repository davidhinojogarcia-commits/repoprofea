import { createHash } from "node:crypto";

export type TutorContext = {
  currentView?: string;
  currentViewLabel?: string;
  guidedMode?: boolean;
  obra?: string;
  periodo?: string;
  documentId?: string;
  recordId?: string;
  filters?: Record<string, string>;
};

export type TutorToolCall = {
  name: string;
  arguments?: Record<string, unknown>;
};

export type TutorToolResult = {
  name: string;
  ok: boolean;
  verified: boolean;
  summary: string;
  data?: unknown;
  error?: string;
  clientAction?: {
    type: "navigate" | "apply_filters";
    view?: string;
    obra?: string;
    periodo?: string;
  };
};

export const TUTOR_AGENT_VERSION = "2026.10.06.1";

export const TUTOR_TOOL_CATALOG = [
  {
    name: "list_works",
    purpose: "Consultar las obras visibles para el usuario autenticado.",
    permissions: "RLS de obras + permiso de lectura del módulo.",
    confirmation: false,
    mutates: false,
    required: [],
  },
  {
    name: "search_workers",
    purpose: "Buscar trabajadores visibles por nombre, obra o periodo, sin enviar DNI al modelo.",
    permissions: "RLS de trabajadores + permiso de lectura del módulo.",
    confirmation: false,
    mutates: false,
    required: [],
  },
  {
    name: "list_pending_medical",
    purpose: "Consultar trabajadores visibles con reconocimiento pendiente en la obra/periodo indicado.",
    permissions: "RLS de trabajadores + permiso de lectura del módulo.",
    confirmation: false,
    mutates: false,
    required: [],
  },
  {
    name: "navigate",
    purpose: "Abrir una pantalla existente de GestionProfea.",
    permissions: "Solo vistas conocidas por la interfaz.",
    confirmation: false,
    mutates: false,
    required: ["view"],
  },
  {
    name: "apply_filters",
    purpose: "Aplicar filtros de obra y periodo en la interfaz del usuario.",
    permissions: "Solo contexto de interfaz; no modifica datos persistentes.",
    confirmation: false,
    mutates: false,
    required: [],
  },
  {
    name: "create_prevention_incident",
    purpose: "Crear una incidencia preventiva mediante el RPC real save_prevention_record.",
    permissions: "El RPC vuelve a validar sesión, obra y permisos en Supabase.",
    confirmation: false,
    mutates: true,
    required: ["obra", "workDate", "category", "severity", "title", "task", "description"],
  },
] as const;

const ALLOWED_VIEWS = new Set([
  "dashboard","calendario","registro","sae","directorio","estadisticas","citas",
  "documentacion_obra","documentacion_encargados","subcontratas","prevencion",
  "inventario","configuracion","papelera","administracion",
]);

const safeText = (value: unknown, max = 300) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export function normalizeTutorContext(raw: unknown): TutorContext {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const filters = value.filters && typeof value.filters === "object"
    ? Object.fromEntries(Object.entries(value.filters as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => [k.slice(0, 80), safeText(v, 180)]))
    : {};
  return {
    currentView: ALLOWED_VIEWS.has(safeText(value.currentView, 80)) ? safeText(value.currentView, 80) : "",
    currentViewLabel: safeText(value.currentViewLabel, 120),
    guidedMode: Boolean(value.guidedMode),
    obra: safeText(value.obra, 300),
    periodo: safeText(value.periodo, 160),
    documentId: safeText(value.documentId, 120),
    recordId: safeText(value.recordId, 120),
    filters,
  };
}

function deterministicUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8","9","a","b"][parseInt(hex[16], 16) % 4];
  const value = hex.join("");
  return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://oanurwzoymkmwmxoyzqi.supabase.co";
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  if (!url || !key) throw new Error("Supabase no está configurado para Tutor PROFEA en el servidor.");
  return { url: url.replace(/\/$/, ""), key };
}

async function supabaseRequest(path: string, token: string, init: RequestInit = {}) {
  const { url, key } = getSupabaseConfig();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${url}${path}`, { ...init, headers });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.error || `Supabase HTTP ${response.status}`;
    const error: any = new Error(String(message));
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function authenticateTutorRequest(authorizationHeader: string | undefined) {
  const token = String(authorizationHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("Sesión no disponible."), { status: 401 });
  const user = await supabaseRequest("/auth/v1/user", token);
  if (!user?.id) throw Object.assign(new Error("Sesión no válida."), { status: 401 });
  return { token, userId: String(user.id), email: safeText(user.email, 200) };
}

const rowWorker = (row: any) => ({
  id: row.id,
  nombre: row.apellidos_nombre || row.data?.apellidosNombre || "",
  obra: row.obra || row.data?.obra || "",
  periodo: row.quincena || row.data?.quincena || "",
  reconocimiento: row.reconocimiento_estado || row.aptitud_medica || row.data?.reconocimientoEstado || row.data?.aptitudMedica || "Pendiente",
  necesitaReconocimiento: row.necesita_reconocimiento || row.data?.necesitaReconocimiento || "",
  citaDia: row.cita_dia || row.data?.citaDia || "",
});

function matchesText(value: unknown, needle: string) {
  return String(value || "").toLocaleLowerCase("es").includes(needle.toLocaleLowerCase("es"));
}

async function executeDataTool(call: TutorToolCall, context: TutorContext, token: string, requestId: string): Promise<TutorToolResult> {
  const args = call.arguments || {};
  switch (call.name) {
    case "list_works": {
      const rows = await supabaseRequest("/rest/v1/obras?select=id,codigo,nombre,municipio&order=nombre.asc&limit=200", token);
      return { name: call.name, ok: true, verified: true, summary: `${rows?.length || 0} obras visibles.`, data: rows || [] };
    }
    case "search_workers": {
      const rows = await supabaseRequest("/rest/v1/trabajadores?select=id,obra,quincena,apellidos_nombre,necesita_reconocimiento,reconocimiento_estado,aptitud_medica,cita_dia,data&order=updated_at.desc&limit=250", token);
      const name = safeText(args.name, 180);
      const obra = safeText(args.obra, 300) || context.obra || "";
      const periodo = safeText(args.periodo, 160) || context.periodo || "";
      const filtered = (rows || []).map(rowWorker).filter((row: any) =>
        (!name || matchesText(row.nombre, name)) &&
        (!obra || row.obra === obra) &&
        (!periodo || row.periodo === periodo)
      ).slice(0, 80);
      return { name: call.name, ok: true, verified: true, summary: `${filtered.length} trabajadores encontrados con los filtros autorizados.`, data: filtered };
    }
    case "list_pending_medical": {
      const rows = await supabaseRequest("/rest/v1/trabajadores?select=id,obra,quincena,apellidos_nombre,necesita_reconocimiento,reconocimiento_estado,aptitud_medica,cita_dia,data&order=updated_at.desc&limit=300", token);
      const obra = safeText(args.obra, 300) || context.obra || "";
      const periodo = safeText(args.periodo, 160) || context.periodo || "";
      if (!periodo) return { name: call.name, ok: false, verified: true, summary: "Falta seleccionar un periodo.", error: "PERIODO_REQUIRED" };
      const filtered = (rows || []).map(rowWorker).filter((row: any) => {
        const status = String(row.reconocimiento || "").toLocaleLowerCase("es");
        const needs = String(row.necesitaReconocimiento || "").toLocaleLowerCase("es");
        const pending = status.includes("pend") || needs === "si" || needs === "sí" || needs === "true";
        return pending && (!obra || row.obra === obra) && row.periodo === periodo;
      }).slice(0, 100);
      return { name: call.name, ok: true, verified: true, summary: `${filtered.length} trabajadores con reconocimiento pendiente.`, data: filtered };
    }
    case "navigate": {
      const view = safeText(args.view, 80);
      if (!ALLOWED_VIEWS.has(view)) return { name: call.name, ok: false, verified: true, summary: "Pantalla no permitida.", error: "VIEW_NOT_ALLOWED" };
      return { name: call.name, ok: true, verified: true, summary: "Navegación preparada.", clientAction: { type: "navigate", view } };
    }
    case "apply_filters": {
      const obra = safeText(args.obra, 300);
      const periodo = safeText(args.periodo, 160);
      return { name: call.name, ok: true, verified: true, summary: "Filtros preparados.", clientAction: { type: "apply_filters", obra, periodo } };
    }
    case "create_prevention_incident": {
      const obra = safeText(args.obra, 300) || context.obra || "";
      if (!obra) return { name: call.name, ok: false, verified: true, summary: "Falta seleccionar la obra.", error: "OBRA_REQUIRED" };
      if (context.obra && obra !== context.obra) return { name: call.name, ok: false, verified: true, summary: "La obra de la orden ya no coincide con la obra activa.", error: "STALE_CONTEXT" };
      const workDate = safeText(args.workDate, 10);
      const category = safeText(args.category, 80);
      const severity = safeText(args.severity, 20);
      const title = safeText(args.title, 200);
      const task = safeText(args.task, 300);
      const description = safeText(args.description, 4000);
      const measures = safeText(args.measures, 4000);
      const responsible = safeText(args.responsible, 200);
      const deadline = safeText(args.deadline, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !category || !["low","medium","high"].includes(severity) || !title || !task || !description) {
        return { name: call.name, ok: false, verified: true, summary: "Faltan datos obligatorios de la incidencia.", error: "VALIDATION_ERROR" };
      }
      const id = deterministicUuid(`${requestId}:create_prevention_incident:${obra}:${title}`);
      const data = await supabaseRequest("/rest/v1/rpc/save_prevention_record", token, {
        method: "POST",
        body: JSON.stringify({
          p_id: id,
          p_data: { obra, kind: "incident", work_date: workDate, category, severity, title, task, description, measures, responsible, deadline: deadline || null, checks: {}, photo: null },
          p_token: null,
          p_expected_updated_at: null,
        }),
      });
      return { name: call.name, ok: true, verified: true, summary: "Incidencia creada y confirmada por la base de datos.", data: { id: data?.id || id, obra: data?.obra || obra, status: data?.status || "pending", updated_at: data?.updated_at || "" } };
    }
    default:
      return { name: call.name, ok: false, verified: true, summary: "Herramienta no autorizada.", error: "TOOL_NOT_ALLOWED" };
  }
}

export async function executeTutorTools(calls: TutorToolCall[], context: TutorContext, token: string, requestId: string, userQuestion = "") {
  const results: TutorToolResult[] = [];
  for (const call of calls.slice(0, 4)) {
    try {
      if (call.name === "create_prevention_incident" && !/(registra|registrar|crea|crear|anota|anotar|guarda|guardar|abre|abrir).{0,40}(incidencia|riesgo)|incidencia.{0,40}(registra|crea|anota|guarda|abre)/i.test(userQuestion)) {
        results.push({ name: call.name, ok: false, verified: true, summary: "No se ejecutó porque la orden no contiene una petición explícita de crear la incidencia.", error: "EXPLICIT_MUTATION_REQUIRED" });
        continue;
      }
      results.push(await executeDataTool(call, context, token, requestId));
    } catch (error: any) {
      results.push({ name: call.name, ok: false, verified: true, summary: "La operación no se pudo completar.", error: String(error?.message || error).slice(0, 500) });
    }
  }
  return results;
}

export function toolCatalogForPrompt() {
  return TUTOR_TOOL_CATALOG.map(tool => ({
    name: tool.name,
    purpose: tool.purpose,
    required: tool.required,
    confirmation: tool.confirmation,
    mutates: tool.mutates,
  }));
}
