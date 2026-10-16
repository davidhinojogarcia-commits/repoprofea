import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://validation.invalid'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
const output=new URL('./.employment-worksite-ui.mjs',import.meta.url);let root;
try{
 await build({entryPoints:[new URL('../components/MandatoryWorksiteReviewModal.tsx',import.meta.url).pathname],outfile:output.pathname,bundle:true,format:'esm',platform:'node',packages:'external'});
 const React=await import('react');const {createRoot}=await import('react-dom/client');const {default:Modal}=await import(output.href);
 const action=async fn=>React.act(async()=>{await fn();await new Promise(r=>setTimeout(r,15));});
 const mount=async props=>{if(root)await action(()=>root.unmount());root=createRoot(document.getElementById('root'));await action(()=>root.render(React.createElement(Modal,{documentLabel:'Contrato',onCancel(){},...props})));};
 const button=()=>[...document.querySelectorAll('button')].find(b=>/Asignar obra|Asignando/.test(b.textContent));
 let calls=0,fail=true,release;const choices=[];
 await mount({works:['Acerados','Parque'],proposedWorksite:'Parque',detectedCodes:['11003EE'],onConfirm:async value=>{calls++;choices.push(value);await new Promise(r=>{release=r;});if(fail)throw Error('Sin conexión');}});
 assert.equal(document.querySelector('select').value,'Parque');assert(document.body.textContent.includes('11003EE'));
 await action(()=>{const select=document.querySelector('select');select.value='Acerados';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
 await action(()=>{button().click();button().click();});assert.equal(calls,1);assert.equal(button().disabled,true);assert.equal(choices[0],'Acerados');
 await action(()=>release());assert(document.querySelector('[role="alert"]').textContent.includes('Sin conexión'));assert.equal(document.querySelector('select').value,'Acerados');
 fail=false;await action(()=>button().click());await action(()=>release());assert.equal(calls,2);
 await mount({works:['Acerados','Parque'],onConfirm(){throw Error('must not run');}});assert.equal(document.querySelector('select').value,'');assert.equal(button().disabled,true,'no first worksite selected silently');
 await mount({works:['Acerados'],proposedWorksite:'Obra ajena',onConfirm(){}});assert.equal(document.querySelector('select').value,'','stale/foreign proposal cannot preselect an unavailable worksite');
 await mount({works:[],onConfirm(){}});assert.equal(button().disabled,true);assert(document.body.textContent.includes('No hay obras disponibles'));
 console.log('PASS: proposal displayed, manual correction, empty/foreign catalogs, guarded double click, visible failure and retained selection for retry.');
}finally{if(root)await(await import('react')).act(()=>root.unmount());dom.window.close();await fs.rm(output,{force:true});}
