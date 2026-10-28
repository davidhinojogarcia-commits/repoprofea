import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  partsTestHarness,
  id,
  token,
  otherToken,
  wrongWorkToken,
} from "./partsTestHarness.mjs";
const now = "2026-10-28T12:00:00Z",
  day = "2026-10-28";
const env = await partsTestHarness({ workforce: true, now }),
  { db, module: m } = env;
const root = new URL("../", import.meta.url);
const current = new Date(now),
  today = day;
// Reuse a synthetic handwritten fixture already used by the signatures regression suite.
const fixture = await fs.readFile(
  new URL("./testParts.mjs", import.meta.url),
  "utf8",
);
const png = fixture.match(/const png\s*=\s*"([^"]+)"/)[1];
const image = "data:image/png;base64," + png;
const common = {
  contractConfirmed: "yes",
  contractReference: "Contrato sintético TEST-100",
  communication: now,
  reason: "Motivos personales",
  contractDate: today.slice(0, 7) + "-01",
  incorporation: today.slice(0, 7) + "-01",
  started: "yes",
  intention: "cease",
  effects: today,
  regime: "Régimen sintético de ensayo",
  regimeSource: "Referencia de pruebas, sin validez laboral",
  notice: "Preaviso comprobado en ensayo",
  contractReview: "yes",
};
const exit = {
  contractConfirmed: "yes",
  contractReference: "Contrato sintético TEST-100",
  communication: now,
  reason: "Consulta médica",
  exit: new Date(current.getTime() - 3600000).toISOString(),
  exitType: "actual",
  returnMode: "unknown",
  returnDay: "unknown",
  justification: "not_applicable",
};
const invoke = (body, t = token, user = null) =>
  env.invoke({ ...body, ...(t ? { token: t } : {}) }, user);
