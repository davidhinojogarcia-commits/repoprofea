import React, { useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import { AlertTriangle, CheckCircle2, Download, FileSignature, RotateCcw, Send, X } from 'lucide-react';
import { createDocument, getDocument, updateDocument } from '../src/services/databaseService';
import { supabase } from '../src/lib/supabase';
import { applyInstitutionalPdfStandard, renderInstitutionalReportHeader } from '../src/lib/exportUtils';

type CandidateRow = {
  id: string; need_id: string; source_report_id?: string | null; original_full_name?: string | null;
  normalized_full_name?: string | null; first_name?: string | null; surnames?: string | null;
  category?: string | null; work_name?: string | null; work_code?: string | null; offer_number?: string | null;
  hiring_month?: number | null; fortnight?: number | null; status?: string | null; result_code?: string | null;
  existing_worker_id?: number | null; updated_at?: string | null;
};
type NeedRow = { id: string; work_name?: string | null; work_code?: string | null; hiring_month?: number | null; hiring_year?: number | null; notes?: string | null; };
type Worker = Record<string, any> & { id?: number };
type FlowData = { candidate: CandidateRow; need: NeedRow | null; worker: Worker | null };

const normalize = (v: unknown) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const workerName = (c: CandidateRow) => c.normalized_full_name || [c.surnames, c.first_name].filter(Boolean).join(' ') || c.original_full_name || 'Trabajador';
const workName = (c: CandidateRow, n: NeedRow | null) => c.work_name || n?.work_name || c.work_code || n?.work_code || '';
const fortnightLabel = (v?: number | null) => v === 1 ? '1ª Quincena' : v === 2 ? '2ª Quincena' : '';
const monthLabel = (v?: number | null) => v && v >= 1 && v <= 12 ? ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][v - 1] : '';
const safeFilename = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
const whatsappPhone = (v: string) => { const d = String(v || '').replace(/\D/g, ''); return d.length === 9 ? `34${d}` : d.startsWith('0034') ? d.slice(2) : d; };
const sha256 = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('');

