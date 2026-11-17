/** Pure document rules shared by UI and server. Does not mutate employment/timekeeping. */
export const DOCUMENT_KINDS = {
  rechazo_voluntario: "Rechazo voluntario",
  salida_obra: "Salida de obra",
} as const;
export type DocumentKind = keyof typeof DOCUMENT_KINDS;
export const DOCUMENT_STATUS = {
  draft: "Borrador",
  prepared: "Preparado para lectura y firma",
  worker_signed: "Firma del trabajador registrada",
  completed: "Finalizado",
  return_recorded: "Regreso registrado",
  annulled: "Anulado",
} as const;
export type Content = Record<string, string>;
export type Actor = { id: string; name: string; role: string; method: string };
export type WorkforceDocument = {
  id: string;
  ownerId: string;
  workerId: number;
  worksiteId: string;
  accessId: string | null;
  kind: DocumentKind;
  revision: number;
  version: number;
  status: keyof typeof DOCUMENT_STATUS;
  createdAt: string;
  updatedAt: string;
  worksite: {
    id: string;
    code: string;
    name: string;
    municipality: string;
    employer: string;
    cif: string;
  };
  worker: {
    name: string;
    dni: string;
    category: string;
    offer: string;
    start: string;
    end: string;
    reference: string;
  };
  foreman: { id: string; name: string };
  content: Content;
  hash: string;
  signatures: Partial<
    Record<
      "worker" | "foreman",
      {
        image: string;
        at: string;
        version: number;
        hash: string;
        actor: Actor;
        capturedBy: Actor;
      }
    >
  >;
  returnEntry?: {
    at: string;
    recordedAt: string;
    actor: Actor;
    actualExit: string;
    note: string;
  };
  annulment?: { at: string; actor: Actor; reason: string };
};
export const fail = (message: string, status = 400) =>
  Object.assign(new Error(message), { status });
export const stamp = (s: string) =>
  s
    ? new Date(s).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })
    : "Pendiente";
export const day = (s: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(
    new Date(s),
  );
export function madridInput(s: string) {
  if (!s || !Number.isFinite(Date.parse(s))) return s || "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(s));
  return parts.replace(" ", "T");
}
export function madridCandidates(local: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return [];
  return ["+01:00", "+02:00"]
    .map((o) => local + ":00" + o)
    .filter((s) => Number.isFinite(Date.parse(s)) && madridInput(s) === local);
}
const date = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v || "") &&
  Number.isFinite(Date.parse(v + "T12:00:00Z")) &&
  new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v;
const instant = (v: string) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(
    v || "",
  ) &&
  date(v.slice(0, 10)) &&
  Number.isFinite(Date.parse(v));
