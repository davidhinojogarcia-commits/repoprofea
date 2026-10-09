import {build} from 'esbuild';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';

const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost'});
for (const key of ['window','document','HTMLElement','Event','CustomEvent']) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let user = {id:'owner-A', email:'owner@example.com'};
let calls = [];
let shares = [];
let settings = {
  pdfPreferences:{fontSize:12},
  subcontratasPreferences:{checklistTemplate:[], reporteTecnicoConfig:{title:'keep'}},
  subcontratas:{obrasRecursos:{worksite:{nombre:'keep'}}},
  annualHiringPeriods:[{id:'annual-2026',year:2026,months:[],importedAt:'2026-01-01'}],
};
const supabase = {
  auth:{getUser:async()=>{throw new Error('Unexpected remote identity request');}},
  query:async(table,options)=>{
    calls.push({table,...options});
    if (table === 'user_settings') {
      assert(options.query.includes(`user_id=eq.${user.id}`), 'settings remain scoped to the current user');
      const match = options.query.match(/select=(\w+):settings->(\w+)/);
      assert(match, 'settings load only the requested JSON branch');
      return [{[match[1]]:settings[match[2]] ?? null}];
    }
    if (table === 'trabajadores') return [{owner_id:'owner-A',obra_id:'worksite'}];
    return [];
  },
  rpc:async(name,body)=>{
    calls.push({rpc:name,body});
    if (name === 'list_shareable_profiles') return [{id:'recipient', email:'recipient@example.com', nombre:'Recipient'}];
    if (name === 'get_worker_shares') return shares;
    if (name === 'set_worker_share') {
      shares = [{id:'share',user_id:body.p_user_id,can_read:true,can_update:body.p_can_update,can_delete:false}];
    }
    if (name === 'remove_worker_share') shares = [];
    if (name === 'patch_user_settings') settings = {...settings,...body.p_patch};
  },
};
globalThis.__phase2 = {supabase,getSessionUser:async()=>user};
const output = new URL('./.consumption-phase2.mjs',import.meta.url);
const root = createRoot(document.getElementById('root'));
const plugin = {name:'client-transport',setup(builder){
  builder.onResolve({filter:/\/supabase$/},()=>({path:'supabase',namespace:'phase2'}));
  builder.onResolve({filter:/\/appToast$/},()=>({path:'toast',namespace:'phase2'}));
  builder.onLoad({filter:/.*/,namespace:'phase2'},args=>({contents:args.path==='supabase'
    ? 'export const {supabase,getSessionUser}=globalThis.__phase2;'
    : 'export const showAppToast=()=>{};'}));
}};
const render = async(children)=>act(async()=>root.render(children));
const click = async(text)=>{
  const button = [...document.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
  assert(button, `button ${text}`);
  await act(async()=>button.dispatchEvent(new window.MouseEvent('click',{bubbles:true})));
};
try {
  await build({stdin:{contents:`
    export {ShareRecordButton} from './components/ShareRecordButton';
    export * from './src/services/pdfPreferencesService';
    export * from './src/services/subcontratasPreferencesService';
    export * from './src/services/subcontrataSettingsService';
    export * from './src/services/annualHiringPeriodsService';
    export * from './src/services/auditService';
    export {writeAuditEvent} from './src/lib/functions';
    export * from './src/services/medicalRecognitionService';
  `,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:output.pathname,plugins:[plugin]});
  const api = await import(output.href);
  const button = (id,ownerId)=>React.createElement(api.ShareRecordButton,{key:id,resourceType:'trabajadores',resourceId:id,ownerId});
  await render(React.createElement(React.Fragment,null,...Array.from({length:100},(_,i)=>button(i+1,'owner-A'))));
  assert.equal(document.querySelectorAll('.profea-share-record-button').length,100);
  assert.equal(calls.length,0,'100 known owners cause no owner/auth network requests');
  await render(button(101,'other-owner'));
  assert.equal(document.querySelectorAll('button').length,0,'other-owner controls stay hidden');
  await render(button(102,undefined));
  assert.equal(calls.length,1,'missing owner retains the database fallback');
  assert.equal(calls[0].table,'trabajadores');
  await render(button(103,'owner-A'));
  calls=[];
  await click('Compartir');
  assert.deepEqual(calls.map(call=>call.rpc),['list_shareable_profiles','get_worker_shares']);
  await click('Lectura + escritura');
  assert(calls.some(call=>call.rpc==='set_worker_share' && call.body.p_worker_id===103 && call.body.p_can_update===true));
  assert(document.body.textContent.includes('Compartido: lectura + escritura'));
  await click('Dejar de compartir');
  assert(calls.some(call=>call.rpc==='remove_worker_share' && call.body.p_worker_id===103));
  await render(null);

  assert.deepEqual(await api.loadPdfPreferences(),{fontSize:12});
  await api.savePdfPreferences({fontSize:14});
  assert.deepEqual(await api.loadPdfPreferences(),{fontSize:14});
  const prefs = await api.saveSubcontratasPreferences({obrasRecursosPreventivos:{worksite:{value:1}}});
  assert.deepEqual(prefs.reporteTecnicoConfig,{title:'keep'},'saving a patch preserves other CAE preferences');
  const cae = await api.saveSubcontrataSettings({reporteConfig:{title:'new'}});
  assert.deepEqual(cae.obrasRecursos,{worksite:{nombre:'keep'}});
  assert.equal((await api.listAnnualHiringPeriods())[0].year,2026);
  await api.saveAnnualHiringPeriods({id:'annual-2027',year:2027,months:[],importedAt:'2027-01-01'});
  assert.equal((await api.listAnnualHiringPeriods()).length,2);
  await api.deleteAnnualHiringPeriods(2026);
  assert.equal((await api.listAnnualHiringPeriods())[0].year,2027);
  settings={};
  assert.deepEqual(await api.loadPdfPreferences(),{});
  assert.deepEqual(await api.loadSubcontratasPreferences(),{});
  assert.deepEqual(await api.listAnnualHiringPeriods(),[]);

  calls=[];
  await api.writeAuditLog('UPDATE','trabajadores','103',{changed:'name'});
  await api.writeAuditEvent({action:'UPDATE',resourceType:'citas',resourceId:'appointment'});
  assert.equal(calls.filter(call=>call.table==='audit_logs' && call.method==='POST').length,0,'non-login activity is not audited');
  await api.writeAuditLog('LOGIN','auth','owner-A');
  await api.writeAuditEvent({action:'LOGIN',resourceType:'auth',resourceId:'owner-A'});
  assert.equal(calls.filter(call=>call.table==='audit_logs' && call.method==='POST').length,2,'login access remains audited');
  assert(calls.filter(call=>call.table==='audit_logs').every(call=>call.body.action==='LOGIN' && call.body.user_id==='owner-A'));
  await api.persistMedicalRecognition({id:103,dni:'test',reconocimientoEstado:'apto'});
  const medical = calls.find(call=>call.table==='reconocimientos' && call.method==='POST');
  assert(medical);
  assert.equal(medical.body.owner_id,'owner-A');
  assert.equal(medical.body.obra_id,'worksite');
  user={id:'owner-B',email:'second@example.com'};
  await api.loadPdfPreferences();
  assert(calls.at(-1).query.includes('user_id=eq.owner-B'),'no stale identity after an account change');
  user=null;calls=[];
  await assert.rejects(api.loadPdfPreferences(),/sesión autenticada/);
  await api.writeAuditLog('LOGIN','','');
  assert.equal(calls.length,0,'absent sessions do not query or write');
  console.log('Consumption phase 2 passed: 100 buttons without network calls, owner fallback, sharing RPCs, scoped partial settings, audit preservation, medical save and account changes.');
} finally {
  await act(async()=>root.unmount());
  await fs.rm(output,{force:true});
  dom.window.close();
  delete globalThis.__phase2;
}
