import { jsPDF } from 'jspdf';
import type { Person } from '../../types';
import { applyInstitutionalPdfStandard, getStoredPdfConfig, renderInstitutionalReportHeader } from './exportUtils';

export type AdditionalWorksiteDocumentType =
  | 'baja_voluntaria'
  | 'ausencia_trabajador'
  | 'permiso_lactancia'
  | 'parte_asistencia_fremap'
  | 'comunicacion_accidente'
  | 'certificado_trabajando_actualmente'
  | 'certificado_servicios_prestados';

export type AdditionalWorksiteContext = {
  obra: string; municipio?: string; empresa: string; cif: string; fecha: string;
  responsable?: string; supervisor?: string;
};
export type WorksiteDocumentSignatures = { worker?: string; foreman?: string; supervisor?: string };
export type WorksiteDocumentAnswers = Record<string, string>;
export type WorksiteDocumentField = { key: string; label: string; type?: 'text'|'date'|'time'|'textarea'|'select'; required?: boolean; options?: string[]; placeholder?: string };

type Definition = {
  title: string; short: string; legal: string; fields: WorksiteDocumentField[];
  body: (worker: Person | null, ctx: AdditionalWorksiteContext, a: WorksiteDocumentAnswers) => string[];
  signatureWorker?: boolean; signatureCompany?: boolean; note?: string;
};

