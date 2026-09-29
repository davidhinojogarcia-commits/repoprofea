import React, { useEffect, useMemo, useRef, useState } from 'react';
import { appConfirm, appPrompt } from '../src/lib/appDialog';
import { AlertTriangle, Building2, CalendarDays, CheckCircle2, Clock3, Download, FileSignature, FolderOpen, History, ListChecks, Loader2, MailCheck, Pencil, RefreshCw, RotateCcw, Save, Search, Trash2, Upload, X } from 'lucide-react';
import { supabase } from '../src/lib/supabase';
import { downloadPDF } from '../src/lib/exportUtils';
import { ADDITIONAL_WORKSITE_DOCUMENTS, type AdditionalWorksiteDocumentType } from '../src/lib/worksiteAdditionalDocumentsPdf';
import { generateForemanAttendancePdf, generateForemanCompletedDocumentPdf, generateForemanMandatoryDocumentPdf } from '../src/lib/foremanDocumentsPdf';
import { processAdministrativeMandatoryInbox, processManualMandatoryFiles } from '../src/lib/mandatoryEmailIntake';
import { sendPdfWithConnectedGmail } from '../src/lib/gmailConnection';
import { loadAppBusinessSettings } from '../src/services/appSettingsService';
import { deleteForemanMandatoryDocument, getSupervisorMandatoryPdf, markMandatoryDocumentReturned, returnForemanItemForCorrection, reviewForemanItem, updateForemanMandatoryDocument } from '../src/services/foremanPortalService';
import type { ForemanAttendanceDay, ForemanCompletedDocument, ForemanMandatoryDocument } from '../src/services/foremanPortalService';
import { pdfBlobFromBase64, type MandatoryWorkerAnchor } from '../src/lib/mandatoryPdfOverlay';

const MandatoryPdfAnchorEditor = React.lazy(() => import('./MandatoryPdfAnchorEditor'));

type DbDocument = { id:string; owner_id:string; obra:string; work_date:string; document_type:string; worker_id?:number|null; worker_snapshot:any; answers:Record<string,string>; signatures:Record<string,string>; completed_by:string; status:'draft'|'completed'|'reviewed'; completed_at?:string|null; updated_at?:string|null; correction_pending?:boolean; correction_reason?:string|null; correction_requested_at?:string|null };
type DbAttendance = { id:string; owner_id:string; obra:string; work_date:string; foreman_name:string; rows:any[]; status:'draft'|'completed'|'reviewed'; completed_at?:string|null; updated_at?:string|null; correction_pending?:boolean; correction_reason?:string|null; correction_requested_at?:string|null };
type DbMandatory = { id:string; owner_id:string; obra:string; period_key:string; work_date:string; document_type:'inicio'|'control_presencia'|'epis'|'formacion'|'maquinaria'|'autorizacion_uso_maquinaria'; category:string; workers:any[]; signatures:Record<string,any>; details?:Record<string,any>; status:'pending'|'in_progress'|'returned'|'completed'|'reviewed'; completed_at?:string|null; updated_at?:string|null; source_gmail_message_id?:string|null; source_gmail_thread_id?:string|null; source_rfc_message_id?:string|null; source_email_from?:string|null; source_email_subject?:string|null; source_attachment_name?:string|null; returned_gmail_message_id?:string|null; returned_at?:string|null; correction_pending?:boolean; correction_reason?:string|null; correction_requested_at?:string|null };

type ActivityRow = { id:number; obra:string; entity_type:string; entity_id?:string|null; document_type?:string|null; action:string; actor_type:'supervisor'|'encargado'|'sistema'; actor_name?:string; worker_id?:number|null; metadata?:Record<string,any>; created_at:string };
type VersionRow = { id:string; obra:string; entity_type:string; entity_id:string; version_no:number; snapshot:Record<string,any>; created_at:string };

