/** Server command policy. No sanctions, hiring decisions or external sends. */
export const PART_REASONS = [
  ["mobile", "Uso indebido del teléfono móvil", false],
  ["instructions", "Incumplimiento de instrucciones laborales", false],
  ["safety", "Incumplimiento de medidas preventivas", true],
  ["ppe", "Uso incorrecto o ausencia de EPI", true],
  ["absence", "Ausencia injustificada del puesto", false],
  ["punctuality", "Incidencias de puntualidad", false],
  ["equipment", "Uso no autorizado de herramientas o maquinaria", true],
  ["interference", "Conductas que interfieren con los trabajos", false],
  ["other", "Otras incidencias", false],
] as const;
export type PartKind = "service" | "incident";
export type PartStatus =
  | "draft"
  | "submitted"
  | "review"
  | "returned"
  | "archived"
  | "dismissed"
  | "authorized"
  | "pending_delivery"
  | "communicated"
  | "unproven_delivery"
  | "closed"
  | "elevated"
  | "annulled";
export const PART_STATUS: Record<PartStatus, string> = {
  draft: "Borrador",
  submitted: "Enviado al supervisor",
  review: "En revisión",
  returned: "Devuelto",
  archived: "Archivado",
  dismissed: "Desestimado",
  authorized: "Autorizado",
  pending_delivery: "Pendiente de comunicación",
  communicated: "Comunicado",
  unproven_delivery: "Entrega no acreditada",
  closed: "Cerrado",
  elevated: "Elevado",
  annulled: "Anulado mediante rectificación",
};
export const RECEIPT_LABELS = {
  received: "Recibido sin observaciones",
  observations: "Recibido con observaciones",
  disagreement: "Recibido con disconformidad",
  refused: "Negativa a firmar",
  not_delivered: "Entrega no realizada",
} as const;
export const PART_ACTION_LABELS: Record<string, string> = {
  create: "Borrador registrado",
  edit: "Nueva versión",
  submit: "Declaración firmada",
  review: "Inicio de revisión",
  return: "Devolución para corrección",
  information: "Solicitud de información",
  authorize: "Comunicación autorizada",
  archive: "Archivo motivado",
  dismiss: "Desestimación motivada",
  receipt: "Constancia de entrega",
  close: "Seguimiento cerrado",
  elevate: "Propuesta de elevación",
  remit: "Constancia de remisión",
  annul: "Anulación trazable",
  compare: "Revisión de comparabilidad",
  block: "Bloqueo por conservación",
  "resolve-dispute": "Revisión de disconformidad",
};
export type PartActor = {
  id: string;
  name: string;
  role: "foreman" | "supervisor" | "worker";
  method: "worksite_access" | "supabase_session" | "assisted_receipt";
};
export type PartAsset = {
  id: string;
  sha256: string;
  mime: string;
  bytes: number;
  name: string;
};
export type PartContent = {
  reason: string;
  occurredAt: string;
  place: string;
  facts: string;
  instruction: string;
  response: string;
  witnesses: string;
  priority: "ordinary" | "urgent";
  risk: boolean;
  uncertain: boolean;
  attachments: PartAsset[];
};
export type PartSignature = {
  asset: PartAsset;
  actor: PartActor;
  at: string;
  version: number;
  revision: number;
  contentHash: string;
  purpose: "declaration" | "review" | "receipt";
  capturedBy?: PartActor;
};
export type ReceiptMode =
  "received" | "observations" | "disagreement" | "refused" | "not_delivered";
