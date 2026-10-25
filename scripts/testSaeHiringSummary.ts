import assert from 'node:assert/strict';
import { buildSaeHiringSummary } from '../src/lib/saeHiringSummary';
import type { SaeCandidate, SaeNeed, SaeReport } from '../src/services/saeService';

const need = { id: 'need', categorias: [
  { id: 'q1', categoria: 'Peones · 1ª Quincena', cantidad: 6 },
  { id: 'q2', categoria: 'Peones · 2ª Quincena', cantidad: 6 },
  { id: 'official', categoria: 'Oficial 1ª · Revocador · CN 72121041', cantidad: 1 },
] } as SaeNeed;
const reports = ['first', 'second', 'extra', 'official'].map((id, index) => ({
  id, needId: 'need', categoria: index === 3 ? 'Oficial 1a Revocador' : 'Peón',
  quincena: index === 0 || index === 2 ? '1ª Quincena' : index === 1 ? '2ª Quincena' : '',
})) as SaeReport[];
const person = (id: string, reportId: string, patch: Partial<SaeCandidate> = {}) => ({
  id, needId: 'need', reportId, categoria: 'Peón', normalizedName: id, quincena: '', estado: 'Sin asignar', resultCode: '', ...patch,
}) as SaeCandidate;
const candidates = [
  ...Array.from({ length: 6 }, (_, i) => person(`Nombre ${i}`, 'first', { resultCode: '2001' })),
  person('duplicate', 'extra', { normalizedName: 'NÓMBRE 0', resultCode: '2001', linkedWorkerId: 123 }),
  person('Nombre 0', 'second', { resultCode: '2001' }),
  person('only-period', 'second', { quincena: '2ª Quincena', estado: '2ª Quincena' }),
  person('occupied', 'second', { resultCode: '2500', estado: 'Contratado', linkedWorkerId: 321 }),
  person('officer', 'official', { categoria: 'Oficial 1a Revocador', resultCode: '2001' }),
  person('foreign', 'first', { needId: 'another', resultCode: '2001' }),
];
let rows = buildSaeHiringSummary(need, reports, candidates, 'extra');
assert.deepEqual(rows.map(r => [r.planned, r.hiring, r.remaining]), [[6, 6, 0], [6, 1, 5], [1, 1, 0]]);
assert.equal(rows[0].registered, 1);
assert.equal(rows[0].reportHiring, 1);
assert.equal(rows[0].reportRelevant, true);
assert.equal(rows[1].candidates, 3);
assert.equal(rows[2].period, 'Mensual');
// Switching the selected report never changes the shared target or its coverage.
assert.deepEqual(buildSaeHiringSummary(need, reports, candidates, 'second').map(r => r.hiring), [6, 1, 1]);
// Change, undo, or deletion recomputes the balance without accumulating counters.
assert.equal(buildSaeHiringSummary(need, reports, candidates.filter(c => c.normalizedName !== 'Nombre 1'))[0].remaining, 1);
assert.equal(buildSaeHiringSummary(need, reports, [...candidates, person('extra-person', 'first', { resultCode: '2001' })])[0].excess, 1);
assert.equal(buildSaeHiringSummary(need, reports, candidates.map(c => c.id === 'officer' ? { ...c, resultCode: '2212' } : c))[2].remaining, 1);
assert.equal(buildSaeHiringSummary(need, reports, [person('state-only', 'first', { estado: 'Contratado' })])[0].hiring, 1);
assert.equal(buildSaeHiringSummary(need, reports, [person('selected', 'first', { estado: 'Preseleccionado' })])[0].hiring, 0);
assert.equal(buildSaeHiringSummary(need, reports, [person('overridden', 'first', { quincena: '2ª Quincena', resultCode: '2001' })])[1].hiring, 1);
rows = buildSaeHiringSummary(need, reports, [person('unknown', 'official', { categoria: '', resultCode: '2001' })]);
assert.equal(rows[2].hiring, 1); // falls back to the report category
const unclassified = { ...reports[0], id: 'unknown', quincena: '' };
rows = buildSaeHiringSummary(need, [...reports, unclassified], [person('unknown', 'unknown', { resultCode: '2001' })]);
assert.equal(rows[0].remaining, 6);
assert.equal(rows.at(-1)?.period, 'Periodo por confirmar');
assert.equal(rows.at(-1)?.planned, null);
const ambiguous = { ...need, categorias: [...need.categorias, { id: 'other-role', categoria: 'Oficial 1ª Albañil', cantidad: 2 }] };
rows = buildSaeHiringSummary(ambiguous, reports, [person('ambiguous', 'official', { categoria: 'Oficial 1ª', resultCode: '2001' })]);
assert.equal(rows.filter(r => r.planned !== null).reduce((n, r) => n + r.hiring, 0), 0);
rows = buildSaeHiringSummary(need, reports, [person('wrong-cn', 'official', { categoria: 'Oficial 1ª Revocador CN 99999999', resultCode: '2001' })]);
assert.equal(rows[2].hiring, 0);
assert.equal(rows[3].planned, null);
const pending = { ...need, categorias: [{ id: 'pending', categoria: 'Peones · 1ª Quincena · PENDIENTE', cantidad: 0 }] };
assert.equal(buildSaeHiringSummary(pending, reports, [])[0].remaining, null);
// A repeated unnamed worker must not collapse unrelated candidates into one.
rows = buildSaeHiringSummary(need, reports, [person('id1', 'first', { normalizedName: '', resultCode: '2001' }), person('id2', 'first', { normalizedName: '', resultCode: '2001' })]);
assert.equal(rows[0].hiring, 2);
console.log('SAE hiring summary: periods, shared reports, monthly officers, deduplication, reversals, excess and unknown/ambiguous planning passed.');
