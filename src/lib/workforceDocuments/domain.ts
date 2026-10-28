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
      ...COMMON_FIELDS,
      ...(kind === "rechazo_voluntario" ? REJECTION_FIELDS : EXIT_FIELDS),
    ].map((f) => f.key),
  );
  for (const [k, v] of Object.entries(input)) {
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
  required([
    "contractReference",
    "contractConfirmed",
    "communication",
    "reason",
  ]);
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
    required([
      "contractDate",
      "incorporation",
      "started",
      "intention",
      "effects",
      "regime",
      "regimeSource",
      "notice",
      "contractReview",
    ]);
    if (
      !date(c.contractDate) ||
      !date(c.incorporation) ||
      !date(c.effects) ||
      c.contractDate > c.incorporation
    )
      throw fail("Revisa fechas de contrato, incorporación y efectos.");
    if (
      c.contractDate > day(c.communication) ||
      c.effects < day(c.communication)
    )
      throw fail(
        "La fecha del contrato y la fecha de efectos no son coherentes con la comunicación.",
      );
    if (!["yes", "no"].includes(c.started))
      throw fail("Indica si ha comenzado la prestación de servicios.");
    if (
      c.started === "yes" &&
      (c.incorporation > day(c.communication) || c.effects < c.incorporation)
    )
      throw fail(
        "El inicio efectivo no puede ser posterior a la comunicación o a los efectos.",
      );
    if (
      (c.started === "yes" && c.intention !== "cease") ||
      (c.started === "no" && !["no_join", "cease"].includes(c.intention))
    )
      throw fail(
        "Sin voluntad expresa de terminar la relación no corresponde un cese voluntario. Conserva el borrador y utiliza Prevención o Partes y avisos.",
      );
    if (c.contractReview !== "yes")
      throw fail(
        "Falta contrastar la situación concreta, contrato y régimen aplicable. No se clasifica como rechazo de oferta sin contrato.",
      );
    if (!["Motivos personales", "Otro"].includes(c.reason))
      throw fail("Selecciona un motivo general.");
    if (c.reason === "Otro") required(["reasonBrief"]);
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
  if (p.kind === "salida_obra")
    return "Comunicación de salida temporal de obra";
  if (p.content.intention === "task" || p.content.intention === "risk")
    return "Sin voluntad de cesar: este circuito de cese no corresponde";
  if (p.content.started === "yes" && p.content.intention === "cease")
    return "Comunicación de dimisión de la persona trabajadora";
  if (p.content.started === "no")
    return p.content.intention === "cease"
      ? "Manifestación de finalización voluntaria con contrato firmado y sin incorporación efectiva"
      : "Manifestación de no incorporación con contrato firmado";
  return "Supuesto pendiente de determinar: solo borrador";
}
export function declaration(p: WorkforceDocument): string {
  const c = p.content;
  if (p.kind === "rechazo_voluntario") {
    if (c.intention === "task" || c.intention === "risk")
      return "BORRADOR: no se manifiesta voluntad de cesar. Este supuesto debe seguir el circuito de Partes y avisos o Prevención; no corresponde un cese voluntario.";
    return `${c.started === "yes" ? "Comunico expresamente mi voluntad de finalizar voluntariamente mi relación laboral" : "Habiendo firmado un contrato y sin haber iniciado la prestación de servicios, comunico mi voluntad de " + (c.intention === "cease" ? "finalizar voluntariamente esa relación" : "no incorporarme a la prestación de servicios")}, con fecha de efectos que manifiesto ${c.effects || "pendiente"}. Motivo: ${c.reason || "pendiente"}${c.reasonBrief ? ": " + c.reasonBrief : ""}. He podido leer el documento y firmo voluntariamente este contenido concreto. Esta manifestación no es una renuncia genérica a derechos ni un finiquito.`;
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
export const REJECTION_FIELDS: Field[] = [
  { key: "contractDate", label: "Fecha de firma del contrato", type: "date" },
  {
    key: "incorporation",
    label: "Fecha prevista de incorporación",
    type: "date",
  },
  {
    key: "started",
    label: "¿Ha comenzado efectivamente a prestar servicios?",
    options: [
      ["no", "No"],
      ["yes", "Sí"],
    ],
  },
  {
    key: "intention",
    label: "¿Qué manifiesta exactamente la persona?",
    options: [
      ["no_join", "No incorporarse (con contrato firmado)"],
      ["cease", "Finalizar expresamente la relación laboral"],
      ["task", "Rechazar solo una tarea/puesto sin cesar"],
      ["risk", "Comunicar riesgo o limitación, sin cesar"],
    ],
  },
  {
    key: "effects",
    label: "Fecha de efectos que manifiesta el trabajador",
    type: "date",
  },
  {
    key: "reason",
    label: "Motivo general obligatorio",
    options: [
      ["Motivos personales", "Motivos personales"],
      ["Otro", "Otro"],
    ],
  },
  { key: "regime", label: "Convenio o régimen laboral realmente aplicable" },
  {
    key: "regimeSource",
    label:
      "Referencia oficial, artículo y ámbito contrastados del convenio/régimen",
  },
  {
    key: "notice",
    label: "Preaviso según contrato/régimen comprobado (sin plazo universal)",
  },
  {
    key: "contractReview",
    label:
      "¿Se ha contrastado este supuesto con contrato y régimen aplicables?",
    options: [
      ["no", "Pendiente: conservar borrador"],
      ["yes", "Sí; referencias concretas consignadas arriba"],
    ],
  },
];
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
