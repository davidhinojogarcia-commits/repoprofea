import assert from 'node:assert/strict';
import { extractMandatoryWorksiteLabel, extractMandatoryWorksiteCode, resolveMandatoryWorksite } from '../src/lib/mandatoryWorksiteDetection';

assert.equal(
  extractMandatoryWorksiteLabel('OBRA: RENOVACIÓN DE INFRAESTRUCTURAS EN CALLE NUÑEZ DEL PRADO Y SAN PEDRO\nCATEGORIA PEON'),
  'RENOVACIÓN DE INFRAESTRUCTURAS EN CALLE NUÑEZ DEL PRADO Y SAN PEDRO'
);

assert.equal(extractMandatoryWorksiteCode('CONTROL DE PRESENCIA · 12345-EE'),'12345 EE');

const candidates=[
  'RENOVACIÓN DE INFRAESTRUCTURAS EN CALLE NUÑEZ DEL PRADO Y SAN PEDRO',
  'ADECUACIÓN PARQUE MUNICIPAL',
];

assert.equal(
  resolveMandatoryWorksite({
    text:'OBRA: RENOVACION DE INFRAESTRUCTURAS EN CALLE NUÑEZ DEL PRADO Y SAN PEDRO\nNIF\nFIRMA',
    candidates,
    fallback:'ADECUACIÓN PARQUE MUNICIPAL',
  }).obra,
  candidates[0],
  'La obra escrita en el PDF debe prevalecer sobre la obra seleccionada en pantalla.'
);

assert.equal(
  resolveMandatoryWorksite({
    text:'OBRA: ADECUACION PARQUE MUNICIPAL\nCONTROL DE PRESENCIA',
    candidates,
    fallback:candidates[0],
  }).obra,
  candidates[1],
  'Dos PDFs distintos deben clasificarse en obras distintas.'
);

assert.equal(
  resolveMandatoryWorksite({
    text:'OBRA: MEJORA DE ACERADOS EN BARRIADA SUR\nCONTROL DE PRESENCIA',
    candidates:[],
  }).obra,
  'MEJORA DE ACERADOS EN BARRIADA SUR',
  'Si la obra aún no está en los grupos existentes, debe conservarse la denominación del PDF.'
);

assert.equal(
  resolveMandatoryWorksite({text:'CONTROL DE PRESENCIA\nSIN IDENTIFICACION DE OBRA',candidates:[]}).obra,
  '',
  'Si no puede determinarse la obra, no debe inventarse una clasificación.'
);

console.log('Mandatory worksite classification regression passed.');
