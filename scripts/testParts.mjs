import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  partsTestHarness,
  id,
  token,
  otherToken,
  wrongWorkToken,
  content,
  hash,
  now,
  day,
} from "./partsTestHarness.mjs";
const env = await partsTestHarness();
const { invoke, db } = env;
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAMgAAAA8CAYAAAAjW/WRAAACUklEQVR4nO3c23HCMBCFYZNJDTRFHVRFHTRFE+TJM47GF8nem1b/95qMkaw9Xl/A0wQAAAAAAAAAAAAAkdwfr6/3GDC2m/cAtpTh+LyfYceKvH68B7CGzoEowgVkKxyEBh5CBYQQIJowAVkLx+f9vC2vPQgQrIUIyFY4PMYCLLkHpCYcdBF4cQ0InQPRuQWEcKAHLgE5E45eTrPuj9c38vjQxjwgmTvHcm4EJQfTwpQIx3IbkYJVE4ZI4x3d/fH61qzHr8Vgpilv59gKxjy3sqss/wY7Z7u5yUJJhyNKFzkKx9n/hYyjUNTse/XF0egcEQJyZV5Zu6k3iUCUVBdFqxC8AyI1L7rKNRqBKKkthPZR0iskFqGX3G4mHjdCVBbAYrGtA2J1tKer/GfRJfaIb9zySGgVEq+iHbGreAeipH70sypcixBqf1bLGDzGoSFaIEoq1wQz61Mfi9Md7wWLOKYWvT1QFRmI56JpBSR6IfbUVaJ3iT3d332RDkhPhTfzXoNSz4EoiT2wm3k/l5B6Qr/Uy4JGuplg+fmaRIspwlPts2OINB8JmvPp7TriijTFdCUkEecjRaqrZO4Se0S+HhFh55wNSNT5aGiZ66iBKKU60raEpPfrjSvOfPV7hP2ypvr3INHD0WLkcExT/c+XR9kfe6oCkj0cvc5FwvKHXSPvhy2HO6S3gto7zeptLvC3+9KGTAWVaS6w09RBeimoke7TQ9fha3/mQspUUJnmAl1pC4VTKkhwf3m1FcIBrODthgAAAAAAAAAAAAAAAAAAAAjrDz7+zic7wI1zAAAAAElFTkSuQmCC";
const signature = { base64: png, mime: "image/png", name: "Firma de prueba" };
const call = async (b, user = null) => {
  const r = await invoke(b, user);
  assert.equal(
    r.status,
    200,
    JSON.stringify({
      action: b.action,
      message: r.data.message,
      errors: env.errors.slice(-3),
    }),
  );
  assert.equal(r.headers["Cache-Control"], "no-store");
  return r.data;
};
const create = async (n, kind = "service", extra = {}, worker = 100) =>
  (
    await call({
      action: "create",
      token,
      id: id(n),
      operationId: randomUUID(),
      expected: 0,
      workerId: worker,
      kind,
      content: { ...content, ...extra },
    })
  ).record;
const command = async (p, type, c = {}, user = null) =>
  (
    await call(
      {
        action: type,
        ...(user ? {} : { token }),
        id: p.id,
        expected: p.revision,
        operationId: randomUUID(),
        command: c,
      },
      user,
    )
  ).record;