async function makePdf(flow: FlowData, phone: string, signature: string, refused: boolean, observations: string) {
  const { candidate: c, need: n, worker: w } = flow;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const l = 14;
  const r = pw - 14;
  const width = r - l;
  const blue: [number, number, number] = [0, 84, 142];
  const lightBlue: [number, number, number] = [239, 247, 251];
  const slate: [number, number, number] = [71, 85, 105];
  const softBorder: [number, number, number] = [203, 213, 225];

  renderInstitutionalReportHeader(
    doc,
    refused
      ? 'ACTA DE CONSTANCIA DE RENUNCIA Y NEGATIVA A FIRMAR'
      : 'DECLARACIÓN DE RENUNCIA A LA CONTRATACIÓN',
    refused
      ? 'RENUNCIA COMUNICADA · CONSTANCIA DE NEGATIVA A FIRMAR'
      : 'RENUNCIA VOLUNTARIA · DOCUMENTO INTERNO DE CONTRATACIÓN',
    { subtitle: 'GESTIÓN DE FONDOS PROFEA · DIPUTACIÓN PROVINCIAL DE CÁDIZ' },
  );

  let y = 46;

  // Este modelo se compone deliberadamente en una única hoja A4.
  // Los bloques se dimensionan de forma compacta y el texto largo se adapta.
  const ensureSpace = (_required: number) => undefined;

  const sectionTitle = (title: string) => {
    doc.setFillColor(...lightBlue);
    doc.setDrawColor(185, 220, 235);
    doc.roundedRect(l, y, width, 6, 1.2, 1.2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    doc.setTextColor(...blue);
    doc.text(title.toUpperCase(), l + 3, y + 4.1);
    y += 7.5;
  };

  const drawFieldRow = (leftLabel: string, leftValue: unknown, rightLabel?: string, rightValue?: unknown) => {
    const gap = 4;
    const colW = rightLabel ? (width - gap) / 2 : width;
    const rowH = 10.5;

    const drawCell = (x: number, wCell: number, label: string, value: unknown) => {
      doc.setDrawColor(...softBorder);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, y, wCell, rowH, 1, 1, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.7);
      doc.setTextColor(100, 116, 139);
      doc.text(label.toUpperCase(), x + 2.5, y + 3.2);

      const raw = String(value || '—').replace(/\s+/g, ' ').trim();
      let fontSize = 7.6;
      let lines: string[] = [];
      do {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(fontSize);
        lines = doc.splitTextToSize(raw, wCell - 5) as string[];
        if (lines.length <= 2) break;
        fontSize -= 0.4;
      } while (fontSize > 5.6);

      doc.setTextColor(15, 23, 42);
      doc.text(lines.slice(0, 2), x + 2.5, y + 6.7, { lineHeightFactor: 0.95 });
    };

    drawCell(l, colW, leftLabel, leftValue);
    if (rightLabel) drawCell(l + colW + gap, colW, rightLabel, rightValue);
    y += 12;
  };

  sectionTitle('Datos identificativos');
  drawFieldRow('Trabajador/a', w?.apellidosNombre || workerName(c), 'DNI / NIE', w?.dni || 'No consta');
  drawFieldRow('Teléfono de contacto', phone || w?.telefono || 'No consta', 'Categoría / puesto', w?.categoria || c.category || '—');

  sectionTitle('Datos de la contratación');
  drawFieldRow('Obra / actuación', w?.obra || workName(c, n) || '—', 'Código de obra', c.work_code || n?.work_code || '—');
  drawFieldRow(
    'Periodo de contratación previsto',
    [w?.periodoInicio, w?.periodoFin].filter(Boolean).join(' a ') || 'Pendiente / no iniciado',
    'Periodo de referencia',
    [monthLabel(c.hiring_month || n?.hiring_month), n?.hiring_year, fortnightLabel(c.fortnight)].filter(Boolean).join(' · ') || '—'
  );
  drawFieldRow('Supervisor/a responsable', w?.supervisorResponsable || '—');

  sectionTitle(refused ? 'Constancia de la renuncia y negativa a firmar' : 'Manifestación del trabajador');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(30, 41, 59);

  const statement = refused
    ? 'Se hace constar que el trabajador arriba identificado ha comunicado su decisión de no continuar con el proceso de contratación o de no formalizar la incorporación correspondiente a la obra y periodo indicados. Se le informa del contenido y finalidad de este documento, destinado exclusivamente a dejar constancia interna de dicha decisión dentro de la gestión del programa PROFEA de la Diputación Provincial de Cádiz. El trabajador manifiesta su negativa a firmar la presente acta. Por este motivo, el personal responsable registra la incidencia, la fecha y hora en que se produce y, en su caso, las observaciones relevantes, quedando el documento incorporado al expediente interno de contratación.'
    : 'El trabajador arriba identificado manifiesta, de forma libre y voluntaria, su decisión de renunciar a la contratación o incorporación correspondiente a la obra y periodo indicados. Declara haber sido informado del contenido y finalidad de este documento y confirma que su decisión supone no continuar con el proceso de contratación asociado a esta actuación. La presente declaración se incorpora al expediente interno de gestión del programa PROFEA de la Diputación Provincial de Cádiz con la finalidad de dejar constancia documental de la renuncia comunicada.';

  const statementLines = doc.splitTextToSize(statement, width);
  doc.text(statementLines, l, y, { lineHeightFactor: 1.05 });
  y += statementLines.length * 3.1 + 3;

  const note = refused
    ? 'La ausencia de firma no impide la conservación de esta constancia interna, que refleja únicamente la incidencia comunicada y la negativa a suscribir el documento.'
    : 'La firma acredita exclusivamente que el trabajador ha leído esta declaración y confirma la renuncia expresada en los términos anteriores.';

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(...softBorder);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  const noteLines = doc.splitTextToSize(note, width - 7);
  const noteH = Math.max(9.5, noteLines.length * 2.8 + 4.5);
  doc.roundedRect(l, y, width, noteH, 1.2, 1.2, 'FD');
  doc.setTextColor(...slate);
  doc.text(noteLines, l + 3.5, y + 4.2, { lineHeightFactor: 1.02 });
  y += noteH + 3;

  if (observations.trim()) {
    sectionTitle('Observaciones');
    const rawObservations = observations.trim().replace(/\s+/g, ' ');
    let obsFont = 7.2;
    let obsLines: string[] = [];
    const maxObsHeight = 20;
    let lineHeight = 2.8;

    while (obsFont >= 5.4) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(obsFont);
      obsLines = doc.splitTextToSize(rawObservations, width) as string[];
      lineHeight = obsFont * 0.352778 * 1.02;
      if (obsLines.length * lineHeight <= maxObsHeight) break;
      obsFont -= 0.3;
    }

    const maxLines = Math.max(1, Math.floor(maxObsHeight / lineHeight));
    if (obsLines.length > maxLines) {
      obsLines = obsLines.slice(0, maxLines);
      const last = obsLines.length - 1;
      obsLines[last] = String(obsLines[last]).replace(/[.…]*$/, '') + '…';
    }

    doc.setTextColor(30, 41, 59);
    doc.text(obsLines, l, y, { lineHeightFactor: 1.02 });
    y += obsLines.length * lineHeight + 3;
  }

  const signedAt = new Date();
  const dateText = signedAt.toLocaleDateString('es-ES');
  const timeText = signedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  ensureSpace(refused ? 42 : 48);
  sectionTitle('Registro y firma');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(...slate);
  doc.text(`Fecha de registro: ${dateText}`, l, y);
  doc.text(`Hora: ${timeText}`, l + 58, y);
  y += 4;

  const signatureHeight = refused ? 27 : 31;
  doc.setDrawColor(...softBorder);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(l, y, width, signatureHeight, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(51, 65, 85);
  doc.text(refused ? 'CONSTANCIA DE NEGATIVA A FIRMAR' : 'FIRMA DEL TRABAJADOR/A', l + 4, y + 5.2);

  if (!refused && signature) {
    try {
      doc.addImage(signature, 'PNG', l + 7, y + 7, 68, 20, undefined, 'FAST');
    } catch {}
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Firma manuscrita incorporada al documento en el momento del registro.', l + 84, y + 17, { maxWidth: width - 90 });
  } else if (refused) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(153, 27, 27);
    doc.text('EL TRABAJADOR/A MANIFIESTA SU NEGATIVA A FIRMAR', l + 7, y + 15.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(...slate);
    doc.text('La incidencia queda registrada por el personal responsable de la gestión PROFEA.', l + 7, y + 21);
  }

  // Pie institucional común; se mantiene la composición en una sola hoja.
  applyInstitutionalPdfStandard(doc);

  return { blob: doc.output('blob'), signedAt: signedAt.toISOString() };
}

