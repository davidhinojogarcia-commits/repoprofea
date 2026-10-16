import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
import { PDFDocument } from 'pdf-lib';
import { deflateSync } from 'node:zlib';

const output = new URL('./.signed-attendance-pdf.mjs', import.meta.url);
const directory = new URL('../tmp/pdfs/', import.meta.url);
// Synthetic blue stroke on transparent pixels; no personal signature fixtures.
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
};
const width = 120, height = 36, scanlines = Buffer.alloc(height * (width * 4 + 1));
for (let x = 8; x < 112; x++) {
  const y = Math.round(18 + 9 * Math.sin(x / 6));
  for (let dy = -1; dy <= 1; dy++) { const offset = (y + dy) * (width * 4 + 1) + 1 + x * 4; scanlines.set([22, 75, 155, 255], offset); }
}
const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
try {
  await build({ stdin: { contents: "export {generateForemanAttendancePdf} from './src/lib/foremanDocumentsPdf'; export {signedAttendanceRows} from './src/lib/signedAttendance';", resolveDir: new URL('../', import.meta.url).pathname }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', packages: 'external', define: { 'import.meta.env': '{}' }, plugins: [{ name: 'node-pdf-boundaries', setup(b) {
    b.onResolve({ filter: /^jspdf-autotable$/ }, args => args.namespace === 'autotable-interop' ? { path: args.path, external: true } : { path: 'jspdf-autotable', namespace: 'autotable-interop' });
    b.onLoad({ filter: /.*/, namespace: 'autotable-interop' }, () => ({ contents: "import table from 'jspdf-autotable'; export default table.default || table;" }));
    b.onResolve({ filter: /\?url$/ }, () => ({ path: 'worker', namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: "export default '';" }));
  } }] });
  const { generateForemanAttendancePdf, signedAttendanceRows } = await import(output.href);
  const signed = (id) => ({ workerId: id, name: `FIRMADO ${id}`, dni: `TEST-${id}`, category: 'PRUEBA', entryTime: '08:00', exitTime: '15:00', entrySignature: png, exitSignature: png });
  const rows = [signed(1), { ...signed(2), name: 'SOLO ENTRADA', exitSignature: '' }, { ...signed(3), name: 'SOLO SALIDA', entrySignature: '' }, { workerId: 4, name: 'SIN FIRMAS' }, signed(5), { ...signed(6), name: 'MARCADOR SIN IMAGEN', entrySignature: 'signed', exitSignature: 'signed' }, { ...signed(7), name: 'ESPACIOS', entrySignature: '  ' }];
  const before = structuredClone(rows);
  assert.deepEqual(signedAttendanceRows(rows).map(row => row.workerId), [1, 5]);
  assert.deepEqual(signedAttendanceRows(undefined), []);
  assert.deepEqual(signedAttendanceRows(null), []);
  await fs.mkdir(directory, { recursive: true });
  for (const status of ['draft', 'completed', 'reviewed']) {
    const day = { workDate: '2026-10-16', status, rows };
    const result = generateForemanAttendancePdf(day, 'OBRA DE PRUEBA', 'ENCARGADO DE PRUEBA');
    const bytes = result.doc.output('arraybuffer');
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 2, `${status}: only two fully signed pages`);
    for (const page of pdf.getPages()) assert(page.getWidth() > page.getHeight(), 'landscape retained');
    const file = new URL(`signed-attendance-${status}.pdf`, directory);
    await fs.writeFile(file, Buffer.from(bytes));
    const text = result.doc.internal.pages.flat().join('\n');
    assert(text.includes('FIRMADO 1') && text.includes('FIRMADO 5'));
    for (const name of ['SOLO ENTRADA', 'SOLO SALIDA', 'SIN FIRMAS', 'MARCADOR SIN IMAGEN', 'ESPACIOS']) assert(!text.includes(name), name);
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2, 'download can be reopened');
  }
  assert.equal(generateForemanAttendancePdf({ workDate: '2026-10-16', status: 'draft', rows: [signed(1)] }, 'Obra', 'Encargado').doc.getNumberOfPages(), 1);
  for (const rows of [[], [before[1]], [before[2]], [before[3]], [before[5]], undefined]) assert.throws(() => generateForemanAttendancePdf({ workDate: '2026-10-16', status: 'completed', rows }, 'Obra', 'Encargado'), /entrada y salida firmadas/);
  assert.deepEqual(rows, before, 'export never removes or changes persisted or in-progress rows');
  for (const field of ['entrySignature', 'exitSignature']) assert.throws(() => generateForemanAttendancePdf({ workDate: '2026-10-16', status: 'completed', rows: [{ ...signed(1), [field]: 'data:image/png;base64,AAAA' }] }, 'Obra', 'Encargado'), /No se pudo incorporar una firma/, 'an unreadable image cannot silently produce an unsigned page');
  console.log('PASS: signed-only attendance PDF; mixed/partial/unsigned/summary rows, all statuses, one/multiple pages, reopening, landscape and immutable input.');
} finally {
  await fs.rm(output, { force: true });
}
