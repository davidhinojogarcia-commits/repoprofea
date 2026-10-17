import React, { useEffect, useRef, useState } from 'react';
import { VisitWorkOrdersEditor } from './VisitWorkOrdersEditor';
import { VisitWorkOrdersFollowup } from './VisitWorkOrdersFollowup';
import { beginGmailOAuth, getGmailConnectionStatus } from '../src/lib/gmailConnection';
import ModalPortal from './ModalPortal';
import { appConfirm } from '../src/lib/appDialog';
import { loadAppBusinessSettings } from '../src/services/appSettingsService';
import { visitRequest, downloadVisitFile, readVisitAttachment } from '../src/services/visitMinutesService';
import { madridDate, personName, VISIT_STATUS_LABELS, type VisitContent, type VisitPerson, type VisitRecord, type VisitCommand, type VisitContact, madridTimestamp } from '../src/lib/visitMinutes';
import { VisitMinutesReadView } from './VisitMinutesReadView';
import { VisitSignaturePad } from './VisitSignaturePad';
import { visitInput } from './VisitContactsPanel';
const button = 'min-h-[46px] rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold disabled:opacity-50 dark:border-slate-600';
const primary = button + ' bg-[#00548E] text-white';
const emptyPerson = (): VisitPerson => ({
  id: crypto.randomUUID(),
  firstName: '',
  lastName: '',
  role: '',
  entity: '',
  phone: '',
  email: '',
  attended: true,
  reviewRequired: true,
  signing: 'required',
  receiveFinal: true
});
function blankContent(work: any, supervisor: any): VisitContent {
  return {
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
    } | null>(null),
    [onsite, setOnsite] = useState<{
      personId: string;
      kind: 'response' | 'signature';
    } | null>(null),
    [onsiteAck, setOnsiteAck] = useState(false),
    [responseComment, setResponseComment] = useState(''),
    [link, setLink] = useState('');
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
  // Form updates are immutable. Reference changes avoid serializing megabytes
  // of attachments on every keystroke just to show the unsaved-changes badge.
  const dirty = !!content && (creating || record?.state.status === 'draft' && (content !== record.state.content || people !== record.state.participants));
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
    Promise.all([visitRequest({
      action: 'works'
    }, {
      signal: abort.signal
    }), visitRequest({
      action: 'contacts'
    }, {
      signal: abort.signal
    }), loadAppBusinessSettings()]).then(([w, c, s]) => {
      setWorks(w.works);
      setContacts(c.contacts);
      setSupervisor(s.supervisor);
      setTechnician(s.technician || {});
      const match = w.works.find((work: any) => work.nombre === initialWorksite || work.id === initialWorksite);
      setWorkFilter(match?.id || '');
      setLoaded(true);
    }).catch(e => {
      if (!abort.signal.aborted) setError(e.message);
    });
    return () => abort.abort();
  }, [initialWorksite]);
  useEffect(() => {
    if (!loaded) return;
    const abort = new AbortController();
    setLoading(true);
    visitRequest({
      action: 'list',
      worksiteId: workFilter,
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
  }, [loaded, workFilter, statusFilter, query]);
  const run = async (task: () => Promise<void>) => {
    if (guard.current) return;
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
  const install = (r: VisitRecord) => {
    setRecord(r);
    setContent(r.canWrite&&r.status==='draft'&&r.state.content.agreements.length?{...r.state.content,agreements:[]}:r.state.content);
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
      inPersonConfirmed: ['respond', 'sign'].includes(command.type) && onsiteAck
    });
    operation.current = null;
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
      await commitCommand(target,{type:'cancel',reason:'Acta retirada por el supervisor mediante Eliminar acta.'});
    }
    setRecords(rows=>rows.filter(r=>r.id!==id));
    if(record?.id===id){setRecord(null);setContent(null);setCreating(false);setJobs([]);setHistory(null);setOnsite(null);setLink('');}
    setMessage('Acta eliminada del listado habitual. Puedes consultar el historial en el filtro Eliminadas / anuladas.');await refreshList();
  };
  const start = async (source?: VisitRecord) => {
    if (dirty && !(await appConfirm('Hay cambios sin guardar. ¿Abrir otra acta?'))) return;
    const work = works.find(w => w.id === (source?.obra_id || workFilter)) || works[0];
    const c = blankContent(work, supervisor);
    setRecord(null);
    setCreating(true);
    setContent(c);
    setPeople([]);
    setJobs([]);
    setHistory(null);
    setOnsite(null);
    createId.current = crypto.randomUUID();
    setMessage('Borrador nuevo: guarda antes de solicitar la revisión.');
  };
  const save = () => void run(async () => {
    if (!content) return;
    if (creating) {
      const r = await visitRequest({
        action: 'create',
        id: createId.current,
        operation: requestOperation(createId.current + JSON.stringify({
          content,
          people
        })),
        content,
        participants: people
      });
      operation.current = null;
      install({
        ...r.record,
        canWrite: true
      });
      setMessage('Borrador creado y guardado.');
    } else await mutate({
      type: 'save',
      content,
      participants: people
    });
    await refreshList();
  });
  const preview = (kind: 'review' | 'signing' | 'final') => void run(async () => {
    if (!record) return;
    const r = await visitRequest({
      action: 'preview-mail',
      id: record.id,
      kind
    });
    setMailError('');setMailNotice('');setGmailRequired(false);
    setMail({kind,messages:r.messages,sender:r.sender});
  });
  const sendFlow = () => {
    if(!record||!mail||busy||guard.current)return;
    const pending=mail;
    void run(async()=>{
      setMailError('');setMailNotice('');setGmailRequired(false);setMailSending(true);
      try{
        let current=record,acceptedNow=0,result:any;
        let batchCount=0;
        const key=record.id+':'+record.version+':'+pending.kind;
        if(mailOperation.current?.key!==key)mailOperation.current={key,id:crypto.randomUUID()};
        do{
          result=await visitRequest({action:'send-mail',id:current.id,revision:current.revision,version:current.version,kind:pending.kind,operation:mailOperation.current.id});
          if(result.record){current=result.record;install(current);setRecords(old=>old.map(r=>r.id===current.id?{...r,status:current.status,version:current.version}:r));}
          setJobs(result.jobs);acceptedNow+=result.acceptedNow||0;
          setMailNotice(`Gmail ha aceptado ${result.summary.accepted} de ${result.summary.total} correos. No se ha comprobado su entrega.`);
          if(result.failures.length){setMailError(result.failures[0].message);setGmailRequired(result.failures.some((e:any)=>['GMAIL_NOT_CONNECTED','GMAIL_RECONNECT_REQUIRED','GMAIL_SEND_PERMISSION_REQUIRED'].includes(e.code)));}
          batchCount++;
          if(result.hasMore && batchCount>=100){setMailError('El envío se ha detenido tras 100 lotes para evitar ejecuciones repetitivas. Comprueba los destinatarios pendientes antes de continuar.');return;}
        }while(result.hasMore);
        const {accepted,total,pending:remaining,uncertain}=result.summary;
        if(!total){setMailNotice('No hay destinatarios con correo. La participación presencial sigue disponible.');return;}
        if(!remaining){
          const text=acceptedNow?`Gmail ha aceptado los correos de ${pending.kind==='review'?'revisión a los asistentes':pending.kind==='signing'?'firma a los asistentes':'actas firmadas'}. ${total} destinatario(s).`:`Gmail ya había aceptado estos ${total} correos. No se han vuelto a enviar.`;
          setMessage(text+' La aceptación no garantiza entrega ni lectura.');setMail(null);mailOperation.current=null;
        }else setMailNotice(`Gmail ha aceptado ${accepted} de ${total} correos. Hay destinatarios pendientes.${uncertain?' Hay resultados inciertos o envíos en curso; comprueba su estado antes de reintentar.':''}`);
      }catch(e:any){
        const auth=['GMAIL_NOT_CONNECTED','GMAIL_RECONNECT_REQUIRED','GMAIL_SEND_PERMISSION_REQUIRED'].includes(e.code);
        setGmailRequired(auth);setMailError(auth?'No se ha podido enviar el correo. Es necesario volver a autorizar Gmail.':e.message);
      }finally{setMailSending(false);}
    });
  };
  const reconnectVisitGmail=()=>void run(async()=>{try{const status=await getGmailConnectionStatus();await beginGmailOAuth(status.email||mail?.sender||'');}catch(e:any){setMailError(e.message);}});
  const reconcileMail=(jobId:string)=>void run(async()=>{try{const result=await visitRequest({action:'reconcile-mail',id:record!.id,jobId});setJobs(result.jobs);setMailNotice(result.message||'Estado de Gmail comprobado.');setMessage(result.message||'Estado de Gmail comprobado.');}catch(e:any){setMailError(e.message);setError(e.message);}});
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
    setContent({...content,worksiteId:work.id,worksite:work.nombre,code:work.codigo||'',municipality:work.municipio||'',location:''});setPeople([]);
  };
  const canEdit = creating || record?.canWrite && record.status === 'draft';
  const canOpenSigning = record?.status === 'review' && record.state.participants.filter(p => p.reviewRequired).every(p => record.state.responses[p.id]?.decision === 'agree');
  return <main className="mx-auto max-w-6xl space-y-4 text-slate-900 dark:text-slate-100">
    <header className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900"><h1 className="text-2xl font-black">Actas de visitas de obra</h1><p className="mt-2 text-sm">Registra órdenes e instrucciones, revisa el documento, recoge firmas y sigue su ejecución entre visitas.</p><button disabled={!loaded || busy || !works.length} onClick={() => void run(() => start())} className={primary + ' mt-4'}>Nueva acta de visita</button></header>
    {error && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">{error}<button type="button" className="ml-3 underline" onClick={() => window.location.reload()}>Recargar módulo</button></div>}{message && <p role="status" className="rounded-xl bg-blue-50 p-4 text-blue-900">{message}</p>}{busy && <p role="status">Procesando… No cierres esta pantalla hasta recibir confirmación.</p>}
    <section className="rounded-2xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-900 space-y-3"><div className="grid gap-3 sm:grid-cols-3"><label className="text-sm font-bold">Obra<select className={visitInput} value={workFilter} onChange={e => setWorkFilter(e.target.value)} disabled={busy}><option value="">Todas las obras accesibles</option>{works.map(w => <option key={w.id} value={w.id}>{w.codigo} · {w.nombre}</option>)}</select></label><label className="text-sm font-bold">Estado<select aria-label="Estado de las actas" className={visitInput} disabled={busy} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">No eliminadas</option>{Object.entries(VISIT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{k==='cancelled'?'Eliminadas / anuladas':v}</option>)}</select></label><form onSubmit={e => {
          e.preventDefault();
          setQuery(search);
        }}><label className="text-sm font-bold">Número, obra o asistente<input className={visitInput} value={search} onChange={e => setSearch(e.target.value)} maxLength={100} /></label><button className={button + ' mt-1'} disabled={busy}>Buscar actas</button></form></div>
      {loading && <p role="status">Cargando actas…</p>}<div className="grid gap-2 sm:grid-cols-2">{records.map(r => <article aria-label={'Acta '+r.number} key={r.id} className={'rounded-xl border p-4 '+(record?.id===r.id?'border-blue-500 bg-blue-50 dark:bg-blue-950':'border-slate-200 dark:border-slate-700')}><button aria-label={'Abrir acta '+r.number} disabled={busy} onClick={()=>void run(()=>open(r.id))} className="w-full min-h-[46px] text-left"><strong>{r.number} · v{r.version}</strong><p className="mt-1">{r.worksite}</p><p className="text-sm">{String(r.visit_date).slice(0,10)} · {VISIT_STATUS_LABELS[r.status as keyof typeof VISIT_STATUS_LABELS]}</p></button>{r.isOwner&&r.status!=='cancelled'&&<div className="mt-3 grid grid-cols-2 gap-2"><button aria-label={'Editar acta '+r.number} disabled={busy} className={button} onClick={()=>void run(()=>editActa(r.id))}>Editar</button><button aria-label={'Eliminar acta '+r.number} disabled={busy} className={button+' text-red-700 dark:text-red-300'} onClick={()=>void run(()=>deleteActa(r.id))}>Eliminar</button></div>}</article>)}</div>{loaded && !loading && !records.length && <p>No hay actas que coincidan con los filtros.</p>}{hasMore && <button disabled={busy} className={button} onClick={() => void run(async () => {
        const r = await visitRequest({
          action: 'list',
          worksiteId: workFilter,
          status: statusFilter,
          search: query,
          offset: records.length
        });
        setRecords(current => [...current, ...r.records.filter((n: any) => !current.some(x => x.id === n.id))]);
        setHasMore(r.hasMore);
      })}>Cargar siguientes actas</button>}</section>
    {content && <section ref={editorRef} tabIndex={-1} className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center"><h2 className="text-xl font-black">{record ? `${record.number} · v${record.version} · ${VISIT_STATUS_LABELS[record.status]}` : 'Nueva visita'}</h2>{dirty && <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">Cambios sin guardar</span>}</div>
      {canEdit ? <fieldset disabled={busy} className="rounded-2xl border bg-white p-4 sm:p-6 dark:border-slate-700 dark:bg-slate-900 space-y-5">
        <legend className="font-black">Datos de la visita</legend>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Obra<select disabled={!creating} className={visitInput} value={content.worksiteId} onChange={e => void run(()=>changeWorksite(e.target.value))}>{works.map(w => <option key={w.id} value={w.id}>{w.codigo} · {w.nombre}</option>)}</select></label>{([['date', 'Fecha', 'date'], ['start', 'Hora inicio', 'time'], ['end', 'Hora final', 'time'], ['location', 'Emplazamiento', 'text'], ['municipality', 'Municipio', 'text'], ['promoter', 'Promotor', 'text'], ['author', 'Redacta: nombre y apellidos', 'text'], ['authorRole', 'Cargo del autor', 'text'], ['authorEmail', 'Correo del autor', 'email'], ['authorPhone', 'Teléfono del autor', 'tel'], ['nextVisit', 'Próxima visita (opcional)', 'date']] as const).map(([key, label, type]) => <label className="text-sm font-bold" key={key}>{label}<input className={visitInput} type={type} value={content[key]} onChange={e => setContent({
              ...content,
              [key]: e.target.value
            })} /></label>)}</div>
        {([['purpose', 'Objeto de la visita', 3], ['discussion', 'Asuntos tratados y decisiones', 8], ['observations', 'Incidencias y observaciones', 4]] as const).map(([key, label, rows]) => <label key={key} className="block text-sm font-bold">{label}<textarea aria-label={label} className={visitInput} rows={rows} value={content[key]} onChange={e => setContent({
            ...content,
            [key]: e.target.value
          })} /></label>)}
        <VisitWorkOrdersEditor content={content} people={people} onChange={setContent} />
        <section className="space-y-3"><h3 className="font-black">Participantes y destinatarios</h3><p className="text-sm">Revisión, firma, asistencia y distribución son decisiones independientes. Para firmar, la persona debe revisar primero. Sin correo puede responder y firmar presencialmente, pero no recibir el PDF por email.</p>
          <label className="block text-sm font-bold">Añadir desde Dirección facultativa<select className={visitInput} value="" onChange={e => {
              const c = contacts.find(c => c.id === e.target.value);
              if (c) addContact(c);
            }}><option value="">Selecciona una persona asociada a esta obra…</option>{contacts.filter(c => c.active && c.assignments.some(a => a.worksiteId === content.worksiteId)).map(c => <option key={c.id} value={c.id}>{personName(c)} · {c.role}</option>)}</select></label>
          <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => setPeople([...people, emptyPerson()])}>Añadir asistente manual</button><button type="button" className={button} onClick={() => {
              const names = String(supervisor.nombreApellidos || '').trim().split(/\s+/);
              setPeople([...people, {
                ...emptyPerson(),
                firstName: names.shift() || '',
                lastName: names.join(' '),
                role: supervisor.cargo || 'Supervisor',
                email: supervisor.email || '',
                phone: supervisor.telefono || '',
                entity: 'Diputación Provincial de Cádiz',
                receiveFinal: !!supervisor.email
              }]);
            }}>Añadirme como supervisor</button><button type="button" className={button} disabled={!String(technician.nombreApellidos || '').trim()} onClick={() => {
              const name = String(technician.nombreApellidos || '').trim();
              const email = String(technician.email || '').trim().toLowerCase();
              if (people.some(p => email ? p.email.trim().toLowerCase() === email : (p.firstName + ' ' + p.lastName).trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
                setMessage('El técnico responsable ya está incluido entre los participantes.');
                return;
              }
              const names = name.split(/\s+/);
              setPeople(current => [...current, {
                ...emptyPerson(),
                firstName: names.shift() || '',
                lastName: names.join(' '),
                role: technician.cargo || 'Técnico responsable',
                email: technician.email || '',
                phone: technician.telefono || '',
                entity: 'Diputación Provincial de Cádiz',
                receiveFinal: !!technician.email
              }]);
            }}>Añadir técnico responsable</button>
          {people.map((p, index) => <div key={p.id} className="rounded-xl border border-slate-300 p-4 dark:border-slate-600 space-y-3"><h4 className="font-bold">Participante {index + 1}</h4><div className="grid gap-2 sm:grid-cols-2">{([['firstName', 'Nombre'], ['lastName', 'Apellidos'], ['role', 'Cargo / función'], ['entity', 'Entidad'], ['phone', 'Teléfono'], ['email', 'Correo']] as const).map(([key, label]) => <label key={key} className="text-sm font-bold">{label}<input type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} className={visitInput} value={p[key]} onChange={e => setPeople(people.map(item => item.id === p.id ? {
                  ...item,
                  [key]: e.target.value
                } : item))} /></label>)}</div><div className="flex flex-wrap gap-4">{([['attended', 'Asistió a la visita'], ['reviewRequired', 'Debe dar conformidad'], ['receiveFinal', 'Recibe PDF final']] as const).map(([key, label]) => <label key={key} className="flex gap-2 text-sm"><input type="checkbox" checked={p[key]} onChange={e => setPeople(people.map(item => item.id === p.id ? {
                  ...item,
                  [key]: e.target.checked
                } : item))} />{label}</label>)}</div><label className="block text-sm font-bold">Firma<select className={visitInput} value={p.signing} onChange={e => setPeople(people.map(item => item.id === p.id ? {
                ...item,
                signing: e.target.value as VisitPerson['signing'],
                reviewRequired: e.target.value !== 'none' || item.reviewRequired
              } : item))}><option value="required">Obligatoria</option><option value="optional">Opcional</option><option value="none">No firma</option></select></label><div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => setPeople(people.filter(item => item.id !== p.id))}>Quitar participante</button><button type="button" className={button} onClick={() => void run(() => saveUsualContact(p))}>Guardar como contacto habitual</button></div></div>)}
        </section>
        <section className="space-y-2"><h3 className="font-black">Anexos y fotografías</h3><p className="text-sm">PNG, JPEG o PDF. Máximo ocho anexos y 1,5 MB en conjunto. Los PDF se incorporan como anexos, sin editar sus páginas originales.</p><input type="file" accept="image/png,image/jpeg,application/pdf" aria-label="Añadir anexo" onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            void run(async () => {
              const base64 = await readVisitAttachment(file);
              if (!['image/png', 'image/jpeg', 'application/pdf'].includes(file.type)) throw new Error('Tipo de anexo no permitido.');
              setContent(c => c ? {
                ...c,
                attachments: [...c.attachments, {
                  id: crypto.randomUUID(),
                  name: file.name,
                  mime: file.type as any,
                  base64,
                  caption: ''
                }]
              } : c);
            });
          }} />{content.attachments.map(a => <div key={a.id} className="rounded-xl border p-3"><p className="font-bold break-all">{a.name}</p><input className={visitInput} aria-label={`Descripción de ${a.name}`} value={a.caption} onChange={e => setContent({
              ...content,
              attachments: content.attachments.map(item => item.id === a.id ? {
                ...item,
                caption: e.target.value
              } : item)
            })} /><button type="button" className={button + ' mt-2'} onClick={() => setContent({
              ...content,
              attachments: content.attachments.filter(item => item.id !== a.id)
            })}>Quitar anexo</button></div>)}</section>
        <button type="button" className={primary} onClick={save}>Guardar borrador</button>
      </fieldset> : record && <VisitMinutesReadView state={record.state} number={record.number} />}
      {record && <div className="rounded-2xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-900 space-y-4">
        {!record.canWrite && <p className="font-bold">Consulta de obra compartida. Solo el autor puede modificar o distribuir esta acta.</p>}
        <div className="flex flex-wrap gap-2"><button disabled={busy} className={button} onClick={() => void run(async () => downloadVisitFile(await visitRequest({
            action: 'pdf',
            id: record.id
          })))}>{record.status === 'signed' ? 'Descargar PDF firmado' : 'Consultar PDF de esta versión'}</button><button disabled={busy} className={button} onClick={() => void run(() => open(record.id))}>Actualizar</button><button disabled={busy} className={button} onClick={() => void run(async () => setHistory(await visitRequest({
            action: 'history',
            id: record.id
          })))}>Trazabilidad y versiones</button>
          {record.canWrite && <>{record.status === 'draft' && <button disabled={busy || dirty} className={primary} onClick={() => preview('review')}>Enviar para revisión</button>}{record.status === 'review' && <button disabled={busy || !canOpenSigning} className={primary} onClick={() => preview('signing')}>Abrir firmas y avisar</button>}{record.status === 'signing' && <button disabled={busy || !record.state.participants.filter(p => p.signing === 'required').every(p => record.state.signatures[p.id])} className={primary} onClick={() => void run(async () => {
              if (await appConfirm('Se cerrará la firma y se conservará el PDF final. Las firmas opcionales pendientes quedarán sin aportar. ¿Finalizar?')) {
                await mutate({
                  type: 'finalize'
                });
                await refreshList();
              }
            })}>Finalizar acta firmada</button>}{record.status === 'signed' && <><button disabled={busy} className={primary} onClick={() => preview('final')}>Enviar acta firmada por correo</button><button disabled={busy} className={button} onClick={() => void run(() => start(record))}>Nueva visita con órdenes pendientes</button></>}{record.status!=='cancelled'&&<><button disabled={busy} className={button} onClick={()=>void run(()=>editActa(record.id))}>Editar acta</button><button disabled={busy} className={button+' text-red-700 dark:text-red-300'} onClick={()=>void run(()=>deleteActa(record.id))}>Eliminar acta</button></>}</>}
        </div>
        {record.status === 'review' && !canOpenSigning && <p className="text-sm text-amber-700 dark:text-amber-300">Faltan revisiones del contenido. El silencio no equivale a aceptación.</p>}
        {record.canWrite && ['review', 'changes', 'rejected', 'signing'].includes(record.status) && <section className="space-y-3"><h3 className="font-black">Acceso de cada participante</h3>{record.state.participants.filter(p => p.reviewRequired).map(p => <div key={p.id} className="rounded-xl border p-3"><strong>{personName(p)}</strong><p className="text-sm">{record.state.responses[p.id]?.decision === 'agree' ? 'Conforme' : record.state.responses[p.id]?.decision === 'changes' ? 'Solicita cambios' : record.state.responses[p.id]?.decision === 'reject' ? 'Disconforme' : 'Pendiente'} · {record.state.signatures[p.id] ? 'Firma guardada' : 'Sin firma'}</p><div className="mt-2 flex flex-wrap gap-2">{p.email && <><button disabled={busy} className={button} onClick={() => void run(async () => {
                  const r = await visitRequest({
                    action: 'link',
                    id: record.id,
                    personId: p.id
                  });
                  setLink(r.url);
                  setMessage('Nuevo enlace de siete días. El anterior queda revocado. La persona debe verificar su correo.');
                })}>Generar / renovar enlace personal</button><button disabled={busy} className={button} onClick={() => void run(async () => {
                  await visitRequest({
                    action: 'revoke-link',
                    id: record.id,
                    personId: p.id
                  });
                  setLink('');
                  setMessage('Acceso revocado.');
                })}>Revocar enlace</button></>}{!record.state.responses[p.id] && record.status !== 'signing' && <button disabled={busy} className={button} onClick={() => {
                setOnsite({
                  personId: p.id,
                  kind: 'response'
                });
                setOnsiteAck(false);
                setResponseComment('');
              }}>Conformidad presencial</button>}{record.status === 'signing' && p.signing !== 'none' && !record.state.signatures[p.id] && <button disabled={busy} className={button} onClick={() => {
                setOnsite({
                  personId: p.id,
                  kind: 'signature'
                });
                setOnsiteAck(false);
              }}>Firma presencial</button>}</div></div>)}</section>}
        {link && <label className="block text-sm font-bold">Enlace personal: entrégalo solo a su destinatario<input className={visitInput} readOnly value={link} onFocus={e => e.currentTarget.select()} /></label>}
        {onsite && (() => {
          const p = record.state.participants.find(p => p.id === onsite.personId)!;
          return <section className="rounded-xl border-2 border-amber-300 p-4 space-y-3"><h3 className="font-black">Participación presencial de {personName(p)}</h3><label className="flex gap-2 text-sm"><input type="checkbox" checked={onsiteAck} onChange={e => setOnsiteAck(e.target.checked)} />Como supervisor, confirmo que esta persona está presente, he comprobado su identidad y le entrego el dispositivo para que actúe personalmente.</label>{onsite.kind === 'signature' ? onsiteAck && <VisitSignaturePad name={personName(p)} busy={busy} onCancel={() => setOnsite(null)} onConfirm={(image,intent,note) => void run(() => mutate({
              type: 'sign',
            intent, note,
              personId: p.id,
              image,
              mode: 'in-person'
            }).then(() => undefined))} /> : <><label className="block text-sm font-bold">Comentario / reservas<textarea className={visitInput} value={responseComment} onChange={e => setResponseComment(e.target.value)} /></label><div className="flex flex-wrap gap-2">{([['agree', 'Doy mi conformidad'], ['changes', 'Solicito cambios'], ['reject', 'No estoy conforme']] as const).map(([decision, label]) => <button key={decision} disabled={busy || !onsiteAck} className={button} onClick={() => void run(() => mutate({
                  type: 'respond',
                  personId: p.id,
                  decision,
                  comment: responseComment,
                  mode: 'in-person'
                }).then(() => undefined))}>{label}</button>)}</div></>}</section>;
        })()}
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
        <VisitWorkOrdersFollowup worksiteId={record.obra_id} />
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
    {mail && <ModalPortal layout="fullscreen" label="Revisar correos antes de enviar"><div className="visit-mail-overlay"><section role="dialog" aria-modal="true" aria-labelledby="visit-mail-title" className="visit-mail-dialog bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"><header className="visit-mail-header"><h2 id="visit-mail-title" className="text-xl font-black">Revisar correos antes de enviar</h2></header><div className="visit-mail-body">{mail.sender&&<p className="font-bold">Cuenta remitente autorizada: {mail.sender}</p>}{mailSending&&<p role="status">Enviando correos… No cierres esta ventana.</p>}{mailError&&<div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-900">{mailError}{gmailRequired&&<button className={primary+' mt-2'} disabled={busy} onClick={reconnectVisitGmail}>Volver a autorizar Gmail</button>}</div>}{mailNotice&&<p role="status">{mailNotice}</p>}<p>Se enviará un correo individual a cada dirección disponible, desde tu Gmail autorizado. No se revelan las direcciones de otros asistentes.</p>{mail.kind === 'final' && <p className="font-bold">Adjunto: {record?.number}_v{record?.version}_FIRMADA.pdf · Se utiliza el archivo final conservado.</p>}{!mail.messages.length && <p>No hay destinatarios de correo para esta fase. Puedes continuar presencialmente.</p>}{mail.messages.map(m => <div className="rounded-xl border p-3" key={m.personId}><p className="font-bold">Para: {m.email || 'Sin correo: participación presencial; no se enviará email'}</p><p>{({sent:'Aceptado por Gmail',pending:'Pendiente de envío',failed:'Error de envío',sending:'Enviando',uncertain:'Resultado incierto',cancelled:'Cancelado'} as any)[jobs.find(j=>j.version===record?.version&&j.kind===mail.kind&&j.person_id===m.personId)?.status||'pending']}</p>{jobs.filter(j=>j.version===record?.version&&j.kind===mail.kind&&j.person_id===m.personId&&['uncertain','sending'].includes(j.status)).map(j=><button key={j.id} className={button} disabled={busy} onClick={()=>reconcileMail(j.id)}>Comprobar en Enviados</button>)}<p className="font-bold mt-1">{m.subject}</p><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm">{m.body}</pre></div>)}</div><footer className="visit-mail-actions"><button disabled={busy} className={primary} onClick={sendFlow}>{mailSending?'Enviando correos…':mailError?'Reintentar correos pendientes':'Confirmar y enviar correos'}</button><button disabled={busy} className={button} onClick={() => setMail(null)}>Cancelar</button></footer></section></div></ModalPortal>}
  </main>;
}
