import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

// Exercise the real registration + pairing UI. Only remote transport/camera
// are fixtures; physical devices and Supabase Realtime are separate checks.
const root = new URL('../', import.meta.url).pathname;
const code = `import React,{useState}from 'react';import{createRoot}from'react-dom/client';import{RegistrationForm}from './components/RegistrationForm';
window.accountId='supervisor-a';window.registered=[];
const base={supervisorResponsable:'Anterior',numOferta:'OFERTA ANTERIOR',obra:'Obra antigua',categoria:'Oficial de 1ª',quincena:'1ª Enero 2025',periodoInicio:'2025-01-01',periodoFin:'2025-01-15',formacion:'Sí',lugarFormacion:'Centro antiguo',documentacionCompleta:'Sí',necesitaReconocimiento:'No',citaDia:'2025-01-01',citaHora:'09:00',sitioReconocimiento:'Centro antiguo',fechaRegistro:'2025-01-01',observaciones:'Datos del contrato anterior'};
const workers=[{...base,id:42,ownerId:'another-supervisor',apellidosNombre:'Ficha ajena con el mismo ID',dni:'12345678Z',telefono:'600999999'}, {...base,id:42,ownerId:'supervisor-a',apellidosNombre:'Persona Uno',dni:'12345678Z',fechaNacimiento:'1980-01-02',telefono:'600111222',numeroSeguridadSocial:'281234567840',iban:'ES9121000418450200051332',calzado:'42'}, {...base,id:43,ownerId:'supervisor-a',apellidosNombre:'Persona Dos',dni:'87654321X',fechaNacimiento:'',telefono:'',numeroSeguridadSocial:'',iban:'',calzado:''}];
function App(){const[people,setPeople]=useState(workers);const[tick,setTick]=useState(0);window.updateDirectory=setPeople;window.switchAccount=()=>{window.accountId='supervisor-b';setTick(n=>n+1)};return <RegistrationForm onRegister={p=>window.registered.push(p)} savedObras={['Obra nueva']} savedLugares={[]} savedSitios={['Centro nuevo']} savedTelefonos={[]} savedCategorias={[]} people={people}/>;}createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = (await build({
  stdin: { contents: code, loader: 'tsx', resolveDir: root },
  bundle: true, format: 'esm', platform: 'browser', write: false,
  plugins: [{ name: 'fixtures', setup(b) {
    for (const [filter, path] of [[/AuthGate$/, 'auth'], [/annualHiringPeriodsService$/, 'periods'], [/workerCardPairing$/, 'pair'], [/WorkerCardScanner$/, 'scanner']])
      b.onResolve({ filter }, () => ({ path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'tsx', resolveDir: root, contents: {
      auth: "export function useAuthShell(){return {supervisorName:'Supervisor actual',user:{id:window.accountId}}}",
      periods: 'export async function listAnnualHiringPeriods(){return []}',
      pair: `export async function createCardPairing(){window.created=(window.created||0)+1;return{id:'test-session',expiresAt:new Date(Date.now()+300000).toISOString(),url:location.origin+'/#card-pair=fixture'}};export function watchCardPairing(id,cb,status){window.emitWorker=cb;queueMicrotask(()=>status('SUBSCRIBED'));return {ready:Promise.resolve(),unsubscribe(){window.unsubscribed=(window.unsubscribed||0)+1}}};export async function closeCardPairing(){window.testPairClosed=(window.testPairClosed||0)+1}`,
      scanner: `import React from 'react';export default function Scanner({onFound,onClose}){return <section aria-label="Cámara de prueba"><button type="button" onClick={()=>{if(onFound(42))onClose()}}>Simular lectura directa</button><button type="button" onClick={onClose}>Cerrar cámara de prueba</button></section>}`,
    }[path] }));
  } }],
})).outputFiles[0].text;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/app.js' ? bundle : '<meta name="viewport" content="width=device-width"><div id="root"></div><script type="module" src="/app.js"></script>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
try {
  const engine = process.env.BROWSER_ENGINE === 'webkit' ? webkit : chromium;
  browser = await engine.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const field = name => page.locator(`[name="${name}"]`);
  const startPairing = async () => {
    await page.getByRole('button', { name: 'Vincular cámara del móvil', exact: true }).click();
    await page.getByRole('button', { name: 'Crear vinculación', exact: true }).click();
    await page.getByAltText('QR temporal para vincular el móvil').waitFor();
  };
  const deliver = async id => {
    await page.evaluate(id => window.emitWorker(id, Date.now()), id);
  };
  const confirm = async () => {
    await page.getByRole('button', { name: 'Confirmar ficha y rellenar datos', exact: true }).click();
    await page.getByText('¡Contratación Anterior Detectada!', { exact: true }).waitFor();
    await page.getByRole('button', { name: /Continuar/ }).click();
  };
  await field('numOferta').fill('OFERTA NUEVA');
  await field('obra').fill('Obra nueva');
  await page.getByRole('button', { name: 'Otro', exact: true }).click();
  await field('categoria').fill('Categoría nueva');
  await field('periodoInicio').fill('2027-02-01');
  await field('periodoFin').fill('2027-02-15');
  const period = await field('quincena').count() ? await field('quincena').inputValue() : null;
  await startPairing();
  // Missing/unavailable references cannot populate the form.
  await deliver(999);
  assert.equal(await field('dni').inputValue(), '');
  assert.equal(await page.getByRole('button', { name: 'Confirmar ficha y rellenar datos' }).count(), 0);
  await deliver(42);
  await page.getByRole('region', { name: 'Confirmar ficha del carnet' }).waitFor();
  assert.equal(await field('dni').inputValue(), '', 'preview never fills without confirmation');
  await page.waitForFunction(() => window.testPairClosed === 1 && window.unsubscribed === 1);
  // Cancel leaves all manually entered new-contract details intact.
  await page.getByRole('button', { name: 'Cancelar recuperación' }).click();
  assert.equal(await field('numOferta').inputValue(), 'OFERTA NUEVA');
  assert.equal(await field('dni').inputValue(), '');
  // Direct scan reaches exactly the same confirmation and registration flow.
  await page.getByRole('button', { name: 'Leer QR con este dispositivo' }).click();
  await page.getByRole('button', { name: 'Simular lectura directa' }).click();
  await confirm();
  for (const [name, value] of Object.entries({ apellidosNombre: 'Persona Uno', dni: '12345678Z', fechaNacimiento: '1980-01-02', telefono: '600111222', numeroSeguridadSocial: '281234567840', iban: 'ES9121000418450200051332', calzado: '42' })) {
    assert.equal((await field(name).inputValue()).replace(/\s/g, ''), value.replace(/\s/g, ''), name);
  }
  for (const [name, value] of Object.entries({ supervisorResponsable: 'Supervisor actual', numOferta: 'OFERTA NUEVA', obra: 'Obra nueva', categoria: 'Categoría nueva', periodoInicio: '2027-02-01', periodoFin: '2027-02-15' }))
    assert.equal(await field(name).inputValue(), value, name + ' preserves new-contract choice');
  if (period) assert.equal(await field('quincena').inputValue(), period);
  for (const name of ['formacion', 'necesitaReconocimiento', 'documentacionCompleta'])
    assert.equal(await field(name).inputValue(), '', name + ' requires explicit review');
  assert.equal(await page.evaluate(() => window.registered.length), 0, 'scan/confirmation never registers automatically');
  await field('formacion').selectOption('Sí');
  await field('necesitaReconocimiento').selectOption('Sí');
  await field('citaDia').fill('2027-01-25');
  await field('citaHora').fill('10:00');
  await field('sitioReconocimiento').fill('Centro nuevo');
  await field('documentacionCompleta').selectOption('Sí');
  await field('observaciones').fill('Observaciones de Persona Uno');
  await startPairing();
  await deliver(43);
  await confirm();
  for (const name of ['fechaNacimiento', 'telefono', 'numeroSeguridadSocial', 'iban', 'calzado', 'observaciones'])
    assert.equal(await field(name).inputValue(), '', name + ' must not leak from the previous worker');
  assert.equal(await field('dni').inputValue(), '87654321X');
  await field('necesitaReconocimiento').selectOption('Sí');
  for (const name of ['citaDia', 'citaHora']) assert.equal(await field(name).inputValue(), '', name + ' reset');
  assert.equal(await field('sitioReconocimiento').inputValue(), '', 'old appointment location cleared');
  // Removing access before confirmation invalidates the pending identity.
  await startPairing();
  await deliver(42);
  await page.evaluate(() => window.updateDirectory([]));
  await page.getByRole('alert').filter({ hasText: 'La ficha ya no está disponible' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Confirmar ficha y rellenar datos' }).count(), 0);
  await page.getByRole('button', { name: 'Cancelar recuperación' }).click();
  // Closing or switching account releases the pairing and hides the preview.
  await startPairing();
  await page.getByRole('button', { name: 'Cerrar y desvincular' }).click();
  const before = await page.evaluate(() => window.testPairClosed);
  await startPairing();
  await page.evaluate(() => window.switchAccount());
  await page.waitForFunction(before => window.testPairClosed === before + 1, before);
  assert.equal(await page.getByAltText('QR temporal para vincular el móvil').count(), 0);
  // Final creation is a separate explicit action and contains no old ID or
  // medical assessment. This fixture callback does not write production data.
  await page.reload();
  await field('numOferta').fill('OFERTA FINAL');
  await field('obra').fill('Obra nueva');
  await field('periodoInicio').fill('2027-02-01');
  await field('periodoFin').fill('2027-02-15');
  await page.getByRole('button', { name: 'Leer QR con este dispositivo' }).click();
  await page.getByRole('button', { name: 'Simular lectura directa' }).click();
  await confirm();
  await field('formacion').selectOption('Sí');
  await field('necesitaReconocimiento').selectOption('No');
  await field('documentacionCompleta').selectOption('Sí');
  assert.equal(await page.evaluate(() => window.registered.length), 0);
  await page.getByRole('button', { name: 'Registrar Persona' }).click();
  await page.waitForFunction(() => window.registered.length === 1);
  const saved = await page.evaluate(() => window.registered[0]);
  assert.equal(saved.apellidosNombre, 'Persona Uno');
  assert.equal(saved.obra, 'Obra nueva');
  assert.equal(saved.numOferta, 'OFERTA FINAL');
  assert.equal(saved.periodoInicio, '2027-02-01');
  assert.equal(saved.supervisorResponsable, 'Supervisor actual');
  assert.equal(saved.id, undefined);
  assert.equal(saved.aptitudMedica, undefined);
  assert.equal(saved.citaDia, '');
  assert.deepEqual(errors, []);
  console.log('PASS registration QR (' + (process.env.BROWSER_ENGINE || 'chromium') + '): remote/direct preview, confirmation/cancel, personal autofill, new contract preserved, preventive review, missing fields cleared, unavailable references, account isolation and pairing cleanup.');
} finally {
  await browser?.close();
  await new Promise(r => server.close(r));
}
