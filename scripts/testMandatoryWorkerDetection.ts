import assert from 'node:assert/strict';
import { extractPrintedWorkerNameCandidates, looksLikePrintedWorkerName } from '../src/lib/mandatoryWorkerDetection';

const valid = [
  'JAEN ALCONCHEL, MARIA JESUS',
  'NÚÑEZ GARCIA, FRANCISCA',
  'ORTEGA CANO, JUAN JOSE',
  'MARQUEZ GONZALEZ, MARIA JESUS',
  'PÉREZ DE LA TORRE ,     MARÍA DEL CARMEN',
  '12   GARCÍA LÓPEZ, JUAN MANUEL',
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

const tableText = [
  'CONTROL DE PRESENCIA',
  '1   GARCÍA LÓPEZ,     JUAN MANUEL        01/10/2026',
  '2   PÉREZ DE LA TORRE ,   MARÍA DEL CARMEN      01/10/2026',
  'RODRÍGUEZ SÁNCHEZ,',
  'ANTONIO',
  'DIPUTACIÓN DE CÁDIZ',
].join('\n');

assert.deepEqual(
  extractPrintedWorkerNameCandidates(tableText),
  [
    'GARCÍA LÓPEZ, JUAN MANUEL',
    'PÉREZ DE LA TORRE, MARÍA DEL CARMEN',
    'RODRÍGUEZ SÁNCHEZ, ANTONIO',
  ],
  'Debe extraer los nombres del Control de presencia aunque haya comas, espacios, numeración o salto de línea.',
);

console.log('Mandatory worker detection regression passed.');