const sign = (p) => ({
  signature,
  contentHash: p.contentHash,
  acknowledged: true,
});
try {
  assert.equal((await invoke({ action: "context" })).status, 401);
  assert.equal((await invoke({ action: "context" }, 3)).status, 403);
  // Foreman access and canonical worksite names can differ in case and spaces.
  await db.query("update obras set nombre=$2 where id=$1", [
    id(20), "  obra a  ",
  ]);
  const normalizedContext = await call({ action: "context", token });
  assert.equal(normalizedContext.works[0].worksite.id, id(20));
  assert.equal(normalizedContext.works[0].worksite.code, "11002GR");
  await db.query("update obras set nombre=$2 where id=$1", [id(20), "Obra A"]);
  const ctx = await call({ action: "context", token });
  assert.deepEqual(
    ctx.workers.map((w) => w.id),
    [100, 101],
  );
  assert.equal(ctx.actor.method, "worksite_access");
  assert.equal(
    (
      await invoke({
        action: "create",
        token: wrongWorkToken,
        id: id(29),
        operationId: randomUUID(),
        expected: 0,
        workerId: 100,
        kind: "service",
        content,
      })
    ).status,
    403,
  );
  let changedName = await create(96, "service", {}, 101);
  await db.exec("reset role");
  await db.query(
    "update foreman_portal_access set foreman_name=$2 where id=$1",
    [id(10), "Otro encargado"],
  );
  assert.equal(
    (
      await invoke({
        action: "submit",
        token,
        id: changedName.id,
        expected: changedName.revision,
        operationId: randomUUID(),
        command: sign(changedName),
      })
    ).status,
    409,
    "changed declarant cannot silently ratify an old identity snapshot",
  );
  await db.exec("reset role");
  await db.query(
    "update foreman_portal_access set foreman_name=$2 where id=$1",
    [id(10), "Encargado de prueba"],
  );
  let p = await create(30);
  assert.equal(p.revision, 1);
  assert.equal(p.kind, "service");
  assert.equal((await invoke({ action: "detail", id: p.id }, 2)).status, 404);
  assert.equal(
    (await invoke({ action: "detail", token: otherToken, id: p.id })).status,
    404,
  );
  assert.equal(
    (
      await invoke({
        action: "receipt",
        token,
        id: p.id,
        expected: p.revision,
        operationId: randomUUID(),
        command: { mode: "received", ...sign(p) },
      })
    ).status,
    409,
  );
  const submitted = {
    action: "submit",
    token,
    id: p.id,
    expected: p.revision,
    operationId: randomUUID(),
    command: sign(p),
  };
  p = (await call(submitted)).record;
  assert.equal(p.status, "pending_delivery");
  assert.ok(p.foremanSignature);
  assert.equal(p.supervisorSignature, undefined);
  assert.equal(
    (await call(submitted)).record.revision,
    p.revision,
    "retry does not duplicate signature",
  );
  assert.equal(
    (
      await invoke({
        ...submitted,
        command: { ...submitted.command, acknowledged: false },
      })
    ).status,
    409,
    "operation fingerprint mismatch",
  );
  assert.equal(
    (
      await invoke({
        action: "authorize",
        token,
        id: p.id,
        expected: p.revision,
        operationId: randomUUID(),
        command: sign(p),
      })
    ).status,
    403,
  );
  let received = await command(p, "receipt", {
    mode: "disagreement",
    note: "No comparto la descripción.",
    ...sign(p),
  });
  assert.equal(
    received.status,
    "review",
    "a disputed receipt requires supervisor review before counting",
  );
  assert.equal(received.receipt.signature.actor.role, "worker");
  assert.equal(received.receipt.signature.capturedBy.id, id(10));
  assert.equal(received.content.facts, content.facts);
  received = await command(
    received,
    "resolve-dispute",
    {
      ...sign(received),
      reason:
        "Revisadas las observaciones, se conserva el aviso documental sin sanción.",
    },
    1,
  );
  assert.equal(received.status, "communicated");
  const file = (await call({ action: "pdf", id: p.id, token })).file;
  const bytes = Buffer.from(file.base64, "base64");
  assert.equal(hash(bytes), file.sha256);
  assert.ok((await PDFDocument.load(bytes)).getPageCount() > 0);
  const again = (await call({ action: "pdf", id: p.id, token })).file;
  assert.equal(again.sha256, file.sha256, "stored PDF reused");
  let incident = await create(31, "service", { reason: "safety", risk: true });
  assert.equal(incident.kind, "incident");
  incident = await command(incident, "submit", sign(incident));
  assert.equal(incident.status, "submitted");
  assert.equal(
    (
      await invoke({
        action: "receipt",
        id: incident.id,
        token,
        expected: incident.revision,
        operationId: randomUUID(),
        command: { mode: "received", ...sign(incident) },
      })
    ).status,
    409,
    "incident cannot bypass authorization",
  );
  incident = await command(incident, "review", {}, 1);
  assert.equal(
    (
      await invoke(
        {
          action: "authorize",
          id: incident.id,
          expected: incident.revision,
          operationId: randomUUID(),
          command: { acknowledged: true, contentHash: incident.contentHash },
        },
        1,
      )
    ).status,
    409,
    "signature required",
  );
  incident = await command(
    incident,
    "return",
    { reason: "Aclarar el lugar." },
    1,
  );
  incident = await command(incident, "edit", {
    kind: "incident",
    content: { ...incident.content, place: "Acceso sur" },
  });
  assert.equal(incident.foremanSignature, undefined);
  const staleHash = incident.contentHash;
  incident = await command(incident, "edit", {
    kind: "incident",
    content: {
      ...incident.content,
      facts: incident.content.facts + " No consta otra información.",
    },
  });
  assert.equal(
    (
      await invoke({
        action: "submit",
        token,
        id: incident.id,
        expected: incident.revision,
        operationId: randomUUID(),
        command: { ...sign(incident), contentHash: staleHash },
      })
    ).status,
    409,
  );
  incident = await command(incident, "submit", sign(incident));
  incident = await command(incident, "authorize", sign(incident), 1);
  assert.ok(incident.supervisorSignature);
  const parallel = await Promise.all([
    invoke(
      {
        action: "information",
        id: incident.id,
        expected: incident.revision,
        operationId: randomUUID(),
        command: { reason: "Más información" },
      },
      1,
    ),
    invoke(
      {
        action: "archive",
        id: incident.id,
        expected: incident.revision,
        operationId: randomUUID(),
        command: { reason: "Duplicado" },
      },
      1,
    ),
  ]);
  assert.deepEqual(
    parallel.map((r) => r.status).sort(),
    [200, 409],
    "one of two concurrent changes commits",
  );
  let refusal = await create(32, "service", {}, 101);
  refusal = await command(refusal, "submit", sign(refusal));
  refusal = await command(refusal, "receipt", {
    mode: "refused",
    note: "Declina firmar tras la lectura.",
    witnesses: "Sin testigos.",
    acknowledged: true,
  });
  assert.equal(refusal.status, "unproven_delivery");
  assert.equal(refusal.receipt.signature, undefined);
  let retry = await create(33, "service", {}, 101);
  const request = {
    action: "submit",
    id: retry.id,
    token,
    expected: retry.revision,
    operationId: randomUUID(),
    command: sign(retry),
  };
  env.loseNextAck();
  assert.equal((await invoke(request)).status, 503);
  retry = (await call(request)).record;
  assert.equal(retry.status, "pending_delivery");
  await db.exec("reset role");
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from parts_events where record_id=$1",
        [retry.id],
      )
    ).rows[0].n,
    2,
    "lost ack retry produces one event",
  );
  const payload = env.module.applyPartCommand;
  assert.throws(
    () =>
      payload(
        { ...retry, blockedAt: now },
        { type: "submit" },
        { actor: ctx.actor, now, policy: null, comparableCount: 0 },
      ),
    /bloqueado/,
  );

  const policy = {
    employer: "Entidad de prueba",
    agreement: "Convenio sintético",
    reviewedBy: "Responsable laboral de prueba",
    reviewedAt: now,
    windowDays: 30,
    retentionDays: 90,
    legalBasis: "Política sintética para pruebas; no valida un convenio real.",
    authority: "Personal de prueba",
    reasons: env.module.PART_REASONS.map(([id, label, requiresReview]) => ({
      id,
      label,
      requiresReview,
    })),
  };
  assert.equal(
    (
      await invoke({
        action: "policy",
        token,
        worksiteId: id(20),
        expected: 1,
        policy,
      })
    ).status,
    403,
  );
  await call({ action: "policy", worksiteId: id(20), expected: 1, policy }, 1);
  let second = await create(50);
  assert.equal(
    second.kind,
    "incident",
    "a comparable documented notice requires review",
  );
  second = await command(second, "submit", sign(second));
  second = await command(second, "authorize", sign(second), 1);
  second = await command(second, "receipt", {
    mode: "disagreement",
    note: "Se discrepa de la descripción.",
    ...sign(second),
  });
  assert.equal(
    (
      await invoke(
        {
          action: "authorize",
          id: second.id,
          expected: second.revision,
          operationId: randomUUID(),
          command: sign(second),
        },
        1,
      )
    ).status,
    409,
    "a receipt dispute cannot bypass its signed review",
  );
  second = await command(
    second,
    "resolve-dispute",
    {
      ...sign(second),
      reason: "Revisadas las observaciones sin sanción automática.",
    },
    1,
  );
  let third = await create(51);
  third = await command(third, "submit", sign(third));
  third = await command(third, "authorize", sign(third), 1);
  third = await command(third, "receipt", { mode: "received", ...sign(third) });
  third = await command(
    third,
    "compare",
    {
      recordIds: [received.id, second.id],
      reason: "Revisados los hechos y las instrucciones del mismo tipo.",
    },
    1,
  );
  assert.equal(third.comparableIds.length, 2);
  assert.equal(
    third.status,
    "communicated",
    "three records never elevate automatically",
  );
  third = await command(
    third,
    "elevate",
    {
      ...sign(third),
      reason: "Remitir para valoración, sin sanción.",
      authority: "Responsable de Personal",
    },
    1,
  );
  assert.equal(third.elevation.references.length, 2);
  assert.equal(third.elevation.remittedAt, undefined);
  const portalThird = (await call({ action: "detail", token, id: third.id }))
    .record;
  assert.equal(
    portalThird.elevation,
    undefined,
    "compiled history restricted to supervisor",
  );
  assert.equal(
    (await invoke({ action: "pdf", token, id: third.id })).status,
    403,
  );
  assert.equal(
    (
      await invoke(
        {
          action: "remit",
          id: third.id,
          expected: third.revision,
          operationId: randomUUID(),
          command: { reason: "Registro", channel: "Canal autorizado" },
        },
        1,
      )
    ).status,
    400,
  );
  third = await command(
    third,
    "remit",
    {
      reason: "Constancia de remisión efectuada para valoración.",
      channel: "Registro autorizado de prueba REF-1",
      acknowledged: true,
    },
    1,
  );
  assert.ok(third.elevation.remittedAt);
  let raced = await create(52, "incident");
  raced = await command(raced, "submit", sign(raced));
  raced = await command(raced, "authorize", sign(raced), 1);
  raced = await command(raced, "receipt", { mode: "received", ...sign(raced) });
  env.beforeNextCommit(async () => {
    received = await command(
      received,
      "archive",
      { reason: "Desestimado tras aclaración." },
      1,
    );
  });
  const race = await invoke(
    {
      action: "compare",
      id: raced.id,
      expected: raced.revision,
      operationId: randomUUID(),
      command: { recordIds: [received.id], reason: "Comprobar concurrencia." },
    },
    1,
  );
  assert.equal(
    race.status,
    409,
    "atomic comparison rejects an ancestor archived after the HTTP read",
  );
  const compiled = (await call({ action: "pdf", id: third.id }, 1)).file;
  assert.equal(hash(Buffer.from(compiled.base64, "base64")), compiled.sha256);
  const sourceCopy = third.elevation.references.find(
    (r) => r.id === received.id,
  );
  assert.equal(
    sourceCopy.content.facts,
    content.facts,
    "proposal preserves exact historical snapshot after later archive",
  );
  const eligible = env.module.eligiblePart;
  assert.equal(
    eligible({ ...second, status: "archived" }, raced, policy, now),
    false,
  );
  assert.equal(
    eligible({ ...second, workerId: 101 }, raced, policy, now),
    false,
  );
  assert.equal(
    eligible(
      {
        ...second,
        content: { ...second.content, occurredAt: "2020-01-01T00:00:00Z" },
      },
      raced,
      policy,
      now,
    ),
    false,
  );
  assert.equal(eligible(second, raced, null, now), false);
  assert.equal(
    eligible(
      {
        ...second,
        receipt: { ...second.receipt, mode: "disagreement" },
        receiptReview: undefined,
      },
      raced,
      policy,
      now,
    ),
    false,
  );
  let draftA = await create(70);
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const base64 = Buffer.from(await pdf.save()).toString("base64");
  const attachment = (
    await call({
      action: "attachment",
      id: draftA.id,
      token,
      file: {
        name: "Evidencia de prueba.pdf",
        mime: "application/pdf",
        base64,
      },
    })
  ).asset;
  assert.equal(
    (
      await call({
        action: "attachment",
        id: draftA.id,
        token,
        file: {
          name: "Evidencia de prueba.pdf",
          mime: "application/pdf",
          base64,
        },
      })
    ).asset.id,
    attachment.id,
    "duplicate attachment reuses private asset",
  );
  draftA = await command(draftA, "edit", {
    kind: draftA.kind,
    content: { ...draftA.content, attachments: [attachment] },
  });
  const draftB = await create(71);
  assert.equal(
    (
      await invoke({
        action: "edit",
        token,
        id: draftB.id,
        expected: draftB.revision,
        operationId: randomUUID(),
        command: {
          kind: draftB.kind,
          content: { ...draftB.content, attachments: [attachment] },
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await invoke({
        action: "file",
        token,
        id: draftB.id,
        assetId: attachment.id,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await invoke({
        action: "submit",
        token,
        id: draftB.id,
        expected: draftB.revision,
        operationId: randomUUID(),
        command: {
          ...sign(draftB),
          signature: { ...signature, base64: "broken" },
        },
      })
    ).status,
    400,
  );
  let concurrent = await create(72, "incident");
  concurrent = await command(concurrent, "submit", sign(concurrent));
  const authorizations = await Promise.all(
    [1, 2].map(() =>
      invoke(
        {
          action: "authorize",
          id: concurrent.id,
          expected: concurrent.revision,
          operationId: randomUUID(),
          command: sign(concurrent),
        },
        1,
      ),
    ),
  );
  assert.deepEqual(authorizations.map((r) => r.status).sort(), [200, 409]);
  await db.exec("reset role");
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from parts_assets where record_id=$1 and purpose='signature'",
        [concurrent.id],
      )
    ).rows[0].n,
    2,
    "losing authorization cannot leave an extra signature",
  );
  const cachedRow = (
    await db.query(
      "select * from parts_assets where record_id=$1 and purpose='pdf' limit 1",
      [p.id],
    )
  ).rows[0];
  await db.query("update parts_assets set base64='YWJj' where id=$1", [
    cachedRow.id,
  ]);
  assert.equal(
    (
      await invoke({
        action: "pdf",
        id: p.id,
        token,
        revision: cachedRow.revision,
      })
    ).status,
    409,
    "modified stored PDF is rejected",
  );
  await db.exec("reset role");
  await db.query("update parts_assets set base64=$2 where id=$1", [
    cachedRow.id,
    cachedRow.base64,
  ]);
  await db.query("update foreman_portal_access set active=false where id=$1", [
    id(10),
  ]);
  assert.equal(
    (await invoke({ action: "detail", token, id: p.id })).status,
    403,
  );
  await db.exec("reset role");
  await db.query("update foreman_portal_access set active=true where id=$1", [
    id(10),
  ]);
  const sub = (n) => ({
    endpoint: "https://fcm.googleapis.com/push/parts-fixture-" + n,
    keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
  });
  assert.equal(
    (
      await invoke(
        {
          action: "push-register",
          subscription: { ...sub(0), endpoint: "https://127.0.0.1/private" },
        },
        1,
      )
    ).status,
    400,
  );
  await call({ action: "push-register", subscription: sub(1) }, 1);
  await call({ action: "push-register", token, subscription: sub(2) });
  process.env.FOREMAN_PUSH_VAPID_PUBLIC_KEY = "fixture-public";
  process.env.FOREMAN_PUSH_VAPID_PRIVATE_KEY = "fixture-private";
  process.env.FOREMAN_PUSH_VAPID_SUBJECT = "mailto:test@example.test";
  const sent = [];
  const send = async (s, payload) => {
    sent.push({ s, payload: JSON.parse(payload) });
    return { statusCode: 201 };
  };
  const dispatched = await env.module.dispatchPartsPush(
    env.database,
    retry.id,
    retry.revision,
    send,
  );
  assert.equal(dispatched.accepted, 1);
  assert.equal(sent.length, 1);
  assert.ok(!sent[0].payload.body.includes("Persona"));
  assert.ok(!sent[0].payload.body.includes(content.facts));
  await env.module.dispatchPartsPush(
    env.database,
    retry.id,
    retry.revision,
    send,
  );
  assert.equal(sent.length, 1, "accepted deliveries are not sent twice");
  let attempts = 0;
  const unavailable = async () => {
    attempts++;
    throw Object.assign(Error("Unavailable"), { statusCode: 503 });
  };
  for (let i = 0; i < 4; i++)
    await env.module.dispatchPartsPush(
      env.database,
      second.id,
      second.revision,
      unavailable,
    );
  assert.equal(attempts, 3, "provider retry budget is bounded");
  await db.exec("reset role");
  await db.query("update foreman_portal_access set token_hash=$2 where id=$1", [
    id(10),
    "rotated",
  ]);
  const rotated = await env.module.dispatchPartsPush(
    env.database,
    third.id,
    third.revision,
    send,
  );
  assert.equal(
    rotated.accepted,
    0,
    "rotated portal token stops pending delivery claims",
  );
  await db.exec("reset role");
  await db.query("update foreman_portal_access set token_hash=$2 where id=$1", [
    id(10),
    hash(token),
  ]);
  delete process.env.FOREMAN_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.FOREMAN_PUSH_VAPID_PRIVATE_KEY;
  delete process.env.FOREMAN_PUSH_VAPID_SUBJECT;
  // Real SQL pagination, civil date filters and policy isolation.
  assert.equal(
    env.module.madridDayStart("2026-03-29"),
    "2026-03-28T23:00:00.000Z",
  );
  assert.equal(
    env.module.madridDayStart("2026-03-30"),
    "2026-03-29T22:00:00.000Z",
  );
  assert.equal(
    env.module.madridDayStart("2026-10-25"),
    "2026-10-24T22:00:00.000Z",
  );
  assert.equal(
    env.module.madridDayStart("2026-10-26"),
    "2026-10-25T23:00:00.000Z",
  );
  assert.throws(() => env.module.madridDayStart("2026-02-30"), /Fecha/);
  assert.throws(() => env.module.madridDayStart("2026-99-99"), /Fecha/);
  const noPolicy = (
    await call({
      action: "create",
      token: otherToken,
      id: id(95),
      operationId: randomUUID(),
      expected: 0,
      workerId: 100,
      kind: "service",
      content,
    })
  ).record;
  assert.equal(
    (
      await invoke({
        action: "submit",
        token: otherToken,
        id: noPolicy.id,
        expected: noPolicy.revision,
        operationId: randomUUID(),
        command: sign(noPolicy),
      })
    ).status,
    409,
    "policy cannot leak between employers/owners",
  );
  const workB = await call({ action: "context", token: wrongWorkToken });
  assert.equal(
    workB.policy,
    null,
    "policy cannot leak between works of one owner",
  );
  assert.equal(
    (
      await invoke({
        action: "edit",
        token,
        id: draftB.id,
        expected: draftB.revision,
        operationId: randomUUID(),
        command: { kind: "invented", content: draftB.content },
      })
    ).status,
    400,
  );
  assert.equal(
    (await invoke({ action: "pdf", token, id: draftB.id, intent: "share" }))
      .status,
    409,
    "draft cannot be formally shared",
  );
  const rank = await call({ action: "list", filters: { repetition: "3" } }, 1);
  assert.ok(
    rank.rows.some((r) => r.id === raced.id),
    "actual SQL window function finds third comparable entry after excluding archived source",
  );
  assert.equal(
    (await invoke({ action: "list", token, filters: { repetition: "3" } }))
      .status,
    403,
  );
  for (let n = 200; n < 228; n++)
    await create(n, "service", { reason: "punctuality" }, 101);
  const page1 = await call({ action: "list", token });
  assert.equal(page1.rows.length, 25);
  assert.ok(page1.cursor);
  assert.equal(
    page1.rows.some((r) => "state" in r),
    false,
    "list does not download facts or signatures",
  );
  const page2 = await call({ action: "list", token, cursor: page1.cursor });
  assert.ok(page2.rows.length > 0);
  assert.equal(
    page2.rows.some((r) => page1.rows.some((a) => a.id === r.id)),
    false,
    "stable cursor never repeats first page",
  );
  const dates = await call({
    action: "list",
    token,
    filters: { from: day, to: day },
  });
  assert.ok(dates.rows.length > 0);
  const futureDay = new Date(Date.parse(day + "T12:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
  assert.equal(
    (
      await call({
        action: "list",
        token,
        filters: { from: futureDay, to: futureDay },
      })
    ).rows.length,
    0,
  );
  assert.equal(
    (await invoke({ action: "list", token, filters: { to: "2026-02-30" } }))
      .status,
    400,
  );
  const blocked = await command(
    draftB,
    "block",
    { reason: "Bloqueo técnico de prueba por orden del responsable." },
    1,
  );
  assert.ok(blocked.blockedAt);
  assert.equal(
    (await invoke({ action: "detail", token, id: blocked.id })).status,
    403,
  );
  assert.equal(
    (await invoke({ action: "pdf", id: blocked.id }, 1)).status,
    403,
  );
  await db.exec("reset role");
  assert.equal(
    (await db.query("select count(*)::int n from trabajadores")).rows[0].n,
    4,
    "module never modifies workers or SAE",
  );
  const total = (
    await db.query(
      "select count(*)::int n from parts_records where owner_id=$1 and kind='service'",
      [id(1)],
    )
  ).rows[0].n;
  assert.equal(
    page1.counts.service,
    total,
    "counters use real authorised records",
  );
  // The existing Directory trash RPC physically deletes its active worker row.
  // Signed snapshots must survive it; creation/edit/declaration still require a live assignment.
  await db.exec("reset role");
  const archivedWorker = (
    await db.query("select * from trabajadores where owner_id=$1 and id=100", [
      id(1),
    ])
  ).rows[0];
  const recordsBefore = (
    await db.query("select count(*)::int n from parts_records")
  ).rows[0].n;
  await db.query("delete from trabajadores where owner_id=$1 and id=100", [
    id(1),
  ]);
  assert.equal(
    (await db.query("select count(*)::int n from parts_records")).rows[0].n,
    recordsBefore,
    "trash cannot cascade into retained notices",
  );
  const retained = (await call({ action: "detail", id: second.id }, 1)).record;
  assert.equal(retained.worker.name, archivedWorker.apellidos_nombre);
  assert.ok(retained.receipt.signature);
  second = await command(
    retained,
    "close",
    {
      reason:
        "Cerrar seguimiento histórico tras retirar la contratación del Directorio activo.",
    },
    1,
  );
  assert.equal(second.status, "closed");
  assert.ok(
    (await call({ action: "pdf", id: second.id }, 1)).file.sha256,
    "signed historical PDF remains available after trash",
  );
  assert.equal(
    (
      await invoke({
        action: "create",
        token,
        id: id(97),
        operationId: randomUUID(),
        expected: 0,
        workerId: 100,
        kind: "service",
        content,
      })
    ).status,
    403,
    "new record requires an active worksite assignment",
  );
  assert.equal(
    (
      await invoke({
        action: "edit",
        token,
        id: draftA.id,
        expected: draftA.revision,
        operationId: randomUUID(),
        command: { kind: draftA.kind, content: draftA.content },
      })
    ).status,
    403,
    "cannot change facts against a removed active assignment",
  );
  await db.exec("reset role");
  await db.query(
    "insert into trabajadores(owner_id,id,obra,apellidos_nombre,categoria,periodo_inicio,periodo_fin) values($1,$2,$3,$4,$5,$6,$7)",
    [
      archivedWorker.owner_id,
      archivedWorker.id,
      archivedWorker.obra,
      archivedWorker.apellidos_nombre,
      archivedWorker.categoria,
      archivedWorker.periodo_inicio,
      archivedWorker.periodo_fin,
    ],
  );
  console.log(
    "PASS Partes Directory trash: active worker removal/restoration preserves signed history/PDF; new declarations and fact edits require a current authorised worker.",
  );
  const secured = (
    await db.query(
      "select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname like 'parts_%' and relkind='r'",
    )
  ).rows;
  assert.equal(secured.length, 7);
  assert.ok(
    secured.every((t) => t.relrowsecurity),
    "all module tables enable RLS",
  );
  console.log(
    "PASS Partes pagination, per-worksite legal gate, DST date filters, repetition SQL, projected lists, real counters and legal block.",
  );
  console.log(
    "PASS Partes extended: validated comparability window, three-record review, no automatic elevation, snapshot compilation, archival race, private attachments, tampered PDFs, simultaneous authorization, revoked access, generic push payload, persisted delivery and bounded retries.",
  );
  await db.exec("reset role;set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id(2),
  ]);
  assert.deepEqual(
    (await db.query("select id from parts_records")).rows.map((r) => r.id),
    [noPolicy.id],
    "owner only sees own record, never the other supervisor history",
  );
  await assert.rejects(
    db.exec("update parts_records set status='authorized'"),
    /permission denied/,
  );
  await assert.rejects(
    db.exec("select * from parts_assets"),
    /permission denied/,
  );
  await assert.rejects(
    db.exec("select parts_claim_push('" + p.id + "',1)"),
    /permission denied/,
  );
  console.log(
    "PASS Partes: real command handler + PostgreSQL, service/incident circuits, signatures, stale versions, role/scope rejection, multi-request CAS, receipt/disagreement/refusal, stored PDF hash/reuse, lost acknowledgment idempotency, RLS/ACL.",
  );
} finally {
  await env.close();
}
