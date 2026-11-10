import React, { useEffect, useRef, useState, lazy, Suspense } from 'react';
import {VisitPointsEditor} from './VisitPointsEditor';
import {VisitAttachmentsEditor} from './VisitAttachmentsEditor';
import {VisitParticipantsEditor} from './VisitParticipantsEditor';
import {VisitOnsiteFlow} from './VisitOnsiteFlow';
import type {VisitPoint} from '../src/lib/visitMinutes';
import { VisitWorkOrdersEditor } from './VisitWorkOrdersEditor';
import { VisitWorkOrdersFollowup } from './VisitWorkOrdersFollowup';
import { beginGmailOAuth, getGmailConnectionStatus } from '../src/lib/gmailConnection';
import ModalPortal from './ModalPortal';
import { appConfirm,appPrompt } from '../src/lib/appDialog';
import { loadAppBusinessSettings } from '../src/services/appSettingsService';
import { loadObrasRecursosPreventivos } from '../src/services/subcontratasPreferencesService';
import { visitForemanProfile } from '../src/lib/visitForeman';
import { supabase } from '../src/lib/supabase';
import { storeVisitDraft, readVisitDraft, clearVisitDraft, forgetVisitDraft } from '../src/lib/visitDraftStore';
import { cleanVisit, visitProgress } from '../src/lib/visitMinutes';
import { visitRequest, downloadVisitFile, visitFileBytes, visitDraftValidationContent, uploadPendingVisitAttachments } from '../src/services/visitMinutesService';
import { madridDate, personName, VISIT_STATUS_LABELS, type VisitContent, type VisitPerson, type VisitRecord, type VisitCommand, type VisitContact, madridTimestamp } from '../src/lib/visitMinutes';
import { VisitMinutesReadView } from './VisitMinutesReadView';
import { visitInput } from './VisitContactsPanel';
const button = 'inline-flex min-h-11 min-w-0 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-center text-sm font-bold leading-snug text-slate-900 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800';
const primary = button + ' !border-[#00548E] !bg-[#00548E] !text-white hover:!bg-[#004374]';
const VisitPdfPreview=lazy(()=>import('./VisitPdfPreview'));
const emptyPerson = (): VisitPerson => ({
  id: crypto.randomUUID(),
  firstName: '',
  lastName: '',
  role: '',
  entity: '',
  phone: '',
  email: '',
  modality: 'in-person',
  reviewEmailSelected:false,
  attended: true,
  reviewRequired: true,
  signing: 'required',
  receiveFinal: false
});
function blankContent(work: any, supervisor: any): VisitContent {
  return {
    workflow:'3.1',
    points:[{id:crypto.randomUUID(),title:'',description:'',attachmentIds:[]}],
    worksiteId: work?.id || '',
    worksite: work?.nombre || '',
    code: work?.codigo || '',
    location: '',
    municipality: work?.municipio || '',
    promoter: 'Diputación Provincial de Cádiz',
    author: supervisor?.nombreApellidos || '',
    authorRole: supervisor?.cargo || 'Supervisor de obras',
    authorEmail: supervisor?.email || '',
    authorPhone: supervisor?.telefono || '',
    date: madridDate(),
    start: new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date()),
    end: '',
    purpose: '',
    discussion: '',
    observations: '',
    nextVisit: '',
    agreements: [],
    orders: [],
    orderReferences: [],
    attachments: []
  };
}
export function VisitMinutesPanel({
  initialWorksite = ''
}: {
  initialWorksite?: string;
}) {
  const [works, setWorks] = useState<any[]>([]),
    [contacts, setContacts] = useState<VisitContact[]>([]),
    [supervisor, setSupervisor] = useState<any>({}),
    [technician, setTechnician] = useState<any>({}),
    [records, setRecords] = useState<any[]>([]),
    [hasMore, setHasMore] = useState(false),
    [workFilter, setWorkFilter] = useState(''),
    [statusFilter, setStatusFilter] = useState(''),
    [fromDate,setFromDate]=useState(''),[toDate,setToDate]=useState(''),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  const [record, setRecord] = useState<VisitRecord | null>(null),
    [creating, setCreating] = useState(false),
    [content, setContent] = useState<VisitContent | null>(null),
    [people, setPeople] = useState<VisitPerson[]>([]),
    [jobs, setJobs] = useState<any[]>([]),
    [history, setHistory] = useState<any | null>(null),
    [mail, setMail] = useState<{
      kind: 'review' | 'signing' | 'final';
      messages: any[];
      sender?:string;
      pdfBytes?:Uint8Array;
    } | null>(null),
    [onsite, setOnsite] = useState<{
      personId: string;
      kind: 'response' | 'signature';
    } | null>(null),
    [onsiteAck, setOnsiteAck] = useState(false),
    [link, setLink] = useState('');
  const [draftUser,setDraftUser]=useState(''),[recovery,setRecovery]=useState<any>(null),[syncState,setSyncState]=useState(''),[syncBlocked,setSyncBlocked]=useState(false),[autoSaving,setAutoSaving]=useState(false),[online,setOnline]=useState(navigator.onLine),[reviewClosure,setReviewClosure]=useState('');
  const [orderSeed,setOrderSeed]=useState<VisitPoint|null>(null),[attachmentBusy,setAttachmentBusy]=useState(false),[attachmentTotal,setAttachmentTotal]=useState(8_000_000),[selectedRecipients,setSelectedRecipients]=useState<string[]>([]);
  const [dictation,setDictation]=useState(''),[writingPending,setWritingPending]=useState(false);
  const assetCache=useRef(new Map<string,any>());
  const saveEpoch=useRef(0);
  const openingParticipation=useRef(false);
  const localPending=useRef<any>(null),draftReady=useRef(false),latestDraft=useRef<any>(null);
  const draftScopeActive=useRef(true);
  const editorRef=useRef<HTMLElement>(null);
  const [editFocus,setEditFocus]=useState(0);
  useEffect(()=>{if(editFocus){editorRef.current?.focus({preventScroll:true});editorRef.current?.scrollIntoView({block:'start',behavior:'smooth'});}},[editFocus]);
  const [mailError,setMailError]=useState(''),[mailNotice,setMailNotice]=useState(''),[gmailRequired,setGmailRequired]=useState(false),[mailSending,setMailSending]=useState(false);
  const mailOperation=useRef<{key:string;id:string}|null>(null);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const guard = useRef(false),
    operation = useRef<{
      key: string;
      id: string;
    } | null>(null),
    createId = useRef('');
  latestDraft.current={record,content,people,creating,dictation};
  // Form updates are immutable. Reference changes avoid serializing megabytes
  // of attachments on every keystroke just to show the unsaved-changes badge.
  const dirtyContent = !!content && (creating || record?.state.status === 'draft' && (content !== record.state.content || people !== record.state.participants));
  const dirty = dirtyContent || !!dictation.trim();
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const abort = new AbortController();
    (async()=>{
      const {data}=await supabase.auth.getSession();
      const user=data.session?.user?.id || '';setDraftUser(user);
      const saved=user?await readVisitDraft<any>(user):null;
      if(saved?.content)setRecovery(saved);
      try {
        const [w,c,s,resources]=await Promise.all([visitRequest({action:'works'},{signal:abort.signal}),visitRequest({action:'contacts'},{signal:abort.signal}),loadAppBusinessSettings(),loadObrasRecursosPreventivos()]);
        if(abort.signal.aborted)return;
        if(w.visitWorkflow!=='3.1')throw new Error('Actualiza GestionProfea: el servidor todavía no admite Actas 3.1. No se ha enviado ningún borrador.');
        setWorks(w.works.map((work:any)=>({...work,visitForeman:visitForemanProfile(work,resources)})));setContacts(c.contacts);setSupervisor(s.supervisor);setTechnician(s.technician||{});setAttachmentTotal(w.attachmentLimits?.total||8_000_000);
        const exact=w.works.filter((work:any)=>work.id===initialWorksite||work.nombre===initialWorksite);
        setWorkFilter(exact.length===1?exact[0].id:'');setLoaded(true);
      } catch(e) {
        if(saved?.configuration){setWorks(saved.configuration.works);setContacts(saved.configuration.contacts);setSupervisor(saved.configuration.supervisor);setTechnician(saved.configuration.technician||{});setLoaded(true);setSyncState('Sin conexión. Configuración del dispositivo; los permisos se comprobarán al sincronizar.');}
        else throw e;
      }
      draftReady.current=true;
    })().catch(e=>{if(!abort.signal.aborted)setError(e.message);});
    return () => abort.abort();
  }, [initialWorksite]);
  useEffect(() => {
    if (!loaded) return;
    const abort = new AbortController();
    setLoading(true);
    visitRequest({
      action: 'list',
      worksiteId: workFilter,
      fromDate,toDate,
      status: statusFilter,
      search: query
    }, {
      signal: abort.signal
    }).then(r => {
      setRecords(r.records);
      setHasMore(r.hasMore);
    }).catch(e => {
      if (!abort.signal.aborted) setError(e.message);
    }).finally(() => {
      if (!abort.signal.aborted) setLoading(false);
    });
    return () => abort.abort();
  }, [loaded, workFilter, statusFilter, query,fromDate,toDate]);
  useEffect(()=>{
    const connected=()=>{setOnline(true);setSyncBlocked(false);},disconnected=()=>{setOnline(false);setSyncState('Sin conexión · pendiente de sincronización');};
    window.addEventListener('online',connected);window.addEventListener('offline',disconnected);
    const subscription=supabase.auth.onAuthStateChange?.((event:string)=>{if(event==='SIGNED_OUT'&&draftUser){draftScopeActive.current=false;void forgetVisitDraft(draftUser);setContent(null);setDictation('');setPeople([]);setRecord(null);setRecovery(null);setDraftUser('');}});
    return()=>{window.removeEventListener('online',connected);window.removeEventListener('offline',disconnected);subscription?.data.subscription.unsubscribe();};
  },[draftUser]);
  useEffect(()=>{
    if(!draftUser)return;
    const flush=()=>{
      const d=latestDraft.current;
      if(!draftScopeActive.current||!d?.content||!(d.dictation?.trim()||d.creating||d.record?.status==='draft'&&(d.content!==d.record.state.content||d.people!==d.record.state.participants)))return;
      void storeVisitDraft(draftUser,{...d,id:d.record?.id||createId.current,pending:localPending.current,configuration:{works,contacts,supervisor,technician}}).catch(e=>setSyncState(e.message));
    };
    const hidden=()=>{if(document.visibilityState==='hidden')flush();};
    window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',hidden);
    return()=>{window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',hidden);flush();};
  },[draftUser,works,contacts,supervisor,technician]);
  useEffect(()=>{
    if(!dirty||!draftUser||!draftReady.current||recovery)return;
    const epoch=saveEpoch.current;
    const timer=window.setTimeout(()=>{
      const snapshot=latestDraft.current;
      void storeVisitDraft(draftUser,{...snapshot,id:record?.id||createId.current,pending:localPending.current,configuration:{works,contacts,supervisor,technician}}).then(()=>{
        const current=latestDraft.current;
        // A local-copy completion cannot replace the result of a newer server save.
        if(saveEpoch.current!==epoch||current.content!==snapshot.content||current.people!==snapshot.people||current.dictation!==snapshot.dictation)return;
        const pendingContent=current.creating||current.record?.status==='draft'&&(current.content!==current.record.state.content||current.people!==current.record.state.participants);
        if(!pendingContent&&!current.dictation?.trim())return;
        setSyncState(navigator.onLine?(current.dictation?.trim()&&!pendingContent?'Dictado pendiente de incorporar · copia protegida en este dispositivo':'Pendiente de sincronización · copia protegida en este dispositivo'):'Sin conexión · copia protegida en este dispositivo');
      }).catch(e=>{if(saveEpoch.current===epoch)setSyncState(e.message);});
    },350);
    return()=>window.clearTimeout(timer);
  },[content,people,dictation,dirty,draftUser,recovery,record,works,contacts,supervisor]);
  useEffect(()=>{
    if(content&&!dirty&&draftUser&&draftReady.current&&!recovery)void clearVisitDraft(draftUser).catch(e=>setSyncState(e.message));
  },[content,dirty,draftUser,recovery]);
  useEffect(()=>{
    if(!dirtyContent||!online||syncBlocked||!draftUser||recovery||busy||autoSaving||attachmentBusy)return;
    const timer=window.setTimeout(()=>{
      try{cleanVisit(visitDraftValidationContent(content),people);}catch{setSyncState('Pendiente de sincronización · completa los datos del borrador');return;}
      void persistDraft(true);
    },3500);
    return()=>window.clearTimeout(timer);
  },[content,people,dirtyContent,online,syncBlocked,draftUser,recovery,busy,autoSaving,attachmentBusy]);
  const run = async (task: () => Promise<void>) => {
    if (guard.current || attachmentBusy) return;
    guard.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
    } catch (e: any) {
      setError(e.message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };
  const updateCard=(target:VisitRecord)=>{
    const c=target.state.content;
    const matches=(!workFilter||target.obra_id===workFilter)&&(!statusFilter?target.status!=='cancelled':target.status===statusFilter)&&(!fromDate||c.date>=fromDate)&&(!toDate||c.date<=toDate)&&(!query||(target.number+' '+c.worksite+' '+target.state.participants.map(personName).join(' ')).toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
    const card={id:target.id,number:target.number,worksite:c.worksite,visit_date:c.date,status:target.status,version:target.version,isOwner:!!target.canWrite,action_summary:{reviews:target.state.participants.filter(p=>p.reviewRequired&&!target.state.responses[p.id]).map(p=>({name:personName(p)})),signatures:target.state.participants.filter(p=>p.signing==='required'&&!target.state.signatures[p.id]).map(p=>({name:personName(p)}))}};
    setRecords(rows=>{const other=rows.filter(r=>r.id!==target.id);return matches?[card,...other].sort((a,b)=>String(b.visit_date).localeCompare(String(a.visit_date))||b.id.localeCompare(a.id)):other;});
  };
  const install = (r: VisitRecord) => {
    setDictation('');setWritingPending(false);setEditFocus(v=>v+1);
    setRecord(r);updateCard(r);
    const c=r.state.content;
    setContent(r.canWrite&&r.status==='draft'&&(c.workflow!=='3.1'||!c.points||c.agreements.length)?{...c,workflow:'3.1',agreements:[],discussion:'',points:c.points||[{id:crypto.randomUUID(),title:'',description:c.discussion,attachmentIds:[]}]}:c);
    setPeople(r.state.participants);
    setCreating(false);
    setHistory(null);
    setOnsite(null);
    setLink('');
  };
  const refreshList = async () => {
    const r = await visitRequest({
      action: 'list',
      worksiteId: workFilter,
      fromDate,toDate,
      status: statusFilter,
      search: query
    });
    setRecords(r.records);
    setHasMore(r.hasMore);
  };
  const open = async (id: string) => {
    if (dirty && !(await appConfirm('Quitas de pantalla un borrador con cambios sin guardar. ¿Continuar?'))) return;
    const r = await visitRequest({
      action: 'get',
      id
    });
    localPending.current=null;setSyncBlocked(false);
    if(draftUser)await clearVisitDraft(draftUser);
    install(r.record);
    setJobs(r.jobs);
  };
  const requestOperation = (key: string) => {
    if (operation.current?.key !== key) operation.current = {
      key,
      id: crypto.randomUUID()
    };
    return operation.current.id;
  };
  const commitCommand = async (target: VisitRecord,command: VisitCommand) => {
    const r = await visitRequest({
      action: 'command',
      id: target.id,
      revision: target.revision,
      command,
      operation: requestOperation(target.id + ':'+target.revision+JSON.stringify(command)),
      inPersonConfirmed: ['respond', 'sign','onsite-sign'].includes(command.type) && onsiteAck
    });
    operation.current = null;
    if(r.jobs)setJobs(r.jobs);
    return {...r.record,canWrite:true} as VisitRecord;
  };
  const mutate = async(command:VisitCommand)=>{
    if(!record)throw new Error('Guarda primero el borrador.');
    const updated=await commitCommand(record,command);install(updated);
    setMessage('Acta guardada. Los datos están confirmados por el servidor.');return updated;
  };
  const editActa=async(id:string)=>{
    if(record?.id===id&&record.status==='draft'&&record.canWrite){setEditFocus(v=>v+1);return;}
    if(dirty&&!await appConfirm('Hay cambios sin guardar. ¿Continuar y descartarlos?'))return;
    const loaded=await visitRequest({action:'get',id});let target=loaded.record as VisitRecord;
    if(!target.canWrite||target.status==='cancelled')throw new Error('No tienes permiso para editar esta acta o está eliminada.');
    if(target.status!=='draft'){
      if(!await appConfirm('Se conservará esta versión. La corrección creará un nuevo borrador y requerirá una nueva revisión y firmas. ¿Editar acta?'))return;
      target=await commitCommand(target,{type:'revise'});install(target);setJobs([]);await refreshList();
    }else{install(target);setJobs(loaded.jobs);}
    setMessage('Acta abierta para editar. Guarda los cambios antes de enviarla a revisión.');setEditFocus(v=>v+1);
  };
  const deleteActa=async(id:string)=>{
    const loaded=await visitRequest({action:'get',id});const target=loaded.record as VisitRecord;
    if(!target.canWrite)throw new Error('No tienes permiso para eliminar esta acta.');
    if(target.status!=='cancelled'){
      if(!await appConfirm(`¿Eliminar el acta ${target.number}? Se retirará del listado habitual y se anularán sus accesos de revisión. Las versiones firmadas y el historial se conservarán; las órdenes emitidas mantendrán su seguimiento.${record?.id===id&&dirty?' Los cambios sin guardar se descartarán.':''}`))return;
      let reason='Acta retirada por el supervisor mediante Eliminar acta.';
      if(target.status!=='draft'){const justification=await appPrompt('Indica el motivo de anulación. El documento y las evidencias se conservarán.');if(!justification?.trim())return;reason=justification.trim();}
      await commitCommand(target,{type:'cancel',reason});
    }
    setRecords(rows=>rows.filter(r=>r.id!==id));
    if(record?.id===id){setRecord(null);setContent(null);setCreating(false);setJobs([]);setHistory(null);setOnsite(null);setLink('');}
    setMessage('Acta eliminada del listado habitual. Puedes consultar el historial en el filtro Eliminadas / anuladas.');await refreshList();
  };
  const start = async (source?: VisitRecord) => {
    if (dirty && !(await appConfirm('Hay cambios sin guardar. ¿Abrir otra acta?'))) return;
    const work = works.find(w => w.id === (source?.obra_id || workFilter)) || (works.length===1?works[0]:undefined);
    const c = blankContent(work, supervisor);
    setRecord(null);setEditFocus(v=>v+1);
    setCreating(true);
    setDictation('');setWritingPending(false);setContent(c);
    setPeople(usualPeople(c.worksiteId));
    setJobs([]);
    setHistory(null);
    setOnsite(null);
    createId.current = crypto.randomUUID();
    setMessage('Borrador nuevo: guarda antes de solicitar la revisión.');
  };
  const persistDraft=async(automatic=false)=>{
    if(guard.current||!content)return;
    guard.current=true;saveEpoch.current++;setAutoSaving(true);setSyncState('Guardando…');
    let target=record;
    const submitted={content,people};
    try{
      if(!navigator.onLine)throw new Error('Sin conexión · pendiente de sincronización');
      if(localPending.current){
        const replay=await visitRequest(localPending.current);target={...replay.record,canWrite:true};localPending.current=null;
      }
      for(const a of target?.state.content.attachments||[])if(a.fileId)assetCache.current.set(target!.obra_id+':'+a.sha256,{id:a.fileId,sha256:a.sha256,bytes:a.bytes,mime:a.mime});
      const snapshot={content:await uploadPendingVisitAttachments(content,assetCache.current),people};
      cleanVisit(snapshot.content,snapshot.people);
      const same=target&&JSON.stringify({content:target.state.content,people:target.state.participants})===JSON.stringify(snapshot);
      if(!same){
        const request=target?{action:'command',id:target.id,revision:target.revision,operation:crypto.randomUUID(),command:{type:'save',content:snapshot.content,participants:snapshot.people}}:{action:'create',id:createId.current,operation:crypto.randomUUID(),content:snapshot.content,participants:snapshot.people};
        localPending.current=request;
        if(draftUser)await storeVisitDraft(draftUser,{...latestDraft.current,id:target?.id||createId.current,pending:request,configuration:{works,contacts,supervisor}});
        const result=await visitRequest(request);target={...result.record,canWrite:true};localPending.current=null;
      }
      if(!target)return;
      setRecord(target);setCreating(false);setSyncBlocked(false);
      // Typing during the request must never be replaced by the saved snapshot.
      const unchanged=latestDraft.current.content===submitted.content&&latestDraft.current.people===submitted.people;
      if(unchanged){
        latestDraft.current={...latestDraft.current,record:target,content:target.state.content,people:target.state.participants,creating:false};
        setContent(target.state.content);setPeople(target.state.participants);
        if(draftUser){
          if(latestDraft.current.dictation?.trim())await storeVisitDraft(draftUser,{...latestDraft.current,id:target.id,pending:null,configuration:{works,contacts,supervisor,technician}});
          else await clearVisitDraft(draftUser);
        }
        setRecovery(null);setSyncState(latestDraft.current.dictation?.trim()?'Acta guardada en servidor · dictado pendiente conservado solo en este dispositivo':'Guardado · confirmado en el servidor');
      }
      else setSyncState('Pendiente de sincronización · hay cambios posteriores');
      updateCard(target);
      if(!automatic)setMessage('Acta guardada. Los datos están confirmados por el servidor.');
      return target;
    }catch(e:any){
      // A definite validation rejection is safe to correct; a lost response is
      // not. Retain its operation ID until the server reconciles the result.
      if([400,403,422].includes(e.status))localPending.current=null;
      setSyncBlocked(true);setSyncState(e.status===409?'Conflicto: otra operación cambió el acta. La copia local se conserva. Actualiza antes de combinar los cambios.':e.message);
      if(!automatic)setError(e.message);
    }finally{guard.current=false;setAutoSaving(false);}
  };
  const save=()=>void persistDraft();
  const restoreDraft=()=>{
    if(!recovery)return;setRecord(recovery.record);setDictation(recovery.dictation||'');setContent(recovery.content);setPeople(recovery.people);setCreating(recovery.creating);createId.current=recovery.id;localPending.current=recovery.pending;setRecovery(null);setSyncBlocked(false);setSyncState('Borrador recuperado del dispositivo · pendiente de confirmar en el servidor');setEditFocus(v=>v+1);
  };
  const preview = (kind: 'review' | 'signing' | 'final',target:VisitRecord|null=record) => void run(async () => {
    if (!target) return;
    const r = await visitRequest({
      action: 'preview-mail',
      id: target.id,
      kind
    });
    setMailError('');setMailNotice('');setGmailRequired(false);
    const draft=kind==='review'&&target.state.content.workflow==='3.1';
    const pdfBytes=draft?await visitFileBytes(await visitRequest({action:'pdf',id:target.id})):undefined;
    const messages=draft?r.messages.filter((m:any)=>target.state.participants.some(p=>p.id===m.personId&&p.modality==='remote')):r.messages;
    setSelectedRecipients((target.state.reviewRecipients||target.state.participants.filter(p=>p.reviewEmailSelected&&p.reviewRequired&&p.email).map(p=>p.id)).filter(id=>messages.some((m:any)=>m.personId===id)));
    setMail({kind,messages,sender:r.sender,pdfBytes});
  });
  const reviewDraft=async()=>{if(writingPending||dictation.trim())return;const target=dirty?await persistDraft(false):record;if(target)preview('review',target);};
  const reviewAndSign=async()=>{
    if(openingParticipation.current||guard.current||attachmentBusy||writingPending||dictation.trim())return;
    openingParticipation.current=true;
    try{
      const target=dirty?await persistDraft(false):record;
      if(!target)return;
      await run(async()=>{
        const updated=await commitCommand(target,{type:'review',recipientIds:[]});
        install(updated);setJobs([]);
        setMessage('Acta preparada. Cada asistente puede revisar y firmar aquí.');
      });
    }finally{openingParticipation.current=false;}
  };
  const deliverMail = async (currentRecord:VisitRecord,pending:NonNullable<typeof mail>)=>{
      const record=currentRecord;
      setMailError('');setMailNotice('');setGmailRequired(false);setMailSending(true);
      try{
        let current=record,acceptedNow=0,result:any;
        let batchCount=0;
        const key=record.id+':'+record.version+':'+pending.kind;
        if(mailOperation.current?.key!==key)mailOperation.current={key,id:crypto.randomUUID()};
        do{
          result=await visitRequest({action:'send-mail',id:current.id,revision:current.revision,version:current.version,kind:pending.kind,reviewClosure,recipientIds:pending.kind==='review'?selectedRecipients:undefined,operation:mailOperation.current.id});
          if(result.record){current=result.record;install(current);}
          setJobs(result.jobs);acceptedNow+=result.acceptedNow||0;
          setMailNotice(`Gmail ha aceptado ${result.summary.accepted} de ${result.summary.total} correos. No se ha comprobado su entrega.`);
          if(result.failures.length){setMailError(result.failures[0].message);setGmailRequired(result.failures.some((e:any)=>['GMAIL_NOT_CONNECTED','GMAIL_RECONNECT_REQUIRED','GMAIL_SEND_PERMISSION_REQUIRED'].includes(e.code)));}
          batchCount++;
          if(result.hasMore && batchCount>=100){setMailError('El envío se ha detenido tras 100 lotes para evitar ejecuciones repetitivas. Comprueba los destinatarios pendientes antes de continuar.');return;}
        }while(result.hasMore);
        const {accepted,total,pending:remaining,uncertain}=result.summary;
        if(!total){setMessage(pending.kind==='final'?'Acta finalizada y publicada. No se han seleccionado destinatarios de correo.':'Revisión abierta. Continúa con la participación presencial.');setMail(null);mailOperation.current=null;return;}
        if(!remaining){
          const text=acceptedNow?`Gmail ha aceptado los correos de ${pending.kind==='review'?'revisión a los asistentes':pending.kind==='signing'?'firma a los asistentes':'actas firmadas'}. ${total} destinatario(s).`:`Gmail ya había aceptado estos ${total} correos. No se han vuelto a enviar.`;
          setMessage(text+' La aceptación no garantiza entrega ni lectura.');setMail(null);mailOperation.current=null;
        }else setMailNotice(`Gmail ha aceptado ${accepted} de ${total} correos. Hay destinatarios pendientes.${uncertain?' Hay resultados inciertos o envíos en curso; comprueba su estado antes de reintentar.':''}`);
      }catch(e:any){
        const auth=['GMAIL_NOT_CONNECTED','GMAIL_RECONNECT_REQUIRED','GMAIL_SEND_PERMISSION_REQUIRED'].includes(e.code);
        setGmailRequired(auth);setMailError(auth?'No se ha podido enviar el correo. Es necesario volver a autorizar Gmail.':e.message);
      }finally{setMailSending(false);}
  };
  const sendFlow=()=>{if(record&&mail&&!busy&&!guard.current)void run(()=>deliverMail(record,mail));};
  const reconnectVisitGmail=()=>void run(async()=>{try{const status=await getGmailConnectionStatus();await beginGmailOAuth(status.email||mail?.sender||'');}catch(e:any){setMailError(e.message);}});
  const reconcileMail=(jobId:string)=>void run(async()=>{try{const result=await visitRequest({action:'reconcile-mail',id:record!.id,jobId});setJobs(result.jobs);setMailNotice(result.message||'Estado de Gmail comprobado.');setMessage(result.message||'Estado de Gmail comprobado.');}catch(e:any){setMailError(e.message);setError(e.message);}});
  const usualPeople=(worksiteId:string)=>contacts.filter(c=>c.active&&c.assignments.some(a=>a.worksiteId===worksiteId)).map(c=>({...emptyPerson(),...c,role:c.assignments.find(a=>a.worksiteId===worksiteId)?.role||c.role,receiveFinal:!!c.email}));
  const addContact = (contact: VisitContact) => {
    if (people.some(p => p.id === contact.id)) return;
    const assignment = contact.assignments.find(a => a.worksiteId === content?.worksiteId);
    setPeople([...people, {
      ...emptyPerson(),
      ...contact,
      role: assignment?.role || contact.role,
      receiveFinal: !!contact.email
    }]);
  };
  const addProfile=(profile:any,role:string)=>{
    const name=String(profile.nombreApellidos||'').trim(),email=String(profile.email||'').trim().toLowerCase();
    if(!name){setError('No se puede añadir una persona sin nombre. Completa su configuración y vuelve a abrir Actas de visitas.');return;}
    if(people.some(p=>email?p.email.trim().toLowerCase()===email:personName(p).toLocaleLowerCase('es')===name.toLocaleLowerCase('es'))){setMessage('Esta persona ya está incluida.');return;}
    const names=name.split(/\s+/);setPeople([...people,{...emptyPerson(),firstName:names.shift()||'',lastName:names.join(' '),role:profile.cargo||role,entity:'Diputación Provincial de Cádiz',email,phone:profile.telefono||'',receiveFinal:!!email}]);
  };
  const addForeman=()=>{
    const work=works.find(w=>w.id===content?.worksiteId);
    if(!work?.visitForeman){setError('Completa los datos del encargado en Configuración → Obras y Recursos Preventivos de esta obra y vuelve a abrir Actas de visitas.');return;}
    addProfile(work.visitForeman,'Encargado de obra');
  };
  const saveUsualContact = async (p: VisitPerson) => {
    if (!content) return;
    const existing = contacts.find(c => c.id === p.id);
    const assignments = [...(existing?.assignments || []).filter(a => a.worksiteId !== content.worksiteId), {
      worksiteId: content.worksiteId,
      role: p.role
    }];
    const r = await visitRequest({
      action: 'save-contact',
      contact: {
        ...p,
        revision: existing?.revision || 0,
        active: true,
        assignments
      }
    });
    setContacts(current => [r.contact, ...current.filter(c => c.id !== p.id)]);
    setMessage('Contacto habitual guardado; las demás obras y actas anteriores se conservan.');
  };
  const changeWorksite=async(worksiteId:string)=>{
    if(!content)return;const work=works.find(w=>w.id===worksiteId);if(!work)return;
    if((people.length||content.discussion||content.purpose)&&!await appConfirm('Se conservará la redacción y se retirarán los participantes de la obra anterior. Revisa que el contenido corresponda a la nueva obra. ¿Cambiar obra?'))return;
    setContent({...content,worksiteId:work.id,worksite:work.nombre,code:work.codigo||'',municipality:work.municipio||'',location:'',orders:[],orderReferences:[],attachments:[],points:content.points?.map(p=>({...p,attachmentIds:[]}))});setPeople(usualPeople(work.id));
  };
  const canEdit = creating || record?.canWrite && record.status === 'draft';
  const canOpenSigning = !!record && ['review','changes','rejected'].includes(record.status) && record.state.participants.filter(p => p.reviewRequired).every(p => record.state.responses[p.id]);
  const canFinalize=!!record&&record.status!=='draft'&&record.status!=='signed'&&record.status!=='cancelled'&&record.state.participants.some(p=>p.signing==='required')&&record.state.participants.filter(p=>p.signing==='required').every(p=>record.state.signatures[p.id])&&record.state.participants.filter(p=>p.reviewRequired).every(p=>record.state.responses[p.id]);
  const finalizeActa=()=>void run(async()=>{
    if(!record)return;
    if(!await appConfirm('Se conservará esta versión definitiva y se intentará distribuir el PDF a los destinatarios seleccionados. ¿Finalizar acta y enviar?'))return;
    const finalized=await mutate({type:'finalize',reviewClosure});
    const finalPreview=await visitRequest({action:'preview-mail',id:finalized.id,kind:'final'});
    const finalMail={kind:'final' as const,messages:finalPreview.messages,sender:finalPreview.sender};
    setMailError('');setMailNotice('PDF definitivo conservado y publicado.');setMail(finalMail);await deliverMail(finalized,finalMail);
  });
  const openOnsite=(p:VisitPerson)=>{setOnsite({personId:p.id,kind:record?.state.responses[p.id]?'signature':'response'});setOnsiteAck(false);};
  return <main className="visit-minutes-mobile mx-auto w-full min-w-0 max-w-6xl space-y-3 text-slate-900 dark:text-slate-100 sm:space-y-4">
    <header className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 sm:p-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><h1 className="text-xl font-black tracking-tight sm:text-2xl">Actas de visitas</h1><p className="mt-1 text-xs text-slate-600 dark:text-slate-300 sm:text-sm">Redactar · Revisar y firmar · Seguimiento</p></div>
        <button type="button" disabled={!loaded || busy || autoSaving || !!recovery || !works.length} onClick={() => void run(() => start())} className={primary + ' w-full shrink-0 sm:w-auto'}>+ Nueva acta</button>
      </div>
    </header>
    {recovery&&<section className="rounded-xl border border-amber-300 p-3 space-y-2"><p>Hay un borrador pendiente en este dispositivo. No está confirmado en el servidor.</p><div className="grid grid-cols-2 gap-2"><button className={primary} onClick={restoreDraft}>Recuperar borrador</button><button className={button} onClick={()=>void run(async()=>{if(await appConfirm('¿Descartar la copia pendiente de este dispositivo?')){await clearVisitDraft(draftUser);setRecovery(null);}})}>Descartar copia local</button></div></section>}
    {syncState&&<p role="status" aria-label="Estado de guardado" className="text-xs text-slate-600 dark:text-slate-300">{syncState}</p>}
    {error&&<div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-800">{error}<button type="button" className="ml-3 underline" onClick={()=>window.location.reload()}>Recargar módulo</button></div>}
    {message&&<p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-950 dark:bg-blue-950 dark:text-blue-100">{message}</p>}
    {busy&&<p role="status">Procesando… No cierres esta pantalla hasta recibir confirmación.</p>}
    <section aria-label="Listado de actas" className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 sm:p-4">
      <div className="grid min-w-0 grid-cols-2 items-end gap-2 sm:grid-cols-3">
        <label className="min-w-0 text-xs font-bold">Obra
          <select className={visitInput} value={workFilter} onChange={e=>setWorkFilter(e.target.value)} disabled={busy}>
            <option value="">Todas las obras</option>{works.map(w=><option key={w.id} value={w.id}>{w.codigo} · {w.nombre}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-xs font-bold">Estado
          <select aria-label="Estado de las actas" className={visitInput} disabled={busy} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            <option value="">No eliminadas</option>{Object.entries(VISIT_STATUS_LABELS).map(([k,v])=><option key={k} value={k}>{k==='cancelled'?'Eliminadas / anuladas':v}</option>)}
          </select>
        </label>
        <details className="col-span-2 min-w-0 rounded-xl border border-slate-200 dark:border-slate-700 sm:col-span-1">
          <summary className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl px-3 text-sm font-bold text-[#00548E] dark:text-blue-300">Buscar y filtrar por fecha</summary>
          <form onSubmit={e=>{e.preventDefault();setQuery(search);}} className="grid min-w-0 gap-2 border-t border-slate-200 p-3 dark:border-slate-700">
            <label className="min-w-0 text-xs font-bold">Número, obra o asistente
              <input className={visitInput} value={search} onChange={e=>setSearch(e.target.value)} maxLength={100}/>
            </label>
            <div className="grid min-w-0 grid-cols-1 gap-2 min-[400px]:grid-cols-2">
              <label className="min-w-0 text-xs font-bold">Desde<input type="date" className={visitInput} value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label>
              <label className="min-w-0 text-xs font-bold">Hasta<input type="date" className={visitInput} value={toDate} onChange={e=>setToDate(e.target.value)}/></label>
            </div>
            <button type="submit" className={primary+' w-full'} disabled={busy}>Buscar actas</button>
          </form>
        </details>
      </div>
      {loading&&<p role="status">Cargando actas…</p>}
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        {records.map(r=>{
          const pending=r.action_summary
            ? (r.status==='signing'?r.action_summary.signatures:r.action_summary.reviews).length
            : 0;
          const active=record?.id===r.id;
          return <article aria-label={'Acta '+r.number} key={r.id}
            className={`min-w-0 rounded-xl border px-3 py-2.5 ${active?'border-[#00548E] bg-blue-50 dark:bg-blue-950/30':'border-slate-200 dark:border-slate-700'}`}>
            <button aria-label={'Abrir acta '+r.number} disabled={busy} onClick={()=>void run(()=>open(r.id))}
              className="flex min-h-11 w-full min-w-0 items-start justify-between gap-2 text-left">
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">{r.number} · v{r.version}</strong>
                <span className="mt-0.5 block truncate text-xs text-slate-600 dark:text-slate-300" title={r.worksite}>{r.worksite}</span>
                <span className="mt-1 block text-xs text-slate-600 dark:text-slate-300">{String(r.visit_date).slice(0,10)}{pending>0?` · ${pending} pendiente(s)`:''}</span>
              </span>
              <span className="max-w-[43%] shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-center text-[11px] font-bold text-[#00548E] dark:bg-slate-800 dark:text-blue-300">{VISIT_STATUS_LABELS[r.status as keyof typeof VISIT_STATUS_LABELS]}</span>
            </button>
            {r.isOwner&&r.status!=='cancelled'&&<div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 dark:border-slate-700">
              <button aria-label={'Editar acta '+r.number} disabled={busy} className={button+' w-full'} onClick={()=>void run(()=>editActa(r.id))}>Editar</button>
              <details className="min-w-0 rounded-xl border border-slate-300 dark:border-slate-600">
                <summary className="flex min-h-11 cursor-pointer items-center justify-center px-2 text-sm font-bold">Más opciones</summary>
                <div className="border-t border-slate-200 p-2 dark:border-slate-700">
                  <button aria-label={'Eliminar acta '+r.number} disabled={busy} className={button+' w-full !text-red-700 dark:!text-red-300'} onClick={()=>void run(()=>deleteActa(r.id))}>Eliminar acta</button>
                </div>
              </details>
            </div>}
          </article>;
        })}
      </div>
      {loaded&&!loading&&!records.length&&<p className="text-sm text-slate-600 dark:text-slate-300">No hay actas que coincidan con los filtros.</p>}
      {hasMore&&<button disabled={busy} className={button+' w-full'} onClick={()=>void run(async()=>{
        const r=await visitRequest({action:'list',worksiteId:workFilter,fromDate,toDate,status:statusFilter,search:query,offset:records.length});
        setRecords(current=>[...current,...r.records.filter((n:any)=>!current.some(x=>x.id===n.id))]);
        setHasMore(r.hasMore);
      })}>Cargar siguientes actas</button>}
    </section>
    {content && <section ref={editorRef} tabIndex={-1} className="space-y-4">
      <nav aria-label="Etapas del acta" className="grid grid-cols-2 gap-1 text-xs font-bold">{['Redactar','Revisar y firmar'].map((label,i)=><span key={label} aria-current={(record&&record.status!=='draft'?1:0)===i?'step':undefined} className="rounded-lg border p-2">{i+1}. {label}</span>)}</nav><div className="flex flex-wrap gap-2 items-center"><h2 className="text-xl font-black">{record ? `${record.number} · v${record.version} · ${VISIT_STATUS_LABELS[record.status]}` : 'Nueva visita'}</h2>{dirty && <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">Cambios sin guardar</span>}</div>
      {canEdit ? <fieldset disabled={busy||attachmentBusy} className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 sm:p-5">
        <legend className="font-black">Datos de la visita</legend>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Obra<select disabled={!creating} className={visitInput} value={content.worksiteId} onChange={e => void run(()=>changeWorksite(e.target.value))}><option value="">Selecciona una obra…</option>{works.map(w => <option key={w.id} value={w.id}>{w.codigo} · {w.nombre}</option>)}</select></label>{([['date','Fecha','date'],['start','Hora inicio','time']] as const).map(([key,label,type])=><label className="text-sm font-bold" key={key}>{label}<input className={visitInput} type={type} value={content[key]} onChange={e=>setContent({...content,[key]:e.target.value})}/></label>)}</div>
        <div key={editFocus+':'+content.worksiteId}><VisitPointsEditor content={content} onChange={setContent} onCreateOrder={setOrderSeed} recordId={record?.id} dictation={dictation} onDictationChange={setDictation} onPending={setWritingPending}/></div>
        <details className="rounded-xl border p-3"><summary className="min-h-[44px] cursor-pointer font-bold">Más datos de la visita (opcional)</summary><div className="grid gap-3 sm:grid-cols-2">{([['end','Hora final','time'],['location','Emplazamiento','text'],['municipality','Municipio','text'],['promoter','Promotor','text'],['author','Redacta: nombre y apellidos','text'],['authorRole','Cargo del autor','text'],['authorEmail','Correo del autor','email'],['authorPhone','Teléfono del autor','tel'],['nextVisit','Próxima visita (opcional)','date']] as const).map(([key,label,type])=><label key={key} className="text-sm font-bold">{label}<input className={visitInput} type={type} value={content[key]} onChange={e=>setContent({...content,[key]:e.target.value})}/></label>)}</div></details>
        <VisitWorkOrdersEditor content={content} people={people} onChange={setContent} orderSeed={orderSeed} onOrderSeedHandled={()=>setOrderSeed(null)}/>
        <VisitParticipantsEditor people={people} contacts={contacts} worksiteId={content.worksiteId} supervisor={supervisor} technician={technician} onChange={setPeople} onAddContact={addContact} onAddProfile={addProfile} onAddManual={()=>setPeople([...people,emptyPerson()])} onAddForeman={addForeman} onSaveContact={p=>void run(()=>saveUsualContact(p))}/>
        <VisitAttachmentsEditor content={content} onChange={setContent} totalLimit={attachmentTotal} onProcessing={setAttachmentBusy}/>
        {writingPending&&<p className="text-sm">Aplica o descarta la propuesta y el dictado pendiente antes de revisar y firmar.</p>}<div className="visit-draft-actions grid min-w-0 grid-cols-2 gap-2"><button type="button" className={button+" w-full"} disabled={autoSaving||attachmentBusy} onClick={save}>Guardar borrador</button><button type="button" className={primary+" w-full"} disabled={busy||autoSaving||attachmentBusy||writingPending||!online} onClick={()=>void reviewAndSign()}>Revisar y firmar</button></div>
        {people.some(p=>p.modality==='remote'&&p.reviewRequired)&&<button type="button" className={button} disabled={busy||autoSaving||attachmentBusy||writingPending||!online} onClick={()=>void reviewDraft()}>Enviar borrador a participantes remotos</button>}
      </fieldset> : record && <VisitMinutesReadView state={record.state} number={record.number} />}
      {record && <div className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 sm:p-4">
        {!record.canWrite && <p className="font-bold">Consulta de obra compartida. Solo el autor puede modificar o distribuir esta acta.</p>}
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <button disabled={busy} className={button+' w-full'} onClick={()=>void run(async()=>downloadVisitFile(await visitRequest({action:'pdf',id:record.id})))}>
            {record.status==='signed'?'PDF firmado':'Consultar PDF'}
          </button>
          <button disabled={busy} className={button+' w-full'} onClick={()=>void run(()=>open(record.id))}>Actualizar</button>
          {record.canWrite&&record.state.content.workflow!=='3.1'&&['review','changes','rejected'].includes(record.status)&&
            <button disabled={busy||!canOpenSigning} className={primary+' col-span-2 w-full'} onClick={()=>preview('signing')}>Abrir firmas y avisar</button>}
          {record.canWrite&&['review','changes','rejected','signing'].includes(record.status)&&
            <button disabled={busy||!canFinalize} className={primary+' col-span-2 w-full'} onClick={finalizeActa}>Finalizar acta y enviar</button>}
          <details className="col-span-2 min-w-0 rounded-xl border border-slate-200 dark:border-slate-700">
            <summary className="flex min-h-11 cursor-pointer items-center justify-center px-3 text-sm font-bold text-[#00548E] dark:text-blue-300">Más opciones del acta</summary>
            <div className="grid min-w-0 grid-cols-2 gap-2 border-t border-slate-200 p-2 dark:border-slate-700">
              <button disabled={busy} className={button+' w-full'} onClick={()=>void run(async()=>setHistory(await visitRequest({action:'history',id:record.id})))}>Trazabilidad y versiones</button>
              {record.canWrite&&record.status!=='cancelled'&&<button disabled={busy} className={button+' w-full'} onClick={()=>void run(()=>editActa(record.id))}>{record.status==='signed'?'Rectificar acta':'Editar acta'}</button>}
              {record.canWrite&&record.status==='signed'&&<>
                <button disabled={busy} className={button+' w-full'} onClick={()=>preview('final')}>Reintentar distribución</button>
                <button disabled={busy} className={button+' w-full'} onClick={()=>void run(()=>start(record))}>Nueva visita con órdenes pendientes</button>
              </>}
              {record.canWrite&&record.status!=='cancelled'&&<button disabled={busy} className={button+' col-span-2 w-full !text-red-700 dark:!text-red-300'} onClick={()=>void run(()=>deleteActa(record.id))}>{record.status==='signed'?'Anular acta justificadamente':'Eliminar acta'}</button>}
            </div>
          </details>
        </div>
        {['review','changes','rejected'].includes(record.status)&&Object.values(record.state.responses).some((r:any)=>r.decision!=='agree')&&<label className="block font-bold">Tratamiento de observaciones y discrepancias<textarea className={visitInput} value={reviewClosure} onChange={e=>setReviewClosure(e.target.value)} placeholder="Explica la resolución o la conservación de las reservas. Si cambia el contenido, crea una nueva versión."/></label>}
        {record.status === 'review' && !canOpenSigning && <p className="text-sm text-amber-700 dark:text-amber-300">Faltan revisiones del contenido. El silencio no equivale a aceptación.</p>}
        {(()=>{const p=visitProgress(record.state);return <section aria-label="Resumen de participación" className="grid grid-cols-2 gap-2 rounded-xl bg-blue-50 p-3 text-xs font-medium text-blue-950 dark:bg-blue-950 dark:text-blue-100 sm:text-sm"><p>Revisiones: {p.reviewed}/{p.reviews} · Pendientes: {p.reviews-p.reviewed}</p><p>Firmas obligatorias: {p.signed}/{p.signatures} · Pendientes: {p.signatures-p.signed}</p><p>Errores de envío: {jobs.filter(j=>j.version===record.version&&['failed','uncertain'].includes(j.status)).length}</p>{record.status==='signed'&&<p>{jobs.some(j=>j.version===record.version&&j.kind==='final'&&j.status!=='sent')?'PDF definitivo conservado y publicado · distribución pendiente':'PDF definitivo conservado y publicado'}</p>}</section>})()}
        {record.canWrite&&['review','changes','rejected','signing'].includes(record.status)&&<section className="space-y-3"><h3 className="font-black">Participación y firmas</h3>{record.state.participants.filter(p=>p.reviewRequired).map(p=><article key={p.id} aria-label={'Participación de '+personName(p)} className="rounded-xl border p-3 space-y-2"><strong>{personName(p)}</strong><p className="text-sm">{record.state.responses[p.id]?.decision==='agree'?'Conforme':record.state.responses[p.id]?.decision==='changes'?'Con observaciones':record.state.responses[p.id]?.decision==='reject'?'Disconforme':'Pendiente de revisión'} · {record.state.signatures[p.id]?'Firmado':'Firma pendiente'}</p><div className="flex flex-wrap gap-2">{p.attended&&p.modality!=='remote'&&!record.state.signatures[p.id]&&<button disabled={busy} className={primary} onClick={()=>openOnsite(p)}>Revisar y firmar aquí</button>}{p.modality==='remote'&&!record.state.signatures[p.id]&&<><button disabled={busy} className={button} onClick={()=>void run(async()=>{const key=record.id+':remote-signing:'+p.id;if(operation.current?.key!==key)operation.current={key,id:crypto.randomUUID()};const result=await visitRequest({action:'remind',kind:'signing',id:record.id,personId:p.id,operation:operation.current.id});operation.current=null;setJobs(result.jobs);setMessage(result.delivery==='sent'?'Solicitud de firma remota aceptada por Gmail. La persona debe verificar su correo.':'Solicitud pendiente de confirmación.');})}>Solicitar firma remota protegida</button><button disabled={busy} className={button} onClick={()=>void run(async()=>{const result=await visitRequest({action:'link',id:record.id,personId:p.id});setLink(result.url);setMessage('Acceso personal de siete días. No lo compartas con otras personas.');})}>Generar / renovar enlace personal</button><button disabled={busy} className={button} onClick={()=>void run(async()=>{await visitRequest({action:'revoke-link',id:record.id,personId:p.id});setLink('');setMessage('Acceso revocado.');})}>Revocar enlace</button></>}{!record.state.signatures[p.id]&&p.signing!=='none'&&<button disabled={busy} className={button} onClick={()=>void run(async()=>{if(await appConfirm('Se invalidará el acceso anterior. ¿Cambiar la modalidad de esta persona?'))await mutate({type:'modality',personId:p.id,modality:p.modality==='remote'?'in-person':'remote'});})}>Cambiar a {p.modality==='remote'?'presencial':'remota'}</button>}</div></article>)}</section>}
        {link&&<label className="block font-bold">Enlace personal: entrégalo solo a su destinatario<input className={visitInput} readOnly value={link} onFocus={e=>e.currentTarget.select()}/></label>}
        {onsite&&<VisitOnsiteFlow record={record} person={record.state.participants.find(p=>p.id===onsite.personId)!} busy={busy} error={error} identityChecked={onsiteAck} onIdentityChecked={setOnsiteAck} onClose={()=>setOnsite(null)} onSubmit={command=>void run(async()=>{await mutate(command);})}/>}
        {!!jobs.length && <section><h3 className="font-black">Distribución por destinatario</h3><p className="text-xs">Aceptado por Gmail no acredita recepción o lectura. Si el resultado es incierto, comprueba Enviados; no se reintentará automáticamente.</p>{jobs.filter(j => j.version === record.version).map(j => <div key={j.id} className="mt-2 rounded-xl border p-3 text-sm"><strong>{personName(record.state.participants.find(p => p.id === j.person_id) || {
                firstName: 'Participante',
                lastName: ''
              })}</strong><p>{j.kind === 'review' ? 'Revisión' : j.kind === 'signing' ? 'Firma' : 'PDF final'} · {({
                pending: 'Pendiente',
                sending: 'En curso',
                sent: 'Aceptado por Gmail',
                failed: 'Fallido',
                uncertain: 'Resultado incierto',
                cancelled: 'Cancelado'
              } as any)[j.status]} · {j.attempts} intento(s)</p><p>Revisión: {({agree:'Conforme con el contenido',changes:'Con observaciones',reject:'Disconforme'} as any)[record.state.responses[j.person_id]?.decision||'']||(record.state.participants.find(p=>p.id===j.person_id)?.reviewRequired?'Pendiente de revisión':'No requiere revisión')} · {record.state.signatures[j.person_id]?'Firmado':record.state.participants.find(p=>p.id===j.person_id)?.signing==='none'?'No requiere firma':record.status==='signing'?'Pendiente de firma':record.status==='signed'?'Firma opcional no aportada':'Firma no habilitada'}</p>{j.error_code&&<p>Código: {j.error_code}</p>}{j.message_id&&<p>Identificador Gmail: {j.message_id}</p>}{['uncertain','sending'].includes(j.status)&&<button className={button} disabled={busy} onClick={()=>reconcileMail(j.id)}>Comprobar en Enviados</button>}{record.canWrite && ['pending', 'failed'].includes(j.status) && <button disabled={busy} className={button + ' mt-2'} onClick={() => void run(async () => {
              const result=await visitRequest({action:'preview-mail',id:record.id,kind:j.kind});setMailError('');setMailNotice('');setGmailRequired(false);setMail({kind:j.kind,messages:result.messages,sender:result.sender});
            })}>Reintentar correos pendientes</button>}</div>)}</section>}
        <details className="rounded-xl border border-slate-200 dark:border-slate-700"><summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-bold text-[#00548E] dark:text-blue-300">Seguimiento de órdenes de obra</summary><div className="border-t border-slate-200 p-3 dark:border-slate-700"><VisitWorkOrdersFollowup worksiteId={record.obra_id} /></div></details>
        {history && <section className="space-y-2"><h3 className="font-black">Versiones archivadas y trazabilidad</h3>{history.versions.map((v: any) => <button key={v.version} disabled={busy} className={button} onClick={() => void run(async () => downloadVisitFile(await visitRequest({
            action: 'pdf',
            id: record.id,
            version: v.version
          })))}>Descargar versión {v.version}</button>)}<ol className="max-h-96 overflow-auto space-y-2">{history.events.map((e: any) => <li key={e.id} className="rounded-lg border p-3 text-sm">{madridTimestamp(e.at)} · v{e.version} · {e.event} · {e.actor.startsWith('participant:') ? personName(record.state.participants.find(p => p.id === e.actor.slice(12)) || {
                firstName: 'Participante de versión anterior',
                lastName: ''
              }) : 'Supervisor'}</li>)}</ol>{history.events.length >= 200 && <button disabled={busy} className={button} onClick={() => void run(async () => {
            const r = await visitRequest({
              action: 'history',
              id: record.id,
              offset: history.events.length
            });
            setHistory({
              ...history,
              events: [...history.events, ...r.events]
            });
          })}>Cargar eventos anteriores</button>}</section>}
      </div>}
    </section>}
    {mail&&<ModalPortal layout="fullscreen" label="Revisar correos antes de enviar"><div className="visit-mail-overlay"><section role="dialog" aria-modal="true" aria-labelledby="visit-mail-title" className="visit-mail-dialog bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"><header className="visit-mail-header"><h2 id="visit-mail-title" className="text-xl font-black">{mail.kind==='review'?'Revisar borrador y destinatarios':'Revisar correos antes de enviar'}</h2></header><div className="visit-mail-body">
      {mail.pdfBytes&&<Suspense fallback={<p>Cargando vista previa…</p>}><VisitPdfPreview embedded bytes={mail.pdfBytes} title="BORRADOR — PENDIENTE DE REVISIÓN Y FIRMA"/></Suspense>}
      {!mail.pdfBytes&&mail.kind==='review'&&record&&<VisitMinutesReadView state={record.state} number={record.number}/>}
      {mail.sender&&<p className="font-bold">Cuenta remitente autorizada: {mail.sender}</p>}
      {mail.kind==='review'&&record?.state.content.workflow==='3.1'&&<p>Se enviará exclusivamente el PDF borrador a las personas seleccionadas. Este correo no solicita firma ni envía códigos de verificación.</p>}
      {mailSending&&<p role="status">Enviando correos… No cierres esta ventana.</p>}
      {mailError&&<div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-900">{mailError}{gmailRequired&&<button className={primary+' mt-2'} disabled={busy} onClick={reconnectVisitGmail}>Volver a autorizar Gmail</button>}</div>}
      {mailNotice&&<p role="status">{mailNotice}</p>}
      <p className="text-sm">Los correos son individuales. Aceptado por Gmail no acredita entrega, lectura ni conformidad.</p>
      {mail.kind==='final'&&<p className="font-bold">Se utiliza el PDF definitivo conservado y publicado.</p>}
      {!mail.messages.length&&<p>No hay destinatarios de correo seleccionables para esta fase. Puedes continuar con el flujo presencial.</p>}
      {mail.messages.map(m=><div className="rounded-xl border p-3 space-y-2" key={m.personId}>
        {mail.kind==='review'&&record?.state.content.workflow==='3.1'?<label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" aria-label={'Enviar borrador a '+m.email} disabled={busy||record.status!=='draft'||!!mailOperation.current} checked={selectedRecipients.includes(m.personId)} onChange={e=>setSelectedRecipients(ids=>e.target.checked?[...ids,m.personId]:ids.filter(id=>id!==m.personId))}/>Enviar borrador a {m.email}</label>:<p className="font-bold">Para: {m.email}</p>}
        <p>{({sent:'Aceptado por Gmail',pending:'Pendiente de envío',failed:'Error de envío',sending:'Enviando',uncertain:'Resultado incierto',cancelled:'Cancelado'} as any)[jobs.find(j=>j.version===record?.version&&j.kind===mail.kind&&j.person_id===m.personId)?.status||'pending']}</p>
        {jobs.filter(j=>j.version===record?.version&&j.kind===mail.kind&&j.person_id===m.personId&&['uncertain','sending'].includes(j.status)).map(j=><button key={j.id} className={button} disabled={busy} onClick={()=>reconcileMail(j.id)}>Comprobar en Enviados</button>)}
        <details><summary className="min-h-[44px] font-bold">Contenido del correo</summary><p className="font-bold">{m.subject}</p><pre className="whitespace-pre-wrap break-words font-sans text-sm">{m.body}</pre></details>
      </div>)}
    </div><footer className="visit-mail-actions"><button disabled={busy} className={primary} onClick={sendFlow}>{mailSending?'Enviando correos…':mailError?'Reintentar correos pendientes':mail.kind==='review'&&record?.state.content.workflow==='3.1'&&!selectedRecipients.length?'Continuar sin enviar correo':'Confirmar y enviar correos'}</button><button disabled={busy} className={button} onClick={()=>setMail(null)}>Cancelar</button></footer></section></div></ModalPortal>}
  </main>;
}
