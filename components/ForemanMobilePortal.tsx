import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ClipboardList, Clock3, FileDown, FileSignature, Loader2, LogIn, LogOut, RefreshCw, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import {
  ADDITIONAL_WORKSITE_DOCUMENTS,
  generateAdditionalWorksiteDocument,
  type AdditionalWorksiteDocumentType,
} from '../src/lib/worksiteAdditionalDocumentsPdf';
import {
  generateEpiDeliveryPdf,
  generateMachineryAuthorizationPdf,
  generateTrainingInformationPdf,
  type WorksiteDocumentContext,
} from '../src/lib/worksiteDocumentsPdf';
import { generateContractAttendancePdf } from '../src/lib/worksiteAttendancePdf';
import { downloadPDF } from '../src/lib/exportUtils';
import {
  resolveForemanPortal,
  saveForemanAttendance,
  submitForemanDocument,
  signMandatoryForemanDocument,
  finalizeForemanMandatoryDocument,
  resubmitForemanDocument,
  type ForemanAttendanceRow,
  type ForemanPortalPayload,
} from '../src/services/foremanPortalService';

const today = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
type CoreWorksiteDocumentType = 'epis' | 'formacion' | 'maquinaria' | 'control';
const CORE_WORKSITE_DOCUMENTS: Record<CoreWorksiteDocumentType,string> = {
  epis: 'Entrega de EPIs',
  formacion: 'Formación e información',
  maquinaria: 'Autorización de maquinaria',
  control: 'Control horario',
};
const DEFAULT_EPIS = { casco:true, chaleco:true, orejeras:true, gafas:true, guantes:true, mascarillas:true, calzado:true };

const SignaturePad: React.FC<{ title: string; onSave: (data: string) => void; onCancel: () => void }> = ({ title, onSave, onCancel }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{x:number;y:number}|null>(null);
  useEffect(() => {
    const canvas=ref.current; if(!canvas) return;
    const rect=canvas.getBoundingClientRect(); const ratio=Math.max(1,window.devicePixelRatio||1);
    canvas.width=Math.floor(rect.width*ratio); canvas.height=Math.floor(rect.height*ratio);
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    ctx.setTransform(ratio,0,0,ratio,0,0); ctx.fillStyle='#fff'; ctx.fillRect(0,0,rect.width,rect.height);
    ctx.strokeStyle='#111827'; ctx.lineWidth=2.4; ctx.lineCap='round'; ctx.lineJoin='round';
  },[]);
  const point=(e:React.PointerEvent<HTMLCanvasElement>)=>{const r=e.currentTarget.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
  return <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{paddingTop:'env(safe-area-inset-top)'}}>
    <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-white p-4 sm:p-6 shadow-2xl" style={{paddingBottom:'max(16px, env(safe-area-inset-bottom))'}}>
      <h3 className="text-lg font-black text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">Firma con el dedo dentro del recuadro.</p>
      <canvas ref={ref} className="mt-4 w-full h-[240px] sm:h-[280px] touch-none rounded-2xl border-2 border-slate-300 bg-white"
        onPointerDown={e=>{e.preventDefault();drawing.current=true;last.current=point(e);e.currentTarget.setPointerCapture?.(e.pointerId)}}
        onPointerMove={e=>{if(!drawing.current||!last.current)return;e.preventDefault();const ctx=e.currentTarget.getContext('2d');if(!ctx)return;const n=point(e);ctx.beginPath();ctx.moveTo(last.current.x,last.current.y);ctx.lineTo(n.x,n.y);ctx.stroke();last.current=n}}
        onPointerUp={e=>{drawing.current=false;last.current=null;e.currentTarget.releasePointerCapture?.(e.pointerId)}}/>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button onClick={()=>{const c=ref.current,ctx=c?.getContext('2d');if(c&&ctx){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.restore();}}} className="min-h-[52px] rounded-xl border px-4 py-3 text-base font-bold"><RotateCcw className="inline w-4 h-4 mr-1"/>Borrar</button>
        <button onClick={onCancel} className="min-h-[52px] rounded-xl border px-4 py-3 text-base font-bold">Cancelar</button>
        <button onClick={()=>{const c=ref.current;if(c)onSave(c.toDataURL('image/png'));}} className="min-h-[52px] rounded-xl bg-[#00548E] px-4 py-3 text-base font-black text-white">Guardar</button>
      </div>
    </div>
  </div>;
};

