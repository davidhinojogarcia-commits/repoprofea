import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { reportOperationalError } from '../src/lib/operationalLog';

const entries: { level: string; args: unknown[] }[] = [];
const previous = { warn: console.warn, error: console.error };
const secret = 'SYNTHETIC_SECRET_NOT_FOR_LOGS';
const error = Object.assign(new Error(secret), {
  status:503, code:'PGRST116', request:{ token:secret, signature:secret },
  prompt:secret.repeat(2000), document:secret, workerName:secret,
});
const beforeBytes = Buffer.byteLength(JSON.stringify(['SYNTHETIC_OPERATION_FAILED',error]));
try {
  console.warn=(...args)=>{entries.push({level:'warn',args});};
  console.error=(...args)=>{entries.push({level:'error',args});};
  reportOperationalError('SYNTHETIC_OPERATION_FAILED',error);
  const afterBytes = Buffer.byteLength(JSON.stringify(entries[0].args));
  assert(afterBytes<500 && afterBytes<beforeBytes);
  assert(!JSON.stringify(entries).includes(secret));
  const detail=entries[0].args[1] as any;
  assert.equal(detail.status,503);assert.equal(detail.code,'PGRST116');
  assert.match(detail.correlationId,/^[0-9a-f-]{36}$/i);
  for(const code of ['PT409','42501','23505','VISIT_WRITING_RATE_LIMIT','AUTH_PROFILE_FAILED','GMAIL_REVOKE_UNCONFIRMED']) {
    reportOperationalError('SYNTHETIC_OPERATION_FAILED',{status:409,code},'warn');
    assert.equal((entries.at(-1)!.args[1] as any).code,code);
  }
  reportOperationalError('SYNTHETIC_OPERATION_FAILED',{status:999,code:secret,name:secret});
  const unknown=entries.at(-1)!.args[1] as any;
  assert.equal(unknown.status,undefined);assert.equal(unknown.code,undefined);assert.equal(unknown.errorType,'Error');
  assert.doesNotThrow(()=>reportOperationalError('SYNTHETIC_OPERATION_FAILED',{get status(){throw Error(secret);}}));
  assert.equal((entries.at(-1)!.args[1] as any).sanitizationFailed,true);
  assert.equal(entries.filter(e=>e.level==='warn').length,6,'warning severity and every invocation are preserved');
  assert.equal(entries.filter(e=>e.level==='error').length,3,'errors remain visible; no blanket suppression');
  previous.warn(`PASS synthetic diagnostic payload: ${beforeBytes}→${afterBytes} serialized bytes. Local fixture, not production traffic.`);
} finally {console.warn=previous.warn;console.error=previous.error;}

// Enforce the actual production call sites, not just the helper in isolation.
const filesIn = (directory: string): string[] => fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry =>
  entry.isDirectory() ? filesIn(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
const files=['App.tsx','server.ts',...['src','components','api'].flatMap(filesIn)].filter(p=>/\.(ts|tsx)$/.test(p));
let sanitizedCalls=0;
for(const file of files) {
  const source=fs.readFileSync(file,'utf8');
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const visit=(node:ts.Node)=>{
    if(ts.isCallExpression(node)) {
      if(ts.isIdentifier(node.expression)&&node.expression.text==='reportOperationalError') {
        assert(ts.isStringLiteral(node.arguments[0]),`${file}: diagnostic label must be static, never a document/filename`);
        sanitizedCalls++;
      }
      if(ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(ast)==='console'&&['warn','error'].includes(node.expression.name.text)) {
        assert(node.arguments.length===1&&ts.isStringLiteral(node.arguments[0]),`${file}: raw errors must use the existing sanitizer`);
      }
    }
    ts.forEachChild(node,visit);
  };visit(ast);
}
assert(sanitizedCalls>150,'application, server and module diagnostics use the shared sanitizer');
console.log(`PASS ${sanitizedCalls} production diagnostic calls: fixed labels, status/code/type/correlation, no raw payloads or provider errors.`);
