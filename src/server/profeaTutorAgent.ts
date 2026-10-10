import { PREVENTION_CATEGORIES, preventionToday } from "../lib/prevention.js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getLocalTutorFallback, PROFEA_TUTOR_VIEW_LABELS } from "../lib/profeaTutorKnowledge.js";

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
  confirmation?: {
    token: string;
    action: string;
    title: string;
    recordsAffected: number;
    destination?: string;
    consequences: string;
  };
};

export const TUTOR_AGENT_VERSION = "2026.10.10.2";

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
  {
    name: "list_mandatory_documents",
    purpose: "Consultar documentos de Inicio y Control de presencia visibles y su estado real.",
    permissions: "RLS de documentación del supervisor.",
    confirmation: false,
    mutates: false,
    required: [],
  },
  {
    name: "prepare_inventory_fault_report",
    purpose: "Preparar un resumen verificable de maquinaria y herramientas con estado de avería o reparación.",
    permissions: "RLS y membresía de los parques de inventario visibles.",
    confirmation: false,
    mutates: false,
    required: [],
  },
  {
    name: "prepare_delete_mandatory_documents",
    purpose: "Calcular el alcance exacto antes de borrar documentos obligatorios de encargados de una obra.",
    permissions: "RLS de documentos del supervisor; esta herramienta no borra nada.",
    confirmation: true,
    mutates: false,
    required: ["obra"],
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

type ConfirmationPayload = {
  v: 1;
  action: "delete_mandatory_documents";
  userId: string;
  obra: string;
  ids: string[];
  exp: number;
};

function confirmationSecret() {
  const value = process.env.TUTOR_CONFIRMATION_SECRET || "";
  if (!value) throw new Error("Las confirmaciones sensibles no están configuradas en el servidor.");
  return value;
}

function signConfirmation(payload: ConfirmationPayload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", confirmationSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readConfirmation(token: string): ConfirmationPayload {
  const parts = String(token || "").split(".");
  const [encoded, supplied] = parts;
  if (parts.length !== 2 || !encoded || !supplied) throw new Error("Confirmación no válida.");
  const expected = createHmac("sha256", confirmationSecret()).update(encoded).digest("base64url");
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Confirmación no válida.");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ConfirmationPayload;
  if (payload.v !== 1 || payload.action !== "delete_mandatory_documents" || !payload.userId || !payload.obra || !Array.isArray(payload.ids) || !payload.ids.length || payload.ids.length > 10000 || payload.ids.some(id => !/^[0-9a-f-]{36}$/i.test(id)) || new Set(payload.ids).size !== payload.ids.length) {
    throw new Error("Confirmación no válida.");
  }
  if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) throw new Error("La confirmación ha caducado. Vuelve a preparar la operación.");
  return payload;
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://oanurwzoymkmwmxoyzqi.supabase.co";
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (!url || !key) throw Object.assign(new Error("Supabase no está configurado para Tutor PROFEA en el servidor."), { tutorDiagnostic: "CONFIG_MISSING" });
  return { url: url.replace(/\/$/, ""), key };
}

async function supabaseRequest(path: string, token: string, init: RequestInit = {}) {
  const { url, key } = getSupabaseConfig();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try { response = await fetch(`${url}${path}`, { ...init, headers }); }
  catch { throw Object.assign(new Error("Supabase no está disponible."), { tutorDiagnostic: "UPSTREAM_NETWORK" }); }
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.error || `Supabase HTTP ${response.status}`;
    const error: any = new Error(String(message));
    error.status = response.status;
    error.tutorDiagnostic = "UPSTREAM_HTTP";
    throw error;
  }
  return data;
}

export async function authenticateTutorRequest(authorizationHeader: string | undefined) {
  const token = /^Bearer\s+(.+)$/i.exec(String(authorizationHeader || ""))?.[1]?.trim() || "";
  if (!token) throw Object.assign(new Error("Sesión no disponible."), { status: 401 });
  let user: any;
  try { user = await supabaseRequest("/auth/v1/user", token); }
  catch (error: any) {
    // GoTrue may return 400 for malformed JWTs, not only 401 for expired tokens.
    if ([400, 401, 403, 422].includes(Number(error?.status))) throw Object.assign(new Error("Sesión no válida."), { status: 401 });
    throw error;
  }
  if (!user?.id) throw Object.assign(new Error("Sesión no válida."), { status: 401 });
  const profiles = await supabaseRequest(`/rest/v1/profiles?select=id,active,role&id=eq.${encodeURIComponent(user.id)}&limit=1`, token);
  if (!Array.isArray(profiles) || profiles.length !== 1 || profiles[0].active !== true) throw Object.assign(new Error("Cuenta no activa o no autorizada."), { status: 403 });
  return { token, userId: String(user.id), role: String(profiles[0].role), email: safeText(user.email, 200) };
}

