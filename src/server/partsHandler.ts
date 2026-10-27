import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { jsPDF } from "jspdf";
import {
  SUPABASE_URL,
  SERVICE_KEY,
  PUBLIC_KEY,
  authenticateRequest,
} from "./gmailOAuth.js";
import {
  applyPartCommand,
  validatePartContent,
  needsPartReview,
  eligiblePart,
  partFail,
  uuid,
  PART_REASONS,
  type PartRecord,
  type PartActor,
  type PartPolicy,
  type PartAsset,
  type PartCommand,
} from "../lib/parts/domain.js";
import {
  partsPushConfig,
  registerPartsPush,
  dispatchPartsPush,
} from "./partsPush.js";
import { generatePartPdf } from "../lib/parts/pdf.js";
export const partsDigest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
const stable = (value: any): string => JSON.stringify(canonical(value));
export const partContentHash = (p: PartRecord) =>
  partsDigest(
    stable({
      id: p.id,
      owner: p.ownerId,
      worker: p.workerId,
      workerSnapshot: p.worker,
      worksite: p.worksite,
      foreman: { id: p.foremanAccessId, name: p.foremanName },
      work: p.work,
      version: p.version,
      kind: p.kind,
      content: p.content,
    }),
  );
type DB = (path: string, body?: any, method?: string) => Promise<any>;
type Dependencies = {
  db: DB;
  authenticate: typeof authenticateRequest;
  now: () => string;
  configured: () => boolean;
  onError?: (error: unknown) => void;
};
const params = (v: Record<string, string | number>) =>
  new URLSearchParams(
    Object.entries(v).map(([k, v]) => [k, String(v)]),
  ).toString();
const one = async (
  db: DB,
  table: string,
  filters: Record<string, string | number>,
  select = "*",
) => (await db(table + "?" + params({ ...filters, select, limit: 1 })))[0];
async function worksiteSnapshot(db: DB, owner: string, work: string) {
  const [byName, byCode] = await Promise.all([
    db(
      "obras?" +
        params({
          owner_id: "eq." + owner,
          nombre: "eq." + work,
          select: "id,codigo,nombre,municipio",
          limit: 2,
        }),
    ),
    db(
      "obras?" +
        params({
          owner_id: "eq." + owner,
          codigo: "eq." + work,
          select: "id,codigo,nombre,municipio",
          limit: 2,
        }),
    ),
  ]);
  const rows = [
    ...new Map([...byName, ...byCode].map((r) => [r.id, r])).values(),
  ];
  if (rows.length !== 1 || !rows[0].nombre?.trim())
    throw partFail(
      "No se puede identificar una única obra autorizada. Revisa su nombre en Configuración.",
      409,
    );
  return {
    id: rows[0].id,
    // Legacy works store their reference in nombre; identity remains the owner-scoped UUID.
    // Do not invent or persist an official code when it has never been configured.
    code: rows[0].codigo?.trim() || "",
    name: rows[0].nombre,
    municipality: rows[0].municipio || "",
  };
}
async function assetInput(
  input: any,
  purpose: "attachment" | "signature",
  id: string,
): Promise<any> {
  if (
    !input ||
    typeof input.base64 !== "string" ||
    input.base64.length > 2000000 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)
  )
    throw partFail("Archivo no válido o demasiado grande.", 400);
  const bytes = Buffer.from(input.base64, "base64");
  if (
    bytes.length < 40 ||
    bytes.length > 1500000 ||
    bytes.toString("base64") !== input.base64
  )
    throw partFail("Archivo no válido.", 400);
  const mime = String(input.mime || "");
  if (purpose === "signature" && mime !== "image/png")
    throw partFail("La firma debe ser PNG.", 400);
  try {
    if (mime === "application/pdf") {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
      if (pdf.getPageCount() > 40)
        throw partFail("Máximo cuarenta páginas por anexo.", 400);
    } else if (mime === "image/png" || mime === "image/jpeg") {
      const doc = await PDFDocument.create();
      const image =
        mime === "image/png"
          ? await doc.embedPng(bytes)
          : await doc.embedJpg(bytes);
      new jsPDF().getImageProperties(new Uint8Array(bytes));
      if (
        image.width > 5000 ||
        image.height > 5000 ||
        image.width < 2 ||
        image.height < 2
      )
        throw partFail("Dimensiones de imagen no admitidas.", 400);
    } else throw partFail("Solo se admiten PDF, PNG y JPEG.", 400);
  } catch (e: any) {
    if (e.status === 400) throw e;
    throw partFail(
      "El archivo está dañado o no puede incorporarse al documento.",
      400,
    );
  }
  return {
    id,
    purpose,
    name: String(input.name || "Firma")
      .replace(/[\r\n]/g, " ")
      .slice(0, 160),
    mime,
    bytes: bytes.length,
    sha256: partsDigest(bytes),
    base64: input.base64,
  };
}
const visiblePart = (p: PartRecord, actor: PartActor): PartRecord =>
  actor.role === "foreman"
    ? { ...p, comparableIds: [], comparison: undefined, elevation: undefined }
    : p;
