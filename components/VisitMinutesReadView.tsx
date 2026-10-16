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
    <section><h3 className="font-black">Participantes</h3><ul className="mt-2 space-y-1">{state.participants.map(p => <li key={p.id}>{personName(p)} · {p.role} · {p.entity} · {p.attended ? 'Asistente' : 'Destinatario / no asistente'}</li>)}</ul></section>
    {([['Objeto de la visita', c.purpose], ['Asuntos tratados', c.discussion], ['Incidencias y observaciones', c.observations]] as const).map(([title, text]) => <section key={title}><h3 className="font-black">{title}</h3><p className="mt-1 whitespace-pre-wrap">{text || 'Sin información registrada.'}</p></section>)}
    <section><h3 className="font-black">Acuerdos y actuaciones</h3><ol className="mt-2 space-y-3">{c.agreements.map((a, i) => <li key={a.id} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><p className="whitespace-pre-wrap font-bold">{i + 1}. {a.text}</p><p className="mt-1 text-sm">Responsable: {a.responsible || 'Sin asignar'} · Plazo: {a.deadline || 'Sin plazo'}</p>{a.source && <p className="text-xs">Procedencia: {a.source}</p>}</li>)}</ol>{!c.agreements.length && <p>Sin acuerdos estructurados.</p>}</section>
    {c.nextVisit && <p>Próxima visita: {c.nextVisit}</p>}
    <section><h3 className="font-black">Anexos incluidos en el PDF</h3>{c.attachments.map(a => <p key={a.id} className="mt-1">{a.name} · {a.caption}</p>)}{!c.attachments.length && <p>Sin anexos.</p>}</section>
    <section><h3 className="font-black">Conformidades y firmas</h3>{state.participants.filter(p => p.reviewRequired || p.signing !== 'none').map(p => {
        const response = state.responses[p.id],
          signature = state.signatures[p.id];
        return <div className="mt-2 rounded-xl border p-3" key={p.id}><strong>{personName(p)}</strong><p className="text-sm">{response ? `${response.decision === 'agree' ? 'Conforme' : response.decision === 'changes' ? 'Solicita cambios' : 'Disconforme'} · ${madridTimestamp(response.at)}` : 'Pendiente de conformidad'}</p>{response?.comment && <p className="whitespace-pre-wrap">{response.comment}</p>}{signature ? <><img src={signature.image} alt={`Firma de ${personName(p)}`} className="visit-signature-surface mt-2 h-16 max-w-full rounded-lg bg-white p-1 object-contain object-left" /><p className="text-xs">{madridTimestamp(signature.at)} · {signature.mode === 'email-code' ? 'Correo verificado' : 'Presencial con supervisor'}</p></> : p.signing !== 'none' && <p className="text-sm">Firma {p.signing === 'required' ? 'obligatoria' : 'opcional'} pendiente</p>}</div>;
      })}</section>
    {state.cancelledReason && <p className="rounded-xl bg-red-50 p-3 text-red-800">Anulada: {state.cancelledReason}</p>}
    <p className="text-xs text-slate-600 dark:text-slate-300">{VISIT_NOTICE}</p>
  </article>;
}
