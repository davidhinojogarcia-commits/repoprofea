import type { VisitAttachment, VisitPerson } from "./visitMinutes.js";
export const ORDER_STATUS_LABELS = {
  pending_communication: "Pendiente de comunicar",
  communicated: "Comunicada",
  pending_execution: "Pendiente de ejecución",
  in_progress: "En ejecución",
  executed_pending_verification: "Ejecutada, pendiente de comprobación",
  verified: "Cumplida y verificada",
  breached: "Incumplida",
  cancelled: "Anulada",
  superseded: "Sustituida",
} as const;
export type OrderStatus = keyof typeof ORDER_STATUS_LABELS;
export type OrderNature = "technical" | "preventive" | "recommendation";
export const ORDER_NATURE_LABELS = {
  technical: "Instrucción técnica",
  preventive: "Medida preventiva",
  recommendation: "Recomendación",
};
export type WorkOrderDefinition = {
  id: string;
  number: number;
  type: "order" | "technical_instruction" | "recommendation";
  nature: OrderNature;
  issuerId: string;
  issuerName: string;
  issuerRole: string;
  issuerEntity: string;
  recipientId: string;
  recipient: string;
  description: string;
  location: string;
  issuedDate: string;
  deadline: string;
  priority: "normal" | "high" | "urgent";
  observations: string;
  attachmentIds: string[];
  officialReference: string;
  reservedDecision: boolean;
  authorizationReference: string;
  correctionReason?: string;
  visibility: "worksite" | "restricted";
  foremanAccessIds: string[];
  foremanCanReport: boolean;
};
export type OrderReference = {
  id: string;
  originNumber: string;
  number: number;
  description: string;
  status: OrderStatus;
  revision: number;
  recordedAt: string;
  visibility?: "worksite" | "restricted";
  foremanAccessIds?: string[];
};
export type WorkOrder = {
  id: string;
  owner_id: string;
  obra_id: string;
  origin_record_id: string;
  origin_number: string;
  origin_version: number;
  number: number;
  definition: WorkOrderDefinition;
  original_definition: WorkOrderDefinition;
  status: OrderStatus;
  revision: number;
  executed_at?: string;
  verified_at?: string;
  verified_by?: string;
  created_at: string;
  updated_at: string;
};
export type OrderAuthority = {
  worksiteId: string;
  personId: string;
  name: string;
  role: string;
  entity: string;
  scopes: OrderNature[];
  userId: string;
  canVerify: boolean;
  active: boolean;
  justification: string;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const insist: (condition: unknown, message: string) => asserts condition = (
  c,
  m,
) => {
  if (!c) throw new Error(m);
};
const text = (v: unknown, max = 1000) => {
  insist(
    typeof v === "string" && v.length <= max,
    "Texto de orden inválido o demasiado largo.",
  );
  return v.trim();
};
const date = (v: unknown, optional = false) => {
  const s = text(v, 10);
  if (optional && !s) return "";
  insist(
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      !isNaN(Date.parse(s + "T12:00:00Z")) &&
      new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s,
    "Fecha de orden inválida.",
  );
  return s;
};
export const orderClosed = (s: OrderStatus) =>
  ["verified", "cancelled", "superseded"].includes(s);
export function cleanWorkOrders(
  raw: unknown,
  people: VisitPerson[],
  attachments: VisitAttachment[],
): WorkOrderDefinition[] {
  insist(
    Array.isArray(raw) && raw.length <= 1000,
    "Órdenes inválidas o demasiado numerosas.",
  );
  const orders = raw.map((r: any) => {
    insist(
      uuid(r?.id) &&
        Number.isInteger(r.number) &&
        r.number > 0 &&
        r.number < 1000000,
      "Identificador o número de orden inválido.",
    );
    insist(
      ["order", "technical_instruction", "recommendation"].includes(r.type) &&
        ["technical", "preventive", "recommendation"].includes(r.nature),
      "Tipo o naturaleza de orden inválidos.",
    );
    insist(
      (r.type === "recommendation") === (r.nature === "recommendation"),
      "Las recomendaciones deben identificarse como tales.",
    );
    insist(uuid(r.issuerId), "Selecciona un emisor autorizado.");
    const recipientId = text(r.recipientId || "", 36);
    insist(
      !recipientId || people.some((p) => p.id === recipientId),
      "Destinatario ajeno al acta.",
    );
    const attachmentIds = r.attachmentIds || [];
    insist(
      Array.isArray(attachmentIds) &&
        attachmentIds.length <= 8 &&
        attachmentIds.every(
          (id: any) => uuid(id) && attachments.some((a) => a.id === id),
        ),
      "Anexo de orden no incluido en el acta.",
    );
    insist(
      new Set(attachmentIds).size === attachmentIds.length,
      "Anexos duplicados.",
    );
    insist(
      ["normal", "high", "urgent"].includes(r.priority),
      "Prioridad inválida.",
    );
    insist(
      ["worksite", "restricted"].includes(r.visibility),
      "Visibilidad inválida.",
    );
    const foremanAccessIds = r.foremanAccessIds || [];
    insist(
      Array.isArray(foremanAccessIds) &&
        foremanAccessIds.length <= 100 &&
        foremanAccessIds.every(uuid),
      "Accesos destinatarios inválidos.",
    );
    const result: WorkOrderDefinition = {
      id: r.id,
      number: r.number,
      type: r.type,
      nature: r.nature,
      issuerId: r.issuerId,
      issuerName: text(r.issuerName, 400),
      issuerRole: text(r.issuerRole, 200),
      issuerEntity: text(r.issuerEntity, 200),
      recipientId,
      recipient: text(r.recipient || "", 400),
      description: text(r.description, 20000),
      location: text(r.location || "", 1000),
      issuedDate: date(r.issuedDate),
      deadline: date(r.deadline || "", true),
      priority: r.priority,
      observations: text(r.observations || "", 10000),
      attachmentIds,
      officialReference: text(r.officialReference || "", 1000),
      reservedDecision: r.reservedDecision === true,
      authorizationReference: text(r.authorizationReference || "", 1000),
      visibility: r.visibility,
      correctionReason: text(r.correctionReason || "", 5000),
      foremanAccessIds: [...new Set(foremanAccessIds)] as string[],
      foremanCanReport: r.foremanCanReport === true,
    };
    insist(
      result.issuerName && result.issuerRole,
      "Indica nombre y cargo del emisor.",
    );
    insist(
      !result.deadline || result.deadline >= result.issuedDate,
      "El plazo no puede preceder a la emisión.",
    );
    insist(
      !result.reservedDecision || result.authorizationReference,
      "Una decisión reservada requiere referencia a la autorización del órgano competente.",
    );
    return result;
  });
  insist(
    new Set(orders.map((o) => o.id)).size === orders.length &&
      new Set(orders.map((o) => o.number)).size === orders.length,
    "Órdenes o números duplicados dentro del acta.",
  );
  return orders;
}
export function assertOrderAuthorities(
  orders: WorkOrderDefinition[],
  authorities: OrderAuthority[],
) {
  for (const o of orders) {
    const a = authorities.find(
      (a) =>
        a.personId === o.issuerId && a.active && a.scopes.includes(o.nature),
    );
    insist(
      a &&
        a.name === o.issuerName &&
        a.role === o.issuerRole &&
        a.entity === o.issuerEntity,
      "El emisor no tiene una competencia expresa vigente para esta orden.",
    );
    insist(o.description, "Completa la descripción de todas las órdenes.");
  }
}
export function validateOrderTransition(
  before: OrderStatus,
  next: OrderStatus,
  actor: "supervisor" | "foreman",
  canVerify: boolean,
  note: string,
  replacement?: string,
) {
  insist(Object.hasOwn(ORDER_STATUS_LABELS, next), "Estado de orden inválido.");
  insist(
    !orderClosed(before),
    "La orden está cerrada; su historial no puede sobrescribirse.",
  );
  insist(
    before !== next,
    "El estado no ha cambiado. Utiliza un avance para añadir observaciones.",
  );
  if (actor === "foreman") {
    insist(
      [
        "pending_execution",
        "in_progress",
        "executed_pending_verification",
      ].includes(next),
      "El encargado no puede verificar, anular ni declarar incumplimientos.",
    );
    insist(
      before !== "pending_communication",
      "La orden todavía no se ha comunicado.",
    );
  }
  if (["verified", "cancelled", "superseded", "breached"].includes(next))
    insist(
      actor === "supervisor" && canVerify,
      "La comprobación requiere una autorización competente vigente.",
    );
  if (next === "verified")
    insist(
      before === "executed_pending_verification",
      "Primero debe declararse ejecutada y pendiente de comprobación.",
    );
  if (["cancelled", "superseded", "breached", "verified"].includes(next))
    insist(
      text(note, 5000),
      "Debes justificar el resultado de la comprobación o anulación.",
    );
  if (next === "superseded")
    insist(uuid(replacement), "Selecciona la orden que la sustituye.");
}
export const ORDERS_NOTICE =
  "La revisión del acta, la lectura de una orden y la comprobación de su cumplimiento son actos distintos. La firma del acta no autoriza por sí misma modificaciones contractuales, variaciones económicas, ampliaciones de plazo ni decisiones reservadas a órganos competentes.";