const SignaturePad = ({ onChange }: { onChange: (v: string) => void }) => {
  const ref = useRef<HTMLCanvasElement>(null); const drawing = useRef(false); const last = useRef<{x:number;y:number}|null>(null); const [ink, setInk] = useState(false);
  useEffect(() => { const c = ref.current; if (!c) return; const rect = c.getBoundingClientRect(); const ratio = Math.max(1, devicePixelRatio || 1); c.width = Math.floor(rect.width * ratio); c.height = Math.floor(190 * ratio); const ctx = c.getContext('2d'); if (!ctx) return; ctx.scale(ratio, ratio); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,rect.width,190); ctx.strokeStyle='#111827'; ctx.lineWidth=2.2; ctx.lineCap='round'; ctx.lineJoin='round'; }, []);
  const p = (e: React.PointerEvent<HTMLCanvasElement>) => { const b = e.currentTarget.getBoundingClientRect(); return { x:e.clientX-b.left, y:e.clientY-b.top }; };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => { e.preventDefault(); drawing.current=true; last.current=p(e); e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => { if (!drawing.current || !last.current) return; e.preventDefault(); const ctx=e.currentTarget.getContext('2d'); if(!ctx)return; const n=p(e); ctx.beginPath(); ctx.moveTo(last.current.x,last.current.y); ctx.lineTo(n.x,n.y); ctx.stroke(); last.current=n; setInk(true); };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => { if(!drawing.current)return; drawing.current=false; last.current=null; onChange(e.currentTarget.toDataURL('image/png')); e.currentTarget.releasePointerCapture?.(e.pointerId); };
  const clear = () => { const c=ref.current; if(!c)return; const ctx=c.getContext('2d'); if(!ctx)return; ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height); ctx.restore(); setInk(false); onChange(''); };
  return <div><canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} className="w-full h-[190px] rounded-xl border-2 border-slate-300 bg-white touch-none"/><div className="mt-2 flex justify-between gap-2"><span className={`text-xs font-bold ${ink?'text-emerald-600':'text-slate-500'}`}>{ink?'Firma registrada ✓':'Firma aquí con el dedo'}</span><button type="button" onClick={clear} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><RotateCcw className="w-3.5 h-3.5"/>Borrar firma</button></div></div>;
};

