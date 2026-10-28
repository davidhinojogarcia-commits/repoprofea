import { reportOperationalError } from "../lib/operationalLog.js";
import UPNG from "@pdf-lib/upng";
import { createHash } from "node:crypto";
import { partsDatabase, worksiteSnapshot, assetInput } from "./partsHandler.js";
import { SERVICE_KEY, PUBLIC_KEY, authenticateRequest } from "./gmailOAuth.js";
import { uuid } from "../lib/parts/domain.js";
import {
  DOCUMENT_KINDS,
  cleanContent,
  validateDocument,
  fail,
  day,
  type WorkforceDocument,
  type Actor,
} from "../lib/workforceDocuments/domain.js";
import { workforcePdf } from "../lib/workforceDocuments/pdf.js";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const stable = (v: any) => JSON.stringify(canonical(v));
const workerLabels = (
  w: { name?: string; code?: string },
  access?: { obra?: string },
) =>
  [
    w.name,
    w.code,
    w.name?.replace(/^\d{5}\s+(?:GR|EE)\s+/i, ""),
    access?.obra,
  ].filter(Boolean) as string[];
const workerBelongs = (
  t: any,
  w: { id: string; name?: string; code?: string },
  access?: { obra?: string },
) =>
  t &&
  (t.obra_id
    ? t.obra_id === w.id
    : workerLabels(w, access).some(
        (v) =>
          v.trim().toLocaleLowerCase("es") ===
          String(t.obra).trim().toLocaleLowerCase("es"),
      ));
export const documentHash = (p: WorkforceDocument) =>
  hash(
    stable({
      id: p.id,
      owner: p.ownerId,
      workerId: p.workerId,
      kind: p.kind,
      version: p.version,
      worksite: p.worksite,
      worker: p.worker,
      foreman: p.foreman,
      content: p.content,
    }),
  );
type DB = (path: string, body?: any, method?: string) => Promise<any>;
const query = (table: string, filters: Record<string, any>) =>
  table + "?" + new URLSearchParams(filters).toString();
const one = async (db: DB, t: string, f: Record<string, any>, select = "*") =>
  (await db(query(t, { ...f, select, limit: 1 })))[0];
