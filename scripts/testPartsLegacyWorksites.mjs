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
  // Configuration creates legacy works without codigo. Their UUID and owner, not
  // the presence of a second human label, establish the authorized identity.
  for (const legacyCode of ["", null, "   "]) {
    await db.query("update obras set codigo=$1 where id=$2", [legacyCode, id(20)]);
    const legacy = await call({ action: "context", token });
    assert.equal(legacy.works[0].worksite.id, id(20));
    assert.equal(legacy.works[0].worksite.code, "");
    assert.equal(legacy.works[0].worksite.name, "Obra A");
    assert.deepEqual(legacy.workers.map((w) => w.id), [100, 101]);
  }
  const legacyDraft = await create(94);
  assert.equal(legacyDraft.worksite.id, id(20));
  assert.equal(legacyDraft.worksite.code, "");
  const legacySigned = await command(legacyDraft, "submit", sign(legacyDraft));
  assert.ok(legacySigned.foremanSignature, "Legacy work can be declared with a fresh signature");
  await db.query("update obras set codigo=$1 where id=$2", ["11002GR", id(20)]);
  // A duplicate within the same owner remains unsafe; a homonymous work owned
  // by another supervisor (fixture id 22) must never create ambiguity or leak.
  await db.query("insert into obras values($1,$2,'Obra A','','Prueba')", [id(23), id(1)]);
  assert.equal((await invoke({ action: "context", token })).status, 409);
  assert.equal((await invoke({ action: "create", token, id: id(95), operationId: randomUUID(), expected: 0, workerId: 100, kind: "service", content })).status, 409);
  await db.query("delete from obras where id=$1", [id(23)]);
  console.log("PASS legacy works: missing/blank/null code, context, stable UUID, signed declaration/PDF, ambiguity rejection and owner isolation");
} finally { await env.close(); }
