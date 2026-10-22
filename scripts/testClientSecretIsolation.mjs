import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const fixture = await mkdtemp(path.join(tmpdir(), 'profea-client-secrets-'));
const names = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'];
const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
const markers = names.map((name, index) => `synthetic-private-marker-${index}-must-not-reach-browser`);
try {
  names.forEach((name, index) => { process.env[name] = markers[index]; });
  await writeFile(path.join(fixture, 'index.html'), '<script type="module" src="/entry.js"></script>');
  await writeFile(path.join(fixture, 'entry.js'), 'window.clientKeyProbe = [process.env.API_KEY, process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY, process.env.GOOGLE_GENERATIVE_AI_API_KEY];');
  const result = await build({ configFile, root: fixture, logLevel: 'silent', build: { write: false, minify: false } });
  const bundles = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output || []);
  const browserCode = bundles.filter(part => part.type === 'chunk').map(part => part.code).join('\n');
  assert(browserCode.length > 0, 'real production browser bundle must be generated');
  for (const marker of markers) assert(!browserCode.includes(marker), 'server credential must never be embedded in the browser bundle');
  console.log('PASS client secret isolation: production Vite build with synthetic server credentials does not embed their values. No real credentials or provider requests.');
} finally {
  for (const name of names) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
  await rm(fixture, { recursive: true, force: true });
}