export const ForemanMobilePortal: React.FC<{ token: string }> = ({ token }) => {
  const [data,setData]=useState<ForemanPortalPayload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [tab,setTab]=useState<'attendance'|'mandatory'|'documents'|'completed'>('mandatory');
  const [date,setDate]=useState(today());
  const [rows,setRows]=useState<ForemanAttendanceRow[]>([]);
  const [signing,setSigning]=useState<{workerId:number;kind:'entry'|'exit'}|null>(null);
  const [saving,setSaving]=useState(false);
  const [coreDocType,setCoreDocType]=useState<CoreWorksiteDocumentType>('epis');
  const [documentPeriod,setDocumentPeriod]=useState('');
  const [trainingAction,setTrainingAction]=useState('Información y formación preventiva del puesto de trabajo y de la obra');
  const [trainingDuration,setTrainingDuration]=useState('');
  const [epiSelection,setEpiSelection]=useState<Record<string,boolean>>(DEFAULT_EPIS);
  const [machineryByWorker,setMachineryByWorker]=useState<Record<string,string>>({});
  const [globalMachinery,setGlobalMachinery]=useState('');
  const [docType,setDocType]=useState<AdditionalWorksiteDocumentType>('ausencia_trabajador');
  const [workerId,setWorkerId]=useState<number|''>('');
  const [answers,setAnswers]=useState<Record<string,string>>({});
  const [docSignatures,setDocSignatures]=useState<Record<string,string>>({});
  const [docSigning,setDocSigning]=useState<'worker'|'foreman'|null>(null);
  const [correctionDocumentId,setCorrectionDocumentId]=useState<string>('');
  const [mandatorySigning,setMandatorySigning]=useState<{documentId:string;workerId:number;name:string}|null>(null);

  const refresh=async()=>{setLoading(true);setError('');try{const next=await resolveForemanPortal(token);if(!next.valid)throw new Error('Este acceso no es válido o ha sido revocado.');setData(next);}catch(e:any){setError(e?.message||'No se pudo abrir la documentación de la obra.');}finally{setLoading(false);}};
  useEffect(()=>{void refresh();},[token]);

  useEffect(()=>{
    if(!data)return;
    const saved=data.attendance.find(a=>String(a.workDate).slice(0,10)===date);
    if(saved?.rows?.length){
      setRows(saved.rows.map(row=>({
        ...row,
        entryTime: row.entryTime || data.defaultWorkStartHour || '08:00',
        exitTime: row.exitTime || data.defaultWorkEndHour || '15:00',
      })));
      return;
    }
    setRows(data.workers.map(w=>({
      workerId:Number(w.id),
      name:w.apellidosNombre,
      dni:w.dni,
      category:w.categoria,
      entryTime:data.defaultWorkStartHour || '08:00',
      exitTime:data.defaultWorkEndHour || '15:00',
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
  const availablePeriods = Array.from(new Set((data?.workers||[]).map(worker=>String(worker.quincena||'').trim()).filter(Boolean)));
  const documentWorkers = documentPeriod
    ? (data?.workers||[]).filter(worker=>String(worker.quincena||'').trim()===documentPeriod)
    : (data?.workers||[]);
  const periodLabel = documentPeriod || (
    documentWorkers.length
      ? [documentWorkers.map(worker=>String(worker.periodoInicio||'')).filter(Boolean).sort()[0], documentWorkers.map(worker=>String(worker.periodoFin||'')).filter(Boolean).sort().slice(-1)[0]].filter(Boolean).join(' – ')
      : 'Sin periodo'
  );
  const worksiteContext: WorksiteDocumentContext = {
    obra: data?.obra || '',
    municipio: data?.worksite?.municipio || '',
    empresa: data?.worksite?.empresa || '',
    cif: data?.worksite?.cif || '',
    recursoPreventivo: data?.worksite?.recursoPreventivo || data?.foremanName || '',
    fecha: date,
    periodoLabel,
    accionFormativa: trainingAction,
    duracionFormacion: trainingDuration,
    epis: epiSelection,
    maquinariaPorTrabajador: machineryByWorker,
  };
  const generateCoreDocument = () => {
    if (!documentWorkers.length) return window.alert('No hay trabajadores para el periodo seleccionado.');
    if (coreDocType === 'epis') {
      const out=generateEpiDeliveryPdf(documentWorkers,worksiteContext); downloadPDF(out.doc,out.filename); return;
    }
    if (coreDocType === 'formacion') {
      const out=generateTrainingInformationPdf(documentWorkers,worksiteContext); downloadPDF(out.doc,out.filename); return;
    }
    if (coreDocType === 'maquinaria') {
      const out=generateMachineryAuthorizationPdf(documentWorkers,worksiteContext); downloadPDF(out.doc,out.filename); return;
    }
    const out=generateContractAttendancePdf(documentWorkers,{...worksiteContext,codigoObra:data?.worksite?.codigo||''});
    downloadPDF(out.doc,out.filename);
  };
  const generateAdditionalPdf = () => {
    if (!selectedWorker) return window.alert('Selecciona un trabajador.');
    const context = {
      obra: data?.obra || '',
      municipio: data?.worksite?.municipio || '',
      empresa: data?.worksite?.empresa || '',
      cif: data?.worksite?.cif || '',
      fecha: date,
      responsable: data?.worksite?.recursoPreventivo || data?.foremanName || '',
      supervisor: selectedWorker.supervisorResponsable || '',
    };
    const out=generateAdditionalWorksiteDocument(
      docType,
      selectedWorker,
      context,
      answers,
      { worker:docSignatures.worker, foreman:docSignatures.foreman },
    );
    downloadPDF(out.doc,out.filename);
  };
  const mandatoryLabel=(type:string)=>({
    inicio:'Inicio / incorporación',
    control_presencia:'Control de presencia',
  } as Record<string,string>)[type]||type;

  const assignedMandatoryDocuments = data?.mandatoryDocuments.filter(
    document => ['inicio','control_presencia'].includes(String(document.documentType || '')),
  ) || [];


  if(loading&&!data)return <div className="min-h-screen bg-slate-100 flex items-center justify-center"><div className="text-center"><Loader2 className="w-9 h-9 animate-spin mx-auto text-[#00548E]"/><p className="mt-3 font-bold">Abriendo documentación de obra…</p></div></div>;
  if(error||!data)return <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4"><div className="max-w-md rounded-3xl bg-white border border-amber-200 p-7 text-center shadow-xl"><ShieldCheck className="w-10 h-10 mx-auto text-amber-500"/><h1 className="mt-3 text-xl font-black">Acceso no disponible</h1><p className="mt-2 text-sm text-slate-600">{error}</p></div></div>;

  const completedToday=rows.filter(r=>r.entrySignature&&r.exitSignature).length;
  return <div className="min-h-[100dvh] bg-slate-100 text-slate-900 overscroll-none">
    <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm px-4 pb-3" style={{paddingTop:'max(12px, env(safe-area-inset-top))'}}>
      <div className="max-w-4xl mx-auto">
        <div className="text-[11px] sm:text-xs font-black uppercase tracking-[.14em] text-[#00548E]">Portal del encargado · PROFEA</div>
        <h1 className="mt-0.5 text-lg sm:text-xl font-black leading-tight break-words">{data.obra}</h1>
        <p className="mt-0.5 text-sm text-slate-600">{data.foremanName||'Encargado de obra'}</p>
      </div>
    </header>
    <main className="max-w-4xl mx-auto px-3 sm:px-5 pt-3 sm:pt-5 pb-28 sm:pb-6 space-y-4">
      <div className="fixed bottom-0 left-0 right-0 z-30 sm:static grid grid-cols-4 gap-1 bg-white/95 backdrop-blur border-t sm:border sm:rounded-2xl p-2 shadow-[0_-8px_30px_rgba(15,23,42,0.10)] sm:shadow-none" style={{paddingBottom:'max(8px, env(safe-area-inset-bottom))'}}>
        <button onClick={()=>setTab('mandatory')} className={`min-h-[58px] rounded-xl px-1 py-2 text-[11px] sm:text-xs font-black touch-manipulation ${tab==='mandatory'?'bg-[#00548E] text-white':'text-slate-700'}`}><ClipboardList className="w-5 h-5 mx-auto mb-1"/>Asignados</button>
        <button onClick={()=>setTab('documents')} className={`min-h-[58px] rounded-xl px-1 py-2 text-[11px] sm:text-xs font-black touch-manipulation ${tab==='documents'?'bg-[#00548E] text-white':'text-slate-700'}`}><FileSignature className="w-5 h-5 mx-auto mb-1"/>Documentos</button>
        <button onClick={()=>setTab('attendance')} className={`min-h-[58px] rounded-xl px-1 py-2 text-[11px] sm:text-xs font-black touch-manipulation ${tab==='attendance'?'bg-[#00548E] text-white':'text-slate-700'}`}><Clock3 className="w-5 h-5 mx-auto mb-1"/>Jornada</button>
        <button onClick={()=>setTab('completed')} className={`min-h-[58px] rounded-xl px-1 py-2 text-[11px] sm:text-xs font-black touch-manipulation ${tab==='completed'?'bg-[#00548E] text-white':'text-slate-700'}`}><CheckCircle2 className="w-5 h-5 mx-auto mb-1"/>Finalizados</button>
      </div>

      {tab==='attendance'&&<section className="space-y-3">
        <div className="rounded-2xl bg-white border p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><div><h2 className="text-lg font-black">Registro diario de jornada</h2><p className="text-sm text-slate-600">{completedToday}/{rows.length} con entrada y salida firmadas</p><p className="mt-1 text-sm font-semibold text-slate-500">Horario predeterminado: {data.defaultWorkStartHour}–{data.defaultWorkEndHour}. Puedes cambiarlo para cada trabajador.</p></div><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="min-h-[50px] w-full sm:w-auto rounded-xl border px-3 py-2 text-base font-bold bg-white"/></div>
        </div>
        {data.attendance.find(a=>String(a.workDate).slice(0,10)===date)?.correctionPending&&
          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
            <div className="font-black text-amber-900">Corrección solicitada por el supervisor</div>
            <p className="mt-1 text-sm text-amber-800">{data.attendance.find(a=>String(a.workDate).slice(0,10)===date)?.correctionReason||'Revisa esta jornada antes de volver a finalizarla.'}</p>
          </div>}
        {rows.map(row=><div key={row.workerId} className="rounded-2xl bg-white border p-4 shadow-sm">
          <div><div className="font-black">{row.name}</div><div className="text-xs text-slate-500">{row.dni} · {row.category}</div></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div className={`rounded-xl border p-2.5 ${row.entrySignature?'border-emerald-300 bg-emerald-50':'bg-white'}`}>
              <label className="block text-[10px] font-black uppercase text-slate-500">Hora entrada</label>
              <input
                type="time"
                value={row.entryTime || data.defaultWorkStartHour || '08:00'}
                onChange={e=>{
                  const value=e.target.value;
                  setRows(current=>current.map(item=>item.workerId===row.workerId?{...item,entryTime:value,entrySignature:undefined}:item));
                }}
                className="mt-1 min-h-[50px] w-full rounded-xl border px-3 py-2 text-base font-black bg-white"
              />
              <button onClick={()=>setSigning({workerId:row.workerId,kind:'entry'})} className={`mt-2 min-h-[50px] w-full rounded-xl px-3 py-3 text-sm font-black touch-manipulation ${row.entrySignature?'bg-emerald-600 text-white':'bg-slate-100 text-slate-800'}`}>
                <LogIn className="w-4 h-4 inline mr-1"/>{row.entrySignature?'Entrada firmada':'Firmar entrada'}
              </button>
            </div>
            <div className={`rounded-xl border p-2.5 ${row.exitSignature?'border-blue-300 bg-blue-50':'bg-white'}`}>
              <label className="block text-[10px] font-black uppercase text-slate-500">Hora salida</label>
              <input
                type="time"
                value={row.exitTime || data.defaultWorkEndHour || '15:00'}
                onChange={e=>{
                  const value=e.target.value;
                  setRows(current=>current.map(item=>item.workerId===row.workerId?{...item,exitTime:value,exitSignature:undefined}:item));
                }}
                className="mt-1 min-h-[50px] w-full rounded-xl border px-3 py-2 text-base font-black bg-white"
              />
              <button onClick={()=>setSigning({workerId:row.workerId,kind:'exit'})} className={`mt-2 min-h-[50px] w-full rounded-xl px-3 py-3 text-sm font-black touch-manipulation ${row.exitSignature?'bg-blue-600 text-white':'bg-slate-100 text-slate-800'}`}>
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
          <h2 className="font-black">Documentos asignados por el supervisor</h2>
          <p className="mt-1 text-xs text-slate-500">Aquí solo aparecen los documentos que el supervisor ha preparado para esta obra. Recoge todas las firmas y después pulsa Finalizar para enviárselos.</p>
        </div>
        {assignedMandatoryDocuments.map(doc=>{
          const label=mandatoryLabel(doc.documentType);
          const signedCount=Object.keys(doc.signatures||{}).length;
          const correction=Boolean(doc.correctionPending);
          return <div key={doc.id} className={`rounded-2xl bg-white border p-4 shadow-sm ${correction?'border-amber-300':''}`}>
            <div className="flex items-start justify-between gap-3"><div><div className="font-black">{label}</div><div className="text-xs text-slate-500">{String(doc.workDate).slice(0,10)}{doc.category?' · '+doc.category:''}</div></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${doc.status==='completed'||doc.status==='reviewed'?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-800'}`}>{signedCount}/{doc.workers.length} firmas</span></div>
            {correction&&<div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900"><b>Devuelto por el supervisor:</b> {doc.correctionReason||'Revisa y corrige el documento.'}</div>}
            <div className="mt-3 space-y-2">{doc.workers.map(worker=>{
              const signed=Boolean((doc.signatures||{})[String(worker.id)]);
              const closed=doc.status==='completed'||doc.status==='reviewed';
              return <button key={worker.id} type="button" disabled={closed||(!correction&&signed)} onClick={()=>setMandatorySigning({documentId:doc.id,workerId:Number(worker.id),name:worker.apellidosNombre})} className={`w-full min-h-[64px] flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left touch-manipulation ${signed?'bg-emerald-50 border-emerald-200':'bg-white active:bg-blue-50'}`}>
                <span><span className="block text-base font-black leading-tight">{worker.apellidosNombre}</span><span className="block mt-1 text-sm text-slate-500">{worker.dni} · {worker.categoria}</span></span>
                <span className={`text-xs font-black ${signed&&!correction?'text-emerald-700':'text-[#00548E]'}`}>{correction?(signed?'Volver a firmar':'Firmar'):signed?'Firmado ✓':'Firmar'}</span>
              </button>;
            })}</div>
            {doc.status!=='completed'&&doc.status!=='reviewed'&&(
              <button
                type="button"
                disabled={saving || signedCount !== doc.workers.length || doc.workers.length===0}
                onClick={async()=>{
                  setSaving(true);
                  try{
                    await finalizeForemanMandatoryDocument(token,doc.id);
                    await refresh();
                    setTab('completed');
                  }catch(error:any){
                    window.alert(error?.message||'No se pudo finalizar el documento.');
                  }finally{
                    setSaving(false);
                  }
                }}
                className="mt-4 min-h-[56px] w-full rounded-2xl bg-emerald-600 px-4 py-3.5 text-base font-black text-white touch-manipulation disabled:bg-slate-200 disabled:text-slate-500"
              >
                {signedCount===doc.workers.length&&doc.workers.length>0 ? 'Finalizar y enviar al supervisor' : `Faltan ${Math.max(0,doc.workers.length-signedCount)} firma(s)`}
              </button>
            )}
            {(doc.status==='completed'||doc.status==='reviewed')&&(
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-xs font-black text-emerald-800">
                Documento finalizado y enviado al supervisor
              </div>
            )}
          </div>;
        })}
        {!assignedMandatoryDocuments.length&&<div className="rounded-2xl bg-white border p-8 text-center text-sm text-slate-500">No hay documentos obligatorios pendientes para esta obra.</div>}
      </section>}

      {tab==='documents'&&<section className="rounded-2xl bg-white border p-4 sm:p-5 space-y-4 shadow-sm">
        <div>
          <h2 className="text-lg font-black">Documentos de obra</h2>
          <p className="mt-1 text-sm text-slate-600">Este portal utiliza directamente los mismos generadores de Documentación de obra. Inicio y Control de presencia se mantienen aparte en Asignados porque son modelos distintos.</p>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 space-y-4">
          <div>
            <div className="text-base font-black text-slate-900">Documentos principales de la obra</div>
            <p className="mt-1 text-sm text-slate-600">Entrega de EPIs, Formación e información, Autorización de maquinaria y Control horario, con el mismo PDF que genera el supervisor.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm font-black">Documento
              <select value={coreDocType} onChange={e=>setCoreDocType(e.target.value as CoreWorksiteDocumentType)} className="mt-2 min-h-[52px] w-full rounded-xl border px-3 py-3 text-base font-semibold bg-white">
                {(Object.entries(CORE_WORKSITE_DOCUMENTS) as [CoreWorksiteDocumentType,string][]).map(([key,label])=><option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-black">Periodo
              <select value={documentPeriod} onChange={e=>setDocumentPeriod(e.target.value)} className="mt-2 min-h-[52px] w-full rounded-xl border px-3 py-3 text-base font-semibold bg-white">
                <option value="">Todos los trabajadores de la obra</option>
                {availablePeriods.map(period=><option key={period} value={period}>{period}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-sm font-black">Fecha del documento
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} className="mt-2 min-h-[52px] w-full rounded-xl border px-3 py-3 text-base bg-white"/>
          </label>

          {coreDocType==='epis'&&<div>
            <div className="mb-2 text-sm font-black">EPIs incluidos</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries({casco:'Casco',chaleco:'Chaleco',orejeras:'Orejeras',gafas:'Gafas',guantes:'Guantes',mascarillas:'Mascarillas',calzado:'Calzado'}).map(([key,label])=><label key={key} className="flex items-center gap-2 rounded-xl border bg-white p-3 text-sm font-bold">
                <input type="checkbox" checked={epiSelection[key]!==false} onChange={e=>setEpiSelection(current=>({...current,[key]:e.target.checked}))}/>
                {label}
              </label>)}
            </div>
          </div>}

          {coreDocType==='formacion'&&<div className="grid sm:grid-cols-[1fr_180px] gap-3">
            <label className="block text-sm font-black">Acción formativa / información
              <textarea rows={4} value={trainingAction} onChange={e=>setTrainingAction(e.target.value)} className="mt-2 w-full rounded-xl border px-3 py-3 text-base bg-white"/>
            </label>
            <label className="block text-sm font-black">Duración
              <input value={trainingDuration} onChange={e=>setTrainingDuration(e.target.value)} className="mt-2 min-h-[52px] w-full rounded-xl border px-3 py-3 text-base bg-white"/>
            </label>
          </div>}

          {coreDocType==='maquinaria'&&<div className="space-y-3">
            <label className="block text-sm font-black">Maquinaria o equipos para aplicar a todos
              <textarea rows={3} value={globalMachinery} onChange={e=>setGlobalMachinery(e.target.value)} placeholder="Ej.: Dumper, hormigonera, radial…" className="mt-2 w-full rounded-xl border px-3 py-3 text-base bg-white"/>
            </label>
            <button type="button" onClick={()=>setMachineryByWorker(Object.fromEntries(documentWorkers.map(worker=>[String(worker.id),globalMachinery])))} className="rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-black text-amber-900">Aplicar a todos</button>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {documentWorkers.map(worker=><div key={worker.id} className="grid sm:grid-cols-[1fr_1.2fr] gap-2 rounded-xl border bg-white p-3">
                <div><div className="text-sm font-black">{worker.apellidosNombre}</div><div className="text-xs text-slate-500">{worker.dni} · {worker.categoria}</div></div>
                <input value={machineryByWorker[String(worker.id)]||''} onChange={e=>setMachineryByWorker(current=>({...current,[String(worker.id)]:e.target.value}))} placeholder="Máquinas separadas por coma" className="min-h-[46px] rounded-xl border px-3 py-2"/>
              </div>)}
            </div>
          </div>}

          <button type="button" onClick={generateCoreDocument} className="min-h-[56px] w-full rounded-2xl bg-[#00548E] px-4 py-3.5 text-base font-black text-white">
            <FileDown className="mr-2 inline h-5 w-5"/>Generar PDF {CORE_WORKSITE_DOCUMENTS[coreDocType]}
          </button>
        </div>

        {data.documents.some(d=>d.correctionPending)&&<div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 space-y-3">
          <div>
            <div className="text-base font-black text-amber-900">Correcciones solicitadas por el supervisor</div>
            <p className="mt-1 text-sm text-amber-800">Estos documentos están desbloqueados únicamente para que hagas la corrección indicada y los vuelvas a enviar.</p>
          </div>
          {data.documents.filter(d=>d.correctionPending).map(d=><button
            key={d.id}
            type="button"
            onClick={()=>{
              setCorrectionDocumentId(String(d.id));
              setDocType(d.documentType as AdditionalWorksiteDocumentType);
              setWorkerId(Number(d.workerId||'')||'');
              setDate(String(d.workDate).slice(0,10));
              setAnswers(d.answers||{});
              setDocSignatures(d.signatures||{});
            }}
            className="w-full rounded-xl border border-amber-300 bg-white p-3 text-left"
          >
            <div className="font-black">{ADDITIONAL_WORKSITE_DOCUMENTS[d.documentType as AdditionalWorksiteDocumentType]?.short||d.documentType}</div>
            <div className="mt-1 text-xs text-slate-500">{d.workerSnapshot?.apellidosNombre||'Trabajador'} · {String(d.workDate).slice(0,10)}</div>
            <div className="mt-2 text-sm font-semibold text-amber-900">Motivo: {d.correctionReason||'Revisar documento'}</div>
          </button>)}
        </div>}

        <div className="border-t pt-4">
          <div className="text-base font-black">Otros documentos de obra</div>
          <p className="mt-1 text-sm text-slate-600">Son los mismos modelos de “Otros documentos” disponibles en Documentación de obra. Se cumplimentan con sus campos originales y usan el mismo generador PDF.</p>
        </div>
        <label className="block text-sm font-black">Documento
          <select value={docType} onChange={e=>{setDocType(e.target.value as AdditionalWorksiteDocumentType);setAnswers({});setDocSignatures({});setCorrectionDocumentId('');}} className="mt-2 min-h-[52px] w-full rounded-xl border px-3 py-3 text-base font-semibold bg-white">
            {Object.entries(ADDITIONAL_WORKSITE_DOCUMENTS).map(([key,d])=><option key={key} value={key}>{d.short}</option>)}
          </select>
        </label>
        <label className="block text-sm font-black">Trabajador
          <select value={workerId} onChange={e=>setWorkerId(e.target.value?Number(e.target.value):'')} className="mt-2 min-h-[52px] w-full rounded-xl border px-3 py-3 text-base font-semibold bg-white">
            <option value="">Seleccionar trabajador…</option>
            {data.workers.map(w=><option key={w.id} value={w.id}>{w.apellidosNombre} · {w.dni}</option>)}
          </select>
        </label>
        <label className="block text-sm font-black">Fecha
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} className="mt-2 min-h-[52px] w-full rounded-xl border px-3 py-3 text-base bg-white"/>
        </label>
        {def.fields.map(field=><label key={field.key} className="block text-sm font-black">{field.label}
          {field.type==='textarea'
            ? <textarea rows={4} value={answers[field.key]||''} onChange={e=>setAnswers(a=>({...a,[field.key]:e.target.value}))} className="mt-2 w-full rounded-xl border px-3 py-3 text-base font-normal"/>
            : field.type==='select'
              ? <select value={answers[field.key]||''} onChange={e=>setAnswers(a=>({...a,[field.key]:e.target.value}))} className="mt-2 min-h-[52px] w-full rounded-xl border px-3 py-3 text-base font-normal bg-white"><option value="">Seleccionar…</option>{field.options?.map(o=><option key={o}>{o}</option>)}</select>
              : <input type={field.type||'text'} value={answers[field.key]||''} onChange={e=>setAnswers(a=>({...a,[field.key]:e.target.value}))} className="mt-2 min-h-[52px] w-full rounded-xl border px-3 py-3 text-base font-normal bg-white"/>
          }
        </label>)}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {def.signatureWorker&&<button onClick={()=>setDocSigning('worker')} className={`min-h-[54px] rounded-2xl border px-4 py-3 text-base font-black touch-manipulation ${docSignatures.worker?'bg-emerald-50 border-emerald-300 text-emerald-800':'bg-white'}`}>Firma trabajador {docSignatures.worker?'✓':''}</button>}
          <button onClick={()=>setDocSigning('foreman')} className={`min-h-[54px] rounded-2xl border px-4 py-3 text-base font-black touch-manipulation ${docSignatures.foreman?'bg-emerald-50 border-emerald-300 text-emerald-800':'bg-white'}`}>Firma encargado {docSignatures.foreman?'✓':''}</button>
        </div>
        {correctionDocumentId&&<div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm font-black text-amber-900">Estás corrigiendo un documento devuelto por el supervisor.</div>}
        <button type="button" onClick={generateAdditionalPdf} className="min-h-[54px] w-full rounded-2xl border-2 border-[#00548E] bg-white px-4 py-3 text-base font-black text-[#00548E]">
          <FileDown className="mr-2 inline h-5 w-5"/>Generar PDF exactamente como Documentación de obra
        </button>
        <button
          onClick={async()=>{
            if(!selectedWorker)return alert('Selecciona un trabajador.');
            const missing=def.fields.filter(f=>f.required&&!String(answers[f.key]||'').trim());
            if(missing.length)return alert('Completa: '+missing.map(f=>f.label).join(', '));
            if(def.signatureWorker&&!docSignatures.worker)return alert('Falta la firma del trabajador.');
            if(!docSignatures.foreman)return alert('Falta la firma del encargado.');
            setSaving(true);
            try{
              if(correctionDocumentId){
                await resubmitForemanDocument({token,documentId:correctionDocumentId,answers,signatures:docSignatures});
              }else{
                await submitForemanDocument({token,documentType:docType,workDate:date,workerId:Number(selectedWorker.id),answers,signatures:docSignatures});
              }
              setAnswers({});setDocSignatures({});setWorkerId('');setCorrectionDocumentId('');
              await refresh();setTab('completed');
            }finally{setSaving(false);}
          }}
          disabled={saving}
          className="min-h-[58px] w-full rounded-2xl bg-[#00548E] px-4 py-4 text-base font-black text-white touch-manipulation disabled:opacity-50"
        >
          {saving?'Guardando…':'Finalizar y enviar al supervisor'}
        </button>
      </section>}

      {tab==='completed'&&<section className="space-y-3">
        <button onClick={()=>void refresh()} className="min-h-[48px] inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-3 text-sm font-black touch-manipulation"><RefreshCw className="w-4 h-4"/>Actualizar</button>
        {assignedMandatoryDocuments.filter(d=>d.status==='completed'||d.status==='reviewed').map(d=><div key={'m-'+d.id} className="rounded-2xl bg-white border p-4 shadow-sm"><div className="text-base font-black">{mandatoryLabel(d.documentType)}</div><div className="mt-1 text-sm text-slate-500">{String(d.workDate).slice(0,10)}{d.category?' · '+d.category:''}</div><span className="mt-3 inline-flex rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-black text-emerald-700">{d.status==='reviewed'?'Revisado por el supervisor':'Enviado al supervisor'}</span></div>)}
        {data.documents.filter(d=>!d.correctionPending&&d.status!=='draft').map(d=><div key={'d-'+d.id} className="rounded-2xl bg-white border p-4 shadow-sm"><div className="text-base font-black">{ADDITIONAL_WORKSITE_DOCUMENTS[d.documentType as AdditionalWorksiteDocumentType]?.short||d.documentType}</div><div className="mt-1 text-sm text-slate-500">{d.workerSnapshot?.apellidosNombre||'Trabajador'} · {String(d.workDate).slice(0,10)}</div><span className="mt-3 inline-flex rounded-full bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs font-black text-blue-800">Enviado al supervisor</span></div>)}
        {!assignedMandatoryDocuments.some(d=>d.status==='completed'||d.status==='reviewed')&&!data.documents.length&&<div className="rounded-2xl bg-white border p-8 text-center text-base text-slate-500">Todavía no hay documentos finalizados.</div>}
      </section>}
    </main>
    {signing&&<SignaturePad title={`Firma de ${signing.kind==='entry'?'entrada':'salida'}`} onSave={img=>void applySignature(img)} onCancel={()=>setSigning(null)}/>}
    {docSigning&&<SignaturePad title={docSigning==='worker'?'Firma del trabajador':'Firma del encargado'} onSave={img=>{setDocSignatures(s=>({...s,[docSigning]:img}));setDocSigning(null);}} onCancel={()=>setDocSigning(null)}/>}
    {mandatorySigning&&<SignaturePad title={'Firma de '+mandatorySigning.name} onSave={async img=>{const current=mandatorySigning;setMandatorySigning(null);setSaving(true);try{await signMandatoryForemanDocument(token,current.documentId,current.workerId,img);await refresh();}finally{setSaving(false);}}} onCancel={()=>setMandatorySigning(null)}/>}
  </div>;
};
