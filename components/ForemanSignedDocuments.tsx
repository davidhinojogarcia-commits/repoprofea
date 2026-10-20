import { supabase } from '../src/lib/supabase';
import { documentChangeLabel, requestDocumentChange } from './ForemanDocumentChanges';
import React, { useMemo, useState } from 'react';
import { foremanDocumentPeriod, documentFortnightLabel, type DocumentFortnight } from '../src/lib/foremanDocumentPeriod';
import type { ForemanPortalPayload, ForemanMandatoryDocument } from '../src/services/foremanPortalService';
import { ADDITIONAL_WORKSITE_DOCUMENTS, type AdditionalWorksiteDocumentType } from '../src/lib/worksiteAdditionalDocumentsCatalog';

export default function ForemanSignedDocuments({ token, data, busy, label, preview, share, refresh }: {
  token: string; data: ForemanPortalPayload; busy: boolean; label: (type: string) => string;
  refresh: () => void; preview: (doc: ForemanMandatoryDocument) => void; share: (doc: ForemanMandatoryDocument) => void;
}) {
  const [history,setHistory]=useState<{id:string;documentId:string;action:string;reason:string;status:string;createdAt:string;resolvedAt?:string}[]>([]);
  const [changeMessage,setChangeMessage]=useState('');
  const [requestBusy,setRequestBusy]=useState(false);
  const [month, setMonth] = useState('');
  const [fortnight, setFortnight] = useState<DocumentFortnight | ''>('');
  const [search, setSearch] = useState('');
  const groups = useMemo(() => {
    const cards = [
      ...data.mandatoryDocuments.filter(d => d.status === 'completed' || d.status === 'reviewed').map(d => ({
        id: 'm-' + d.id, title: label(d.documentType), name: String(d.details?.sourceFilename || 'Documento firmado'),
        period: foremanDocumentPeriod(d.workDate, d.periodKey), signedAt: d.completedAt, doc: d,
        workers: d.workers.map(w => w.apellidosNombre).join(', '), status: d.status === 'reviewed' ? 'Revisado por el supervisor' : 'Enviado al supervisor',
      })),
      ...data.attendance.filter(d => d.status === 'completed' || d.status === 'reviewed').map(d => ({
        id: 'a-' + d.id, title: 'Control horario', name: d.workDate, period: foremanDocumentPeriod(d.workDate),
        signedAt: d.completedAt, doc: null, workers: d.rows.map(w => w.name).join(', '), status: d.status === 'reviewed' ? 'Revisado por el supervisor' : 'Enviado al supervisor',
      })),
      ...data.documents.filter(d => !d.correctionPending && d.status !== 'draft').map(d => ({
        id: 'd-' + d.id, title: ADDITIONAL_WORKSITE_DOCUMENTS[d.documentType as AdditionalWorksiteDocumentType]?.short || d.documentType,
        name: d.workerSnapshot?.apellidosNombre || 'Trabajador', period: foremanDocumentPeriod(d.workDate), signedAt: d.completedAt,
        doc: null, workers: d.workerSnapshot?.apellidosNombre || '', status: 'Enviado al supervisor',
      })),
    ].filter(card => (!month || card.period.month === month) && (!fortnight || card.period.fortnight === fortnight) &&
      (!search || `${card.title} ${card.name} ${card.workers}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))));
    const result = new Map<string, typeof cards>();
    for (const card of cards) {
      const key = card.period.month + ':' + card.period.fortnight;
      result.set(key, [...(result.get(key) || []), card]);
    }
    return [...result.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [data, month, fortnight, search, label]);
  return <section className="space-y-4" aria-label="Documentos firmados">
    <h2 className="text-lg font-black">Documentos firmados · {data.obra}</h2>
    <button type="button" disabled={busy} onClick={refresh} className="min-h-[48px] rounded-xl border bg-white p-3 font-bold">Actualizar</button>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="font-bold">Mes y año<input aria-label="Mes y año de documentos firmados" type="month" value={month} onChange={e => setMonth(e.target.value)} className="mt-1 min-h-[48px] w-full rounded-xl border p-2" /></label>
      <label className="font-bold">Quincena<select value={fortnight} onChange={e => setFortnight(e.target.value as DocumentFortnight | '')} className="mt-1 min-h-[48px] w-full rounded-xl border p-2"><option value="">Todas</option><option value="1Q">Primera: 1–15</option><option value="2Q">Segunda: 16–fin de mes</option><option value="unknown">Sin quincena asignada</option></select></label>
      <label className="font-bold">Buscar<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Trabajador o documento" className="mt-1 min-h-[48px] w-full rounded-xl border p-2" /></label>
    </div>
    {groups.map(([key, cards]) => <section key={key} className="space-y-3">
      <h3 className="rounded-xl bg-slate-200 p-3 font-black">{cards[0].period.month} · {documentFortnightLabel(cards[0].period.fortnight)}</h3>
      {cards.map(card => <article key={card.id} className="rounded-2xl border bg-white p-4 shadow-sm">
        <h4 className="font-black">{card.title}</h4><p className="break-words font-bold">{card.name}</p>
        <p className="mt-1 text-sm">{card.status}{card.signedAt ? ' · Finalizado el ' + new Date(card.signedAt).toLocaleDateString('es-ES') : ''}</p>
        {card.doc && <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => preview(card.doc!)} className="min-h-[52px] rounded-xl border p-3 font-bold">Ver PDF</button>
          <button type="button" disabled={busy} onClick={() => share(card.doc!)} className="min-h-[52px] rounded-xl bg-[#00548E] p-3 font-bold text-white">Compartir</button>
          {['rectify','replace','annul','withdraw'].map(action=><button key={action} type="button" disabled={requestBusy||!navigator.onLine} onClick={()=>{setRequestBusy(true);setChangeMessage('');void requestDocumentChange(token,card.doc!.id,action).then(sent=>{if(sent)setChangeMessage('Solicitud enviada al supervisor. El documento firmado se conserva hasta su revisión.');}).catch(e=>setChangeMessage(e.message)).finally(()=>setRequestBusy(false));}} className="min-h-[48px] rounded-xl border p-3 text-sm font-bold disabled:opacity-50">Solicitar {documentChangeLabel(action).toLocaleLowerCase('es')}</button>)}
        </div>}
      </article>)}
    </section>)}
    <details className="rounded-xl border bg-white p-3"><summary className="min-h-[44px] cursor-pointer font-bold">Historial de solicitudes</summary>
      <button type="button" disabled={requestBusy||!navigator.onLine} className="min-h-[48px] rounded-xl border p-3 font-bold" onClick={()=>{setRequestBusy(true);void supabase.rpc('get_foreman_document_changes',{p_token:token},{fresh:true}).then(result=>setHistory(Array.isArray(result)?result:[])).catch(e=>setChangeMessage(e.message)).finally(()=>setRequestBusy(false));}}>Consultar historial</button>
      {history.map(item=><article key={item.id} className="mt-2 rounded-xl border p-3 text-sm"><p className="font-bold">{documentChangeLabel(item.action)} · {item.status==='approved'?'Aprobada':item.status==='rejected'?'Rechazada':'Pendiente de revisión'}</p><p>{item.reason}</p><p>{new Date(item.createdAt).toLocaleString('es-ES')}{item.resolvedAt?' · Resuelta: '+new Date(item.resolvedAt).toLocaleString('es-ES'):''}</p></article>)}
    </details>
    {changeMessage&&<p role="status" className="rounded-xl border p-3 text-sm font-bold">{changeMessage}</p>}
    {!groups.length && <p className="rounded-2xl border bg-white p-6">No hay documentos firmados en el periodo seleccionado.</p>}
  </section>;
}
