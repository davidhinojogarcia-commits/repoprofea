import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Download, FileSignature, History, ListChecks, Loader2, MailCheck, Pencil, RefreshCw, RotateCcw, Save, Search, Trash2, Upload, X } from 'lucide-react';
import { supabase } from '../src/lib/supabase';
import { downloadPDF } from '../src/lib/exportUtils';
import { ADDITIONAL_WORKSITE_DOCUMENTS, type AdditionalWorksiteDocumentType } from '../src/lib/worksiteAdditionalDocumentsPdf';
import { generateForemanAttendancePdf, generateForemanCompletedDocumentPdf, generateForemanMandatoryDocumentPdf } from '../src/lib/foremanDocumentsPdf';
import { processAdministrativeMandatoryInbox, processManualMandatoryFiles } from '../src/lib/mandatoryEmailIntake';
import { sendPdfWithConnectedGmail } from '../src/lib/gmailConnection';
import { loadAppBusinessSettings } from '../src/services/appSettingsService';
import { markMandatoryDocumentReturned, returnForemanItemForCorrection, reviewForemanItem } from '../src/services/foremanPortalService';
import type { ForemanAttendanceDay, ForemanCompletedDocument, ForemanMandatoryDocument } from '../src/services/foremanPortalService';

type DbDocument = { id:string; owner_id:string; obra:string; work_date:string; document_type:string; worker_id?:number|null; worker_snapshot:any; answers:Record<string,string>; signatures:Record<string,string>; completed_by:string; status:'draft'|'completed'|'reviewed'; completed_at?:string|null; updated_at?:string|null; correction_pending?:boolean; correction_reason?:string|null; correction_requested_at?:string|null };
type DbAttendance = { id:string; owner_id:string; obra:string; work_date:string; foreman_name:string; rows:any[]; status:'draft'|'completed'|'reviewed'; completed_at?:string|null; updated_at?:string|null; correction_pending?:boolean; correction_reason?:string|null; correction_requested_at?:string|null };
type DbMandatory = { id:string; owner_id:string; obra:string; period_key:string; work_date:string; document_type:'inicio'|'control_presencia'|'epis'|'maquinaria'|'autorizacion_uso_maquinaria'; category:string; workers:any[]; signatures:Record<string,any>; details?:Record<string,any>; status:'pending'|'in_progress'|'returned'|'completed'|'reviewed'; completed_at?:string|null; updated_at?:string|null; source_gmail_message_id?:string|null; source_gmail_thread_id?:string|null; source_rfc_message_id?:string|null; source_email_from?:string|null; source_email_subject?:string|null; source_attachment_name?:string|null; returned_gmail_message_id?:string|null; returned_at?:string|null; correction_pending?:boolean; correction_reason?:string|null; correction_requested_at?:string|null };

type ActivityRow = { id:number; obra:string; entity_type:string; entity_id?:string|null; document_type?:string|null; action:string; actor_type:'supervisor'|'encargado'|'sistema'; actor_name?:string; worker_id?:number|null; metadata?:Record<string,any>; created_at:string };
type VersionRow = { id:string; obra:string; entity_type:string; entity_id:string; version_no:number; snapshot:Record<string,any>; created_at:string };

const mandatoryDocumentLabel = (type:string) => ({
  inicio:'Inicio / incorporación',
  control_presencia:'Control de presencia',
  epis:'Entrega de EPIs',
  maquinaria:'Autorización de maquinaria',
  autorizacion_uso_maquinaria:'Autorización al uso de maquinaria',
} as Record<string,string>)[type] || type;

