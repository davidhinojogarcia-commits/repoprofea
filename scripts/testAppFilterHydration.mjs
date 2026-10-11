import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

// Run the production filter hooks and settings loader effect, with only the
// remote settings response controlled. No copied implementation of validation.
const app = await fs.readFile(new URL('../App.tsx', import.meta.url), 'utf8');
function extract(start, end) {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing App hook boundary: ${start}`);
  return app.slice(from, to);
}
const state = extract('  const [selectedObraFilter,', '  const [deletedPeople,');
// Locate this effect by its setters so the same test also runs against main
// before the fix (which does not contain the new explanatory comment).
const normalizationAt = app.indexOf('    const normalizedObras = new Set((savedObras');
assert.ok(normalizationAt >= 0);
const validationStart = app.lastIndexOf('  useEffect(() => {', normalizationAt);
const loadingStart = app.indexOf('  useEffect(() => {\n    let cancelled = false;\n    loadAppBusinessSettings()');
assert.ok(loadingStart >= 0 && loadingStart < validationStart);
const loading = app.slice(loadingStart, validationStart);
const validationEnd = app.indexOf('  }, [savedObras]);', normalizationAt) + '  }, [savedObras]);'.length;
const validation = app.slice(validationStart, validationEnd);
const storage = extract("  useEffect(() => {\n    localStorage.setItem('selectedObraFilter'", '  useEffect(() => {\n    if (toast)');
const source = `import React, {useState, useRef, useEffect} from 'react';
const loadAppBusinessSettings = () => globalThis.__filterLoad();
const clearLegacyBusinessSettings = () => {};
export function Harness() {
${state}
const [savedObras, setSavedObras] = useState([]);
const [statsObraFilter, setStatsObraFilter] = useState(['Todas']);
const businessSettingsHydratedRef = useRef(false);
const setSavedLugares = () => {}, setSavedSitios = () => {}, setSavedTelefonos = () => {}, setSavedCategorias = () => {}, setWorkStartHour = () => {}, setWorkEndHour = () => {}, setToast = () => {};
${loading}
${validation}
${storage}
return React.createElement('output', null, JSON.stringify({obra:selectedObraFilter, periodo:selectedQuincenaFilter}));
}`;
const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost', pretendToBeVisual:true});
for (const key of ['window','document','localStorage','HTMLElement']) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = new URL('./.app-filter-test.mjs', import.meta.url);
const {createRoot} = await import('react-dom/client');
let root, resolveSettings, rejectSettings;
const current = () => JSON.parse(document.querySelector('output').textContent);
const persisted = key => JSON.parse(localStorage.getItem(key));
async function mount() {
  globalThis.__filterLoad = () => new Promise((resolve, reject) => {resolveSettings=resolve; rejectSettings=reject;});
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Harness)));
}
async function load(obras) {
  await act(async () => {resolveSettings({savedObras:obras, savedLugares:[], savedSitios:[], savedTelefonos:[], savedCategorias:[], workStartHour:'08:00', workEndHour:'15:00'});});
}
async function unmount() {await act(async () => root.unmount()); root=null;}
let Harness;
try {
  // esbuild stdin transpiles the exact TS hook blocks recovered above.
  await build({stdin:{contents:source, loader:'tsx', resolveDir:new URL('../', import.meta.url).pathname}, bundle:true, platform:'node', format:'esm', packages:'external', outfile:output.pathname});
  ({Harness} = await import(output.href));
  localStorage.setItem('selectedObraFilter', JSON.stringify(['11129 GR']));
  localStorage.setItem('selectedQuincenaFilter', JSON.stringify(['2ª Septiembre 2026']));
  await mount();
  assert.deepEqual(current(), {obra:['11129 GR'], periodo:['2ª Septiembre 2026']});
  assert.deepEqual(persisted('selectedObraFilter'), ['11129 GR'], 'Pending settings must not overwrite the stored work');
  await load(['11129 GR', '11002 GR']);
  assert.deepEqual(current().obra, ['11129 GR']);
  await unmount();
  await mount();
  assert.deepEqual(current(), {obra:['11129 GR'], periodo:['2ª Septiembre 2026']});
  await load(['11129 GR']);
  assert.deepEqual(persisted('selectedObraFilter'), ['11129 GR']);
  assert.deepEqual(persisted('selectedQuincenaFilter'), ['2ª Septiembre 2026']);
  await unmount();
  console.log('PASS Filters: delayed settings and remount preserve work and period.');

  localStorage.setItem('selectedObraFilter', JSON.stringify(['11129 GR', 'REMOVED']));
  await mount(); await load(['11129 GR']);
  assert.deepEqual(current().obra, ['11129 GR']);
  await unmount();
  localStorage.setItem('selectedObraFilter', JSON.stringify(['REMOVED']));
  await mount(); await load(['11129 GR']);
  assert.deepEqual(current().obra, ['Todas']);
  assert.deepEqual(persisted('selectedObraFilter'), ['Todas']);
  await unmount();
  console.log('PASS Filters: authoritative settings still remove obsolete works.');

  localStorage.setItem('selectedObraFilter', JSON.stringify(['11129 GR']));
  await mount(); await load([]);
  assert.deepEqual(current().obra, ['Todas']);
  await unmount();
  localStorage.setItem('selectedObraFilter', JSON.stringify(['11129 GR']));
  await mount();
  const originalError = console.error;
  try {console.error=()=>{}; await act(async () => rejectSettings(new Error('Settings unavailable')));}
  finally {console.error=originalError;}
  assert.deepEqual(current().obra, ['11129 GR']);
  assert.deepEqual(persisted('selectedObraFilter'), ['11129 GR']);
  assert.deepEqual(current().periodo, ['2ª Septiembre 2026']);
  console.log('PASS Filters: loaded empty list is authoritative; failed load preserves stored context.');
} finally {
  if(root) await unmount();
  await fs.unlink(output.pathname).catch(()=>{});
  delete globalThis.__filterLoad;
  dom.window.close();
}