export const SaeRenunciationBridge: React.FC = () => {
  const [flow,setFlow]=useState<FlowData|null>(null); const [step,setStep]=useState<'confirm'|'sign'|'done'>('confirm'); const [phone,setPhone]=useState(''); const [observations,setObservations]=useState(''); const [signature,setSignature]=useState(''); const [consent,setConsent]=useState(false); const [refused,setRefused]=useState(false); const [busy,setBusy]=useState(false); const [pdfFile,setPdfFile]=useState<File|null>(null); const [pdfUrl,setPdfUrl]=useState(''); const opened=useRef(''); const renouncedIds=useRef<Set<number>>(new Set());
  const name=useMemo(()=>flow?(flow.worker?.apellidosNombre||workerName(flow.candidate)):'',[flow]); const work=useMemo(()=>flow?(flow.worker?.obra||workName(flow.candidate,flow.need)):'',[flow]);

  const markDom=()=>{
    document.querySelectorAll<HTMLSelectElement>('select').forEach(s=>{ if(!Array.from(s.options).some(o=>o.value==='2100'))return; const card=s.closest('div.rounded-2xl.border.p-4') as HTMLElement|null; if(!card)return; if(card.textContent?.includes('Contratado · 2001')) s.disabled=false; const isRen=s.value==='2100'; card.classList.toggle('profea-renuncia-mark',isRen); if(isRen&&!card.querySelector('[data-renuncia-badge="1"]')){ const t=card.querySelector('.font-black.text-sm'); if(t){const b=document.createElement('span');b.dataset.renunciaBadge='1';b.className='ml-2 inline-flex rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-700 dark:border-red-800 dark:bg-red-950/70 dark:text-red-200';b.textContent='RENUNCIA · SAE 2100';t.appendChild(b);}} });
    renouncedIds.current.forEach(id=>[document.getElementById(`person-table-row-${id}`),document.getElementById(`compact-card-${id}`)].filter(Boolean).forEach(n=>{ const node=n as HTMLElement; node.classList.add('profea-renuncia-mark'); if(node.querySelector('[data-worker-renuncia-badge="1"]'))return; const t=node.querySelector('h4')||node.querySelector('td:nth-child(2) > div:first-child'); if(t){const b=document.createElement('span');b.dataset.workerRenunciaBadge='1';b.className='ml-2 inline-flex rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-700';b.textContent='RENUNCIA';t.appendChild(b);}}));
  };
  const refreshWorkers=async()=>{try{const rows=await supabase.query('trabajadores',{query:'select=id,data&order=updated_at.desc&limit=5000'});renouncedIds.current=new Set((rows||[]).filter((r:any)=>normalize(r.data?.estadoContratacion)==='renuncia'||String(r.data?.codigoSaeResultado||'')==='2100').map((r:any)=>Number(r.id)).filter(Number.isFinite));markDom();}catch{}};

  useEffect(()=>{
    const style=document.createElement('style'); style.textContent='.profea-renuncia-mark{background:rgba(254,226,226,.78)!important;border-color:rgb(248 113 113)!important;box-shadow:inset 4px 0 0 rgb(220 38 38)!important}.profea-renuncia-mark>td{background:rgba(254,226,226,.72)!important}.dark .profea-renuncia-mark{background:rgba(127,29,29,.28)!important;border-color:rgb(153 27 27)!important}.dark .profea-renuncia-mark>td{background:rgba(127,29,29,.24)!important}'; document.head.appendChild(style); void refreshWorkers(); const observer=new MutationObserver(markDom);observer.observe(document.body,{childList:true,subtree:true});
    const handler=(event:Event)=>{const s=event.target;if(!(s instanceof HTMLSelectElement)||!Array.from(s.options).some(o=>o.value==='2100'))return;setTimeout(markDom,0);if(s.value!=='2100')return;setTimeout(async()=>{try{const rows=await supabase.query('sae_candidates',{query:'select=*&result_code=eq.2100&order=updated_at.desc&limit=1'});const c=rows?.[0] as CandidateRow|undefined;if(!c?.id||opened.current===c.id)return;opened.current=c.id;await supabase.query('sae_candidates',{method:'PATCH',prefer:'return=minimal',query:`id=eq.${encodeURIComponent(c.id)}`,body:{status:'no_contratado',selected_for_hire:false,result_label:'no_contratado'}}).catch(()=>undefined);const needs=await supabase.query('sae_needs',{query:`select=*&id=eq.${encodeURIComponent(c.need_id)}&limit=1`});const need=(needs?.[0]||null) as NeedRow|null;let worker:Worker|null=null;if(c.existing_worker_id)worker=await getDocument<Worker>('trabajadores',Number(c.existing_worker_id));if(!worker){const ws=await supabase.query('trabajadores',{query:'select=*&order=updated_at.desc&limit=5000'});const wanted=normalize(workerName(c)),offer=normalize(c.offer_number);const m=(ws||[]).find((r:any)=>normalize(r.apellidos_nombre||r.data?.apellidosNombre)===wanted&&(!offer||normalize(r.num_oferta||r.data?.numOferta)===offer));if(m)worker={...(m.data||{}),id:Number(m.id),apellidosNombre:m.apellidos_nombre||m.data?.apellidosNombre,dni:m.dni||m.data?.dni,telefono:m.telefono||m.data?.telefono,obra:m.obra||m.data?.obra,categoria:m.categoria||m.data?.categoria,numOferta:m.num_oferta||m.data?.numOferta,quincena:m.quincena||m.data?.quincena,periodoInicio:m.periodo_inicio||m.data?.periodoInicio,periodoFin:m.periodo_fin||m.data?.periodoFin};}const now=new Date().toISOString();if(worker?.id){await updateDocument('trabajadores',worker.id,{estadoContratacion:'Renuncia',codigoSaeResultado:'2100',renunciaFecha:now} as any).catch(()=>undefined);renouncedIds.current.add(Number(worker.id));}setFlow({candidate:c,need,worker});setPhone(worker?.telefono||'');setObservations('');setSignature('');setConsent(false);setRefused(false);setPdfFile(null);if(pdfUrl)URL.revokeObjectURL(pdfUrl);setPdfUrl('');setStep('confirm');markDom();}catch(e){console.error('No se pudo iniciar la renuncia SAE',e);}},500);};
    document.addEventListener('change',handler,true);return()=>{observer.disconnect();document.removeEventListener('change',handler,true);style.remove();};
  },[]);

  const finalize=async(refuse=false)=>{if(!flow||(!refuse&&(!signature||!consent)))return;setBusy(true);try{const result=await makePdf(flow,phone,signature,refuse,observations);const fileName=`PROFEA_RENUNCIA_${refuse?'NEGATIVA_FIRMA':'FIRMADA'}_${safeFilename(name)||flow.candidate.id}_${new Date().toISOString().slice(0,10)}.pdf`;const file=new File([result.blob],fileName,{type:'application/pdf'});const hash=await sha256(result.blob);const path=`${flow.candidate.need_id}/renuncias/${flow.candidate.id}/${Date.now()}-${fileName}`;const {error}=await supabase.storage.from('sae-documents').upload(path,result.blob,{contentType:'application/pdf',upsert:true});if(error)throw error;setPdfFile(file);if(pdfUrl)URL.revokeObjectURL(pdfUrl);setPdfUrl(URL.createObjectURL(file));const meta={estadoContratacion:'Renuncia',codigoSaeResultado:'2100',renunciaFecha:result.signedAt,renunciaFirmada:!refuse,renunciaNegativaFirma:refuse,renunciaDocumentoPath:path,renunciaDocumentoNombre:fileName,renunciaDocumentoHash:hash,renunciaTelefono:phone};if(flow.worker?.id){await updateDocument('trabajadores',flow.worker.id,meta as any);renouncedIds.current.add(Number(flow.worker.id));}await createDocument('contrataciones',`sae-renuncia-${flow.candidate.id}`,{trabajadorId:flow.worker?.id||flow.candidate.existing_worker_id||null,obra:flow.worker?.obra||workName(flow.candidate,flow.need),numOferta:flow.worker?.numOferta||flow.candidate.offer_number||'',categoria:flow.worker?.categoria||flow.candidate.category||'',periodoInicio:flow.worker?.periodoInicio||'',periodoFin:flow.worker?.periodoFin||'',quincena:flow.worker?.quincena||fortnightLabel(flow.candidate.fortnight),estado:'Renuncia',observaciones:`Renuncia SAE 2100${refuse?' · negativa a firmar':' · documento firmado'}`,candidateId:flow.candidate.id,needId:flow.candidate.need_id,...meta} as any).catch(e=>console.warn('No se pudo sincronizar contrataciones',e));await refreshWorkers();setRefused(refuse);setStep('done');if(!refuse&&navigator.share&&navigator.canShare?.({files:[file]})){try{await navigator.share({title:'Renuncia contratación PROFEA',text:`Copia firmada de la renuncia de ${name}.`,files:[file]});}catch{}}}catch(e:any){alert(e?.message||'No se pudo generar y archivar la renuncia.');}finally{setBusy(false);}};
  const share=async()=>{if(!pdfFile)return;const text=`Hola ${name}. Te envío copia del informe de renuncia a la contratación PROFEA correspondiente a ${work||'la obra indicada'}, registrado con código SAE 2100.`;if(navigator.share&&navigator.canShare?.({files:[pdfFile]})){try{await navigator.share({title:'Renuncia contratación PROFEA',text,files:[pdfFile]});return;}catch{}}window.open(`https://wa.me/${whatsappPhone(phone)}?text=${encodeURIComponent(`${text}\n\nAdjunta el PDF descargado desde GestionPROFEA.`)}`,'_blank','noopener,noreferrer');};
  if(!flow)return null;
  const Info=({label,value}:{label:string;value:string})=><div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border p-3"><div className="text-[10px] uppercase tracking-wider font-black text-slate-400">{label}</div><div className="font-bold mt-1 break-words">{value||'—'}</div></div>;
  return <div className="fixed inset-0 z-[260] bg-slate-950/70 backdrop-blur-sm p-3 sm:p-6 flex items-end sm:items-center justify-center"><div className="w-full max-w-3xl max-h-[94vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white dark:bg-slate-900 border shadow-2xl"><div className="sticky top-0 z-10 p-4 border-b bg-white/95 dark:bg-slate-900/95 backdrop-blur flex justify-between gap-3"><div><div className="font-black text-lg">Renuncia detectada · SAE 2100</div><div className="text-xs text-slate-500">{name} · {work||'Obra pendiente'}</div></div><button onClick={()=>setFlow(null)} className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 grid place-items-center"><X className="w-5 h-5"/></button></div><div className="p-4 sm:p-6">
    {step==='confirm'&&<div className="space-y-5"><div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/30 p-4 flex gap-3"><AlertTriangle className="w-6 h-6 text-red-600 shrink-0"/><div><div className="font-black text-red-800 dark:text-red-200">Se ha registrado “2100 · Rechazo voluntario”.</div><p className="text-sm text-red-700 dark:text-red-300 mt-1">¿Quieres generar ahora el documento de renuncia y recoger la firma del trabajador?</p></div></div><div className="grid sm:grid-cols-2 gap-3 text-sm"><Info label="Trabajador" value={name}/><Info label="DNI / NIE" value={flow.worker?.dni||'No consta'}/><Info label="Obra" value={work||'No consta'}/><Info label="Categoría" value={flow.worker?.categoria||flow.candidate.category||'No consta'}/><Info label="Oferta SAE" value={flow.worker?.numOferta||flow.candidate.offer_number||'No consta'}/><Info label="Teléfono" value={flow.worker?.telefono||'No consta'}/></div><div className="flex flex-col-reverse sm:flex-row justify-end gap-2"><button onClick={()=>setFlow(null)} className="px-4 py-3 rounded-xl border font-bold">Ahora no</button><button onClick={()=>setStep('sign')} className="px-5 py-3 rounded-xl bg-red-600 text-white font-black inline-flex items-center justify-center gap-2"><FileSignature className="w-4 h-4"/>Generar documento de renuncia</button></div></div>}
    {step==='sign'&&<div className="space-y-5"><div className="grid sm:grid-cols-2 gap-3"><label><span className="text-[10px] uppercase tracking-wider font-black text-slate-400">Teléfono para WhatsApp</span><input value={phone} onChange={e=>setPhone(e.target.value)} inputMode="tel" className="ui-input mt-1.5 w-full"/></label><Info label="DNI / NIE" value={flow.worker?.dni||'No consta'}/></div><div className="rounded-xl border p-4 text-sm"><b>Declaración:</b> {name} manifiesta voluntariamente su renuncia a la contratación de la oferta <b>{flow.candidate.offer_number||'—'}</b> para <b>{work||'la obra indicada'}</b>.</div><label className="block"><span className="text-[10px] uppercase tracking-wider font-black text-slate-400">Observaciones opcionales</span><textarea value={observations} onChange={e=>setObservations(e.target.value)} rows={2} className="ui-input mt-1.5 w-full"/></label><div><div className="font-black text-sm mb-2">Firma del trabajador</div><SignaturePad onChange={setSignature}/></div><label className="flex items-start gap-3 rounded-xl border p-3 text-sm"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} className="mt-1 w-5 h-5 accent-[#00548E]"/><span>El trabajador declara haber leído el documento y manifiesta voluntariamente su renuncia.</span></label><div className="grid sm:grid-cols-[1fr_auto_auto] gap-2"><button onClick={()=>void finalize(true)} disabled={busy} className="rounded-xl border border-amber-300 text-amber-800 px-4 py-3 font-bold">El trabajador se niega a firmar</button><button onClick={()=>setStep('confirm')} className="rounded-xl border px-4 py-3 font-bold">Volver</button><button onClick={()=>void finalize(false)} disabled={busy||!signature||!consent} className="rounded-xl bg-red-600 text-white px-5 py-3 font-black disabled:opacity-40">{busy?'Generando…':'Aceptar y cerrar renuncia'}</button></div></div>}
    {step==='done'&&<div className="space-y-5"><div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 p-5 text-center"><CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto"/><div className="font-black text-lg mt-2">RENUNCIA REGISTRADA</div><div className="text-sm mt-1">{refused?'Constancia de negativa a firmar archivada.':'Documento firmado y archivado correctamente.'}</div></div><div className="grid sm:grid-cols-2 gap-3"><Info label="Trabajador" value={name}/><Info label="Código SAE" value="2100 · Rechazo voluntario"/><Info label="Obra" value={work||'—'}/><Info label="Estado" value="RENUNCIA"/></div><div className="grid sm:grid-cols-3 gap-2">{pdfUrl&&<a href={pdfUrl} download={pdfFile?.name||'renuncia.pdf'} className="rounded-xl border px-4 py-3 font-bold inline-flex items-center justify-center gap-2"><Download className="w-4 h-4"/>Descargar PDF</a>}<button onClick={()=>void share()} className="rounded-xl bg-[#25D366] text-white px-4 py-3 font-black inline-flex items-center justify-center gap-2"><Send className="w-4 h-4"/>Compartir por WhatsApp</button><button onClick={()=>setFlow(null)} className="rounded-xl bg-slate-900 dark:bg-blue-600 text-white px-4 py-3 font-bold">Cerrar</button></div><p className="text-[11px] text-slate-500">En móviles compatibles se abre la hoja de compartir con el PDF adjunto. WhatsApp requiere confirmar el envío desde el dispositivo.</p></div>}
  </div></div></div>;
};