const val=(a:WorksiteDocumentAnswers,k:string,fallback='____________________________')=>String(a[k]||'').trim()||fallback;
export const ADDITIONAL_WORKSITE_DOCUMENTS: Record<AdditionalWorksiteDocumentType, Definition> = {
  baja_voluntaria:{title:'BAJA VOLUNTARIA DE LA PERSONA TRABAJADORA',short:'Baja voluntaria',legal:'Referencia: art. 49.1.d) del Real Decreto Legislativo 2/2015, texto refundido de la Ley del Estatuto de los Trabajadores, sin perjuicio del preaviso aplicable por convenio colectivo o costumbre del lugar.',fields:[{key:'fechaEfectos',label:'Fecha de efectos de la baja',type:'date',required:true},{key:'observaciones',label:'Observaciones',type:'textarea'}],body:(w,c,a)=>[
    `La persona trabajadora ${w?.apellidosNombre||'________________'}, con DNI/NIE ${w?.dni||'________________'}, comunica de forma libre, expresa e inequívoca su decisión de causar baja voluntaria en la relación laboral que mantiene con ${c.empresa}, vinculada a la obra ${c.obra}.`,
    `La fecha de efectos comunicada es ${val(a,'fechaEfectos')}. ${a.observaciones?`Observaciones: ${a.observaciones}`:''}`,
    'La firma acredita la comunicación de la voluntad de baja y su recepción, sin implicar renuncia a derechos indisponibles que legalmente correspondan.'
  ],signatureWorker:true,signatureCompany:true},
  ausencia_trabajador:{title:'COMUNICACIÓN / JUSTIFICACIÓN DE AUSENCIA',short:'Ausencia del trabajador',legal:'Referencia general: arts. 20 y 37 del Estatuto de los Trabajadores y, en su caso, convenio colectivo, instrucciones internas y régimen de permisos aplicable.',fields:[{key:'fechaInicio',label:'Inicio de la ausencia',type:'date',required:true},{key:'fechaFin',label:'Fin de la ausencia',type:'date',required:true},{key:'motivo',label:'Motivo comunicado',type:'textarea',required:true},{key:'justificante',label:'Documentación justificativa aportada',type:'textarea'},{key:'observaciones',label:'Observaciones',type:'textarea'}],body:(w,c,a)=>[
    `Se deja constancia de la ausencia de ${w?.apellidosNombre||'________________'}, DNI/NIE ${w?.dni||'________________'}, adscrito/a a la obra ${c.obra}, desde ${val(a,'fechaInicio')} hasta ${val(a,'fechaFin')}.`,
    `Motivo comunicado: ${val(a,'motivo')}.`, `Documentación justificativa: ${val(a,'justificante','No indicada')}.`,
    `Observaciones: ${val(a,'observaciones','Sin observaciones adicionales')}.`,
    'La consideración de la ausencia como justificada, retribuida o no retribuida dependerá de la normativa, convenio y documentación acreditativa aplicables.'
  ],signatureWorker:true,signatureCompany:true},
  permiso_lactancia:{title:'SOLICITUD / COMUNICACIÓN DE PERMISO PARA EL CUIDADO DEL LACTANTE',short:'Permiso de lactancia',legal:'Referencia: art. 37.4 del Estatuto de los Trabajadores (Real Decreto Legislativo 2/2015), en la redacción vigente, y convenio colectivo aplicable.',fields:[{key:'modalidad',label:'Modalidad solicitada',type:'select',required:true,options:['Una hora de ausencia','Dos fracciones','Reducción de jornada','Acumulación en jornadas completas']},{key:'fechaInicio',label:'Fecha prevista de inicio',type:'date',required:true},{key:'fechaFin',label:'Fecha prevista de finalización',type:'date',required:true},{key:'horario',label:'Horario o distribución propuesta',type:'textarea',required:true},{key:'observaciones',label:'Observaciones',type:'textarea'}],body:(w,c,a)=>[
    `${w?.apellidosNombre||'________________'}, con DNI/NIE ${w?.dni||'________________'}, solicita/comunica el ejercicio del derecho para el cuidado del lactante en relación con su puesto en la obra ${c.obra}.`,
    `Modalidad: ${val(a,'modalidad')}. Periodo previsto: ${val(a,'fechaInicio')} a ${val(a,'fechaFin')}.`,
    `Horario o distribución propuesta: ${val(a,'horario')}.`, `Observaciones: ${val(a,'observaciones','Sin observaciones adicionales')}.`,
    'La concreción y disfrute se ajustarán a la normativa vigente, convenio colectivo aplicable y reglas de preaviso y coordinación organizativa que correspondan.'
  ],signatureWorker:true,signatureCompany:true},
  parte_asistencia_fremap:{title:'PARTE INTERNO DE DERIVACIÓN / ASISTENCIA A FREMAP',short:'Asistencia FREMAP',legal:'Documento interno de acompañamiento. No sustituye los partes médicos ni los modelos oficiales de accidente de trabajo o baja/alta que deban emitir la mutua, servicio sanitario o sistema oficial correspondiente.',fields:[{key:'fechaHecho',label:'Fecha del hecho / inicio de síntomas',type:'date',required:true},{key:'horaHecho',label:'Hora',type:'time',required:true},{key:'descripcion',label:'Descripción de lo ocurrido / síntomas',type:'textarea',required:true},{key:'lugar',label:'Lugar exacto',required:true},{key:'autoriza',label:'Persona que autoriza/comunica la asistencia',required:true},{key:'observaciones',label:'Observaciones',type:'textarea'}],body:(w,c,a)=>[
    `Se remite a ${w?.apellidosNombre||'________________'}, DNI/NIE ${w?.dni||'________________'}, trabajador/a de ${c.empresa}, adscrito/a a la obra ${c.obra}, para valoración/asistencia por FREMAP.`,
    `Fecha y hora: ${val(a,'fechaHecho')} ${val(a,'horaHecho')}. Lugar: ${val(a,'lugar')}.`,
    `Descripción / síntomas: ${val(a,'descripcion')}.`, `Autoriza/comunica: ${val(a,'autoriza')}.`, `Observaciones: ${val(a,'observaciones','Sin observaciones adicionales')}.`
  ],signatureWorker:true,signatureCompany:true,note:'Adjuntar, cuando proceda, la documentación oficial emitida por FREMAP y tramitar las comunicaciones obligatorias por los canales establecidos.'},
  comunicacion_accidente:{title:'PARTE DE COMUNICACIÓN INTERNA DE ACCIDENTE LABORAL',short:'Comunicación interna accidente',legal:'Referencias: Ley 31/1995 de Prevención de Riesgos Laborales, especialmente arts. 16, 23 y 24, y normativa vigente sobre notificación oficial de accidentes de trabajo. Este parte interno no sustituye la notificación oficial cuando resulte obligatoria.',fields:[{key:'fechaAccidente',label:'Fecha del accidente',type:'date',required:true},{key:'horaAccidente',label:'Hora del accidente',type:'time',required:true},{key:'lugar',label:'Lugar exacto',required:true},{key:'tarea',label:'Tarea que realizaba',type:'textarea',required:true},{key:'descripcion',label:'Descripción de los hechos',type:'textarea',required:true},{key:'lesiones',label:'Lesiones aparentes / zona afectada',type:'textarea',required:true},{key:'testigos',label:'Testigos',type:'textarea'},{key:'medidas',label:'Medidas inmediatas adoptadas',type:'textarea',required:true},{key:'comunicadoA',label:'Comunicación realizada a',type:'textarea',required:true},{key:'asistencia',label:'Asistencia sanitaria / mutua',type:'textarea'},{key:'observaciones',label:'Observaciones adicionales',type:'textarea'}],body:(w,c,a)=>[
    `Trabajador/a: ${w?.apellidosNombre||'________________'} · DNI/NIE: ${w?.dni||'________________'} · Puesto: ${w?.categoria||'________________'} · Obra: ${c.obra}.`,
    `Fecha y hora del accidente: ${val(a,'fechaAccidente')} ${val(a,'horaAccidente')}. Lugar exacto: ${val(a,'lugar')}.`,
    `Tarea que realizaba: ${val(a,'tarea')}.`, `Descripción de los hechos: ${val(a,'descripcion')}.`,
    `Lesiones aparentes / zona afectada: ${val(a,'lesiones')}.`, `Testigos: ${val(a,'testigos','No indicados')}.`,
    `Medidas inmediatas adoptadas: ${val(a,'medidas')}.`, `Comunicación realizada a: ${val(a,'comunicadoA')}.`,
    `Asistencia sanitaria / mutua: ${val(a,'asistencia','No indicada')}.`, `Observaciones: ${val(a,'observaciones','Sin observaciones adicionales')}.`
  ],signatureWorker:true,signatureCompany:true},
  certificado_trabajando_actualmente:{title:'CERTIFICADO DE PRESTACIÓN DE SERVICIOS ACTUAL',short:'Certificado trabajando actualmente',legal:'Certificación administrativa/laboral emitida a solicitud de la persona interesada, con los datos obrantes en GestionPROFEA. Debe ser validada y firmada por órgano o persona competente antes de su uso oficial.',fields:[{key:'destino',label:'Destino / finalidad del certificado',type:'textarea'},{key:'observaciones',label:'Observaciones',type:'textarea'}],body:(w,c,a)=>[
    `D./D.ª ${c.supervisor||'________________'}, en calidad de supervisor/a de ${c.empresa}, CERTIFICA:`,
    `Que ${w?.apellidosNombre||'________________'}, con DNI/NIE ${w?.dni||'________________'}, figura prestando servicios actualmente en la obra ${c.obra}, con la categoría/puesto de ${w?.categoria||'________________'}, desde ${w?.periodoInicio||'________________'} y con fecha prevista de finalización ${w?.periodoFin||'________________'}, según los datos disponibles en la aplicación.`,
    `Finalidad/destino: ${val(a,'destino','A los efectos oportunos')}.`, `Observaciones: ${val(a,'observaciones','Sin observaciones adicionales')}.`
  ],signatureCompany:true},
  certificado_servicios_prestados:{title:'CERTIFICADO DE SERVICIOS PRESTADOS',short:'Certificado de haber trabajado',legal:'Certificación emitida a partir de los datos de contratación disponibles. Para efectos administrativos oficiales deberá ser revisada y firmada por el órgano o unidad competente.',fields:[{key:'destino',label:'Destino / finalidad del certificado',type:'textarea'},{key:'observaciones',label:'Observaciones',type:'textarea'}],body:(w,c,a)=>[
    `D./D.ª ${c.supervisor||'________________'}, en calidad de supervisor/a de ${c.empresa}, CERTIFICA:`,
    `Que ${w?.apellidosNombre||'________________'}, con DNI/NIE ${w?.dni||'________________'}, ha prestado servicios en la obra ${c.obra||w?.obra||'________________'}, con categoría/puesto ${w?.categoria||'________________'}, durante el periodo comprendido entre ${w?.periodoInicio||'________________'} y ${w?.periodoFin||'________________'}, según los registros disponibles.`,
    `Finalidad/destino: ${val(a,'destino','A los efectos oportunos')}.`, `Observaciones: ${val(a,'observaciones','Sin observaciones adicionales')}.`
  ],signatureCompany:true}
};

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
