import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path:string)=>fs.readFileSync(path,'utf8');

const dashboard=read('components/ForemanDocumentsDashboard.tsx');
const portal=read('components/ForemanMobilePortal.tsx');
const editor=read('components/MandatoryPdfAnchorEditor.tsx');

assert.match(dashboard,/dark:bg-slate-900/,'Documentación de encargados debe tener fondo nocturno');
assert.match(dashboard,/dark:text-amber-50/,'Los avisos ámbar deben ser legibles en nocturno');
assert.match(dashboard,/dark:text-slate-300/,'Los textos secundarios deben mantener contraste en nocturno');
assert.match(dashboard,/dark:bg-blue-950\/70/,'Los estados azules deben tener variante nocturna');
assert.match(dashboard,/dark:bg-amber-950\/70/,'Los estados ámbar deben tener variante nocturna');

assert.match(portal,/dark:bg-slate-900/,'El portal del encargado debe adaptar sus superficies al modo nocturno');
assert.match(portal,/dark:text-slate-50/,'El portal del encargado debe usar texto claro en nocturno');
assert.match(portal,/dark:bg-amber-950\/80/,'Los avisos del portal deben ser legibles en nocturno');

assert.match(editor,/dark:bg-slate-900/,'Ajustar firmas debe tener superficie nocturna');
assert.match(editor,/dark:text-slate-50/,'Ajustar firmas debe mantener texto principal legible');
assert.match(editor,/dark:bg-blue-950\/60/,'Las ayudas del editor deben tener contraste nocturno');

console.log('Light/dark contrast regression passed.');