export const ForemanDocumentsDashboard: React.FC = () => {
  const [documents,setDocuments]=useState<DbDocument[]>([]);
  const [attendance,setAttendance]=useState<DbAttendance[]>([]);
  const [mandatory,setMandatory]=useState<DbMandatory[]>([]);
  const [activity,setActivity]=useState<ActivityRow[]>([]);
  const [versions,setVersions]=useState<VersionRow[]>([]);
  const [controlView,setControlView]=useState<'status'|'activity'|'history'>('status');
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState<'all'|'attendance'|'mandatory'|'documents'|'pending'>('all');
  const [mailBusy,setMailBusy]=useState(false);
  const [mailMessage,setMailMessage]=useState('');
  const [importBusy,setImportBusy]=useState(false);
  const mandatoryFileInputRef=useRef<HTMLInputElement>(null);
  const completedBaselineRef=useRef<Set<string>|null>(null);
  const activityBaselineRef=useRef<number|null>(null);
  const [completionNotice,setCompletionNotice]=useState('');
  const [activityNotice,setActivityNotice]=useState('');
  const [editingCard,setEditingCard]=useState<any|null>(null);
  const [editDraft,setEditDraft]=useState<any>({});
  const [editBusy,setEditBusy]=useState(false);
  const refresh=async(silent=false)=>{
    if(!silent)setLoading(true);
    try{
      const userResult=await supabase.auth.getUser();
      const user=userResult.data.user;
      if(!user)return;
      const docsQuery='owner_id=eq.'+encodeURIComponent(user.id)+'&select=*&order=updated_at.desc&limit=500';
      const daysQuery='owner_id=eq.'+encodeURIComponent(user.id)+'&select=*&order=work_date.desc&limit=180';
      const mandatoryQuery='owner_id=eq.'+encodeURIComponent(user.id)+'&select=*&order=work_date.desc&limit=300';
      const activityQuery='owner_id=eq.'+encodeURIComponent(user.id)+'&select=*&order=created_at.desc&limit=500';
      const versionsQuery='owner_id=eq.'+encodeURIComponent(user.id)+'&select=*&order=created_at.desc&limit=300';
      const results=await Promise.all([
        supabase.query('foreman_documents',{query:docsQuery}),
        supabase.query('foreman_attendance_days',{query:daysQuery}),
        supabase.query('foreman_mandatory_documents',{query:mandatoryQuery}),
        supabase.query('foreman_activity_log',{query:activityQuery}),
        supabase.query('foreman_document_versions',{query:versionsQuery}),
      ]);
      const nextDocuments=Array.isArray(results[0])?results[0]:[];
      const nextAttendance=Array.isArray(results[1])?results[1]:[];
      const nextMandatory=Array.isArray(results[2])?results[2]:[];
      setDocuments(nextDocuments);
      setAttendance(nextAttendance);
      setMandatory(nextMandatory);
      const nextActivity=Array.isArray(results[3])?results[3]:[];
      setActivity(nextActivity);
      setVersions(Array.isArray(results[4])?results[4]:[]);
      const newestActivityId=nextActivity.length?Math.max(...nextActivity.map((row:any)=>Number(row.id)||0)):0;
      if(activityBaselineRef.current===null){
        activityBaselineRef.current=newestActivityId;
      }else if(newestActivityId>activityBaselineRef.current){
        const newRows=nextActivity.filter((row:any)=>(Number(row.id)||0)>Number(activityBaselineRef.current||0));
        const relevant=newRows.filter((row:any)=>!['access_updated','updated'].includes(String(row.action||'')));
        if(relevant.length){
          setActivityNotice(relevant.length===1
            ? 'Hay una nueva actividad del encargado o del supervisor en la documentación.'
            : `Hay ${relevant.length} movimientos nuevos en la documentación de encargados.`);
        }
        activityBaselineRef.current=newestActivityId;
      }

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
    const mandatoryCards=mandatory.map(item=>({kind:'mandatory' as const,id:item.id,obra:item.obra,date:item.work_date,title:mandatoryDocumentLabel(item.document_type),subtitle:item.category||'',status:item.status,item}));
    const docCards=documents.map(item=>({kind:'document' as const,id:item.id,obra:item.obra,date:item.work_date,title:ADDITIONAL_WORKSITE_DOCUMENTS[item.document_type as AdditionalWorksiteDocumentType]?.short||item.document_type,subtitle:item.worker_snapshot?.apellidosNombre||item.completed_by,status:item.status,item}));
    return [...dayCards,...mandatoryCards,...docCards].filter(card=>filter==='all'||(filter==='attendance'&&card.kind==='attendance')||(filter==='mandatory'&&card.kind==='mandatory')||(filter==='documents'&&card.kind==='document')||(filter==='pending'&&card.status!=='reviewed')).filter(card=>!term||[card.obra,card.title,card.subtitle,card.date].some(v=>String(v||'').toLowerCase().includes(term))).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  },[attendance,mandatory,documents,filter,term]);
  const markReviewed=async(kind:'attendance'|'mandatory'|'document',id:string)=>{
    await reviewForemanItem(kind,id);
    await refresh(true);
  };
  const returnForCorrection=async(kind:'attendance'|'mandatory'|'document',id:string)=>{
    const reason=window.prompt('Indica al encargado qué debe corregir:','');
    if(!reason?.trim())return;
    await returnForemanItemForCorrection(kind,id,reason.trim());
    await refresh(true);
  };

  const startEdit=(card:any)=>{
    if(card.kind==='attendance'){
      setEditDraft({
        work_date:String(card.item.work_date||'').slice(0,10),
        foreman_name:String(card.item.foreman_name||''),
        rows:(card.item.rows||[]).map((row:any)=>({...row})),
      });
    }else if(card.kind==='mandatory'){
      setEditDraft({
        work_date:String(card.item.work_date||'').slice(0,10),
        category:String(card.item.category||''),
        details:{...(card.item.details||{})},
      });
    }else{
      setEditDraft({
        work_date:String(card.item.work_date||'').slice(0,10),
        answers:{...(card.item.answers||{})},
      });
    }
    setEditingCard(card);
  };

  const saveSupervisorEdit=async()=>{
    if(!editingCard)return;
    setEditBusy(true);
    try{
      const table=editingCard.kind==='attendance'
        ?'foreman_attendance_days'
        :editingCard.kind==='mandatory'
          ?'foreman_mandatory_documents'
          :'foreman_documents';
      let body:any={updated_at:new Date().toISOString()};
      if(editingCard.kind==='attendance'){
        body={...body,work_date:editDraft.work_date,foreman_name:editDraft.foreman_name,rows:editDraft.rows||[]};
      }else if(editingCard.kind==='mandatory'){
        body={...body,work_date:editDraft.work_date,category:editDraft.category||'',details:editDraft.details||{}};
      }else{
        body={...body,work_date:editDraft.work_date,answers:editDraft.answers||{}};
      }
      await supabase.query(table,{
        method:'PATCH',
        query:'id=eq.'+encodeURIComponent(editingCard.id),
        body,
        prefer:'return=minimal',
      });
      setEditingCard(null);
      setEditDraft({});
      setMailMessage('Documento actualizado por el supervisor. El cambio ha quedado registrado en Actividad.');
      await refresh(true);
    }catch(error:any){
      console.error('No se pudo editar el documento del encargado:',error);
      setMailMessage(error?.message||'No se pudo guardar la edición.');
    }finally{
      setEditBusy(false);
    }
  };

  const deleteSupervisorItem=async(card:any)=>{
    const ok=window.confirm(
      `¿Eliminar definitivamente "${card.title}" de ${card.obra}?\n\nLa eliminación quedará registrada en la auditoría del supervisor y las versiones históricas ya guardadas se conservarán.`
    );
    if(!ok)return;
    const confirmText=window.prompt('Escribe ELIMINAR para confirmar:','');
    if(String(confirmText||'').trim().toUpperCase()!=='ELIMINAR')return;
    setEditBusy(true);
    try{
      const table=card.kind==='attendance'
        ?'foreman_attendance_days'
        :card.kind==='mandatory'
          ?'foreman_mandatory_documents'
          :'foreman_documents';
      await supabase.query(table,{
        method:'DELETE',
        query:'id=eq.'+encodeURIComponent(card.id),
        prefer:'return=minimal',
      });
      setMailMessage('Documento eliminado por el supervisor. La eliminación ha quedado registrada en Actividad.');
      await refresh(true);
    }catch(error:any){
      console.error('No se pudo eliminar el documento del encargado:',error);
      setMailMessage(error?.message||'No se pudo eliminar el documento.');
    }finally{
      setEditBusy(false);
    }
  };
  const openPdf=(card:any)=>{
    if(card.kind==='attendance'){
      const day:ForemanAttendanceDay={id:card.item.id,workDate:card.item.work_date,rows:card.item.rows||[],status:card.item.status,completedAt:card.item.completed_at,updatedAt:card.item.updated_at};
      const out=generateForemanAttendancePdf(day,card.item.obra,card.item.foreman_name); downloadPDF(out.doc,out.filename); return;
    }
    if(card.kind==='mandatory'){
      const m=card.item as DbMandatory;
      const record:ForemanMandatoryDocument={id:m.id,workDate:m.work_date,periodKey:m.period_key,documentType:m.document_type,category:m.category,workers:m.workers||[],signatures:m.signatures||{},status:m.status,completedAt:m.completed_at,details:m.details||{}};
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
        completedAt:item.completed_at,details:item.details||{}
      };
      const out=generateForemanMandatoryDocumentPdf(record,item.obra);
      const blob=out.doc.output('blob');
      const file=new File([blob],out.filename,{type:'application/pdf'});
      const subjectRaw=String(item.source_email_subject||'Documentación PROFEA firmada').trim();
      const subject=/^re:/i.test(subjectRaw)?subjectRaw:`Re: ${subjectRaw}`;
      const sent=await sendPdfWithConnectedGmail({
        to:targetEmail,
        subject,
        body:`Se devuelve la documentación de ${item.obra} firmada y revisada por el supervisor.\n\nDocumento: ${mandatoryDocumentLabel(item.document_type)}\nFecha: ${item.work_date}.`,
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
  const correctionCount=mandatory.filter(i=>i.correction_pending).length+documents.filter(i=>i.correction_pending).length+attendance.filter(i=>i.correction_pending).length;
  const incompleteCount=mandatory.filter(i=>i.status==='pending'||i.status==='in_progress'||i.status==='returned').length+attendance.filter(i=>i.status==='draft').length;
  const reviewCount=mandatory.filter(i=>i.status==='completed').length+documents.filter(i=>i.status==='completed').length+attendance.filter(i=>i.status==='completed').length;
  const actionLabel=(action:string)=>({
    created:'Creado',created_and_finalized:'Creado y finalizado',signature_updated:'Firma registrada o actualizada',
    finalized:'Finalizado por el encargado',reviewed:'Revisado por el supervisor',returned_for_correction:'Devuelto para corrección',
    attendance_updated:'Jornada actualizada',answers_updated:'Datos modificados',access_authorized:'Acceso autorizado',
    access_revoked:'Acceso desautorizado',access_rotated:'Acceso renovado',access_updated:'Acceso al portal',status_changed:'Cambio de estado',updated:'Actualizado'
  } as Record<string,string>)[action]||action;
  const entityLabel=(row:ActivityRow|VersionRow)=>{
    const snap='snapshot' in row?row.snapshot:null;
    const type=('document_type' in row?row.document_type:null)||snap?.document_type;
    if(type)return mandatoryDocumentLabel(String(type));
    if(row.entity_type==='foreman_attendance_days')return 'Registro diario de jornada';
    if(row.entity_type==='foreman_portal_access')return 'Acceso del encargado';
    return 'Documento de obra';
  };
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
      {activityNotice&&<div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-xs font-black text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200"><span>{activityNotice}</span><button onClick={()=>{setActivityNotice('');setControlView('activity')}} className="rounded-lg border border-blue-300 px-2 py-1 text-[10px]">Ver actividad</button></div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
        {([['Obligatorios',mandatory.length],['Otros documentos',documents.length],['Jornadas',attendance.length],['Firmas E/S',signedEntries+signedExits]] as [string,number][]).map(([label,value])=><div key={label} className="rounded-2xl bg-slate-50 dark:bg-slate-800 p-4"><div className="text-2xl font-black">{value}</div><div className="text-[11px] font-bold text-slate-500">{label}</div></div>)}
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <button onClick={()=>setControlView('status')} className={`rounded-2xl border px-4 py-3 text-sm font-black flex items-center justify-center gap-2 ${controlView==='status'?'bg-[#00548E] text-white':'bg-white dark:bg-slate-900'}`}><ListChecks className="w-4 h-4"/>Estado actual</button>
      <button onClick={()=>setControlView('activity')} className={`rounded-2xl border px-4 py-3 text-sm font-black flex items-center justify-center gap-2 ${controlView==='activity'?'bg-[#00548E] text-white':'bg-white dark:bg-slate-900'}`}><Clock3 className="w-4 h-4"/>Actividad ({activity.length})</button>
      <button onClick={()=>setControlView('history')} className={`rounded-2xl border px-4 py-3 text-sm font-black flex items-center justify-center gap-2 ${controlView==='history'?'bg-[#00548E] text-white':'bg-white dark:bg-slate-900'}`}><History className="w-4 h-4"/>Historial / versiones ({versions.length})</button>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className={`rounded-2xl border p-4 ${correctionCount?'border-amber-300 bg-amber-50 dark:bg-amber-950/20':'bg-white dark:bg-slate-900'}`}>
        <div className="flex items-center gap-2"><RotateCcw className="w-4 h-4 text-amber-600"/><span className="text-xs font-black uppercase">Correcciones</span></div>
        <div className="mt-2 text-2xl font-black">{correctionCount}</div><div className="text-xs text-slate-500">devueltos al encargado</div>
      </div>
      <div className={`rounded-2xl border p-4 ${incompleteCount?'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20':'bg-white dark:bg-slate-900'}`}>
        <div className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600"/><span className="text-xs font-black uppercase">En curso</span></div>
        <div className="mt-2 text-2xl font-black">{incompleteCount}</div><div className="text-xs text-slate-500">pendientes o incompletos</div>
      </div>
      <div className={`rounded-2xl border p-4 ${reviewCount?'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20':'bg-white dark:bg-slate-900'}`}>
        <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600"/><span className="text-xs font-black uppercase">Por revisar</span></div>
        <div className="mt-2 text-2xl font-black">{reviewCount}</div><div className="text-xs text-slate-500">finalizados por el encargado</div>
      </div>
    </div>

    {controlView==='status'&&<>    <div className="rounded-2xl bg-white dark:bg-slate-900 border p-3 flex flex-col md:flex-row gap-2">
      <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por obra, trabajador, documento o fecha…" className="w-full rounded-xl border pl-9 pr-3 py-2.5 bg-white dark:bg-slate-950"/></div>
      <select value={filter} onChange={e=>setFilter(e.target.value as any)} className="rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-950 font-bold text-sm"><option value="all">Todo</option><option value="mandatory">Inicio y control de presencia</option><option value="attendance">Registro diario</option><option value="documents">Otros documentos</option><option value="pending">Pendientes de revisar ({pending})</option></select>
    </div>
    {loading?<div className="rounded-2xl bg-white border p-10 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-[#00548E]"/></div>:cards.length===0?<div className="rounded-2xl bg-white dark:bg-slate-900 border p-10 text-center text-sm text-slate-500">Todavía no hay documentación enviada por encargados.</div>:<div className="space-y-3">{cards.map(card=><article key={card.kind+card.id} className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3"><div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className={card.kind==='attendance'?'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black bg-blue-50 text-blue-800 border border-blue-200':card.kind==='mandatory'?'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black bg-amber-50 text-amber-800 border border-amber-200':'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black bg-violet-50 text-violet-800 border border-violet-200'}>{card.kind==='attendance'?<Clock3 className="w-3 h-3"/>:<FileSignature className="w-3 h-3"/>}{card.kind==='attendance'?'Registro diario':card.kind==='mandatory'?'Obligatorio':'Documento'}</span><span className={card.status==='reviewed'?'rounded-full px-2 py-1 text-[10px] font-black bg-slate-100 text-slate-700':card.status==='completed'?'rounded-full px-2 py-1 text-[10px] font-black bg-emerald-50 text-emerald-700':card.status==='in_progress'?'rounded-full px-2 py-1 text-[10px] font-black bg-blue-50 text-blue-800':card.status==='returned'?'rounded-full px-2 py-1 text-[10px] font-black bg-amber-100 text-amber-900':'rounded-full px-2 py-1 text-[10px] font-black bg-amber-50 text-amber-800'}>{card.status==='reviewed'?'Enviado / revisado':card.status==='completed'?'Cumplimentado':card.status==='in_progress'?'En cumplimentación':card.status==='returned'?'Devuelto para corregir':'Pendiente de firma'}</span></div>
        <h3 className="mt-2 font-black text-slate-900 dark:text-white">{card.title}</h3><p className="text-xs text-slate-500">{card.obra} · {String(card.date).slice(0,10)}{card.subtitle?' · '+card.subtitle:''}</p>{card.kind==='attendance'&&<p className="text-xs mt-1 text-slate-500">{card.item.rows?.filter((r:any)=>r.entrySignature).length||0} entradas · {card.item.rows?.filter((r:any)=>r.exitSignature).length||0} salidas firmadas</p>}{card.kind==='mandatory'&&<p className="text-xs mt-1 text-slate-500">{Object.keys(card.item.signatures||{}).length}/{card.item.workers?.length||0} firmas recogidas</p>}{card.item.correction_pending&&<p className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-xs font-bold text-amber-900">Corrección solicitada: {card.item.correction_reason||'Revisar documento'}</p>}</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={()=>openPdf(card)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black"><Download className="w-4 h-4"/>PDF</button>
          {card.kind==='mandatory' && card.status==='completed' && ['inicio','control_presencia'].includes(String(card.item.document_type||'')) && (
            <button disabled={mailBusy} onClick={()=>void approveAndReturnMandatory(card.item as DbMandatory)} className="inline-flex items-center gap-2 rounded-xl bg-[#00548E] text-white px-3 py-2.5 text-xs font-black disabled:opacity-50"><MailCheck className="w-4 h-4"/>{card.item.source_gmail_message_id?'Aprobar y devolver por Gmail':'Aprobar y enviar a administrativa'}</button>
          )}
          {card.status==='completed' && !(card.kind==='mandatory' && card.item.source_gmail_message_id) && (
            <button onClick={()=>void markReviewed(card.kind==='attendance'?'attendance':card.kind==='mandatory'?'mandatory':'document',card.id)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-3 py-2.5 text-xs font-black"><CheckCircle2 className="w-4 h-4"/>Marcar revisado</button>
          )}
          {(card.status==='completed'||card.status==='reviewed')&&(
            <button onClick={()=>void returnForCorrection(card.kind==='attendance'?'attendance':card.kind==='mandatory'?'mandatory':'document',card.id)} className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2.5 text-xs font-black"><RotateCcw className="w-4 h-4"/>Devolver para corregir</button>
          )}
          <button onClick={()=>startEdit(card)} className="inline-flex items-center gap-2 rounded-xl border border-blue-300 bg-blue-50 text-blue-900 px-3 py-2.5 text-xs font-black"><Pencil className="w-4 h-4"/>Editar</button>
          <button onClick={()=>void deleteSupervisorItem(card)} disabled={editBusy} className="inline-flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 px-3 py-2.5 text-xs font-black disabled:opacity-50"><Trash2 className="w-4 h-4"/>Eliminar</button>
        </div>
      </div>
    </article>)}</div>}
    </>}

    {editingCard&&<div className="fixed inset-0 z-[140] bg-slate-950/60 p-3 sm:p-5 flex items-center justify-center">
      <div className="w-full max-w-3xl max-h-[92dvh] overflow-y-auto rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-white/95 dark:bg-slate-900/95 backdrop-blur p-4 sm:p-5">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[.14em] text-[#00548E]">Edición del supervisor</div>
            <h3 className="mt-1 text-xl font-black">{editingCard.title}</h3>
            <p className="mt-1 text-xs text-slate-500">{editingCard.obra} · Las firmas existentes se conservan.</p>
          </div>
          <button onClick={()=>{setEditingCard(null);setEditDraft({});}} className="rounded-xl border p-2"><X className="w-4 h-4"/></button>
        </div>
        <div className="p-4 sm:p-5 space-y-5">
          <label className="block text-sm font-black">Fecha
            <input type="date" value={editDraft.work_date||''} onChange={e=>setEditDraft((d:any)=>({...d,work_date:e.target.value}))} className="mt-2 min-h-[50px] w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-950"/>
          </label>

          {editingCard.kind==='attendance'&&<>
            <label className="block text-sm font-black">Encargado
              <input value={editDraft.foreman_name||''} onChange={e=>setEditDraft((d:any)=>({...d,foreman_name:e.target.value}))} className="mt-2 min-h-[50px] w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-950"/>
            </label>
            <div>
              <div className="text-sm font-black mb-2">Horario por trabajador</div>
              <div className="space-y-2">
                {(editDraft.rows||[]).map((row:any,index:number)=><div key={row.workerId||index} className="rounded-xl border p-3 grid sm:grid-cols-[1fr_130px_130px] gap-2 items-end">
                  <div><div className="font-black text-sm">{row.name}</div><div className="text-xs text-slate-500">{row.dni} · {row.category}</div></div>
                  <label className="text-[10px] font-black uppercase text-slate-500">Entrada
                    <input type="time" value={row.entryTime||''} onChange={e=>setEditDraft((d:any)=>({...d,rows:d.rows.map((r:any,i:number)=>i===index?{...r,entryTime:e.target.value}:r)}))} className="mt-1 w-full rounded-lg border px-2 py-2 bg-white dark:bg-slate-950"/>
                  </label>
                  <label className="text-[10px] font-black uppercase text-slate-500">Salida
                    <input type="time" value={row.exitTime||''} onChange={e=>setEditDraft((d:any)=>({...d,rows:d.rows.map((r:any,i:number)=>i===index?{...r,exitTime:e.target.value}:r)}))} className="mt-1 w-full rounded-lg border px-2 py-2 bg-white dark:bg-slate-950"/>
                  </label>
                </div>)}
              </div>
            </div>
          </>}

          {editingCard.kind==='mandatory'&&<>
            {(editingCard.item.document_type==='inicio'||editingCard.item.document_type==='control_presencia')&&<label className="block text-sm font-black">Categoría
              <input value={editDraft.category||''} onChange={e=>setEditDraft((d:any)=>({...d,category:e.target.value}))} className="mt-2 min-h-[50px] w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-950"/>
            </label>}
            {editingCard.item.document_type==='epis'&&<div>
              <div className="text-sm font-black mb-2">EPIs</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Object.entries({casco:'Casco',chaleco:'Chaleco',orejeras:'Orejeras',gafas:'Gafas',guantes:'Guantes',mascarillas:'Mascarillas',calzado:'Calzado'}).map(([key,label])=><label key={key} className="flex items-center gap-2 rounded-xl border p-3 text-sm font-bold">
                  <input type="checkbox" checked={Boolean(editDraft.details?.epis?.[key])} onChange={e=>setEditDraft((d:any)=>({...d,details:{...(d.details||{}),epis:{...(d.details?.epis||{}),[key]:e.target.checked}}}))}/>
                  {label}
                </label>)}
              </div>
            </div>}
            {(editingCard.item.document_type==='maquinaria'||editingCard.item.document_type==='autorizacion_uso_maquinaria')&&<label className="block text-sm font-black">Maquinaria / equipos
              <textarea rows={4} value={editDraft.details?.maquinaria||''} onChange={e=>setEditDraft((d:any)=>({...d,details:{...(d.details||{}),maquinaria:e.target.value}}))} className="mt-2 w-full rounded-xl border px-3 py-3 bg-white dark:bg-slate-950"/>
            </label>}
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">
              Los trabajadores y sus firmas no se alteran desde esta edición para mantener la trazabilidad.
            </div>
          </>}

          {editingCard.kind==='document'&&(()=>{
            const def=ADDITIONAL_WORKSITE_DOCUMENTS[editingCard.item.document_type as AdditionalWorksiteDocumentType];
            return <div className="space-y-3">
              {(def?.fields||[]).map((field:any)=><label key={field.key} className="block text-sm font-black">{field.label}
                {field.type==='textarea'
                  ?<textarea rows={4} value={editDraft.answers?.[field.key]||''} onChange={e=>setEditDraft((d:any)=>({...d,answers:{...(d.answers||{}),[field.key]:e.target.value}}))} className="mt-2 w-full rounded-xl border px-3 py-3 bg-white dark:bg-slate-950"/>
                  :field.type==='select'
                    ?<select value={editDraft.answers?.[field.key]||''} onChange={e=>setEditDraft((d:any)=>({...d,answers:{...(d.answers||{}),[field.key]:e.target.value}}))} className="mt-2 min-h-[50px] w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-950"><option value="">Seleccionar…</option>{field.options?.map((o:string)=><option key={o}>{o}</option>)}</select>
                    :<input type={field.type||'text'} value={editDraft.answers?.[field.key]||''} onChange={e=>setEditDraft((d:any)=>({...d,answers:{...(d.answers||{}),[field.key]:e.target.value}}))} className="mt-2 min-h-[50px] w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-950"/>
                }
              </label>)}
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">Las firmas originales permanecen sin cambios.</div>
            </div>;
          })()}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t pt-4">
            <button onClick={()=>{setEditingCard(null);setEditDraft({});}} className="min-h-[48px] rounded-xl border px-4 py-3 text-sm font-black">Cancelar</button>
            <button disabled={editBusy||!editDraft.work_date} onClick={()=>void saveSupervisorEdit()} className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#00548E] px-5 py-3 text-sm font-black text-white disabled:opacity-50">
              {editBusy?<Loader2 className="w-4 h-4 animate-spin"/>:<Save className="w-4 h-4"/>}
              Guardar cambios
            </button>
          </div>
        </div>
      </div>
    </div>}


    {controlView==='activity'&&<div className="space-y-2">
      {!activity.length&&<div className="rounded-2xl bg-white dark:bg-slate-900 border p-8 text-center text-sm text-slate-500">Todavía no hay movimientos registrados.</div>}
      {activity.map(row=><div key={row.id} className="rounded-2xl bg-white dark:bg-slate-900 border p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-1 text-[10px] font-black ${row.actor_type==='supervisor'?'bg-blue-50 text-blue-800':row.actor_type==='encargado'?'bg-emerald-50 text-emerald-800':'bg-slate-100 text-slate-700'}`}>{row.actor_type==='supervisor'?'Supervisor':row.actor_type==='encargado'?'Encargado':'Sistema'}</span>
              <span className="text-sm font-black">{actionLabel(row.action)}</span>
            </div>
            <div className="mt-1 text-sm font-semibold">{entityLabel(row)}</div>
            <div className="mt-1 text-xs text-slate-500">{row.obra}{row.actor_name?' · '+row.actor_name:''}</div>
            {row.metadata?.correctionReason&&<div className="mt-2 text-xs font-bold text-amber-800">Motivo: {row.metadata.correctionReason}</div>}
            {typeof row.metadata?.signedCount==='number'&&<div className="mt-1 text-xs text-slate-500">Firmas: {row.metadata.signedCount}/{row.metadata.workerCount??'-'}</div>}
          </div>
          <time className="text-xs font-bold text-slate-500">{new Date(row.created_at).toLocaleString('es-ES')}</time>
        </div>
      </div>)}
    </div>}

    {controlView==='history'&&<div className="space-y-2">
      {!versions.length&&<div className="rounded-2xl bg-white dark:bg-slate-900 border p-8 text-center text-sm text-slate-500">Todavía no hay versiones finalizadas guardadas.</div>}
      {versions.map(version=><div key={version.id} className="rounded-2xl bg-white dark:bg-slate-900 border p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <div className="flex items-center gap-2"><History className="w-4 h-4 text-[#00548E]"/><span className="font-black">{entityLabel(version)}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black">Versión {version.version_no}</span></div>
            <div className="mt-1 text-xs text-slate-500">{version.obra} · {String(version.snapshot?.work_date||version.snapshot?.workDate||'').slice(0,10)}</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">Copia inalterable del estado en el momento de finalizar.</div>
          </div>
          <time className="text-xs font-bold text-slate-500">{new Date(version.created_at).toLocaleString('es-ES')}</time>
        </div>
      </div>)}
    </div>}
  </div>;
};