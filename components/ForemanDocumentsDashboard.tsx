import { hasOverlappingMandatorySignatures } from '../src/lib/mandatorySignatureGeometry';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { appAlert, appConfirm, appPrompt } from '../src/lib/appDialog';
import { AlertTriangle, Building2, CalendarDays, CheckCircle2, Clock3, Download, FileSignature, FolderOpen, Send, Loader2, MailCheck, Pencil, RefreshCw, RotateCcw, Save, Search, Trash2, Upload, X } from 'lucide-react';
import { getSessionUser, supabase } from '../src/lib/supabase';
import { ForemanDashboardLoader } from '../src/services/foremanDashboardLoader';
import { claimMorningRefresh, FOREMAN_SCHEDULE_CHECK_MS } from '../src/services/foremanMorningRefresh';
import { downloadPDF } from '../src/lib/exportUtils';
import { ADDITIONAL_WORKSITE_DOCUMENTS, type AdditionalWorksiteDocumentType } from '../src/lib/worksiteAdditionalDocumentsPdf';
import { generateForemanAttendancePdf, generateForemanCompletedDocumentPdf, generateForemanMandatoryDocumentPdf } from '../src/lib/foremanDocumentsPdf';
import { processAdministrativeMandatoryInbox, processManualMandatoryFiles } from '../src/lib/mandatoryEmailIntake';
import { sendPdfWithConnectedGmail } from '../src/lib/gmailConnection';
import { loadAppBusinessSettings } from '../src/services/appSettingsService';
import { deleteForemanMandatoryDocument, deleteForemanMandatoryDocuments, getSupervisorMandatoryPdf, getSupervisorMandatorySignatures, markMandatoryDocumentReturned, removeSupervisorMandatoryWorker, returnForemanItemForCorrection, reviewForemanItem, updateForemanMandatoryDocument, saveSupervisorMandatoryDraft, loadSupervisorMandatoryEditorDocument } from '../src/services/foremanPortalService';
import type { ForemanAttendanceDay, ForemanCompletedDocument, ForemanMandatoryDocument } from '../src/services/foremanPortalService';
import { buildSignedMandatoryPdf, fileToBase64, pdfBlobFromBase64, pdfBlobFromBytes, type MandatoryWorkerAnchor } from '../src/lib/mandatoryPdfOverlay';
import MandatoryPdfAnchorEditor from './MandatoryPdfAnchorEditor';
import ModalPortal from './ModalPortal';
import MandatoryWorksiteReviewModal from './MandatoryWorksiteReviewModal';
import { assignMandatoryDocumentV2, confirmMandatoryWorksiteV2, withdrawMandatoryDocumentV2, getSupervisorMandatorySignedPdfV2, saveMandatoryWorkerSelectionV2, returnMandatoryDocumentV2, reviewSubmittedMandatoryDocumentV2, reopenMandatoryDocumentV2 } from '../src/services/mandatoryTraceabilityServiceV2';


type DbDocument = { id:string; owner_id:string; obra:string; work_date:string; document_type:string; worker_id?:number|null; worker_snapshot:any; answers:Record<string,string>; signatures:Record<string,string>; completed_by:string; status:'draft'|'completed'|'reviewed'; completed_at?:string|null; updated_at?:string|null; correction_pending?:boolean; correction_reason?:string|null; correction_requested_at?:string|null };
type DbAttendance = { id:string; owner_id:string; obra:string; work_date:string; foreman_name:string; rows:any[]; status:'draft'|'completed'|'reviewed'; completed_at?:string|null; updated_at?:string|null; correction_pending?:boolean; correction_reason?:string|null; correction_requested_at?:string|null };
type DbMandatory = { id:string; owner_id:string; obra:string; period_key:string; work_date:string; document_type:'inicio'|'control_presencia'|'epis'|'formacion'|'maquinaria'|'autorizacion_uso_maquinaria'; category:string; workers:any[]; signatures:Record<string,any>; details?:Record<string,any>; lifecycle_status?:string|null; assigned_at?:string|null; status:'pending'|'in_progress'|'returned'|'completed'|'reviewed'; completed_at?:string|null; updated_at?:string|null; source_gmail_message_id?:string|null; source_gmail_thread_id?:string|null; source_rfc_message_id?:string|null; source_email_from?:string|null; source_email_subject?:string|null; source_attachment_name?:string|null; returned_gmail_message_id?:string|null; returned_at?:string|null; correction_pending?:boolean; correction_reason?:string|null; correction_requested_at?:string|null };


const mandatoryDocumentLabel = (type:string) => ({
  inicio:'Inicio / incorporación',
  control_presencia:'Control de presencia',
  epis:'Entrega de EPIs',
  formacion:'Formación e información',
  maquinaria:'Autorización de maquinaria',
  autorizacion_uso_maquinaria:'Autorización al uso de maquinaria',
} as Record<string,string>)[type] || type;

const importedWorkersMissingFromDirectory = (item:DbMandatory): any[] => {
  // Control de presencia es independiente del Directorio: sus personas proceden
  // exclusivamente del PDF importado y no deben marcarse como "no localizadas".
  if(String(item.document_type||'')!=='inicio')return [];
  const imported=Array.isArray(item.details?.importedWorkers)?item.details?.importedWorkers:[];
  return imported.filter((worker:any)=>Number(worker?.id)<0);
};

