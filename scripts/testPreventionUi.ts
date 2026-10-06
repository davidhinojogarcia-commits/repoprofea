import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { preventionSqlFixture, owner, token } from './preventionSqlFixture.mjs';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://local-validation.invalid/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
const { db, asUser } = await preventionSqlFixture();
const { supabase } = await import('../src/lib/supabase');
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { PreventionSection } = await import('../components/PreventionSection');
const realRpc = supabase.rpc;
supabase.rpc = async (name: string, args: Record<string, any>) => {
  await asUser(args.p_token ? null : owner, args.p_token ? 'anon' : 'authenticated');
  if (name === 'list_prevention_records') return (await db.query<{data: any}>('select list_prevention_records($1) as data',[args.p_token])).rows[0].data;
  if (name === 'save_prevention_record') return (await db.query<{data: any}>('select save_prevention_record($1,$2,$3,$4) as data',[args.p_id,args.p_data,args.p_token,args.p_expected_updated_at])).rows[0].data;
  if (name === 'get_prevention_record_details') return (await db.query<{data: any}>('select get_prevention_record_details($1,$2) as data',[args.p_id,args.p_token])).rows[0].data;
  throw new Error('Unexpected network operation: '+name);
};
let root = createRoot(document.getElementById('root')!);
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function action(callback: () => any) { await React.act(async () => { callback(); await pause(); }); }
function button(text: string) {
  const found = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
  assert.ok(found,`Missing button: ${text}`); return found;
}
function field(text: string) {
  const scope = document.querySelector('form') || document;
  const label = [...scope.querySelectorAll('label')].find(l => l.firstChild?.textContent?.trim() === text);
  assert.ok(label,`Missing label: ${text}; available: ${[...document.querySelectorAll('label')].map(l=>l.firstChild?.textContent).join('|')}; buttons: ${[...document.querySelectorAll('button')].map(b=>b.textContent).join('|')}`);
  const control=label.querySelector('input,textarea,select') as HTMLInputElement | HTMLSelectElement;
  assert.ok(control); return control;
}
async function fill(text: string,value: string) {
  const control=field(text);
  const prototype=control.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:control.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;
  await action(()=>{ Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(control,value); control.dispatchEvent(new dom.window.Event(control.tagName==='SELECT'?'change':'input',{bubbles:true})); });
}
async function mount(portal=false) {
  await action(()=>root.render(React.createElement(PreventionSection,{savedObras:portal?['Obra A']:['Obra A','Obra B'],token:portal?token:undefined,foremanName:portal?'Encargado A':undefined})));
}
try {
  await mount();
  await action(()=>button('Comunicar incidencia').click());
  await fill('Título','Riesgo de caída'); await fill('Tarea prevista','Excavación');
  await fill('Descripción del riesgo','Borde sin proteger'); await fill('Prioridad comunicada','high');
  await action(()=>document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.ok(document.body.textContent!.includes('Registro guardado'));
  assert.equal(document.querySelectorAll('article').length,1);
  await action(()=>root.unmount()); root=createRoot(document.getElementById('root')!); await mount();
  assert.ok(document.body.textContent!.includes('Riesgo de caída'),'Record must survive component reload');
  await action(()=>button('Gestionar seguimiento').click());
  await fill('Estado','closed'); await fill('Responsable','David');
  await action(()=>document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.ok(document.querySelector('[role="alert"]')?.textContent?.includes('medidas'),'Close must require measures');
  await fill('Medidas adoptadas','Protección instalada');
  await action(()=>document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.ok(document.body.textContent!.includes('Seguimiento guardado'));
  await action(()=>root.unmount()); root=createRoot(document.getElementById('root')!); await mount(true);
  assert.equal(button('Comunicar incidencia').disabled,false);
  assert.ok(field('Obra').disabled,'Foreman cannot change work');
  assert.ok(![...document.querySelectorAll('button')].some(b=>b.textContent?.includes('Gestionar seguimiento')),'Foreman cannot close records');
  await action(()=>button('Comprobación antes de empezar').click());
  await fill('Tarea prevista','Reposición de pavimento');
  const checks=[...document.querySelectorAll<HTMLSelectElement>('fieldset fieldset select')]; assert.equal(checks.length,6);
  for(const select of checks) await action(()=>{select.value='yes';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  await action(()=>document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.ok(document.body.textContent!.includes('Comprobación registrada'));
  assert.equal(document.querySelectorAll('article').length,2);
  console.log('PASS: interfaz DOM real + Postgres local; alta, recarga, cierre, medidas obligatorias y comprobación desde portal con obra bloqueada.');
} finally {
  await action(()=>root.unmount()); supabase.rpc=realRpc; await supabase.auth.stopAutoRefresh(); await db.close(); dom.window.close();
}
