import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { build } from "esbuild";
import { chromium, webkit } from "playwright";
import { partsTestHarness, token, id } from "./partsTestHarness.mjs";
const engine = process.env.BROWSER_ENGINE === "webkit" ? "webkit" : "chromium";
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
 const supervisor=new URLSearchParams(location.search).has('supervisor');createRoot(document.getElementById('root')).render(<><AppDialogHost/><PartsPanel token={supervisor?undefined:${JSON.stringify(token)}}/></>);`,
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
              contents: `export const normalizeSupabaseUser=v=>v;export const getSessionUser=async()=>({id:'${id(1)}'});export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:'${id(1)}'},access_token:'user-1'}}})}};`,
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
async function draw(page) {
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
  await page
    .getByRole("button", { name: "Confirmar firma", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}
try {
  js = await buildClient();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
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
      .fill("2026-10-26T10:00");
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
    await context.setOffline(true);
    await page.reload();
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
    await context.setOffline(false);
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
  console.log(
    `PASS Partes ${engine} 390/820/1440 light/dark: real UI + handler + PostgreSQL, encrypted offline draft/reload/reconnection, direct service declaration, worker disagreement receipt, supervisor review signature, no horizontal overflow or runtime exceptions.`,
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
