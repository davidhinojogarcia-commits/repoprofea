import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const engine = process.env.BROWSER_ENGINE === 'webkit' ? 'webkit' : 'chromium';
const tailwind = process.env.SIGNATURE_TAILWIND_SCRIPT
  ? await fs.readFile(process.env.SIGNATURE_TAILWIND_SCRIPT, 'utf8')
  : await (await fetch('https://cdn.tailwindcss.com', { signal: AbortSignal.timeout(30000) })).text();
const appCss = await fs.readFile(root + 'index.css', 'utf8');
const need = { id: 'need', obra: 'Arcos de la Frontera', codigoObra: '11096 EE', mes: 'Octubre', ano: 2026, categorias: [
  { id: 'q1', categoria: 'Peones · 1ª Quincena', cantidad: 6 },
  { id: 'q2', categoria: 'Peones · 2ª Quincena', cantidad: 6 },
  { id: 'officer', categoria: 'Oficial 1ª · Revocador · CN 72121041', cantidad: 1 },
] };
const reports = ['Primera quincena.pdf', 'Segunda quincena.pdf', 'Oficiales.pdf', 'Ampliacion primera.pdf'].map((fileName, i) => ({
  id: `report-${i}`, needId: 'need', fileName, mes: 'Octubre', categoria: i === 2 ? 'Oficial 1ª Revocador' : 'Peón',
  quincena: i === 2 ? '' : i === 1 ? '2ª Quincena' : '1ª Quincena', status: 'review', versions: [],
}));
const initial = reports.flatMap((report, index) => Array.from({ length: index === 2 || index === 3 ? 1 : 12 }, (_, i) => ({
  id: `${report.id}-${i}`, reportId: report.id, needId: 'need', orderNumber: i + 1,
  normalizedName: index === 3 ? 'Trabajador 0 0' : `Trabajador ${index} ${i}`, nombre: `Nombre ${i}`, apellidos: `Apellido ${index}`,
  categoria: report.categoria, quincena: report.quincena, estado: 'Sin asignar', resultCode: index === 0 && i < 5 || index === 3 ? '2001' : '',
})));
let candidates = structuredClone(initial), fail = false, browser, server;
const errors = [];
try {
  const output = await build({ stdin: { contents: `import React from 'react';import{AppDialogHost}from'./components/AppDialogHost';import{createRoot}from'react-dom/client';import{SaeSection}from'./components/SaeSection';createRoot(document.getElementById('root')).render(<><div className="app-navigation-panel" style={{position:'sticky',top:0,zIndex:80,height:48,background:'white'}}>Cabecera de la aplicación</div><AppDialogHost/><SaeSection people={[]} onToast={text=>document.getElementById('toast').textContent=text}/></>);`, resolveDir: root, loader: 'tsx' },
    bundle: true, platform: 'browser', format: 'iife', write: false, outdir: '/tmp/sae-hiring-browser',
    define: { 'import.meta.env': '{}' }, plugins: [{ name: 'boundaries', setup(b) {
      b.onResolve({ filter: /saeService$|saeFortnightService$|saeMonthlyService$|AuthGate$|appSettingsService$|annualHiringPeriodsService$|databaseService$|saeDocumentParser$|SaeReportPreview$|\/lib\/supabase$/ }, args => ({ path: args.path, namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents:
        path.endsWith('saeService') ? `const state=async()=>await(await fetch('/state')).json();export const listSaeNeeds=async()=>[${JSON.stringify(need)}];export const listSaeReports=async()=>${JSON.stringify(reports)};export const listSaeCandidates=async()=>(await state()).candidates;export const updateSaeCandidate=async(id,patch)=>{const r=await fetch('/update',{method:'POST',body:JSON.stringify({id,patch})});if(!r.ok)throw Error('Fallo de guardado de prueba');};export const monthNumber=()=>10;export const SAE_RESULT_CODES=[['2001','Contratará al candidato'],['2500','Ya ocupado'],['2212','Otros motivos']];export const createSaeNeed=()=>{};export const createSaeReport=()=>{};export const deleteSaeNeed=()=>{};export const deleteSaeReport=()=>{};export const loadSaeReportFile=()=>{};export const saveSaeReportPeriod=()=>{};export const saveSaeReportAlignment=()=>{};export const positionSaePreviewCandidates=()=>{};export const updateSaeNeed=()=>{};export const updateSaeReportStatus=()=>{};` :
        path.endsWith('saeFortnightService') ? 'export const syncSaeFortnightCodes=async()=>[];' :
        path.endsWith('saeMonthlyService') ? 'export const applySaeMonthlyCode=async()=>{};' :
        path.endsWith('AuthGate') ? "export const useAuthShell=()=>({supervisorName:'Supervisor de prueba'});" :
        path.endsWith('appSettingsService') ? 'export const loadAppBusinessSettings=async()=>({});' :
        path.endsWith('annualHiringPeriodsService') ? 'export const listAnnualHiringPeriods=async()=>[];' :
        path.endsWith('databaseService') ? 'export const createDocument=async()=>{};export const deleteDocument=async()=>{};' :
        path.endsWith('saeDocumentParser') ? 'export const parseSaeNeedFile=()=>{};export const parseSaeReportFile=()=>{};export const fileToDataUrl=()=>{};export const titleCaseSpanish=v=>v;' :
        path.endsWith('SaeReportPreview') ? 'export default ()=>null;' : 'export const supabase={};'
      }));
    } }] });
  server = http.createServer(async (req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(output.outputFiles.find(f => f.path.endsWith('.js')).text); }
    
    if (req.url === '/tailwind.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(tailwind); }
    if (req.url === '/state') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ candidates })); }
    if (req.url === '/update') {
      let body = ''; for await (const chunk of req) body += chunk;
      const { id, patch } = JSON.parse(body);
      if (fail) { res.statusCode = 503; return res.end('failed'); }
      candidates = candidates.map(c => c.id === id ? { ...c, ...patch } : c);
      return res.end('{}');
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><script>tailwind.config={darkMode:'class'}</script><style>${appCss}body{margin:0;padding:12px;font-family:Arial}.ui-surface{border-radius:16px;border:1px solid #cbd5e1}#toast{position:fixed;bottom:0;background:white}</style></head><body><div id="root"></div><div id="toast"></div><script>window.addEventListener("profea:dialog",e=>{window.pendingConfirmation=e.detail;});</script><script src="/app.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SAE_BROWSER_EXECUTABLE ? { executablePath: process.env.SAE_BROWSER_EXECUTABLE } : {}) });
  for (const width of [390, 820, 1440]) {
    candidates = structuredClone(initial);
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const panel = page.getByRole('region', { name: 'Control de contratación por periodo' });
    await panel.waitFor();
    await page.locator('#sae-candidate-selection select').nth(11).waitFor();
    assert.equal(await page.getByLabel('Apellidos',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Corregir nombre',exact:true}).first().click();
    await page.getByLabel('Apellidos',{exact:true}).fill('Apellido corregido');
    assert.equal(candidates[0].apellidos,'Apellido 0','typing never writes');
    await page.getByRole('button',{name:'Cancelar',exact:true}).click();
    assert.equal(candidates[0].apellidos,'Apellido 0','cancel never writes');
    await page.getByRole('button',{name:'Corregir nombre',exact:true}).nth(11).click();
    await page.getByLabel('Apellidos',{exact:true}).fill('Apellido revisado');
    fail=true;
    await page.getByRole('button',{name:'Guardar nombre',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Fallo de guardado de prueba'}).waitFor();
    assert.equal(await page.getByLabel('Apellidos',{exact:true}).inputValue(),'Apellido revisado');
    assert.equal(candidates[11].apellidos,'Apellido 0','failed save leaves server unchanged');
    fail=false;
    await page.getByRole('button',{name:'Guardar nombre',exact:true}).click();
    await page.getByText(/12\. Apellido revisado Nombre 11/).waitFor();
    await page.reload();
    await page.getByText(/12\. Apellido revisado Nombre 11/).waitFor();
    assert.equal(await page.getByLabel('Apellidos',{exact:true}).count(),0,'editor collapses after save and reload');


    const first = panel.locator('[data-period="1ª Quincena"]');
    const second = panel.locator('[data-period="2ª Quincena"]');
    const monthly = panel.locator('[data-period="Mensual"]');
    const values = async row => row.locator('.sae-hiring-number strong').allTextContents();
    assert.deepEqual(await values(first), ['6', '5', '1']);
    assert.deepEqual(await values(second), ['6', '0', '6']);
    assert.deepEqual(await values(monthly), ['1', '0', '1']);
    const order = await page.evaluate(() => {
      const panel = document.querySelector('.sae-hiring-summary'), workers = document.getElementById('sae-candidate-selection');
      return panel.nextElementSibling === workers;
    });
    assert.equal(order, true);
    const result = page.locator('#sae-candidate-selection select').nth(5);
    await result.selectOption('2001');
    await page.waitForFunction(() => document.querySelector('[data-period="1ª Quincena"] .sae-hiring-balance strong').textContent === '0');
    assert.deepEqual(await values(first), ['6', '6', '0']);
    await page.reload();
    await panel.waitFor();
    await page.locator('#sae-candidate-selection select').nth(11).waitFor();
    assert.deepEqual(await values(first), ['6', '6', '0']);
    await page.getByRole('button', { name: /Segunda quincena.pdf/ }).click();
    assert.deepEqual(await values(first), ['6', '6', '0']);
    await page.locator('#sae-candidate-selection select').first().selectOption('2001');
    await page.waitForFunction(() => document.querySelector('[data-period="2ª Quincena"] .sae-hiring-balance strong').textContent === '5');
    assert.deepEqual(await values(second), ['6', '1', '5']);
    fail = true;
    await page.locator('#sae-candidate-selection select').nth(1).selectOption('2001');
    await page.getByText('Fallo de guardado de prueba', { exact: true }).waitFor();
    assert.deepEqual(await values(second), ['6', '1', '5']);
    fail = false;
    await page.getByRole('button', { name: /Oficiales.pdf/ }).click();
    await page.locator('#sae-candidate-selection select').first().selectOption('2001');
    await page.waitForFunction(() => document.querySelector('[data-period="Mensual"] .sae-hiring-balance strong').textContent === '0');
    assert.deepEqual(await values(monthly), ['1', '1', '0']);
    await page.getByRole('button', { name: /Primera quincena.pdf/ }).click();
    await page.locator('#sae-candidate-selection select').nth(6).selectOption('2001');
    await page.waitForFunction(()=>Boolean(window.pendingConfirmation));
    assert.match(await page.evaluate(()=>window.pendingConfirmation.message), /previstas 6, seleccionadas 7/);
    assert.equal(candidates.find(c=>c.id==='report-0-6').resultCode,'','confirmation precedes write');
    await page.getByRole('dialog').getByRole('button',{name:'Cancelar',exact:true}).click();
    await page.evaluate(()=>{window.pendingConfirmation=null;});
    await page.locator('#sae-candidate-selection select').nth(6).selectOption('2001');
    await page.waitForFunction(()=>Boolean(window.pendingConfirmation));
    await page.getByRole('dialog').getByRole('button',{name:'Continuar de todas formas',exact:true}).click();
    await page.evaluate(()=>{window.pendingConfirmation=null;});
    await page.waitForFunction(() => document.querySelector('[data-period="1ª Quincena"] .sae-hiring-balance strong').textContent === '+1');
    assert.deepEqual(await values(first), ['6', '7', '+1']);
    assert(await page.getByRole('alert').filter({hasText:'Previsión superada'}).isVisible());
    assert(await page.getByText(/Previsión superada · \+1 en este grupo/).count()>0);
    await page.locator('#sae-candidate-selection select').nth(6).selectOption('2212');
    await page.waitForFunction(() => document.querySelector('[data-period="1ª Quincena"] .sae-hiring-balance strong').textContent === '0');
    await panel.getByText('Detalle del informe y del recuento', { exact: true }).click();
    assert.match(await panel.textContent(), /Este informe aporta 6 contratados de 12 candidatos/);
    await panel.getByText('Detalle del informe y del recuento', { exact: true }).click();
    await page.locator('#sae-candidate-selection select').last().scrollIntoViewIfNeeded();
    const geometry = await panel.boundingBox();
    assert.ok(Math.abs(geometry.y - 48) < 2, `Sticky top ${geometry.y} at ${width}`);
    assert.ok(geometry.height < 400);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Overflow at ${width}`);
    // The panel must also adapt when a sticky app header changes height.
    await page.locator('.app-navigation-panel').evaluate(el => { el.style.height = '72px'; });
    await page.waitForFunction(() => document.querySelector('.sae-hiring-summary').getBoundingClientRect().top >= 71);
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    assert.equal(await panel.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(15, 23, 42)');
    if (process.env.SAE_SUMMARY_SCREENSHOTS) {
      await fs.mkdir(process.env.SAE_SUMMARY_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: `${process.env.SAE_SUMMARY_SCREENSHOTS}/${engine}-${width}.png` });
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`SAE hiring summary ${engine}: 390/820/1440 px, actual Section integration, code updates, reload, failure rollback, shared report targets, monthly officers, excess, sticky header resize and dark mode passed (synthetic service).`);
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); }
