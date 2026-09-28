import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ClipboardList, Clock3, FileSignature, Loader2, LogIn, LogOut, RefreshCw, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import type { Person } from '../types';
import {
  ADDITIONAL_WORKSITE_DOCUMENTS,
  type AdditionalWorksiteDocumentType,
} from '../src/lib/worksiteAdditionalDocumentsPdf';
import {
  resolveForemanPortal,
  saveForemanAttendance,
  submitForemanDocument,
  signMandatoryForemanDocument,
  type ForemanAttendanceRow,
  type ForemanPortalPayload,
} from '../src/services/foremanPortalService';

const today = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

const SignaturePad: React.FC<{ title: string; onSave: (data: string) => void; onCancel: () => void }> = ({ title, onSave, onCancel }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{x:number;y:number}|null>(null);
  useEffect(() => {
    const canvas=ref.current; if(!canvas) return;
    const rect=canvas.getBoundingClientRect(); const ratio=Math.max(1,window.devicePixelRatio||1);
    canvas.width=Math.floor(rect.width*ratio); canvas.height=Math.floor(190*ratio);
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    ctx.setTransform(ratio,0,0,ratio,0,0); ctx.fillStyle='#fff'; ctx.fillRect(0,0,rect.width,190);
    ctx.strokeStyle='#111827'; ctx.lineWidth=2.4; ctx.lineCap='round'; ctx.lineJoin='round';
  },[]);
  const point=(e:React.PointerEvent<HTMLCanvasElement>)=>{const r=e.currentTarget.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
  return <div className="fixed inset-0 z-50 bg-slate-950/70 p-4 flex items-center justify-center">
    <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
      <h3 className="text-lg font-black text-slate-900">{title}</h3>
      <p className="mt-1 text-xs text-slate-500">Firma con el dedo dentro del recuadro.</p>
      <canvas ref={ref} className="mt-4 w-full h-[190px] touch-none rounded-2xl border-2 border-slate-300 bg-white"
        onPointerDown={e=>{e.preventDefault();drawing.current=true;last.current=point(e);e.currentTarget.setPointerCapture?.(e.pointerId)}}
        onPointerMove={e=>{if(!drawing.current||!last.current)return;e.preventDefault();const ctx=e.currentTarget.getContext('2d');if(!ctx)return;const n=point(e);ctx.beginPath();ctx.moveTo(last.current.x,last.current.y);ctx.lineTo(n.x,n.y);ctx.stroke();last.current=n}}
        onPointerUp={e=>{drawing.current=false;last.current=null;e.currentTarget.releasePointerCapture?.(e.pointerId)}}/>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <button onClick={()=>{const c=ref.current,ctx=c?.getContext('2d');if(c&&ctx){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.restore();}}} className="rounded-xl border px-3 py-3 text-sm font-bold"><RotateCcw className="inline w-4 h-4 mr-1"/>Borrar</button>
        <button onClick={onCancel} className="rounded-xl border px-3 py-3 text-sm font-bold">Cancelar</button>
        <button onClick={()=>{const c=ref.current;if(c)onSave(c.toDataURL('image/png'));}} className="rounded-xl bg-[#00548E] px-3 py-3 text-sm font-black text-white">Guardar</button>
      </div>
    </div>
  </div>;
};

export const ForemanMobilePortal: React.FC<{ token: string }> = ({ token }) => {
  const [data,setData]=useState<ForemanPortalPayload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [tab,setTab]=useState<'attendance'|'mandatory'|'documents'|'completed'>('attendance');
  const [date,setDate]=useState(today());
  const [rows,setRows]=useState<ForemanAttendanceRow[]>([]);
  const [signing,setSigning]=useState<{workerId:number;kind:'entry'|'exit'}|null>(null);
  const [saving,setSaving]=useState(false);
  const [docType,setDocType]=useState<AdditionalWorksiteDocumentType>('ausencia_trabajador');
  const [workerId,setWorkerId]=useState<number|''>('');
  const [answers,setAnswers]=useState<Record<string,string>>({});
  const [docSignatures,setDocSignatures]=useState<Record<string,string>>({});
  const [docSigning,setDocSigning]=useState<'worker'|'foreman'|null>(null);
  const [mandatorySigning,setMandatorySigning]=useState<{documentId:string;workerId:number;name:string}|null>(null);

  const refresh=async()=>{setLoading(true);setError('');try{const next=await resolveForemanPortal(token);if(!next.valid)throw new Error('Este acceso no es válido o ha sido revocado.');setData(next);}catch(e:any){setError(e?.message||'No se pudo abrir la documentación de la obra.');}finally{setLoading(false);}};
  useEffect(()=>{void refresh();},[token]);

  useEffect(()=>{
    if(!data)return;
    const saved=data.attendance.find(a=>String(a.workDate).slice(0,10)===date);
    if(saved?.rows?.length){setRows(saved.rows);return;}
    setRows(data.workers.map(w=>({
      workerId:Number(w.id),
      name:w.apellidosNombre,
      dni:w.dni,
      category:w.categoria,
      entryTime:data.defaultWorkStartHour || '07:30',
      exitTime:data.defaultWorkEndHour || '15:30',
    })));
  },[data,date]);

  const persist=async(nextRows:ForemanAttendanceRow[],status:'draft'|'completed'='draft')=>{
    setSaving(true);try{await saveForemanAttendance(token,date,nextRows,status);setRows(nextRows);if(status==='completed')await refresh();}finally{setSaving(false);}
  };
  const applySignature=async(image:string)=>{
    if(!signing)return;
    const next=rows.map(r=>r.workerId===signing.workerId?{...r,...(signing.kind==='entry'?{entrySignature:image,entryTime:r.entryTime||data?.defaultWorkStartHour||nowTime()}:{exitSignature:image,exitTime:r.exitTime||data?.defaultWorkEndHour||nowTime()})}:r);
    setSigning(null); await persist(next,'draft');
  };
  const def=ADDITIONAL_WORKSITE_DOCUMENTS[docType];
  const selectedWorker=data?.workers.find(w=>Number(w.id)===Number(workerId));

  if(loading&&!data)return <div className="min-h-screen bg-slate-100 flex items-center justify-center"><div className="text-center"><Loader2 className="w-9 h-9 animate-spin mx-auto text-[#00548E]"/><p className="mt-3 font-bold">Abriendo documentación de obra…</p></div></div>;
  if(error||!data)return <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4"><div className="max-w-md rounded-3xl bg-white border border-amber-200 p-7 text-center shadow-xl"><ShieldCheck className="w-10 h-10 mx-auto text-amber-500"/><h1 className="mt-3 text-xl font-black">Acceso no disponible</h1><p className="mt-2 text-sm text-slate-600">{error}</p></div></div>;

  const completedToday=rows.filter(r=>r.entrySignature&&r.exitSignature).length;
  return <div className="min-h-screen bg-slate-100 text-slate-900">
    <header className="sticky top-0 z-20 bg-white border-b border-slate-200 shadow-sm px-4 py-3">
      <div className="max-w-3xl mx-auto"><div className="text-[10px] font-black uppercase tracking-[.16em] text-[#00548E]">Portal del encargado · PROFEA</div><h1 className="text-lg font-black leading-tight">{data.obra}</h1><p className="text-xs text-slate-500">{data.foremanName||'Encargado de obra'}</p></div>
    </header>
    <main className="max-w-3xl mx-auto p-3 sm:p-5 space-y-4">
      <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-white border p-2">
        <button onClick={()=>setTab('attendance')} className={`rounded-xl px-1 py-3 text-[11px] font-black ${tab==='attendance'?'bg-[#00548E] text-white':'text-slate-600'}`}><Clock3 className="w-4 h-4 mx-auto mb-1"/>Jornada</button>
        <button onClick={()=>setTab('mandatory')} className={`rounded-xl px-1 py-3 text-[11px] font-black ${tab==='mandatory'?'bg-[#00548E] text-white':'text-slate-600'}`}><ClipboardList className="w-4 h-4 mx-auto mb-1"/>Obligatorios</button>
        <button onClick={()=>setTab('documents')} className={`rounded-xl px-1 py-3 text-[11px] font-black ${tab==='documents'?'bg-[#00548E] text-white':'text-slate-600'}`}><FileSignature className="w-4 h-4 mx-auto mb-1"/>Otros</button>
        <button onClick={()=>setTab('completed')} className={`rounded-xl px-1 py-3 text-[11px] font-black ${tab==='completed'?'bg-[#00548E] text-white':'text-slate-600'}`}><CheckCircle2 className="w-4 h-4 mx-auto mb-1"/>Enviados</button>
      </div>

      {tab==='attendance'&&<section className="space-y-3">
        <div className="rounded-2xl bg-white border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black">Registro diario de jornada</h2><p className="text-xs text-slate-500">{completedToday}/{rows.length} con entrada y salida firmadas</p><p className="mt-1 text-[11px] font-semibold text-slate-500">Horario predeterminado: {data.defaultWorkStartHour}–{data.defaultWorkEndHour}. Puedes cambiarlo individualmente para cada trabajador.</p></div><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="rounded-xl border px-3 py-2 text-sm font-bold"/></div>
        </div>
        {rows.map(row=><div key={row.workerId} className="rounded-2xl bg-white border p-4 shadow-sm">
          <div><div className="font-black">{row.name}</div><div className="text-xs text-slate-500">{row.dni} · {row.category}</div></div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className={`rounded-xl border p-2.5 ${row.entrySignature?'border-emerald-300 bg-emerald-50':'bg-white'}`}>
              <label className="block text-[10px] font-black uppercase text-slate-500">Hora entrada</label>
              <input
                type="time"
                value={row.entryTime || data.defaultWorkStartHour || '07:30'}
                onChange={e=>{
                  const value=e.target.value;
                  setRows(current=>current.map(item=>item.workerId===row.workerId?{...item,entryTime:value,entrySignature:undefined}:item));
                }}
                className="mt-1 w-full rounded-lg border px-2 py-2 text-sm font-black bg-white"
              />
              <button onClick={()=>setSigning({workerId:row.workerId,kind:'entry'})} className={`mt-2 w-full rounded-lg px-2 py-2 text-xs font-black ${row.entrySignature?'bg-emerald-600 text-white':'bg-slate-100 text-slate-800'}`}>
                <LogIn className="w-4 h-4 inline mr-1"/>{row.entrySignature?'Entrada firmada':'Firmar entrada'}
              </button>
            </div>
            <div className={`rounded-xl border p-2.5 ${row.exitSignature?'border-blue-300 bg-blue-50':'bg-white'}`}>
              <label className="block text-[10px] font-black uppercase text-slate-500">Hora salida</label>
              <input
                type="time"
                value={row.exitTime || data.defaultWorkEndHour || '15:30'}
                onChange={e=>{
                  const value=e.target.value;
                  setRows(current=>current.map(item=>item.workerId===row.workerId?{...item,exitTime:value,exitSignature:undefined}:item));
                }}
                className="mt-1 w-full rounded-lg border px-2 py-2 text-sm font-black bg-white"
              />
              <button onClick={()=>setSigning({workerId:row.workerId,kind:'exit'})} className={`mt-2 w-full rounded-lg px-2 py-2 text-xs font-black ${row.exitSignature?'bg-blue-600 text-white':'bg-slate-100 text-slate-800'}`}>
                <LogOut className="w-4 h-4 inline mr-1"/>{row.exitSignature?'Salida firmada':'Firmar salida'}
              </button>
            </div>
          </div>
        </div>)}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button disabled={saving||!rows.length} onClick={()=>void persist(rows,'draft')} className="w-full rounded-2xl border border-slate-300 bg-white py-4 font-black text-slate-800 disabled:opacity-50">{saving?<Loader2 className="w-5 h-5 animate-spin mx-auto"/>:<><Save className="inline w-5 h-5 mr-2"/>Guardar cambios</>}</button>
          <button disabled={saving||!rows.length} onClick={()=>void persist(rows,'completed')} className="w-full rounded-2xl bg-emerald-600 text-white py-4 font-black disabled:opacity-50">{saving?<Loader2 className="w-5 h-5 animate-spin mx-auto"/>:<><CheckCircle2 className="inline w-5 h-5 mr-2"/>Finalizar y enviar jornada</>}</button>
        </div>
      </section>}

      {tab==='mandatory'&&<section className="space-y-3">
        <div className="rounded-2xl bg-white border p-4">
          <h2 className="font-black">Documentos obligatorios</h2>
          <p className="mt-1 text-xs text-slate-500">Se crean automáticamente al importar la relación de la administrativa. Cada trabajador firma desde este móvil.</p>
        </div>
        {data.mandatoryDocuments.map(doc=>{
          const label=doc.documentType==='inicio'?'Inicio / incorporación':'Control de presencia';
          const signedCount=Object.keys(doc.signatures||{}).length;
          return <div key={doc.id} className="rounded-2xl bg-white border p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><div className="font-black">{label}</div><div className="text-xs text-slate-500">{String(doc.workDate).slice(0,10)}{doc.category?' · '+doc.category:''}</div></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${doc.status==='completed'||doc.status==='reviewed'?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-800'}`}>{signedCount}/{doc.workers.length} firmas</span></div>
            <div className="mt-3 space-y-2">{doc.workers.map(worker=>{
              const signed=Boolean((doc.signatures||{})[String(worker.id)]);
              return <button key={worker.id} type="button" disabled={signed} onClick={()=>setMandatorySigning({documentId:doc.id,workerId:Number(worker.id),name:worker.apellidosNombre})} className={`w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left ${signed?'bg-emerald-50 border-emerald-200':'bg-white'}`}>
                <span><span className="block text-sm font-black">{worker.apellidosNombre}</span><span className="block text-[11px] text-slate-500">{worker.dni} · {worker.categoria}</span></span>
                <span className={`text-xs font-black ${signed?'text-emerald-700':'text-[#00548E]'}`}>{signed?'Firmado ✓':'Firmar'}</span>
              </button>;
            })}</div>
          </div>;
        })}
        {!data.mandatoryDocuments.length&&<div className="rounded-2xl bg-white border p-8 text-center text-sm text-slate-500">No hay documentos obligatorios pendientes para esta obra.</div>}
      </section>}

      {tab==='documents'&&<section className="rounded-2xl bg-white border p-4 space-y-4">
        <div><h2 className="font-black">Otros documentos</h2><p className="text-xs text-slate-500">Cumplimenta, firma y envía el documento al supervisor.</p></div>
        <label className="block text-xs font-black uppercase">Documento<select value={docType} onChange={e=>{setDocType(e.target.value as AdditionalWorksiteDocumentType);setAnswers({});setDocSignatures({});}} className="mt-1 w-full rounded-xl border px-3 py-3 text-sm normal-case">
          {Object.entries(ADDITIONAL_WORKSITE_DOCUMENTS).map(([key,d])=><option key={key} value={key}>{d.short}</option>)}
        </select></label>
        <label className="block text-xs font-black uppercase">Trabajador<select value={workerId} onChange={e=>setWorkerId(e.target.value?Number(e.target.value):'')} className="mt-1 w-full rounded-xl border px-3 py-3 text-sm normal-case"><option value="">Seleccionar…</option>{data.workers.map(w=><option key={w.id} value={w.id}>{w.apellidosNombre} · {w.dni}</option>)}</select></label>
        <label className="block text-xs font-black uppercase">Fecha<input type="date" value={date} onChange={e=>setDate(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3 text-sm normal-case"/></label>
        {def.fields.map(field=><label key={field.key} className="block text-xs font-black uppercase">{field.label}{field.type==='textarea'?<textarea rows={3} value={answers[field.key]||''} onChange={e=>setAnswers(a=>({...a,[field.key]:e.target.value}))} className="mt-1 w-full rounded-xl border px-3 py-3 text-sm normal-case"/>:field.type==='select'?<select value={answers[field.key]||''} onChange={e=>setAnswers(a=>({...a,[field.key]:e.target.value}))} className="mt-1 w-full rounded-xl border px-3 py-3 text-sm normal-case"><option value="">Seleccionar…</option>{field.options?.map(o=><option key={o}>{o}</option>)}</select>:<input type={field.type||'text'} value={answers[field.key]||''} onChange={e=>setAnswers(a=>({...a,[field.key]:e.target.value}))} className="mt-1 w-full rounded-xl border px-3 py-3 text-sm normal-case"/>}</label>)}
        <div className="grid grid-cols-2 gap-2">{def.signatureWorker&&<button onClick={()=>setDocSigning('worker')} className={`rounded-xl border px-3 py-3 text-sm font-black ${docSignatures.worker?'bg-emerald-50 border-emerald-300 text-emerald-800':''}`}>Firma trabajador {docSignatures.worker?'✓':''}</button>}<button onClick={()=>setDocSigning('foreman')} className={`rounded-xl border px-3 py-3 text-sm font-black ${docSignatures.foreman?'bg-emerald-50 border-emerald-300 text-emerald-800':''}`}>Firma encargado {docSignatures.foreman?'✓':''}</button></div>
        <button onClick={async()=>{if(!selectedWorker)return alert('Selecciona un trabajador.');const missing=def.fields.filter(f=>f.required&&!String(answers[f.key]||'').trim());if(missing.length)return alert('Completa: '+missing.map(f=>f.label).join(', '));if(def.signatureWorker&&!docSignatures.worker)return alert('Falta la firma del trabajador.');if(!docSignatures.foreman)return alert('Falta la firma del encargado.');setSaving(true);try{await submitForemanDocument({token,documentType:docType,workDate:date,workerId:Number(selectedWorker.id),answers,signatures:docSignatures});setAnswers({});setDocSignatures({});setWorkerId('');await refresh();setTab('completed');}finally{setSaving(false);}}} disabled={saving} className="w-full rounded-2xl bg-[#00548E] text-white py-4 font-black disabled:opacity-50">Finalizar y enviar documento</button>
      </section>}

      {tab==='completed'&&<section className="space-y-3">
        <button onClick={()=>void refresh()} className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs font-black"><RefreshCw className="w-4 h-4"/>Actualizar</button>
        {data.documents.map(d=><div key={d.id} className="rounded-2xl bg-white border p-4"><div className="font-black">{ADDITIONAL_WORKSITE_DOCUMENTS[d.documentType as AdditionalWorksiteDocumentType]?.short||d.documentType}</div><div className="text-xs text-slate-500">{d.workerSnapshot?.apellidosNombre||'Trabajador'} · {String(d.workDate).slice(0,10)}</div><span className="mt-2 inline-flex rounded-full bg-emerald-50 border border-emerald-200 px-2 py-1 text-[10px] font-black text-emerald-700">Enviado al supervisor</span></div>)}
        {!data.documents.length&&<div className="rounded-2xl bg-white border p-8 text-center text-sm text-slate-500">Todavía no hay documentos enviados.</div>}
      </section>}
    </main>
    {signing&&<SignaturePad title={`Firma de ${signing.kind==='entry'?'entrada':'salida'}`} onSave={img=>void applySignature(img)} onCancel={()=>setSigning(null)}/>}
    {docSigning&&<SignaturePad title={docSigning==='worker'?'Firma del trabajador':'Firma del encargado'} onSave={img=>{setDocSignatures(s=>({...s,[docSigning]:img}));setDocSigning(null);}} onCancel={()=>setDocSigning(null)}/>}
    {mandatorySigning&&<SignaturePad title={'Firma de '+mandatorySigning.name} onSave={async img=>{const current=mandatorySigning;setMandatorySigning(null);setSaving(true);try{await signMandatoryForemanDocument(token,current.documentId,current.workerId,img);await refresh();}finally{setSaving(false);}}} onCancel={()=>setMandatorySigning(null)}/>}
  </div>;
};
