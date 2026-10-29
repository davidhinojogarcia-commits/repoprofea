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
const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const config = html.match(/<script>\s*(tailwind.config[\s\S]*?)<\/script>/)[1];
const css = (await Promise.all(['index.css', 'public/directorio-toolbar.css', 'src/styles/design-system.css'].map(path => fs.readFile(new URL('../' + path, import.meta.url), 'utf8')))).join('\n');
const source = `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{PersonList}from'./components/PersonList';
const base={ownerId:'supervisor-a',supervisorResponsable:'Supervisor',numOferta:'OFERTA',obra:'Obra A',categoria:'Peón',quincena:'1ª Enero 2026',dni:'',fechaNacimiento:'',periodoInicio:'2026-01-01',periodoFin:'2026-01-15',telefono:'',calzado:'42',citaDia:'',citaHora:'',sitioReconocimiento:'',documentacionCompleta:'Sí',fechaRegistro:'2026-01-01',reconocimientoEstado:'Apto'};
const workers=[
 {...base,id:1,apellidosNombre:'Ana Formada',dni:'11111111A',formacion:'Sí'},
 {...base,id:2,apellidosNombre:'Bruno Pendiente',dni:'22222222B',formacion:'No'},
 {...base,id:3,apellidosNombre:'Carla Anterior',dni:'33333333C',formacion:'Sí',periodoInicio:'2025-12-20',periodoFin:'2026-01-05'},
 {...base,id:4,apellidosNombre:'Diego Sin Dato',dni:'44444444D',formacion:'',obra:'Obra B'},
 {...base,id:5,apellidosNombre:'Eva Texto Pendiente',dni:'55555555E',formacion:'Pendiente',reconocimientoEstado:'No Apto'},
 {...base,id:6,apellidosNombre:'Fran Legado',dni:'66666666F',formacion:' SI ',periodoInicio:'',quincena:'2ª Febrero 2024'},
 {...base,id:7,apellidosNombre:'Gema Registro',dni:'77777777G',formacion:'Sin formación',periodoInicio:'',quincena:'',fechaRegistro:'2023-03-01'},
 {...base,id:8,apellidosNombre:'Hugo Sin Año',dni:'88888888H',formacion:'Desconocido',periodoInicio:'',quincena:'',fechaRegistro:''},
];
window.exports=[];window.scanOpens=0;window.pairOpens=0;window.gapi={};window.google={accounts:{}};
function App(){const[people,setPeople]=useState(workers);const[search,setSearch]=useState('');const[obra,setObra]=useState(['Todas']);const[quincena,setQuincena]=useState(['Todas']);window.replacePeople=setPeople;return <PersonList accountId="supervisor-a" people={people} savedObras={['Obra A','Obra B']} searchTerm={search} setSearchTerm={setSearch} selectedObraFilter={obra} setSelectedObraFilter={setObra} selectedQuincenaFilter={quincena} setSelectedQuincenaFilter={setQuincena} onEdit={()=>{}} onDelete={()=>{}} onExport={()=>{}} onExportPDF={p=>window.exports.push(p.map(w=>w.id))} onExportRRMMExcel={()=>{}} onExportRRMMPDF={()=>{}} onExportPRLExcel={()=>{}} onExportPRLPDF={()=>{}} onExportCalzadoExcel={()=>{}} onExportCalzadoPDF={()=>{}} onEmail={()=>{}} onImport={()=>{}} onGenerateIDCard={()=>{}} onExportHistoryPDF={()=>{}}/>}
createRoot(document.getElementById('root')).render(<App/>);`;
const stubs = {
  PartsPanel: 'export default function PartsPanel(){return null}',
  ShareRecordButton: 'export const ShareRecordButton=()=>null',
  BulkShareButton: 'export const BulkShareButton=()=>null',
  GoogleCalendarModal: 'export const GoogleCalendarModal=()=>null',
  directoryCommunications: 'export const sendDirectoryCommunication=async()=>{}',
  workerImportService: 'export const moveWorkersToTrashBulk=async()=>{}',
  WorkerCardScanner: "export default function Scanner(){window.scanOpens++;return null}",
  WorkerCardPairing: "export default function Pairing(){window.pairOpens++;return null}",
};
const bundle = (await build({ stdin: { contents: source, loader: 'tsx', resolveDir: root }, bundle: true, format: 'esm', platform: 'browser', write: false,
  plugins: [{ name: 'external-boundaries', setup(b) {
    for (const name of Object.keys(stubs)) b.onResolve({ filter: new RegExp('/' + name + '$') }, () => ({ path: name, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: stubs[path], loader: 'tsx' }));
  } }],
})).outputFiles[0].text;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' || req.url === '/tailwind.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/app.js' ? bundle : req.url === '/tailwind.js' ? tailwind : `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><script>${config}</script><style>${css}body{margin:0}#root{max-width:1152px;margin:auto}</style><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const scope = async expected => {
    await page.waitForFunction(ids => JSON.stringify(window.__profeaDirectoryExportScope?.filteredIds) === JSON.stringify(ids), expected);
  };
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await scope([1, 2, 3, 4, 5, 6, 7, 8]);
    const year = page.getByLabel('Año de contratación', { exact: true });
    const training = page.getByLabel('Formación', { exact: true });
    await year.selectOption('2026');
    await training.selectOption('trained');
    await scope([1]);
    assert.equal(await page.getByText('Ana Formada', { exact: true }).count(), 1);
    for (const layout of ['table', 'compact', 'cards']) {
      await page.locator('#btn-view-' + layout).click();
      assert.equal(await page.getByRole('button', { name: 'Escanear carnet con este dispositivo', exact: true }).count(), 1);
      assert.equal(await page.getByRole('group', { name: 'Lectura de carnet' }).evaluate(el => !!el.nextElementSibling && el.compareDocumentPosition(el.nextElementSibling) === Node.DOCUMENT_POSITION_FOLLOWING), true);
      assert.equal(await page.getByText('Ana Formada', { exact: true }).count(), 1);
    }
    await page.locator('#btn-view-compact').click();
    // Selecting a former result must not leak into exports after a filter change.
    await page.locator('#selectAllVisible').check();
    await training.selectOption('pending');
    await scope([2, 4, 5]);
    await page.waitForFunction(() => window.__profeaDirectoryExportScope.hasSelection === false);
    await page.locator('[data-encargados-relation-row] button').first().click();
    assert.deepEqual(await page.evaluate(() => window.exports.at(-1)), [2, 4, 5]);
    const search = page.getByPlaceholder('Buscar por nombre, DNI, oferta, obra o categoría...');
    await search.fill('Bruno');await scope([2]);
    await search.fill('sin coincidencias');await scope([]);
    assert.equal(await page.getByRole('button', { name: 'Escanear carnet con este dispositivo', exact: true }).isVisible(), true);
    await search.fill('');await scope([2, 4, 5]);
    await year.selectOption('2025');await scope([]);
    await training.selectOption('trained');await scope([3]);
    await year.selectOption('2024');await scope([6]);
    await year.selectOption('2023');await training.selectOption('pending');await scope([7]);
    await year.selectOption('unknown');await scope([8]);
    await page.getByRole('button', { name: 'Limpiar filtros de formación', exact: true }).click();
    await scope([1, 2, 3, 4, 5, 6, 7, 8]);
    await year.selectOption('2026');await training.selectOption('pending');
    await page.getByRole('button', { name: 'Aptitud médica', exact: true }).click();
    await page.getByText('No aptos', { exact: true }).click();
    await scope([5]);
    await page.getByRole('button', { name: /No aptos \(/ }).click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, width + ' ' + theme + ' no page overflow');
      const selectBox = await training.boundingBox();assert.ok(selectBox.height >= 44);
    }
    await page.getByRole('button', { name: 'Escanear carnet con este dispositivo', exact: true }).click();
    await page.waitForFunction(() => window.scanOpens > 0);
    await page.getByRole('button', { name: 'Vincular cámara del móvil', exact: true }).click();
    await page.waitForFunction(() => window.pairOpens > 0);
    if (process.env.DIRECTORY_EVIDENCE_DIR) {
      await fs.mkdir(process.env.DIRECTORY_EVIDENCE_DIR, { recursive: true });
      await page.getByRole('button', { name: 'Escanear carnet con este dispositivo', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: process.env.DIRECTORY_EVIDENCE_DIR + '/directory-' + engine + '-' + width + '.png', fullPage: true });
    }
    await page.evaluate(() => window.replacePeople([]));
    await page.getByText('No hay personas registradas', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Escanear carnet con este dispositivo', exact: true }).isVisible(), true);
  }
  assert.deepEqual(errors, []);
  console.log('PASS ' + engine + ': directory year/training filters, legacy and unknown values, combined medical/search filters, selection/export scope, all layouts, scanner placement/callbacks and empty states; 390/820/1440 light/dark. Transport and camera mocked; no physical devices.');
} finally { await browser?.close();server.closeAllConnections();await new Promise(resolve => server.close(resolve)); }
