import {
  uuidValid,
  type VisitState,
  type VisitPerson,
} from "../lib/visitMinutes.js";
import {
  assertOrderAuthorities,
  validateOrderTransition,
  type OrderAuthority,
  type WorkOrder,
  type OrderReference,
} from "../lib/visitWorkOrders.js";
type Database = (
  path: string,
  body?: any,
  authorization?: string,
  method?: string,
) => Promise<any>;
type Deps = {
  database: Database;
  digest: (s: string | Uint8Array) => string;
  validateAttachments: (state: VisitState) => Promise<void>;
};
const error = (m: string, status = 400) =>
  Object.assign(new Error(m), { status });
const q = (p: Record<string, string>) => new URLSearchParams(p).toString();
const normalized = (s: string) => s.trim().toLocaleLowerCase("es");
export const isOrderAction = (action: string) =>
  action.startsWith("orders-") || action.startsWith("foreman-visits-");
const authority = (a: any): OrderAuthority => ({
  ...a.data,
  worksiteId: a.obra_id,
  personId: a.person_id,
  userId: a.user_id || "",
  scopes: a.scopes,
  canVerify: a.can_verify,
  active: a.active,
});
const permits = (rule: any, accessId: string) =>
  rule?.visibility !== "restricted" ||
  (rule.accessIds || rule.foremanAccessIds || []).includes(accessId);
