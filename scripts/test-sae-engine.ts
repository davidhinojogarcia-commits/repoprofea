import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  detectSaeLegend, generateCompletedSaePdf, normalizePersonName, normalizeSearchText,
  parseCandidateRows, parseNeedExtraction,
} from '../src/features/sae/saeDocumentEngine';
import type { SaeDocumentExtraction, SaeNeed } from '../src/features/sae/types';

const row = (page: number, rowIndex: number, text: string, y: number) => ({
  page, rowIndex, text, x: 32, y, width: 420, height: 11, pageWidth: 595, pageHeight: 842,
});

const needExtraction = {
  file: { name: 'nombre-no-utilizado-como-evidencia.pdf' } as File,
  method: 'native', pageCount: 2,
  rows: [
    row(1, 0, 'OBRA: EDAR Sevilla', 60),
    row(1, 1, 'Código de obra: EDAR-026', 80),
    row(1, 2, 'Contratación prevista: Octubre 2026', 100),
    row(1, 3, 'Oficial 1ª: 4 trabajadores', 140),
    row(1, 4, 'Peón: 8 trabajadores', 160),
    row(2, 0, 'Gruista: 1 trabajador', 60),
  ],
} as SaeDocumentExtraction;
needExtraction.fullText = needExtraction.rows.map(item => item.text).join('\n');

const parsedNeed = parseNeedExtraction(needExtraction);
assert.equal(parsedNeed.workName, 'EDAR Sevilla');
assert.equal(parsedNeed.workCode, 'EDAR-026');
assert.equal(parsedNeed.month, 10);
assert.equal(parsedNeed.year, 2026);
assert.equal(parsedNeed.totalRequested, 13);
assert.deepEqual(parsedNeed.categories.map(item => item.requestedCount), [4, 8, 1]);

const need: SaeNeed = {
  id: '00000000-0000-4000-8000-000000000001', workName: parsedNeed.workName!, workCode: parsedNeed.workCode,
  month: parsedNeed.month!, year: parsedNeed.year!, totalRequested: parsedNeed.totalRequested!,
  status: 'pendiente_candidatos_sae', categories: parsedNeed.categories,
};
const reportExtraction = {
  file: { name: 'contenido-irrelevante.pdf' } as File,
  method: 'native', pageCount: 2,
  rows: [
    row(1, 0, 'OFERTA SAE 41/2026', 50),
    row(1, 1, 'MUÑOZ RAMÍREZ, JUAN 12345678Z Oficial 1ª', 120),
    row(1, 2, 'DE LA TORRE GÓMEZ, MARÍA DEL CARMEN Y1234567X Peón', 140),
    row(2, 0, 'OCAÑA ÑÚÑEZ, JOSÉ LUIS Z1234567R Gruista 2ª quincena', 80),
    row(2, 1, '2100 = Contratado', 760),
  ],
} as SaeDocumentExtraction;
reportExtraction.fullText = reportExtraction.rows.map(item => item.text).join('\n');

const candidates = parseCandidateRows(reportExtraction, need, '00000000-0000-4000-8000-000000000002');
assert.equal(candidates.length, 3);
assert.equal(candidates[0].offerNumber, '41/2026', 'La oferta detectada en la cabecera se propaga a sus candidatos.');
assert.equal(candidates[0].normalizedFullName, 'Juan Muñoz Ramírez');
assert.equal(candidates[1].normalizedFullName, 'María Del Carmen De La Torre Gómez');
assert.equal(candidates[2].fortnight, 2);
assert.equal(candidates[2].sourcePage, 2);
assert.equal(candidates[2].sourcePosition.rowIndex, 0);
assert.equal(normalizeSearchText('PEÓN'), 'peon');
assert.equal(normalizePersonName('MUÑOZ RAMIREZ, JUAN'), 'Juan Muñoz Ramirez');
assert.deepEqual(detectSaeLegend(reportExtraction.fullText), { contratado: '2100' });

const duplicateRows = { ...reportExtraction, rows: [...reportExtraction.rows, row(2, 2, 'MUÑOZ RAMÍREZ, JUAN 12345678Z Oficial 1ª', 160)] };
duplicateRows.fullText = duplicateRows.rows.map(item => item.text).join('\n');
assert.equal(parseCandidateRows(duplicateRows, need, '00000000-0000-4000-8000-000000000002').length, 4, 'Los candidatos repetidos se conservan para revisión humana.');

const originalPdf = await PDFDocument.create();
originalPdf.addPage([595, 842]);
originalPdf.addPage([595, 842]);
const sourceBytes = await originalPdf.save();
const completed = await generateCompletedSaePdf(sourceBytes.buffer as ArrayBuffer, 'application/pdf', [{ ...candidates[0], resultCode: '2100' }, { ...candidates[2], resultCode: '2100' }]);
const completedPdf = await PDFDocument.load(completed);
assert.equal(completedPdf.getPageCount(), 2, 'La devolución conserva documentos multipágina.');
assert.ok(completed.length > sourceBytes.length, 'La devolución añade el overlay sin reconstruir el PDF.');

console.log('SAE engine tests: OK');
