import { ORDER_STATUS_LABELS, ORDER_NATURE_LABELS, ORDERS_NOTICE } from '../src/lib/visitWorkOrders';
import React from 'react';
import { personName, madridTimestamp, VISIT_NOTICE, type VisitState } from '../src/lib/visitMinutes';
export function VisitMinutesReadView({
  state,
  number
}: {
  state: VisitState;
  number: string;
}) {
  const c = state.content;
  return <article className="rounded-2xl border border-slate-300 bg-white p-4 sm:p-6 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 space-y-5 break-words">
    <header><p className="text-xs font-black uppercase text-blue-700 dark:text-blue-300">Acta de visita de obra · {number} · v{state.version}</p><h2 className="mt-1 text-xl font-black">{c.worksite}</h2><p>{c.code} · {c.municipality}</p><p>{c.location}</p><p className="mt-2">{c.date} · {c.start}–{c.end || 'Pendiente'} · Europe/Madrid</p><p className="text-sm">Promotor: {c.promoter || 'No indicado'} · Redacta: {c.author} · {c.authorRole}</p></header>
    <section><h3 className="font-black">Participantes</h3><ul className="mt-2 space-y-1">{state.participants.map(p => <li key={p.id}>{personName(p)} · {p.role} · {p.entity} · {p.attended ? 'Asistente presencial' : p.reviewRequired?'Participante remoto':'Destinatario del documento'}</li>)}</ul></section>
    {([['Objeto histórico de la visita', c.purpose], ['Contenido histórico de la visita', c.discussion], ['Anotaciones históricas', c.observations]] as const).filter(([,text])=>!!text).map(([title, text]) => <section key={title}><h3 className="font-black">{title}</h3><p className="mt-1 whitespace-pre-wrap">{text}</p></section>)}
    {c.points&&<section><h3 className="font-black">Contenido de la visita</h3>{c.points.map((p,i)=><div key={p.id} className="rounded-xl border p-3 my-2"><h4 className="font-bold">Punto {i+1}{p.title?'. '+p.title:''}</h4><p className="whitespace-pre-wrap">{p.description}</p>{p.attachmentIds.length>0&&<p className="text-sm">Anexos: {p.attachmentIds.map(id=>c.attachments.find(a=>a.id===id)?.name||id).join(', ')}</p>}</div>)}</section>}
    <section><h3 className="font-black">ÓRDENES E INSTRUCCIONES DE OBRA</h3>{(c.orders||[]).map(o=><div key={o.id} className="rounded-xl border p-3 my-2 space-y-1"><h4 className="font-bold">Orden {o.number} · {ORDER_NATURE_LABELS[o.nature]}</h4><p>Emite: {o.issuerName} · {o.issuerRole} · {o.issuerEntity}</p><p>Responsable: {o.recipient||'Sin asignar'} · Zona: {o.location||'No indicada'}</p><p>Emisión: {o.issuedDate} · Plazo: {o.deadline||'Sin plazo'} · Prioridad: {o.priority}</p><p className="whitespace-pre-wrap">{o.description}</p><p className="whitespace-pre-wrap">{o.observations}</p><p>Referencia oficial: {o.officialReference||'No indicada'} · Autorización competente: {o.authorizationReference||'No indicada'}</p>{o.correctionReason&&<p>Corrección: {o.correctionReason}</p>}<p>Estado de emisión: {state.status==='draft'?'Borrador, pendiente de comunicar':'Registrada en esta versión'}. Seguimiento independiente.</p></div>)}{!c.orders?.length&&<p>Sin órdenes nuevas.</p>}{c.orderReferences?.map(r=><p key={r.id} className="my-2">Referencia: {r.originNumber} · Orden {r.number} · {r.description} · {ORDER_STATUS_LABELS[r.status]} · Revisión {r.revision}</p>)}</section>
    {c.agreements.length>0&&<section><h3 className="font-black">Contenido histórico del acta</h3><ol className="mt-2 space-y-3">{c.agreements.map((a, i) => <li key={a.id} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><p className="whitespace-pre-wrap font-bold">{i + 1}. {a.text}</p><p className="mt-1 text-sm">Responsable: {a.responsible || 'Sin asignar'} · Plazo: {a.deadline || 'Sin plazo'}</p>{a.source && <p className="text-xs">Procedencia: {a.source}</p>}</li>)}</ol></section>}
    {c.nextVisit && <p>Próxima visita: {c.nextVisit}</p>}
    <section><h3 className="font-black">Anexos incluidos en el PDF</h3>{c.attachments.map(a => <p key={a.id} className="mt-1">{a.name} · {a.caption}</p>)}{!c.attachments.length && <p>Sin anexos.</p>}</section>
    {state.reviewClosure&&<section><h3 className="font-black">Tratamiento de observaciones y discrepancias</h3><p className="whitespace-pre-wrap">{state.reviewClosure.note}</p></section>}
    <section><h3 className="font-black">Revisión del contenido y firmas</h3>{state.participants.filter(p => p.reviewRequired || p.signing !== 'none').map(p => {
        const response = state.responses[p.id],
          signature = state.signatures[p.id];
        return <div className="mt-2 rounded-xl border p-3" key={p.id}><strong>{personName(p)}</strong><p className="text-sm">{response ? `${response.decision === 'agree' ? 'Conforme' : response.decision === 'changes' ? 'Solicita cambios' : 'Disconforme'} · ${madridTimestamp(response.at)}` : 'Pendiente de revisión'}</p>{response?.comment && <p className="whitespace-pre-wrap">{response.comment}</p>}{signature ? <><img src={signature.image} alt={`Firma de ${personName(p)}`} className="visit-signature-surface mt-2 h-16 max-w-full rounded-lg bg-white p-1 object-contain object-left" /><p className="text-xs">{signature.intent==='reservations'?'Con reservas':signature.intent==='knowledge'?'Simple conocimiento':'Conformidad con el contenido'} · {signature.note} · {madridTimestamp(signature.at)} · {signature.mode === 'email-code' ? 'Correo verificado' : 'Presencial con supervisor'}</p></> : p.signing !== 'none' && <p className="text-sm">Firma {p.signing === 'required' ? 'obligatoria' : 'opcional'} pendiente</p>}</div>;
      })}</section>
    {state.cancelledReason && <p className="rounded-xl bg-red-50 p-3 text-red-800">Anulada: {state.cancelledReason}</p>}
    <p className="text-xs text-slate-600 dark:text-slate-300">{VISIT_NOTICE} {ORDERS_NOTICE}</p>
  </article>;
}
