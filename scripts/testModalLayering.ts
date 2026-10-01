import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

const portal = read('components/ForemanMobilePortal.tsx');
const dashboard = read('components/ForemanDocumentsDashboard.tsx');
const anchor = read('components/MandatoryPdfAnchorEditor.tsx');
const host = read('components/AppDialogHost.tsx');
const layer = read('components/ModalPortal.tsx');

for (const [name, source] of [
  ['ForemanMobilePortal', portal],
  ['ForemanDocumentsDashboard', dashboard],
] as const) {
  assert.equal(/window\.(alert|confirm|prompt)\s*\(/.test(source), false, `${name} no debe usar diálogos del navegador`);
}

assert.match(portal, /ModalPortal/, 'El portal de encargados debe usar la capa global de modales');
assert.match(dashboard, /ModalPortal/, 'Documentación de encargados debe usar la capa global de modales');
assert.match(anchor, /ModalPortal/, 'Ajustar firmas debe renderizarse en la capa global');
assert.match(anchor, /Eliminar trabajador del documento/, 'Ajustar firmas debe permitir borrar falsos positivos');
assert.match(host, /createPortal/, 'AppDialogHost debe usar createPortal');
assert.match(host, /z-\[2147483600\]/, 'AppDialogHost debe estar sobre cualquier modal general');
assert.match(layer, /MODAL_LAYER_BASE/, 'ModalPortal debe usar la capa modal global centralizada');
assert.match(layer, /modalLayerSequence/, 'Los modales deben apilarse de forma creciente para que el último quede delante');
assert.match(layer, /document\.body/, 'ModalPortal debe renderizar sobre document.body');
assert.match(layer, /document\.body\.style\.overflow = 'hidden'/, 'ModalPortal debe bloquear el scroll del fondo');

console.log('Global modal layering regression passed.');
