import { jsPDF } from 'jspdf';
import { applyInstitutionalPdfStandard, getStoredPdfConfig, renderInstitutionalReportHeader } from './exportUtils';

import {
  ADDITIONAL_WORKSITE_DOCUMENTS,
  type AdditionalWorksiteContext,
  type AdditionalWorksiteDocumentType,
  type WorksiteDocumentAnswers,
  type WorksiteDocumentSignatures,
} from './worksiteAdditionalDocumentsCatalog';
export {
  ADDITIONAL_WORKSITE_DOCUMENTS,
  type AdditionalWorksiteContext,
  type AdditionalWorksiteDocumentType,
  type WorksiteDocumentAnswers,
  type WorksiteDocumentField,
  type WorksiteDocumentSignatures,
} from './worksiteAdditionalDocumentsCatalog';

const fmt=(v:string)=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:String(v||'')};
const fileSafe=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');

export function generateAdditionalWorksiteDocument(type:AdditionalWorksiteDocumentType,worker:Person|null,ctx:AdditionalWorksiteContext,answers:WorksiteDocumentAnswers={},signatures?:WorksiteDocumentSignatures){
  const def=ADDITIONAL_WORKSITE_DOCUMENTS[type]; const doc=new jsPDF({unit:'mm',format:'a4'}); const cfg=getStoredPdfConfig();
  const pw=doc.internal.pageSize.getWidth(), ph=doc.internal.pageSize.getHeight(), left=14, right=pw-14, width=right-left;
  doc.setProperties({title:def.title,author:'Diputación Provincial de Cádiz',creator:'GestionPROFEA'});
  const drawDocumentHeader = () => renderInstitutionalReportHeader(
    doc,
    def.title,
    [ctx.obra, worker?.apellidosNombre || ''].filter(Boolean).join(' · '),
    { subtitle: 'COOPERACIÓN · GESTIÓN DE FONDOS PROFEA' },
  );
  drawDocumentHeader();
  const addContinuationPage = () => {
    doc.addPage();
    drawDocumentHeader();
    return 46;
  };
  let y=46; doc.setTextColor(70); doc.setFont('helvetica','normal'); doc.setFontSize(8); const legal=doc.splitTextToSize(def.legal,width); doc.text(legal,left,y); y+=legal.length*4+5; doc.setTextColor(0);
  const rows:[string,string][]=[['Obra',ctx.obra||'________________'],['Municipio',ctx.municipio||'________________'],['Trabajador/a',worker?.apellidosNombre||'________________'],['DNI/NIE',worker?.dni||'________________'],['Categoría/Puesto',worker?.categoria||'________________'],['Nº oferta',worker?.numOferta||'________________']];
  doc.setFillColor(247,250,252); doc.setDrawColor(203,213,225); doc.roundedRect(left,y,width,24,2,2,'FD'); let ry=y+6; doc.setFontSize(8);
  for(let i=0;i<rows.length;i+=2){const a=rows[i],b=rows[i+1];doc.setFont('helvetica','bold');doc.text(`${a[0]}:`,left+4,ry);doc.setFont('helvetica','normal');doc.text(a[1],left+29,ry,{maxWidth:55});if(b){doc.setFont('helvetica','bold');doc.text(`${b[0]}:`,left+88,ry);doc.setFont('helvetica','normal');doc.text(b[1],left+113,ry,{maxWidth:53});}ry+=6;} y+=30;
  doc.setFontSize(9.3); for(const p of def.body(worker,ctx,answers)){const ls=doc.splitTextToSize(p,width); if(y+ls.length*5>ph-78){y=addContinuationPage();} doc.text(ls,left,y); y+=ls.length*5+4;}
  if(def.note){const ls=doc.splitTextToSize(def.note,width-8); if(y+ls.length*4+12>ph-76){y=addContinuationPage();} doc.setFillColor(245,247,250); doc.roundedRect(left,y,width,ls.length*4+8,2,2,'F');doc.setFontSize(8);doc.setTextColor(80);doc.text(ls,left+4,y+5);doc.setTextColor(0);y+=ls.length*4+14;}
  const signers:{label:string;name:string;image?:string}[]=[]; if(def.signatureWorker&&worker)signers.push({label:'Persona trabajadora',name:worker.apellidosNombre||worker.dni||'Trabajador/a',image:signatures?.worker}); if(def.signatureCompany){signers.push({label:'Encargado/a de obra',name:ctx.responsable||'Sin encargado configurado',image:signatures?.foreman});signers.push({label:'Supervisor/a',name:ctx.supervisor||'Supervisor/a',image:signatures?.supervisor});}
  if(signers.length){if(y>ph-64){y=addContinuationPage();} const gap=5,cellW=(width-gap*(signers.length-1))/signers.length; signers.forEach((s,i)=>{const x=left+i*(cellW+gap);const boxH=30;doc.setDrawColor(190);doc.roundedRect(x,y,cellW,boxH,2,2);doc.setFont('helvetica','bold');doc.setFontSize(7);doc.text(s.label,x+3,y+4.2,{maxWidth:cellW-6});doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.text(s.name,x+3,y+8.6,{maxWidth:cellW-6});if(s.image){try{doc.addImage(s.image,'PNG',x+4,y+10.5,cellW-8,13,undefined,'FAST')}catch{}}else{doc.text('Firma:',x+3,y+16.5);doc.line(x+16,y+17,x+cellW-4,y+17);}doc.setFontSize(6.1);doc.text(`Fecha: ${fmt(ctx.fecha)}`,x+3,y+27);});}
  applyInstitutionalPdfStandard(doc);
  const suffix=worker?`_${fileSafe(worker.apellidosNombre||worker.dni||String(worker.id))}`:'_PLANTILLA'; return {doc,filename:`${fileSafe(def.short)}${suffix}.pdf`};
}