const WORKER_FIELDS = "id,owner_id,obra,quincena,apellidos_nombre,necesita_reconocimiento,reconocimiento_estado,aptitud_medica,cita_dia,reconocimiento_validez,nombre_legacy:data->>apellidosNombre,obra_legacy:data->>obra,periodo_legacy:data->>quincena,estado_legacy:data->>reconocimientoEstado,aptitud_legacy:data->>aptitudMedica,necesita_legacy:data->>necesitaReconocimiento,cita_legacy:data->>citaDia,validez_legacy:data->>reconocimientoValidez";
const rowWorker = (row: any) => ({
  id: row.id,
  nombre: row.apellidos_nombre || row.nombre_legacy || "",
  obra: row.obra || row.obra_legacy || "",
  periodo: row.quincena || row.periodo_legacy || "",
  reconocimiento: row.reconocimiento_estado || row.aptitud_medica || row.estado_legacy || row.aptitud_legacy || "Pendiente",
  necesitaReconocimiento: row.necesita_reconocimiento ?? row.necesita_legacy ?? "",
  citaDia: row.cita_dia || row.cita_legacy || "",
  validez: row.reconocimiento_validez || row.validez_legacy || "",
});

// Stop explicitly rather than claim a complete count when the safety ceiling is reached.
async function readAllRows(path: string, token: string, maxRows = 10000): Promise<any[]> {
  const result: any[] = [];
  const seen = new Set<string>();
  const pageSize = 200;
  for (let offset = 0; offset <= maxRows; offset += pageSize) {
    const page = await supabaseRequest(`${path}&order=${path.includes("/trabajadores?") ? "owner_id.asc,id.asc" : "id.asc"}&limit=${pageSize}&offset=${offset}`, token);
    if (!Array.isArray(page)) throw new Error("La consulta no devolvió un listado válido.");
    for (const row of page) {
      const id = String(row.id || "");
      const identity = `${row.owner_id || ""}:${id}`;
      if (!id || seen.has(identity)) throw new Error("El listado cambió durante la consulta. Vuelve a intentarlo.");
      seen.add(identity); result.push(row);
    }
    if (result.length > maxRows) throw new Error("La consulta supera el límite seguro. Selecciona una obra y un periodo más concretos.");
    if (page.length < pageSize) return result;
  }
  throw new Error("No se pudo comprobar el listado completo.");
}

function postgrestValue(value: string) {
  return encodeURIComponent('"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"');
}
function workerPath(obra: string, periodo: string) {
  const filters = [obra ? `or=(obra.eq.${postgrestValue(obra)},and(obra.is.null,data->>obra.eq.${postgrestValue(obra)}),and(obra.eq."",data->>obra.eq.${postgrestValue(obra)}))` : "",
    periodo ? `or=(quincena.eq.${postgrestValue(periodo)},and(quincena.is.null,data->>quincena.eq.${postgrestValue(periodo)}),and(quincena.eq."",data->>quincena.eq.${postgrestValue(periodo)}))` : ""];
  // PostgREST combines repeated or keys ambiguously; nest both predicates under and.
  const groups = filters.filter(Boolean).map(value => value.slice(3));
  return `/rest/v1/trabajadores?select=${WORKER_FIELDS}${groups.length ? `&and=(${groups.map(group => 'or' + group).join(',')})` : ""}`;
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}

function matchesText(value: unknown, needle: string) {
  return String(value || "").toLocaleLowerCase("es").includes(needle.toLocaleLowerCase("es"));
}

