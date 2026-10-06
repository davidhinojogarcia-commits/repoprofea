import { build } from 'esbuild';
import fs from 'node:fs/promises';
const output = new URL('./.prevention-ui-test.mjs',import.meta.url);
let exitCode=0;
try {
  await build({entryPoints:[new URL('./testPreventionUi.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',packages:'external',define:{'import.meta.env':'{}'},outfile:output.pathname});
  await import(output.href);
} catch (error) { console.error(error); exitCode=1; }
finally { await fs.rm(output,{force:true}); }
// The browser auth client creates background channels in Node. Once all test
// resources are closed, terminate this dedicated test process deterministically.
process.exit(exitCode);
