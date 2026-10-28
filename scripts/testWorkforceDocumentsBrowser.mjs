import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { build } from "esbuild";
import { chromium, webkit } from "playwright";
import { partsTestHarness, token, id } from "./partsTestHarness.mjs";
const engine = process.env.BROWSER_ENGINE === "webkit" ? "webkit" : "chromium";
const env = await partsTestHarness({
    workforce: true,
    now: "2026-10-28T12:00:00Z",
  }),
  root = new URL("../", import.meta.url).pathname;
const source = await fs.readFile(
  root + "src/services/foremanPortalService.ts",
  "utf8",
);
const names = [...source.matchAll(/export (?:async )?function (\w+)/g)].map(
  (m) => m[1],
);
const dbsource = await fs.readFile(
  root + "src/services/databaseService.ts",
  "utf8",
);
const dbnames = [...dbsource.matchAll(/export (?:async )?function (\w+)/g)].map(
  (m) => m[1],
);
const work = {
  id: id(20),
  nombre: "Obra A",
  codigo: "11002GR",
  municipio: "Municipio de prueba",
  empresa: "Entidad sintética",
  cif: "X0000000T",
  recurso_preventivo: "Encargado de prueba",
};
const worker = {
  id: 100,
  apellidosNombre: "Persona Homónima",
  obra: "Obra A",
  dni: "00000000T",
  categoria: "Peón",
  periodoInicio: "2026-10-01",
  periodoFin: "2026-10-31",
};
const tailwind = await (
  await fetch("https://cdn.tailwindcss.com", {
    signal: AbortSignal.timeout(30000),
  })
).text();
const css = await fs.readFile(root + "index.css", "utf8");
const js = (
  await build({
    stdin: {
      resolveDir: root,
      loader: "tsx",
      contents: `import React from'react';import{createRoot}from'react-dom/client';import{ForemanMobilePortal}from'./components/ForemanMobilePortal';import{WorksiteDocumentationPortal}from'./components/WorksiteDocumentationPortal';import{AppDialogHost}from'./components/AppDialogHost';const s=new URLSearchParams(location.search).has('supervisor');createRoot(document.getElementById('root')).render(<><AppDialogHost/>{s?<div className="p-4 min-w-0"><WorksiteDocumentationPortal/></div>:<ForemanMobilePortal token="${token}"/>}</>);`,
    },
    bundle: true,
    write: false,
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "controlled-auth-and-legacy-context",
        setup(b) {
          b.onResolve({ filter: /\?url$|\.css$/ }, (a) => ({
            path: a.path,
            namespace: "asset",
          }));
          b.onLoad({ filter: /.*/, namespace: "asset" }, () => ({
            contents: "export default '';",
          }));
          b.onResolve({ filter: /\/foremanPortalService$/ }, (a) => ({
            path: a.path,
            namespace: "foreman",
          }));
          b.onLoad({ filter: /.*/, namespace: "foreman" }, () => ({
            contents: names
              .map(
                (n) =>
                  `export const ${n}=async()=>(${n === "resolveForemanPortal" ? JSON.stringify({ valid: true, obra: "Obra A", foremanName: "Encargado de prueba", workers: [worker], attendance: [], documents: [], mandatoryDocuments: [], worksite: { codigo: "11002GR", nombre: "Obra A", municipio: "Municipio de prueba", empresa: "Entidad sintética", cif: "X0000000T" } }) : "([])"});`,
              )
              .join("\n"),
          }));
          b.onResolve({ filter: /\/databaseService$/ }, (a) => ({
            path: a.path,
            namespace: "database",
          }));
          b.onLoad({ filter: /.*/, namespace: "database" }, () => ({
            contents:
              dbnames
                .map(
                  (n) =>
                    `export const ${n}=${n === "subscribeToDocuments" ? "()=>()=>{}" : n === "getDocuments" ? "async()=>" + JSON.stringify([worker]) : "async()=>[]"};`,
                )
                .join("\n") + "export const getSharedDocuments=getDocuments;",
          }));
          b.onResolve({ filter: /AuthGate$/ }, (a) => ({
            path: a.path,
            namespace: "auth",
          }));
          b.onLoad({ filter: /.*/, namespace: "auth" }, () => ({
            resolveDir: root,
            contents:
              "import React from'react';export const AuthShellContext=React.createContext(null);",
          }));
          b.onResolve({ filter: /\/supabase$/ }, (a) => ({
            path: a.path,
            namespace: "supabase",
          }));
          b.onLoad({ filter: /.*/, namespace: "supabase" }, () => ({
            contents: `export const normalizeSupabaseUser=v=>v;export const getSessionUser=async()=>({id:'${id(1)}',email:'test@example.test'});export const supabase={query:async(table)=>table==='obras'?${JSON.stringify([work])}:table==='profiles'?[{id:'${id(1)}',nombre:'Supervisor',apellidos:'Prueba'}]:[],rpc:async()=>({}),auth:{getSession:async()=>({data:{session:{access_token:'user-1',user:{id:'${id(1)}'}}}})}};`,
          }));
        },
      },
    ],
  })
).outputFiles[0].text;
let lostSave = false,
  requests = [];
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/api/workforce-documents") {
      let data = "";
      for await (const c of req) data += c;
      const body = JSON.parse(data);
      requests.push(body.action);
      const user =
        Number(req.headers.authorization?.match(/user-(\d+)/)?.[1]) || null;
      const r = await env.invoke(body, user);
      if (lostSave && body.action === "save") {
        req.socket.destroy();
        return;
      }
      for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
      res.writeHead(r.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(r.data));
      return;
    }
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(js);
      return;
    }
    if (req.url === "/tailwind.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(tailwind);
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}</style><div id="root"></div><script src="/app.js"></script>`,
    );
  } catch (e) {
    console.error("Fixture failure:", e.message);
    res.writeHead(500);
    res.end("Fixture failure");
  }
});
let browser, lastPage;
async function draw(page) {
  const canvas = page.locator("canvas").last();
  await canvas.scrollIntoViewIfNeeded();
  const b = await canvas.boundingBox();
  await page.mouse.move(b.x + 25, b.y + 50);
  await page.mouse.down();
  for (let i = 1; i < 15; i++)
    await page.mouse.move(b.x + 25 + i * 10, b.y + 50 + (i % 2 ? 15 : -15));
  await page.mouse.up();
}
async function openDocuments(page) {
  const navigation = page.getByRole("navigation", { name: "Secciones del portal de encargados" });
  const parts = navigation.getByRole("button", { name: "Partes y avisos", exact: true });
  await parts.waitFor();
  assert.equal(await page.getByRole("button", { name: "Partes y avisos", exact: true }).count(), 1, "Single parts entry inside the navigation ribbon");
  assert.equal(await parts.locator("svg").count(), 1, "Parts has an icon like the other entries");

  await page.getByRole("button", { name: "Documentos", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Rechazo voluntario", exact: true }).count(), 0, "Rejection is inside Documents");
  assert.equal(await page.getByRole("button", { name: "Salida de obra", exact: true }).count(), 0, "Departure is inside Documents");
  assert.equal(await page.getByRole("button", { name: "Actas de visitas", exact: true }).locator("svg").count(), 1, "Visit minutes has a navigation icon");
  await page.getByRole("button", { name: "Documentos", exact: true }).click();
}
async function signed(page, kind) {
  await page
    .getByRole("button", {
      name: kind === "salida_obra" ? "Salida de obra" : "Rechazo voluntario",
      exact: true,
    })
    .first()
    .click();
  const panel = page.getByRole("region", {
    name: kind === "salida_obra" ? "Salida de obra" : "Rechazo voluntario",
  });
  await panel
    .getByRole("button", { name: /Persona Homónima · Peón/ })
    .first()
    .click();
  await panel
    .getByLabel("Referencia del contrato firmado / contratación")
    .fill("Contrato sintético BROWSER-100");
  await panel
    .getByLabel("¿Existe contratación formalizada?")
    .selectOption("yes");
  if (kind === "salida_obra") {
    await panel
      .getByLabel("Fecha y hora de salida (Europe/Madrid)", { exact: true })
      .fill("2026-10-28T01:00");
    await panel
      .getByLabel("Alcance de la hora de salida")
      .selectOption("actual");
    await panel
      .getByLabel("Motivo general obligatorio")
      .selectOption("Consulta médica");
  } else {
    await panel.getByLabel("Fecha de firma del contrato").fill("2026-10-01");
    await panel
      .getByLabel("Fecha prevista de incorporación")
      .fill("2026-10-01");
    await panel
      .getByLabel("¿Ha comenzado efectivamente a prestar servicios?")
      .selectOption("yes");
    await panel
      .getByLabel("¿Qué manifiesta exactamente la persona?")
      .selectOption("cease");
    await panel
      .getByLabel("Fecha de efectos que manifiesta el trabajador")
      .fill("2026-10-28");
    await panel
      .getByLabel("Motivo general obligatorio")
      .selectOption("Motivos personales");
    await panel
      .getByLabel("Convenio o régimen laboral realmente aplicable")
      .fill("Régimen sintético de ensayo");
    await panel
      .getByLabel(
        "Referencia oficial, artículo y ámbito contrastados del convenio/régimen",
      )
      .fill("Referencia sintética del ensayo");
    await panel
      .getByLabel(
        "Preaviso según contrato/régimen comprobado (sin plazo universal)",
      )
      .fill("Comprobación de ensayo");
    await panel
      .getByLabel(
        "¿Se ha contrastado este supuesto con contrato y régimen aplicables?",
      )
      .selectOption("yes");
  }
  await panel
    .getByRole("button", { name: "Guardar borrador en servidor", exact: true })
    .click();
  await panel
    .getByRole("button", {
      name: "Validar y preparar para lectura y firma",
      exact: true,
    })
    .waitFor();
  await panel
    .getByRole("button", {
      name: "Validar y preparar para lectura y firma",
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", {
      name: "Firma voluntaria del trabajador",
      exact: true,
    })
    .click();
  assert.equal(
    await panel
      .getByRole("button", { name: "Confirmar y guardar firma", exact: true })
      .isEnabled(),
    false,
  );
  await panel
    .getByLabel(
      "He podido leer esta versión y firmo voluntariamente su contenido concreto.",
    )
    .check();
  await draw(page);
  await panel
    .getByRole("button", { name: "Confirmar y guardar firma", exact: true })
    .click();
  await panel
    .getByRole("button", {
      name: "Confirmación y firma del encargado",
      exact: true,
    })
    .click();
  await panel
    .getByLabel(
      /Confirmo expresamente la recepción y lectura de esta comunicación/,
    )
    .check();
  await draw(page);
  await panel
    .getByRole("button", { name: "Confirmar y guardar firma", exact: true })
    .click();
  await panel.getByRole("heading", { name: /Finalizado/ }).waitFor();
  await panel
    .getByRole("button", { name: "Previsualizar PDF", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Previsualización del documento" })
    .waitFor();
  await page
    .getByRole("button", { name: "Cerrar previsualización", exact: true })
    .click();
  // Native share cancellation is a real browser exception; it must not report a send.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new DOMException("cancelled", "AbortError");
      },
    });
  });
  await panel
    .getByRole("button", { name: "Entrega manual", exact: true })
    .click();
  await page.waitForTimeout(100);
  assert.equal(await panel.getByRole("alert").count(), 0);
  assert.ok(!(await panel.innerText()).includes("enviado"));
  return panel;
}
try {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  browser = await (engine === "webkit" ? webkit : chromium).launch({
    headless: true,
    ...(engine === "chromium" ? { args: ["--no-sandbox"] } : {}),
  });
  for (const width of process.env.WORKFORCE_BROWSER_RECOVERY_ONLY
    ? []
    : [390, 820, 1440]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
      }),
      page = await context.newPage();
    lastPage = page;
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack||e.message));
    page.setDefaultTimeout(20000);
    await page.clock.setFixedTime(new Date("2026-10-28T12:00:00Z"));
    await page.goto(base);
    await openDocuments(page);
    await page
      .getByRole("button", { name: "Rechazo voluntario", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Salida de obra", exact: true })
      .waitFor();
    const panel = await signed(page, "salida_obra");
    await panel
      .getByLabel("Regreso efectivo comprobado")
      .fill("2026-10-28T02:00");
    await panel
      .getByLabel(
        "Confirmo que he comprobado estas horas efectivas. No son estimaciones.",
      )
      .check();
    await panel
      .getByRole("button", {
        name: "Registrar regreso sin alterar el PDF firmado",
        exact: true,
      })
      .click();
    await panel
      .getByRole("button", {
        name: "Consultar diligencia de regreso",
        exact: true,
      })
      .waitFor();
    await page.waitForLoadState("networkidle");
    await page.reload();
    await openDocuments(page);
    await page
      .getByRole("button", { name: "Salida de obra", exact: true })
      .click();
    await page
      .getByRole("button", { name: /Persona Homónima · Regreso registrado/ })
      .first()
      .click();
    await page
      .getByRole("button", {
        name: "Consultar diligencia de regreso",
        exact: true,
      })
      .waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "No horizontal overflow",
    );
    await fs.mkdir(root + "tmp/workforce", { recursive: true });
    await page.screenshot({
      path: root + `tmp/workforce/${engine}-${width}.png`,
      fullPage: true,
    });
    await page.waitForLoadState("networkidle");
    await page.goto(base + "/?supervisor=1");
    await page
      .getByRole("button", { name: "Rechazo voluntario", exact: true })
      .first()
      .waitFor();
    await page
      .getByRole("button", { name: "Salida de obra", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: /Persona Homónima · Regreso registrado/ })
      .first()
      .click();
    await page
      .getByRole("button", {
        name: "Consultar diligencia de regreso",
        exact: true,
      })
      .waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      JSON.stringify(
        await page.evaluate(() =>
          Array.from(document.querySelectorAll("*"))
            .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
            .slice(0, 15)
            .map((e) => ({
              tag: e.tagName,
              cls: e.className,
              w: e.getBoundingClientRect().width,
              right: e.getBoundingClientRect().right,
              text: e.textContent.slice(0, 100),
            })),
        ),
      ),
    );
    await page.clock.setFixedTime(new Date("2026-10-28T12:00:00Z"));
    await page.goto(base);
    await openDocuments(page);
    await signed(page, "rechazo_voluntario");
    await page.waitForLoadState("networkidle");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(engine + ": responsive flows complete");
  // Real HTTP response loss with an unsigned draft, followed by reload + idempotent replay.
  const context = await browser.newContext(),
    page = await context.newPage();
  lastPage = page;
  await page.clock.setFixedTime(new Date("2026-10-28T12:00:00Z"));
  await page.goto(base);
  await openDocuments(page);
  await page
    .getByRole("button", { name: "Salida de obra", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Persona Homónima · Peón/ })
    .first()
    .click();
  await page
    .getByLabel("Referencia del contrato firmado / contratación")
    .fill("Borrador recuperable");
  lostSave = true;
  await page
    .getByRole("button", { name: "Guardar borrador en servidor", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  lostSave = false;
  await page.reload();
  await openDocuments(page);
  await page
    .getByRole("button", { name: "Salida de obra", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reintentar el mismo guardado", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Reintentar el mismo guardado", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Validar y preparar para lectura y firma",
      exact: true,
    })
    .waitFor();
  await context.close();
  console.log(
    `${engine}: both complete portals, two document flows, signatures, persistent reload, same supervisor record, return addendum, PDF preview, cancelled share, lost HTTP ACK recovery; mobile/tablet/desktop PASS.`,
  );
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage
      .screenshot({
        path: root + "tmp/workforce/browser-failure.png",
        fullPage: true,
      })
      .catch(() => {});
    console.error((await lastPage.locator("body").innerText()).slice(-3000));
  }
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await env.close();
}