const summary = (r: any) => ({
  id: r.id,
  kind: r.kind,
  revision: r.revision,
  status: r.status,
  version: Number(r.version),
  workerName: r.worker_name,
  updatedAt: r.updated_at,
});
let lastPersistenceErrorAt = 0;
export function createWorkforceDocumentsHandler(deps: {
  db: DB;
  authenticate: typeof authenticateRequest;
  now: () => string;
  configured: () => boolean;
}) {
  return async (req: any, res: any) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (req.method !== "POST") throw fail("Utiliza POST.", 405);
      if (!deps.configured())
        throw fail("Servidor documental no disponible.", 503);
      let b: any;
      try {
        b =
          typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      } catch {
        throw fail("Solicitud no válida.");
      }
      if (Buffer.byteLength(JSON.stringify(b)) > 2200000)
        throw fail("Solicitud demasiado grande.", 413);
      const db = deps.db,
        now = deps.now();
      let owner: string,
        access: any = null,
        actor: Actor;
      if (typeof b.token === "string") {
        if (!/^[a-f0-9]{48}$/i.test(b.token))
          throw fail("Acceso no válido.", 403);
        access = await one(
          db,
          "foreman_portal_access",
          { token_hash: "eq." + hash(b.token), active: "eq.true" },
          "id,owner_id,obra,foreman_name",
        );
        if (!access) throw fail("Acceso revocado o no autorizado.", 403);
        owner = access.owner_id;
        actor = {
          id: access.id,
          name: access.foreman_name,
          role: "foreman",
          method: "worksite_access",
        };
      } else {
        const u = await deps.authenticate(req);
        owner = u.id;
        actor = {
          id: u.id,
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
        throw fail("Cuenta no autorizada.", 403);
      if (!access)
        actor.name =
          [profile.nombre, profile.apellidos].filter(Boolean).join(" ") ||
          "Supervisor";
      if (b.kind && !Object.hasOwn(DOCUMENT_KINDS, b.kind))
        throw fail("Tipo no admitido.");
      let row: any = null,
        p: WorkforceDocument | null = null;
      if (b.id) {
        if (!uuid(b.id)) throw fail("Identificador no válido.");
        row = await one(db, "workforce_documents", {
          id: "eq." + b.id,
          owner_id: "eq." + owner,
        });
        if (row) {
          p = row.state;
          if (access) {
            const site = await worksiteSnapshot(db, owner, access.obra);
            if (p!.worksiteId !== site.id)
              throw fail("Documento de otra obra.", 403);
          }
        } else if (b.action !== "save")
          throw fail("Documento no accesible.", 404);
      }
      let work: any;
      async function scope() {
        if (work) return work;
        const base = await worksiteSnapshot(
          db,
          owner,
          access ? access.obra : String(b.work || ""),
        );
        const r = await one(
          db,
          "obras",
          { id: "eq." + base.id, owner_id: "eq." + owner },
          "id,codigo,nombre,municipio,empresa,cif,recurso_preventivo",
        );
        return (work = {
          ...base,
          employer: r.empresa || "",
          cif: r.cif || "",
          foreman: r.recurso_preventivo || "",
        });
      }
      if (b.action === "context")
        return res.json({ ok: true, actor, owner, worksite: await scope() });
      if (b.action === "workers") {
        const w = await scope();
        const search = String(b.search || "").trim();
        if (search.length > 120) throw fail("Búsqueda demasiado larga.");
        const f: any = {
          owner_id: "eq." + owner,
          select: "id,apellidos_nombre,categoria,periodo_inicio,periodo_fin",
          order: "apellidos_nombre,id",
          limit: 30,
          offset: Math.max(0, Math.min(10000, Number(b.offset) || 0)),
        };
        // Canonical obra_id wins; legacy label only when the FK is absent.
        const labels = workerLabels(w, access).map((s) =>
          String(s).replace(/["\\]/g, "\\$&"),
        );
        f.or = `(obra_id.eq.${w.id},and(obra_id.is.null,obra.in.(${labels.map((s) => '"' + s + '"').join(",")})))`;
        if (search)
          f.apellidos_nombre =
            "ilike.*" + search.replace(/[%_*(),.]/g, "") + "*";
        return res.json({
          ok: true,
          workers: await db(query("trabajadores", f)),
        });
      }
      if (b.action === "list") {
        const w = await scope();
        const f: any = {
          owner_id: "eq." + owner,
          worksite_id: "eq." + w.id,
          select:
            "id,kind,revision,worker_name:state->worker->>name,status:state->>status,version:state->>version,updated_at",
          order: "updated_at.desc,id",
          limit: 30,
          offset: Math.max(0, Math.min(10000, Number(b.offset) || 0)),
        };
        if (b.kind) f.kind = "eq." + b.kind;
        // State excluded from response: no signatures in list responses.
        const rows = await db(query("workforce_documents", f));
        return res.json({ ok: true, records: rows.map(summary) });
      }
      if (p && b.action === "detail") {
        const history = await db(
          query("workforce_document_events", {
            document_id: "eq." + p.id,
            select: "revision,action,actor,at",
            order: "revision.desc",
            limit: 100,
          }),
        );
        return res.json({ ok: true, record: p, history });
      }
      if (p && b.action === "pdf") {
        let state = p,
          stored = b.returnOnly ? row.return_pdf_base64 : row.pdf_base64;
        if (b.revision !== undefined) {
          if (!Number.isSafeInteger(b.revision) || b.revision < 1)
            throw fail("Revisión no válida.");
          const e = await one(db, "workforce_document_events", {
            document_id: "eq." + p.id,
            revision: "eq." + b.revision,
          });
          if (!e) throw fail("Revisión no disponible.", 404);
          state = e.state;
          stored = b.returnOnly ? e.return_pdf_base64 : e.pdf_base64;
          if (
            !stored &&
            ["completed", "return_recorded", "annulled"].includes(state.status)
          ) {
            const previous = await one(
              db,
              "workforce_document_events",
              {
                document_id: "eq." + p.id,
                revision: "lte." + b.revision,
                ...(b.returnOnly
                  ? { action: "eq.return" }
                  : { action: "eq.sign-foreman" }),
              },
              "pdf_base64,return_pdf_base64",
            );
            stored = b.returnOnly
              ? previous?.return_pdf_base64
              : previous?.pdf_base64;
          }
        }
        if (b.returnOnly && !stored)
          throw fail("No consta diligencia de regreso.", 409);
        const final = !!stored;
        const base64 =
          stored || Buffer.from(workforcePdf(state)).toString("base64");
        return res.json({
          ok: true,
          file: {
            base64,
            mime: "application/pdf",
            filename: `${state.kind}_${state.id}_v${state.version}${b.returnOnly ? "_REGRESO" : final ? "_FIRMADO" : "_BORRADOR"}.pdf`,
          },
        });
      }
      if (
        !uuid(b.id) ||
        !uuid(b.operationId) ||
        !Number.isSafeInteger(b.expected) ||
        b.expected < 0
      )
        throw fail("Falta identificador, revisión u operación.");
      const requestHash = hash(stable({ ...b, token: undefined }));
      if (p) {
        const e = await one(
          db,
          "workforce_document_events",
          { document_id: "eq." + p.id, operation_id: "eq." + b.operationId },
          "request_hash",
        );
        if (e) {
          if (e.request_hash !== requestHash)
            throw fail("La operación ya se usó con otro contenido.", 409);
          return res.json({ ok: true, record: p, replayed: true });
        }
        if (p.revision !== b.expected)
          throw fail(
            "La versión ha cambiado. Actualiza antes de reintentar; tu borrador local se conserva.",
            409,
          );
      }
      if (!p) {
        if (
          b.action !== "save" ||
          b.expected !== 0 ||
          !Object.hasOwn(DOCUMENT_KINDS, b.kind) ||
          !Number.isSafeInteger(b.workerId)
        )
          throw fail("Selecciona documento y trabajador.");
        const w = await scope();
        const t = await one(
          db,
          "trabajadores",
          { owner_id: "eq." + owner, id: "eq." + b.workerId },
          "id,obra_id,obra,apellidos_nombre,dni,categoria,num_oferta,periodo_inicio,periodo_fin",
        );
        if (!workerBelongs(t, w, access))
          throw fail("Trabajador fuera de la obra autorizada.", 403);
        p = {
          id: b.id,
          ownerId: owner,
          workerId: t.id,
          worksiteId: w.id,
          accessId: access?.id || null,
          kind: b.kind,
          revision: 0,
          version: 1,
          status: "draft",
          createdAt: now,
          updatedAt: now,
          worksite: {
            id: w.id,
            code: w.code,
            name: w.name,
            municipality: w.municipality,
            employer: w.employer,
            cif: w.cif,
          },
          worker: {
            name: t.apellidos_nombre,
            dni: t.dni || "",
            category: t.categoria,
            offer: t.num_oferta || "",
            start: t.periodo_inicio || "",
            end: t.periodo_fin || "",
            reference: owner + ":" + t.id,
          },
          foreman: {
            id: access?.id || w.id,
            name: access?.foreman_name || w.foreman,
          },
          content: {},
          hash: "",
          signatures: {},
        };
      }
      if (
        ["save", "prepare", "sign-worker", "sign-foreman"].includes(b.action)
      ) {
        const currentWorker = await one(
          db,
          "trabajadores",
          { owner_id: "eq." + owner, id: "eq." + p.workerId },
          "obra_id,obra",
        );
        if (
          !workerBelongs(
            currentWorker,
            { id: p.worksiteId, ...p.worksite },
            access,
          )
        )
          throw fail(
            "El trabajador ya no figura en la contratación autorizada de esta obra. Se conserva su documentación histórica.",
            409,
          );
      }
      let pdf: string | null = null,
        returnPdf: string | null = null;
      if (b.action === "save") {
        if (!["draft", "prepared", "worker_signed"].includes(p.status))
          throw fail(
            "Conserva el firmado; anúlalo y prepara otro documento para corregirlo.",
            409,
          );
        if (p.revision > 0) p.version++;
        if (b.refreshSnapshot === true) {
          const w = await one(
            db,
            "obras",
            { id: "eq." + p.worksiteId, owner_id: "eq." + owner },
            "id,codigo,nombre,municipio,empresa,cif,recurso_preventivo",
          );
          const t = await one(
            db,
            "trabajadores",
            { id: "eq." + p.workerId, owner_id: "eq." + owner },
            "obra_id,obra,apellidos_nombre,dni,categoria,num_oferta,periodo_inicio,periodo_fin",
          );
          if (
            !w ||
            !workerBelongs(
              t,
              { id: w.id, name: w.nombre, code: w.codigo },
              access,
            )
          )
            throw fail("Revisa la asignación actual del trabajador.", 409);
          p.worksite = {
            id: w.id,
            code: w.codigo || p.worksite.code,
            name: w.nombre,
            municipality: w.municipio || "",
            employer: w.empresa || "",
            cif: w.cif || "",
          };
          p.worker = {
            ...p.worker,
            name: t.apellidos_nombre,
            dni: t.dni || "",
            category: t.categoria,
            offer: t.num_oferta || "",
            start: t.periodo_inicio || "",
            end: t.periodo_fin || "",
          };
          p.foreman = {
            id: access?.id || w.id,
            name: access?.foreman_name || w.recurso_preventivo || "",
          };
        }
        p.content = cleanContent(b.content, p.kind);
        p.signatures = {};
        p.status = "draft";
        p.hash = documentHash(p);
      } else if (b.action === "prepare") {
        if (p.status !== "draft")
          throw fail("El documento no es un borrador editable.", 409);
        validateDocument(p, now);
        p.status = "prepared";
      } else if (b.action === "sign-worker" || b.action === "sign-foreman") {
        if (b.hash !== p.hash || b.version !== p.version)
          throw fail(
            "El contenido visible no coincide con la versión a firmar.",
            409,
          );
        if (b.confirmed !== true) throw fail("Falta la confirmación expresa.");
        if (
          (b.action === "sign-worker" && p.status !== "prepared") ||
          (b.action === "sign-foreman" && p.status !== "worker_signed")
        )
          throw fail("Estado no compatible con esta firma.", 409);
        validateDocument(p, now);
        const image = String(b.image || "");
        if (!image.startsWith("data:image/png;base64,"))
          throw fail("Firma PNG no válida.");
        await assetInput(
          { base64: image.slice(22), mime: "image/png" },
          "signature",
          b.operationId,
        );
        const png = Buffer.from(image.slice(22), "base64");
        if (png.readUInt32BE(16) > 2000 || png.readUInt32BE(20) > 1000)
          throw fail("Firma demasiado grande. Repite el trazo.");
        let pixels: Uint8Array;
        let width: number;
        try {
          const decoder = (UPNG as any).default || UPNG;
          const decoded = decoder.decode(
            png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
          );
          width = decoded.width;
          pixels = new Uint8Array(decoder.toRGBA8(decoded)[0]);
        } catch {
          throw fail("No se puede leer el trazo de firma.");
        }
        let count = 0,
          minX = Infinity,
          minY = Infinity,
          maxX = 0,
          maxY = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (
            pixels[i + 3] > 30 &&
            Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 200
          ) {
            const x = (i / 4) % width,
              y = Math.floor(i / 4 / width);
            count++;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        if (count < 30 || maxX - minX < 16 || maxY - minY < 6)
          throw fail(
            "La imagen no contiene un trazo suficiente. Borra y vuelve a firmar.",
          );
        const role = b.action === "sign-worker" ? "worker" : "foreman";
        const signer: Actor =
          role === "worker"
            ? {
                id: owner + ":" + p.workerId,
                name: p.worker.name,
                role: "worker",
                method: "in_person_screen",
              }
            : {
                id: p.foreman.id,
                name: p.foreman.name,
                role: "foreman",
                method: "in_person_screen",
              };
        p.signatures[role] = {
          image,
          at: now,
          version: p.version,
          hash: p.hash,
          actor: signer,
          capturedBy: actor,
        };
        p.status = role === "worker" ? "worker_signed" : "completed";
      } else if (b.action === "return") {
        if (p.kind !== "salida_obra" || p.status !== "completed")
          throw fail(
            "Solo una salida firmada con regreso pendiente admite diligencia.",
            409,
          );
        const at = String(b.at || ""),
          exit =
            p.content.exitType === "actual"
              ? p.content.exit
              : String(b.actualExit || "");
        const valid = (v: string) =>
          /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
          Number.isFinite(Date.parse(v));
        if (
          !valid(at) ||
          !valid(exit) ||
          Date.parse(exit) >= Date.parse(at) ||
          Date.parse(at) > Date.parse(now) ||
          day(exit) < p.worker.start ||
          day(exit) > p.worker.end
        )
          throw fail(
            "Indica salida y regreso efectivos, completos, coherentes y ya comprobados.",
          );
        if (b.confirmed !== true)
          throw fail("Confirma la comprobación efectiva de las horas.");
        const note = String(b.note || "").trim();
        if (note.length > 4000) throw fail("Observación demasiado larga.");
        p.returnEntry = { at, actualExit: exit, recordedAt: now, actor, note };
        p.status = "return_recorded";
      } else if (b.action === "annul") {
        if (p.status === "annulled") throw fail("Ya está anulado.", 409);
        const reason = String(b.reason || "").trim();
        if (!reason || reason.length > 2000)
          throw fail("Indica el motivo de anulación.");
        p.annulment = { reason, at: now, actor };
        p.status = "annulled";
      } else throw fail("Operación no disponible.");
      p.revision++;
      p.updatedAt = now;
      if (p.status === "completed" && b.action === "sign-foreman")
        pdf = Buffer.from(workforcePdf(p)).toString("base64");
      if (b.action === "return")
        returnPdf = Buffer.from(workforcePdf(p, true)).toString("base64");
      const record = await db("rpc/workforce_document_commit", {
        p_owner: owner,
        p_id: p.id,
        p_expected: b.expected,
        p_operation: b.operationId,
        p_request_hash: requestHash,
        p_action: b.action,
        p_actor: actor,
        p_state: p,
        p_pdf: pdf,
        p_return_pdf: returnPdf,
      });
      return res.json({ ok: true, record });
    } catch (e: any) {
      const status = [400, 401, 403, 404, 405, 409, 413].includes(e?.status)
        ? e.status
        : 503;
      return res.status(status).json({
        ok: false,
        message:
          status === 503
            ? "No se ha confirmado el guardado. Consulta el estado y reintenta la misma operación sin duplicarla."
            : e.message,
      });
    }
  };
}
export const workforceDocumentsHandler = createWorkforceDocumentsHandler({
  db: partsDatabase,
  authenticate: authenticateRequest,
  now: () => new Date().toISOString(),
  configured: () => !!SERVICE_KEY && !!PUBLIC_KEY,
});
