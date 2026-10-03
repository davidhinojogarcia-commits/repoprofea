import React from 'react';
import ModalPortal from './ModalPortal';

type TraceEvent={id?:number;event_type?:string;actor_type?:string;actor_name?:string;metadata?:Record<string,any>;created_at?:string};
type TraceVersion={id?:string;versionNo?:number;signedSha256?:string;signedCount?:number;requiredCount?:number;submissionMode?:string;submittedAt?:string};

const LABELS:Record<string,string>={
  IMPORTED:'PDF original importado',LEGACY_BACKFILLED:'Histórico migrado a trazabilidad V2',DOCUMENT_ANALYZED:'Documento analizado',WORKSITE_DETECTED:'Obra detectada',WORKSITE_REVIEW_REQUIRED:'Obra pendiente de revisión',WORKSITE_CONFIRMED:'Obra confirmada',PERIOD_DETECTED:'Periodo detectado',WORKER_DETECTED:'Persona detectada',WORKER_CONFIRMED:'Persona confirmada',WORKER_REJECTED:'Detección descartada',SIGNATURE_POSITION_RESOLVED:'Posición de firma confirmada',ASSIGNED_TO_FOREMAN:'Asignado al encargado',WORKER_SIGNED:'Firma registrada',SIGNED_PDF_GENERATED:'PDF firmado generado',PDF_VALIDATED:'PDF firmado validado',SUBMITTED_BY_FOREMAN:'Enviado por el encargado',RECEIVED_BY_SUPERVISOR:'Recibido por el supervisor',RETURNED_FOR_CORRECTION:'Devuelto para corrección',REOPENED_FOR_REPAIR:'Reabierto para reparar',REVIEWED:'Revisado',
};
const STATES:Record<string,string>={IMPORTED:'Importado',ANALYZED:'Analizado',NEEDS_WORKSITE_REVIEW:'Pendiente de asignar obra',NEEDS_WORKER_REVIEW:'Pendiente de revisar personas',NEEDS_SIGNATURE_POSITION_REVIEW:'Pendiente de ajustar firmas',READY:'Preparado',ASSIGNED:'Asignado al encargado',IN_SIGNATURE:'En firma',SUBMITTED:'Enviado al supervisor',RECEIVED:'Recibido por el supervisor',REVIEWED:'Revisado',RETURNED_FOR_CORRECTION:'Devuelto para corrección',PDF_VALIDATION_ERROR:'Requiere reparación del PDF',ARCHIVED:'Archivado'};
const date=(value?:string)=>value?new Date(value).toLocaleString('es-ES'):'—';

export default function MandatoryTraceabilityModal(props:{title:string;data:any;onClose:()=>void}){
  const events=(Array.isArray(props.data?.events)?props.data.events:[]) as TraceEvent[];
  const versions=(Array.isArray(props.data?.versions)?props.data.versions:[]) as TraceVersion[];
  return <ModalPortal label="Trazabilidad del documento">
    <div className="fixed inset-0 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm">
      <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 bg-[#00548E] px-5 py-4 text-white"><div><div className="text-xs font-black uppercase tracking-wide text-blue-100">Trazabilidad completa</div><h2 className="mt-1 text-lg font-black">{props.title}</h2></div><button type="button" onClick={props.onClose} className="min-h-10 rounded-xl border border-white/40 px-3 text-sm font-black">Cerrar</button></div>
        <div className="overflow-y-auto p-5">
          <div className="rounded-2xl border bg-slate-50 p-4 dark:bg-slate-800"><div className="text-xs font-black uppercase text-slate-500">Estado actual</div><div className="mt-1 text-base font-black">{STATES[String(props.data?.document?.lifecycle_status||'')]||props.data?.document?.status||'—'}</div></div>
          <h3 className="mt-5 text-sm font-black uppercase tracking-wide text-slate-500">Eventos</h3>
          <div className="mt-2 space-y-2">{events.length?events.map((event,index)=><div key={event.id??index} className="rounded-2xl border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-black">{LABELS[event.event_type||'']||event.event_type||'Evento'}</div><div className="text-xs text-slate-500">{date(event.created_at)}</div></div><div className="mt-1 text-xs text-slate-500">{event.actor_type||'sistema'}{event.actor_name?` · ${event.actor_name}`:''}</div>{event.metadata&&Object.keys(event.metadata).length?<pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-slate-600 dark:text-slate-300">{JSON.stringify(event.metadata,null,2)}</pre>:null}</div>):<div className="rounded-xl border p-4 text-sm text-slate-500">Todavía no hay eventos registrados.</div>}</div>
          <h3 className="mt-5 text-sm font-black uppercase tracking-wide text-slate-500">Versiones enviadas</h3>
          <div className="mt-2 space-y-2">{versions.length?versions.map((version,index)=><div key={version.id??index} className="rounded-2xl border p-3"><div className="font-black">Versión {version.versionNo??index+1} · {version.submissionMode==='partial'?'Parcial':'Completa'}</div><div className="mt-1 text-xs text-slate-500">{version.signedCount??0}/{version.requiredCount??0} firmas · {date(version.submittedAt)}</div><div className="mt-1 break-all font-mono text-[10px] text-slate-500">SHA-256: {version.signedSha256||'—'}</div></div>):<div className="rounded-xl border p-4 text-sm text-slate-500">Aún no hay versiones enviadas.</div>}</div>
        </div>
      </div>
    </div>
  </ModalPortal>;
}