export type PartRecord = {
  id: string;
  number: string;
  ownerId: string;
  work: string;
  worksite: { id: string; code: string; name: string; municipality: string };
  workerId: number;
  worker: {
    name: string;
    category: string;
    periodStart: string;
    periodEnd: string;
  };
  foremanAccessId: string;
  foremanName: string;
  kind: PartKind;
  status: PartStatus;
  revision: number;
  version: number;
  contentHash: string;
  content: PartContent;
  createdAt: string;
  updatedAt: string;
  foremanSignature?: PartSignature;
  supervisorSignature?: PartSignature;
  receipt?: {
    mode: ReceiptMode;
    note: string;
    witnesses: string;
    otherChannel: string;
    at: string;
    actor: PartActor;
    signature?: PartSignature;
  };
  decision?: { action: string; reason: string; at: string; actor: PartActor };
  comparableIds: string[];
  comparison?: Array<{ id: string; revision: number }>;
  receiptReview?: { signature: PartSignature; reason: string };
  elevation?: {
    reason: string;
    authority: string;
    recordIds: string[];
    at: string;
    actor: PartActor;
    signature: PartSignature;
    references?: Array<{
      id: string;
      revision: number;
      number: string;
      work: string;
      version: number;
      contentHash: string;
      content: PartContent;
      receiptMode?: ReceiptMode;
    }>;
    remittedAt?: string;
    channel?: string;
  };
  blockedAt?: string;
};
export type PartPolicy = {
  employer: string;
  agreement: string;
  reviewedBy: string;
  reviewedAt: string;
  windowDays: number;
  retentionDays: number;
  legalBasis: string;
  authority: string;
  reasons: Array<{ id: string; label: string; requiresReview: boolean }>;
};
export type PartCommand = {
  type:
    | "edit"
    | "submit"
    | "review"
    | "return"
    | "information"
    | "authorize"
    | "archive"
    | "dismiss"
    | "receipt"
    | "close"
    | "elevate"
    | "remit"
    | "annul"
    | "compare"
    | "block"
    | "resolve-dispute";
  content?: PartContent;
  kind?: PartKind;
  signature?: PartAsset;
  contentHash?: string;
  reason?: string;
  mode?: ReceiptMode;
  note?: string;
  witnesses?: string;
  channel?: string;
  authority?: string;
  recordIds?: string[];
  acknowledged?: boolean;
};
export const partFail = (message: string, status = 409) =>
  Object.assign(new Error(message), {
    status,
    code: status === 403 ? "PART_ACCESS_DENIED" : "PART_CONFLICT",
  });