async function executeDataTool(call: TutorToolCall, context: TutorContext, token: string, requestId: string, userId: string): Promise<TutorToolResult> {
  const args = call.arguments || {};
  switch (call.name) {
    case "list_works": {
      const rows = await readAllRows("/rest/v1/obras?select=id,codigo,nombre,municipio", token);
      return { name: call.name, ok: true, verified: true, summary: `${rows?.length || 0} obras visibles.`, data: rows || [] };
    }
    case "search_workers": {
      const name = safeText(args.name, 180);
      const obra = safeText(args.obra, 300) || context.obra || "";
      const periodo = safeText(args.periodo, 160) || context.periodo || "";
      const rows = await readAllRows(workerPath(obra, periodo), token);
      const filtered = rows.map(rowWorker).filter((row: any) =>
        (!name || matchesText(row.nombre, name)) &&
        (!obra || row.obra === obra) &&
        (!periodo || row.periodo === periodo)
      );
      return { name: call.name, ok: true, verified: true, summary: `${filtered.length} trabajadores encontrados con los filtros autorizados.`, data: filtered };
    }
    case "list_pending_medical": {
      const obra = safeText(args.obra, 300) || context.obra || "";
      const periodo = safeText(args.periodo, 160) || context.periodo || "";
      if (!periodo) return { name: call.name, ok: false, verified: false, summary: "Falta seleccionar un periodo.", error: "PERIODO_REQUIRED" };
      const rows = await readAllRows(workerPath(obra, periodo), token);
      const filtered = rows.map(rowWorker).filter((row: any) => {
        const status = String(row.reconocimiento || "").toLocaleLowerCase("es");
        const needs = String(row.necesitaReconocimiento || "").toLocaleLowerCase("es");
        const expired = validDate(row.validez) && row.validez < preventionToday();
        const pending = expired || status.includes("pend") || status.includes("caduc") || ((!status.includes("apto") || status.includes("no apto")) && ["si", "sí", "true"].includes(needs));
        return pending && (!obra || row.obra === obra) && row.periodo === periodo;
      });
      return { name: call.name, ok: true, verified: true, summary: `${filtered.length} trabajadores con reconocimiento pendiente.`, data: filtered };
    }
    case "navigate": {
      const view = safeText(args.view, 80);
      if (view === "administracion") {
        const auth = await authenticateTutorRequest(`Bearer ${token}`);
        if (auth.role !== "admin") return { name: call.name, ok: false, verified: false, summary: "Esta pantalla requiere una cuenta administradora.", error: "VIEW_NOT_AUTHORIZED" };
      }
      if (!ALLOWED_VIEWS.has(view)) return { name: call.name, ok: false, verified: false, summary: "Pantalla no permitida.", error: "VIEW_NOT_ALLOWED" };
      return { name: call.name, ok: true, verified: false, summary: "Se ha solicitado abrir la pantalla indicada.", clientAction: { type: "navigate", view } };
    }
    case "apply_filters": {
      const obra = safeText(args.obra, 300);
      const periodo = safeText(args.periodo, 160);
      return { name: call.name, ok: true, verified: false, summary: "Se ha solicitado aplicar los filtros indicados.", clientAction: { type: "apply_filters", obra, periodo } };
    }
    case "create_prevention_incident": {
      const obra = safeText(args.obra, 300) || context.obra || "";
      if (!obra) return { name: call.name, ok: false, verified: false, summary: "Falta seleccionar la obra.", error: "OBRA_REQUIRED" };
      if (context.obra && obra !== context.obra) return { name: call.name, ok: false, verified: false, summary: "La obra de la orden ya no coincide con la obra activa.", error: "STALE_CONTEXT" };
      const workDate = safeText(args.workDate, 10);
      const category = safeText(args.category, 80);
      const severity = safeText(args.severity, 20);
      const title = safeText(args.title, 200);
      const task = safeText(args.task, 300);
      const description = safeText(args.description, 4000);
      const measures = safeText(args.measures, 4000);
      const responsible = safeText(args.responsible, 200);
      const deadline = safeText(args.deadline, 10);
      if (!validDate(workDate) || workDate > preventionToday() || (deadline && !validDate(deadline)) || !PREVENTION_CATEGORIES.includes(category as any) || !["low","medium","high"].includes(severity) || !title || !task || !description) {
        return { name: call.name, ok: false, verified: false, summary: "Faltan datos obligatorios de la incidencia.", error: "VALIDATION_ERROR" };
      }
      const id = deterministicUuid(`${userId}:${requestId}:create_prevention_incident:${obra}:${title}`);
      const data = await supabaseRequest("/rest/v1/rpc/save_prevention_record", token, {
        method: "POST",
        body: JSON.stringify({
          p_id: id,
          p_data: { obra, kind: "incident", work_date: workDate, category, severity, title, task, description, measures, responsible, deadline: deadline || null, checks: {}, photo: null },
          p_token: null,
          p_expected_updated_at: null,
        }),
      });
      const expected = { id, obra, kind: "incident", work_date: workDate, category, severity, title, task, description, measures, responsible, deadline: deadline || null };
      const matchesRecord = (record: any) => record && Object.entries(expected).every(([key, value]) => record[key] === value) && record.status === "pending" && Boolean(record.updated_at);
      if (!matchesRecord(data)) throw new Error("No se recibió una confirmación válida del guardado. Comprueba Prevención antes de repetir.");
      const persisted = await supabaseRequest(`/rest/v1/prevention_records?select=id,obra,kind,work_date,category,severity,title,task,description,measures,responsible,deadline,status,updated_at&id=eq.${encodeURIComponent(id)}&limit=1`, token);
      if (!Array.isArray(persisted) || persisted.length !== 1 || !matchesRecord(persisted[0])) throw new Error("No se pudo verificar la persistencia de la incidencia. Comprueba Prevención antes de repetir.");
      return { name: call.name, ok: true, verified: true, summary: "Incidencia guardada y recuperada de la base de datos.", data: { id, obra, status: data.status, updated_at: data.updated_at } };
    }
    case "list_mandatory_documents": {
      const obra = safeText(args.obra, 300) || context.obra || "";
      const periodo = safeText(args.periodo, 160) || context.periodo || "";
      const filters = [
        "select=id,obra,period_key,work_date,document_type,category,status,updated_at",
        obra ? `obra=eq.${encodeURIComponent(obra)}` : "",
        periodo ? `period_key=ilike.*${encodeURIComponent(periodo)}*` : "",
        
      ].filter(Boolean).join("&");
      const rows = await readAllRows(`/rest/v1/foreman_mandatory_documents?${filters}`, token);
      const data = (Array.isArray(rows) ? rows : []).map((row: any) => ({
        id: row.id,
        obra: row.obra,
        periodo: row.period_key,
        fecha: row.work_date,
        tipo: row.document_type,
        categoria: row.category,
        estado: row.status,
        actualizado: row.updated_at,
      }));
      return { name: call.name, ok: true, verified: true, summary: `${data.length} documentos obligatorios visibles con esos filtros.`, data };
    }
    case "prepare_inventory_fault_report": {
      const rows = await readAllRows(
        "/rest/v1/inventory_items?select=id,park_id,codigo,categoria,nombre,marca,modelo,estado,ubicacion_actual,obra_actual_id,observaciones,updated_at&activo=eq.true",
        token,
      );
      const faultPattern = /(averiad|reparaci|taller|fuera de servicio|no disponible|incidencia|mantenimiento correctivo)/i;
      const data = (Array.isArray(rows) ? rows : []).filter((row: any) =>
        faultPattern.test(String(row.estado || "")) || faultPattern.test(String(row.observaciones || ""))
      ).map((row: any) => ({
        id: row.id,
        codigo: row.codigo,
        categoria: row.categoria,
        nombre: row.nombre,
        marca: row.marca,
        modelo: row.modelo,
        estado: row.estado,
        ubicacion: row.ubicacion_actual,
        obraId: row.obra_actual_id,
        observaciones: row.observaciones,
        actualizado: row.updated_at,
      }));
      return {
        name: call.name,
        ok: true,
        verified: true,
        summary: `Informe preparado con ${data.length} elementos visibles en avería, reparación o estado equivalente.`,
        data,
        clientAction: { type: "navigate", view: "inventario" },
      };
    }
    case "prepare_delete_mandatory_documents": {
      const obra = safeText(args.obra, 300) || context.obra || "";
      if (!obra) return { name: call.name, ok: false, verified: false, summary: "Falta seleccionar la obra.", error: "OBRA_REQUIRED" };
      if (context.obra && obra.toLocaleLowerCase("es") !== context.obra.toLocaleLowerCase("es")) {
        return { name: call.name, ok: false, verified: false, summary: "La obra indicada ya no coincide con la obra activa.", error: "STALE_CONTEXT" };
      }
      const rows = await readAllRows(
        `/rest/v1/foreman_mandatory_documents?select=id,obra,period_key,work_date,document_type,category,status&obra=eq.${postgrestValue(obra)}`,
        token,
      );
      const ids = (Array.isArray(rows) ? rows : []).map((row: any) => String(row.id || "")).filter(Boolean);
      if (!ids.length) {
        return { name: call.name, ok: true, verified: true, summary: "No hay documentos obligatorios visibles de esa obra para borrar.", data: [] };
      }
      const confirmation = signConfirmation({
        v: 1,
        action: "delete_mandatory_documents",
        userId,
        obra,
        ids,
        exp: Date.now() + 10 * 60 * 1000,
      });
      return {
        name: call.name,
        ok: true,
        verified: true,
        summary: `${ids.length} documentos quedarían afectados. No se ha borrado nada todavía.`,
        data: (rows || []).map((row: any) => ({
          id: row.id,
          tipo: row.document_type,
          periodo: row.period_key,
          fecha: row.work_date,
          estado: row.status,
        })),
        confirmation: {
          token: confirmation,
          action: "delete_mandatory_documents",
          title: `Borrar ${ids.length} documentos de ${obra}`,
          recordsAffected: ids.length,
          consequences: "Se crearán las marcas de borrado previstas por el flujo actual y los documentos dejarán de aparecer. La operación requiere esta confirmación exacta.",
        },
      };
    }
    default:
      return { name: call.name, ok: false, verified: false, summary: "Herramienta no autorizada.", error: "TOOL_NOT_ALLOWED" };
  }
}