const mandatoryDocumentLabel = (type:string) => ({
  inicio:'Inicio / incorporación',
  control_presencia:'Control de presencia',
  epis:'Entrega de EPIs',
  formacion:'Formación e información',
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
  const [selectedDocsWork,setSelectedDocsWork]=useState(()=>localStorage.getItem('profea:foreman-docs:last-work')||'');
  const [selectedDocsMonth,setSelectedDocsMonth]=useState(()=>localStorage.getItem('profea:foreman-docs:last-month')||'');
  const [mailBusy,setMailBusy]=useState(false);
  const [mailMessage,setMailMessage]=useState('');
  const [importBusy,setImportBusy]=useState(false);
  const [editingMandatory,setEditingMandatory]=useState<DbMandatory|null>(null);
  const [editWorkers,setEditWorkers]=useState<any[]>([]);
  const [editWorkerIds,setEditWorkerIds]=useState<Set<string>>(new Set());
  const [editWorkDate,setEditWorkDate]=useState('');
  const [editCategory,setEditCategory]=useState('');
  const [editBusy,setEditBusy]=useState(false);
  const [editingCard,setEditingCard]=useState<any|null>(null);
  const [genericEditDraft,setGenericEditDraft]=useState<any>({});
  const mandatoryFileInputRef=useRef<HTMLInputElement>(null);
  const completedBaselineRef=useRef<Set<string>|null>(null);
  const activityBaselineRef=useRef<number|null>(null);
  const [completionNotice,setCompletionNotice]=useState('');
  const [activityNotice,setActivityNotice]=useState('');
  const [anchorEditing,setAnchorEditing]=useState<DbMandatory|null>(null);
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
  const visibleMandatory = useMemo(
    () => mandatory.filter(item => ['inicio','control_presencia','epis','formacion','maquinaria','autorizacion_uso_maquinaria'].includes(String(item.document_type || ''))),
    [mandatory],
  );

  const allCards=useMemo(()=>{
    const dayCards=attendance.map(item=>({kind:'attendance' as const,id:item.id,obra:item.obra,date:item.work_date,title:'Registro diario de jornada',subtitle:item.foreman_name,status:item.status,item}));
    const mandatoryCards=visibleMandatory.map(item=>({kind:'mandatory' as const,id:item.id,obra:item.obra,date:item.work_date,title:mandatoryDocumentLabel(item.document_type),subtitle:item.category||'',status:item.status,item}));
    const docCards=documents.map(item=>({kind:'document' as const,id:item.id,obra:item.obra,date:item.work_date,title:ADDITIONAL_WORKSITE_DOCUMENTS[item.document_type as AdditionalWorksiteDocumentType]?.short||item.document_type,subtitle:item.worker_snapshot?.apellidosNombre||item.completed_by,status:item.status,item}));
    return [...dayCards,...mandatoryCards,...docCards]
      .sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  },[attendance,visibleMandatory,documents]);

  const cards=useMemo(()=>allCards
    .filter(card=>filter==='all'||(filter==='attendance'&&card.kind==='attendance')||(filter==='mandatory'&&card.kind==='mandatory')||(filter==='documents'&&card.kind==='document')||(filter==='pending'&&card.status!=='reviewed'))
    .filter(card=>!term||[card.obra,card.title,card.subtitle,card.date].some(v=>String(v||'').toLowerCase().includes(term))),
  [allCards,filter,term]);

  const workDocumentGroups=useMemo(()=>{
    const map=new Map<string,{total:number;pending:number}>();
    allCards.forEach(card=>{
      const work=String(card.obra||'Sin obra').trim()||'Sin obra';
      const current=map.get(work)||{total:0,pending:0};
      current.total+=1;
      if(card.status!=='reviewed')current.pending+=1;
      map.set(work,current);
    });
    return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0],'es',{numeric:true}));
  },[allCards]);

  useEffect(()=>{
    if(!workDocumentGroups.length){
      if(selectedDocsWork)setSelectedDocsWork('');
      return;
    }
    if(!selectedDocsWork||!workDocumentGroups.some(([work])=>work===selectedDocsWork)){
      setSelectedDocsWork(workDocumentGroups[0][0]);
      setSelectedDocsMonth('');
    }
  },[workDocumentGroups,selectedDocsWork]);

  useEffect(()=>{
    if(selectedDocsWork)localStorage.setItem('profea:foreman-docs:last-work',selectedDocsWork);
  },[selectedDocsWork]);

  useEffect(()=>{
    if(selectedDocsMonth)localStorage.setItem('profea:foreman-docs:last-month',selectedDocsMonth);
  },[selectedDocsMonth]);

  const monthLabel=(key:string)=>{
    const [year,month]=key.split('-');
    const names=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return `${names[Math.max(0,Number(month)-1)]||month} ${year}`;
  };

  const monthDocumentGroups=useMemo(()=>{
    const map=new Map<string,{total:number;pending:number}>();
    allCards.filter(card=>String(card.obra||'Sin obra').trim()===selectedDocsWork).forEach(card=>{
      const key=String(card.date||'').slice(0,7)||'Sin fecha';
      const current=map.get(key)||{total:0,pending:0};
      current.total+=1;
      if(card.status!=='reviewed')current.pending+=1;
      map.set(key,current);
    });
    return [...map.entries()].sort((a,b)=>b[0].localeCompare(a[0]));
  },[allCards,selectedDocsWork]);

  useEffect(()=>{
    if(!monthDocumentGroups.length){
      if(selectedDocsMonth)setSelectedDocsMonth('');
      return;
    }
    if(!selectedDocsMonth||!monthDocumentGroups.some(([month])=>month===selectedDocsMonth)){
      setSelectedDocsMonth(monthDocumentGroups[0][0]);
    }
  },[monthDocumentGroups,selectedDocsMonth]);

  const visibleCards=useMemo(()=>cards.filter(card=>
    String(card.obra||'Sin obra').trim()===selectedDocsWork &&
    (String(card.date||'').slice(0,7)||'Sin fecha')===selectedDocsMonth
  ),[cards,selectedDocsWork,selectedDocsMonth]);

  const selectedWorkStats=useMemo(()=>{
    const group=workDocumentGroups.find(([work])=>work===selectedDocsWork);
    return group?.[1]||{total:0,pending:0};
  },[workDocumentGroups,selectedDocsWork]);
  const markReviewed=async(kind:'attendance'|'mandatory'|'document',id:string)=>{
    await reviewForemanItem(kind,id);
    await refresh(true);
  };
  const returnForCorrection=async(kind:'attendance'|'mandatory'|'document',id:string)=>{
    const reason=await appPrompt(
      'Indica al encargado qué debe corregir:',
      { title: 'Solicitar corrección', confirmLabel: 'Enviar corrección', placeholder: 'Describe qué debe corregirse…' },
    );
    if(!reason?.trim())return;
    await returnForemanItemForCorrection(kind,id,reason.trim());
    await refresh(true);
  };
  const downloadStoredMandatoryPdf=async(item:DbMandatory,variant:'original'|'signed')=>{
    const stored=await getSupervisorMandatoryPdf(item.id,variant);
    const blob=pdfBlobFromBase64(stored.base64);
    const suffix=stored.variant==='signed'?'_FIRMADO':'_ORIGINAL';
    const base=String(stored.filename||mandatoryDocumentLabel(item.document_type)||'documento').replace(/\.pdf$/i,'');
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download=`${base}${suffix}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  const openPdf=async(card:any)=>{
    try{
      if(card.kind==='attendance'){
        const day:ForemanAttendanceDay={id:card.item.id,workDate:card.item.work_date,rows:card.item.rows||[],status:card.item.status,completedAt:card.item.completed_at,updatedAt:card.item.updated_at};
        const out=generateForemanAttendancePdf(day,card.item.obra,card.item.foreman_name); downloadPDF(out.doc,out.filename); return;
      }
      if(card.kind==='mandatory'){
        const m=card.item as DbMandatory;
        if(m.details?.originalPdfMode==='overlay'){
          await downloadStoredMandatoryPdf(m,m.status==='completed'||m.status==='reviewed'?'signed':'original');
          return;
        }
        const record:ForemanMandatoryDocument={id:m.id,workDate:m.work_date,periodKey:m.period_key,documentType:m.document_type,category:m.category,workers:m.workers||[],signatures:m.signatures||{},status:m.status,completedAt:m.completed_at,details:m.details||{}};
        const out=generateForemanMandatoryDocumentPdf(record,m.obra); downloadPDF(out.doc,out.filename); return;
      }
      const d=card.item as DbDocument;
      const record:ForemanCompletedDocument={id:d.id,workDate:d.work_date,documentType:d.document_type,workerId:d.worker_id,workerSnapshot:d.worker_snapshot||{},answers:d.answers||{},signatures:d.signatures||{},status:d.status,completedAt:d.completed_at};
      const out=generateForemanCompletedDocumentPdf(record,d.obra,d.completed_by); downloadPDF(out.doc,out.filename);
    }catch(error:any){
      setMailMessage(error?.message||'No se pudo abrir el PDF.');
    }
  };
  const approveAndReturnMandatory = async (item: DbMandatory) => {
    if (item.status !== 'completed') return;
    const settings=await loadAppBusinessSettings();
    const targetEmail=String(item.source_email_from || settings.administrative?.email || '').trim();
    if(!targetEmail){
      setMailMessage('No hay correo de la administrativa configurado.');
      return;
    }
    if (!(await appConfirm(
      '¿Aprobar este documento cumplimentado y enviarlo por Gmail a la administrativa?',
      { title: 'Aprobar y enviar', confirmLabel: 'Aprobar y enviar' },
    ))) return;
    setMailBusy(true);
    try {
      let file:File;
      if(item.details?.originalPdfMode==='overlay'){
        const stored=await getSupervisorMandatoryPdf(item.id,'signed');
        const blob=pdfBlobFromBase64(stored.base64);
        const base=String(stored.filename||mandatoryDocumentLabel(item.document_type)||'documento').replace(/\.pdf$/i,'');
        file=new File([blob],`${base}_FIRMADO.pdf`,{type:'application/pdf'});
      }else{
        const record:ForemanMandatoryDocument={
          id:item.id,workDate:item.work_date,periodKey:item.period_key,documentType:item.document_type,
          category:item.category,workers:item.workers||[],signatures:item.signatures||{},status:item.status,
          completedAt:item.completed_at,details:item.details||{}
        };
        const out=generateForemanMandatoryDocumentPdf(record,item.obra);
        const blob=out.doc.output('blob');
        file=new File([blob],out.filename,{type:'application/pdf'});
      }
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
  const openGenericEditor = (card:any) => {
    if (card.kind === 'attendance') {
      setGenericEditDraft({
        work_date: String(card.item.work_date || '').slice(0,10),
        foreman_name: String(card.item.foreman_name || ''),
        rows: (card.item.rows || []).map((row:any) => ({ ...row })),
      });
    } else if (card.kind === 'mandatory') {
      setGenericEditDraft({
        work_date: String(card.item.work_date || '').slice(0,10),
        category: String(card.item.category || ''),
        details: { ...(card.item.details || {}) },
      });
    } else {
      setGenericEditDraft({
        work_date: String(card.item.work_date || '').slice(0,10),
        answers: { ...(card.item.answers || {}) },
      });
    }
    setEditingCard(card);
  };

  const saveGenericEditor = async () => {
    if (!editingCard) return;
    if (!genericEditDraft.work_date) {
      window.alert('Indica la fecha del documento.');
      return;
    }
    setEditBusy(true);
    try {
      const table = editingCard.kind === 'attendance'
        ? 'foreman_attendance_days'
        : editingCard.kind === 'mandatory'
          ? 'foreman_mandatory_documents'
          : 'foreman_documents';
      let body:any = { updated_at: new Date().toISOString() };

      if (editingCard.kind === 'attendance') {
        body = {
          ...body,
          work_date: genericEditDraft.work_date,
          foreman_name: genericEditDraft.foreman_name || '',
          rows: genericEditDraft.rows || [],
        };
      } else if (editingCard.kind === 'mandatory') {
        body = {
          ...body,
          work_date: genericEditDraft.work_date,
          category: genericEditDraft.category || '',
          details: genericEditDraft.details || {},
        };
      } else {
        body = {
          ...body,
          work_date: genericEditDraft.work_date,
          answers: genericEditDraft.answers || {},
        };
      }

      await supabase.query(table, {
        method: 'PATCH',
        query: 'id=eq.' + encodeURIComponent(editingCard.id),
        body,
        prefer: 'return=minimal',
      });

      setMailMessage('Documento actualizado correctamente. El cambio ha quedado registrado en Actividad.');
      setEditingCard(null);
      setGenericEditDraft({});
      await refresh(true);
    } catch (error:any) {
      console.error('No se pudo editar el documento del encargado:', error);
      window.alert(error?.message || 'No se pudo guardar la edición.');
    } finally {
      setEditBusy(false);
    }
  };

  const deleteGenericItem = async (card:any) => {
    if (card.kind === 'mandatory') {
      await removeMandatoryDocument(card.item as DbMandatory);
      return;
    }
    const ok = await appConfirm(
      `¿Eliminar definitivamente “${card.title}” de ${card.obra}? La eliminación quedará registrada en Actividad y las versiones históricas ya guardadas se conservarán.`,
      { title: 'Eliminar documento', confirmLabel: 'Eliminar definitivamente' },
    );
    if (!ok) return;

    setEditBusy(true);
    try {
      const table = card.kind === 'attendance' ? 'foreman_attendance_days' : 'foreman_documents';
      await supabase.query(table, {
        method: 'DELETE',
        query: 'id=eq.' + encodeURIComponent(card.id),
        prefer: 'return=minimal',
      });
      if (editingCard?.id === card.id) {
        setEditingCard(null);
        setGenericEditDraft({});
      }
      setMailMessage('Documento eliminado correctamente. La eliminación ha quedado registrada en Actividad.');
      await refresh(true);
    } catch (error:any) {
      console.error('No se pudo eliminar el documento del encargado:', error);
      window.alert(error?.message || 'No se pudo eliminar el documento.');
    } finally {
      setEditBusy(false);
    }
  };

  const editAnyDocument = (card:any) => {
    if (
      card.kind === 'mandatory' &&
      ['inicio','control_presencia'].includes(String(card.item.document_type || ''))
    ) {
      void openMandatoryEditor(card.item as DbMandatory);
      return;
    }
    openGenericEditor(card);
  };

  const openMandatoryEditor = async (item: DbMandatory) => {
    setEditingMandatory(item);
    setEditWorkDate(String(item.work_date || '').slice(0,10));
    setEditCategory(item.document_type === 'control_presencia' ? '' : String(item.category || ''));
    setEditWorkerIds(new Set((item.workers || []).map((worker:any) => String(worker.id))));
    setEditBusy(true);
    try {
      const rows = await supabase.query('trabajadores', {
        query: `obra=eq.${encodeURIComponent(item.obra)}&select=id,apellidos_nombre,dni,categoria,obra,num_oferta,periodo_inicio,periodo_fin&order=apellidos_nombre.asc`,
      });
      const available = (Array.isArray(rows) ? rows : []).map((row:any) => ({
        id: row.id,
        apellidosNombre: row.apellidos_nombre,
        dni: row.dni,
        categoria: row.categoria,
        obra: row.obra,
        numOferta: row.num_oferta,
        periodoInicio: row.periodo_inicio,
        periodoFin: row.periodo_fin,
      }));
      const byId = new Map<string, any>();
      [...(item.workers || []), ...available].forEach((worker:any) => byId.set(String(worker.id), worker));
      setEditWorkers(Array.from(byId.values()).sort((a:any,b:any) => String(a.apellidosNombre || '').localeCompare(String(b.apellidosNombre || ''), 'es')));
    } catch (error:any) {
      window.alert(error?.message || 'No se pudieron cargar los trabajadores de la obra.');
      setEditWorkers(item.workers || []);
    } finally {
      setEditBusy(false);
    }
  };

  const saveMandatoryEditor = async () => {
    if (!editingMandatory) return;
    const selectedWorkers = editWorkers.filter((worker:any) => editWorkerIds.has(String(worker.id)));
    if (!selectedWorkers.length) {
      window.alert('Selecciona al menos un trabajador para el documento.');
      return;
    }
    if (!editWorkDate) {
      window.alert('Indica la fecha del documento.');
      return;
    }
    setEditBusy(true);
    try {
      await updateForemanMandatoryDocument({
        id: editingMandatory.id,
        workDate: editWorkDate,
        category: editingMandatory.document_type === 'control_presencia' ? '' : editCategory.trim(),
        workers: selectedWorkers,
        signatures: editingMandatory.signatures || {},
        status: editingMandatory.status,
        details: editingMandatory.details || {},
      });
      setMailMessage(`${mandatoryDocumentLabel(editingMandatory.document_type)} actualizado correctamente.`);
      setEditingMandatory(null);
      await refresh(true);
    } catch (error:any) {
      window.alert(error?.message || 'No se pudo actualizar el documento.');
    } finally {
      setEditBusy(false);
    }
  };

  const removeMandatoryDocument = async (item: DbMandatory) => {
    const ok = await appConfirm(
      `¿Eliminar definitivamente este documento de ${mandatoryDocumentLabel(item.document_type)} de ${item.obra}? Se eliminarán también sus evidencias de firma asociadas, pero la actividad histórica quedará registrada.`,
      { title: 'Eliminar documento', confirmLabel: 'Eliminar definitivamente' },
    );
    if (!ok) return;
    setEditBusy(true);
    try {
      await deleteForemanMandatoryDocument(item.id);
      if (editingMandatory?.id === item.id) setEditingMandatory(null);
      setMailMessage('Documento eliminado correctamente.');
      await refresh(true);
    } catch (error:any) {
      window.alert(error?.message || 'No se pudo eliminar el documento.');
    } finally {
      setEditBusy(false);
    }
  };

  const signedEntries=attendance.reduce((sum,d)=>sum+(d.rows||[]).filter((r:any)=>r.entrySignature).length,0);
  const signedExits=attendance.reduce((sum,d)=>sum+(d.rows||[]).filter((r:any)=>r.exitSignature).length,0);
  const pending=cards.filter(c=>c.status!=='reviewed').length;
  const correctionCount=visibleMandatory.filter(i=>i.correction_pending).length+documents.filter(i=>i.correction_pending).length+attendance.filter(i=>i.correction_pending).length;
  const incompleteCount=visibleMandatory.filter(i=>i.status==='pending'||i.status==='in_progress'||i.status==='returned').length+attendance.filter(i=>i.status==='draft').length;
  const reviewCount=visibleMandatory.filter(i=>i.status==='completed').length+documents.filter(i=>i.status==='completed').length+attendance.filter(i=>i.status==='completed').length;
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
        {([['Inicio / Control',visibleMandatory.length],['Documentos normalizados',documents.length],['Jornadas',attendance.length],['Firmas E/S',signedEntries+signedExits]] as [string,number][]).map(([label,value])=><div key={label} className="rounded-2xl bg-slate-50 dark:bg-slate-800 p-4"><div className="text-2xl font-black">{value}</div><div className="text-[11px] font-bold text-slate-500">{label}</div></div>)}
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

    {controlView==='status'&&<>
    <div className="lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-5 lg:items-start">
      <aside className="hidden lg:block rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm h-fit sticky top-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-[#00548E]"/><h2 className="font-black text-sm uppercase tracking-wider text-slate-700 dark:text-slate-200">Obras</h2></div>
          <span className="text-xs font-bold rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 px-2.5 py-1">{workDocumentGroups.length}</span>
        </div>
        <div className="space-y-2 max-h-[64vh] overflow-y-auto pr-1">
          {workDocumentGroups.map(([work,stats])=><button key={work} type="button" onClick={()=>{setSelectedDocsWork(work);setSelectedDocsMonth('')}} className={`w-full text-left rounded-xl border px-3.5 py-3 transition ${selectedDocsWork===work?'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-100 shadow-sm':'border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700'}`}>
            <div className="flex items-start justify-between gap-2"><div className="font-bold text-sm leading-tight">{work}</div>{stats.pending>0&&<span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-900">{stats.pending}</span>}</div><div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">{stats.total} documento(s)</div>
          </button>)}
        </div>
      </aside>
      <div className="min-w-0 space-y-3">
        <div className="lg:hidden rounded-2xl border bg-white dark:bg-slate-900 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase text-slate-700 dark:text-slate-200"><Building2 className="w-4 h-4 text-[#00548E]"/>Obras</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {workDocumentGroups.map(([work,stats])=><button key={work} type="button" onClick={()=>{setSelectedDocsWork(work);setSelectedDocsMonth('')}} className={`shrink-0 rounded-xl border px-3 py-2.5 text-left ${selectedDocsWork===work?'border-blue-500 bg-blue-50 text-blue-900 dark:bg-blue-950/30 dark:text-blue-100':'bg-white dark:bg-slate-900'}`}><div className="flex items-center gap-2"><div className="text-xs font-black">{work}</div>{stats.pending>0&&<span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-amber-900">{stats.pending}</span>}</div><div className="text-[10px] text-slate-600 dark:text-slate-300">{stats.total} doc.</div></button>)}
          </div>
        </div>

        <div className="rounded-2xl border bg-white dark:bg-slate-900 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div><div className="flex items-center gap-2"><FolderOpen className="w-4 h-4 text-[#00548E]"/><h2 className="font-black text-sm text-slate-900 dark:text-white">{selectedDocsWork||'Selecciona una obra'}</h2></div><p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{selectedWorkStats.total} documento(s) en esta obra · {selectedWorkStats.pending} pendiente(s) de revisión. Organizados por meses.</p></div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {monthDocumentGroups.map(([month,stats])=><button key={month} type="button" onClick={()=>setSelectedDocsMonth(month)} className={`shrink-0 rounded-xl border px-3 py-2.5 ${selectedDocsMonth===month?'border-[#00548E] bg-[#00548E] text-white':'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'}`}><div className="flex items-center gap-2 text-xs font-black"><CalendarDays className="w-3.5 h-3.5"/>{month==='Sin fecha'?'Sin fecha':monthLabel(month)}{stats.pending>0&&<span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${selectedDocsMonth===month?'bg-white/20 text-white':'bg-amber-100 text-amber-900'}`}>{stats.pending}</span>}</div><div className={`mt-0.5 text-[10px] ${selectedDocsMonth===month?'text-blue-100':'text-slate-600 dark:text-slate-300'}`}>{stats.total} documento(s)</div></button>)}
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border p-3 flex flex-col md:flex-row gap-2">
      <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por obra, trabajador, documento o fecha…" className="w-full rounded-xl border pl-9 pr-3 py-2.5 bg-white dark:bg-slate-950"/></div>
      <select value={filter} onChange={e=>setFilter(e.target.value as any)} className="rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-950 font-bold text-sm"><option value="all">Todo</option><option value="mandatory">Inicio y control de presencia</option><option value="attendance">Registro diario</option><option value="documents">Documentos normalizados</option><option value="pending">Pendientes de revisar ({pending})</option></select>
    </div>
    {loading?<div className="rounded-2xl bg-white border p-10 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-[#00548E]"/></div>:cards.length===0?<div className="rounded-2xl bg-white dark:bg-slate-900 border p-10 text-center text-sm text-slate-600 dark:text-slate-300">Todavía no hay documentación enviada por encargados.</div>:visibleCards.length===0?<div className="rounded-2xl bg-white dark:bg-slate-900 border p-8 text-center text-sm text-slate-600 dark:text-slate-300">No hay documentos para esta obra y mes con los filtros actuales.</div>:<div className="relative z-0 space-y-4">{visibleCards.map(card=><article key={card.kind+card.id} className="relative isolate z-0 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3"><div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className={card.kind==='attendance'?'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black bg-blue-50 text-blue-800 border border-blue-200':card.kind==='mandatory'?'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black bg-amber-50 text-amber-800 border border-amber-200':'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black bg-violet-50 text-violet-800 border border-violet-200'}>{card.kind==='attendance'?<Clock3 className="w-3 h-3"/>:<FileSignature className="w-3 h-3"/>}{card.kind==='attendance'?'Registro diario':card.kind==='mandatory'?'Obligatorio':'Documento'}</span><span className={card.status==='reviewed'?'rounded-full px-2 py-1 text-[10px] font-black bg-slate-100 text-slate-700':card.status==='completed'?'rounded-full px-2 py-1 text-[10px] font-black bg-emerald-50 text-emerald-700':card.status==='in_progress'?'rounded-full px-2 py-1 text-[10px] font-black bg-blue-50 text-blue-800':card.status==='returned'?'rounded-full px-2 py-1 text-[10px] font-black bg-amber-100 text-amber-900':'rounded-full px-2 py-1 text-[10px] font-black bg-amber-50 text-amber-800'}>{card.status==='reviewed'?'Enviado / revisado':card.status==='completed'?'Cumplimentado':card.status==='in_progress'?'En cumplimentación':card.status==='returned'?'Devuelto para corregir':'Pendiente de firma'}</span></div>
        <h3 className="mt-2 font-black text-slate-900 dark:text-white">{card.title}</h3><p className="text-xs text-slate-500">{card.obra} · {String(card.date).slice(0,10)}{card.subtitle?' · '+card.subtitle:''}</p>{card.kind==='attendance'&&<p className="text-xs mt-1 text-slate-500">{card.item.rows?.filter((r:any)=>r.entrySignature).length||0} entradas · {card.item.rows?.filter((r:any)=>r.exitSignature).length||0} salidas firmadas</p>}{card.kind==='mandatory'&&<p className="text-xs mt-1 text-slate-500">{Object.keys(card.item.signatures||{}).length}/{card.item.workers?.length||0} firmas recogidas</p>}{card.item.correction_pending&&<p className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-xs font-bold text-amber-900">Corrección solicitada: {card.item.correction_reason||'Revisar documento'}</p>}</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={()=>void openPdf(card)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black"><Download className="w-4 h-4"/>{card.kind==='mandatory'&&card.item.details?.originalPdfMode==='overlay'&&(card.status==='completed'||card.status==='reviewed')?'PDF firmado':'PDF'}</button>
          {card.kind==='mandatory'&&card.item.details?.originalPdfMode==='overlay'&&<>
            <button onClick={()=>void downloadStoredMandatoryPdf(card.item as DbMandatory,'original')} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-black text-slate-700"><FileSignature className="w-4 h-4"/>Original</button>
            {card.status!=='completed'&&card.status!=='reviewed'&&<button onClick={()=>setAnchorEditing(card.item as DbMandatory)} className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-black text-amber-900"><Pencil className="w-4 h-4"/>Ajustar zonas de firma</button>}
          </>}
          <button onClick={()=>editAnyDocument(card)} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-800 px-3 py-2.5 text-xs font-black dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200"><Pencil className="w-4 h-4"/>Editar</button>
          <button onClick={()=>void deleteGenericItem(card)} disabled={editBusy} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2.5 text-xs font-black disabled:opacity-50 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"><Trash2 className="w-4 h-4"/>Eliminar</button>
          {card.kind==='mandatory' && card.status==='completed' && ['inicio','control_presencia'].includes(String(card.item.document_type||'')) && (
            <button disabled={mailBusy} onClick={()=>void approveAndReturnMandatory(card.item as DbMandatory)} className="inline-flex items-center gap-2 rounded-xl bg-[#00548E] text-white px-3 py-2.5 text-xs font-black disabled:opacity-50"><MailCheck className="w-4 h-4"/>{card.item.source_gmail_message_id?'Aprobar y devolver por Gmail':'Aprobar y enviar a administrativa'}</button>
          )}
          {card.status==='completed' && !(card.kind==='mandatory' && card.item.source_gmail_message_id) && (
            <button onClick={()=>void markReviewed(card.kind==='attendance'?'attendance':card.kind==='mandatory'?'mandatory':'document',card.id)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-3 py-2.5 text-xs font-black"><CheckCircle2 className="w-4 h-4"/>Marcar revisado</button>
          )}
          {(card.status==='completed'||card.status==='reviewed')&&(
            <button onClick={()=>void returnForCorrection(card.kind==='attendance'?'attendance':card.kind==='mandatory'?'mandatory':'document',card.id)} className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2.5 text-xs font-black"><RotateCcw className="w-4 h-4"/>Devolver para corregir</button>
          )}
        </div>
      </div>
    </article>)}</div>}
      </div>
    </div>
    </>}

    {anchorEditing&&<React.Suspense fallback={null}><MandatoryPdfAnchorEditor
      documentId={anchorEditing.id}
      title={`${mandatoryDocumentLabel(anchorEditing.document_type)} · ${anchorEditing.obra}`}
      obra={anchorEditing.obra}
      anchors={(Array.isArray(anchorEditing.details?.workerAnchors)?anchorEditing.details?.workerAnchors:[]) as MandatoryWorkerAnchor[]}
      signedWorkerIds={Object.keys(anchorEditing.signatures||{}).map(Number).filter(Number.isFinite)}
      onCancel={()=>setAnchorEditing(null)}
      onSave={async anchors=>{
        const unresolved=anchors.filter(anchor=>!anchor.resolved).length;
        const importedWorkerIds=anchors
          .map(anchor=>Number(anchor.workerId))
          .filter((id,index,list)=>Number.isFinite(id)&&id>0&&list.indexOf(id)===index);
        await supabase.query('foreman_mandatory_documents',{
          method:'PATCH',
          query:'id=eq.'+encodeURIComponent(anchorEditing.id),
          body:{
            details:{
              ...(anchorEditing.details||{}),
              workerAnchors:anchors,
              importedWorkerIds,
              unresolvedAnchorCount:unresolved,
            },
            updated_at:new Date().toISOString(),
          },
          prefer:'return=minimal',
        });
        setAnchorEditing(null);
        setMailMessage('Posiciones de firma guardadas sobre el PDF original.');
        await refresh(true);
      }}
    /></React.Suspense>}

    {editingCard&&<div className="fixed inset-0 z-[11500] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[92dvh] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-slate-950 via-[#00548E] to-[#003f6b] px-5 py-4 text-white">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[.16em] text-blue-100">GestionProfea · Edición del supervisor</div>
            <h3 className="text-lg font-black">{editingCard.title}</h3>
            <p className="text-xs text-blue-100">{editingCard.obra} · Las firmas existentes se conservan.</p>
          </div>
          <button type="button" onClick={()=>{setEditingCard(null);setGenericEditDraft({});}} className="grid h-10 w-10 place-items-center rounded-xl bg-white text-slate-900" aria-label="Cerrar"><X className="w-5 h-5"/></button>
        </div>

        <div className="max-h-[calc(92dvh-9rem)] overflow-y-auto p-5 space-y-5">
          <label className="block text-sm font-black text-slate-700 dark:text-slate-200">Fecha
            <input type="date" value={genericEditDraft.work_date||''} onChange={e=>setGenericEditDraft((d:any)=>({...d,work_date:e.target.value}))} className="mt-2 min-h-[48px] w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-950"/>
          </label>

          {editingCard.kind==='attendance'&&<>
            <label className="block text-sm font-black text-slate-700 dark:text-slate-200">Encargado / recurso preventivo
              <input value={genericEditDraft.foreman_name||''} onChange={e=>setGenericEditDraft((d:any)=>({...d,foreman_name:e.target.value}))} className="mt-2 min-h-[48px] w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-950"/>
            </label>
            <div>
              <div className="mb-2 text-sm font-black text-slate-800 dark:text-slate-100">Horario por trabajador</div>
              <div className="space-y-2">
                {(genericEditDraft.rows||[]).map((row:any,index:number)=><div key={row.workerId||index} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_130px_130px] sm:items-end">
                  <div><div className="text-sm font-black">{row.name}</div><div className="text-xs text-slate-600 dark:text-slate-300">{row.dni} · {row.category}</div></div>
                  <label className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-300">Entrada
                    <input type="time" value={row.entryTime||''} onChange={e=>setGenericEditDraft((d:any)=>({...d,rows:d.rows.map((r:any,i:number)=>i===index?{...r,entryTime:e.target.value}:r)}))} className="mt-1 w-full rounded-lg border px-2 py-2 bg-white dark:bg-slate-950"/>
                  </label>
                  <label className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-300">Salida
                    <input type="time" value={row.exitTime||''} onChange={e=>setGenericEditDraft((d:any)=>({...d,rows:d.rows.map((r:any,i:number)=>i===index?{...r,exitTime:e.target.value}:r)}))} className="mt-1 w-full rounded-lg border px-2 py-2 bg-white dark:bg-slate-950"/>
                  </label>
                </div>)}
              </div>
            </div>
          </>}

          {editingCard.kind==='mandatory'&&editingCard.item.document_type==='epis'&&<div>
            <div className="mb-2 text-sm font-black text-slate-800 dark:text-slate-100">EPIs entregados</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries({casco:'Casco',chaleco:'Chaleco',orejeras:'Orejeras',gafas:'Gafas',guantes:'Guantes',mascarillas:'Mascarillas',calzado:'Calzado'}).map(([key,label])=><label key={key} className="flex items-center gap-2 rounded-xl border p-3 text-sm font-bold">
                <input type="checkbox" checked={Boolean(genericEditDraft.details?.epis?.[key])} onChange={e=>setGenericEditDraft((d:any)=>({...d,details:{...(d.details||{}),epis:{...(d.details?.epis||{}),[key]:e.target.checked}}}))}/>
                {label}
              </label>)}
            </div>
          </div>}

          {editingCard.kind==='mandatory'&&['maquinaria','autorizacion_uso_maquinaria'].includes(String(editingCard.item.document_type||''))&&<label className="block text-sm font-black text-slate-700 dark:text-slate-200">Maquinaria / equipos
            <textarea rows={4} value={genericEditDraft.details?.maquinaria||''} onChange={e=>setGenericEditDraft((d:any)=>({...d,details:{...(d.details||{}),maquinaria:e.target.value}}))} className="mt-2 w-full rounded-xl border px-3 py-3 bg-white dark:bg-slate-950"/>
          </label>}

          {editingCard.kind==='mandatory'&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Los trabajadores y sus firmas se mantienen intactos al editar estos datos.</div>}

          {editingCard.kind==='document'&&(()=>{
            const def=ADDITIONAL_WORKSITE_DOCUMENTS[editingCard.item.document_type as AdditionalWorksiteDocumentType];
            return <div className="space-y-3">
              {(def?.fields||[]).map((field:any)=><label key={field.key} className="block text-sm font-black text-slate-700 dark:text-slate-200">{field.label}
                {field.type==='textarea'
                  ?<textarea rows={4} value={genericEditDraft.answers?.[field.key]||''} onChange={e=>setGenericEditDraft((d:any)=>({...d,answers:{...(d.answers||{}),[field.key]:e.target.value}}))} className="mt-2 w-full rounded-xl border px-3 py-3 bg-white dark:bg-slate-950"/>
                  :field.type==='select'
                    ?<select value={genericEditDraft.answers?.[field.key]||''} onChange={e=>setGenericEditDraft((d:any)=>({...d,answers:{...(d.answers||{}),[field.key]:e.target.value}}))} className="mt-2 min-h-[48px] w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-950"><option value="">Seleccionar…</option>{field.options?.map((option:string)=><option key={option}>{option}</option>)}</select>
                    :<input type={field.type||'text'} value={genericEditDraft.answers?.[field.key]||''} onChange={e=>setGenericEditDraft((d:any)=>({...d,answers:{...(d.answers||{}),[field.key]:e.target.value}}))} className="mt-2 min-h-[48px] w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-950"/>
                }
              </label>)}
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Las firmas originales permanecen sin cambios.</div>
            </div>;
          })()}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t bg-slate-50 p-4 sm:flex-row sm:justify-between dark:border-slate-700 dark:bg-slate-950">
          <button type="button" disabled={editBusy} onClick={()=>void deleteGenericItem(editingCard)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-black text-rose-700 dark:bg-slate-900"><Trash2 className="w-4 h-4"/>Eliminar documento</button>
          <div className="flex gap-2">
            <button type="button" onClick={()=>{setEditingCard(null);setGenericEditDraft({});}} className="min-h-11 rounded-xl border px-4 py-2.5 text-sm font-black">Cancelar</button>
            <button type="button" disabled={editBusy||!genericEditDraft.work_date} onClick={()=>void saveGenericEditor()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#00548E] px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{editBusy?<Loader2 className="w-4 h-4 animate-spin"/>:<Save className="w-4 h-4"/>}Guardar cambios</button>
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

    {editingMandatory&&<div className="fixed inset-0 z-[11500] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[92dvh] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-slate-950 via-[#00548E] to-[#003f6b] px-5 py-4 text-white">
          <div><div className="text-[10px] font-black uppercase tracking-[.16em] text-blue-100">GestionProfea</div><h3 className="text-lg font-black">Editar {mandatoryDocumentLabel(editingMandatory.document_type)}</h3><p className="text-xs text-blue-100">{editingMandatory.obra}</p></div>
          <button type="button" onClick={()=>setEditingMandatory(null)} className="grid h-10 w-10 place-items-center rounded-xl bg-white text-slate-900" aria-label="Cerrar"><X className="w-5 h-5"/></button>
        </div>
        <div className="max-h-[calc(92dvh-9rem)] overflow-y-auto p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-black text-slate-700 dark:text-slate-200">Fecha
              <input type="date" value={editWorkDate} onChange={e=>setEditWorkDate(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2.5 bg-white dark:bg-slate-950"/>
            </label>
            <label className="text-xs font-black text-slate-700 dark:text-slate-200">Categoría
              <input disabled={editingMandatory.document_type==='control_presencia'} value={editingMandatory.document_type==='control_presencia'?'Todas las categorías':editCategory} onChange={e=>setEditCategory(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2.5 bg-white disabled:bg-slate-100 dark:bg-slate-950 dark:disabled:bg-slate-800"/>
            </label>
          </div>
          <div className="mt-5">
            <div className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-black">Trabajadores incluidos</h4><p className="text-xs text-slate-500">Marca o desmarca los trabajadores que deben aparecer en el documento.</p></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-800">{editWorkerIds.size} seleccionados</span></div>
            <div className="mt-3 max-h-72 overflow-y-auto rounded-2xl border divide-y dark:divide-slate-700">
              {editBusy&&!editWorkers.length?<div className="p-6 text-center text-sm text-slate-500"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin"/>Cargando trabajadores…</div>:editWorkers.map((worker:any)=><label key={worker.id} className="flex cursor-pointer items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-800">
                <input type="checkbox" checked={editWorkerIds.has(String(worker.id))} onChange={e=>setEditWorkerIds(previous=>{const next=new Set(previous);if(e.target.checked)next.add(String(worker.id));else next.delete(String(worker.id));return next;})} className="h-5 w-5 rounded border-slate-300"/>
                <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{worker.apellidosNombre||'Trabajador'}</span><span className="block text-xs text-slate-500">{worker.dni||'Sin DNI'}{worker.categoria?' · '+worker.categoria:''}</span></span>
                {editingMandatory.signatures?.[String(worker.id)]&&<span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">Firmado</span>}
              </label>)}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Si eliminas un trabajador del documento, su firma dejará de formar parte de este documento. Las firmas de los trabajadores que permanezcan seleccionados se conservarán.</p>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t bg-slate-50 p-4 sm:flex-row sm:justify-between dark:border-slate-700 dark:bg-slate-950">
          <button type="button" disabled={editBusy} onClick={()=>void removeMandatoryDocument(editingMandatory)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-black text-rose-700 dark:bg-slate-900"><Trash2 className="w-4 h-4"/>Eliminar documento</button>
          <div className="flex gap-2"><button type="button" onClick={()=>setEditingMandatory(null)} className="min-h-11 rounded-xl border px-4 py-2.5 text-sm font-black">Cancelar</button><button type="button" disabled={editBusy} onClick={()=>void saveMandatoryEditor()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#00548E] px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{editBusy?<Loader2 className="w-4 h-4 animate-spin"/>:<Save className="w-4 h-4"/>}Guardar cambios</button></div>
        </div>
      </div>
    </div>}
  </div>;
};