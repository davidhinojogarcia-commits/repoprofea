import ts from 'typescript';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'tutor-serverless-'));
try{
 await fs.writeFile(path.join(temp,'package.json'),JSON.stringify({type:'module'}));
 for(const file of ['api/profea-tutor.ts','src/server/profeaTutorHandler.ts','src/server/profeaTutorAgent.ts','src/lib/profeaTutorKnowledge.ts','src/lib/prevention.ts','src/lib/operationalLog.ts']){
  const source=await fs.readFile(new URL(file,root),'utf8');
  const emitted=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const destination=path.join(temp,file.replace(/\.ts$/,'.js'));
  await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,emitted);
 }
 // Import emitted JS with plain Node ESM: no tsx, bundling or extension resolver.
 const {default:handler}=await import(pathToFileURL(path.join(temp,'api/profea-tutor.js')).href);
 let result;const headers={};const res={setHeader(k,v){headers[k]=v},status(code){result={status:code};return this},json(body){result={status:200,...result,body};return this}};
 await handler({method:'GET',headers:{},body:{}},res);assert.equal(result.status,405);assert.equal(headers.Allow,'POST');assert.equal(headers['Cache-Control'],'no-store');
 result=undefined;await handler({method:'POST',headers:{},body:{question:'Abre prevención'}},res);assert.equal(result.status,401);
 console.log('PASS Tutor serverless: emitted ESM imports with plain Node; GET 405 and no-session POST 401.');
}finally{await fs.rm(temp,{recursive:true,force:true})}
