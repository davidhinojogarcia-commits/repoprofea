import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const walk=(dir:string):string[]=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const full=path.join(dir,entry.name);
  return entry.isDirectory()?walk(full):[full];
});

const files=walk('components').filter(file=>file.endsWith('.tsx'));
const offenders:string[]=[];
for(const file of files){
  const source=fs.readFileSync(file,'utf8');
  if(!source.includes('fixed inset-0')) continue;
  const isPortalPrimitive=file.endsWith('ModalPortal.tsx')||file.endsWith('AppDialogHost.tsx');
  const usesGlobalLayer=source.includes('ModalPortal')||source.includes('createPortal');
  const explicitlyNonModal=source.includes('profea-nonmodal-overlay');
  if(!isPortalPrimitive&&!usesGlobalLayer&&!explicitlyNonModal) offenders.push(file);
}
assert.deepEqual(offenders,[],`Hay overlays fullscreen fuera de la capa global: ${offenders.join(', ')}`);

const portal=fs.readFileSync('components/ModalPortal.tsx','utf8');
assert.match(portal,/createPortal\(/,'ModalPortal debe renderizar en document.body');
assert.match(portal,/document\.body/,'ModalPortal debe salir del stacking context local');
assert.match(portal,/MODAL_LAYER_BASE/,'ModalPortal debe usar una jerarquía central de capas');
assert.match(portal,/modalLayerSequence/,'Cada modal nuevo debe quedar por encima del anterior');
assert.match(portal,/profea-modal-overlay/,'La capa modal debe ser reconocible por el runtime');
assert.match(portal,/document\.body\.style\.overflow = 'hidden'/,'El fondo debe quedar bloqueado mientras haya modal');

const dialog=fs.readFileSync('components/AppDialogHost.tsx','utf8');
assert.match(dialog,/z-\[2147483600\]/,'Los diálogos globales deben permanecer por encima del stack de modales');

console.log('Global modal stack audit passed.');
