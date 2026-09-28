import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clock3, Download, FileSignature, Loader2, MailCheck, RefreshCw, Search, Upload } from 'lucide-react';
import { supabase } from '../src/lib/supabase';
import { downloadPDF } from '../src/lib/exportUtils';
import { ADDITIONAL_WORKSITE_DOCUMENTS, type AdditionalWorksiteDocumentType } from '../src/lib/worksiteAdditionalDocumentsPdf';
import { generateForemanAttendancePdf, generateForemanCompletedDocumentPdf, generateForemanMandatoryDocumentPdf } from '../src/lib/foremanDocumentsPdf';
import { processAdministrativeMandatoryInbox, processManualMandatoryFiles } from '../src/lib/mandatoryEmailIntake';
import { sendPdfWithConnectedGmail } from '../src/lib/gmailConnection';
import { loadAppBusinessSettings } from '../src/services/appSettingsService';
import { markMandatoryDocumentReturned } from '../src/services/foremanPortalService';
import type { ForemanAttendanceDay, ForemanCompletedDocument, ForemanMandatoryDocument } from '../src/services/foremanPortalService';

type DbDocument = { id:string; owner_id:string; obra:string; work_date:string; document_type:string; worker_id?:number|null; worker_snapshot:any; answers:Record<string,string>; signatures:Record<string,string>; completed_by:string; status:'draft'|'completed'|'reviewed'; completed_at?:string|null; updated_at?:string|null };
type DbAttendance = { id:string; owner_id:string; obra:string; work_date:string; foreman_name:string; rows:any[]; status:'draft'|'completed'|'reviewed'; completed_at?:string|null; updated_at?:string|null };
type DbMandatory = { id:string; owner_id:string; obra:string; period_key:string; work_date:string; document_type:'inicio'|'control_presencia'; category:string; workers:any[]; signatures:Record<string,any>; status:'pending'|'in_progress'|'completed'|'reviewed'; completed_at?:string|null; updated_at?:string|null; source_gmail_message_id?:string|null; source_gmail_thread_id?:string|null; source_rfc_message_id?:string|null; source_email_from?:string|null; source_email_subject?:string|null; source_attachment_name?:string|null; returned_gmail_message_id?:string|null; returned_at?:string|null };

