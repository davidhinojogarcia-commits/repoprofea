import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

const output = new URL('./.idle-gmail-scan-test.mjs', import.meta.url);
let messages = [];
let reads = [];
globalThis.__idleMailTest = {
  scan: async () => messages,
  read: async table => { reads.push(table); return []; },
};
try {
  await build({
    stdin: {
      contents: "export {processAdministrativeMandatoryInbox} from './src/lib/mandatoryEmailIntake';",
      resolveDir: new URL('../', import.meta.url).pathname,
    },
    outfile: output.pathname,
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    plugins: [{
      name: 'idle-mail-boundaries',
      setup(b) {
        b.onResolve({ filter: /clientDocumentText$|gmailConnection$|appSettingsService$|databaseService$|foremanPortalService$|mandatoryPdfOverlay$/ },
          a => ({ path: a.path, namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: path.endsWith('appSettingsService')
            ? "export const loadAppBusinessSettings=async()=>({administrative:{email:'admin@example.invalid'}});"
            : path.endsWith('gmailConnection')
            ? "export const getGmailConnectionStatus=async()=>({connected:true,canRead:true});export const scanAdministrativeGmail=globalThis.__idleMailTest.scan;export const base64UrlAttachmentToFile=()=>{throw Error('Synthetic attachment stops before PDF parsing');};"
            : path.endsWith('databaseService')
            ? "export const getDocuments=globalThis.__idleMailTest.read;"
            : path.endsWith('foremanPortalService')
            ? "export const prepareMandatoryDocumentFromEmail=async()=>{throw Error('unexpected import')};export const restoreForemanMandatoryGmailSource=async()=>{};"
            : path.endsWith('clientDocumentText')
            ? "export const extractClientDocumentText=async()=>({text:''});"
            : "export const analyzeEmploymentOriginalPdf=async()=>({});export const analyzeMandatoryOriginalPdf=async()=>({});export const resolveMandatoryAnchorsWithOcrRows=async()=>({});export const fileToBase64=async()=>'';export const sha256Hex=async()=>'';",
        }));
      },
    }],
  });
  const { processAdministrativeMandatoryInbox } = await import(output.href);
  const run = async (existingSourceKeys = new Set()) =>
    processAdministrativeMandatoryInbox({ existingSourceKeys });

  let result = await run();
  assert.equal(result.scannedMessages, 0);
  assert.equal(result.importedDocuments, 0);
  assert.deepEqual(reads, [], 'empty inbox must not read workers or worksites');

  messages = [{ id: 'mail-1', attachments: [
    { filename: 'already-imported.pdf', mimeType: 'application/pdf' },
    { filename: 'notes.txt', mimeType: 'text/plain' },
  ] }];
  result = await run(new Set(['mail-1|already-imported.pdf']));
  assert.equal(result.scannedMessages, 1);
  assert.equal(result.skippedAttachments, 1, 'non-PDF attachments are still counted');
  assert.deepEqual(reads, [], 'already imported PDFs must not trigger directory requests');

  messages = [{ id: 'mail-2', attachments: [
    { filename: 'new.pdf', mimeType: 'application/pdf' },
  ] }];
  result = await run();
  assert.deepEqual(reads, ['trabajadores', 'obras'], 'new PDFs still load directory and worksite data');
  assert.equal(result.scannedMessages, 1);
  assert.equal(result.importedDocuments, 0);
  assert.equal(result.warnings.length, 1, 'synthetic invalid PDF still reports a warning');
  console.log('PASS: idle Gmail scans skip two REST reads; new attachments retain processing.');
} finally {
  delete globalThis.__idleMailTest;
  await rm(output, { force: true });
}
