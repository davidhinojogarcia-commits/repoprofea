import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import { build } from "esbuild";
import { randomUUID, createHash } from "node:crypto";
export const id = (n) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const token = "a".repeat(48),
  otherToken = "b".repeat(48),
  wrongWorkToken = "c".repeat(48);
export const now = new Date().toISOString().slice(0, 10) + "T12:00:00.000Z";
export const content = {
  reason: "mobile",
  occurredAt: now.slice(0, 10) + "T10:00:00.000Z",
  place: "Acceso norte",
  facts:
    "Se observó el uso del móvil durante la instrucción. No se midió su duración.",
  instruction: "Guardar el móvil durante la tarea.",
  response: "El trabajador indicó que era una llamada familiar.",
  witnesses: "",
  priority: "ordinary",
  risk: false,
  uncertain: false,
  attachments: [],
};
export const hash = (v) => createHash("sha256").update(v).digest("hex");
export async function partsTestHarness() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
 create table profiles(id uuid primary key,nombre text,apellidos text,active boolean,role text);
 create table obras(id uuid primary key,owner_id uuid,nombre text,codigo text,municipio text);
 create table trabajadores(owner_id uuid,id bigint,obra text,apellidos_nombre text,categoria text,periodo_inicio text,periodo_fin text,primary key(owner_id,id));
 create table foreman_portal_access(id uuid primary key,owner_id uuid,obra text,foreman_name text,token_hash text,active boolean);
 grant usage on schema auth,extensions to service_role,authenticated,anon;
 grant select on profiles to authenticated;grant all on profiles,obras,trabajadores,foreman_portal_access to service_role;`);
  await db.exec(
    await fs.readFile(
      new URL(
        "../supabase/migrations/20261026211733_parts_and_notices.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const n of [1, 2, 3])
    await db.query("insert into profiles values($1,$2,'Prueba',$3,'user')", [
      id(n),
      "Supervisor " + n,
      n !== 3,
    ]);
  for (const [n, owner, work, code] of [
    [20, 1, "Obra A", "11002GR"],
    [21, 1, "Obra B", "11003GR"],
    [22, 2, "Obra A", "11004GR"],
  ])
    await db.query(
      "insert into obras values($1,$2,$3,$4,'Municipio de prueba')",
      [id(n), id(owner), work, code],
    );
  for (const [n, owner, work, accessToken] of [
    [10, 1, "Obra A", token],
    [11, 2, "Obra A", otherToken],
    [12, 1, "Obra B", wrongWorkToken],
  ])
    await db.query(
      "insert into foreman_portal_access values($1,$2,$3,'Encargado de prueba',$4,true)",
      [id(n), id(owner), work, hash(accessToken)],
    );
  for (const [worker, owner, work] of [
    [100, 1, "Obra A"],
    [101, 1, "Obra A"],
    [102, 1, "Obra B"],
    [100, 2, "Obra A"],
  ])
    await db.query(
      "insert into trabajadores values($1,$2,$3,'Persona Homónima','Peón',$4,$5)",
      [
        id(owner),
        worker,
        work,
        now.slice(0, 7) + "-01",
        new Date(Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)), 0))
          .toISOString()
          .slice(0, 10),
      ],
    );
  const approved = {
    employer: "Entidad empleadora de prueba",
    agreement: "Convenio sintético de prueba",
    reviewedBy: "Responsable laboral de prueba",
    reviewedAt: now,
    windowDays: 30,
    retentionDays: 90,
    legalBasis: "Solo prueba técnica, no validación jurídica real.",
    authority: "Personal de prueba",
    reasons: [
      ["mobile", "Móvil", false],
      ["instructions", "Instrucciones", false],
      ["safety", "Prevención", true],
      ["ppe", "EPI", true],
      ["absence", "Ausencia", false],
      ["punctuality", "Puntualidad", false],
      ["equipment", "Maquinaria", true],
      ["interference", "Interferencia", false],
      ["other", "Otras", false],
    ].map(([id, label, requiresReview]) => ({ id, label, requiresReview })),
  };
  await db.query(
    "insert into parts_policies(owner_id,worksite_id,policy) values($1,$2,$3)",
    [id(1), id(20), JSON.stringify(approved)],
  );
  const out = new URL(
    "./.parts-handler-" + randomUUID() + ".mjs",
    import.meta.url,
  );
  await build({
    stdin: {
      contents:
        "export {createPartsHandler,partContentHash,madridDayStart} from './src/server/partsHandler';export * from './src/lib/parts/domain';export {generatePartPdf}from'./src/lib/parts/pdf';export{dispatchPartsPush}from'./src/server/partsPush';",
      resolveDir: new URL("../", import.meta.url).pathname,
    },
    outfile: out.pathname,
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
  });
  const module = await import(out.href);
  const calls = [],
    errors = [];
  let queue = Promise.resolve(),
    loseNext = false,
    beforeCommit = null;
  const ident = (s) => {
    if (!/^[a-z_][a-z_0-9]*$/i.test(s))
      throw Error("Unsafe SQL identifier " + s);
    return '"' + s + '"';
  };
  const field = (s) => {
    const match = s.match(/^([a-z_][a-z_0-9]*)((?:->>?[A-Za-z_]+)*)$/);
    if (!match) throw Error("Unsafe field " + s);
    return (
      ident(match[1]) +
      match[2].replace(/(->>?)([A-Za-z_]+)/g, (_, op, k) => op + "'" + k + "'")
    );
  };
  const execute = async (path, body, method) => {
    calls.push(path);
    await db.exec("reset role;set role service_role");
    const [table, query = ""] = path.split("?"),
      params = new URLSearchParams(query),
      args = [];
    if (table.startsWith("rpc/")) {
      const fields = Object.entries(body);
      const r = (
        await db.query(
          "select public." +
            ident(table.slice(4)) +
            "(" +
            fields
              .map(([k, v]) => {
                args.push(
                  typeof v === "object" && v !== null ? JSON.stringify(v) : v,
                );
                return ident(k) + "=> $" + args.length;
              })
              .join(",") +
            ") result",
          args,
        )
      ).rows[0].result;
      if (loseNext && table === "rpc/parts_commit") {
        loseNext = false;
        throw Object.assign(Error("ack lost"), { status: 503 });
      }
      return r;
    }
    const conditions = [];
    for (const [k, v] of params) {
      if (["select", "limit", "offset", "order", "on_conflict"].includes(k))
        continue;
      if (k === "or" || k === "and") {
        const split = (text) => {
          let depth = 0,
            start = 0,
            items = [];
          for (let i = 0; i < text.length; i++) {
            if (text[i] === "(") depth++;
            if (text[i] === ")") depth--;
            if (text[i] === "," && depth === 0) {
              items.push(text.slice(start, i));
              start = i + 1;
            }
          }
          items.push(text.slice(start));
          return items;
        };
        const expression = (item) => {
          const group = item.match(/^(and|or)\((.*)\)$/);
          if (group)
            return (
              "(" +
              split(group[2])
                .map(expression)
                .join(" " + group[1] + " ") +
              ")"
            );
          const match = item.match(/^(.+?)\.(eq|lt|gt|gte|lte)\.(.+)$/);
          if (!match) throw Error("Invalid fixture expression");
          args.push(match[3]);
          return (
            field(match[1]) +
            { eq: "=", lt: "<", gt: ">", gte: ">=", lte: "<=" }[match[2]] +
            "$" +
            args.length
          );
        };
        conditions.push(
          "(" +
            split(v.slice(1, -1))
              .map(expression)
              .join(" " + k + " ") +
            ")",
        );
        continue;
      }
      const [op, ...rest] = v.split("."),
        value = rest.join(".");
      if (op === "in") {
        const list = value.slice(1, -1).split(",");
        const marks = list.map((item) => {
          args.push(item);
          return "$" + args.length;
        });
        conditions.push(field(k) + " in(" + marks.join(",") + ")");
        continue;
      }
      if (op === "is" && value === "null") {
        conditions.push(field(k) + " is null");
        continue;
      }
      if (!["eq", "neq", "gte", "lte", "gt", "lt"].includes(op))
        throw Error("Unsupported op " + op);
      args.push(k === "active" ? value === "true" : value);
      conditions.push(
        field(k) +
          { eq: "=", neq: "<>", gte: ">=", lte: "<=", gt: ">", lt: "<" }[op] +
          "$" +
          args.length,
      );
    }
    const where = conditions.length ? " where " + conditions.join(" and ") : "";
    if (!body) {
      const select = (params.get("select") || "*")
        .split(",")
        .map((s) => {
          if (s === "*") return "*";
          const colon = s.indexOf(":");
          return colon >= 0
            ? field(s.slice(colon + 1)) + " as " + ident(s.slice(0, colon))
            : field(s);
        })
        .join(",");
      const order = params.get("order")
        ? " order by " +
          params
            .get("order")
            .split(",")
            .map((s) => {
              const [key, direction] = s.split(".");
              return field(key) + (direction === "desc" ? " desc" : " asc");
            })
            .join(",")
        : "";
      return (
        await db.query(
          "select " +
            select +
            " from public." +
            ident(table) +
            where +
            order +
            " limit " +
            Number(params.get("limit") || 1000) +
            " offset " +
            Number(params.get("offset") || 0),
          args,
        )
      ).rows;
    }
    if (method === "PATCH") {
      const set = Object.entries(body)
        .map(([k, v]) => {
          args.push(
            typeof v === "object" && v !== null ? JSON.stringify(v) : v,
          );
          return ident(k) + "=$" + args.length;
        })
        .join(",");
      return (
        await db.query(
          "update public." +
            ident(table) +
            " set " +
            set +
            where +
            " returning *",
          args,
        )
      ).rows;
    }
    const fields = Object.entries(body);
    return (
      await db.query(
        "insert into public." +
          ident(table) +
          "(" +
          fields.map(([k]) => ident(k)).join(",") +
          ") values(" +
          fields
            .map(([, v]) => {
              args.push(
                typeof v === "object" && v !== null ? JSON.stringify(v) : v,
              );
              return "$" + args.length;
            })
            .join(",") +
          ") on conflict do nothing returning *",
        args,
      )
    ).rows;
  };
  const database = async (...args) => {
    if (args[0] === "rpc/parts_commit" && beforeCommit) {
      const hook = beforeCommit;
      beforeCommit = null;
      await hook();
    }
    const promise = queue
      .then(() => execute(...args))
      .then((result) => JSON.parse(JSON.stringify(result)))
      .catch((e) => {
        errors.push(e.message);
        if (e.code === "PT409" || e.code === "23505")
          throw Object.assign(Error(e.message), { status: 409 });
        throw e;
      });
    queue = promise.catch(() => {});
    return promise;
  };
  const handler = module.createPartsHandler({
    db: database,
    authenticate: async (req) => {
      const user = req.headers.authorization?.match(/^Bearer user-(\d)$/)?.[1];
      if (!user)
        throw Object.assign(Error("Sesión necesaria"), { status: 401 });
      return { id: id(Number(user)), email: "test@example.test" };
    },
    now: () => now,
    configured: () => true,
    onError: (e) => errors.push(e.message),
  });
  async function invoke(body, user = null) {
    let status = 200,
      headers = {};
    const res = {
      setHeader(k, v) {
        headers[k] = v;
      },
      status(s) {
        status = s;
        return this;
      },
      json(data) {
        return { status, data, headers };
      },
    };
    return handler(
      {
        method: "POST",
        headers: user ? { authorization: "Bearer user-" + user } : {},
        body,
      },
      res,
    );
  }
  return {
    db,
    module,
    invoke,
    database,
    calls,
    errors,
    beforeNextCommit: (hook) => {
      beforeCommit = hook;
    },
    loseNextAck: () => {
      loseNext = true;
    },
    async close() {
      await queue;
      await db.exec("reset role");
      await db.close();
      await fs.rm(out, { force: true });
    },
  };
}
