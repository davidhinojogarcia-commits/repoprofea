import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';

const output = new URL('./.sae-alignment-test.mjs', import.meta.url);
let rows, calls, offline = false, skipWrite = false;
const reset = () => {
  rows = [
    {id:'a',owner_id:'owner',need_id:'need',source_report_id:'report',source_position:{x:182,y:50,orderNumber:1,evidence:'keep'},alignment_offset_x:'0.00',alignment_offset_y:'0.00'},
    {id:'b',owner_id:'owner',need_id:'need',source_report_id:'report',source_position:{x:182,y:65,orderNumber:2},alignment_offset_x:'0.00',alignment_offset_y:'0.00'},
    {id:'other',owner_id:'owner',need_id:'need',source_report_id:'unrelated',source_position:{x:10,y:20,orderNumber:1},alignment_offset_x:'0.00',alignment_offset_y:'0.00'},
  ];
  calls = []; offline = false; skipWrite = false;
};
const api = {async query(table, options) {
  assert.equal(table, 'sae_candidates');
  assert.equal(options.networkOnly, true, 'saving/reopening must require live data');
  calls.push(structuredClone(options));
  if (offline) throw new Error('Sin conexión');
  const params = new URLSearchParams(options.query);
  const selected = rows.filter(r => [...params].every(([key,value]) => !value.startsWith('eq.') || String(r[key]) === value.slice(3)));
  if (options.method === 'PATCH' && !skipWrite) selected.forEach(r => Object.assign(r, options.body));
  return structuredClone(selected);
}};
globalThis.__saeAlignmentApi = api;
try {
  await build({entryPoints:[new URL('../src/services/saeService.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',outfile:output.pathname,
    plugins:[{name:'db-boundary',setup(b){b.onResolve({filter:/\/lib\/supabase$/},()=>({path:'db',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase=globalThis.__saeAlignmentApi; export const getSessionUser=()=>({id:"owner"});'}));}}]});
  const {saveSaeReportAlignment,listSaeCandidates,positionSaePreviewCandidates} = await import(output.href);
  reset(); const baseline = structuredClone(rows);
  let saved = await saveSaeReportAlignment('report', 3.5, -2);
  assert.deepEqual(saved.map(r=>[r.overlayX,r.overlayY]), [[185.5,48],[185.5,63]]);
  assert.equal(calls.filter(c=>c.method==='PATCH').length,1,'whole report saves in one transaction');
  assert.deepEqual(rows[0].source_position,baseline[0].source_position,'source coordinates/evidence preserved');
  assert.deepEqual(rows[2],baseline[2],'unrelated report unchanged');
  const reopened = await listSaeCandidates(undefined,{reportId:'report',networkOnly:true});
  assert.equal(reopened[0].alignmentOffsetX,3.5); assert.equal(reopened[0].alignmentOffsetY,-2);
  assert.deepEqual(positionSaePreviewCandidates(reopened,3.5,-2),reopened,'preview of saved offsets must not apply them twice');
  await saveSaeReportAlignment('report',3.5,-2);
  assert.equal(rows[0].alignment_offset_x,3.5,'repeated save is idempotent');
  saved = await saveSaeReportAlignment('report',-1,4);
  assert.deepEqual(saved.map(r=>[r.overlayX,r.overlayY]),[[181,54],[181,69]],'new position replaces old adjustment');
  assert.deepEqual(positionSaePreviewCandidates(reopened,-1,4).map(r=>[r.overlayX,r.overlayY]),[[181,54],[181,69]],'preview and saved PDF use same coordinates');
  await saveSaeReportAlignment('report',0,0);
  assert.equal(rows[0].source_position.x,182);
  reset(); skipWrite=true;
  await assert.rejects(saveSaeReportAlignment('report',3.5,-2),/verificar/,'silent/RLS no-op cannot report success');
  reset(); offline=true;
  await assert.rejects(saveSaeReportAlignment('report',1,2),/conexión/);
  assert.equal(calls.filter(c=>c.method==='PATCH').length,0);
  reset(); await assert.rejects(saveSaeReportAlignment('report',NaN,2),/válidos/);
  assert.equal(calls.length,0);
  console.log('SAE alignment persistence: reopen, repeat, replace, PDF preview, isolation and network/RLS failures passed.');
} finally { await fs.rm(output,{force:true}); delete globalThis.__saeAlignmentApi; }
