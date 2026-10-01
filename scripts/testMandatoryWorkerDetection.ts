import assert from 'node:assert/strict';
import { looksLikePrintedWorkerName } from '../src/lib/mandatoryWorkerDetection';

const valid = [
  'JAEN ALCONCHEL, MARIA JESUS',
  'NÚÑEZ GARCIA, FRANCISCA',
  'ORTEGA CANO, JUAN JOSE',
  'MARQUEZ GONZALEZ, MARIA JESUS',
];

const invalid = [
  'CALLES NUÑEZ DEL PRADO Y SAN PEDRO',
  'ÁREA DE COOPERACIÓN - CALLES NUÑEZ DEL PRADO Y SAN PEDRO - ARCOS DE LA FRA',
  'DIPUTACIÓN DE CÁDIZ',
  'CATEGORIA PEON',
  'CONTROL DE PRESENCIA',
  'AVENIDA ALFREDO ERQUICIA DE JEDULA',
  'PLAZA DE PANADEROS',
  'PARQUE EN AVDA ALFREDO ERQUICIA',
];

for (const value of valid) {
  assert.equal(looksLikePrintedWorkerName(value), true, `Debe reconocerse como nombre: ${value}`);
}
for (const value of invalid) {
  assert.equal(looksLikePrintedWorkerName(value), false, `No debe reconocerse como trabajador: ${value}`);
}

console.log('Mandatory worker detection regression passed.');