export function validatePartContent(
  value: PartContent,
  complete = false,
  policy?: PartPolicy | null,
): PartContent {
  if (!value || typeof value !== "object")
    throw partFail("Revisa el contenido del parte.", 400);
  const out = {} as PartContent;
  for (const [key, max] of Object.entries({
    reason: 80,
    occurredAt: 40,
    place: 200,
    facts: 6000,
    instruction: 2000,
    response: 2000,
    witnesses: 1500,
  })) {
    if (
      typeof (value as any)[key] !== "string" ||
      (value as any)[key].length > max
    )
      throw partFail("Hay un campo no válido o demasiado largo.", 400);
    (out as any)[key] = (value as any)[key].trim();
  }
  const reasons =
    policy?.reasons ||
    PART_REASONS.map(([id, label, requiresReview]) => ({
      id,
      label,
      requiresReview,
    }));
  if (!reasons.some((r) => r.id === out.reason))
    throw partFail("Selecciona un motivo vigente.", 400);
  if (
    !["ordinary", "urgent"].includes(value.priority) ||
    typeof value.risk !== "boolean" ||
    typeof value.uncertain !== "boolean"
  )
    throw partFail("Revisa la prioridad y las circunstancias.", 400);
  if (!Array.isArray(value.attachments) || value.attachments.length > 4)
    throw partFail("Máximo cuatro anexos.", 400);
  out.priority = value.priority;
  out.risk = value.risk;
  out.uncertain = value.uncertain;
  out.attachments = value.attachments.map((a) => {
    if (
      !a ||
      !uuid(a.id) ||
      !/^[a-f0-9]{64}$/.test(a.sha256) ||
      !["application/pdf", "image/jpeg", "image/png"].includes(a.mime) ||
      !Number.isInteger(a.bytes) ||
      a.bytes < 1 ||
      a.bytes > 1500000 ||
      typeof a.name !== "string" ||
      a.name.length > 160
    )
      throw partFail("Anexo no válido.", 400);
    return {
      id: a.id,
      sha256: a.sha256,
      mime: a.mime,
      bytes: a.bytes,
      name: a.name,
    };
  });
  if (
    out.occurredAt &&
    (!Number.isFinite(Date.parse(out.occurredAt)) ||
      !/(Z|[+-]\d\d:\d\d)$/.test(out.occurredAt))
  )
    throw partFail("La fecha debe incluir la zona horaria.", 400);
  if (out.occurredAt) {
    const [year, month, day] = out.occurredAt
      .slice(0, 10)
      .split("-")
      .map(Number);
    if (
      new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !==
      out.occurredAt.slice(0, 10)
    )
      throw partFail("La fecha del hecho no es válida.", 400);
    out.occurredAt = new Date(out.occurredAt).toISOString();
  }
  if (
    complete &&
    (!out.occurredAt || !out.place || !out.facts || !out.instruction)
  )
    throw partFail("Completa fecha, lugar, hechos e instrucción.", 400);
  return out;
}
export const uuid = (s: unknown): s is string =>
  typeof s === "string" &&
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);
export function needsPartReview(
  content: PartContent,
  policy: PartPolicy | null,
  comparableCount = 0,
) {
  return (
    content.risk ||
    content.uncertain ||
    content.priority === "urgent" ||
    comparableCount > 0 ||
    (
      policy?.reasons ||
      PART_REASONS.map(([id, label, requiresReview]) => ({
        id,
        label,
        requiresReview,
      }))
    ).some((r) => r.id === content.reason && r.requiresReview)
  );
}
export function eligiblePart(
  p: PartRecord,
  target: PartRecord,
  policy: PartPolicy | null,
  now: string,
) {
  return (
    !!policy &&
    policy.windowDays > 0 &&
    p.id !== target.id &&
    p.ownerId === target.ownerId &&
    p.worksite.id === target.worksite.id &&
    p.workerId === target.workerId &&
    p.content.reason === target.content.reason &&
    !p.blockedAt &&
    !!p.receipt?.signature &&
    (p.receipt.mode !== "disagreement" || !!p.receiptReview) &&
    ["communicated", "closed", "elevated"].includes(p.status) &&
    Date.parse(p.content.occurredAt) >=
      Date.parse(now) - policy.windowDays * 86400000 &&
    Date.parse(p.content.occurredAt) <= Date.parse(now)
  );
}
export function applyPartCommand(
  record: PartRecord,
  command: PartCommand,
  ctx: {
    actor: PartActor;
    now: string;
    policy: PartPolicy | null;
    comparableCount: number;
  },
): PartRecord {
  const p = structuredClone(record),
    c = command,
    a = ctx.actor;
  if (p.blockedAt)
    throw partFail(
      "Registro bloqueado por conservación; consulta al responsable.",
      403,
    );
  const supervisor = () => {
    if (a.role !== "supervisor")
      throw partFail("Esta decisión corresponde al supervisor.", 403);
  };
  const foreman = () => {
    if (a.role !== "foreman" || a.id !== p.foremanAccessId)
      throw partFail(
        "El acceso no corresponde al encargado de este registro.",
        403,
      );
  };
  const state = (...allowed: PartStatus[]) => {
    if (!allowed.includes(p.status))
      throw partFail("El estado ha cambiado. Actualiza antes de continuar.");
  };
  const sign = (purpose: PartSignature["purpose"]): PartSignature => {
    if (
      c.acknowledged !== true ||
      c.contentHash !== p.contentHash ||
      !c.signature ||
      !uuid(c.signature.id) ||
      c.signature.mime !== "image/png"
    )
      throw partFail("Revisa la versión y realiza una firma nueva.");
    return {
      asset: c.signature,
      actor: a,
      at: ctx.now,
      version: p.version,
      revision: p.revision,
      contentHash: p.contentHash,
      purpose,
    };
  };
  const decision = () => {
    if (!c.reason?.trim() || c.reason.length > 2000)
      throw partFail("Indica el motivo de la decisión.", 400);
    p.decision = {
      action: c.type,
      reason: c.reason.trim(),
      at: ctx.now,
      actor: a,
    };
  };
  switch (c.type) {
    case "edit":
      state("draft", "returned");
      if (c.kind !== "service" && c.kind !== "incident")
        throw partFail("Tipo de registro no válido.", 400);
      if (a.role === "foreman") foreman();
      if (
        a.role === "supervisor" &&
        p.kind === "incident" &&
        c.kind === "service"
      )
        decision();
      if (
        a.role === "foreman" &&
        ((p.content.risk && !c.content?.risk) ||
          (p.kind === "incident" && c.kind === "service"))
      )
        throw partFail(
          "Una incidencia crítica o elevada requiere revisión para reclasificarse.",
        );
      p.content = validatePartContent(c.content!, false, ctx.policy);
      p.kind =
        c.kind === "incident" ||
        needsPartReview(p.content, ctx.policy, ctx.comparableCount)
          ? "incident"
          : "service";
      p.version++;
      delete p.foremanSignature;
      delete p.supervisorSignature;
      delete p.receipt;
      p.comparableIds = [];
      delete p.comparison;
      delete p.receiptReview;
      p.status = a.role === "supervisor" ? "returned" : "draft";
      break;
    case "submit":
      foreman();
      state("draft", "returned");
      validatePartContent(p.content, true, ctx.policy);
      if (
        needsPartReview(p.content, ctx.policy, ctx.comparableCount) &&
        p.kind !== "incident"
      )
        throw partFail(
          "Se requiere revisión del supervisor. Guarda el borrador como parte de incidencia y vuelve a firmar.",
        );
      p.foremanSignature = sign("declaration");
      p.status = p.kind === "service" ? "pending_delivery" : "submitted";
      break;
    case "review":
      supervisor();
      state("submitted");
      p.status = "review";
      break;
    case "return":
    case "information":
      supervisor();
      state("submitted", "review", "authorized", "pending_delivery");
      decision();
      p.status = c.type === "return" ? "returned" : "review";
      delete p.supervisorSignature;
      break;
    case "authorize":
      supervisor();
      state("submitted", "review");
      if (p.receipt)
        throw partFail(
          "Revisa las observaciones de recepción mediante su actuación específica.",
        );
      if (
        p.kind !== "incident" ||
        !p.foremanSignature ||
        p.foremanSignature.contentHash !== p.contentHash
      )
        throw partFail("Falta la declaración del encargado de esta versión.");
      p.supervisorSignature = sign("review");
      p.status = "pending_delivery";
      break;
    case "archive":
    case "dismiss":
      supervisor();
      state(
        "submitted",
        "review",
        "returned",
        "pending_delivery",
        "communicated",
        "unproven_delivery",
        "closed",
      );
      decision();
      p.status = c.type === "dismiss" ? "dismissed" : "archived";
      break;
    case "receipt":
      foreman();
      state("pending_delivery", "authorized", "unproven_delivery");
      if (c.acknowledged !== true)
        throw partFail("Confirma la actuación de entrega.", 400);
      if (
        !p.foremanSignature ||
        (p.kind === "incident" && !p.supervisorSignature)
      )
        throw partFail("Falta la autorización firmada.");
      if (
        ![
          "received",
          "observations",
          "disagreement",
          "refused",
          "not_delivered",
        ].includes(c.mode!)
      )
        throw partFail("Selecciona el resultado de entrega.", 400);
      if (c.mode !== "received" && !c.note?.trim())
        throw partFail(
          "Describe las observaciones o la incidencia de entrega.",
          400,
        );
      if (
        (c.note || "").length > 3000 ||
        (c.witnesses || "").length > 1500 ||
        (c.channel || "").length > 300
      )
        throw partFail("La constancia es demasiado larga.", 400);
      p.receipt = {
        mode: c.mode!,
        note: c.note || "",
        witnesses: c.witnesses || "",
        otherChannel: c.channel || "",
        at: ctx.now,
        actor: a,
      };
      if (["received", "observations", "disagreement"].includes(c.mode!)) {
        const signature = sign("receipt");
        signature.capturedBy = a;
        signature.actor = {
          id: `worker:${p.workerId}`,
          name: p.worker.name,
          role: "worker",
          method: "assisted_receipt",
        };
        p.receipt.signature = signature;
        p.status = c.mode === "disagreement" ? "review" : "communicated";
      } else {
        if (c.signature)
          throw partFail(
            "Una negativa o entrega fallida no puede incluir firma del trabajador.",
            400,
          );
        p.status = "unproven_delivery";
      }
      break;
    case "resolve-dispute":
      supervisor();
      state("review");
      if (p.receipt?.mode !== "disagreement")
        throw partFail("No hay una disconformidad pendiente.");
      decision();
      p.receiptReview = { signature: sign("review"), reason: c.reason! };
      p.status = "communicated";
      break;
    case "compare":
      supervisor();
      state("submitted", "review", "communicated", "closed");
      decision();
      if (
        !ctx.policy ||
        !Array.isArray(c.recordIds) ||
        c.recordIds.length > 20 ||
        c.recordIds.some((id) => !uuid(id))
      )
        throw partFail("Valida la política y los antecedentes comparables.");
      p.comparableIds = [...new Set(c.recordIds)];
      break;
    case "elevate":
      supervisor();
      state(
        "submitted",
        "review",
        "communicated",
        "closed",
        "unproven_delivery",
      );
      decision();
      if (!c.authority?.trim() || c.authority.length > 300)
        throw partFail(
          "Identifica el órgano destinatario para valoración.",
          400,
        );
      p.elevation = {
        reason: c.reason!,
        authority: c.authority.trim(),
        recordIds: [p.id, ...p.comparableIds],
        at: ctx.now,
        actor: a,
        signature: sign("review"),
      };
      p.status = "elevated";
      break;
    case "remit":
      supervisor();
      state("elevated");
      decision();
      if (c.acknowledged !== true || !c.channel?.trim())
        throw partFail(
          "Registra el canal verificado y la referencia de remisión.",
          400,
        );
      p.elevation!.remittedAt = ctx.now;
      p.elevation!.channel = c.channel.slice(0, 500);
      break;
    case "close":
      supervisor();
      state("communicated", "unproven_delivery", "elevated");
      decision();
      p.status = "closed";
      break;
    case "annul":
      supervisor();
      state(
        "submitted",
        "review",
        "returned",
        "pending_delivery",
        "communicated",
        "unproven_delivery",
        "closed",
        "elevated",
        "archived",
        "dismissed",
      );
      decision();
      p.status = "annulled";
      break;
    case "block":
      supervisor();
      decision();
      p.blockedAt = ctx.now;
      break;
    default:
      throw partFail("Operación no permitida.", 400);
  }
  p.revision++;
  p.updatedAt = ctx.now;
  return p;
}
