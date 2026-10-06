import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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
  const value = process.env.TUTOR_CONFIRMATION_SECRET || process.env.GEMINI_API_KEY || "";
  if (!value) throw new Error("Las confirmaciones sensibles no están configuradas en el servidor.");
  return value;
}

function signConfirmation(payload: ConfirmationPayload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", confirmationSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readConfirmation(token: string): ConfirmationPayload {
  const [encoded, supplied] = String(token || "").split(".");
  if (!encoded || !supplied) throw new Error("Confirmación no válida.");
  const expected = createHmac("sha256", confirmationSecret()).update(encoded).digest("base64url");
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Confirmación no válida.");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ConfirmationPayload;
  if (payload.v !== 1 || payload.action !== "delete_mandatory_documents" || !payload.userId || !payload.obra || !Array.isArray(payload.ids)) {
    throw new Error("Confirmación no válida.");
  }
  if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) throw new Error("La confirmación ha caducado. Vuelve a preparar la operación.");
  return payload;
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

async function executeDataTool(call: TutorToolCall, context: TutorContext, token: string, requestId: string, userId: string): Promise<TutorToolResult> {
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
    case "list_mandatory_documents": {
      const obra = safeText(args.obra, 300) || context.obra || "";
      const periodo = safeText(args.periodo, 160) || context.periodo || "";
      const filters = [
        "select=id,obra,period_key,work_date,document_type,category,status,updated_at",
        obra ? `obra=eq.${encodeURIComponent(obra)}` : "",
        periodo ? `period_key=ilike.*${encodeURIComponent(periodo)}*` : "",
        "order=work_date.desc",
        "limit=200",
      ].filter(Boolean).join("&");
      const rows = await supabaseRequest(`/rest/v1/foreman_mandatory_documents?${filters}`, token);
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
      const rows = await supabaseRequest(
        "/rest/v1/inventory_items?select=id,park_id,codigo,categoria,nombre,marca,modelo,estado,ubicacion_actual,obra_actual_id,observaciones,updated_at&activo=eq.true&order=updated_at.desc&limit=500",
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
      if (!obra) return { name: call.name, ok: false, verified: true, summary: "Falta seleccionar la obra.", error: "OBRA_REQUIRED" };
      if (context.obra && obra.toLocaleLowerCase("es") !== context.obra.toLocaleLowerCase("es")) {
        return { name: call.name, ok: false, verified: true, summary: "La obra indicada ya no coincide con la obra activa.", error: "STALE_CONTEXT" };
      }
      const rows = await supabaseRequest(
        `/rest/v1/foreman_mandatory_documents?select=id,obra,period_key,work_date,document_type,category,status&obra=eq.${encodeURIComponent(obra)}&order=work_date.desc&limit=500`,
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
      return { name: call.name, ok: false, verified: true, summary: "Herramienta no autorizada.", error: "TOOL_NOT_ALLOWED" };
  }
}

export async function executeTutorTools(calls: TutorToolCall[], context: TutorContext, token: string, requestId: string, userQuestion = "", userId = "") {
  const results: TutorToolResult[] = [];
  for (const call of calls.slice(0, 4)) {
    try {
      if (call.name === "create_prevention_incident" && !/(registra|registrar|crea|crear|anota|anotar|guarda|guardar|abre|abrir).{0,40}(incidencia|riesgo)|incidencia.{0,40}(registra|crea|anota|guarda|abre)/i.test(userQuestion)) {
        results.push({ name: call.name, ok: false, verified: true, summary: "No se ejecutó porque la orden no contiene una petición explícita de crear la incidencia.", error: "EXPLICIT_MUTATION_REQUIRED" });
        continue;
      }
      results.push(await executeDataTool(call, context, token, requestId, userId));
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


export async function executeTutorConfirmation(input: {
  confirmationToken: string;
  context: TutorContext;
  token: string;
  userId: string;
}): Promise<TutorToolResult> {
  const payload = readConfirmation(input.confirmationToken);
  if (payload.userId !== input.userId) {
    return { name: payload.action, ok: false, verified: true, summary: "La confirmación pertenece a otra sesión.", error: "CONFIRMATION_USER_MISMATCH" };
  }
  if (!input.context.obra || payload.obra.toLocaleLowerCase("es") !== input.context.obra.toLocaleLowerCase("es")) {
    return { name: payload.action, ok: false, verified: true, summary: "La obra activa ha cambiado; la confirmación anterior queda invalidada.", error: "STALE_CONTEXT" };
  }

  const rows = await supabaseRequest(
    `/rest/v1/foreman_mandatory_documents?select=id,obra&id=in.(${payload.ids.map(encodeURIComponent).join(",")})&limit=500`,
    input.token,
  );
  const visibleIds = new Set((Array.isArray(rows) ? rows : []).filter((row: any) =>
    String(row.obra || "").toLocaleLowerCase("es") === payload.obra.toLocaleLowerCase("es")
  ).map((row: any) => String(row.id)));
  if (visibleIds.size !== payload.ids.length || payload.ids.some(id => !visibleIds.has(id))) {
    return { name: payload.action, ok: false, verified: true, summary: "El conjunto de documentos ha cambiado desde la confirmación. Vuelve a revisar el alcance.", error: "CONFIRMATION_SCOPE_CHANGED" };
  }

  const deleted = await supabaseRequest("/rest/v1/rpc/delete_foreman_mandatory_documents", input.token, {
    method: "POST",
    body: JSON.stringify({ p_ids: payload.ids, p_obra: null }),
  });
  const count = Number(deleted) || 0;
  if (count !== payload.ids.length) {
    return {
      name: payload.action,
      ok: false,
      verified: true,
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
