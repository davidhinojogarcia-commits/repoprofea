import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { writingInput, writingProposal } from '../src/lib/visitWriting';

const tokenFile = process.env.VISIT_WRITING_TEST_TOKEN_FILE;
const worksiteId = process.env.VISIT_WRITING_TEST_WORKSITE_ID;
if (!tokenFile || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(worksiteId || '')) {
  throw new Error('Indica VISIT_WRITING_TEST_TOKEN_FILE (archivo privado con una sesión autorizada) y VISIT_WRITING_TEST_WORKSITE_ID (obra propia). No pases claves ni tokens como argumentos.');
}
const token = (await readFile(tokenFile, 'utf8')).trim();
assert(token, 'El archivo de sesión está vacío.');
const origin = new URL(process.env.VISIT_WRITING_TEST_ORIGIN || 'https://gestionprofea.vercel.app');
assert(origin.protocol === 'https:' && !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash, 'Usa un origen HTTPS sin credenciales ni parámetros.');
const endpoint = new URL('/api/visit-minutes', origin);
async function request(body: Record<string, unknown>, authenticated = false) {
  const response = await fetch(endpoint, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(40000),
    headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ clientVersion: '3.1', ...body })
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}
const status = await request({ action: 'writing-status' });
assert.equal(status.response.status, 200, 'No se pudo consultar el estado.');
assert.deepEqual(Object.keys(status.data?.writing || {}).sort(), ['configured', 'model', 'providerConfigured']);
assert.equal(status.data.writing.configured, true, 'El runtime no encuentra una credencial no vacía.');
assert.equal(status.data.writing.providerConfigured, true);
assert.match(status.response.headers.get('cache-control') || '', /no-store/);
const written = writingInput({ mode: 'written', title: 'Arqueta', text: 'No ejecutar. Pendiente de comprobar 1,50 m.' });
const denied = await request({ action: 'assist-writing', worksiteId, ...written });
assert.equal(denied.response.status, 401, 'La generación sin sesión debe rechazarse.');
for (const input of [written, writingInput({ mode: 'dictated', title: '', text: 'Arqueta: no ejecutar. Pendiente de comprobar 1,50 m. Pavimento: se propone revisar el acabado.' })]) {
  const result = await request({ action: 'assist-writing', worksiteId, ...input }, true);
  assert.equal(result.response.status, 200, `Generación ${input.mode}: HTTP ${result.response.status}; código ${String(result.data?.code || 'sin código').replace(/[^A-Z0-9_]/g, '').slice(0,80)}.`);
  assert.equal(result.data?.ok, true);
  const proposal = writingProposal(result.data.proposal, input);
  console.log(`PASS generación real ${input.mode}: ${proposal.points.length} asunto(s), esquema/cifras/reservas conservados. Revisión semántica humana pendiente.`);
}
console.log('PASS estado y autenticación. Sin crear ni guardar actas, enviar correos o generar PDF. Se han solicitado dos propuestas reales al proveedor.');
