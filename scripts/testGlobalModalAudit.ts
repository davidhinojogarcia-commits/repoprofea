import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const componentsDir=path.resolve('components');
const allowFixedInsetWithoutPortal=new Set([
  'Sidebar.tsx', // mobile navigation backdrop, not a modal/dialog
  'ModalPortal.tsx',
]);

const files=fs.readdirSync(componentsDir).filter(name=>/\.(tsx|ts)$/.test(name));
const offenders:string[]=[];
const modalOffenders:string[]=[];

for(const file of files){
  const source=fs.readFileSync(path.join(componentsDir,file),'utf8');
  const hasFixedInset=/fixed\s+inset-0/.test(source);
  const hasPortal=/ModalPortal|createPortal/.test(source);

  if(hasFixedInset && !hasPortal && !allowFixedInsetWithoutPortal.has(file)){
    offenders.push(file);
  }

  if(/Modal\.tsx$/.test(file) && hasFixedInset && !hasPortal){
    modalOffenders.push(file);
  }

  if(/aria-modal=["']true["']/.test(source) && !hasPortal){
    modalOffenders.push(file);
  }
}

assert.deepEqual(
  offenders,
  [],
  'Todo overlay fijo de pantalla completa debe renderizarse mediante ModalPortal/createPortal. Offenders: '+offenders.join(', ')
);
assert.deepEqual(
  [...new Set(modalOffenders)],
  [],
  'Todo modal accesible debe renderizarse fuera del stacking context local. Offenders: '+[...new Set(modalOffenders)].join(', ')
);

const modalPortal=fs.readFileSync(path.join(componentsDir,'ModalPortal.tsx'),'utf8');
const appDialog=fs.readFileSync(path.join(componentsDir,'AppDialogHost.tsx'),'utf8');

assert.match(modalPortal,/createPortal\(/,'ModalPortal debe usar createPortal');
assert.match(modalPortal,/document\.body/,'ModalPortal debe renderizar en document.body');
assert.match(modalPortal,/MODAL_LAYER_BASE/,'ModalPortal debe conservar una capa global superior centralizada');
assert.match(modalPortal,/modalLayerSequence/,'ModalPortal debe elevar cada modal nuevo sobre los anteriores');
assert.match(modalPortal,/document\.body\.style\.overflow = 'hidden'/,'ModalPortal debe bloquear el scroll del fondo');
assert.match(appDialog,/z-\[2147483600\]/,'Los diálogos globales deben quedar por encima de cualquier modal');

console.log('Global full-screen overlay layering audit passed.');

// Raw createPortal calls may only implement the primitives or a non-modal filter.
for(const file of files){
 const source=fs.readFileSync(path.join(componentsDir,file),'utf8');
 if(/createPortal\(/.test(source)&&!['ModalPortal.tsx','AppDialogHost.tsx','DirectoryStatusFilter.tsx'].includes(file)){
  assert.fail(file+' debe usar ModalPortal para conservar las capas, el foco y el bloqueo del fondo');
 }
}
assert.match(appDialog,/zIndex:\s*2147483600/,'La confirmación debe conservar su capa incluso sin Tailwind');
assert.match(appDialog,/position:\s*['"]fixed['"]/,'La confirmación debe ser fija incluso sin Tailwind');
