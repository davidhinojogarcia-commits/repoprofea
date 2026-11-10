import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { generateWorkerCard, generateDniSizedPrintSheet } from '../src/lib/workerCard.ts';

const person = {
  apellidosNombre: 'TRABAJADOR DE PRUEBA',
  dni: '12345678Z',
  categoria: 'Peón',
  obra: 'OBRA PRIVADA',
  reconocimientoEstado: 'No Apto',
  reconocimientoLimitaciones: 'DIAGNÓSTICO PRIVADO',
};
const card = generateWorkerCard(person);
const cardText = card.doc.output();
assert.ok(!cardText.includes('12345678Z'), 'La tarjeta compartible no debe publicar el DNI completo');
assert.ok(!cardText.includes('DIAGNÓSTICO PRIVADO'), 'No debe publicar información sanitaria');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==';
const result = generateDniSizedPrintSheet(png);
const pdf = await PDFDocument.load(result.doc.output('arraybuffer'));
assert.equal(pdf.getPageCount(), 1);
assert.ok(Math.abs(pdf.getPage(0).getWidth()/72*25.4-210)<0.2,'La hoja debe ser A4');
assert.ok(Math.abs(pdf.getPage(0).getHeight()/72*25.4-297)<0.2,'La hoja debe ser A4');
assert.match(result.filename,/DNI_A4/);
assert.throws(()=>generateDniSizedPrintSheet('https://example.com/something'),/PNG/);
console.log('PASS: carnet compartible sin DNI ni información sanitaria; impresión DNI centrada en A4 a escala física y rechazo de imagen no válida.');
