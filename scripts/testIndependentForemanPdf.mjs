import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'esbuild';
import {PDFDocument,StandardFonts} from 'pdf-lib';
const output=new URL('./.independent-foreman-pdf.mjs',import.meta.url);
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAABGCAYAAADyxhn6AAAC/klEQVR4nO3d7XGjMBSFYWcnNaSp1JGqUkeaShPZX8wwDAKkq/up9/mVmXXWYHQ4sozJ6wUAAAAAAAAAAAAAAAAAkHnzeNKPz++/7effny+XbQAq+Gf9hPvwIgaOSV7mAUYsW3g/Pr//CHI+pgE+DhCmz74IbH408KLOwssJNR+zAHO2j4NjUQcNvJhWeGnfnEwCzBk/Bo5DPTTwIghvTeoBZsrm7y68HIu8zBqYQeKD1ebaVAPMtM1XK7xcylqHWoAZJL5o3jWwiFUQ4V2HSoBpXz934eXY1OJyJRYDRwfNu57pASaoPp6El2NTz1Lvgat+ZY7mXdfUAEc+w++3rVKQCe/ayjfwVVirhHivFd7IJ1eMmxbgiAPkyWWcmduYGyRgygG/C69HuJ9OLbOGoHe7t8dn2T88U24K3WrU1sA9W6mN3si92xd9fzBOHOBIU+fRbz79/ny9XX3kEgmLVtgr08Ctgd0zuI+Pj9bGI+GNdILFOckYe5/1xJ6DY3Yrbb+7v+Wq9P+Uonlz0yoCUYC9ad8s4PjVO68gE974vGZqw4PgaftqtbT1nT68Vqsl4Y0yQ6pCGlKNY5CygT0ayWNaTfPak4TU49gMPWHPmX1mC0S6v5Z2I0vDS/uei9iiEqIGttyZSOHdnlfr/THNK1MtpFe6A+zxZj3qgD5Oq7efJdsWdV+jyTbV1dK1IyPTMslULlrr3pFOq2eFt8L0eaUWlVBdxFopvK+XbKFrxeYlpHKqiyKjAa4wmHv2Yeb+Rmtfprq6Qn2MlLF1W56+P85+sqJFfT0KsMVZvVJ4966m1VnCS0jjCtHAWQayRCvIZ48ZpbHm8ES1Y5XJbYA127dq617xal5atKau1dGZVwKtGN4j7Ys/eq302ldx2cCWX0RYcfBY7/OKr3F1Jhfit/60x9m/Y5z0KjDkY7aIxZRZH6/lekxuqUN4AR0uHyMRXGAO9T8vekR4gXlM70pJeIG5TKbQBBdIKNI9lQEAAAAAAAAAAAAAAAAAAACU8h8Q+nI0OThj8gAAAABJRU5ErkJggg==';
try{
 globalThis.__testAutoTable=(await import('jspdf-autotable')).default.default;
 await build({stdin:{contents:"export {defaultGeneratedForemanTemplate} from './src/lib/foremanSignatureTemplate';export {buildSignedMandatoryPdf} from './src/lib/mandatoryPdfOverlay';export {generateForemanAttendancePdf,generateForemanMandatoryDocumentPdf} from './src/lib/foremanDocumentsPdf';",resolveDir:new URL('../',import.meta.url).pathname},outfile:output.pathname,bundle:true,format:'esm',platform:'node',packages:'external',define:{'import.meta.env':'{}'},plugins:[{name:'pdf-worker',setup(b){b.onResolve({filter:/^jspdf-autotable$/},()=>({path:'autotable',namespace:'mock'}));b.onResolve({filter:/\/supabase$/},()=>({path:'supabase',namespace:'mock'}));b.onResolve({filter:/\?url$/},()=>({path:'worker',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='autotable'?"export default globalThis.__testAutoTable;":args.path==='supabase'?"export const supabase={};export const getSessionUser=async()=>null;":"export default '';"}));}}]});
 globalThis.window={PDFLib:{PDFDocument}};
 globalThis.localStorage={getItem:()=>null};
 const {defaultGeneratedForemanTemplate,buildSignedMandatoryPdf,generateForemanAttendancePdf,generateForemanMandatoryDocumentPdf}=await import(output.href);
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
 for(let i=0;i<3;i++){const page=pdf.addPage([595,842]);page.drawText('Original page '+(i+1),{x:30,y:790,font});}
 const original=await pdf.save(),before=Buffer.from(original).toString('base64');
 const model={templateKey:'epis:original',enabled:true,required:true,allPages:true,x:.7,y:.1,width:.2,height:.08,pageRatio:595/842,revision:1};
 const anchors=[{workerId:7,workerName:'Worker',dni:'',order:0,page:2,resolved:true,confidence:1,nameX:30,nameY:500,rowHeight:20,signatureX:300,signatureY:500,signatureWidth:80,signatureHeight:25}];
 const snapshot=structuredClone(anchors);
 const signed=await buildSignedMandatoryPdf({documentType:'epis',originalPdfBase64:before,anchors,signatures:{'7':png},foreman:{signature:png,template:model}});
 assert.equal(Buffer.from(original).toString('base64'),before,'original bytes untouched');
 assert.deepEqual(anchors,snapshot,'worker geometry unchanged');
 const loaded=await PDFDocument.load(signed);assert.equal(loaded.getPageCount(),3);
 assert(loaded.getPages().every(p=>p.getSize().width===595&&p.getSize().height===842));
 for(const type of ['inicio','control_presencia','contrato','prorroga'])await assert.rejects(buildSignedMandatoryPdf({documentType:type,originalPdfBase64:before,anchors,signatures:{},foreman:{signature:png,template:model}}),/no admite/);
 const day={workDate:'2026-10-16',status:'completed',rows:[{workerId:7,name:'Worker',dni:'',category:'PEON',entryTime:'08:00',exitTime:'15:00',entrySignature:png,exitSignature:png}]};
 const landscape={...defaultGeneratedForemanTemplate('control_horario:institucional'),enabled:true,required:true};
 const without=generateForemanAttendancePdf(day,'Obra A','Encargado').doc.output();
 const withInk=generateForemanAttendancePdf({...day,foremanSignature:png,foremanTemplate:landscape},'Obra A','Encargado').doc.output();
 if(process.env.FOREMAN_PDF_OUTPUT_DIR){await fs.mkdir(process.env.FOREMAN_PDF_OUTPUT_DIR,{recursive:true});await fs.writeFile(process.env.FOREMAN_PDF_OUTPUT_DIR+'/attendance.pdf',Buffer.from(withInk,'binary'));await fs.writeFile(process.env.FOREMAN_PDF_OUTPUT_DIR+'/original.pdf',original);await fs.writeFile(process.env.FOREMAN_PDF_OUTPUT_DIR+'/signed.pdf',signed);}
 assert(withInk.length>without.length,'attendance contains independent signature commands');
 for(const type of ['epis','formacion','maquinaria','autorizacion_uso_maquinaria']){
  const record={id:'doc',workDate:day.workDate,periodKey:'2026-10',documentType:type,category:'',workers:[{id:7,apellidosNombre:'Worker',dni:'',categoria:'PEON'}],signatures:{'7':png},status:'completed',details:{}};
  const plain=generateForemanMandatoryDocumentPdf(record,'Obra A').doc.output();
  const ink=generateForemanMandatoryDocumentPdf({...record,details:{foremanSignature:png,foremanSignatureTemplate:{...defaultGeneratedForemanTemplate(type+':institucional'),enabled:true,required:true}}},'Obra A').doc.output();
  if(process.env.FOREMAN_PDF_OUTPUT_DIR)await fs.writeFile(process.env.FOREMAN_PDF_OUTPUT_DIR+'/'+type+'.pdf',Buffer.from(ink,'binary'));
  assert(ink.length>plain.length,type+' PDF includes separate foreman ink');
 }
 console.log('PASS: PDF originals, page count/size, independent overlay, immutable worker positions, 4 exclusions and generated EPIs/training/machinery/attendance signatures.');
}finally{await fs.rm(output,{force:true});}
