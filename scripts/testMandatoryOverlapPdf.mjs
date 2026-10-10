import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
const output=new URL('./.mandatory-overlap-pdf.mjs',import.meta.url);
try{
 await build({stdin:{contents:"export {buildSignedMandatoryPdf} from './src/lib/mandatoryPdfOverlay';",resolveDir:new URL('../',import.meta.url).pathname},outfile:output.pathname,bundle:true,format:'esm',platform:'node',packages:'external',plugins:[{name:'pdf-worker-boundary',setup(b){b.onResolve({filter:/\?url$/},()=>({path:'worker',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:"export default '';"}));}}]});
 globalThis.window={PDFLib:{PDFDocument}};
 const {buildSignedMandatoryPdf}=await import(output.href);
 const pdf=await PDFDocument.create();pdf.addPage([595,842]);
 const originalPdfBase64=Buffer.from(await pdf.save()).toString('base64');
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN6kAAAAASUVORK5CYII=';
 const anchors=[1,2].map((id)=>({workerId:id,workerName:'Persona '+id,dni:'',order:id,page:1,resolved:true,confidence:1,nameX:60,nameY:500,nameWidth:100,nameHeight:10,rowHeight:10,signatureX:350,signatureY:500,signatureWidth:70,signatureHeight:14}));
 const signed=await buildSignedMandatoryPdf({originalPdfBase64,anchors,signatures:{'1':png,'2':png}});
 const loaded=await PDFDocument.load(signed);assert.equal(loaded.getPageCount(),1);assert.deepEqual(loaded.getPage(0).getSize(),{width:595,height:842});
 const raw=Buffer.from(signed).toString('latin1');assert.equal((raw.match(/\/Subtype \/Image/g)||[]).length,2,'both signature images are embedded');
 await assert.rejects(buildSignedMandatoryPdf({originalPdfBase64,anchors:[{...anchors[0],signatureX:580}],signatures:{'1':png}}),/límites|fuera/);
 console.log('PASS: final signed PDF accepts overlapping signatures, embeds both images, preserves page dimensions and rejects out-of-page placement.');
}finally{await fs.rm(output,{force:true});}