export const ForemanDocumentsDashboard: React.FC = () => {
  const [documents,setDocuments]=useState<DbDocument[]>([]);
  const [attendance,setAttendance]=useState<DbAttendance[]>([]);
  const [mandatory,setMandatory]=useState<DbMandatory[]>([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState<'all'|'attendance'|'mandatory'|'documents'|'pending'>('all');
  const [mailBusy,setMailBusy]=useState(false);
  const [mailMessage,setMailMessage]=useState('');
  const [importBusy,setImportBusy]=useState(false);
  const mandatoryFileInputRef=useRef<HTMLInputElement>(null);
  const completedBaselineRef=useRef<Set<string>|null>(null);
  const [completionNotice,setCompletionNotice]=useState('');
  const refresh=async(silent=false)=>{
    if(!silent)setLoading(true);
    try{
      const userResult=await supabase.auth.getUser();
      const user=userResult.data.user;
      if(!user)return;
      const docsQuery='owner_id=eq.'+encodeURIComponent(user.id)+'&select=*&order=updated_at.desc&limit=500';
      const daysQuery='owner_id=eq.'+encodeURIComponent(user.id)+'&select=*&order=work_date.desc&limit=180';
      const mandatoryQuery='owner_id=eq.'+encodeURIComponent(user.id)+'&select=*&order=work_date.desc&limit=300';
      const results=await Promise.all([
        supabase.query('foreman_documents',{query:docsQuery}),
        supabase.query('foreman_attendance_days',{query:daysQuery}),
        supabase.query('foreman_mandatory_documents',{query:mandatoryQuery}),
      ]);
      const nextDocuments=Array.isArray(results[0])?results[0]:[];
      const nextAttendance=Array.isArray(results[1])?results[1]:[];
      const nextMandatory=Array.isArray(results[2])?results[2]:[];
      setDocuments(nextDocuments);
      setAttendance(nextAttendance);
      setMandatory(nextMandatory);

      const completedIds=new Set(nextMandatory.filter((item:any)=>item.status==='completed').map((item:any)=>String(item.id)));
      if(completedBaselineRef.current===null){
        completedBaselineRef.current=completedIds;
      }else{
        const newlyCompleted=[...completedIds].filter(id=>!completedBaselineRef.current?.has(id));
        if(newlyCompleted.length){
          setCompletionNotice(newlyCompleted.length===1
            ? 'El encargado ha finalizado un documento. Está listo para tu revisión.'
            : `El encargado ha finalizado ${newlyCompleted.length} documentos. Están listos para tu revisión.`);
        }
        completedBaselineRef.current=completedIds;
      }
    }finally{if(!silent)setLoading(false);}
  };
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(true),5000);return()=>window.clearInterval(timer);},[]);
  const scanAdministrativeMail = async (silent=false) => {
    if (mailBusy) return;
    setMailBusy(true);
    if (!silent) setMailMessage('Comprobando Gmail de la administrativa…');
    try {
      const keys = new Set<string>(
        mandatory
          .filter(item => item.source_gmail_message_id && item.source_attachment_name)
          .map(item => `${item.source_gmail_message_id}|${item.source_attachment_name}`)
      );
      const result = await processAdministrativeMandatoryInbox({
        existingSourceKeys: keys,
        onProgress: message => { if (!silent) setMailMessage(message); },
      });
      if (result.importedDocuments > 0) {
        setMailMessage(`${result.importedDocuments} documento(s) recibido(s) de la administrativa y preparados para firma.`);
        await refresh(true);
      } else if (!silent) {
        setMailMessage(result.warnings[0] || 'Gmail revisado. No hay nuevos documentos obligatorios.');
      }
    } catch (error:any) {
      setMailMessage(error?.message || 'No se pudo comprobar Gmail.');
    } finally {
      setMailBusy(false);
    }
  };
  useEffect(()=>{
    const first=window.setTimeout(()=>void scanAdministrativeMail(true),2500);
    const timer=window.setInterval(()=>void scanAdministrativeMail(true),60000);
    return()=>{window.clearTimeout(first);window.clearInterval(timer);};
  },[mandatory.length]);
  const importMandatoryFiles = async (files: File[]) => {
    if (!files.length || importBusy) return;
    setImportBusy(true);
    setMailMessage('Analizando documentos seleccionados…');
    try {
      const result=await processManualMandatoryFiles(files,{
        onProgress: message=>setMailMessage(message),
      });
      if(result.importedDocuments>0){
        setMailMessage(`${result.importedDocuments} documento(s) importado(s) y preparados para que el encargado recoja las firmas.${result.skippedFiles ? ` ${result.skippedFiles} archivo(s) no se pudieron importar.` : ''}`);
        await refresh(true);
      }else{
        setMailMessage(result.warnings[0] || 'No se ha podido importar ningún documento.');
      }
    }catch(error:any){
      setMailMessage(error?.message || 'No se pudieron importar los documentos.');
    }finally{
      setImportBusy(false);
      if(mandatoryFileInputRef.current) mandatoryFileInputRef.current.value='';
    }
  };
  const term=search.trim().toLowerCase();
  const cards=useMemo(()=>{
    const dayCards=attendance.map(item=>({kind:'attendance' as const,id:item.id,obra:item.obra,date:item.work_date,title:'Registro diario de jornada',subtitle:item.foreman_name,status:item.status,item}));
    const mandatoryCards=mandatory.map(item=>({kind:'mandatory' as const,id:item.id,obra:item.obra,date:item.work_date,title:item.document_type==='inicio'?'Inicio / incorporación':'Control de presencia',subtitle:item.category||'',status:item.status,item}));
    const docCards=documents.map(item=>({kind:'document' as const,id:item.id,obra:item.obra,date:item.work_date,title:ADDITIONAL_WORKSITE_DOCUMENTS[item.document_type as AdditionalWorksiteDocumentType]?.short||item.document_type,subtitle:item.worker_snapshot?.apellidosNombre||item.completed_by,status:item.status,item}));
    return [...dayCards,...mandatoryCards,...docCards].filter(card=>filter==='all'||(filter==='attendance'&&card.kind==='attendance')||(filter==='mandatory'&&card.kind==='mandatory')||(filter==='documents'&&card.kind==='document')||(filter==='pending'&&card.status!=='reviewed')).filter(card=>!term||[card.obra,card.title,card.subtitle,card.date].some(v=>String(v||'').toLowerCase().includes(term))).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  },[attendance,mandatory,documents,filter,term]);
  const markReviewed=async(kind:'attendance'|'mandatory'|'document',id:string)=>{
    const table=kind==='attendance'?'foreman_attendance_days':kind==='mandatory'?'foreman_mandatory_documents':'foreman_documents';
    await supabase.query(table,{method:'PATCH',query:'id=eq.'+encodeURIComponent(id),body:{status:'reviewed',reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()},prefer:'return=minimal'});
    await refresh(true);
  };
  const openPdf=(card:any)=>{
    if(card.kind==='attendance'){
      const day:ForemanAttendanceDay={id:card.item.id,workDate:card.item.work_date,rows:card.item.rows||[],status:card.item.status,completedAt:card.item.completed_at,updatedAt:card.item.updated_at};
      const out=generateForemanAttendancePdf(day,card.item.obra,card.item.foreman_name); downloadPDF(out.doc,out.filename); return;
    }
    if(card.kind==='mandatory'){
      const m=card.item as DbMandatory;
      const record:ForemanMandatoryDocument={id:m.id,workDate:m.work_date,periodKey:m.period_key,documentType:m.document_type,category:m.category,workers:m.workers||[],signatures:m.signatures||{},status:m.status,completedAt:m.completed_at};
      const out=generateForemanMandatoryDocumentPdf(record,m.obra); downloadPDF(out.doc,out.filename); return;
    }
    const d=card.item as DbDocument;
    const record:ForemanCompletedDocument={id:d.id,workDate:d.work_date,documentType:d.document_type,workerId:d.worker_id,workerSnapshot:d.worker_snapshot||{},answers:d.answers||{},signatures:d.signatures||{},status:d.status,completedAt:d.completed_at};
    const out=generateForemanCompletedDocumentPdf(record,d.obra,d.completed_by); downloadPDF(out.doc,out.filename);
  };
  const approveAndReturnMandatory = async (item: DbMandatory) => {
    if (item.status !== 'completed') return;
    const settings=await loadAppBusinessSettings();
    const targetEmail=String(item.source_email_from || settings.administrative?.email || '').trim();
    if(!targetEmail){
      setMailMessage('No hay correo de la administrativa configurado.');
      return;
    }
    if (!window.confirm('¿Aprobar este documento cumplimentado y enviarlo por Gmail a la administrativa?')) return;
    setMailBusy(true);
    try {
      const record:ForemanMandatoryDocument={
        id:item.id,workDate:item.work_date,periodKey:item.period_key,documentType:item.document_type,
        category:item.category,workers:item.workers||[],signatures:item.signatures||{},status:item.status,
        completedAt:item.completed_at
      };
      const out=generateForemanMandatoryDocumentPdf(record,item.obra);
      const blob=out.doc.output('blob');
      const file=new File([blob],out.filename,{type:'application/pdf'});
      const subjectRaw=String(item.source_email_subject||'Documentación PROFEA firmada').trim();
      const subject=/^re:/i.test(subjectRaw)?subjectRaw:`Re: ${subjectRaw}`;
      const sent=await sendPdfWithConnectedGmail({
        to:targetEmail,
        subject,
        body:`Se devuelve la documentación de ${item.obra} firmada y revisada por el supervisor.\n\nDocumento: ${item.document_type==='inicio'?'Inicio / incorporación':'Control de presencia'}\nFecha: ${item.work_date}.`,
        file,
        threadId:item.source_gmail_thread_id||'',
        inReplyTo:item.source_rfc_message_id||'',
        references:item.source_rfc_message_id||'',
      });
      await markMandatoryDocumentReturned(item.id,sent.messageId);
      setMailMessage('Documento aprobado y devuelto por Gmail a la administrativa.');
      await refresh(true);
    } catch(error:any) {
      setMailMessage(error?.message||'No se pudo devolver el documento por Gmail.');
    } finally {
      setMailBusy(false);
    }
  };
  const signedEntries=attendance.reduce((sum,d)=>sum+(d.rows||[]).filter((r:any)=>r.entrySignature).length,0);
  const signedExits=attendance.reduce((sum,d)=>sum+(d.rows||[]).filter((r:any)=>r.exitSignature).length,0);
  const pending=cards.filter(c=>c.status!=='reviewed').length;
  return <div className="space-y-5">
    <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div><div className="text-[10px] font-black uppercase tracking-[.16em] text-[#00548E] dark:text-blue-300">Seguimiento en tiempo real</div><h1 className="text-2xl font-black text-slate-900 dark:text-white mt-1">Documentación de encargados</h1><p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Documentos y registros diarios cumplimentados desde el móvil del encargado. Se actualiza automáticamente cada 5 segundos.</p></div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={mandatoryFileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={event=>void importMandatoryFiles(Array.from(event.target.files || []))}
          />
          <button
            disabled={importBusy}
            onClick={()=>mandatoryFileInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-2.5 text-sm font-black disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          >
            {importBusy?<Loader2 className="w-4 h-4 animate-spin"/>:<Upload className="w-4 h-4"/>}
            Importar Inicio / Control de presencia
          </button>
          <button disabled={mailBusy} onClick={()=>void scanAdministrativeMail(false)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-800 px-4 py-2.5 text-sm font-black disabled:opacity-50"><MailCheck className="w-4 h-4"/>Revisar Gmail</button>
          <button onClick={()=>void refresh()} className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black"><RefreshCw className="w-4 h-4"/>Actualizar</button>
        </div>
      </div>
      {mailMessage&&<div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-bold text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">{mailMessage}</div>}
      {completionNotice&&<div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs font-black text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"><span>{completionNotice}</span><button onClick={()=>setCompletionNotice('')} className="rounded-lg border border-emerald-300 px-2 py-1 text-[10px]">OK</button></div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
        {([['Obligatorios',mandatory.length],['Otros documentos',documents.length],['Jornadas',attendance.length],['Firmas E/S',signedEntries+signedExits]] as [string,number][]).map(([label,value])=><div key={label} className="rounded-2xl bg-slate-50 dark:bg-slate-800 p-4"><div className="text-2xl font-black">{value}</div><div className="text-[11px] font-bold text-slate-500">{label}</div></div>)}
      </div>
    </div>
    <div className="rounded-2xl bg-white dark:bg-slate-900 border p-3 flex flex-col md:flex-row gap-2">
      <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por obra, trabajador, documento o fecha…" className="w-full rounded-xl border pl-9 pr-3 py-2.5 bg-white dark:bg-slate-950"/></div>
      <select value={filter} onChange={e=>setFilter(e.target.value as any)} className="rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-950 font-bold text-sm"><option value="all">Todo</option><option value="mandatory">Inicio y control de presencia</option><option value="attendance">Registro diario</option><option value="documents">Otros documentos</option><option value="pending">Pendientes de revisar ({pending})</option></select>
    </div>
    {loading?<div className="rounded-2xl bg-white border p-10 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-[#00548E]"/></div>:cards.length===0?<div className="rounded-2xl bg-white dark:bg-slate-900 border p-10 text-center text-sm text-slate-500">Todavía no hay documentación enviada por encargados.</div>:<div className="space-y-3">{cards.map(card=><article key={card.kind+card.id} className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3"><div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className={card.kind==='attendance'?'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black bg-blue-50 text-blue-800 border border-blue-200':card.kind==='mandatory'?'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black bg-amber-50 text-amber-800 border border-amber-200':'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black bg-violet-50 text-violet-800 border border-violet-200'}>{card.kind==='attendance'?<Clock3 className="w-3 h-3"/>:<FileSignature className="w-3 h-3"/>}{card.kind==='attendance'?'Registro diario':card.kind==='mandatory'?'Obligatorio':'Documento'}</span><span className={card.status==='reviewed'?'rounded-full px-2 py-1 text-[10px] font-black bg-slate-100 text-slate-700':card.status==='completed'?'rounded-full px-2 py-1 text-[10px] font-black bg-emerald-50 text-emerald-700':card.status==='in_progress'?'rounded-full px-2 py-1 text-[10px] font-black bg-blue-50 text-blue-800':'rounded-full px-2 py-1 text-[10px] font-black bg-amber-50 text-amber-800'}>{card.status==='reviewed'?'Enviado / revisado':card.status==='completed'?'Cumplimentado':card.status==='in_progress'?'En cumplimentación':'Pendiente de firma'}</span></div>
        <h3 className="mt-2 font-black text-slate-900 dark:text-white">{card.title}</h3><p className="text-xs text-slate-500">{card.obra} · {String(card.date).slice(0,10)}{card.subtitle?' · '+card.subtitle:''}</p>{card.kind==='attendance'&&<p className="text-xs mt-1 text-slate-500">{card.item.rows?.filter((r:any)=>r.entrySignature).length||0} entradas · {card.item.rows?.filter((r:any)=>r.exitSignature).length||0} salidas firmadas</p>}{card.kind==='mandatory'&&<p className="text-xs mt-1 text-slate-500">{Object.keys(card.item.signatures||{}).length}/{card.item.workers?.length||0} firmas recogidas</p>}</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={()=>openPdf(card)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black"><Download className="w-4 h-4"/>PDF</button>
          {card.kind==='mandatory' && card.status==='completed' && (
            <button disabled={mailBusy} onClick={()=>void approveAndReturnMandatory(card.item as DbMandatory)} className="inline-flex items-center gap-2 rounded-xl bg-[#00548E] text-white px-3 py-2.5 text-xs font-black disabled:opacity-50"><MailCheck className="w-4 h-4"/>{card.item.source_gmail_message_id?'Aprobar y devolver por Gmail':'Aprobar y enviar a administrativa'}</button>
          )}
          {card.kind!=='mandatory' && card.status!=='reviewed' && (
            <button onClick={()=>void markReviewed(card.kind==='attendance'?'attendance':'document',card.id)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-3 py-2.5 text-xs font-black"><CheckCircle2 className="w-4 h-4"/>Marcar revisado</button>
          )}
        </div>
      </div>
    </article>)}</div>}
  </div>;
};