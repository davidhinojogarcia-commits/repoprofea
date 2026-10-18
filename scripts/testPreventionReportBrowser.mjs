import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { PDFDocument, PDFName } from 'pdf-lib';

const bundle = await build({ stdin: { contents: `
  import {supabase} from './src/lib/supabase';
  import {loadPreventionActPhotos} from './src/services/preventionService';
  import {createPreventionCommunicationActPdf} from './src/services/preventionActPdf';
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {PreventionSection} from './components/PreventionSection';
  window.reportTest={supabase,loadPreventionActPhotos,createPreventionCommunicationActPdf,
    mount:()=>createRoot(document.getElementById('root')).render(React.createElement(PreventionSection,{savedObras:['Obra A'],token:'portal-test'}))};
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', define: { 'import.meta.env': '{}' } });
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'application/javascript' : 'text/html');
  res.end(req.url === '/app.js' ? bundle.outputFiles[0].contents : '<!doctype html><div id="root"></div><script src="/app.js"></script>');
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const {supabase, loadPreventionActPhotos, createPreventionCommunicationActPdf: pdf} = window.reportTest;
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const image = (width, height, color) => {
      const c = document.createElement('canvas'); c.width = width; c.height = height;
      const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'white'; ctx.font = '24px sans-serif'; ctx.fillText(`${width} x ${height}`, 20, 45);
      return c.toDataURL('image/jpeg', .8);
    };
    const photos = {a: image(800, 400, '#164B9B'), b: image(400, 800, '#168A45')};
    const base = {obra:'Obra A', kind:'incident', work_date:'2026-10-18', category:'Otros', severity:'high', task:'Inspección', description:'Comprobar protección.', responsible:'Responsable', status:'pending', actor:'Supervisor', updated_at:'2026-10-18T09:00:00Z', checks:{}};
    const records = [{...base,id:'a',title:'Fotografía horizontal',has_photo:true}, {...base,id:'b',title:'Fotografía vertical',has_photo:true, description:'Texto de seguimiento extenso. '.repeat(900)}, {...base,id:'c',title:'Sin fotografía',has_photo:false}];
    const calls = []; let active = 0; let maxActive = 0;
    supabase.rpc = async (name, args) => {
      check(name === 'get_prevention_record_details', 'only authorized existing details RPC');
      check(args.p_token === 'portal-test', 'portal access token forwarded');
      calls.push(args.p_id); active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return {photo:photos[args.p_id],events:[]};
    };
    const loaded = await loadPreventionActPhotos(records, 'portal-test');
    check(calls.join(',') === 'a,b' && maxActive <= 3, 'only selected photos fetched, bounded concurrency');
    check(!records[0].photo && loaded[0].photo === photos.a && loaded[1].photo === photos.b, 'correct association without mutating list');
    await loadPreventionActPhotos(loaded, 'portal-test'); check(calls.length === 2, 'available photos not fetched twice');
    await loadPreventionActPhotos([], 'portal-test'); check(calls.length === 2, 'empty selection makes no calls');
    let rejected = false;
    try {await loadPreventionActPhotos(Array(201).fill(records[0]));} catch {rejected = true;}
    check(rejected && calls.length === 2, 'report limit checked before requests');
    supabase.rpc = async () => {throw new Error('Registro no disponible');};
    rejected = false; try {await loadPreventionActPhotos([records[0]]);} catch {rejected = true;}
    check(rejected, 'permission/network errors stop incomplete export');
    supabase.rpc = async () => ({photo:null,events:[]});
    rejected = false; try {await loadPreventionActPhotos([records[0]]);} catch {rejected = true;}
    check(rejected, 'missing stored photo is not silently omitted');
    for (const record of [records[0], {...records[0],photo:'data:image/png;base64,YWJj'}, {...records[0],photo:'https://private.invalid/photo'}]) {
      rejected = false; try {await pdf([record], [], {});} catch {rejected = true;}
      check(rejected, 'missing, corrupt or external photo rejected');
    }
    const report = await pdf(loaded, [], {obra:'Obra A'}, {supervisorName:'Supervisor de pruebas'});
    const noPhoto = await pdf([records[2]], [], {});
    window.reportCalls = [];
    supabase.rpc = async (name, args) => {
      check(args.p_token === 'portal-test', 'actual UI forwards work access');
      window.reportCalls.push(name);
      if(name === 'list_prevention_records') return {records:[records[0]],truncated:false};
      if(name === 'get_prevention_acta_history') return [];
      if(name === 'get_prevention_record_details') return {photo:photos.a,events:[]};
      throw new Error('Unexpected operation');
    };
    window.reportTest.mount();
    const encode = async blob => btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
    return {pdf:await encode(report.blob), noPhoto:await encode(noPhoto.blob), calls:calls.length, maxActive};
  });
  const bytes = Buffer.from(result.pdf, 'base64');
  const document = await PDFDocument.load(bytes);
  const images = new Set();
  for (const page of document.getPages()) {
    const objects = page.node.Resources()?.lookup(PDFName.of('XObject'));
    for (const [, ref] of objects?.entries() || []) {
      const object = document.context.lookup(ref);
      if (object.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image') images.add(ref.toString());
    }
  }
  assert.equal(images.size, 2, 'two distinct photographs embedded in actual PDF');
  assert(document.getPageCount() > 3, 'long text paginated before portrait photograph');
  await PDFDocument.load(Buffer.from(result.noPhoto, 'base64'));
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', {name:'Compartir PDF', exact:true}).click();
  const download = await downloadEvent;
  const downloaded = await PDFDocument.load(await fs.readFile(await download.path()));
  assert(downloaded.getPages().some(page => page.node.Resources()?.lookup(PDFName.of('XObject'))?.entries().length), 'actual export button includes image');
  assert.deepEqual(await page.evaluate(() => window.reportCalls), ['list_prevention_records','get_prevention_acta_history','get_prevention_record_details'], 'one list, one history, one photo; no polling');
  await fs.mkdir('tmp/pdfs', { recursive: true });
  await fs.writeFile('tmp/pdfs/prevention-report-photos.pdf', bytes);
  console.log(`PASS: report photo loading, association, limits, no redundant reads, failures, actual PDF with ${images.size} images / ${document.getPageCount()} pages; no-photo report valid; mobile export button downloads PDF with photograph.`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
