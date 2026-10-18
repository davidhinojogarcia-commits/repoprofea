import { ORDERS_NOTICE, ORDER_NATURE_LABELS, ORDER_STATUS_LABELS } from './visitWorkOrders.js';
import { jsPDF } from 'jspdf';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { OFFICIAL_LOGO_BASE64 } from '../assets/logoData.js';
import { VISIT_NOTICE, madridTimestamp, personName, type VisitState } from './visitMinutes.js';

// Pure renderer: no localStorage, account caches, network calls or current-time
// labels. The stored snapshot alone determines the document's visible content.
export async function generateVisitMinutesPdf(state: VisitState, number: string): Promise<Uint8Array> {
  const c = state.content;
  const doc = new jsPDF({
    compress: true,
    unit: 'mm',
    format: 'a4'
  });
  doc.setCreationDate(new Date(state.createdAt));
  // A deterministic PDF identifier, not the cryptographic integrity evidence.
  const fileSeed=Array.from(number+state.version+state.createdAt).reduce((h,ch)=>Math.imul(h^ch.charCodeAt(0),16777619)>>>0,2166136261).toString(16).padStart(8,'0');
  doc.setFileId(fileSeed.repeat(4));
  const blue = '#00548E',
    ink = '#243447';
  let y = 47;
  const heading = () => {
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, 210, 297, 'F');
    const logo = doc.getImageProperties(OFFICIAL_LOGO_BASE64);
    doc.addImage(OFFICIAL_LOGO_BASE64, 'PNG', 144, 12, 48, 48 * logo.height / logo.width);
    doc.setTextColor(blue);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('DIPUTACIÓN PROVINCIAL DE CÁDIZ', 18, 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('GESTIÓN DE FONDOS PROFEA', 18, 21);
    doc.setFillColor(blue);
    doc.rect(0, 31, 210, 11, 'F');
    doc.setTextColor('#FFFFFF');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('ACTA DE VISITA DE OBRA', 18, 38);
    if(c.workflow==='3.1'&&state.status!=='signed'){
      doc.setFontSize(8);doc.setTextColor('#9A3412');doc.text('BORRADOR — PENDIENTE DE REVISIÓN Y FIRMA',18,46);
    }
    y = 49;
  };
  const room = (height: number) => {
    if (y + height > 270) {
      doc.addPage();
      heading();
    }
  };
  const paragraph = (value: string, size = 9, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(String(value || 'No indicado').replace(/\t/g, '    '), 174);
    for (const line of lines) {
      room(5);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(ink);
      doc.text(line, 18, y);
      y += 4.2;
    }
    y += 1;
  };
  const section = (title: string, minimum = 18) => {
    room(minimum);
    y += 3;
    doc.setFillColor('#EAF3FA');
    doc.rect(18, y - 4, 174, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(blue);
    doc.text(title, 21, y + 1);
    y += 8;
  };
  let sectionNumber=0;
  const mainSection=(title:string,minimum=18)=>section(`${++sectionNumber}. ${title}`,minimum);
  heading();
  paragraph(`${number} · Versión ${state.version} · ${state.status === 'signed' ? 'FIRMADA' : state.status === 'cancelled' ? 'ANULADA' : 'BORRADOR / EN TRAMITACIÓN'}`, 10, true);
  paragraph(`Obra: ${c.worksite}\nCódigo: ${c.code || '-'}\nEmplazamiento: ${c.location || '-'}\nMunicipio: ${c.municipality || '-'}\nPromotor: ${c.promoter || '-'}`);
  paragraph(`Visita: ${c.date} · ${c.start}${c.end ? ' - ' + c.end : ''} (Europe/Madrid)\nRedacción: ${madridTimestamp(state.createdAt)}${state.issuedAt ? '\nEmisión para revisión: ' + madridTimestamp(state.issuedAt) : ''}${state.finalizedAt ? '\nFinalización: ' + madridTimestamp(state.finalizedAt) : ''}`);
  paragraph(`Redacta: ${c.author} · ${c.authorRole}${c.authorEmail ? '\n' + c.authorEmail : ''}${c.authorPhone ? ' · ' + c.authorPhone : ''}`);
  mainSection('Participantes');
  for (const p of state.participants) paragraph(`${personName(p)} · ${p.role}${p.entity ? ' · ' + p.entity : ''}\n${p.attended ? 'Asistente presencial' : p.reviewRequired?'Participante remoto':'Destinatario del documento'} · ${p.reviewRequired ? 'Revisa' : 'Sin revisión requerida'} · ${p.modality==='in-person'?'Presencial':p.modality==='remote'?'Remota':p.modality==='none'?'Sin firma: '+p.noSignatureReason:'Modalidad registrada en evidencias'} · ${p.signing === 'required' ? 'Firma obligatoria' : p.signing === 'optional' ? 'Firma opcional' : 'No firma'}`, 8.5);
  if(c.purpose){mainSection('Objeto histórico de la visita');paragraph(c.purpose);}
  mainSection('Contenido de la visita');
  if(c.points)for(const [i,p] of c.points.entries()){
    paragraph(`Punto ${i+1}${p.title?'. '+p.title:''}`,9,true);paragraph(p.description);
    if(p.attachmentIds.length)paragraph('Anexos: '+p.attachmentIds.map(id=>c.attachments.find(a=>a.id===id)?.name||id).join(', '),8);
  }else paragraph(c.discussion);
  if(c.orders!==undefined){
  mainSection('ÓRDENES E INSTRUCCIONES DE OBRA');
  if (!c.orders?.length) paragraph('Sin órdenes nuevas registradas.');
  for(const o of c.orders||[]) {
    room(70);
    paragraph(`Orden ${o.number} · ${o.type==='order'?'Orden':o.type==='technical_instruction'?'Instrucción técnica':'Recomendación'} · ${ORDER_NATURE_LABELS[o.nature]} · Prioridad: ${o.priority==='urgent'?'Urgente':o.priority==='high'?'Alta':'Normal'}`,9,true);
    paragraph(`Identificador: ${o.id}\nEmite: ${o.issuerName} · ${o.issuerRole} · ${o.issuerEntity}\nDestinatario / responsable: ${o.recipient||'No asignado'}\nZona: ${o.location||'No indicada'}\nEmisión: ${o.issuedDate} · Plazo: ${o.deadline||'Sin plazo'}`,8);
    paragraph(o.description);
    paragraph(`Estado al emitir esta versión: Comunicada. El seguimiento posterior es independiente.\nObservaciones: ${o.observations||'Sin observaciones'}\nReferencia oficial: ${o.officialReference||'No indicada'}\nAutorización competente: ${o.authorizationReference||'No indicada'}${o.correctionReason?'\nCorrección justificada: '+o.correctionReason:''}\nAnexos asociados: ${o.attachmentIds.map(id=>c.attachments.find(a=>a.id===id)?.name||id).join(', ')||'Ninguno'}`,8);
  }
  if(c.orderReferences?.length){section('Órdenes de visitas anteriores');for(const r of c.orderReferences)paragraph(`${r.originNumber} · Orden ${r.number} · ${r.id}\n${r.description}\nEstado observado: ${ORDER_STATUS_LABELS[r.status]} · Revisión ${r.revision} · ${madridTimestamp(r.recordedAt)}`,8);}
  }
  if(c.agreements.length){section('Actuaciones complementarias / históricas');c.agreements.forEach((a,i)=>{paragraph(`${i+1}. ${a.text}`,9,true);paragraph(`Responsable: ${a.responsible||'No asignado'} · Plazo: ${a.deadline||'No establecido'}${a.source?'\nProcedencia: '+a.source:''}`,8);});}
  if(c.observations){mainSection('Anotaciones históricas');paragraph(c.observations);}
  if (c.nextVisit) paragraph(`Próxima visita: ${c.nextVisit}`);
  if(state.reviewClosure){section('Tratamiento de observaciones y discrepancias');paragraph(state.reviewClosure.note);}
  mainSection('Revisión del contenido y firmas', 70);
  for (const p of state.participants.filter(p => p.reviewRequired || p.signing !== 'none')) {
    const r = state.responses[p.id],
      s = state.signatures[p.id];
    room(s ? 47 : 28);
    paragraph(`${personName(p)} · ${p.role}`, 9, true);
    paragraph(r ? `${r.decision === 'agree' ? 'Conforme' : r.decision === 'changes' ? 'Solicita cambios' : 'Disconforme'} · ${madridTimestamp(r.at)} · ${r.mode === 'email-code' ? 'Verificación por correo' : 'Presencial, identificado por supervisor'}${r.comment ? '\nReservas / comentario: ' + r.comment : ''}` : 'Conformidad pendiente', 8);
    if (s) {
      room(36);
      paragraph(`Firma de ${personName(p)} · ${s.intent==='reservations'?'Con reservas':s.intent==='knowledge'?'Simple conocimiento':'Conformidad con el contenido'}${s.note?'\n'+s.note:''}`, 8, true);
      const image = doc.getImageProperties(s.image);
      const ratio = image.width / image.height;
      const w = Math.min(70, 20 * ratio),
        h = w / ratio;
      doc.addImage(s.image, 'PNG', 20, y, w, h, undefined, 'FAST');
      y += Math.max(h, 14) + 3;
      paragraph(`Firma: ${madridTimestamp(s.at)} · ${s.mode === 'email-code' ? 'Acceso verificado por código de correo' : 'Captura presencial en dispositivo del supervisor'}`, 7);
    } else if (p.signing !== 'none') paragraph(p.signing === 'optional' ? 'Firma opcional no aportada.' : 'Firma pendiente.', 8);
  }
  if (state.cancelledReason) {
    section('Anulación');
    paragraph(state.cancelledReason);
  }
  mainSection('Anexos');
  if (!c.attachments.length) paragraph('Sin anexos.');
  for (const [i, a] of c.attachments.entries()) paragraph(`${i + 1}. ${a.name}${a.caption ? ' · ' + a.caption : ''}`, 8);
  paragraph(VISIT_NOTICE, 7);
  if(c.orders!==undefined)paragraph(ORDERS_NOTICE,7);
  for (const a of c.attachments.filter(a => a.mime !== 'application/pdf')) {
    doc.addPage();
    heading();
    section(a.name);
    if (a.caption) paragraph(a.caption, 8);
    const src = `data:${a.mime};base64,${a.base64}`,
      properties = doc.getImageProperties(src),
      ratio = properties.width / properties.height;
    const width = Math.min(174, (260 - y) * ratio),
      height = width / ratio;
    if (!(width > 0 && height > 0)) throw new Error('No se pudo maquetar una fotografía del acta.');
    doc.addImage(src, a.mime === 'image/png' ? 'PNG' : 'JPEG', 18, y, width, height, undefined, 'FAST');
  }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(blue);
    doc.line(18, 276, 192, 276);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.7);
    doc.setTextColor(ink);
    doc.text(`${number} · v${state.version} · Cuerpo ${page}/${pages}`, 192, 282, {
      align: 'right'
    });
    doc.text(`© ${c.date.slice(0, 4)} David Hinojo García · GestionProfea`, 18, 282);
  }
  doc.setProperties({
    title: `Acta ${number} v${state.version}`,
    author: c.author,
    subject: c.worksite,
    creator: 'GestionProfea'
  });
  const result = await PDFDocument.load(doc.output('arraybuffer'),{updateMetadata:false});
  for (const a of c.attachments.filter(a => a.mime === 'application/pdf')) {
    const original=Uint8Array.from(atob(a.base64),c=>c.charCodeAt(0));
    const annex = await PDFDocument.load(original,{updateMetadata:false});
    if (annex.getPageCount() > 30) throw new Error('Un anexo supera treinta páginas.');
    if(c.workflow==='3.1'&&(annex.catalog.has(PDFName.of('AcroForm'))||annex.context.enumerateIndirectObjects().some(([,obj])=>obj instanceof PDFDict&&obj.has(PDFName.of('ByteRange'))))){
      await result.attach(original,a.name,{mimeType:'application/pdf',description:'Original protegido conservado sin modificar. '+a.caption});continue;
    }
    for (const page of await result.copyPages(annex, annex.getPageIndices())) result.addPage(page);
  }
  return result.save();
}