export function madridDayStart(day: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(day + "T00:00:00Z")) ||
    new Date(day + "T00:00:00Z").toISOString().slice(0, 10) !== day
  )
    throw partFail("Fecha no válida.", 400);
  const desired = Date.parse(day + "T00:00:00Z");
  let instant = desired;
  for (let n = 0; n < 3; n++) {
    const fields = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Madrid",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(instant))
        .map((p) => [p.type, p.value]),
    );
    instant -=
      Date.UTC(
        Number(fields.year),
        Number(fields.month) - 1,
        Number(fields.day),
        Number(fields.hour),
        Number(fields.minute),
        Number(fields.second),
      ) - desired;
  }
  return new Date(instant).toISOString();
}
const publicAsset = (a: any): PartAsset => ({
  id: a.id,
  name: a.name,
  mime: a.mime,
  bytes: a.bytes,
  sha256: a.sha256,
});
export function createPartsHandler(deps: Dependencies) {
  return async (req: any, res: any) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (req.method !== "POST")
        return res.status(405).json({ ok: false, message: "Utiliza POST." });
      if (!deps.configured())
        throw partFail("El servidor del módulo no está configurado.", 503);
      let b: any;
      try {
        b =
          typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      } catch {
        throw partFail("Solicitud no válida.", 400);
      }
      if (Buffer.byteLength(JSON.stringify(b)) > 3100000)
        throw partFail("Reduce los anexos antes de enviar.", 413);
      const db = deps.db,
        now = deps.now();
      let actor: PartActor,
        owner: string,
        access: any = null;
      if (typeof b.token === "string") {
        if (!/^[a-f0-9]{48}$/i.test(b.token))
          throw partFail("Acceso de obra no válido.", 403);
        access = await one(
          db,
          "foreman_portal_access",
          { token_hash: "eq." + partsDigest(b.token), active: "eq.true" },
          "id,owner_id,obra,foreman_name,token_hash,active",
        );
        if (!access)
          throw partFail("Acceso de obra revocado o no válido.", 403);
        owner = access.owner_id;
        actor = {
          id: access.id,
          name: access.foreman_name,
          role: "foreman",
          method: "worksite_access",
        };
      } else {
        const user = await deps.authenticate(req);
        owner = user.id;
        actor = {
          id: user.id,
          name: "",
          role: "supervisor",
          method: "supabase_session",
        };
      }
      const profile = await one(
        db,
        "profiles",
        { id: "eq." + owner, active: "eq.true" },
        "id,role,nombre,apellidos",
      );
      if (!profile || !["admin", "user"].includes(profile.role))
        throw partFail("Cuenta no activa o no autorizada.", 403);
      if (actor.role === "supervisor")
        actor.name =
          [profile.nombre, profile.apellidos].filter(Boolean).join(" ") ||
          "Supervisor";
      let p: PartRecord | null = null;
      if (b.id) {
        if (!uuid(b.id)) throw partFail("Identificador no válido.", 400);
        const row = await one(db, "parts_records", {
          id: "eq." + b.id,
          owner_id: "eq." + owner,
          ...(access ? { access_id: "eq." + access.id } : {}),
        });
        if (row) {
          p = row.state;
          if (access && p!.blockedAt)
            throw partFail("Registro bloqueado por conservación.", 403);
        } else if (b.action !== "create")
          throw partFail("Registro no accesible.", 404);
      }
      const scopedWork =
        p?.worksite ||
        (access && ["context", "create"].includes(b.action)
          ? await worksiteSnapshot(db, owner, access.obra)
          : null);
      const policyRow = scopedWork
        ? await one(db, "parts_policies", {
            owner_id: "eq." + owner,
            worksite_id: "eq." + scopedWork.id,
          })
        : null;
      const policy: PartPolicy | null = policyRow?.policy || null;
      const context = () => ({
        actor,
        owner,
        policy,
        policyRevision: policyRow?.revision || 0,
      });
      if (b.action === "push-config")
        return res.json({ ok: true, ...partsPushConfig() });
      if (b.action === "notifications-read") {
        if (actor.role !== "supervisor")
          throw partFail("Operación no permitida.", 403);
        await db(
          "parts_notifications?" +
            params({
              owner_id: "eq." + owner,
              recipient: "eq.supervisor",
              read_at: "is.null",
            }),
          { read_at: now },
          "PATCH",
        );
        return res.json({ ok: true });
      }
      if (b.action === "push-disable") {
        if (typeof b.endpoint !== "string" || b.endpoint.length > 2048)
          throw partFail("Dispositivo no válido.", 400);
        await db(
          "parts_push_subscriptions?" +
            params({
              owner_id: "eq." + owner,
              role: "eq." + actor.role,
              endpoint: "eq." + b.endpoint,
              ...(access ? { access_id: "eq." + access.id } : {}),
            }),
          { active: false },
          "PATCH",
        );
        return res.json({ ok: true });
      }
      if (b.action === "push-register")
        return res.json({
          ok: true,
          ...(await registerPartsPush(
            db,
            owner,
            actor,
            access,
            b.subscription,
          )),
        });
      if (b.action === "context") {
        let works = access
          ? [
              {
                id: access.id,
                obra: access.obra,
                foreman_name: access.foreman_name,
                active: access.active,
              },
            ]
          : await db(
              "foreman_portal_access?" +
                params({
                  owner_id: "eq." + owner,
                  select: "id,obra,foreman_name,active",
                  order: "obra",
                  limit: 200,
                }),
            );
        if (access) works[0] = { ...works[0], worksite: scopedWork! };
        let workers: any[] = [];
        if (access) {
          for (let offset = 0; offset < 2000; offset += 250) {
            const rows = await db(
              "trabajadores?" +
                params({
                  owner_id: "eq." + owner,
                  obra: "eq." + access.obra,
                  select:
                    "id,apellidos_nombre,categoria,periodo_inicio,periodo_fin",
                  order: "id",
                  offset,
                  limit: 250,
                }),
            );
            workers.push(...rows);
            if (rows.length < 250) break;
            if (offset === 1750)
              throw partFail(
                "Demasiados trabajadores. Acota el ámbito de obra.",
                413,
              );
          }
        }
        return res.json({
          ok: true,
          ...context(),
          works,
          workers,
          serverTime: now,
        });
      }
      if (b.action === "list") {
        const filters: Record<string, string | number> = {
          owner_id: "eq." + owner,
          ...(access ? { access_id: "eq." + access.id } : {}),
          ...(access ? { "state->>blockedAt": "is.null" } : {}),
          select:
            "id,number,kind,status,revision,version,work,worker_id,updated_at,worker_name:state->worker->>name,reason:state->content->>reason,priority:state->content->>priority",
          order: "updated_at.desc,id.desc",
          limit: 26,
        };
        for (const [key, column] of Object.entries({
          work: "work",
          workerId: "worker_id",
          status: "status",
          kind: "kind",
          reason: "state->content->>reason",
          priority: "state->content->>priority",
        })) {
          if (b.filters?.[key]) {
            const v = String(b.filters[key]);
            if (v.length > 200 || /[(),]/.test(v))
              throw partFail("Filtro no válido.", 400);
            filters[column] = "eq." + v;
          }
        }
        if (b.cursor) {
          if (!uuid(b.cursor.id) || !Number.isFinite(Date.parse(b.cursor.at)))
            throw partFail("Página no válida.", 400);
          filters.or = `(updated_at.lt.${b.cursor.at},and(updated_at.eq.${b.cursor.at},id.lt.${b.cursor.id}))`;
        }
        if (b.filters?.workerId && !/^[0-9]+$/.test(String(b.filters.workerId)))
          throw partFail("ID de trabajador no válido.", 400);
        let fromInstant = "",
          untilInstant = "";
        if (b.filters?.from) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(b.filters.from))
            throw partFail("Fecha no válida.", 400);
          fromInstant = madridDayStart(b.filters.from);
          filters["state->content->>occurredAt"] = "gte." + fromInstant;
        }
        if (b.filters?.to) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(b.filters.to))
            throw partFail("Fecha no válida.", 400);
          madridDayStart(b.filters.to);
          untilInstant = madridDayStart(
            new Date(Date.parse(b.filters.to + "T00:00:00Z") + 86400000)
              .toISOString()
              .slice(0, 10),
          );
          filters.and = `(state->content->>occurredAt.lt.${untilInstant})`;
        }
        if (
          b.filters?.repetition &&
          (access || !["1", "2", "3"].includes(String(b.filters.repetition)))
        )
          throw partFail("Filtro de seguimiento no autorizado.", 403);
        const rows = b.filters?.repetition
            ? await db("rpc/parts_list_repetition", {
                p_owner: owner,
                p_filters: { ...b.filters, fromInstant, untilInstant },
                p_before: b.cursor || null,
              })
            : await db("parts_records?" + params(filters)),
          more = rows.length > 25;
        rows.splice(25);
        const last = rows.at(-1);
        const counts = await db("rpc/parts_summary", {
          p_owner: owner,
          p_access: access?.id || null,
          p_worker: b.filters?.workerId ? Number(b.filters.workerId) : null,
          p_work: b.filters?.work || null,
        });
        return res.json({
          ok: true,
          rows,
          counts,
          cursor: more ? { id: last.id, at: last.updated_at } : null,
        });
      }
      if (b.action === "policy") {
        if (actor.role !== "supervisor")
          throw partFail(
            "Solo el supervisor puede configurar el seguimiento.",
            403,
          );
        const v = b.policy as PartPolicy;
        if (!uuid(b.worksiteId))
          throw partFail("Selecciona la obra de la política.", 400);
        if (
          !(await one(
            db,
            "obras",
            { id: "eq." + b.worksiteId, owner_id: "eq." + owner },
            "id",
          ))
        )
          throw partFail("Obra no autorizada.", 403);
        if (
          !v ||
          [
            "employer",
            "agreement",
            "reviewedBy",
            "legalBasis",
            "authority",
          ].some(
            (k) =>
              typeof (v as any)[k] !== "string" || (v as any)[k].length > 1500,
          ) ||
          !v.employer?.trim() ||
          !v.agreement?.trim() ||
          !v.reviewedBy?.trim() ||
          !v.legalBasis?.trim() ||
          !v.authority?.trim() ||
          !Number.isInteger(v.windowDays) ||
          v.windowDays < 1 ||
          v.windowDays > 365 ||
          !Number.isInteger(v.retentionDays) ||
          v.retentionDays < v.windowDays ||
          v.retentionDays > 3650 ||
          !Array.isArray(v.reasons) ||
          v.reasons.length > 30 ||
          v.reasons.length < 9 ||
          v.reasons.some(
            (x) =>
              !x ||
              !/^([a-z][a-z0-9_-]{1,79})$/.test(x.id) ||
              typeof x.label !== "string" ||
              !x.label.trim() ||
              x.label.length > 160 ||
              typeof x.requiresReview !== "boolean",
          ) ||
          new Set(v.reasons.map((x) => x.id)).size !== v.reasons.length
        )
          throw partFail(
            "Revisa la validación jurídica y los plazos de la política.",
            400,
          );
        for (const [id, , mandatory] of PART_REASONS)
          if (
            mandatory &&
            !v.reasons.some((x) => x.id === id && x.requiresReview)
          )
            throw partFail("Los motivos preventivos requieren revisión.", 400);
        const next = { ...v, reviewedAt: now };
        const result = await db("rpc/parts_update_policy", {
          p_owner: owner,
          p_worksite: b.worksiteId,
          p_expected: b.expected || 0,
          p_policy: next,
          p_actor: actor,
        });
        return res.json({ ok: true, policy: result });
      }
      if (b.action === "create" && !p) {
        if (
          !access ||
          !uuid(b.id) ||
          !uuid(b.operationId) ||
          !Number.isSafeInteger(b.workerId)
        )
          throw partFail("Selecciona obra y trabajador.", 400);
        const worker = await one(
          db,
          "trabajadores",
          {
            owner_id: "eq." + owner,
            id: "eq." + b.workerId,
            obra: "eq." + access.obra,
          },
          "id,apellidos_nombre,categoria,periodo_inicio,periodo_fin",
        );
        if (!worker) throw partFail("Trabajador fuera de la obra.", 403);
        const content = validatePartContent(b.content, false, policy);
        if (content.attachments.length)
          throw partFail("Guarda el borrador antes de adjuntar archivos.", 400);
        if (b.kind !== "service" && b.kind !== "incident")
          throw partFail("Tipo no válido.", 400);
        p = {
          worksite: scopedWork!,
          id: b.id,
          number: "Pendiente",
          ownerId: owner,
          workerId: b.workerId,
          worker: {
            name: worker.apellidos_nombre,
            category: worker.categoria,
            periodStart: worker.periodo_inicio,
            periodEnd: worker.periodo_fin,
          },
          work: access.obra,
          foremanAccessId: access.id,
          foremanName: access.foreman_name,
          kind: needsPartReview(content, policy) ? "incident" : b.kind,
          status: "draft",
          revision: 0,
          version: 1,
          contentHash: "",
          content,
          createdAt: now,
          updatedAt: now,
          comparableIds: [],
        };
      }
      if (!p) throw partFail("Operación no disponible.", 400);
      const existingAssets = ["attachment", "edit"].includes(b.action)
        ? await db(
            "parts_assets?" +
              params({
                record_id: "eq." + p.id,
                select: "id,sha256,mime,bytes,name,purpose,revision",
                purpose: "eq.attachment",
                limit: 20,
              }),
          )
        : [];
      const comparable =
        policy &&
        ["create", "edit", "submit", "detail", "compare", "elevate"].includes(
          b.action,
        )
          ? await db(
              "parts_records?" +
                params({
                  owner_id: "eq." + owner,
                  worker_id: "eq." + p.workerId,
                  worksite_id: "eq." + p.worksite.id,
                  "state->content->>reason": "eq." + p.content.reason,
                  "state->content->>occurredAt":
                    "gte." +
                    new Date(
                      Date.parse(now) - policy.windowDays * 86400000,
                    ).toISOString(),
                  order: "created_at.desc",
                  limit: 101,
                }),
            )
          : [];
      const eligible = comparable
        .map((r: any) => r.state)
        .filter((r: PartRecord) => eligiblePart(r, p!, policy, now));
      if (b.action === "attachment") {
        if (
          actor.role !== "foreman" ||
          !["draft", "returned"].includes(p.status) ||
          p.blockedAt
        )
          throw partFail("No se puede adjuntar a esta versión.", 403);
        const asset = await assetInput(b.file, "attachment", randomUUID());
        const duplicate = existingAssets.find(
          (a: any) => a.sha256 === asset.sha256,
        );
        if (duplicate)
          return res.json({ ok: true, asset: publicAsset(duplicate) });
        if (existingAssets.length >= 12)
          throw partFail(
            "Revisa los anexos existentes antes de añadir más.",
            413,
          );
        await db(
          "parts_assets",
          { ...asset, record_id: p.id, revision: p.revision },
          "POST",
        );
        const saved = await one(db, "parts_assets", {
          record_id: "eq." + p.id,
          revision: "eq." + p.revision,
          purpose: "eq.attachment",
          sha256: "eq." + asset.sha256,
        });
        return res.json({ ok: true, asset: publicAsset(saved) });
      }
      if (b.action === "create" && eligible.length && p.kind === "service")
        p.kind = "incident";
      if (b.action === "detail")
        return res.json({
          ok: true,
          policyRevision: policyRow?.revision || 0,
          record: visiblePart(p, actor),
          comparable: eligible
            .filter(
              (r: PartRecord) => !access || r.foremanAccessId === access.id,
            )
            .slice(0, 100)
            .map((r: PartRecord) => ({
              id: r.id,
              number: r.number,
              date: r.content.occurredAt,
              work: r.work,
              reason: r.content.reason,
            })),
          policy,
          history: await db(
            "parts_events?" +
              params({
                record_id: "eq." + p.id,
                select: "revision,action,actor_id,created_at",
                order: "revision.desc",
                limit: 50,
              }),
          ),
        });
      if (b.action === "push-retry")
        return res.json({
          ok: true,
          push: await dispatchPartsPush(db, p.id, p.revision),
        });
      if (b.action === "file" || b.action === "pdf") {
        if (
          b.intent === "share" &&
          (!p.foremanSignature ||
            ["draft", "returned", "submitted", "review"].includes(p.status) ||
            (p.kind === "incident" && !p.supervisorSignature))
        )
          throw partFail(
            "Este documento no está autorizado para comunicar al trabajador.",
          );
        let file: any;
        if (b.action === "file") {
          if (!uuid(b.assetId)) throw partFail("Archivo no válido.", 400);
          file = await one(db, "parts_assets", {
            id: "eq." + b.assetId,
            record_id: "eq." + p.id,
          });
        } else {
          const revision = b.revision == null ? p.revision : Number(b.revision);
          if (!Number.isInteger(revision) || revision < 1)
            throw partFail("Versión no válida.", 400);
          const event = await one(db, "parts_events", {
            record_id: "eq." + p.id,
            revision: "eq." + revision,
          });
          if (!event) throw partFail("Versión no disponible.", 404);
          const snapshot = event.snapshot as PartRecord;
          if (partContentHash(snapshot) !== snapshot.contentHash)
            throw partFail(
              "La versión no supera el control de integridad.",
              409,
            );
          if (access && snapshot.elevation)
            throw partFail(
              "La propuesta recopilatoria está restringida al supervisor.",
              403,
            );
          if (snapshot.blockedAt || p.blockedAt)
            throw partFail("Documento bloqueado por conservación.", 403);
          file = await one(db, "parts_assets", {
            record_id: "eq." + p.id,
            revision: "eq." + revision,
            purpose: "eq.pdf",
          });
          if (!file) {
            const assets = await db(
              "parts_assets?" +
                params({
                  record_id: "eq." + p.id,
                  select: "id,base64,sha256,mime",
                  purpose: "neq.pdf",
                  limit: 200,
                }),
            );
            for (const a of assets)
              if (partsDigest(Buffer.from(a.base64, "base64")) !== a.sha256)
                throw partFail(
                  "El archivo no supera la comprobación de integridad.",
                  409,
                );
            const bytes = await generatePartPdf(
              snapshot,
              assets,
              eligible.filter((r: PartRecord) =>
                snapshot.elevation?.recordIds.includes(r.id),
              ),
            );
            const candidate = {
              id: randomUUID(),
              record_id: p.id,
              revision,
              purpose: "pdf",
              name:
                p.number + "-v" + snapshot.version + "-r" + revision + ".pdf",
              mime: "application/pdf",
              bytes: bytes.length,
              sha256: partsDigest(bytes),
              base64: Buffer.from(bytes).toString("base64"),
            };
            await db("parts_assets", candidate, "POST");
            file = await one(db, "parts_assets", {
              record_id: "eq." + p.id,
              revision: "eq." + revision,
              purpose: "eq.pdf",
            });
          }
        }
        if (b.action === "file" && file?.purpose === "pdf")
          throw partFail("Abre la copia desde su versión autorizada.", 403);
        if (!file) throw partFail("Archivo no disponible.", 404);
        if (p.blockedAt) throw partFail("Documento bloqueado.", 403);
        if (partsDigest(Buffer.from(file.base64, "base64")) !== file.sha256)
          throw partFail("Integridad del documento no válida.", 409);
        return res.json({
          ok: true,
          file: {
            base64: file.base64,
            sha256: file.sha256,
            filename: file.name,
            mime: file.mime,
          },
        });
      }
      if (
        !uuid(b.operationId) ||
        !Number.isInteger(b.expected) ||
        b.expected < 0
      )
        throw partFail("Falta la versión o la operación.", 400);
      const fingerprint = partsDigest(
        stable({
          action: b.action,
          command: b.command,
          content: b.content,
          kind: b.kind,
          workerId: b.workerId,
          id: b.id,
          expected: b.expected,
        }),
      );
      const replay = await one(db, "parts_events", {
        record_id: "eq." + p.id,
        operation_id: "eq." + b.operationId,
      });
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          throw partFail("La operación fue reutilizada con otro contenido.");
        return res.json({
          ok: true,
          record: visiblePart(replay.snapshot, actor),
          replayed: true,
          push: await dispatchPartsPush(db, p.id, replay.revision),
        });
      }
      if (p.revision !== b.expected)
        throw partFail("La versión ha cambiado. Actualiza antes de continuar.");
      const newAssets: any[] = [];
      const command = { ...(b.command || {}), type: b.action } as PartCommand;
      if (command.signature) {
        const asset = await assetInput(
          command.signature,
          "signature",
          randomUUID(),
        );
        newAssets.push(asset);
        command.signature = publicAsset(asset);
      }
      if (command.content) {
        command.content = validatePartContent(command.content, false, policy);
        for (const a of command.content.attachments)
          if (
            !existingAssets.some(
              (e: any) =>
                e.id === a.id &&
                e.sha256 === a.sha256 &&
                e.purpose === "attachment",
            )
          )
            throw partFail("Anexo ajeno o no verificado.", 403);
      }
      if (
        b.action === "elevate" &&
        p.comparableIds.some(
          (id) => !eligible.some((r: PartRecord) => r.id === id),
        )
      )
        throw partFail("Revisa los antecedentes: alguno ya no computa.");
      if (b.action === "compare") {
        if (
          !command.recordIds?.every((id) =>
            eligible.some((r: PartRecord) => r.id === id),
          )
        )
          throw partFail(
            "Uno de los antecedentes no es comparable o ya no computa.",
          );
      }
      if (
        ["submit", "authorize", "receipt", "elevate", "remit"].includes(
          b.action,
        ) &&
        !policy
      )
        throw partFail(
          "La obra está pendiente de validar entidad empleadora, convenio y política de tratamiento. El borrador se conserva.",
        );
      if (b.action === "submit") {
        validatePartContent(p.content, true, policy);
        if (Date.parse(p.content.occurredAt) > Date.parse(now) + 300000)
          throw partFail("No se pueden declarar hechos futuros.", 400);
        const worker = await one(
          db,
          "trabajadores",
          {
            owner_id: "eq." + owner,
            id: "eq." + p.workerId,
            obra: "eq." + p.work,
          },
          "id,apellidos_nombre,categoria,periodo_inicio,periodo_fin",
        );
        if (!worker)
          throw partFail("La contratación ya no pertenece a esta obra.", 403);
        if (
          actor.name !== p.foremanName ||
          worker.apellidos_nombre !== p.worker.name ||
          worker.categoria !== p.worker.category ||
          worker.periodo_inicio !== p.worker.periodStart ||
          worker.periodo_fin !== p.worker.periodEnd
        )
          throw partFail(
            "La contratación ha cambiado. Corrige y guarda el borrador antes de firmar.",
          );
        const day = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Madrid",
        }).format(new Date(p.content.occurredAt));
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(p.worker.periodStart) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(p.worker.periodEnd) ||
          day < p.worker.periodStart ||
          day > p.worker.periodEnd
        )
          throw partFail(
            "El hecho debe estar dentro del periodo de contratación verificado.",
          );
      }
      let next: PartRecord;
      if (b.action === "create") {
        next = { ...p, revision: 1 };
        next.contentHash = partContentHash(next);
      } else {
        next = applyPartCommand(p, command, {
          actor,
          now,
          policy,
          comparableCount: eligible.length,
        });
        if (b.action === "edit") {
          const w = await one(
            db,
            "trabajadores",
            {
              owner_id: "eq." + owner,
              id: "eq." + p.workerId,
              obra: "eq." + p.work,
            },
            "id,apellidos_nombre,categoria,periodo_inicio,periodo_fin",
          );
          if (!w) throw partFail("Trabajador fuera de la obra.", 403);
          if (access) next.foremanName = access.foreman_name;
          next.worker = {
            name: w.apellidos_nombre,
            category: w.categoria,
            periodStart: w.periodo_inicio,
            periodEnd: w.periodo_fin,
          };
          next.contentHash = partContentHash(next);
        }
      }
      if (b.action === "compare")
        next.comparison = eligible
          .filter((r: PartRecord) => next.comparableIds.includes(r.id))
          .map((r: PartRecord) => ({ id: r.id, revision: r.revision }));
      if (b.action === "elevate")
        next.elevation!.references = eligible
          .filter((r: PartRecord) => next.comparableIds.includes(r.id))
          .map((r: PartRecord) => ({
            id: r.id,
            revision: r.revision,
            number: r.number,
            work: r.work,
            version: r.version,
            contentHash: r.contentHash,
            content: r.content,
            receiptMode: r.receipt?.mode,
          }));
      if (
        [
          "submit",
          "authorize",
          "receipt",
          "resolve-dispute",
          "elevate",
          "remit",
          "close",
          "annul",
          "archive",
          "dismiss",
        ].includes(b.action)
      ) {
        const signatures = [
          next.foremanSignature,
          next.supervisorSignature,
          next.receipt?.signature,
          next.receiptReview?.signature,
          next.elevation?.signature,
        ].filter(Boolean);
        const missing = [...new Set(signatures.map((s) => s!.asset.id))].filter(
          (id) => !newAssets.some((a) => a.id === id),
        );
        const stored = missing.length
          ? await db(
              "parts_assets?" +
                params({
                  record_id: "eq." + p.id,
                  id: "in.(" + missing.join(",") + ")",
                  select: "id,base64,mime,sha256",
                  purpose: "eq.signature",
                  limit: 6,
                }),
            )
          : [];
        for (const asset of stored)
          if (partsDigest(Buffer.from(asset.base64, "base64")) !== asset.sha256)
            throw partFail("La firma no supera la comprobación de integridad.");
        const bytes = await generatePartPdf(next, [...stored, ...newAssets]);
        if (bytes.length > 3000000)
          throw partFail(
            "El documento generado supera el límite. Reduce los anexos.",
            413,
          );
        newAssets.push({
          id: randomUUID(),
          purpose: "pdf",
          name:
            next.number + "-v" + next.version + "-r" + next.revision + ".pdf",
          mime: "application/pdf",
          bytes: bytes.length,
          sha256: partsDigest(bytes),
          base64: Buffer.from(bytes).toString("base64"),
        });
      }
      const result = await db("rpc/parts_commit", {
        p_id: p.id,
        p_owner: owner,
        p_worker: p.workerId,
        p_work: p.work,
        p_access: p.foremanAccessId,
        p_access_hash: access?.token_hash || null,
        p_actor: actor.role === "supervisor" ? actor.id : null,
        p_expected: b.expected,
        p_operation: b.operationId,
        p_fingerprint: fingerprint,
        p_action: b.action,
        p_state: next,
        p_assets: newAssets,
      });
      return res.json({
        ok: true,
        record: visiblePart(result.state, actor),
        replayed: result.replayed,
        push: await dispatchPartsPush(db, p.id, result.state.revision),
      });
    } catch (e: any) {
      deps.onError?.(e);
      const status = [400, 401, 403, 404, 409, 413, 503].includes(e?.status)
        ? e.status
        : 503;
      return res.status(status).json({
        ok: false,
        code: status === 503 ? "PART_UNAVAILABLE" : e.code || "PART_REJECTED",
        message:
          status === 503
            ? "No se pudo confirmar la operación. Conserva el trabajo y actualiza antes de reintentar."
            : e.message,
      });
    }
  };
}
async function partsDatabase(path: string, body?: any, method?: string) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      apikey: SERVICE_KEY,
      Authorization: "Bearer " + SERVICE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=representation,resolution=ignore-duplicates",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw partFail(
      response.status === 409 || result?.code === "PT409"
        ? "La versión ha cambiado. Actualiza antes de reintentar."
        : "No se pudo completar la operación.",
      response.status === 403
        ? 403
        : response.status === 409 || result?.code === "PT409"
          ? 409
          : 503,
    );
  return result;
}
export const partsHandler = createPartsHandler({
  db: partsDatabase,
  authenticate: authenticateRequest,
  now: () => new Date().toISOString(),
  configured: () => !!SERVICE_KEY && !!PUBLIC_KEY,
});