export function cleanContent(input: unknown, kind: DocumentKind): Content {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw fail("Contenido no válido.");
  const result: Content = {};
  const keys = new Set(
    [
      ...fieldsForKind(kind),
    ].map((f) => f.key),
  );
  for (const [k, v] of Object.entries(input)) {
    // Old unsigned rejection drafts may still carry the previous verbose fields.
    // Strip them on the next save; never silently accept unknown new fields.
    if (kind === "rechazo_voluntario" && LEGACY_REJECTION_KEYS.has(k)) continue;
    if (!keys.has(k) || typeof v !== "string" || v.length > 4000)
      throw fail("Campo no admitido o demasiado largo.");
    result[k] = v.trim();
  }
  return result;
}
export function validateDocument(p: WorkforceDocument, now: string) {
  const c = p.content;
  const required = (keys: string[]) => {
    for (const k of keys) if (!c[k]) throw fail("Completa: " + fieldLabel(k));
  };
  if (
    !p.worksite.employer ||
    !p.worksite.cif ||
    !p.worksite.code ||
    !p.worksite.municipality ||
    !p.foreman.name ||
    !p.worker.name ||
    !p.worker.dni ||
    !p.worker.category
  )
    throw fail(
      "Faltan datos de entidad, CIF, obra, municipio, encargado o trabajador en Configuración/contratación.",
      409,
    );
  required(p.kind === "rechazo_voluntario"
    ? ["contractConfirmed", "communication", "reason"]
    : ["contractReference", "contractConfirmed", "communication", "reason"]);
  if (c.contractConfirmed !== "yes")
    throw fail(
      "Confirma una contratación real; no se emite para candidatos sin contratar.",
    );
  if (
    !instant(c.communication) ||
    Date.parse(c.communication) > Date.parse(now)
  )
    throw fail(
      "La comunicación debe tener fecha y hora reales, completas y no futuras.",
    );
  if (p.kind === "rechazo_voluntario") {
    // The worksite identifier and contract period are taken from the
    // authorization-controlled snapshot, never typed by the foreman.
    if (!date(p.worker.start) || !date(p.worker.end) || p.worker.start > p.worker.end)
      throw fail("Completa o corrige el periodo de contratación en la ficha del trabajador.");
    if (!p.worksite.code.trim())
      throw fail("Falta el código de obra en Configuración.");
    if (c.reason === "Otro" || c.reason.trim().length < 3 || c.reason.length > 500)
      throw fail("Selecciona un motivo habitual o escribe un motivo concreto.");
    if (["task", "risk"].includes(c.intention))
      throw fail("El rechazo de una tarea o una alerta de riesgo sin voluntad de dejar el puesto se tramita por Prevención o Partes y avisos.");
  } else {
    required(["exit", "exitType", "returnMode", "returnDay"]);
    if (
      ![
        "Consulta médica",
        "Gestión personal",
        "Motivo familiar",
        "Otro",
      ].includes(c.reason)
    )
      throw fail("Selecciona un motivo general.");
    if (c.reason === "Otro") required(["reasonBrief"]);
    if (!instant(c.exit) || !["planned", "actual"].includes(c.exitType))
      throw fail("Revisa la fecha/hora completa y el tipo de salida.");
    if (
      (c.exitType === "actual" && Date.parse(c.exit) > Date.parse(now)) ||
      (c.exitType === "planned" &&
        Date.parse(c.exit) < Date.parse(c.communication))
    )
      throw fail(
        "No se puede certificar una salida futura ni prever una salida anterior a la comunicación.",
      );
    const exitDay = day(c.exit);
    if (
      !date(p.worker.start) ||
      !date(p.worker.end) ||
      exitDay < p.worker.start ||
      exitDay > p.worker.end
    )
      throw fail(
        "Selecciona una contratación pertinente a la obra y fecha de salida.",
      );
    if (!["same", "later", "unknown"].includes(c.returnDay))
      throw fail(
        "Indica si se prevé volver en la jornada, posteriormente o está por determinar.",
      );
    if (c.returnMode === "at") {
      if (!instant(c.returnAt) || Date.parse(c.returnAt) <= Date.parse(c.exit))
        throw fail(
          "El regreso previsto debe ser posterior a la salida, con fecha completa.",
        );
      if (
        (c.returnDay === "same" && day(c.returnAt) !== exitDay) ||
        (c.returnDay === "later" && day(c.returnAt) <= exitDay)
      )
        throw fail(
          "La previsión de jornada no coincide con la fecha de regreso.",
        );
    } else if (c.returnMode === "duration") {
      if (
        !/^\d+$/.test(c.duration || "") ||
        Number(c.duration) < 1 ||
        Number(c.duration) > 525600
      )
        throw fail(
          "Indica una duración estimada positiva en minutos (máximo un año).",
        );
      const end = day(
        new Date(Date.parse(c.exit) + Number(c.duration) * 60000).toISOString(),
      );
      if (
        (c.returnDay === "same" && end !== exitDay) ||
        (c.returnDay === "later" && end <= exitDay)
      )
        throw fail(
          "La duración estimada no coincide con la previsión de regreso.",
        );
    } else if (c.returnMode !== "unknown")
      throw fail("Indica la previsión de regreso o Pendiente de determinar.");
    if (
      c.justification &&
      !["not_applicable", "not_provided", "pending", "provided"].includes(
        c.justification,
      )
    )
      throw fail("Estado de justificante no válido.");
  }
}
export function documentVariant(p: WorkforceDocument) {
  return p.kind === "salida_obra"
    ? "Comunicación de salida temporal de obra"
    : "Comunicación de rechazo voluntario del puesto de trabajo";
}
export function declaration(p: WorkforceDocument): string {
  const c = p.content;
  if (p.kind === "rechazo_voluntario") {
    return `La persona trabajadora manifiesta voluntariamente que no desea incorporarse o continuar en el puesto de trabajo correspondiente a la obra ${p.worksite.code}, durante el periodo de contratación ${p.worker.start || "pendiente"} a ${p.worker.end || "pendiente"}. Motivo: ${c.reason || "pendiente"}. Esta comunicación se realiza en la fecha indicada y queda documentada mediante la firma del trabajador. La naturaleza y los efectos laborales y administrativos de esta manifestación deberán ser comprobados por el órgano competente; este documento no constituye por sí solo una baja, una extinción contractual acreditada ni un finiquito.`;
  }
  return `Comunico ${c.exitType === "actual" ? "mi salida temporal registrada como efectivamente constatada" : "mi previsión de salida temporal"} de la obra indicada el ${stamp(c.exit)} por ${c.reason || "motivo pendiente"}${c.reasonBrief ? ": " + c.reasonBrief : ""}. Previsión de regreso: ${c.returnMode === "at" ? stamp(c.returnAt) : c.returnMode === "duration" ? (c.duration || "?") + " minutos estimados" : "Pendiente de determinar"}. ${c.returnDay === "same" ? "Preveo volver durante esa jornada." : c.returnDay === "later" ? "Preveo volver en fecha posterior." : "La jornada de regreso está pendiente de determinar."} Firmo para dejar constancia de esta comunicación y del contenido que he podido leer. No constituye dimisión, abandono ni concesión de permiso.`;
}
export const RECEIPT_TEXT =
  "Confirmo expresamente la recepción y lectura de esta comunicación, la identidad consignada y los datos que he comprobado según mis observaciones. Mi firma deja constancia de recepción/conocimiento; no concede por sí sola un permiso ni certifica hechos que no haya constatado.";