export async function executeTutorTools(calls: TutorToolCall[], context: TutorContext, token: string, requestId: string, userQuestion = "", userId = "") {
  const results: TutorToolResult[] = [];
  for (const call of calls.slice(0, 4)) {
    try {
      if (call.name === "create_prevention_incident" && !hasExplicitIncidentIntent(userQuestion)) {
        results.push({ name: call.name, ok: false, verified: false, summary: "No se ejecutó porque la orden no contiene una petición explícita de crear la incidencia.", error: "EXPLICIT_MUTATION_REQUIRED" });
        continue;
      }
      results.push(await executeDataTool(call, context, token, requestId, userId));
    } catch (error: any) {
      results.push({ name: call.name, ok: false, verified: false, summary: "La operación no se pudo completar.", error: String(error?.message || error).slice(0, 500) });
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


export async function executeTutorConfirmation(input: {
  confirmationToken: string;
  context: TutorContext;
  token: string;
  userId: string;
}): Promise<TutorToolResult> {
  const payload = readConfirmation(input.confirmationToken);
  if (payload.userId !== input.userId) {
    return { name: payload.action, ok: false, verified: false, summary: "La confirmación pertenece a otra sesión.", error: "CONFIRMATION_USER_MISMATCH" };
  }
  if (!input.context.obra || payload.obra.toLocaleLowerCase("es") !== input.context.obra.toLocaleLowerCase("es")) {
    return { name: payload.action, ok: false, verified: false, summary: "La obra activa ha cambiado; la confirmación anterior queda invalidada.", error: "STALE_CONTEXT" };
  }

  const rows = await readAllRows(
    `/rest/v1/foreman_mandatory_documents?select=id,obra&obra=eq.${postgrestValue(payload.obra)}`,
    input.token,
  );
  const visibleIds = new Set((Array.isArray(rows) ? rows : []).filter((row: any) =>
    String(row.obra || "").toLocaleLowerCase("es") === payload.obra.toLocaleLowerCase("es")
  ).map((row: any) => String(row.id)));
  if (visibleIds.size !== payload.ids.length || payload.ids.some(id => !visibleIds.has(id))) {
    return { name: payload.action, ok: false, verified: false, summary: "El conjunto de documentos ha cambiado desde la confirmación. Vuelve a revisar el alcance.", error: "CONFIRMATION_SCOPE_CHANGED" };
  }

  const deleted = await supabaseRequest("/rest/v1/rpc/delete_foreman_mandatory_documents", input.token, {
    method: "POST",
    body: JSON.stringify({ p_ids: payload.ids, p_obra: null }),
  });
  const count = typeof deleted === "number" && Number.isInteger(deleted) ? deleted : -1;
  if (count !== payload.ids.length) {
    return {
      name: payload.action,
      ok: false,
      verified: false,
      summary: `La base de datos confirmó ${count} borrados de ${payload.ids.length}; revisa el estado antes de repetir.`,
      error: "PARTIAL_DELETE",
      data: { deleted: count, expected: payload.ids.length, obra: payload.obra },
    };
  }
  return {
    name: payload.action,
    ok: true,
    verified: true,
    summary: `${count} documentos de ${payload.obra} borrados y confirmados por la base de datos.`,
    data: { deleted: count, obra: payload.obra },
  };
}


export type TutorTaskStateInput = {
  title?: string;
  currentStep?: number;
  totalSteps?: number;
  status?: "idle" | "active" | "diagnostic" | "completed";
  nextAction?: string;
};

export type TutorLocalPlan = {
  answer: string;
  toolCalls: TutorToolCall[];
  suggestedView: string;
  followUps: string[];
  progressHint: string;
  taskTitle: string;
  currentStep: number;
  totalSteps: number;
  taskStatus: "idle" | "active" | "diagnostic" | "completed";
  nextAction: string;
  checkQuestion: string;
  checkOptions: string[];
  incidentForm?: boolean;
  incidentDefaults?: Record<string, string>;
};

const normalizeIntent = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();

const viewFromQuestion = (question: string) => {
  const q = normalizeIntent(question);
  const entries: Array<[RegExp, string]> = [
    [/\bsae\b|seleccion/, "sae"],
    [/directorio|trabajador/, "directorio"],
    [/reconocimiento|cita medica|aptitud/, "citas"],
    [/documentacion de encargados|control de presencia|inicio|firmas?/, "documentacion_encargados"],
    [/documentacion de obra|control horario|epis|formacion/, "documentacion_obra"],
    [/cae|subcontrat/, "subcontratas"],
    [/prevencion|incidencia|riesgo/, "prevencion"],
    [/inventario|maquinaria|herramienta/, "inventario"],
    [/configuracion/, "configuracion"],
    [/papelera/, "papelera"],
    [/administracion|auditoria/, "administracion"],
    [/resumen|menu inicial|inicio de la app/, "dashboard"],
  ];
  return entries.find(([pattern]) => pattern.test(q))?.[1] || "";
};

function hasExplicitIncidentIntent(question: string) {
  return /^(?:por favor[, ]+)?(?:registra|registrar|crea|crear|anota|anotar|guarda|guardar)\b.{0,40}\b(?:incidencia|riesgo)\b/i.test(question.trim()) && !/\b(no|nunca|cancelar|cancela)\b/i.test(question.split(/[;\n]/)[0]);
}

function labelledFields(question: string) {
  const fields: Record<string, string> = {};
  const pattern = /(?:^|[;\n])\s*(obra|periodo|período|fecha|categoria|categoría|prioridad|titulo|título|tarea|descripcion|descripción|medidas|responsable|plazo)\s*:\s*([^;\n]*)/gi;
  for (const match of question.matchAll(pattern)) {
    const key = normalizeIntent(match[1]);
    if (key in fields) throw new Error("Hay campos repetidos. Indica un único valor por campo.");
    fields[key] = match[2].trim();
  }
  return fields;
}

export function planTutorRequestLocal(
  question: string,
  context: TutorContext,
  taskState: TutorTaskStateInput = {},
): TutorLocalPlan {
  const q = normalizeIntent(question);
  const fallback = getLocalTutorFallback(question, context.currentView);
  const plan: TutorLocalPlan = {
    answer: fallback.answer,
    toolCalls: [],
    suggestedView: fallback.view || "",
    followUps: ["¿Cuál es el siguiente paso?", "Explícame qué debo comprobar ahora"],
    progressHint: "",
    taskTitle: String(taskState.title || ""),
    currentStep: Math.max(0, Number(taskState.currentStep) || 0),
    totalSteps: Math.max(0, Number(taskState.totalSteps) || 0),
    taskStatus: taskState.status || "idle",
    nextAction: String(taskState.nextAction || ""),
    checkQuestion: "",
    checkOptions: [],
  };

  if (/^(aplica|aplicar|filtra|filtrar|cambia|cambiar|selecciona|seleccionar)\b/.test(q) && /(filtro|obra|periodo)/.test(q)) {
    let fields: Record<string, string>;
    try { fields = labelledFields(question); } catch (error: any) { return { ...plan, answer: error.message, taskStatus: "diagnostic" }; }
    const obra = fields.obra ?? (/esta obra/.test(q) ? context.obra : "");
    const periodo = fields.periodo ?? (/periodo activo|este periodo/.test(q) ? context.periodo : "");
    if (!obra && !periodo) return { ...plan, answer: "Indica los filtros así: Aplica filtros; obra: nombre exacto; periodo: periodo exacto. También puedes usar esta obra o este periodo.", taskStatus: "diagnostic" };
    return { ...plan, answer: "Voy a aplicar los filtros indicados.", toolCalls: [{ name: "apply_filters", arguments: { obra, periodo } }], taskTitle: "Aplicar filtros", taskStatus: "active" };
  }

  if (hasExplicitIncidentIntent(question)) {
    let fields: Record<string, string>;
    try { fields = labelledFields(question); } catch (error: any) { return { ...plan, answer: error.message, taskStatus: "diagnostic", incidentForm: true }; }
    const severity = ({ baja: "low", media: "medium", alta: "high", low: "low", medium: "medium", high: "high" } as Record<string, string>)[normalizeIntent(fields.prioridad || "")];
    const category = PREVENTION_CATEGORIES.find(item => normalizeIntent(item) === normalizeIntent(fields.categoria || ""));
    const args = { obra: fields.obra || context.obra || "", workDate: fields.fecha || "", category: category || "", severity: severity || "", title: fields.titulo || "", task: fields.tarea || "", description: fields.descripcion || "", measures: fields.medidas || "", responsible: fields.responsable || "", deadline: fields.plazo || "" };
    const missing = Object.entries({ obra: args.obra, fecha: args.workDate, categoría: args.category, prioridad: args.severity, título: args.title, tarea: args.task, descripción: args.description }).filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) return { ...plan, answer: `Para registrar la incidencia faltan: ${missing.join(", ")}. Completa el formulario y pulsa Registrar incidencia.`, incidentForm: true, incidentDefaults: fields, taskTitle: "Registrar incidencia preventiva", taskStatus: "diagnostic" };
    return { ...plan, incidentForm: true, incidentDefaults: fields, toolCalls: [{ name: "create_prevention_incident", arguments: args }], answer: "Voy a registrar y comprobar la incidencia indicada.", suggestedView: "prevencion", taskTitle: "Registrar incidencia preventiva", taskStatus: "active" };
  }

  if (/\b(lista|listar|muestra|mostrar|consulta|consultar|que obras|mis obras)\b/.test(q) && /obra/.test(q)) {
    plan.toolCalls = [{ name: "list_works" }];
    plan.answer = "Voy a consultar las obras que tienes visibles.";
    plan.taskTitle = "Consultar obras";
    plan.taskStatus = "active";
    return plan;
  }

  if (/reconocimiento/.test(q) && /(pendiente|pendientes|sin cita|faltan)/.test(q)) {
    plan.toolCalls = [{ name: "list_pending_medical", arguments: { obra: context.obra || "", periodo: context.periodo || "" } }];
    plan.answer = context.periodo
      ? "Voy a comprobar los reconocimientos pendientes del periodo activo."
      : "Para consultar pendientes necesito que selecciones primero un periodo.";
    plan.suggestedView = "citas";
    plan.taskTitle = "Revisar reconocimientos pendientes";
    plan.taskStatus = context.periodo ? "active" : "diagnostic";
    plan.nextAction = context.periodo ? "Revisar el resultado de la consulta." : "Selecciona el periodo en la app.";
    return plan;
  }

  if (/(busca|buscar|encuentra|localiza|consulta)/.test(q) && /trabajador/.test(q)) {
    const name = question.match(/trabajador(?:a)?\s+(.+?)(?:\s+en\s+|$)/i)?.[1]?.trim() || "";
    plan.toolCalls = [{ name: "search_workers", arguments: { name, obra: context.obra || "", periodo: context.periodo || "" } }];
    plan.answer = "Voy a buscar trabajadores visibles con el contexto actual.";
    plan.suggestedView = "directorio";
    plan.taskTitle = "Buscar trabajador";
    plan.taskStatus = "active";
    return plan;
  }

  if (/(borra|borrar|elimina|eliminar)/.test(q) && /document/.test(q) && /(obra|esta obra)/.test(q)) {
    if (!context.obra) {
      plan.answer = "Antes de preparar el borrado debes seleccionar una obra concreta. No voy a adivinarla.";
      plan.suggestedView = "documentacion_encargados";
      plan.taskTitle = "Borrar documentos de una obra";
      plan.taskStatus = "diagnostic";
      plan.nextAction = "Selecciona la obra y vuelve a indicar el borrado.";
      return plan;
    }
    plan.toolCalls = [{ name: "prepare_delete_mandatory_documents", arguments: { obra: context.obra } }];
    plan.answer = "Voy a calcular el alcance exacto. Todavía no se borrará nada.";
    plan.suggestedView = "documentacion_encargados";
    plan.taskTitle = "Borrar documentos de una obra";
    plan.taskStatus = "active";
    return plan;
  }

  if (/document/.test(q) && /(inicio|control de presencia|encargad|obligatori)/.test(q) && /(lista|muestra|consulta|estado|pendiente)/.test(q)) {
    plan.toolCalls = [{ name: "list_mandatory_documents", arguments: { obra: context.obra || "", periodo: context.periodo || "" } }];
    plan.answer = "Voy a consultar el estado real de los documentos visibles.";
    plan.suggestedView = "documentacion_encargados";
    plan.taskTitle = "Consultar documentación de encargados";
    plan.taskStatus = "active";
    return plan;
  }

  if (/(maquinaria|herramienta|inventario)/.test(q) && /(averia|averiad|reparacion|taller|incidencia)/.test(q)) {
    plan.toolCalls = [{ name: "prepare_inventory_fault_report" }];
    plan.answer = "Voy a preparar el estado verificable de equipos con avería o reparación.";
    plan.suggestedView = "inventario";
    plan.taskTitle = "Revisar maquinaria averiada";
    plan.taskStatus = "active";
    return plan;
  }

  if (/^(abre|abrir|ve a|ir a|llevame|ll[eé]vame|entra en)/.test(q)) {
    const view = viewFromQuestion(question);
    if (view) {
      plan.toolCalls = [{ name: "navigate", arguments: { view } }];
      plan.answer = `Voy a abrir ${PROFEA_TUTOR_VIEW_LABELS[view as keyof typeof PROFEA_TUTOR_VIEW_LABELS] || view}.`;
      plan.suggestedView = view;
      plan.taskTitle = "Navegar por GestionProfea";
      plan.taskStatus = "active";
      return plan;
    }
  }

  if (taskState.status === "active" && /^(siguiente|continua|continúa|ya esta|ya está|hecho)$/.test(q)) {
    plan.taskStatus = "active";
    plan.currentStep = Math.max(1, Number(taskState.currentStep) || 1) + 1;
    plan.answer = "Continúo desde el punto en el que estabas. " + fallback.answer;
  }
  return plan;
}

export function composeTutorResponseLocal(
  plan: TutorLocalPlan,
  results: TutorToolResult[],
): TutorLocalPlan {
  if (!results.length) return plan;
  const failed = results.find(result => !result.ok);
  const confirmation = results.find(result => result.confirmation)?.confirmation;
  const summaries = results.map(result => result.summary).filter(Boolean);

  if (failed) {
    return {
      ...plan,
      answer: failed.summary || "La operación no se pudo completar.",
      taskStatus: "diagnostic",
      nextAction: "Revisa el dato indicado y vuelve a intentarlo.",
      checkQuestion: "¿Quieres que te guíe para corregirlo?",
      checkOptions: ["Sí", "Volver al módulo", "Cancelar"],
    };
  }

  if (confirmation) {
    return {
      ...plan,
      answer: `${summaries.join(" ")} Revisa el alcance y confirma solo si quieres ejecutar el borrado.`,
      taskStatus: "active",
      nextAction: "Revisar y confirmar el alcance del borrado.",
      checkQuestion: "¿Confirmas este alcance?",
      checkOptions: ["Confirmar", "Cancelar"],
    };
  }

  let detail = "";
  const firstData = results[0]?.data;
  if (Array.isArray(firstData) && firstData.length) {
    detail = firstData.slice(0, 8).map((item: any) => {
      if (item?.nombre) return item.obra ? `${item.nombre} · ${item.obra}` : String(item.nombre);
      if (item?.codigo || item?.nombre) return [item.codigo, item.nombre, item.estado].filter(Boolean).join(" · ");
      if (item?.tipo || item?.periodo) return [item.tipo, item.periodo, item.estado].filter(Boolean).join(" · ");
      return "";
    }).filter(Boolean).join("\n");
  }

  return {
    ...plan,
    answer: [summaries.join(" "), detail].filter(Boolean).join("\n"),
    taskStatus: "completed",
    incidentForm: false,
    nextAction: "",
    checkQuestion: "",
    checkOptions: [],
    followUps: ["Abrir el módulo relacionado", "Hacer otra consulta"],
  };
}

