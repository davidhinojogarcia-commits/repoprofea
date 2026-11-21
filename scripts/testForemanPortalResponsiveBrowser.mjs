import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { chromium, webkit } from "playwright";

const engine = process.env.BROWSER_ENGINE === "webkit" ? "webkit" : "chromium";
const root = new URL("../", import.meta.url).pathname;
const portal = await fs.readFile(path.join(root, "components/ForemanMobilePortal.tsx"), "utf8");
const parts = await fs.readFile(path.join(root, "components/PartsPanel.tsx"), "utf8");
const workforce = await fs.readFile(path.join(root, "components/WorkforceDocumentsPanel.tsx"), "utf8");
const css = await fs.readFile(path.join(root, "index.css"), "utf8");

// Fixture snapshots come from the real React portal mounted by the existing
// foreman-publication regression, never a hand-made substitute interface.
assert.match(portal, /className="fp-portal-ui/);
assert.equal((portal.match(/fp-section-tab min-h-/g) || []).length, 10);
assert.equal((portal.match(/aria-pressed=\{tab===/g) || []).length, 10);
assert.match(parts, /fp-action-row--adaptive/);
assert.match(workforce, /fp-workforce-panel/);
assert.match(css, /@media \(max-width: 900px\), \(pointer: coarse\) and \(max-width: 1440px\)/);
const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), "foreman-responsive-"));
let server, browser;
try {
  execFileSync(process.execPath, ["scripts/testForemanPublicationUi.mjs"], {
    cwd: root,
    env: { ...process.env, FOREMAN_LAYOUT_CAPTURE_DIR: snapshotDir },
    stdio: "pipe",
    timeout: 120000
  });
  const signedTypes = ["control_presencia","inicio","contrato","prorroga"];
  const sections = ["mandatory",...signedTypes.map(type=>"mandatory-"+type),"control", "documents", "maquinaria"];
  for (const section of sections) {
    assert((await fs.stat(path.join(snapshotDir, section + ".html"))).size > 800);
  }

  const tailwind = process.env.SIGNATURE_TAILWIND_SCRIPT
    ? await fs.readFile(process.env.SIGNATURE_TAILWIND_SCRIPT, "utf8")
    : await (await fetch("https://cdn.tailwindcss.com", { signal: AbortSignal.timeout(30000) })).text();
  server = http.createServer(async (req, res) => {
    if (req.url === "/assets/tw.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(tailwind);
      return;
    }
    const section = (req.url || "/mandatory").replace(/^\//, "").split("?")[0] || "mandatory";
    if (!sections.includes(section)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const markup = await fs.readFile(path.join(snapshotDir, section + ".html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/assets/tw.js"></script><script>tailwind.config={darkMode:"class"}</script><style>' + css + '</style></head><body>' + markup + '</body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;

  browser = await (engine === "webkit" ? webkit : chromium).launch({
    headless: true,
    ...(engine === "chromium" ? { args: ["--no-sandbox"] } : {}),
  });
  for (const configuration of [
    { name: "compact phone", width: 320, height: 740, touch: true },
    { name: "phone", width: 390, height: 844, touch: true },
    { name: "tablet portrait", width: 820, height: 1180, touch: true },
    { name: "tablet landscape", width: 1366, height: 1024, touch: true },
    { name: "desktop", width: 1440, height: 900, touch: false },
  ]) {
    const context = await browser.newContext({
      viewport: { width: configuration.width, height: configuration.height },
      hasTouch: configuration.touch,
      isMobile: configuration.touch,
      deviceScaleFactor: configuration.touch ? 2 : 1,
    });
    const page = await context.newPage();
    try {
      for (const section of sections) {
        await page.goto(base + "/" + section, { waitUntil: "load" });
        await page.waitForFunction(() => !!document.querySelector(".fp-section-tab"));
        await page.waitForTimeout(150);
        if(section.startsWith("mandatory-")){
          const count=await page.getByRole("button",{name:/Revocar y repetir firma de/}).count();
          const expected=["contrato","prorroga"].some(type=>section.endsWith(type))?1:2;
          assert.equal(count,expected,engine+" "+configuration.name+" "+section+": one accessible correction action per signed worker");
          const buttons=page.getByRole("button",{name:/Revocar y repetir firma de/});
          for(let i=0;i<count;i++){
            const rect=await buttons.nth(i).boundingBox();
            assert(rect && rect.width>=44 && rect.height>=44,engine+": signature correction touch target too small");
            if(configuration.touch)assert(rect.x+rect.width<=configuration.width+5,engine+": correction action outside viewport");
          }
        }
        const metrics = await page.evaluate(() => {
          const measure = element => {
            const r = element.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right };
          };
          const shell = document.querySelector(".fp-portal-ui");
          const nav = document.querySelector(".fp-section-nav");
          const track = document.querySelector(".fp-section-track");
          const tiles = [...document.querySelectorAll(".fp-section-tab")];
          const rows = [...document.querySelectorAll(".fp-action-row")].map(element => ({
            className: element.className,
            children: [...element.children].filter(child => child.matches("button,label")).map(measure),
          }));
          return {
            shell: !!shell,
            nav: !!nav,
            documentWidth: document.documentElement.scrollWidth,
            trackOverflow: track.scrollWidth > track.clientWidth + 8,
            tiles: tiles.map(measure),
            activeCount: tiles.filter(button => button.getAttribute("aria-pressed") === "true").length,
            selectedStyle: getComputedStyle(tiles.find(button => button.getAttribute("aria-pressed") === "true")).backgroundColor,
            desktopMinWidth: tiles.map(button => parseFloat(getComputedStyle(button).minWidth)),
            rows,
          };
        });
        assert(metrics.shell && metrics.nav, engine + ": missing actual foreman portal");
        assert.equal(metrics.activeCount, 1, engine + ": exactly one section should be active");
        if (configuration.touch) {
          assert(metrics.documentWidth <= configuration.width + 5,
            engine + " " + configuration.name + " " + section + ": horizontal overflow (" + metrics.documentWidth + "px)");
          assert(metrics.tiles.every(tile => tile.width >= 100 && tile.height >= 64),
            engine + " " + configuration.name + ": undersized navigation target");
          assert(Math.max(...metrics.tiles.map(tile => tile.width)) - Math.min(...metrics.tiles.map(tile => tile.width)) <= 2,
            engine + " " + configuration.name + ": inconsistent navigation widths");
          assert(metrics.selectedStyle !== "rgba(0, 0, 0, 0)", engine + ": active section invisible");
          if (configuration.width < 600) assert(metrics.trackOverflow, engine + ": mobile tabs must scroll independently");
          for (const row of metrics.rows) {
            for (const action of row.children) {
              assert(action.height >= 46 && action.width >= 44,
                engine + " " + configuration.name + " " + section + ": insufficient touch target for " + row.className + " " + JSON.stringify(action));
              assert(action.right <= configuration.width + 5,
                engine + ": action crosses viewport in " + row.className);
            }
            if (row.className.includes("fp-action-row--two") && row.children.length === 2) {
              assert(Math.abs(row.children[0].width - row.children[1].width) <= 3,
                engine + ": misaligned two-column action row");
            }
          }
        } else {
          assert.equal(metrics.desktopMinWidth[0], 96, "desktop: original mandatory tab width preserved");
          assert.equal(metrics.desktopMinWidth[3], 82, "desktop: original EPI tab width preserved");
        }
      }
      console.log("PASS " + engine + " " + configuration.name +
        ": real React portal sections, navigation, action geometry and no touch overflow");
    } finally {
      await context.close();
    }
  }
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await fs.rm(snapshotDir, { recursive: true, force: true });
}