export const LEGAL_NOTE =
  "La tramitación laboral y administrativa corresponde al órgano competente. Este documento no modifica el contrato, prestaciones, nómina, calendario SAE ni fichajes, y no acredita comunicaciones externas. La firma manuscrita en pantalla se vincula a esta versión; no se declara firma avanzada ni cualificada.";
export type Field = {
  key: string;
  label: string;
  type?: "date" | "instant" | "textarea" | "number";
  options?: [string, string][];
};
export const COMMON_FIELDS: Field[] = [
  {
    key: "contractReference",
    label: "Referencia del contrato firmado / contratación",
  },
  {
    key: "contractConfirmed",
    label: "¿Existe contratación formalizada?",
    options: [
      ["yes", "Sí, comprobada"],
      ["no", "No / pendiente: solo borrador"],
    ],
  },
  {
    key: "communication",
    label: "Fecha y hora reales de comunicación (Europe/Madrid)",
    type: "instant",
  },
  {
    key: "reasonBrief",
    label: "Texto breve del motivo, si es Otro (sin datos íntimos)",
  },
  {
    key: "workerNotes",
    label: "Observaciones voluntarias del trabajador (sin diagnósticos)",
    type: "textarea",
  },
  {
    key: "foremanNotes",
    label: "Observaciones del encargado y hechos comprobados",
    type: "textarea",
  },
];
/** Presets are non-clinical, neutral and do not imply an automatic legal classification. */
export const REJECTION_REASONS = [
  "Motivos personales",
  "Motivos familiares",
  "Incompatibilidad de horarios",
  "Problemas de desplazamiento",
  "Aceptación de otro empleo",
  "Cambio de disponibilidad",
  "No desea incorporarse al puesto",
] as const;
/** Rejection has ONE reason field; a custom value is stored in that same key. */
export const REJECTION_FIELDS: Field[] = [
  {
    key: "contractConfirmed",
    label: "¿Existe contratación formalizada?",
    options: [
      ["yes", "Sí, comprobada"],
      ["no", "No / pendiente: solo borrador"],
    ],
  },
  {
    key: "communication",
    label: "Fecha y hora reales de comunicación (Europe/Madrid)",
    type: "instant",
  },
  { key: "reason", label: "Motivo", type: "textarea" },
];
const LEGACY_REJECTION_KEYS = new Set([
  "contractReference", "reasonBrief", "workerNotes", "foremanNotes",
  "contractDate", "incorporation", "started", "intention", "effects",
  "regime", "regimeSource", "notice", "contractReview",
]);
export function fieldsForKind(kind: DocumentKind): Field[] {
  return kind === "rechazo_voluntario"
    ? REJECTION_FIELDS
    : [...COMMON_FIELDS, ...EXIT_FIELDS];
}
export const EXIT_FIELDS: Field[] = [
  {
    key: "exit",
    label: "Fecha y hora de salida (Europe/Madrid)",
    type: "instant",
  },
  {
    key: "exitType",
    label: "Alcance de la hora de salida",
    options: [
      ["planned", "Prevista / comunicada antes de salir"],
      ["actual", "Efectivamente constatada"],
    ],
  },
  {
    key: "reason",
    label: "Motivo general obligatorio",
    options: [
      "Consulta médica",
      "Gestión personal",
      "Motivo familiar",
      "Otro",
    ].map((s) => [s, s]),
  },
  {
    key: "returnMode",
    label: "Previsión de regreso",
    options: [
      ["at", "Fecha y hora previstas"],
      ["duration", "Duración estimada"],
      ["unknown", "Pendiente de determinar"],
    ],
  },
  {
    key: "returnAt",
    label: "Fecha y hora previstas de regreso",
    type: "instant",
  },
  { key: "duration", label: "Duración estimada en minutos", type: "number" },
  {
    key: "returnDay",
    label: "¿Se prevé volver durante la jornada?",
    options: [
      ["same", "Durante la misma jornada"],
      ["later", "En una fecha posterior"],
      ["unknown", "Pendiente de determinar"],
    ],
  },
  {
    key: "justification",
    label: "Justificante, solo si procede según el régimen",
    options: [
      ["not_applicable", "No procede / sin exigencia"],
      ["not_provided", "No aportado"],
      ["pending", "Pendiente"],
      ["provided", "Aportado (custodia por circuito privado correspondiente)"],
    ],
  },
];
export function fieldLabel(k: string) {
  return (
    [...COMMON_FIELDS, ...REJECTION_FIELDS, ...EXIT_FIELDS].find(
      (f) => f.key === k,
    )?.label || k
  );
}
