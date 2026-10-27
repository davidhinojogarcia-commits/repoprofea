import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { build } from "esbuild";
import { chromium, webkit } from "playwright";
import { partsTestHarness, token, id, content } from "./partsTestHarness.mjs";
const engine = process.env.BROWSER_ENGINE === "webkit" ? "webkit" : "chromium";
const originOutage =
  engine === "webkit" || process.env.PARTS_ORIGIN_OUTAGE === "1";
const env = await partsTestHarness(),
  root = new URL("../", import.meta.url).pathname;
const tailwind = process.env.SIGNATURE_TAILWIND_SCRIPT
  ? await fs.readFile(process.env.SIGNATURE_TAILWIND_SCRIPT, "utf8")
  : await (
      await fetch("https://cdn.tailwindcss.com", {
        signal: AbortSignal.timeout(30000),
      })
    ).text();
const css = await fs.readFile(root + "index.css", "utf8");
let js;
async function buildClient() {
  return (
    await build({
      stdin: {
        resolveDir: root,
        loader: "tsx",
        contents: `
 import React from'react';import{createRoot}from'react-dom/client';import PartsPanel from'./components/PartsPanel';import{AppDialogHost}from'./components/AppDialogHost';
 const supervisor=new URLSearchParams(location.search).has('supervisor');function Fixture(){const[owner,setOwner]=React.useState(1);window.__switchPartsAccount=()=>setOwner(2);window.__partsOwner=owner;return <><AppDialogHost/><PartsPanel accountId={supervisor?'10000000-0000-4000-8000-'+String(owner).padStart(12,'0'):undefined} token={supervisor?undefined:${JSON.stringify(token)}}/></>;}createRoot(document.getElementById('root')).render(<Fixture/>);`,
      },
      bundle: true,
      write: false,
      format: "iife",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [
        {
          name: "authenticated-browser-boundary",
          setup(b) {
            b.onResolve({ filter: /AuthGate$/ }, (a) => ({
              path: a.path,
              namespace: "parts-auth",
            }));
            b.onLoad({ filter: /.*/, namespace: "parts-auth" }, () => ({
              resolveDir: root,
              contents: `import React from 'react';export const AuthShellContext=React.createContext(null);`,
            }));
            b.onResolve({ filter: /\/supabase$/ }, (a) => ({
              path: a.path,
              namespace: "parts-boundary",
            }));
            b.onLoad({ filter: /.*/, namespace: "parts-boundary" }, () => ({
              contents: `export const normalizeSupabaseUser=v=>v;export const getSessionUser=async()=>({id:'${id(1)}'});export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:'10000000-0000-4000-8000-'+String(window.__partsOwner||1).padStart(12,'0')},access_token:'user-'+(window.__partsOwner||1)}}})}};`,
            }));
          },
        },
      ],
    })
  ).outputFiles[0].text;
}
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/api/parts") {
      let input = "";
      for await (const chunk of req) input += chunk;
      const user =
        Number(req.headers.authorization?.match(/user-(\d+)/)?.[1]) || null;
      const out = await env.invoke(JSON.parse(input), user);
      for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.data));
      return;
    }
    if (req.url === "/service-worker.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(await fs.readFile(root + "public/service-worker.js", "utf8"));
      return;
    }
    if (req.url === "/assets/app.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(js);
      return;
    }
    if (req.url === "/assets/tailwind.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(tailwind);
      return;
    }
    if (req.url === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/assets/tailwind.js"></script><script>tailwind.config={darkMode:'class'}</script><style>${css}</style><div id="root"></div><script src="/assets/app.js"></script>`,
    );
  } catch (e) {
    res.writeHead(500);
    res.end("Fixture server failed");
  }
});
let browser, lastPage;
const runtimeErrors = [];
async function draw(page, { confirm = true } = {}) {
  const canvas = page.getByRole("dialog").locator("canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 25, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i < 12; i++)
    await page.mouse.move(
      box.x + 25 + i * 12,
      box.y + box.height / 2 + (i % 2 ? 20 : -20),
    );
  await page.mouse.up();
  await page.getByLabel(/Soy .*he leído esta versión/).check();
  if (!confirm) return;
  await page
    .getByRole("button", { name: "Confirmar firma", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}
try {
  js = await buildClient();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const base = "http://127.0.0.1:" + port;
  browser = await (engine === "webkit" ? webkit : chromium).launch({
    headless: true,
    ...(engine === "chromium" ? { args: ["--no-sandbox"] } : {}),
  });
  for (const width of [390, 820, 1440]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
      }),
      page = await context.newPage(),
      errors = [];
    lastPage = page;
    page.on("pageerror", (e) => {
      errors.push(e.message);
      runtimeErrors.push(e.message);
    });
    page.setDefaultTimeout(15000);
    await page.goto(base);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/service-worker.js");
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.reload();
    await page
      .getByRole("button", { name: "Nuevo aviso de servicio", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Nuevo aviso de servicio", exact: true })
      .click();
    await page.getByLabel("Trabajador", { exact: true }).selectOption("100");
    await page
      .getByLabel("Fecha y hora del hecho", { exact: true })
      .fill(content.occurredAt.slice(0, 16));
    await page
      .getByLabel("Lugar en la obra", { exact: true })
      .fill("Zona norte");
    await page
      .getByLabel("Descripción objetiva de los hechos", { exact: true })
      .fill("Apuntes escritos y dictados de prueba. No se midió la duración.");
    await page
      .getByLabel("Instrucción comunicada", { exact: true })
      .fill("Recordatorio de la instrucción de servicio.");
    await page
      .getByRole("button", { name: "Guardar en este dispositivo", exact: true })
      .click();
    await page
      .getByText("Borrador local conservado.", { exact: true })
      .waitFor();
    const beforeReload = await page.evaluate(() => performance.timeOrigin);
    if (originOutage) {
      // Playwright #42775: its offline flag rejects even literal SW responses in WebKit.
      // A real origin outage still exercises our unchanged SW and persisted encrypted draft.
      const stopped = new Promise((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      server.closeAllConnections();
      await stopped;
      assert.equal(server.listening, false);
      await page.reload();
    } else {
      await context.setOffline(true);
      await page.reload();
    }
    assert.notEqual(
      await page.evaluate(() => performance.timeOrigin),
      beforeReload,
      "recovery requires an actual new document, not the previous DOM",
    );
    await page
      .getByLabel("Descripción objetiva de los hechos", { exact: true })
      .waitFor();
    assert.match(
      await page
        .getByLabel("Descripción objetiva de los hechos", { exact: true })
        .inputValue(),
      /No se midió/,
    );
    assert.equal(
      await page
        .getByRole("button", {
          name: "Guardar borrador en servidor",
          exact: true,
        })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("button", {
        name: "Sincronizar borrador al recuperar conexión",
        exact: true,
      })
      .click();
    await page.getByText(/Pendiente de sincronización del borrador/).waitFor();
    if (originOutage)
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
    if (originOutage)
      await page
        .getByRole("button", { name: "Comprobar conexión", exact: true })
        .click();
    else await context.setOffline(false);
    await page
      .getByRole("button", { name: "Revisar y firmar aviso", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Revisar y firmar aviso", exact: true })
      .click();
    await draw(page);
    await page
      .getByRole("heading", { name: /Pendiente de comunicación/ })
      .waitFor();
    await page
      .getByLabel("Resultado", { exact: true })
      .selectOption("disagreement");
    await page
      .getByLabel(
        "Observaciones del trabajador o descripción objetiva del intento",
        { exact: true },
      )
      .fill("No comparto la descripción.");
    await page.getByLabel(/El documento completo ha sido mostrado/).check();
    await page
      .getByRole("button", {
        name: "Firma de recepción del trabajador",
        exact: true,
      })
      .click();
    await draw(page);
    await page.getByRole("heading", { name: /En revisión/ }).waitFor();
    await page
      .getByRole("button", { name: "Volver al listado", exact: true })
      .click();
    for (const dark of [false, true]) {
      await page.evaluate(
        (v) => document.documentElement.classList.toggle("dark", v),
        dark,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `${width} ${dark} horizontal overflow`,
      );
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  const supervisor = await browser.newPage({
    viewport: { width: 820, height: 1000 },
  });
  await supervisor.goto(base + "/?supervisor");
  const entry = supervisor
    .getByRole("button", { name: /Persona Homónima/ })
    .first();
  await entry.waitFor();
  await entry.click();
  await supervisor
    .getByLabel("Motivo de la decisión / justificación de comparabilidad")
    .fill("Revisadas las observaciones sin convertir el aviso en sanción.");
  await supervisor
    .getByRole("button", {
      name: "Revisar disconformidad con firma",
      exact: true,
    })
    .click();
  await draw(supervisor);
  await supervisor.getByRole("heading", { name: /Comunicado/ }).waitFor();
  // Independent foreman/supervisor HTTP sessions exercise circuit B and return/ratification.
  const foreman = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  lastPage = foreman;
  foreman.on("pageerror", (e) => runtimeErrors.push(e.message));
  await foreman.goto(base);
  await foreman
    .getByRole("button", { name: "Nuevo parte de incidencia", exact: true })
    .click();
  await foreman.getByLabel("Trabajador", { exact: true }).selectOption("101");
  await foreman
    .getByLabel("Fecha y hora del hecho", { exact: true })
    .fill(content.occurredAt.slice(0, 16));
  await foreman
    .getByLabel("Lugar en la obra", { exact: true })
    .fill("Acceso sur");
  await foreman
    .getByLabel("Descripción objetiva de los hechos", { exact: true })
    .fill(
      "Se solicita aclarar el cumplimiento de la instrucción, sin presuponer intenciones.",
    );
  await foreman
    .getByLabel("Instrucción comunicada", { exact: true })
    .fill("Recordatorio de la instrucción concreta.");
  const createdResponse = foreman.waitForResponse(
    (r) =>
      r.url().endsWith("/api/parts") &&
      r.request().postDataJSON()?.action === "create",
  );
  await foreman
    .getByRole("button", { name: "Guardar borrador en servidor", exact: true })
    .click();
  const initialDraft = (await (await createdResponse).json()).record;
  await foreman
    .getByRole("button", { name: "Firmar y enviar al supervisor", exact: true })
    .click();
  await draw(foreman, { confirm: false });
  const concurrentEdit = await fetch(base + "/api/parts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "edit",
      token,
      id: initialDraft.id,
      expected: initialDraft.revision,
      operationId: crypto.randomUUID(),
      command: {
        kind: "incident",
        content: {
          ...initialDraft.content,
          place: "Acceso sur, ubicación precisada desde otra sesión",
        },
      },
    }),
  });
  assert.equal(concurrentEdit.status, 200);
  await foreman.evaluate(() =>
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", { data: { type: "PARTS_UPDATED" } }),
    ),
  );
  await foreman
    .getByRole("dialog")
    .getByText(/ubicación precisada desde otra sesión/)
    .waitFor();
  assert.equal(
    await foreman
      .getByRole("dialog")
      .getByRole("button", { name: "Confirmar firma", exact: true })
      .isDisabled(),
    true,
    "a refreshed document cannot reuse an already captured signature",
  );
  assert.equal(
    await foreman.getByLabel(/Soy .*he leído esta versión/).isChecked(),
    false,
    "new version requires a new acknowledgment",
  );
  assert.equal(
    await foreman
      .getByRole("dialog")
      .locator("canvas")
      .evaluate((c) => {
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        return d.some((v, i) => i % 4 === 3 && v > 0);
      }),
    false,
    "the old mark is erased on a new revision",
  );
  await draw(foreman);
  const sentHeading = foreman.getByRole("heading", {
    name: /Enviado al supervisor/,
  });
  await sentHeading.waitFor();
  const number = (await sentHeading.innerText()).split(" · ")[0];
  assert.equal(
    await foreman.getByLabel("Resultado", { exact: true }).count(),
    0,
    "B does not permit communication before supervisor authorization",
  );
  await supervisor
    .getByRole("button", { name: "Volver al listado", exact: true })
    .click();
  await supervisor
    .getByRole("button", { name: "Actualizar", exact: true })
    .click();
  await supervisor
    .getByRole("button", { name: new RegExp(number + " ·") })
    .click();
  await supervisor
    .getByLabel("Motivo de la decisión / justificación de comparabilidad", {
      exact: true,
    })
    .fill("Precisar la ubicación antes de autorizar.");
  await supervisor
    .getByRole("button", { name: "Devolver para corrección", exact: true })
    .click();
  await supervisor.getByRole("heading", { name: /Devuelto/ }).waitFor();
  await foreman
    .getByRole("button", { name: "Actualizar", exact: true })
    .click();
  await foreman.getByRole("heading", { name: /Devuelto/ }).waitFor();
  await foreman
    .getByRole("button", { name: "Corregir borrador", exact: true })
    .click();
  await foreman
    .getByLabel("Lugar en la obra", { exact: true })
    .fill("Acceso sur junto a la caseta");
  await foreman
    .getByRole("button", { name: "Guardar borrador en servidor", exact: true })
    .click();
  await foreman
    .getByRole("button", { name: "Firmar y enviar al supervisor", exact: true })
    .click();
  await draw(foreman);
  await sentHeading.waitFor();
  await supervisor
    .getByRole("button", { name: "Actualizar", exact: true })
    .click();
  await supervisor
    .getByRole("button", { name: "Revisar y autorizar con firma", exact: true })
    .click();
  await draw(supervisor);
  await supervisor
    .getByRole("heading", { name: /Pendiente de comunicación/ })
    .waitFor();
  await foreman
    .getByRole("button", { name: "Actualizar", exact: true })
    .click();
  await foreman
    .getByRole("heading", { name: /Pendiente de comunicación/ })
    .waitFor();
  await foreman
    .getByLabel("Resultado", { exact: true })
    .selectOption("refused");
  await foreman
    .getByLabel(
      "Observaciones del trabajador o descripción objetiva del intento",
      { exact: true },
    )
    .fill(
      "Tras la lectura, declina firmar. No se presume acreditada la entrega.",
    );
  await foreman.getByLabel(/El documento completo ha sido mostrado/).check();
  await foreman
    .getByRole("button", { name: "Registrar intento sin firma", exact: true })
    .click();
  await foreman
    .getByRole("heading", { name: /Entrega no acreditada/ })
    .waitFor();
  const download = foreman.waitForEvent("download");
  await foreman
    .getByRole("button", { name: "Descargar PDF", exact: true })
    .click();
  assert.match((await download).suggestedFilename(), /\.pdf$/);
  await foreman.setViewportSize({ width: 844, height: 390 });
  assert.equal(
    await foreman.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "landscape has no horizontal overflow",
  );
  if (process.env.PARTS_EVIDENCE_DIR) {
    await fs.mkdir(process.env.PARTS_EVIDENCE_DIR, { recursive: true });
    await foreman.screenshot({
      path: process.env.PARTS_EVIDENCE_DIR + "/" + engine + "-delivery.png",
      fullPage: true,
    });
    await (
      await download
    ).saveAs(process.env.PARTS_EVIDENCE_DIR + "/" + engine + "-incident.pdf");
  }
  // A late response from the old authenticated account must never repopulate the new account.
  let delayedResolve;
  const delayed = new Promise((r) => (delayedResolve = r));
  let delayOnce = true;
  await supervisor.route("**/api/parts", async (route) => {
    if (delayOnce && route.request().postDataJSON()?.action === "detail") {
      delayOnce = false;
      delayedResolve();
      await new Promise((r) => setTimeout(r, 250));
    }
    await route.continue();
  });
  const late = supervisor.waitForResponse(
    (r) =>
      r.url().endsWith("/api/parts") &&
      r.request().postDataJSON()?.action === "detail",
  );
  await supervisor
    .getByRole("button", { name: "Actualizar", exact: true })
    .click();
  await delayed;
  await supervisor.evaluate(() => window.__switchPartsAccount());
  await late;
  await supervisor.waitForFunction(
    () => !document.body.textContent.includes("Persona Homónima"),
  );
  assert.equal(
    await supervisor.getByRole("button", { name: /Persona Homónima/ }).count(),
    0,
  );
  console.log(
    "PASS Partes account switch: late old-account detail discarded and personal data cleared.",
  );
  await foreman.setViewportSize({ width: 390, height: 844 });
  await foreman
    .getByRole("button", { name: "Nuevo aviso de servicio", exact: true })
    .click();
  await foreman.getByLabel("Trabajador", { exact: true }).selectOption("101");
  await foreman
    .getByLabel("Descripción objetiva de los hechos", { exact: true })
    .fill("Borrador conservado tras revocar el acceso.");
  await foreman
    .getByRole("button", { name: "Guardar en este dispositivo", exact: true })
    .click();
  await foreman
    .getByText("Borrador local conservado.", { exact: true })
    .waitFor();
  await env.db.exec("reset role");
  await env.db.query(
    "update foreman_portal_access set active=false where id=$1",
    [id(10)],
  );
  await foreman.reload();
  await foreman
    .getByRole("alert")
    .filter({ hasText: /revocado o no válido/ })
    .waitFor();
  assert.equal(
    await foreman
      .getByLabel("Descripción objetiva de los hechos", { exact: true })
      .inputValue(),
    "Borrador conservado tras revocar el acceso.",
  );
  assert.equal(
    await foreman
      .getByRole("button", {
        name: "Guardar borrador en servidor",
        exact: true,
      })
      .isDisabled(),
    true,
  );
  assert.equal(
    await foreman
      .getByLabel("Trabajador", { exact: true })
      .locator("option")
      .filter({ hasText: "Persona Homónima" })
      .count(),
    0,
    "an actual denial must not restore the cached authorised worker context",
  );
  console.log(
    "PASS Partes revoked access: draft text retained, server writes disabled and authorised cached context not reused after 403.",
  );
  assert.deepEqual(runtimeErrors, []);
  console.log(
    "PASS Partes signature refresh: concurrent edit resets the captured mark and acknowledgment before ratification.",
  );
  console.log(
    "PASS Partes circuit B: separate HTTP sessions, blocked premature receipt, return/correction/new declaration, supervisor authorization, refusal without forged signature, PDF download and landscape.",
  );
  console.log(
    `PASS Partes ${engine} 390/820/1440 light/dark: real UI + handler + PostgreSQL, encrypted draft/reload/reconnection (${originOutage ? "real origin outage and explicit server-confirmed recovery" : "browser offline emulation"}), direct service declaration, worker disagreement receipt, supervisor review signature, no horizontal overflow or runtime exceptions.`,
  );
} catch (e) {
  console.error(e.message, runtimeErrors);
  if (lastPage)
    console.error(
      (
        await lastPage
          .locator("body")
          .innerText()
          .catch(() => "")
      ).slice(0, 2500),
    );
  throw e;
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
  await env.close();
}
