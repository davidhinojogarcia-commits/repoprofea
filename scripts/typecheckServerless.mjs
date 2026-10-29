import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const configPath = ts.findConfigFile(path.join(root, 'api'), ts.sys.fileExists);
assert.equal(configPath, path.join(root, 'api/tsconfig.json'), 'Functions must resolve their isolated TypeScript config');
const raw = ts.readConfigFile(configPath, ts.sys.readFile);
if (raw.error) throw new Error(ts.flattenDiagnosticMessageText(raw.error.messageText, '\n'));
const config = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(configPath), {}, configPath);
assert.equal(config.errors.length, 0, 'Serverless TypeScript config must be valid');
assert.ok(config.fileNames.length > 0, 'No empty function typecheck');
assert.ok(!config.fileNames.some(file => file.startsWith(path.join(root, 'scripts') + path.sep)), 'Test mocks cannot enter the serverless type scope');

// Match @vercel/node's incremental language service, rather than only tsc's
// batch checker. With the broad application config, JS test assignments to
// globalThis.fetch can replace the native fetch type in this service.
const versions = new Map(config.fileNames.map(file => [file, '1']));
const host = {
  getScriptFileNames: () => [...versions.keys()],
  getScriptVersion: file => versions.get(file) || '',
  getScriptSnapshot(file) {
    const content = ts.sys.readFile(file);
    if (content === undefined) return undefined;
    versions.set(file, '1');
    return ts.ScriptSnapshot.fromString(content);
  },
  getCurrentDirectory: () => root,
  getCompilationSettings: () => config.options,
  getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  fileExists: ts.sys.fileExists,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
  useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  getNewLine: () => ts.sys.newLine,
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry(ts.sys.useCaseSensitiveFileNames, root));
try {
  const program = service.getProgram();
  assert.ok(program);
  assert.ok(!program.getSourceFiles().some(file => file.fileName.startsWith(path.join(root, 'scripts') + path.sep)), 'Imported test mocks cannot pollute production globals');
  const production = program.getSourceFiles().filter(file => !file.isDeclarationFile && file.fileName.startsWith(root) && !file.fileName.includes('/node_modules/'));
  const diagnostics = [
    ...service.getCompilerOptionsDiagnostics(),
    ...production.flatMap(file => [...service.getSyntacticDiagnostics(file.fileName), ...service.getSemanticDiagnostics(file.fileName)]),
  ];
  if (diagnostics.length) {
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: file => file,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }));
    process.exitCode = 1;
  } else {
    console.log(`PASS serverless TypeScript: ${config.fileNames.length} roots, ${production.length} production modules; Vercel-style incremental checks, native fetch signatures, no test mocks.`);
  }
} finally {
  service.dispose();
}