export const ForemanDocumentsDashboard: React.FC = () => {
  const [documents,setDocuments]=useState<DbDocument[]>([]);
  const [attendance,setAttendance]=useState<DbAttendance[]>([]);
  const [mandatory,setMandatory]=useState<DbMandatory[]>([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState<'all'|'attendance'|'mandatory'|'documents'|'pending'>('all');
  const [selectedDocsWork,setSelectedDocsWork]=useState(()=>localStorage.getItem('profea:foreman-docs:last-work')||'');
  const [selectedDocsMonth,setSelectedDocsMonth]=useState(()=>localStorage.getItem('profea:foreman-docs:last-month')||'');
  const [mailBusy,setMailBusy]=useState(false);
  const [mailMessage,setMailMessage]=useState('');
  const [importBusy,setImportBusy]=useState(false);
  const [editingMandatory,setEditingMandatory]=useState<DbMandatory|null>(null);
  const [positioningMandatory,setPositioningMandatory]=useState<DbMandatory|null>(null);
  const [editWorkers,setEditWorkers]=useState<any[]>([]);
  const [editWorkerIds,setEditWorkerIds]=useState<Set<string>>(new Set());
  const [editWorkDate,setEditWorkDate]=useState('');
  const [editCategory,setEditCategory]=useState('');
  const [editSearch,setEditSearch]=useState('');
  const [editWorkerFilter,setEditWorkerFilter]=useState<'all'|'selected'|'unselected'|'document'|'unmatched'>('all');
  const [editBusy,setEditBusy]=useState(false);
  const publicationInFlightRef=useRef(false);
  const [editingCard,setEditingCard]=useState<any|null>(null);
  const [genericEditDraft,setGenericEditDraft]=useState<any>({});
  const mandatoryFileInputRef=useRef<HTMLInputElement>(null);
  const restoreOriginalInputRef=useRef<HTMLInputElement>(null);
  const restoreOriginalTargetRef=useRef<string|null>(null);
  const completedBaselineRef=useRef<Set<string>|null>(null);
  const [completionNotice,setCompletionNotice]=useState('');
  const [bulkDeleteMode,setBulkDeleteMode]=useState(false);
  const [bulkDeleteBusy,setBulkDeleteBusy]=useState(false);
  const [selectedDeleteKeys,setSelectedDeleteKeys]=useState<Set<string>>(new Set());
  const [worksiteReview,setWorksiteReview]=useState<{item:DbMandatory;works:string[]}|null>(null);
  const loaderRef=useRef<{ownerId:string;loader:ForemanDashboardLoader}|null>(null);
  const refreshInFlightRef=useRef<Promise<void>|null>(null);
  const automaticRefreshBlockedRef=useRef(false);
  const refresh=async(silent=false,checkOnly=false):Promise<void>=>{
    if(checkOnly&&automaticRefreshBlockedRef.current)return;
    if(refreshInFlightRef.current){
      if(checkOnly)return refreshInFlightRef.current;
      await refreshInFlightRef.current;
    }
    const task=(async()=>{
    if(!silent)setLoading(true);
    try{
      const user=await getSessionUser();
      if(!user)return;
      if(loaderRef.current?.ownerId!==user.id){
        loaderRef.current={ownerId:user.id,loader:new ForemanDashboardLoader(supabase.query,user.id)};
        automaticRefreshBlockedRef.current=false;
      }
      if(!checkOnly)claimMorningRefresh(user.id,'documents');
      const results=await loaderRef.current.loader.load(checkOnly);
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
    }catch(error:any){
      if([401,402,403].includes(Number(error?.status)))automaticRefreshBlockedRef.current=true;
      setMailMessage(error?.status===402
        ? 'Supabase ha restringido el servicio. Las comprobaciones automáticas se han detenido.'
        : error?.message||'No se pudo actualizar la documentación.');
    }finally{if(!silent)setLoading(false);}
    })();
    refreshInFlightRef.current=task;
    try{await task;}finally{if(refreshInFlightRef.current===task)refreshInFlightRef.current=null;}
  };
  const refreshRef=useRef(refresh);
  refreshRef.current=refresh;
  useEffect(()=>{
    void refreshRef.current();
    const check=()=>{
      if(document.visibilityState==='hidden'||!navigator.onLine||automaticRefreshBlockedRef.current)return;
      const ownerId=loaderRef.current?.ownerId;
      if(!ownerId||!claimMorningRefresh(ownerId,'documents'))return;
      void refreshRef.current(true,true);
    };
    const timer=window.setInterval(check,FOREMAN_SCHEDULE_CHECK_MS);
    document.addEventListener('visibilitychange',check);
    window.addEventListener('online',check);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',check);window.removeEventListener('online',check);};
  },[]);
  const mailScanInFlightRef=useRef(false);
  const scanAdministrativeMail = async (silent=false) => {
    if (mailScanInFlightRef.current || (silent && (document.visibilityState==='hidden'||!navigator.onLine||automaticRefreshBlockedRef.current))) return;
    mailScanInFlightRef.current=true;
    setMailBusy(true);
    if (!silent) setMailMessage('Comprobando Gmail de la administrativa…');
    try {
      const keys = new Set<string>(
        mandatory
          .filter(item => item.source_gmail_message_id && item.source_attachment_name)
          .map(item => `${item.source_gmail_message_id}|${item.source_attachment_name}`)
      );
      if (silent) {
        const deletedSources=await supabase.query('foreman_mandatory_delete_tombstones',{
          query:'source_gmail_message_id=not.is.null&select=source_gmail_message_id,source_attachment_name&limit=1000',
        });
        (Array.isArray(deletedSources)?deletedSources:[]).forEach((item:any)=>{
          if(item.source_gmail_message_id&&item.source_attachment_name){
            keys.add(`${item.source_gmail_message_id}|${item.source_attachment_name}`);
          }
        });
      }
      const result = await processAdministrativeMandatoryInbox({
        existingSourceKeys: keys,
        restoreDeleted: !silent,
        onProgress: message => { if (!silent) setMailMessage(message); },
      });
      if (result.importedDocuments > 0) {
        const missing=result.missingDirectoryWorkers||[];
        setMailMessage(
          `${result.importedDocuments} documento(s) recibido(s) como borradores para revisar y enviar al portal.`+
          (missing.length
            ? ` Atención: ${missing.length} trabajador(es) del PDF no aparecen en el Directorio: ${missing.join(", ")}.`
            : ' Los nombres reconocidos se han tomado del documento importado.')
        );
        await refresh(true);
      } else if (!silent) {
        setMailMessage(result.warnings[0] || 'Gmail revisado. No hay nuevos documentos obligatorios.');
      }
    } catch (error:any) {
      if([401,402,403].includes(Number(error?.status)))automaticRefreshBlockedRef.current=true;
      setMailMessage(error?.message || 'No se pudo comprobar Gmail.');
    } finally {
      mailScanInFlightRef.current=false;
      setMailBusy(false);
    }
  };
  const scanMailRef=useRef(scanAdministrativeMail);
  scanMailRef.current=scanAdministrativeMail;
  useEffect(()=>{
    const check=()=>{
      if(document.visibilityState==='hidden'||!navigator.onLine||automaticRefreshBlockedRef.current)return;
      const ownerId=loaderRef.current?.ownerId;
      if(!ownerId||!claimMorningRefresh(ownerId,'mail'))return;
      void scanMailRef.current(true);
    };
    const first=window.setTimeout(check,2500);
    const timer=window.setInterval(check,FOREMAN_SCHEDULE_CHECK_MS);
    document.addEventListener('visibilitychange',check);
    return()=>{window.clearTimeout(first);window.clearInterval(timer);document.removeEventListener('visibilitychange',check);};
  },[]);
  const importMandatoryFiles = async (files: File[]) => {
    if (!files.length || importBusy) return;
    setImportBusy(true);
    setMailMessage('Analizando documentos seleccionados…');
    try {
      const result=await processManualMandatoryFiles(files,{
        onProgress: message=>setMailMessage(message),
        obraHint:selectedDocsWork,
        obraCandidates:workDocumentGroups.map(([work])=>work).filter(work=>work!=='Sin obra'),
      });
      if(result.importedDocuments>0){
        const missing=result.missingDirectoryWorkers||[];
        setMailMessage(
          `${result.importedDocuments} documento(s) importado(s) como borradores. Revisa trabajadores y posiciones y pulsa Enviar al portal de encargados.${result.skippedFiles ? ` ${result.skippedFiles} archivo(s) no se pudieron importar.` : ''}`+
          (missing.length
            ? ` Atención: ${missing.length} trabajador(es) del PDF no aparecen en el Directorio: ${missing.join(", ")}.`
            : ' Los nombres reconocidos se han tomado del documento importado.')
        );
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
  const directoryMismatchDocuments=useMemo(
    ()=>visibleMandatory
      .map(item=>({item,missing:importedWorkersMissingFromDirectory(item)}))
      .filter(entry=>entry.missing.length>0),
    [visibleMandatory],
  );
  const directoryMismatchWorkerCount=useMemo(
    ()=>new Set(directoryMismatchDocuments.flatMap(entry=>entry.missing.map((worker:any)=>String(worker.apellidosNombre||'').trim()).filter(Boolean))).size,
    [directoryMismatchDocuments],
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

  const deleteKey=(card:any)=>`${card.kind}:${card.id}`;

  const toggleDeleteSelection=(card:any)=>setSelectedDeleteKeys(current=>{
    const next=new Set(current);
    const key=deleteKey(card);
    if(next.has(key))next.delete(key);else next.add(key);
    return next;
  });

  const clearBulkDelete=()=>{
    setSelectedDeleteKeys(new Set());
    setBulkDeleteMode(false);
  };

  const deleteCardBatch=async(targets:any[])=>{
    const mandatoryIds=targets.filter(card=>card.kind==='mandatory').map(card=>String(card.id));
    const attendanceIds=targets.filter(card=>card.kind==='attendance').map(card=>String(card.id));
    const documentIds=targets.filter(card=>card.kind==='document').map(card=>String(card.id));

    if(mandatoryIds.length){
      await deleteForemanMandatoryDocuments({ids:mandatoryIds});
    }
    await Promise.all(attendanceIds.map(id=>supabase.query('foreman_attendance_days',{
      method:'DELETE',query:'id=eq.'+encodeURIComponent(id),prefer:'return=minimal',
    })));
    await Promise.all(documentIds.map(id=>supabase.query('foreman_documents',{
      method:'DELETE',query:'id=eq.'+encodeURIComponent(id),prefer:'return=minimal',
    })));
  };

  const deleteSelectedDocuments=async()=>{
    const targets=allCards.filter(card=>selectedDeleteKeys.has(deleteKey(card)));
    if(!targets.length)return;
    const ok=await appConfirm(
      `¿Eliminar definitivamente ${targets.length} documento(s) seleccionado(s)? Los documentos de Inicio/Control quedarán marcados para que no vuelvan a generarse automáticamente.`,
      {title:'Borrado masivo',confirmLabel:`Eliminar ${targets.length}`},
    );
    if(!ok)return;
    setBulkDeleteBusy(true);
    try{
      await deleteCardBatch(targets);
      setMailMessage(`${targets.length} documento(s) eliminado(s) definitivamente.`);
      clearBulkDelete();
      await refresh(true);
    }catch(error:any){
      setMailMessage(error?.message||'No se pudieron eliminar los documentos seleccionados.');
    }finally{
      setBulkDeleteBusy(false);
    }
  };

  const deleteSelectedWorkDocuments=async()=>{
    const obra=String(selectedDocsWork||'').trim();
    if(!obra)return;
    const count=allCards.filter(card=>String(card.obra||'').trim()===obra).length;
    if(!count)return;
    const ok=await appConfirm(
      `¿Eliminar TODOS los documentos de la obra ${obra}?\n\nSe eliminarán ${count} documento(s), incluidos Inicio/Control, jornadas y documentos normalizados. Los Inicio/Control quedarán bloqueados para que no reaparezcan por sincronización.`,
      {title:'Borrar documentos de la obra',confirmLabel:'Borrar toda la obra'},
    );
    if(!ok)return;
    setBulkDeleteBusy(true);
    try{
      await deleteForemanMandatoryDocuments({obra});
      await Promise.all([
        supabase.query('foreman_attendance_days',{
          method:'DELETE',query:'obra=eq.'+encodeURIComponent(obra),prefer:'return=minimal',
        }),
        supabase.query('foreman_documents',{
          method:'DELETE',query:'obra=eq.'+encodeURIComponent(obra),prefer:'return=minimal',
        }),
      ]);
      setMailMessage(`Documentación de ${obra} eliminada definitivamente.`);
      clearBulkDelete();
      await refresh(true);
    }catch(error:any){
      setMailMessage(error?.message||'No se pudo borrar la documentación completa de la obra.');
    }finally{
      setBulkDeleteBusy(false);
    }
  };

  useEffect(()=>{
    setSelectedDeleteKeys(new Set());
  },[selectedDocsWork,selectedDocsMonth]);
  const openPendingWorksiteReview=async(item:DbMandatory)=>{setMailBusy(true);try{const rows=await supabase.query('obras',{query:'select=nombre&order=nombre.asc&limit=500'});setWorksiteReview({item,works:(Array.isArray(rows)?rows:[]).map((row:any)=>String(row.nombre||'')).filter(Boolean)});}catch(error:any){setMailMessage(error?.message||'No se pudieron cargar las obras.');}finally{setMailBusy(false);}};
  const markMandatoryV2Reviewed=async(item:DbMandatory)=>{await reviewSubmittedMandatoryDocumentV2(item.id);await refresh(true);};
  const returnMandatoryV2ForCorrection=async(item:DbMandatory)=>{const reason=await appPrompt('Indica al encargado qué debe corregir:',{title:'Solicitar corrección',confirmLabel:'Enviar corrección',placeholder:'Describe qué debe corregirse…'});if(!reason?.trim())return;await returnMandatoryDocumentV2(item.id,reason.trim());await refresh(true);};
  const reopenMandatoryV2ForRepair=async(item:DbMandatory)=>{await reopenMandatoryDocumentV2(item.id);setMailMessage('Documento reabierto para reparación. Revisa personas y posiciones antes de volver a asignarlo.');await refresh(true);};
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
  const buildSupervisorSignedPdf=async(item:DbMandatory)=>{
    const stored:any=await getSupervisorMandatorySignedPdfV2(item.id);
    if(!stored?.base64||stored.variant!=='signed')throw new Error('No existe un PDF firmado persistido para este documento.');
    return {bytes:undefined as Uint8Array|undefined,base64:stored.base64,filename:stored.filename||mandatoryDocumentLabel(item.document_type)||'documento.pdf',source:'stored' as const};
  };

  const restoreOriginal=async(file:File)=>{
    const documentId=restoreOriginalTargetRef.current;
    if(!documentId)return;
    try{
      await supabase.rpc('restore_mandatory_original_pdf',{p_document_id:documentId,p_pdf_base64:await fileToBase64(file)});
      setMailMessage('Original reimportado. Ya puedes devolver el documento para corregir. El PDF firmado se conserva.');
      await refresh(true);
    }catch(error:any){setMailMessage(error?.message||'No se pudo reimportar el original.');}
    finally{restoreOriginalTargetRef.current=null;if(restoreOriginalInputRef.current)restoreOriginalInputRef.current.value='';}
  };

  const downloadStoredMandatoryPdf=async(item:DbMandatory,variant:'original'|'signed')=>{
    if(variant==='signed'){
      const built=await buildSupervisorSignedPdf(item);
      const blob=built.base64
        ? pdfBlobFromBase64(built.base64)
        : pdfBlobFromBytes(built.bytes as Uint8Array);
      const base=String(built.filename||mandatoryDocumentLabel(item.document_type)||'documento').replace(/\.pdf$/i,'');
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;
      link.download=`${base}_FIRMADO.pdf`;
      link.rel='noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),4000);
      return;
    }
    const stored=await getSupervisorMandatoryPdf(item.id,'original');
    const blob=pdfBlobFromBase64(stored.base64);
    const base=String(stored.filename||mandatoryDocumentLabel(item.document_type)||'documento').replace(/\.pdf$/i,'');
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download=`${base}_ORIGINAL.pdf`;
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
  const sendCompletedMandatory = async (item: DbMandatory) => {
    if (item.status !== 'completed') return;
    const settings=await loadAppBusinessSettings();
    const targetEmail=String(item.source_email_from || settings.administrative?.email || '').trim();
    if(!targetEmail){
      setMailMessage('No hay correo de la administrativa configurado.');
      return;
    }
    if (!(await appConfirm(
      'El documento ya es válido y está firmado por todos los trabajadores. ¿Quieres enviarlo ahora a la administrativa?',
      { title: 'Enviar documento firmado', confirmLabel: 'Enviar' },
    ))) return;
    setMailBusy(true);
    try {
      let file:File;
      if(item.details?.originalPdfMode==='overlay'){
        const built=await buildSupervisorSignedPdf(item);
        const blob=built.base64
          ? pdfBlobFromBase64(built.base64)
          : pdfBlobFromBytes(built.bytes as Uint8Array);
        const base=String(built.filename||mandatoryDocumentLabel(item.document_type)||'documento').replace(/\.pdf$/i,'');
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
        body:`Se remite la documentación de ${item.obra} firmada por los trabajadores. El PDF original se conserva y únicamente se han añadido las firmas.\n\nDocumento: ${mandatoryDocumentLabel(item.document_type)}\nFecha: ${item.work_date}.`,
        file,
        threadId:item.source_gmail_thread_id||'',
        inReplyTo:item.source_rfc_message_id||'',
        references:item.source_rfc_message_id||'',
      });
      await markMandatoryDocumentReturned(item.id,sent.messageId);
      setMailMessage('Documento firmado enviado por Gmail a la administrativa.');
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
      setMailMessage('Indica la fecha del documento.');
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

      setMailMessage('Documento actualizado correctamente. El cambio ha quedado guardado.');
      setEditingCard(null);
      setGenericEditDraft({});
      await refresh(true);
    } catch (error:any) {
      console.error('No se pudo editar el documento del encargado:', error);
      setMailMessage(error?.message || 'No se pudo guardar la edición.');
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
      `¿Eliminar definitivamente “${card.title}” de ${card.obra}? Las versiones históricas ya guardadas se conservarán.`,
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
      setMailMessage('Documento eliminado correctamente. La eliminación ha quedado guardada.');
      await refresh(true);
    } catch (error:any) {
      console.error('No se pudo eliminar el documento del encargado:', error);
      setMailMessage(error?.message || 'No se pudo eliminar el documento.');
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


  const sendMandatoryToPortal = async (item: DbMandatory) => {
    if(editBusy||publicationInFlightRef.current)return;
    publicationInFlightRef.current=true;
    setEditBusy(true);
    try {
      const current=await loadCurrentMandatoryDocument(item);
      const anchors=Array.isArray(current.details?.workerAnchors)?current.details.workerAnchors:[];
      if(hasOverlappingMandatorySignatures(anchors)&&!await appConfirm('Algunas firmas se solapan porque las filas del original están muy juntas. El PDF original se conservará. ¿Quieres enviar el documento con estas posiciones?',{title:'Confirmar firmas solapadas',confirmLabel:'Enviar con solapamiento'}))return;
      const receipt = await assignMandatoryDocumentV2(item.id);
      setMandatory(items=>items.map(doc=>doc.id===item.id?{...doc,lifecycle_status:receipt.lifecycleStatus,assigned_at:receipt.assignedAt,details:{...doc.details,lifecycleStatus:receipt.lifecycleStatus}}:doc));
      const accessMessage=receipt.activePortal===true
        ? 'Abre Control inicios en el portal de esta obra y pulsa Actualizar documentos. Si hay filtros activos, pulsa Todos.'
        : receipt.activePortal===false
          ? 'Esta obra no tiene un acceso activo de encargado. Genera o activa su acceso antes de abrir el portal.'
          : 'No se pudo comprobar el acceso del encargado. Revisa que el acceso esté activo y corresponda a esta obra.';
      const message=`${mandatoryDocumentLabel(item.document_type)}\nObra: ${receipt.obra}\nPeriodo: ${receipt.periodKey||item.work_date}\nEnvío guardado: ${new Date(receipt.assignedAt).toLocaleString('es-ES')}\n\n${accessMessage}`;
      setMailMessage(`Envío guardado y verificado. ${accessMessage}`);
      await appAlert(message,{title:receipt.activePortal===true?'Documento enviado al portal':'Envío guardado · revisa el acceso'});
      await refresh(true);
    } catch(error:any) {
      const message=error?.message||'No se pudo enviar el documento al portal.';
      setMailMessage(message);
      await appAlert(message,{title:'No se ha confirmado el envío'});
    }
    finally { publicationInFlightRef.current=false;setEditBusy(false); }
  };
  const withdrawMandatoryFromPortal = async (item: DbMandatory) => {
    if(editBusy)return;
    if(!await appConfirm('Se retirará del portal mientras corriges trabajadores o posiciones. Las firmas del mismo trabajador se conservarán. Tendrás que enviarlo de nuevo al terminar.',{title:'Retirar del portal para corregir',confirmLabel:'Retirar del portal'}))return;
    setEditBusy(true);
    try {
      await withdrawMandatoryDocumentV2(item.id);
      setMailMessage('Documento retirado del portal. Puedes corregirlo y enviarlo de nuevo cuando esté listo.');
      await refresh(true);
    } catch(error:any) { setMailMessage(error?.message||'No se pudo retirar el documento.'); }
    finally { setEditBusy(false); }
  };

  const loadCurrentMandatoryDocument = async (item: DbMandatory): Promise<DbMandatory> => {
    const rows=await supabase.query('foreman_mandatory_documents',{
      query:`id=eq.${encodeURIComponent(item.id)}&select=id,details,workers,signatures,work_date,category,lifecycle_status,status,updated_at&limit=1`,
      networkOnly:true,
    });
    if(!Array.isArray(rows)||!rows[0])throw new Error('Documento no encontrado. Actualiza la documentación.');
    return {...item,...rows[0]};
  };

  const openMandatoryAnchorEditor = async (item: DbMandatory) => {
    if(editBusy)return;
    setEditBusy(true);
    try{const current={...item,...await loadSupervisorMandatoryEditorDocument(item.id)};if(['ASSIGNED','IN_SIGNATURE','SUBMITTED','RECEIVED','REVIEWED','RETURNED_FOR_CORRECTION'].includes(String(current.lifecycle_status)))throw new Error('Retira primero el documento del portal para corregir sus posiciones.');setPositioningMandatory(current);}
    catch(error:any){setMailMessage(error?.message||'No se pudieron cargar las posiciones guardadas.');}
    finally{setEditBusy(false);}
  };

  const openMandatoryEditor = async (item: DbMandatory) => {
    if(editBusy)return;
    setEditBusy(true);
    try{item=await loadCurrentMandatoryDocument(item);}
    catch(error:any){setEditBusy(false);setMailMessage(error?.message||'No se pudo cargar la selección guardada.');return;}
    setEditingMandatory(item); setEditWorkDate(String(item.work_date||'').slice(0,10)); setEditCategory(item.document_type==='control_presencia'?'':String(item.category||'')); setEditSearch(''); setEditWorkerFilter('all');
    const v2Workers=Array.isArray(item.details?.documentWorkersV2)?item.details.documentWorkersV2:[];
    const importedSnapshots=Array.isArray(item.details?.importedWorkers)?item.details.importedWorkers:[];
    const anchors=Array.isArray(item.details?.workerAnchors)?item.details.workerAnchors:[];
    const byLegacy=new Map(importedSnapshots.map((worker:any)=>[Number(worker.id),worker]));
    const rows=v2Workers.map((entry:any)=>{
      const legacyIdRaw=Number(entry.legacyWorkerId); const hasLegacyId=Number.isFinite(legacyIdRaw); const legacyId=hasLegacyId?legacyIdRaw:null; const known:any=hasLegacyId?byLegacy.get(legacyIdRaw):null; const anchor=hasLegacyId?anchors.find((candidate:any)=>Number(candidate.workerId)===legacyIdRaw):null; const documentWorkerId=String(entry.id||anchor?.documentWorkerId||'');
      return {id:hasLegacyId?legacyIdRaw:'v2:'+documentWorkerId,legacyWorkerId:legacyId,documentWorkerId,apellidosNombre:String(entry.printedName||known?.apellidosNombre||anchor?.workerName||'Persona del documento'),dni:String(known?.dni||anchor?.dni||''),categoria:String(known?.categoria||item.category||''),detectionStatus:String(entry.detectionStatus||'DETECTED')};
    }).filter((worker:any)=>Boolean(worker.documentWorkerId));
    setEditWorkers(rows);
    setEditWorkerIds(new Set(rows.filter((worker:any)=>worker.detectionStatus!=='REJECTED').map((worker:any)=>String(worker.id))));
    setEditBusy(false);
  };

  const saveMandatoryEditor = async () => {
    if(!editingMandatory)return;
    setEditBusy(true);
    try{
      const anchors=Array.isArray(editingMandatory.details?.workerAnchors)?editingMandatory.details.workerAnchors:[];
      await saveMandatoryWorkerSelectionV2({
        documentId: editingMandatory.id,
        workers: (editWorkers as any[]).filter(worker=>worker.documentWorkerId).map(worker=>{
          const anchor=worker.legacyWorkerId!=null?anchors.find((candidate:any)=>Number(candidate.workerId)===Number(worker.legacyWorkerId)):null;
          const nameBox=anchor?.nameX!=null&&anchor?.nameY!=null&&Number(anchor?.nameWidth||0)>0&&Number(anchor?.nameHeight||anchor?.rowHeight||0)>0?{x:Number(anchor.nameX),y:Number(anchor.nameY),width:Number(anchor.nameWidth||1),height:Number(anchor.nameHeight||anchor.rowHeight||1)}:null;
          const signatureBox=anchor?.signatureX!=null&&anchor?.signatureY!=null&&Number(anchor?.signatureWidth||0)>0&&Number(anchor?.signatureHeight||0)>0?{x:Number(anchor.signatureX),y:Number(anchor.signatureY),width:Number(anchor.signatureWidth),height:Number(anchor.signatureHeight)}:null;
          return {documentWorkerId:worker.documentWorkerId,selected:editWorkerIds.has(String(worker.id)),printedName:String(worker.apellidosNombre||''),nameBox,signatureBox};
        }),
      });
      setMailMessage('Selección guardada y verificada. Cuando esté listo, pulsa Enviar al portal de encargados.');
      setEditingMandatory(null); await refresh(true);
    }catch(error:any){setMailMessage(error?.message||'No se pudo guardar la revisión del documento.');}
    finally{setEditBusy(false);}
  };

  const removeDetectedWorkerAsSupervisor = async (item:DbMandatory,worker:any) => {
    const workerId=Number(worker?.id);
    if(!Number.isFinite(workerId)||editBusy)return;
    setEditBusy(true);
    setMailMessage(`Quitando a ${worker.apellidosNombre} del documento importado…`);
    try{
      await removeSupervisorMandatoryWorker(item.id,workerId);
      setEditWorkers(current=>current.filter((candidate:any)=>Number(candidate.id)!==workerId));
      setEditWorkerIds(current=>{const next=new Set(current);next.delete(String(workerId));return next;});
      setEditingMandatory(current=>current&&current.id===item.id
        ? {
            ...current,
            signatures:Object.fromEntries(Object.entries(current.signatures||{}).filter(([id])=>Number(id)!==workerId)),
            details:{
              ...(current.details||{}),
              importedWorkerIds:(Array.isArray(current.details?.importedWorkerIds)?current.details.importedWorkerIds:[]).filter((id:any)=>Number(id)!==workerId),
              importedWorkers:(Array.isArray(current.details?.importedWorkers)?current.details.importedWorkers:[]).filter((candidate:any)=>Number(candidate.id)!==workerId),
              workerAnchors:(Array.isArray(current.details?.workerAnchors)?current.details.workerAnchors:[]).filter((anchor:any)=>Number(anchor.workerId)!==workerId),
            },
          }
        : current);
      setMailMessage(`${worker.apellidosNombre} se ha quitado del documento importado.`);
      await refresh(true);
    }catch(error:any){
      setMailMessage(error?.message||'No se pudo quitar la persona del documento.');
    }finally{
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
      setMailMessage(error?.message || 'No se pudo eliminar el documento.');
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
  return <div className="foreman-documents-dashboard min-w-0 space-y-5">
    <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div><div className="text-[10px] font-black uppercase tracking-[.16em] text-[#00548E] dark:text-blue-300">Seguimiento documental</div><h1 className="text-2xl font-black text-slate-900 dark:text-white mt-1">Documentación de encargados</h1><p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Documentos y registros diarios cumplimentados desde el móvil del encargado. Hasta tres comprobaciones automáticas al día entre las 08:00 y las 14:00 (hora de España), solo con esta pantalla visible. Pulsa Actualizar para consultar cambios a cualquier hora.</p></div>
        <div className="flex flex-wrap gap-2">
          <input ref={restoreOriginalInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={event=>{const file=event.target.files?.[0];if(file)void restoreOriginal(file);}} />
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
      {directoryMismatchDocuments.length>0&&<div className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0"/>
          <div>
            <div className="font-black">Control de Directorio: {directoryMismatchWorkerCount} trabajador(es) detectado(s) en documentos importados no aparecen en el Directorio.</div>
            <div className="mt-1 text-xs font-semibold">Es solo un aviso de comprobación: estos trabajadores siguen disponibles para firmar el PDF original.</div>
          </div>
        </div>
      </div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
        {([['Inicio / Control',visibleMandatory.length],['Documentos normalizados',documents.length],['Jornadas',attendance.length],['Firmas E/S',signedEntries+signedExits]] as [string,number][]).map(([label,value])=><div key={label} className="rounded-2xl bg-slate-50 dark:bg-slate-800 p-4"><div className="text-2xl font-black">{value}</div><div className="text-[11px] font-bold text-slate-500 dark:text-slate-300">{label}</div></div>)}
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className={`rounded-2xl border p-4 ${correctionCount?'border-amber-300 bg-amber-50 dark:bg-amber-950/20':'bg-white dark:bg-slate-900'}`}>
        <div className="flex items-center gap-2"><RotateCcw className="w-4 h-4 text-amber-600"/><span className="text-xs font-black uppercase">Correcciones</span></div>
        <div className="mt-2 text-2xl font-black">{correctionCount}</div><div className="text-xs text-slate-500 dark:text-slate-300">devueltos al encargado</div>
      </div>
      <div className={`rounded-2xl border p-4 ${incompleteCount?'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20':'bg-white dark:bg-slate-900'}`}>
        <div className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600"/><span className="text-xs font-black uppercase">En curso</span></div>
        <div className="mt-2 text-2xl font-black">{incompleteCount}</div><div className="text-xs text-slate-500 dark:text-slate-300">pendientes o incompletos</div>
      </div>
      <div className={`rounded-2xl border p-4 ${reviewCount?'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20':'bg-white dark:bg-slate-900'}`}>
        <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600"/><span className="text-xs font-black uppercase">Por revisar</span></div>
        <div className="mt-2 text-2xl font-black">{reviewCount}</div><div className="text-xs text-slate-500 dark:text-slate-300">finalizados por el encargado</div>
      </div>
    </div>

    <div className="2xl:grid 2xl:grid-cols-[270px_minmax(0,1fr)] 2xl:gap-5 2xl:items-start">
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
            {!!selectedDocsWork&&<div className="flex flex-wrap gap-2">
              <button type="button" disabled={bulkDeleteBusy} onClick={()=>{setBulkDeleteMode(value=>!value);setSelectedDeleteKeys(new Set())}} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">{bulkDeleteMode?'Cancelar selección':'Selección múltiple'}</button>
              <button type="button" disabled={bulkDeleteBusy} onClick={()=>void deleteSelectedWorkDocuments()} className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-50"><Trash2 className="mr-1.5 inline h-4 w-4"/>Borrar obra</button>
            </div>}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {monthDocumentGroups.map(([month,stats])=><button key={month} type="button" onClick={()=>setSelectedDocsMonth(month)} className={`shrink-0 rounded-xl border px-3 py-2.5 ${selectedDocsMonth===month?'border-[#00548E] bg-[#00548E] text-white':'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'}`}><div className="flex items-center gap-2 text-xs font-black"><CalendarDays className="w-3.5 h-3.5"/>{month==='Sin fecha'?'Sin fecha':monthLabel(month)}{stats.pending>0&&<span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${selectedDocsMonth===month?'bg-white/20 text-white':'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100'}`}>{stats.pending}</span>}</div><div className={`mt-0.5 text-[10px] ${selectedDocsMonth===month?'text-blue-100':'text-slate-600 dark:text-slate-300'}`}>{stats.total} documento(s)</div></button>)}
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border p-3 flex flex-col md:flex-row gap-2">
      <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por obra, trabajador, documento o fecha…" className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-2.5 bg-white text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-50 dark:placeholder:text-slate-500"/></div>
      <select value={filter} onChange={e=>setFilter(e.target.value as any)} className="rounded-xl border border-slate-300 px-3 py-2.5 bg-white text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-50 font-bold text-sm"><option value="all">Todo</option><option value="mandatory">Inicio y control de presencia</option><option value="attendance">Registro diario</option><option value="documents">Documentos normalizados</option><option value="pending">Pendientes de revisar ({pending})</option></select>
    </div>
    {bulkDeleteMode&&<div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-800 dark:bg-rose-950/50">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm font-black text-rose-900">{selectedDeleteKeys.size} seleccionado(s)</span>
        <button type="button" disabled={bulkDeleteBusy||!visibleCards.length} onClick={()=>setSelectedDeleteKeys(new Set(visibleCards.map(deleteKey)))} className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-800 disabled:opacity-50">Seleccionar visibles</button>
        <button type="button" disabled={bulkDeleteBusy||selectedDeleteKeys.size===0} onClick={()=>void deleteSelectedDocuments()} className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{bulkDeleteBusy?'Eliminando…':`Borrar seleccionados (${selectedDeleteKeys.size})`}</button>
      </div>
    </div>}
    {loading?<div className="rounded-2xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900"><Loader2 className="w-8 h-8 animate-spin mx-auto text-[#00548E]"/></div>:cards.length===0?<div className="rounded-2xl bg-white dark:bg-slate-900 border p-10 text-center text-sm text-slate-600 dark:text-slate-300">Todavía no hay documentación enviada por encargados.</div>:visibleCards.length===0?<div className="rounded-2xl bg-white dark:bg-slate-900 border p-8 text-center text-sm text-slate-600 dark:text-slate-300">No hay documentos para esta obra y mes con los filtros actuales.</div>:<div className="relative z-0 space-y-4">{visibleCards.map(card=><article key={card.kind+card.id} className={`relative isolate z-0 rounded-2xl bg-white dark:bg-slate-900 border p-4 shadow-sm ${bulkDeleteMode&&selectedDeleteKeys.has(deleteKey(card))?'border-rose-400 ring-2 ring-rose-100':'border-slate-200 dark:border-slate-800'}`}>
      {bulkDeleteMode&&<label className="mb-3 flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-black text-rose-900">
        <input type="checkbox" className="h-5 w-5 accent-rose-600" checked={selectedDeleteKeys.has(deleteKey(card))} onChange={()=>toggleDeleteSelection(card)}/>
        Seleccionar para borrar
      </label>}
      <div className="flex flex-col 2xl:flex-row 2xl:items-start gap-4"><div className="w-full min-w-0 2xl:flex-1 break-words">
        <div className="flex flex-wrap items-center gap-2"><span className={card.kind==='attendance'?'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black bg-blue-50 text-blue-800 border border-blue-200 dark:border-blue-700 dark:bg-blue-950/70 dark:text-blue-100':card.kind==='mandatory'?'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black bg-amber-50 text-amber-800 border border-amber-200 dark:border-amber-700 dark:bg-amber-950/70 dark:text-amber-100':'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black bg-violet-50 text-violet-800 border border-violet-200 dark:border-violet-700 dark:bg-violet-950/70 dark:text-violet-100'}>{card.kind==='attendance'?<Clock3 className="w-3 h-3"/>:<FileSignature className="w-3 h-3"/>}{card.kind==='attendance'?'Registro diario':card.kind==='mandatory'?'Obligatorio':'Documento'}</span><span className={card.status==='reviewed'?'rounded-full px-2 py-1 text-[10px] font-black bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100':card.status==='completed'?'rounded-full px-2 py-1 text-[10px] font-black bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-100':card.status==='in_progress'?'rounded-full px-2 py-1 text-[10px] font-black bg-blue-50 text-blue-800 dark:bg-blue-950/70 dark:text-blue-100':card.status==='returned'?'rounded-full px-2 py-1 text-[10px] font-black bg-amber-100 text-amber-900':'rounded-full px-2 py-1 text-[10px] font-black bg-amber-50 text-amber-800 dark:bg-amber-950/70 dark:text-amber-100'}>{card.status==='reviewed'?'Enviado / revisado':card.status==='completed'?'Cumplimentado':card.status==='in_progress'?'En cumplimentación':card.status==='returned'?'Devuelto para corregir':'Pendiente de firma'}</span></div>
        {card.kind==='mandatory'&&['inicio','control_presencia'].includes(String(card.item.document_type||''))&&<p className="mt-2 text-xs font-black text-[#00548E] dark:text-blue-300">{['ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION'].includes(String(card.item.lifecycle_status||card.item.details?.lifecycleStatus||''))?'Disponible en el portal':card.status==='completed'||card.status==='reviewed'?'Enviado al supervisor':'Borrador del supervisor · pendiente de envío al portal'}</p>}
        {card.kind==='mandatory'&&card.item.assigned_at&&<p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Último envío guardado: {new Date(card.item.assigned_at).toLocaleString('es-ES')} · Obra: {card.item.obra} · Periodo: {card.item.period_key||card.item.work_date}</p>}
        <h3 className="mt-2 font-black text-slate-900 dark:text-white break-words">{card.title}</h3><p className="text-xs text-slate-500 dark:text-slate-300">{card.obra} · {String(card.date).slice(0,10)}{card.subtitle?' · '+card.subtitle:''}</p>{card.kind==='attendance'&&<p className="text-xs mt-1 text-slate-500 dark:text-slate-300">{card.item.rows?.filter((r:any)=>r.entrySignature).length||0} entradas · {card.item.rows?.filter((r:any)=>r.exitSignature).length||0} salidas firmadas</p>}{card.kind==='mandatory'&&<p className="text-xs mt-1 text-slate-500 dark:text-slate-300">{Object.keys(card.item.signatures||{}).length}/{(Array.isArray(card.item.details?.importedWorkerIds)&&['inicio','control_presencia'].includes(String(card.item.document_type||'')))?card.item.details.importedWorkerIds.length:(card.item.workers?.length||0)} firmas recogidas</p>}{card.kind==='mandatory'&&['inicio','control_presencia'].includes(String(card.item.document_type||''))&&card.status==='completed'&&<div className={`mt-2 inline-flex rounded-full border px-3 py-1.5 text-[11px] font-black ${card.item.details?.submissionMode==='partial'?'border-amber-300 bg-amber-50 text-amber-900':'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{card.item.details?.submissionMode==='partial'?`Recibido incompleto · ${card.item.details?.submittedSignedCount||0}/${card.item.details?.submittedRequiredCount||card.item.details?.importedWorkerIds?.length||0} firmas`:'Documento recibido válido · PDF original + firmas'}</div>}{card.kind==='mandatory'&&importedWorkersMissingFromDirectory(card.item as DbMandatory).length>0&&<div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950/80 dark:text-amber-50">
          <div className="font-black">No localizado(s) en Directorio</div>
          <div className="mt-1 font-semibold">{importedWorkersMissingFromDirectory(card.item as DbMandatory).map((worker:any)=>String(worker.apellidosNombre||'Trabajador')).join(' · ')}</div>
          <div className="mt-1 text-[11px]">El documento no se bloquea: podrán firmar porque aparecen en el PDF importado.</div>
        </div>}{card.item.correction_pending&&<p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-bold text-amber-900 dark:border-amber-700 dark:bg-amber-950/80 dark:text-amber-50">Corrección solicitada: {card.item.correction_reason||'Revisar documento'}</p>}</div>
        <div className="foreman-document-actions flex w-full min-w-0 flex-wrap content-start items-start gap-2 2xl:w-auto 2xl:max-w-[55%]">
          <button onClick={()=>void openPdf(card)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-black text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-50"><Download className="w-4 h-4"/>{card.kind==='mandatory'&&card.item.details?.originalPdfMode==='overlay'&&(card.status==='completed'||card.status==='reviewed')?'PDF firmado':'PDF'}</button>
          {card.kind==='mandatory'&&card.item.details?.originalPdfMode==='overlay'&&<>
            <button onClick={()=>{if(card.item.details?.originalPdfPurged){restoreOriginalTargetRef.current=card.id;restoreOriginalInputRef.current?.click();}else void downloadStoredMandatoryPdf(card.item as DbMandatory,'original');}} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-black text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-50"><FileSignature className="w-4 h-4"/>{card.item.details?.originalPdfPurged?'Reimportar original':'Original'}</button>
            {['inicio','control_presencia'].includes(String(card.item.document_type||''))&&
              <button
                onClick={()=>void openMandatoryAnchorEditor(card.item as DbMandatory)}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-black text-amber-900 dark:border-amber-600 dark:bg-amber-950/80 dark:text-amber-50"
              >
                <Pencil className="w-4 h-4"/>Ajustar firmas
              </button>}
          </>}
          {card.kind==='mandatory'&&['inicio','control_presencia'].includes(String(card.item.document_type||''))&&['ANALYZED','NEEDS_WORKSITE_REVIEW','NEEDS_WORKER_REVIEW','NEEDS_SIGNATURE_POSITION_REVIEW','READY','PDF_VALIDATION_ERROR'].includes(String(card.item.lifecycle_status||card.item.details?.lifecycleStatus||''))&&<button disabled={editBusy} onClick={()=>void sendMandatoryToPortal(card.item as DbMandatory)} className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-[#00548E] px-3 py-2.5 text-sm font-black text-white disabled:opacity-50"><Send className="w-4 h-4"/>Enviar al portal de encargados</button>}
          {card.kind==='mandatory'&&['inicio','control_presencia'].includes(String(card.item.document_type||''))&&['ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION'].includes(String(card.item.lifecycle_status||card.item.details?.lifecycleStatus||''))&&<button disabled={editBusy} onClick={()=>void withdrawMandatoryFromPortal(card.item as DbMandatory)} className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-black text-amber-900 disabled:opacity-50"><RotateCcw className="w-4 h-4"/>Retirar del portal para corregir</button>}
          {card.kind==='mandatory'&&String(card.item.details?.lifecycleStatus||card.item.lifecycle_status||'')==='NEEDS_WORKSITE_REVIEW'&&<button onClick={()=>void openPendingWorksiteReview(card.item as DbMandatory)} className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-3 py-2.5 text-xs font-black text-white"><Building2 className="w-4 h-4"/>Asignar obra</button>}
          {card.kind==='mandatory'&&String(card.item.details?.lifecycleStatus||card.item.lifecycle_status||'')==='PDF_VALIDATION_ERROR'&&<button onClick={()=>void reopenMandatoryV2ForRepair(card.item as DbMandatory)} className="inline-flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 text-xs font-black text-rose-800"><RotateCcw className="w-4 h-4"/>Reabrir para reparar</button>}
          {card.kind==='mandatory'&&['inicio','control_presencia'].includes(String(card.item.document_type||''))&&card.status==='completed'&&['SUBMITTED','RECEIVED'].includes(String(card.item.details?.lifecycleStatus||card.item.lifecycle_status||''))&&<button onClick={()=>void markMandatoryV2Reviewed(card.item as DbMandatory)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-black text-white"><CheckCircle2 className="w-4 h-4"/>Marcar revisado</button>}
          {card.kind==='mandatory'&&['inicio','control_presencia'].includes(String(card.item.document_type||''))&&['SUBMITTED','RECEIVED','REVIEWED'].includes(String(card.item.details?.lifecycleStatus||card.item.lifecycle_status||''))&&<button onClick={()=>void returnMandatoryV2ForCorrection(card.item as DbMandatory)} className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-black text-amber-900"><RotateCcw className="w-4 h-4"/>Devolver para corregir</button>}
          <button onClick={()=>editAnyDocument(card)} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-800 px-3 py-2.5 text-xs font-black dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200"><Pencil className="w-4 h-4"/>{card.kind==='mandatory'&&['inicio','control_presencia'].includes(String(card.item.document_type||''))?'Trabajadores':'Editar'}</button>
          <button onClick={()=>void deleteGenericItem(card)} disabled={editBusy} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2.5 text-xs font-black disabled:opacity-50 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"><Trash2 className="w-4 h-4"/>Eliminar</button>
          {card.kind==='mandatory' && card.status==='completed' && ['inicio','control_presencia'].includes(String(card.item.document_type||'')) && (
            <button disabled={mailBusy} onClick={()=>void sendCompletedMandatory(card.item as DbMandatory)} className="inline-flex items-center gap-2 rounded-xl bg-[#00548E] text-white px-3 py-2.5 text-xs font-black disabled:opacity-50"><MailCheck className="w-4 h-4"/>{card.item.source_gmail_message_id?'Enviar firmado por Gmail':'Enviar firmado a administrativa'}</button>
          )}
          {card.status==='completed' && !(card.kind==='mandatory' && card.item.source_gmail_message_id) && !(card.kind==='mandatory'&&['inicio','control_presencia'].includes(String(card.item.document_type||''))) && (
            <button onClick={()=>void markReviewed(card.kind==='attendance'?'attendance':card.kind==='mandatory'?'mandatory':'document',card.id)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-3 py-2.5 text-xs font-black"><CheckCircle2 className="w-4 h-4"/>Marcar revisado</button>
          )}
          {(card.status==='completed'||card.status==='reviewed')&&!(card.kind==='mandatory'&&['inicio','control_presencia'].includes(String(card.item.document_type||'')))&&(
            <button onClick={()=>void returnForCorrection(card.kind==='attendance'?'attendance':card.kind==='mandatory'?'mandatory':'document',card.id)} className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2.5 text-xs font-black"><RotateCcw className="w-4 h-4"/>Devolver para corregir</button>
          )}
        </div>
      </div>
    </article>)}</div>}
      </div>
    </div>

    {worksiteReview&&<MandatoryWorksiteReviewModal documentLabel={mandatoryDocumentLabel(worksiteReview.item.document_type)} filename={String(worksiteReview.item.source_attachment_name||'')} works={worksiteReview.works} busy={mailBusy} onCancel={()=>setWorksiteReview(null)} onConfirm={async obra=>{setMailBusy(true);try{const result:any=await confirmMandatoryWorksiteV2(worksiteReview.item.id,obra);setWorksiteReview(null);setMailMessage(result?.lifecycleStatus==='READY'?'Obra asignada. Revisa el documento y pulsa Enviar al portal de encargados cuando esté listo.':'Obra asignada. Revisa las personas o posiciones pendientes.');await refresh(true);}catch(error:any){setMailMessage(error?.message||'No se pudo asignar la obra.');}finally{setMailBusy(false);}}}/>}

    {positioningMandatory&&<MandatoryPdfAnchorEditor
      documentId={positioningMandatory.id}
      title={`${mandatoryDocumentLabel(positioningMandatory.document_type)} · Ajustar firmas`}
      obra={positioningMandatory.obra}
      documentType={positioningMandatory.document_type}
      anchors={(Array.isArray(positioningMandatory.details?.workerAnchors)?positioningMandatory.details?.workerAnchors:[]) as MandatoryWorkerAnchor[]}
      signedWorkerIds={Object.keys(positioningMandatory.signatures||{}).map(Number).filter(Number.isFinite)}
      onCancel={()=>setPositioningMandatory(null)}
      onRemoveWorker={async(workerId)=>{
        await removeSupervisorMandatoryWorker(positioningMandatory.id,workerId);
        const persisted={...positioningMandatory,...await loadSupervisorMandatoryEditorDocument(positioningMandatory.id)};
        setPositioningMandatory(persisted);
        setMailMessage('Trabajador eliminado del documento. Ya no cuenta como firma pendiente.');
        await refresh(true);
      }}
      onSave={async(anchors)=>{
        await saveSupervisorMandatoryDraft(positioningMandatory.id,anchors,positioningMandatory.updated_at);
        setMailMessage('Trabajadores y posiciones guardados y verificados. El solapamiento entre firmas es informativo y no impide guardar la revisión.');
        setPositioningMandatory(null);
        await refresh(true);
      }}
    />}

    {editingCard&&<ModalPortal label="Edición del supervisor"><div className="fixed inset-0 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm">
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

        <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-2 border-t bg-slate-50 p-4 shadow-[0_-10px_25px_rgba(15,23,42,0.08)] sm:flex-row sm:justify-between dark:border-slate-700 dark:bg-slate-950">
          <button type="button" disabled={editBusy} onClick={()=>void deleteGenericItem(editingCard)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-black text-rose-700 dark:bg-slate-900"><Trash2 className="w-4 h-4"/>Eliminar documento</button>
          <div className="flex gap-2">
            <button type="button" onClick={()=>{setEditingCard(null);setGenericEditDraft({});}} className="min-h-11 rounded-xl border px-4 py-2.5 text-sm font-black">Cancelar</button>
            <button type="button" disabled={editBusy||!genericEditDraft.work_date} onClick={()=>void saveGenericEditor()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#00548E] px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{editBusy?<Loader2 className="w-4 h-4 animate-spin"/>:<Save className="w-4 h-4"/>}Guardar cambios</button>
          </div>
        </div>
      </div>
    </div></ModalPortal>}

    {editingMandatory&&<ModalPortal label="Editar documento obligatorio"><div className="fixed inset-0 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm">
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
            <div className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-black">Trabajadores incluidos</h4><p className="text-xs text-slate-500 dark:text-slate-300">Marca o desmarca los trabajadores que deben aparecer en el documento.</p></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-800">{editWorkerIds.size} seleccionados</span></div>
            <div className="mt-3 space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400"/>
                <input
                  value={editSearch}
                  onChange={e=>setEditSearch(e.target.value)}
                  placeholder="Buscar por nombre, apellidos, DNI o categoría…"
                  className="min-h-[46px] w-full rounded-xl border bg-white pl-10 pr-3 text-sm dark:bg-slate-950"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  ['all','Todos'],
                  ['selected','Seleccionados'],
                  ['unselected','No seleccionados'],
                  ['document','Del PDF'],
                  ['unmatched','Sin coincidencia'],
                ] as const).map(([value,label])=><button key={value} type="button" onClick={()=>setEditWorkerFilter(value)} className={`rounded-full border px-3 py-1.5 text-xs font-black ${editWorkerFilter===value?'border-[#00548E] bg-blue-50 text-[#00548E]':'bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300'}`}>{label}</button>)}
              </div>
            </div>
            <div className="mt-3 max-h-72 overflow-y-auto rounded-2xl border divide-y dark:divide-slate-700">
              {editBusy&&!editWorkers.length?<div className="p-6 text-center text-sm text-slate-500"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin"/>Cargando trabajadores…</div>:editWorkers
                .filter((worker:any)=>{
                  const id=String(worker.id);
                  const selected=editWorkerIds.has(id);
                  const importedIds=new Set((Array.isArray(editingMandatory.details?.importedWorkerIds)?editingMandatory.details.importedWorkerIds:[]).map((value:any)=>String(value)));
                  const unmatched=worker.legacyWorkerId==null || Number(worker.legacyWorkerId)<0;
                  if(editWorkerFilter==='selected'&&!selected)return false;
                  if(editWorkerFilter==='unselected'&&selected)return false;
                  if(editWorkerFilter==='document'&&!worker.documentWorkerId&&!importedIds.has(id))return false;
                  if(editWorkerFilter==='unmatched'&&!unmatched)return false;
                  const term=editSearch.trim().toLocaleLowerCase('es');
                  if(term&&![
                    worker.apellidosNombre,
                    worker.dni,
                    worker.categoria,
                  ].some(value=>String(value||'').toLocaleLowerCase('es').includes(term)))return false;
                  return true;
                })
                .map((worker:any)=><div key={worker.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-800">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input type="checkbox" checked={editWorkerIds.has(String(worker.id))} onChange={e=>setEditWorkerIds(previous=>{const next=new Set(previous);if(e.target.checked)next.add(String(worker.id));else next.delete(String(worker.id));return next;})} className="h-5 w-5 shrink-0 rounded border-slate-300"/>
                  <span className="min-w-0 flex-1"><span className="block break-words text-sm font-bold">{worker.apellidosNombre||'Trabajador'}</span><span className="block text-xs text-slate-500">{worker.dni||'Sin DNI'}{worker.categoria?' · '+worker.categoria:''}</span>{(worker.legacyWorkerId==null||Number(worker.legacyWorkerId)<0)&&<span className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-800">Leído del PDF · identidad documental · firma permitida</span>}</span>
                </label>
                {editingMandatory.signatures?.[String(worker.id)]&&<span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">Firmado</span>}
              </div>)}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Si eliminas un trabajador del documento, su firma dejará de formar parte de este documento. Las firmas de los trabajadores que permanezcan seleccionados se conservarán.</p>
          </div>
        </div>
        <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-2 border-t bg-slate-50 p-4 shadow-[0_-10px_25px_rgba(15,23,42,0.08)] sm:flex-row sm:justify-between dark:border-slate-700 dark:bg-slate-950">
          <button type="button" disabled={editBusy} onClick={()=>void removeMandatoryDocument(editingMandatory)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-black text-rose-700 dark:bg-slate-900"><Trash2 className="w-4 h-4"/>Eliminar documento</button>
          <div className="flex min-w-0 flex-wrap gap-2"><button type="button" onClick={()=>setEditingMandatory(null)} className="min-h-11 rounded-xl border px-4 py-2.5 text-sm font-black">Cancelar</button><button type="button" disabled={editBusy} onClick={()=>void saveMandatoryEditor()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#00548E] px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{editBusy?<Loader2 className="w-4 h-4 animate-spin"/>:<Save className="w-4 h-4"/>}Guardar cambios</button></div>
        </div>
      </div>
    </div></ModalPortal>}
  </div>;
};


