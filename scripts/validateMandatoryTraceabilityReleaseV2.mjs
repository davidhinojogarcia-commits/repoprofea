import { spawn, spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const node = process.execPath;

const steps = [
  ['V2 model', npm, ['run','test:mandatory-traceability-v2']],
  ['V2 integration contract', npm, ['run','test:mandatory-traceability-integration-v2']],
  ['V2 SQL invariants', npm, ['run','test:mandatory-traceability-sql-v2']],
  ['V2 correction/versioning E2E', npm, ['run','test:mandatory-traceability-e2e-v2']],
  ['Mandatory signature anchoring regression', npm, ['run','test:mandatory-signatures']],
  ['Worker relation ordering regression', npm, ['run','test:relation-ordering']],
  ['Mandatory worker detection regression', npm, ['run','test:mandatory-worker-detection']],
  ['Global modal layering regression', npm, ['run','test:modal-layering']],
  ['Light/dark contrast regression', npm, ['run','test:theme-contrast']],
  ['Global modal stack audit', npm, ['run','test:global-modal-stack']],
  ['Global full-screen modal audit', npm, ['run','test:global-modal-audit']],
  ['Supervisor signed PDF regression', npm, ['exec','--','tsx','scripts/testSupervisorSignedPdfDownload.ts']],
  ['Mandatory worksite classification regression', npm, ['exec','--','tsx','scripts/testMandatoryWorksiteClassification.ts']],
  ['Foreman attendance period filter regression', npm, ['exec','--','tsx','scripts/testForemanAttendancePeriodFilter.ts']],
  ['TypeScript validation', npm, ['run','lint']],
  ['Production build', npm, ['run','build']],
];

for (const [label, command, args] of steps) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    console.error(`\nFAILED: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n=== Production smoke ===');
const server = spawn(node, ['dist/server.cjs'], {
  stdio: ['ignore','pipe','pipe'],
  env: { ...process.env, NODE_ENV: 'production' },
});
let logs='';
server.stdout.on('data', chunk => { logs += String(chunk); });
server.stderr.on('data', chunk => { logs += String(chunk); });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const requireOk = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.text();
};

try {
  let index='';
  for (let attempt=1; attempt<=20; attempt+=1) {
    try {
      index=await requireOk('http://127.0.0.1:3000/');
      if(index) break;
    } catch (error) {
      if (attempt===20) throw error;
      await sleep(500);
    }
  }
  if(!index) throw new Error('La página inicial está vacía.');
  const manifest=await requireOk('http://127.0.0.1:3000/manifest.webmanifest');
  const foremanManifest=await requireOk('http://127.0.0.1:3000/manifest-encargados.webmanifest');
  const foreman=await requireOk('http://127.0.0.1:3000/encargados');
  const serviceWorker=await requireOk('http://127.0.0.1:3000/service-worker.js');
  if(!manifest.includes('"name": "PROFEA"')) throw new Error('Manifest principal inesperado.');
  if(!foremanManifest.includes('"name": "PFEA Encargados"')) throw new Error('Manifest de encargados inesperado.');
  if(!foreman.trim()) throw new Error('Portal de encargados vacío.');
  if(!serviceWorker.includes('CACHE_NAME')) throw new Error('Service worker inesperado.');
  console.log('Production and foreman portal smoke tests passed.');
} catch (error) {
  console.error(logs);
  console.error(error);
  process.exitCode=1;
} finally {
  server.kill('SIGTERM');
}

if (!process.exitCode) {
  console.log('\nALL GESTIONPROFEA 1.19.0 VALIDATION STEPS PASSED.');
}
