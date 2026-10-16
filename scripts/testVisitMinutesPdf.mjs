import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import {build} from 'esbuild';
import {content,person,png,id} from './visitMinutesFixture.mjs';
const out=new URL('./.visit-pdf.mjs',import.meta.url),directory=new URL('../tmp/pdfs/',import.meta.url);
try{
 await build({stdin:{contents:"export {generateVisitMinutesPdf} from './src/lib/visitMinutesPdf';export {newVisit} from './src/lib/visitMinutes';",resolveDir:new URL('../',import.meta.url).pathname},outfile:out.pathname,bundle:true,format:'esm',platform:'node',packages:'external'});
 const {generateVisitMinutesPdf:generate,newVisit}=await import(out.href);const now='2026-10-16T08:00:00Z';
 const state=newVisit({...content,authorEmail:'',purpose:'Seguimiento de la obra.',discussion:'Se revisaron los trabajos.',observations:'',nextVisit:'',agreements:[]},[person()],now);
 state.status='signed';state.finalizedAt=now;state.issuedAt=now;state.responses={[person().id]:{decision:'agree',comment:'',mode:'email-code',at:now}};state.signatures={[person().id]:{image:png,mode:'email-code',at:now}};
 const single=await generate(state,'AV-2026-000001');const singleDoc=await PDFDocument.load(single);assert.equal(singleDoc.getPageCount(),1,'brief signed acta fits on one page');
 const before=structuredClone(state);const annex=await PDFDocument.create();annex.addPage([600,300]);annex.addPage([300,600]);const annexBytes=await annex.save();
 const multi=structuredClone(state);multi.content.discussion=Array.from({length:100},(_,i)=>`Asunto ${i+1}: Se revisó la ejecución y se dejó constancia de los puntos tratados durante la visita. No se añaden decisiones distintas a las redactadas. Ángela Pérez revisó las cotas.`).join('\n\n');
 multi.participants=Array.from({length:20},(_,n)=>person(20+n));multi.responses=Object.fromEntries(multi.participants.map(p=>[p.id,{decision:'agree',comment:'Conforme con lo descrito.',mode:'email-code',at:now}]));multi.signatures=Object.fromEntries(multi.participants.map(p=>[p.id,{image:png,at:now,mode:'email-code'}]));
 multi.content.attachments=[{id:id(90),name:'Plano de prueba.pdf',mime:'application/pdf',caption:'Anexo con dos orientaciones.',base64:Buffer.from(annexBytes).toString('base64')},{id:id(91),name:'Imagen de prueba.png',mime:'image/png',caption:'Imagen sintética, sin datos personales.',base64:png.split(',')[1]}];
 const original=structuredClone(multi);const bytes=await generate(multi,'AV-2026-000002'),loaded=await PDFDocument.load(bytes);assert(loaded.getPageCount()>5);assert.deepEqual(loaded.getPage(loaded.getPageCount()-2).getSize(),{width:600,height:300});assert.deepEqual(loaded.getPage(loaded.getPageCount()-1).getSize(),{width:300,height:600});
 assert.deepEqual(multi,original,'renderer never changes approved content, annex bytes or signatures');assert.deepEqual(state,before);
 assert.equal((await PDFDocument.load(annexBytes)).getPageCount(),2,'source annex remains readable and intact');
 await fs.mkdir(directory,{recursive:true});await fs.writeFile(new URL('visit-single.pdf',directory),single);await fs.writeFile(new URL('visit-multi.pdf',directory),bytes);
 const config=JSON.parse(await fs.readFile(new URL('../vercel.json',import.meta.url),'utf8'));assert(config.rewrites.some(r=>r.source==='/api/visit-minutes'&&r.destination==='/api/gmail?action=visit-minutes'),'production route uses the tested gateway');
 assert.equal((await fs.readdir(new URL('../api/',import.meta.url))).filter(p=>p==='visit-minutes.ts').length,0,'no additional serverless entrypoint');
 console.log(`PASS: one-page signed acta, ${loaded.getPageCount()}-page long acta, twenty signatures, photographic/PDF annexes, portrait/landscape dimensions, immutable input and function-budget routing.`);
}finally{await fs.rm(out,{force:true});}
