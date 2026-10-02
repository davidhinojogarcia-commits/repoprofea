import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('components/ForemanMobilePortal.tsx','utf8');

assert.match(
  source,
  /onClick=\{\(\)=>void persist\(controlRows,'completed'\)\}/,
  'Finalizar control horario debe enviar solo las filas del periodo filtrado.',
);

assert.doesNotMatch(
  source,
  /onClick=\{\(\)=>void persist\(rows,'completed'\)\}/,
  'No se deben enviar todas las filas al finalizar un periodo filtrado.',
);

assert.match(
  source,
  /const controlRows=useMemo\(\(\)=>rows\.filter\(row=>selectedWorkerIds\.has\(Number\(row\.workerId\)\)\)/,
  'Las filas enviadas deben derivarse del filtro de trabajadores del periodo seleccionado.',
);

console.log('Foreman attendance period filter regression passed.');