async function publicationVisibility(
  db: Database,
  publications: any[],
  accessId: string,
) {
  const ids = [
    ...new Set(
      publications.flatMap((p) =>
        p.access_rules.map((r: any) => r.orderId).filter(Boolean),
      ),
    ),
  ];
  const current = ids.length
    ? await db(
        "visit_work_orders?" +
          q({
            select: "id,definition",
            id: "in.(" + ids.join(",") + ")",
            limit: "1000",
          }),
      )
    : [];
  return publications.filter((p) =>
    p.access_rules.every(
      (rule: any) =>
        permits(rule, accessId) &&
        (!rule.orderId ||
          current.some(
            (o: any) =>
              o.id === rule.orderId && permits(o.definition, accessId),
          )),
    ),
  );
}
export async function orderWorkContext(
  db: Database,
  workId: string,
  userId: string,
  auth: string,
) {
  if (!uuidValid(workId)) throw error("Obra inválida.");
  const [work] = await db(
    "obras?" +
      q({
        select: "id,owner_id,nombre,codigo",
        id: "eq." + workId,
        limit: "1",
      }),
    undefined,
    auth,
  );
  if (!work) throw error("Obra no autorizada.", 403);
  const canWrite = !!(await db("rpc/visit_minutes_owner_can_write", {
    p_owner: userId,
    p_work: workId,
  }));
  const [profile] = await db(
    "profiles?" +
      q({
        select: "id,role",
        id: "eq." + userId,
        active: "eq.true",
        limit: "1",
      }),
  );
  if (!profile) throw error("Cuenta no activa.", 403);
  return {
    work,
    canWrite,
    canManage: work.owner_id === userId || profile.role === "admin",
  };
}
export async function resolveOrderReferences(
  db: Database,
  content: any,
): Promise<any> {
  if (content.orderReferences === undefined) return content;
  if (
    !Array.isArray(content.orderReferences) ||
    content.orderReferences.length > 1000
  )
    throw error("Referencias inválidas.");
  const ids = content.orderReferences.map((r: any) => r.id);
  if (ids.some((id: any) => !uuidValid(id)) || new Set(ids).size !== ids.length)
    throw error("Referencias duplicadas o inválidas.");
  if (!ids.length) return { ...content, orderReferences: [] };
  const rows: WorkOrder[] = await db(
    "visit_work_orders?" +
      q({
        select: "id,origin_number,number,definition,status,revision",
        obra_id: "eq." + content.worksiteId,
        id: "in.(" + ids.join(",") + ")",
        limit: "1000",
      }),
  );
  if (rows.length !== ids.length)
    throw error(
      "Una referencia pertenece a otra obra o ya no está disponible.",
      403,
    );
  const refs: OrderReference[] = ids.map((id: string) => {
    const o = rows.find((o) => o.id === id)!;
    return {
      id,
      originNumber: o.origin_number,
      number: o.number,
      description: o.definition.description,
      status: o.status,
      revision: o.revision,
      recordedAt: new Date().toISOString(),
      visibility: o.definition.visibility,
      foremanAccessIds: o.definition.foremanAccessIds,
    };
  });
  return { ...content, orderReferences: refs };
}
export async function assertVisitOrders(
  db: Database,
  state: VisitState,
  recordId: string,
  presenceOnly = false,
) {
  const orders = state.content.orders || [];
  const issued = await db(
    "visit_work_orders?" +
      q({ select: "id", origin_record_id: "eq." + recordId, limit: "1000" }),
  );
  if (issued.some((o: any) => !orders.some((n) => n.id === o.id)))
    throw error(
      "Las órdenes ya emitidas deben conservarse en la nueva versión. Anula o sustituye con justificación mediante el seguimiento.",
    );
  if (!orders.length || presenceOnly) return;
  const grants = (
    await db(
      "visit_order_authorities?" +
        q({
          select: "*",
          obra_id: "eq." + state.content.worksiteId,
          active: "eq.true",
          limit: "1000",
        }),
    )
  ).map(authority);
  assertOrderAuthorities(orders, grants);
  // Previously issued definitions cannot disappear in a newly reviewed version.
  const originIds = new Set(orders.map((o) => o.id));
  const records = await db(
    "visit_work_orders?" +
      q({
        select: "id,origin_record_id,definition,status",
        obra_id: "eq." + state.content.worksiteId,
        id: "in.(" + [...originIds].join(",") + ")",
        limit: "1000",
      }),
  );
  for (const record of records) {
    const next = orders.find((o) => o.id === record.id)!;
    if (
      record.origin_record_id !== recordId ||
      record.definition.number !== next.number
    )
      throw error(
        "Conserva el identificador y número de la orden original. Para otra visita, utiliza una referencia.",
      );
    const changed = Object.keys(next)
      .filter((k) => k !== "correctionReason")
      .some(
        (k) =>
          JSON.stringify(record.definition[k]) !==
          JSON.stringify((next as any)[k]),
      );
    if (
      changed &&
      ["verified", "cancelled", "superseded"].includes(record.status)
    )
      throw error(
        "Una orden cerrada conserva su definición; registra otra orden si corresponde.",
      );
    if (
      JSON.stringify(record.definition) !== JSON.stringify(next) &&
      !next.correctionReason?.trim()
    ) {
      // JSON key order must not be interpreted as a substantive change.
      const keys = Object.keys(next).filter((k) => k !== "correctionReason");
      if (
        keys.some(
          (k) =>
            JSON.stringify(record.definition[k]) !==
            JSON.stringify((next as any)[k]),
        )
      )
        throw error("Justifica la corrección de la orden " + next.number + ".");
    }
  }
}
async function foremanContext(db: Database, hash: string) {
  const [access] = await db(
    "foreman_portal_access?" +
      q({
        select: "id,owner_id,obra,foreman_name",
        token_hash: "eq." + hash,
        active: "eq.true",
        limit: "1",
      }),
  );
  if (!access) throw error("Acceso no válido o revocado.", 403);
  const [profile] = await db(
    "profiles?" +
      q({
        select: "id",
        id: "eq." + access.owner_id,
        active: "eq.true",
        limit: "1",
      }),
  );
  if (!profile) throw error("Acceso no válido o revocado.", 403);
  const works = await db(
    "obras?" +
      q({
        select: "id,nombre",
        owner_id: "eq." + access.owner_id,
        limit: "1000",
      }),
  );
  const matches = works.filter(
    (w: any) => normalized(w.nombre) === normalized(access.obra),
  );
  if (matches.length !== 1)
    throw error(
      "La obra del acceso no está identificada de forma única. Consulta al supervisor.",
      403,
    );
  return { access, work: matches[0] };
}
function publicOrder(o: any) {
  const { original_definition, ...safe } = o;
  const { foremanAccessIds, ...definition } = safe.definition;
  return { ...safe, definition };
}
export async function handleVisitOrders(
  req: any,
  b: any,
  res: any,
  user: any,
  auth: string,
  { database: db, digest, validateAttachments }: Deps,
) {
  const action = String(b.action);
  let fc: any = null;
  if (action.startsWith("foreman-visits-")) {
    const token = String(b.token || "").trim();
    if (token.length < 16 || token.length > 256)
      throw error("Acceso no válido.", 403);
    fc = await foremanContext(db, digest(token));
  }
  const workId = fc?.work.id || String(b.worksiteId || "");
  if (action === "orders-context") {
    const context = await orderWorkContext(db, workId, user.id, auth);
    const [grants, accesses, users] = await Promise.all([
      db(
        "visit_order_authorities?" +
          q({ select: "*", obra_id: "eq." + workId, limit: "1000" }),
      ),
      db(
        "foreman_portal_access?" +
          q({
            select: "id,obra,foreman_name",
            owner_id: "eq." + context.work.owner_id,
            active: "eq.true",
            limit: "1000",
          }),
      ),
      context.canManage
        ? db("rpc/visit_order_work_users", { p_work: workId })
        : Promise.resolve([]),
    ]);
    return res.json({
      ok: true,
      ...context,
      authorities: grants.map(authority),
      accesses: accesses.filter(
        (a: any) => normalized(a.obra) === normalized(context.work.nombre),
      ),
      users,
    });
  }
  if (action === "orders-authorize") {
    const context = await orderWorkContext(db, workId, user.id, auth);
    if (!context.canManage)
      throw error(
        "Solo el responsable de obra puede autorizar competencias.",
        403,
      );
    const a = b.authority;
    if (
      !uuidValid(a?.personId) ||
      (a.userId && !uuidValid(a.userId)) ||
      !Array.isArray(a.scopes) ||
      !a.scopes.length ||
      a.scopes.some(
        (s: any) => !["technical", "preventive", "recommendation"].includes(s),
      )
    )
      throw error("Competencias inválidas.");
    const data = {
      name: String(a.name || "").trim(),
      role: String(a.role || "").trim(),
      entity: String(a.entity || "").trim(),
      justification: String(a.justification || "").trim(),
    };
    if (
      !data.name ||
      !data.role ||
      data.justification.length < 5 ||
      JSON.stringify(data).length > 3000
    )
      throw error("Identifica y justifica la competencia de esta persona.");
    const result = await db("rpc/visit_order_save_authority", {
      p_actor: user.id,
      p_work: workId,
      p_person: a.personId,
      p_user: a.userId || null,
      p_data: data,
      p_scopes: a.scopes,
      p_verify: a.canVerify === true,
      p_active: a.active !== false,
    });
    return res.json({ ok: true, authority: authority(result) });
  }
  if (action === "orders-list" || action === "foreman-visits-orders") {
    const context = fc
      ? null
      : await orderWorkContext(db, workId, user.id, auth);
    const offset = Math.max(0, Math.min(100000, Number(b.offset) || 0));
    const params: any = {
      select: "*",
      obra_id: "eq." + workId,
      order: "updated_at.desc,id.desc",
      limit: "31",
      offset: String(offset),
    };
    if (fc) params.owner_id = "eq." + fc.access.owner_id;
    if (b.pending !== false)
      params.status = fc
        ? "not.in.(pending_communication,verified,cancelled,superseded)"
        : "not.in.(verified,cancelled,superseded)";
    if (fc && b.pending === false)
      params.status = "not.in.(pending_communication)";
    if (b.originId) {
      if (!uuidValid(b.originId)) throw error("Acta inválida.");
      params.origin_record_id = "eq." + b.originId;
    }
    const rows = await db("visit_work_orders?" + q(params));
    const visible = fc
      ? rows
          .slice(0, 30)
          .filter((o: any) => permits(o.definition, fc.access.id))
          .map(publicOrder)
      : rows;
    return res.json({
      ok: true,
      orders: visible.slice(0, 30),
      hasMore: rows.length > 30,
      nextOffset: offset + 30,
      canWrite: context?.canWrite || false,
      verificationScopes: context?.canWrite
        ? [
            ...new Set(
              (
                await db(
                  "visit_order_authorities?" +
                    q({
                      select: "scopes",
                      obra_id: "eq." + workId,
                      user_id: "eq." + user.id,
                      can_verify: "eq.true",
                      active: "eq.true",
                      limit: "1000",
                    }),
                )
              ).flatMap((a: any) => a.scopes),
            ),
          ]
        : [],
    });
  }
  if (action === "foreman-visits-list") {
    const offset = Math.max(0, Math.min(100000, Number(b.offset) || 0));
    const rows = await db(
      "visit_signed_publications?" +
        q({
          select: "*",
          owner_id: "eq." + fc.access.owner_id,
          obra_id: "eq." + workId,
          order: "visit_date.desc,record_id.desc,version.desc",
          offset: String(offset),
          limit: "31",
        }),
    );
    const safe = await publicationVisibility(
      db,
      rows.slice(0, 30),
      fc.access.id,
    );
    const reads = await db(
      "visit_signed_reads?" +
        q({
          select: "record_id,version,at",
          access_id: "eq." + fc.access.id,
          limit: "1000",
        }),
    );
    return res.json({
      ok: true,
      publications: safe.slice(0, 30).map((p: any) => ({
        recordId: p.record_id,
        version: p.version,
        number: p.number,
        visitDate: p.visit_date,
        publishedAt: p.published_at,
        readAt:
          reads.find(
            (r: any) => r.record_id === p.record_id && r.version === p.version,
          )?.at || null,
      })),
      hasMore: rows.length > 30,
      nextOffset: offset + 30,
      worksite: fc.work.nombre,
    });
  }
  if (action === "foreman-visits-pdf" || action === "foreman-visits-read") {
    if (!uuidValid(b.recordId) || !Number.isInteger(b.version) || b.version < 1)
      throw error("Acta inválida.");
    const [p] = await db(
      "visit_signed_publications?" +
        q({
          select: "*",
          record_id: "eq." + b.recordId,
          version: "eq." + b.version,
          owner_id: "eq." + fc.access.owner_id,
          obra_id: "eq." + workId,
          limit: "1",
        }),
    );
    if (!p || !(await publicationVisibility(db, [p], fc.access.id)).length)
      throw error("Acta no autorizada para este acceso.", 403);
    if (action === "foreman-visits-read")
      return res.json({
        ok: true,
        ...(await db("rpc/visit_signed_acknowledge", {
          p_record: p.record_id,
          p_version: p.version,
          p_access: fc.access.id,
        })),
      });
    const [file] = await db(
      "visit_minutes_files?" +
        q({
          select: "base64,sha256",
          record_id: "eq." + p.record_id,
          version: "eq." + p.version,
          limit: "1",
        }),
    );
    if (
      !file ||
      file.sha256 !== p.sha256 ||
      digest(Buffer.from(file.base64, "base64")) !== file.sha256
    )
      throw error(
        "El archivo firmado no supera la comprobación de integridad.",
        409,
      );
    // Never regenerate or alter a signed file; return the verified original bytes.
    return res.json({
      ok: true,
      file: {
        base64: file.base64,
        sha256: file.sha256,
        filename: p.number + "_v" + p.version + "_FIRMADA.pdf",
      },
    });
  }
  if (
    [
      "orders-transition",
      "orders-history",
      "orders-evidence",
      "foreman-visits-transition",
      "foreman-visits-history",
      "foreman-visits-evidence",
    ].includes(action)
  ) {
    if (!uuidValid(b.orderId)) throw error("Orden inválida.");
    const [order]: WorkOrder[] = await db(
      "visit_work_orders?" +
        q({ select: "*", id: "eq." + b.orderId, limit: "1" }),
    );
    if (!order) throw error("Orden no disponible.", 404);
    const context = fc
      ? null
      : await orderWorkContext(db, order.obra_id, user.id, auth);
    if (
      fc &&
      (order.obra_id !== workId ||
        order.owner_id !== fc.access.owner_id ||
        order.status === "pending_communication" ||
        !permits(order.definition, fc.access.id))
    )
      throw error("Orden no autorizada.", 403);
    if (action.endsWith("-history")) {
      const params: any = {
        select:
          "id,revision,actor_type,actor_id,event,from_status,to_status,note,details,at",
        order_id: "eq." + order.id,
        order: "id.desc",
        limit: "51",
      };
      if (b.before) {
        if (!/^\d+$/.test(String(b.before))) throw error("Cursor inválido.");
        params.id = "lt." + b.before;
      }
      const rows = await db("visit_order_events?" + q(params));
      const events = fc
        ? rows
            .slice(0, 50)
            .filter((e: any) => permits(e.details, fc.access.id))
            .map(({ actor_id, ...e }: any) => ({
              ...e,
              details: { evidenceIds: e.details.evidenceIds || [] },
            }))
        : rows;
      const definitions = await db(
        "visit_order_definitions?" +
          q({
            select: "version,definition,reason,at",
            order_id: "eq." + order.id,
            order: "version.desc",
            limit: "1000",
          }),
      );
      return res.json({
        ok: true,
        definitions: fc
          ? definitions
              .filter((d: any) => permits(d.definition, fc.access.id))
              .map((d: any) => {
                const { foremanAccessIds, ...definition } = d.definition;
                return { ...d, definition };
              })
          : definitions,
        events: events.slice(0, 50),
        hasMore: rows.length > 50,
        nextBefore: rows.length ? rows[Math.min(49, rows.length - 1)].id : null,
      });
    }
    if (action.endsWith("-evidence")) {
      if (!uuidValid(b.evidenceId)) throw error("Evidencia inválida.");
      const [e] = await db(
        "visit_order_evidence?" +
          q({
            select: "*",
            id: "eq." + b.evidenceId,
            order_id: "eq." + order.id,
            limit: "1",
          }),
      );
      if (!e || (fc && !permits(e.access_rules, fc.access.id)))
        throw error("Evidencia no autorizada.", 403);
      if (digest(Buffer.from(e.base64, "base64")) !== e.sha256)
        throw error(
          "La evidencia no supera la comprobación de integridad.",
          409,
        );
      return res.json({
        ok: true,
        file: {
          name: e.name,
          mime: e.mime,
          base64: e.base64,
          sha256: e.sha256,
        },
      });
    }
    if (
      !uuidValid(b.operation) ||
      !Number.isInteger(b.revision) ||
      typeof b.note !== "string" ||
      b.note.length > 5000
    )
      throw error("Operación de seguimiento inválida.");
    if (
      (fc && !order.definition.foremanCanReport) ||
      (!fc && !context?.canWrite)
    )
      throw error("Sin permiso para registrar avances.", 403);
    const grants = fc
      ? []
      : await db(
          "visit_order_authorities?" +
            q({
              select: "*",
              obra_id: "eq." + order.obra_id,
              user_id: "eq." + user.id,
              can_verify: "eq.true",
              active: "eq.true",
              limit: "1000",
            }),
        );
    const canVerify = grants.some((a: any) =>
      a.scopes.includes(order.definition.nature),
    );

    if (
      !fc &&
      b.status &&
      ["verified", "cancelled", "superseded", "breached"].includes(b.status) &&
      !canVerify
    )
      throw error(
        "No tienes competencia expresa vigente para comprobar o anular esta orden.",
        403,
      );
    const raw = b.evidence || [];
    if (!Array.isArray(raw) || raw.length > 8)
      throw error("Evidencias inválidas.");
    const evidence = raw.map((e: any) => {
      if (
        !uuidValid(e.id) ||
        typeof e.base64 !== "string" ||
        e.base64.length > 1800000 ||
        !/^[a-z0-9+/]+={0,2}$/i.test(e.base64) ||
        e.base64.length % 4 ||
        !["image/png", "image/jpeg", "application/pdf"].includes(e.mime)
      )
        throw error("Evidencia inválida.");
      return {
        id: e.id,
        name: String(e.name || "").slice(0, 150),
        mime: e.mime,
        base64: e.base64,
        caption: String(e.caption || "").slice(0, 1000),
        sha256: digest(Buffer.from(e.base64, "base64")),
      };
    });
    if (
      evidence.reduce((n: number, e: any) => n + e.base64.length, 0) > 2000000
    )
      throw error("Reduce el tamaño conjunto de las evidencias.");
    await validateAttachments({
      content: { attachments: evidence },
    } as unknown as VisitState);
    const hash = digest(
      JSON.stringify({
        id: order.id,
        revision: b.revision,
        status: b.status || null,
        note: b.note,
        evidence,
        replacementId: b.replacementId || null,
      }),
    );
    const prior = await db(
      "visit_order_operations?" +
        q({
          select: "request_hash",
          order_id: "eq." + order.id,
          operation_id: "eq." + b.operation,
          limit: "1",
        }),
    );
    if (!prior.length && order.revision !== b.revision)
      throw error("La orden ha cambiado. Actualiza antes de guardar.", 409);
    if (!prior.length && b.status !== null && b.status !== undefined)
      validateOrderTransition(
        order.status,
        b.status,
        fc ? "foreman" : "supervisor",
        canVerify,
        b.note,
        b.replacementId,
      );
    const result = await db("rpc/visit_order_transition", {
      p_id: order.id,
      p_expected: b.revision,
      p_operation: b.operation,
      p_hash: hash,
      p_actor_type: fc ? "foreman" : "supervisor",
      p_actor_id: fc ? fc.access.id : user.id,
      p_status: b.status || null,
      p_note: b.note,
      p_evidence: evidence,
      p_replacement: b.replacementId || null,
    });
    return res.json({ ok: true, order: fc ? publicOrder(result) : result });
  }
  throw error("Operación de órdenes no reconocida.");
}
