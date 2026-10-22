import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = new URL('./.integrated-calendar-dates.mjs', import.meta.url);
if (!process.argv.includes('--child')) {
  try {
    await build({
      stdin: { contents: "export {CalendarioIntegrado,toLocalCalendarDate} from './components/CalendarioIntegrado';", resolveDir: new URL('../', import.meta.url).pathname },
      bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle.pathname,
      plugins: [{ name: 'calendar-boundaries', setup(b) {
        b.onResolve({ filter: /ModalPortal$|exportUtils$|GoogleCalendarModal$|pushNotifications$/ }, args => ({ path: args.path, namespace: 'boundary' }));
        b.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({ contents:
          path.endsWith('ModalPortal') ? "export default function ModalPortal({children}){return children;}" :
          path.endsWith('exportUtils') ? "export const formatDate=value=>value;" :
          path.endsWith('GoogleCalendarModal') ? "export function GoogleCalendarModal(){return null;}" :
          "export const requestNotificationPermission=async()=> 'default';export const sendLocalSWNotification=async()=>false;export const checkAndTriggerUpcomingAlerts=()=>{};"
        }));
      } }],
    });
    for (const zone of ['Europe/Madrid', 'Atlantic/Canary', 'UTC', 'America/New_York', 'Pacific/Auckland']) {
      const result = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--child'], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
      assert.equal(result.status, 0, `${zone}\n${result.stdout}\n${result.stderr}`);
      process.stdout.write(result.stdout);
    }
  } finally { await fs.unlink(bundle).catch(() => undefined); }
} else {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://calendar.test' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  const RealDate = globalThis.Date;
  const fixedNow = new RealDate(2026, 9, 1, 0, 30).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixedNow])); }
    static now() { return fixedNow; }
  };
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { CalendarioIntegrado, toLocalCalendarDate } = await import(bundle.href);
  // Every civil day, including leap day, year/month boundaries and both DST changes.
  for (const year of [2024, 2026]) for (let month = 0; month < 12; month++) {
    const last = new RealDate(year, month + 1, 0).getDate();
    for (let day = 1; day <= last; day++) for (const hour of [0, 12, 23]) {
      assert.equal(toLocalCalendarDate(new RealDate(year, month, day, hour)), `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
  }
  const people = [
    { id: 1, apellidosNombre: 'PRUEBA UNO', dni: 'TEST1', obra: 'Obra A', periodoInicio: '2026-10-01', periodoFin: '2026-10-02', citaDia: '30/09/2026', citaHora: '08:30' },
    { id: 2, apellidosNombre: 'PRUEBA DOS', dni: 'TEST2', obra: 'Obra A', periodoInicio: '2026-10-31', periodoFin: '2026-11-01', citaDia: '01/10/2026', citaHora: '10:00' },
  ];
  const root = createRoot(document.getElementById('root'));
  const click = async element => React.act(async () => { assert(element, 'control exists'); element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
  try {
    await React.act(async () => { root.render(React.createElement(CalendarioIntegrado, { people, savedObras: ['Obra A'], onToast() {} })); });
    const monthCell = title => document.querySelector(`[title="${title}"]`)?.closest('div.group');
    for (const [title, day, detail] of [
      ['Inicio Contrato: PRUEBA UNO - Obra: Obra A', '1', '01/10/2026'],
      ['Fin Contrato: PRUEBA UNO', '2', '02/10/2026'],
      ['Inicio Contrato: PRUEBA DOS - Obra: Obra A', '31', '31/10/2026'],
      ['Fin Contrato: PRUEBA DOS', '1', '01/11/2026'],
      ['Reconocimiento Médico: PRUEBA UNO (08:30) - ', '30', '30/09/2026'],
      ['Reconocimiento Médico: PRUEBA DOS (10:00) - ', '1', '01/10/2026'],
    ]) {
      const cell = monthCell(title);
      assert(cell, title);
      assert.equal(cell.querySelector('span').textContent.trim(), day, `${title} is on the printed day`);
      await click(cell);
      assert(document.body.textContent.includes(`Detalle de Eventos (${detail})`));
      await click(button('Cerrar'));
    }
    assert([...document.querySelectorAll('div.group')].find(cell => cell.querySelector('span')?.className.includes('scale-105'))?.querySelector('span').textContent.trim() === '1', 'today uses the local day at 00:30');
    await click(button('Semana'));
    const week = [...document.querySelectorAll('div')].find(el => el.className.includes('md:grid-cols-7'));
    assert(week);
    const first = [...week.children].find(el => el.firstElementChild?.textContent.includes('1'));
    assert(first?.textContent.includes('PRUEBA DOS') && first.textContent.includes('PRUEBA UNO'), 'weekly appointments and starts stay on October 1');
    await click(first);
    assert(document.body.textContent.includes('Detalle de Eventos (01/10/2026)'));
    await click(button('Cerrar'));
    await click(button('Agenda'));
    const agenda = [...document.querySelectorAll('div')].find(el => el.className.includes('max-h-[600px]'));
    assert([...agenda.children].find(el => el.textContent.includes('01/10/2026'))?.textContent.includes('PRUEBA DOS'));
    assert([...agenda.children].find(el => el.textContent.includes('30/09/2026'))?.textContent.includes('PRUEBA UNO'));
    console.log(`PASS ${process.env.TZ}: civil dates, leap year/DST, month cells, selected-day details, local today, week and agenda`);
  } finally { await React.act(async () => root.unmount()); globalThis.Date = RealDate; dom.window.close(); }
}