const ok = async (b, t = token, u = null) => {
  const r = await invoke(b, t, u);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const bad = async (b, status = 400, t = token, u = null) => {
  const r = await invoke(b, t, u);
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r;
};
async function save(kind, content, workerId = 100, t = token) {
  return (
    await ok(
      {
        action: "save",
        id: randomUUID(),
        operationId: randomUUID(),
        expected: 0,
        kind,
        workerId,
        content,
      },
      t,
    )
  ).record;
}
async function cmd(p, action, extra = {}, t = token) {
  return (
    await ok(
      {
        action,
        id: p.id,
        expected: p.revision,
        operationId: randomUUID(),
        ...extra,
      },
      t,
    )
  ).record;
}
async function sign(p, role) {
  return cmd(p, "sign-" + role, {
    hash: p.hash,
    version: p.version,
    confirmed: true,
    image,
  });
}
try {
  const c = await ok({ action: "context" });
  assert.equal(c.worksite.employer, "Entidad sintética");
  const workers = await ok({ action: "workers", search: "Homónima" });
  assert.equal(workers.workers.length, 2);
  let p = await save("rechazo_voluntario", common);
  const snapshot = structuredClone(p);
  await bad(
    {
      action: "prepare",
      id: p.id,
      expected: p.revision,
      operationId: randomUUID(),
    },
    404,
    otherToken,
  );
  await bad({ action: "detail", id: p.id }, 403, wrongWorkToken);
  await bad({ action: "detail", id: p.id }, 404, null, 2);
  await bad(
    {
      action: "save",
      id: randomUUID(),
      operationId: randomUUID(),
      expected: 0,
      kind: "salida_obra",
      workerId: 102,
      content: exit,
    },
    403,
  );
  for (const [key, value] of [
    ["reason", ""],
    ["contractConfirmed", "no"],
    ["contractDate", ""],
    ["regimeSource", ""],
    ["intention", "task"],
    ["intention", "risk"],
    ["contractReview", "no"],
  ]) {
    const invalid = await save("rechazo_voluntario", {
      ...common,
      [key]: value,
    });
    await bad({
      action: "prepare",
      id: invalid.id,
      expected: invalid.revision,
      operationId: randomUUID(),
    });
  }
  p = await cmd(p, "prepare");
  await bad(
    {
      action: "sign-foreman",
      id: p.id,
      expected: p.revision,
      operationId: randomUUID(),
      hash: p.hash,
      version: p.version,
      confirmed: true,
      image,
    },
    409,
  );
  await bad(
    {
      action: "sign-worker",
      id: p.id,
      expected: p.revision,
      operationId: randomUUID(),
      hash: "wrong",
      version: p.version,
      confirmed: true,
      image,
    },
    409,
  );
  await bad({
    action: "sign-worker",
    id: p.id,
    expected: p.revision,
    operationId: randomUUID(),
    hash: p.hash,
    version: p.version,
    confirmed: false,
    image,
  });
  p = await sign(p, "worker");
  assert.equal(p.status, "worker_signed");
  const old = p;
  const op = {
    action: "save",
    id: p.id,
    expected: p.revision,
    operationId: randomUUID(),
    content: { ...p.content, workerNotes: "Corrección voluntaria" },
  };
  p = (await ok(op)).record;
  assert.equal(p.version, 2);
  assert.deepEqual(p.signatures, {});
  assert.equal((await ok(op)).record.revision, p.revision);
  await bad({ ...op, content: { ...p.content, reason: "Otro" } }, 409);
  await bad(
    {
      action: "sign-foreman",
      id: old.id,
      expected: old.revision,
      operationId: randomUUID(),
      hash: old.hash,
      version: old.version,
      confirmed: true,
      image,
    },
    409,
  );
  const two = await Promise.all([
    invoke({
      action: "save",
      id: p.id,
      expected: p.revision,
      operationId: randomUUID(),
      content: p.content,
    }),
    invoke({
      action: "save",
      id: p.id,
      expected: p.revision,
      operationId: randomUUID(),
      content: p.content,
    }),
  ]);
  assert.deepEqual(two.map((r) => r.status).sort(), [200, 409]);
  p = two.find((r) => r.status === 200).data.record;
  p = await cmd(p, "prepare");
  p = await sign(p, "worker");
  const finalOp = {
    action: "sign-foreman",
    id: p.id,
    expected: p.revision,
    operationId: randomUUID(),
    hash: p.hash,
    version: p.version,
    confirmed: true,
    image,
  };
  env.loseNextAck();
  await bad(finalOp, 503);
  p = (await ok(finalOp)).record;
  assert.equal(p.status, "completed");
  const a = await ok({ action: "pdf", id: p.id });
  assert.ok(
    (
      await PDFDocument.load(Buffer.from(a.file.base64, "base64"))
    ).getPageCount() >= 2,
  );
  await db.exec("reset role");
  await db.query(
    "update obras set empresa='Cambio posterior',municipio='Municipio modificado' where id=$1",
    [id(20)],
  );
  const b = await ok({ action: "pdf", id: p.id });
  assert.equal(a.file.base64, b.file.base64);
  assert.equal(
    (await ok({ action: "detail", id: p.id })).record.worksite.employer,
    "Entidad sintética",
  );
  await bad(
    {
      action: "save",
      id: p.id,
      expected: p.revision,
      operationId: randomUUID(),
      content: p.content,
    },
    409,
  );
  // Owner supervisor sees the exact same persistent object and can download it.
  assert.equal(
    (await ok({ action: "detail", id: p.id }, null, 1)).record.hash,
    p.hash,
  );
  const list = await ok({ action: "list", kind: "rechazo_voluntario" });
  assert.ok(list.records.some((r) => r.id === p.id));
  assert.ok(!JSON.stringify(list).includes(p.signatures.worker.image));
  const pre = await save("rechazo_voluntario", {
    ...common,
    started: "no",
    intention: "no_join",
    incorporation: today,
  });
  const prepared = await cmd(pre, "prepare");
  assert.match(m.declaration(prepared), /sin haber iniciado/);
  assert.doesNotMatch(m.declaration(prepared), /oferta/);
  const task = await save("rechazo_voluntario", {
    ...common,
    intention: "risk",
  });
  assert.match(m.declaration(task), /no se manifiesta voluntad de cesar/);
  await bad({
    action: "save",
    id: randomUUID(),
    operationId: randomUUID(),
    expected: 0,
    kind: "salida_obra",
    workerId: 100,
    content: { ...exit, effects: today },
  });
  // Exits: general medical reason, other reason, overnight, duration, unknown return.
  for (const patch of [
    { reason: "Otro", reasonBrief: "Gestión comunicada" },
    { returnMode: "duration", duration: "60", returnDay: "unknown" },
    {
      returnMode: "at",
      returnAt: new Date(current.getTime() + 3600000).toISOString(),
      returnDay: "unknown",
    },
    {
      exit: today + "T23:30:00+01:00",
      exitType: "planned",
      returnMode: "at",
      returnAt: new Date(
        Date.parse(today + "T23:30:00+01:00") + 7200000,
      ).toISOString(),
      returnDay: "later",
    },
  ]) {
    let e = await save("salida_obra", { ...exit, ...patch });
    e = await cmd(e, "prepare");
    assert.equal(e.status, "prepared");
  }
  for (const patch of [
    { reason: "" },
    { exit: new Date(current.getTime() + 3600000).toISOString() },
    { returnMode: "duration", duration: "-1" },
    { returnMode: "at", returnAt: exit.exit },
    { exit: "2026-02-30T09:00" },
    { reason: "Otro", reasonBrief: "" },
  ]) {
    const e = await save("salida_obra", { ...exit, ...patch });
    await bad({
      action: "prepare",
      id: e.id,
      expected: e.revision,
      operationId: randomUUID(),
    });
  }
  let e = await save("salida_obra", {
    ...exit,
    workerNotes:
      "Observación sintética extensa de lectura y paginación.\n".repeat(55),
  });
  e = await cmd(e, "prepare");
  e = await sign(e, "worker");
  e = await sign(e, "foreman");
  const departure = await ok({ action: "pdf", id: e.id });
  assert.doesNotMatch(
    m.declaration(e),
    /prestaciones|renuncia|baja voluntaria/,
  );
  e = await cmd(e, "return", {
    at: now,
    confirmed: true,
    note: "Regreso comprobado en ensayo",
  });
  assert.equal(e.status, "return_recorded");
  assert.equal(
    departure.file.base64,
    (await ok({ action: "pdf", id: e.id })).file.base64,
  );
  assert.ok(
    (await ok({ action: "pdf", id: e.id, returnOnly: true })).file.base64,
  );
  e = await cmd(e, "annul", { reason: "Rectificación documentada de prueba" });
  assert.equal(e.status, "annulled");
  assert.equal(
    departure.file.base64,
    (await ok({ action: "pdf", id: e.id })).file.base64,
  );
  await fs.mkdir(new URL("tmp/workforce/", root), { recursive: true });
  await fs.writeFile(
    new URL("tmp/workforce/salida-larga.pdf", root),
    Buffer.from(departure.file.base64, "base64"),
  );
  await fs.writeFile(
    new URL("tmp/workforce/rechazo.pdf", root),
    Buffer.from(a.file.base64, "base64"),
  );
  assert.equal(m.madridCandidates("2026-03-29T02:30").length, 0);
  assert.equal(m.madridCandidates("2026-10-25T02:30").length, 2);
  // Legacy access labels must resolve to the canonical worksite, while obra_id remains authoritative.
  await db.exec("reset role");
  await db.query(
    "update obras set nombre='11002 GR Obra A',codigo='11002 GR' where id=$1",
    [id(20)],
  );
  const legacy = await save("salida_obra", exit, 101);
  assert.equal(legacy.worksite.name, "11002 GR Obra A");
  await db.exec("reset role");
  await db.query(
    "update obras set nombre='Obra A',codigo='11002GR' where id=$1",
    [id(20)],
  );
  const race = await save("salida_obra", exit, 101);
  env.beforeNextCommit(async () => {
    await db.exec("reset role");
    await db.query("delete from trabajadores where owner_id=$1 and id=101", [
      id(1),
    ]);
  });
  await bad(
    {
      action: "prepare",
      id: race.id,
      expected: race.revision,
      operationId: randomUUID(),
    },
    409,
  );
  // RLS and RPC privileges: no direct access, including owner sessions.
  await db.exec("reset role;set role anon");
  await assert.rejects(db.query("select * from workforce_documents"));
  await db.exec("reset role;set role authenticated");
  await assert.rejects(db.query("select * from workforce_documents"));
  await assert.rejects(
    db.query(
      "select workforce_document_commit($1,$2,0,$3,'hash','save','{}','{}',null,null)",
      [id(1), randomUUID(), randomUUID()],
    ),
  );
  await db.exec("reset role");
  const tables = await db.query(
    "select relname,relrowsecurity from pg_class where relname in('workforce_documents','workforce_document_events')",
  );
  assert.ok(tables.rows.every((r) => r.relrowsecurity));
  const workersAfter = await db.query(
    "select * from trabajadores where owner_id=$1 and id=100",
    [id(1)],
  );
  assert.equal(
    workersAfter.rows[0].periodo_fin,
    today.slice(0, 7) +
      "-" +
      new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate(),
  );
  assert.ok(
    !env.calls.some((path) =>
      /rpc\/(?:sae|sign_foreman|save_foreman_attendance)/.test(path),
    ),
  );
  await db.exec("reset role");
  await db.query("delete from trabajadores where owner_id=$1 and id=100", [
    id(1),
  ]);
  assert.equal(
    (await ok({ action: "pdf", id: p.id })).file.base64,
    a.file.base64,
  );
  await bad(
    {
      action: "prepare",
      id: pre.id,
      expected: prepared.revision,
      operationId: randomUUID(),
    },
    409,
  );
  await bad(
    {
      action: "save",
      id: randomUUID(),
      operationId: randomUUID(),
      expected: 0,
      kind: "salida_obra",
      workerId: 100,
      content: exit,
    },
    403,
  );
  console.log(
    "Workforce documents: domain, PGlite PostgreSQL, handler/auth boundary, CAS, retries after lost ACK, both signatures, immutable PDFs, privacy and no employment effects: PASS.",
  );
} finally {
  await env.close();
}
