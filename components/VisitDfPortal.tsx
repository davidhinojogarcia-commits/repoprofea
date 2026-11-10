import React, { useEffect, useRef, useState } from 'react';
import { visitRequest } from '../src/services/visitMinutesService';
import { VisitVoiceDictation } from './VisitVoiceDictation';

type GuestContribution = {id:string;title:string;description:string;status:'pending'|'accepted'|'rejected';created_at:string};
const inputClass='mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00548E]';
const primary='min-h-12 rounded-xl bg-[#00548E] px-4 py-3 font-bold text-white disabled:opacity-50';
const secondary='min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 font-bold text-[#00548E]';
export function VisitDfPortal({token}:{token:string}){
  const [session,setSession]=useState('');
  const [loading,setLoading]=useState(true);
  const [retry,setRetry]=useState(0);
  const [record,setRecord]=useState<{number:string;worksite:string;date:string}|null>(null);
  const [items,setItems]=useState<GuestContribution[]>([]);
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const operation = useRef(crypto.randomUUID());
  const perform=async(work:()=>Promise<void>)=>{
    if(busy)return;setBusy(true);setError('');setMessage('');
    try{await work();}catch(e:any){setError(e.message||'No se pudo completar la operación.');}
    finally{setBusy(false);}
  };
  const list=async(key:string)=>{
    const result=await visitRequest({action:'df-portal-get',token,session:key},{public:true});
    setRecord(result.record);setItems(result.contributions);
  };
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setError('');setSession('');setItems([]);
    void (async()=>{
      try {
        const opened=await visitRequest({action:'df-open',token},{public:true});
        const result=await visitRequest({action:'df-portal-get',token,session:opened.session},{public:true});
        if(!cancelled){setSession(opened.session);setRecord(result.record);setItems(result.contributions);}
      } catch(e:any) {
        if(!cancelled)setError(e?.message||'No se pudo abrir la invitación. Comprueba el enlace o solicita otro.');
      } finally {if(!cancelled)setLoading(false);}
    })();
    return()=>{cancelled=true;};
  },[token,retry]);
  const submit=()=>void perform(async()=>{
    if(!session||!description.trim())throw new Error('Completa el texto del punto.');
    await visitRequest({action:'df-submit',token,session,title,description,operation:operation.current},{public:true});
    operation.current=crypto.randomUUID();
    setTitle('');setDescription('');await list(session);
    setMessage('Punto enviado al supervisor para su revisión. Puedes añadir otro.');
  });
  return <main className="min-h-screen bg-slate-100 px-3 py-5 text-slate-900">
    <div className="mx-auto max-w-xl space-y-4 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-6">
      <header className="border-b border-slate-200 pb-3">
        <p className="text-xs font-extrabold uppercase tracking-wide text-[#00548E]">Diputación de Cádiz · PROFEA</p>
        <h1 className="mt-2 text-xl font-black">Aportaciones de Dirección Facultativa</h1>
        <p className="mt-1 text-sm text-slate-600">Solo puedes añadir tus propios puntos; no podrás editar los del supervisor.</p>
      </header>
      {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
      {!session ? <section className="space-y-3" aria-live="polite">
        <p className="text-sm text-slate-700">{loading?'Comprobando la invitación personal…':'No se ha podido abrir la invitación. El enlace puede haber caducado o estar revocado.'}</p>
        {!loading&&<button type="button" className={secondary+' w-full'} onClick={()=>setRetry(current=>current+1)}>Reintentar acceso</button>}
        <p className="text-xs text-slate-500">Este enlace permite proponer puntos en esta acta, pero no acredita identidad profesional ni autoriza firmas u órdenes de obra.</p>
      </section> : <section className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="font-black">{record?.number||'Acta de visita'}</p>
          <p className="text-sm">{record?.worksite}</p><p className="text-xs text-slate-600">{record?.date}</p>
        </div>
        <h2 className="text-lg font-bold">Redactar nuevo punto</h2>
        <label className="block text-sm font-bold">Título (opcional)
          <input maxLength={200} className={inputClass} value={title} onChange={e=>setTitle(e.target.value)} />
        </label>
        <label className="block text-sm font-bold">Descripción del punto
          <textarea aria-label="Descripción de la aportación" rows={6} maxLength={20000} className={inputClass}
            value={description} onChange={e=>setDescription(e.target.value)} placeholder="Describe las observaciones o instrucciones de la visita…"/>
        </label>
        <VisitVoiceDictation value={description} onChange={setDescription} disabled={busy} label="Dictar punto con micrófono"/>
        <button className={primary+' w-full'} disabled={busy||!description.trim()} onClick={submit}>
          Enviar punto al supervisor
        </button>
        <p className="text-xs text-slate-600">Se envía como propuesta, no como instrucción aprobada. Las órdenes formales se tramitan en el acta por el emisor competente.</p>
        <h3 className="font-bold">Tus aportaciones ({items.length})</h3>
        {items.map((point,i)=><article key={point.id} className="space-y-1 rounded-xl border border-slate-200 p-3">
          <p className="font-bold">{i+1}. {point.title||'Punto de visita'}</p>
          <p className="whitespace-pre-wrap break-words text-sm">{point.description}</p>
          <p className="text-xs text-slate-600">{point.status==='pending'?'Pendiente de revisión':point.status==='accepted'?'Incorporado al acta':'No incorporado'}</p>
        </article>)}
      </section>}
    </div>
  </main>;
}
