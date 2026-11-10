import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { VisitRecord } from '../src/lib/visitMinutes';
import { visitRequest } from '../src/services/visitMinutesService';

type Contribution={id:string;person_id:string;title:string;description:string;status:'pending'|'accepted'|'rejected';created_at:string};
type Invitation={person_id:string;expires_at:string;revoked:boolean};
const btn='min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-[#00548E] disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-blue-200';
export function VisitDfReviewPanel({record,dirty,onUpdated}:{record:VisitRecord;dirty:boolean;onUpdated:(record:VisitRecord)=>void}){
  const [items,setItems]=useState<Contribution[]>([]);
  const [invitations,setInvitations]=useState<Invitation[]>([]);
  const [selected,setSelected]=useState('');
  const [link,setLink]=useState('');
  const [qr,setQr]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const people=record.state.participants.filter(p=>/arquitect|direcci[oó]n (?:facultativa|de (?:obra|ejecuci[oó]n))|director(?:a)? de (?:obra|ejecuci[oó]n)|t[eé]cnic[oa] facultativ/i.test(p.role)&&p.email?.trim());
  const recipient=people.some(p=>p.id===selected)?selected:people[0]?.id||'';
  const activeInvitation=invitations.find(p=>p.person_id===recipient&&!p.revoked&&Date.parse(p.expires_at)>Date.now());
  const load=async()=>{
    const result=await visitRequest({action:'df-list',id:record.id});
    setItems(result.contributions);
    setInvitations(result.invitations||[]);
  };
  useEffect(()=>{let cancelled=false;setItems([]);setInvitations([]);setLink('');setQr('');setError('');setMessage('');
    void visitRequest({action:'df-list',id:record.id}).then((result:any)=>{if(!cancelled){setItems(result.contributions);setInvitations(result.invitations||[]);}}).catch((e:any)=>{if(!cancelled)setError(e.message);});
    return()=>{cancelled=true;};
  },[record.id,record.version]);
  useEffect(()=>{let cancelled=false;if(!link){setQr('');return;}
    void QRCode.toDataURL(link,{width:260,margin:2,errorCorrectionLevel:'M'}).then(image=>{if(!cancelled)setQr(image);}).catch(()=>{if(!cancelled)setQr('');});
    return()=>{cancelled=true;};
  },[link]);
  const run=async(task:()=>Promise<void>)=>{
    if(busy)return;setBusy(true);setError('');setMessage('');
    try{await task();}catch(e:any){setError(e.message||'No se pudo completar la operación.');}finally{setBusy(false);}
  };
  const invite=()=>void run(async()=>{
    if(dirty)throw new Error('Guarda antes los cambios del borrador.');
    if(!recipient)throw new Error('Añade una Dirección Facultativa con correo y guarda el borrador.');
    const result=await visitRequest({action:'df-invite',id:record.id,personId:recipient});
    setLink(result.url);await load();setMessage('Invitación de siete días creada. La DF verificará su correo para redactar.');
  });
  const review=(item:Contribution,accept:boolean)=>void run(async()=>{
    if(dirty)throw new Error('Guarda o descarta los cambios locales antes de incorporar aportaciones externas.');
    const result=await visitRequest({action:'df-review',id:record.id,revision:record.revision,contributionId:item.id,accept});
    onUpdated(result.record);
    await load();
    setMessage(accept?'Punto incorporado al acta. Comprueba su contenido antes de firmas.':'Aportación no incorporada; se conserva su registro.');
  });
  const share=()=>void run(async()=>{
    if(!link)return;
    if(navigator.share){try{await navigator.share({url:link,title:'Redacción de puntos de visita PROFEA'});return;}catch(e:any){if(e?.name==='AbortError')return;}}
    if(!navigator.clipboard?.writeText)throw new Error('Copia el enlace de la caja de texto.');
    await navigator.clipboard.writeText(link);
    setMessage('Enlace copiado. Envíalo únicamente a la Dirección Facultativa indicada.');
  });
  return <details aria-label="Colaboración con Dirección Facultativa" className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
    <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-black text-[#00548E] dark:text-blue-200">
      <span>Colaboración · Dirección Facultativa</span>
      <span className="shrink-0 rounded-lg bg-blue-50 px-2 py-1 text-xs dark:bg-slate-900">{items.filter(p=>p.status==='pending').length} pendientes</span>
    </summary>
    <div className="space-y-3 border-t border-slate-200 p-3 dark:border-slate-700">
    <p className="text-sm text-slate-700 dark:text-slate-200">La DF solo añade puntos. Tú decides cuáles se incorporan. Las órdenes de obra siguen el circuito de autorización habitual.</p>
    {dirty&&<p role="status" className="text-sm font-bold text-amber-800 dark:text-amber-300">Guarda los cambios locales para habilitar la colaboración y evitar sobrescribir datos.</p>}
    {!people.length?<p className="text-sm">Añade una arquitecta, arquitecto o Dirección Facultativa con correo en Participantes y guarda el borrador.</p>:<>
      <label className="block text-xs font-bold">Dirección Facultativa autorizada
        <select className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white" value={recipient} onChange={e=>{setSelected(e.target.value);setLink('');}}>
          {people.map(p=><option key={p.id} value={p.id}>{p.firstName} {p.lastName} · {p.email}</option>)}
        </select>
      </label>
      <button type="button" className={btn+' w-full'} disabled={busy||dirty} onClick={invite}>{activeInvitation?'Renovar enlace de Dirección Facultativa':'Invitar a Dirección Facultativa a redactar'}</button>
      {link&&<div className="space-y-2 rounded-xl border border-blue-200 bg-white p-3 dark:bg-slate-900">
        <p className="text-sm font-bold">Acceso temporal y personal · verifica correo</p>
        {qr&&<img src={qr} alt="Código QR para la invitación personal de Dirección Facultativa" width={220} height={220} className="mx-auto max-w-full rounded-lg"/>}
        <label className="block text-xs font-bold">Enlace para compartir
          <input type="text" className="mt-1 w-full rounded-xl border p-2 text-xs dark:bg-slate-900" readOnly value={link} onFocus={e=>e.target.select()}/>
        </label>
        <button type="button" className={btn+' w-full'} onClick={share}>Compartir enlace</button>
      </div>}
      {activeInvitation && <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Invitación activa hasta {new Date(activeInvitation.expires_at).toLocaleDateString('es-ES')}. Puedes revocarla aunque ya no tengas el enlace en pantalla.</p>
        <button type="button" className={btn+' w-full'} disabled={busy} onClick={()=>void run(async()=>{
          await visitRequest({action:'df-revoke',id:record.id,personId:recipient});setLink('');await load();setMessage('Invitación revocada.');})}>Revocar invitación</button>
      </div>}
    </>}
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold">Puntos recibidos ({items.filter(p=>p.status==='pending').length} pendientes)</h4>
      <button type="button" className={btn} disabled={busy} onClick={()=>void run(load)}>Actualizar aportaciones</button></div>
    {items.map(item=><article key={item.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <strong>{item.title||'Punto sin título'}</strong>
      <p className="whitespace-pre-wrap break-words text-sm">{item.description}</p>
      <p className="text-xs text-slate-500">{record.state.participants.find(p=>p.id===item.person_id)?.firstName||'DF'} · {item.status==='pending'?'Pendiente de revisión':item.status==='accepted'?'Incorporado':'No incorporado'}</p>
      {item.status==='pending'&&<div className="grid grid-cols-2 gap-2">
        <button type="button" className={btn} disabled={busy||dirty} onClick={()=>review(item,true)}>Incorporar</button>
        <button type="button" className={btn} disabled={busy||dirty} onClick={()=>review(item,false)}>No incorporar</button>
      </div>}
    </article>)}
    {error&&<p role="alert" className="text-sm font-bold text-red-700 dark:text-red-300">{error}</p>}
    {message&&<p role="status" className="text-sm text-[#00548E] dark:text-blue-200">{message}</p>}
    </div>
  </details>;
}
