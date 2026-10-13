import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ModalPortal from './ModalPortal';
import { PreventionSection } from './PreventionSection';
import { appAlert, appConfirm } from '../src/lib/appDialog';
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Download, FileDown, FileSignature, GraduationCap, HardHat, Loader2, LogIn, LogOut, Maximize2, RefreshCw, RotateCcw, Save, Share2, ShieldCheck, Smartphone, Trash2, Wrench } from 'lucide-react';
import {
  ADDITIONAL_WORKSITE_DOCUMENTS,
  type AdditionalWorksiteDocumentType,
} from '../src/lib/worksiteAdditionalDocumentsCatalog';
import type { WorksiteDocumentContext } from '../src/lib/worksiteDocumentsPdf';
import {
  resolveForemanPortal,
  saveForemanAttendance,
  signForemanAttendance,
  submitForemanDocument,
  signMandatoryForemanDocument,
  finalizeForemanMandatoryDocument,
  correctForemanMandatoryWorkerName,
  getForemanMandatoryPdf,
  getForemanMandatorySignatures,
  repairForemanMandatoryAnchors,
  removeForemanMandatoryWorker,
  storeForemanMandatorySignedPdf,
  createForemanOperationalDocument,
  resubmitForemanDocument,
  type ForemanAttendanceRow,
  type ForemanMandatoryDocument,
  type ForemanPortalPayload,
} from '../src/services/foremanPortalService';
import { revokeMandatorySignatureV2, signMandatoryDocumentWorkerV2, submitMandatoryDocumentV2 } from '../src/services/mandatoryTraceabilityServiceV2';
import {
  analyzeMandatoryOriginalPdf,
  resolveMandatoryAnchorsWithOcrRows,
  base64ToBytes,
  buildSignedMandatoryPdf,
  bytesToBase64,
  sha256Hex,
  verifyMandatoryPdfFidelity,
  type MandatoryWorkerAnchor,
} from '../src/lib/mandatoryPdfOverlay';

const today = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const nowTime = () => new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const DEFAULT_EPIS = { casco:true, chaleco:true, orejeras:true, gafas:true, guantes:true, mascarillas:true, calzado:true };
const FOREMAN_DEVICE_TOKEN_KEY = 'pfea_foreman_device_token_v1';
const isStandaloneDisplay = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);
const isIosDevice = () => {
  const ua = navigator.userAgent.toLowerCase();
  const platform = String(navigator.platform || '').toLowerCase();
  return /iphone|ipad|ipod/.test(ua) || (platform.includes('mac') && navigator.maxTouchPoints > 1);
};
const isAndroidDevice = () => /android/i.test(navigator.userAgent);


const SignaturePad: React.FC<{ title: string; onSave: (data: string) => void; onCancel: () => void }> = ({ title, onSave, onCancel }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{x:number;y:number}|null>(null);
  useEffect(() => {
    const canvas=ref.current; if(!canvas) return;
    const rect=canvas.getBoundingClientRect(); const ratio=Math.min(1.5,Math.max(1,window.devicePixelRatio||1));
    canvas.width=Math.floor(rect.width*ratio); canvas.height=Math.floor(rect.height*ratio);
    const ctx=canvas.getContext('2d',{alpha:true}); if(!ctx) return;
    ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,rect.width,rect.height);
    ctx.strokeStyle='#111827'; ctx.lineWidth=2.4; ctx.lineCap='round'; ctx.lineJoin='round';
  },[]);
  const point=(e:React.PointerEvent<HTMLCanvasElement>)=>{const r=e.currentTarget.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
  const exportSignature = () => {
    const canvas=ref.current;
    const ctx=canvas?.getContext('2d');
    if(!canvas||!ctx)return;
    const image=ctx.getImageData(0,0,canvas.width,canvas.height);
    let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
    for(let y=0;y<canvas.height;y+=2){
      for(let x=0;x<canvas.width;x+=2){
        const i=(y*canvas.width+x)*4;
        if(image.data[i+3]>20){
          minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
        }
      }
    }
    if(maxX<0||maxY<0){
      void appAlert('Realiza la firma antes de guardarla.', { title:'Firma pendiente', kind:'warning' });
      return;
    }
    const pad=14;
    minX=Math.max(0,minX-pad);minY=Math.max(0,minY-pad);
    maxX=Math.min(canvas.width-1,maxX+pad);maxY=Math.min(canvas.height-1,maxY+pad);
    const sourceW=Math.max(1,maxX-minX+1),sourceH=Math.max(1,maxY-minY+1);
    const maxW=720,maxH=260,scale=Math.min(1,maxW/sourceW,maxH/sourceH);
    const out=document.createElement('canvas');
    out.width=Math.max(1,Math.round(sourceW*scale));
    out.height=Math.max(1,Math.round(sourceH*scale));
    const outCtx=out.getContext('2d',{alpha:true});
    if(!outCtx)return;
    outCtx.clearRect(0,0,out.width,out.height);
    outCtx.drawImage(canvas,minX,minY,sourceW,sourceH,0,0,out.width,out.height);

    // Garantía adicional: la firma se exporta sin fondo. La superficie blanca
    // del recuadro es solo visual y cualquier píxel claro residual se hace transparente.
    const exported=outCtx.getImageData(0,0,out.width,out.height);
    for(let i=0;i<exported.data.length;i+=4){
      const r=exported.data[i],g=exported.data[i+1],b=exported.data[i+2],a=exported.data[i+3];
      if(a>0&&r>=245&&g>=245&&b>=245)exported.data[i+3]=0;
    }
    outCtx.putImageData(exported,0,0);
    onSave(out.toDataURL('image/png'));
  };
  return <ModalPortal label={title}><div className="fixed inset-0 bg-slate-950/70 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{paddingTop:'env(safe-area-inset-top)'}}>
    <div className="w-full max-w-lg rounded-t-3xl bg-white p-4 text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-slate-50 sm:rounded-3xl sm:p-6" style={{paddingBottom:'max(16px, env(safe-area-inset-bottom))'}}>
      <h3 className="text-lg font-black text-slate-900 dark:text-slate-50">{title}</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Firma con el dedo dentro del recuadro.</p>
      <canvas ref={ref} className="mt-4 w-full h-[240px] sm:h-[280px] touch-none rounded-2xl border-2 border-slate-300 bg-white"
        onPointerDown={e=>{e.preventDefault();drawing.current=true;last.current=point(e);e.currentTarget.setPointerCapture?.(e.pointerId)}}
        onPointerMove={e=>{if(!drawing.current||!last.current)return;e.preventDefault();const ctx=e.currentTarget.getContext('2d');if(!ctx)return;const n=point(e);ctx.beginPath();ctx.moveTo(last.current.x,last.current.y);ctx.lineTo(n.x,n.y);ctx.stroke();last.current=n}}
        onPointerUp={e=>{drawing.current=false;last.current=null;e.currentTarget.releasePointerCapture?.(e.pointerId)}}
        onPointerCancel={()=>{drawing.current=false;last.current=null}}
        onLostPointerCapture={()=>{drawing.current=false;last.current=null}}/>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button onClick={()=>{const c=ref.current,ctx=c?.getContext('2d');if(c&&ctx){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,c.width,c.height);ctx.restore();}}} className="min-h-[52px] rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-50"><RotateCcw className="inline w-4 h-4 mr-1"/>Borrar</button>
        <button onClick={onCancel} className="min-h-[52px] rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-50">Cancelar</button>
        <button onClick={exportSignature} className="min-h-[52px] rounded-xl bg-[#00548E] px-4 py-3 text-base font-black text-white">Guardar</button>
      </div>
    </div>
  </div></ModalPortal>;
};

const PdfCanvasPreview: React.FC<{ bytes: Uint8Array; title: string; notice?: string; onClose: () => void }> = ({ bytes, title, notice, onClose }) => {
  const hostRef=useRef<HTMLDivElement>(null);
  const [renderError,setRenderError]=useState('');
  const [rendering,setRendering]=useState(true);

  useEffect(()=>{
    let cancelled=false;
    let pdf:any=null;
    (async()=>{
      try{
        setRendering(true);
        setRenderError('');
        const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
        const workerModule=await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
        if(!pdfjs.GlobalWorkerOptions.workerSrc)pdfjs.GlobalWorkerOptions.workerSrc=workerModule.default;
        pdf=await pdfjs.getDocument({data:bytes.slice(),useSystemFonts:true}).promise;
        const host=hostRef.current;
        if(!host||cancelled)return;
        host.innerHTML='';
        for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber+=1){
          if(cancelled)return;
          const page=await pdf.getPage(pageNumber);
          const base=page.getViewport({scale:1});
          const available=Math.max(280,Math.min(window.innerWidth-24,900));
          const scale=Math.min(2,available/base.width);
          const viewport=page.getViewport({scale});
          const canvas=document.createElement('canvas');
          canvas.width=Math.ceil(viewport.width);
          canvas.height=Math.ceil(viewport.height);
          canvas.style.width='100%';
          canvas.style.height='auto';
          canvas.style.display='block';
          canvas.style.background='#fff';
          canvas.style.boxShadow='0 8px 24px rgba(15,23,42,.12)';
          canvas.style.borderRadius='8px';
          const wrapper=document.createElement('div');
          wrapper.style.marginBottom='12px';
          wrapper.appendChild(canvas);
          host.appendChild(wrapper);
          const ctx=canvas.getContext('2d');
          if(!ctx)throw new Error('No se pudo preparar la vista del PDF.');
          await page.render({canvas,canvasContext:ctx,viewport}).promise;
        }
      }catch(e:any){
        if(!cancelled)setRenderError(e?.message||'No se pudo mostrar el PDF.');
      }finally{
        if(!cancelled)setRendering(false);
      }
    })();
    return()=>{cancelled=true;try{pdf?.destroy?.();}catch{}};
  },[bytes]);

  return <ModalPortal label={title}><div className="fixed inset-0 flex h-[100dvh] w-screen flex-col bg-slate-950">
    <div className="flex items-center justify-between gap-3 bg-white px-4 py-3 dark:bg-slate-900" style={{paddingTop:'max(12px, env(safe-area-inset-top))'}}>
      <div className="min-w-0">
        <div className="truncate text-sm font-black text-slate-900 dark:text-slate-50">{title}</div>
        <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-300"><Maximize2 className="h-3.5 w-3.5"/>Pantalla completa · PDF real</div>
      </div>
      <button type="button" onClick={onClose} className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-50">Cerrar</button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-900 p-0 sm:p-3" style={{paddingBottom:'max(16px, env(safe-area-inset-bottom))',WebkitOverflowScrolling:'touch'}}>
      {notice&&<div className="mx-auto mb-3 max-w-[900px] rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold leading-5 text-amber-900 dark:border-amber-700 dark:bg-amber-950/80 dark:text-amber-50">{notice}</div>}
      {rendering&&<div className="mx-auto mt-8 max-w-md rounded-2xl bg-white p-5 text-center text-sm font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">Cargando PDF…</div>}
      {renderError&&<div className="mx-auto mt-8 max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800 dark:border-rose-700 dark:bg-rose-950/80 dark:text-rose-100">{renderError}</div>}
      <div ref={hostRef} className="mx-auto w-full max-w-none sm:max-w-[900px]" />
    </div>
  </div></ModalPortal>;
};

export const ForemanMobilePortal: React.FC<{ token: string }> = ({ token }) => {
  const [data,setData]=useState<ForemanPortalPayload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [tab,setTab]=useState<'mandatory'|'epis'|'formacion'|'maquinaria'|'control'|'documents'|'completed'|'prevention'>('mandatory');
  const [date,setDate]=useState(today());
  const [rows,setRows]=useState<ForemanAttendanceRow[]>([]);
  const [signing,setSigning]=useState<{workerId:number;kind:'entry'|'exit'}|null>(null);
  const [saving,setSaving]=useState(false);
  const [selectedPeriodKeys,setSelectedPeriodKeys]=useState<Set<string>>(new Set());
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
  const [mandatorySigning,setMandatorySigning]=useState<{documentId:string;workerId:number;documentWorkerId?:string;name:string}|null>(null);
  const [mandatoryWorkerChoice,setMandatoryWorkerChoice]=useState<Record<string,string>>({});
  const [installPromptAvailable,setInstallPromptAvailable]=useState(Boolean(window.__profeaInstallPrompt));
  const [installHelpVisible,setInstallHelpVisible]=useState(false);
  const [installedStandalone,setInstalledStandalone]=useState(isStandaloneDisplay());
  const [pdfPreview,setPdfPreview]=useState<{bytes:Uint8Array;title:string;notice?:string}|null>(null);
  const [operationFeedback,setOperationFeedback]=useState('');
  const [focusDocumentId,setFocusDocumentId]=useState('');
  const [selectedMandatoryPeriodKeys,setSelectedMandatoryPeriodKeys]=useState<Set<string>>(new Set());
  const [expandedMandatoryDocuments,setExpandedMandatoryDocuments]=useState<Set<string>>(new Set());
  const [mandatorySignatureImages,setMandatorySignatureImages]=useState<Record<string,Record<string,string>>>({});
  const [nameCorrection,setNameCorrection]=useState<{documentId:string;workerId:number;value:string}|null>(null);

  const [refreshingDocuments,setRefreshingDocuments]=useState(false);
  const [documentsUpdatedAt,setDocumentsUpdatedAt]=useState('');
  const lastPortalRefreshRef=useRef(0);
  const refreshInFlightRef=useRef<Promise<void>|null>(null);
  const hasDataRef=useRef(false);
  useEffect(()=>{hasDataRef.current=Boolean(data);},[data]);
  useEffect(()=>{
    const updatePrompt=()=>setInstallPromptAvailable(Boolean(window.__profeaInstallPrompt));
    const installed=()=>{setInstalledStandalone(true);setInstallPromptAvailable(false);setInstallHelpVisible(false);};
    const media=window.matchMedia('(display-mode: standalone)');
    const mediaChanged=()=>setInstalledStandalone(isStandaloneDisplay());
    window.addEventListener('profea:install-prompt-ready',updatePrompt);
    window.addEventListener('appinstalled',installed);
    media.addEventListener?.('change',mediaChanged);
    return ()=>{
      window.removeEventListener('profea:install-prompt-ready',updatePrompt);
      window.removeEventListener('appinstalled',installed);
      media.removeEventListener?.('change',mediaChanged);
    };
  },[]);

  const installForemanApp=async()=>{
    const prompt=window.__profeaInstallPrompt;
    if(prompt){
      try{
        await prompt.prompt();
        const choice=await prompt.userChoice;
        delete window.__profeaInstallPrompt;
        setInstallPromptAvailable(false);
        if(choice.outcome==='accepted')setInstalledStandalone(true);
        else setInstallHelpVisible(true);
        return;
      }catch{
        setInstallHelpVisible(true);
        return;
      }
    }
    setInstallHelpVisible(true);
  };

  const unlinkForemanDevice=async()=>{
    const ok=await appConfirm('¿Desvincular este dispositivo del portal de encargados?', {
      title:'Desvincular dispositivo',
      confirmLabel:'Desvincular',
    });
    if(!ok)return;
    try{localStorage.removeItem(FOREMAN_DEVICE_TOKEN_KEY);}catch{}
    try{document.cookie=`${FOREMAN_DEVICE_TOKEN_KEY}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;}catch{}
    window.location.href='/';
  };

  const refresh=useCallback(async()=>{
    if(refreshInFlightRef.current)return refreshInFlightRef.current;
    const task=(async()=>{
      if(!hasDataRef.current)setLoading(true);
      setError('');
      setRefreshingDocuments(true);
      try{
        const next=await resolveForemanPortal(token);
        if(!next.valid)throw new Error('Este acceso no es válido o ha sido revocado.');
        setData(next);
        lastPortalRefreshRef.current=Date.now();
        setDocumentsUpdatedAt(new Date().toLocaleTimeString('es-ES'));
      }catch(e:any){
        setError(e?.message||'No se pudo actualizar la documentación de la obra.');
      }finally{
        setLoading(false);
        setRefreshingDocuments(false);
        refreshInFlightRef.current=null;
      }
    })();
    refreshInFlightRef.current=task;
    return task;
  },[token]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    const resume=()=>{
      if(document.visibilityState==='hidden'||navigator.onLine===false||Date.now()-lastPortalRefreshRef.current<30_000)return;
      void refresh();
    };
    document.addEventListener('visibilitychange',resume);
    window.addEventListener('online',resume);
    return()=>{document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);};
  },[refresh]);

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
      periodoInicio:w.periodoInicio || '',
      periodoFin:w.periodoFin || '',
      numOferta:w.numOferta || '',
      municipio:data.worksite?.municipio || '',
      empresa:data.worksite?.empresa || 'Diputación Provincial de Cádiz',
      codigoObra:data.worksite?.codigo || '',
    })));
  },[data,date]);

  const persist=async(nextRows:ForemanAttendanceRow[],status:'draft'|'completed'='draft')=>{
    setSaving(true);
    try{
      await saveForemanAttendance(token,date,nextRows,status);
      setRows(nextRows);
      setError('');
      if(status==='completed')await refresh();
    }catch(e:any){
      setError(e?.message||'No se pudo guardar la jornada.');
    }finally{
      setSaving(false);
    }
  };
  const applySignature=async(image:string)=>{
    if(!signing)return;
    const currentSigning=signing;
    const next=rows.map(r=>r.workerId===currentSigning.workerId?{
      ...r,
      ...(currentSigning.kind==='entry'
        ? {entrySignature:image,entryTime:r.entryTime||data?.defaultWorkStartHour||nowTime()}
        : {exitSignature:image,exitTime:r.exitTime||data?.defaultWorkEndHour||nowTime()})
    }:r);
    setSigning(null);
    setSaving(true);
    try{
      await signForemanAttendance(token,date,next,currentSigning.workerId,currentSigning.kind,image);

      const verified=await resolveForemanPortal(token);
      if(!verified.valid)throw new Error('No se pudo verificar la firma guardada.');

      const savedDay=(verified.attendance||[]).find(item=>String(item.workDate||'').slice(0,10)===date);
      const savedRow=savedDay?.rows?.find(row=>Number(row.workerId)===Number(currentSigning.workerId));
      const signatureKey=currentSigning.kind==='entry'?'entrySignature':'exitSignature';

      if(!savedRow || !(savedRow as any)[signatureKey]){
        throw new Error('La firma no ha quedado guardada en la jornada. Vuelve a intentarlo.');
      }

      setData(verified);
      setRows(savedDay?.rows?.map(row=>({
        ...row,
        entryTime:row.entryTime||verified.defaultWorkStartHour||'08:00',
        exitTime:row.exitTime||verified.defaultWorkEndHour||'15:00',
      }))||next);
      setError('');
    }catch(e:any){
      setError(e?.message||'No se pudo guardar la firma.');
    }finally{
      setSaving(false);
    }
  };
  const def=ADDITIONAL_WORKSITE_DOCUMENTS[docType];
  const selectedWorker=useMemo(()=>data?.workers.find(w=>Number(w.id)===Number(workerId)),[data?.workers,workerId]);
  const monthLabel = (key:string) => {
    const [year,month]=key.split('-');
    const names=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return `${names[Math.max(0,Number(month)-1)]||month} ${year}`;
  };
  const monthsForWorker = (worker:any) => {
    const start=String(worker.periodoInicio||'').slice(0,7);
    const end=String(worker.periodoFin||'').slice(0,7);
    if(!/^\d{4}-\d{2}$/.test(start)) return end ? [end] : [];
    if(!/^\d{4}-\d{2}$/.test(end) || end<start) return [start];
    const result:string[]=[];
    let [year,month]=start.split('-').map(Number);
    const [endYear,endMonth]=end.split('-').map(Number);
    for(let guard=0;guard<24;guard++){
      const key=`${year}-${String(month).padStart(2,'0')}`;
      result.push(key);
      if(year===endYear&&month===endMonth)break;
      month+=1;if(month>12){month=1;year+=1;}
    }
    return result;
  };
  const availableQuincenas=useMemo<string[]>(()=>Array.from(new Set<string>((data?.workers||[]).map(worker=>String(worker.quincena||'').trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'es',{numeric:true})),[data?.workers]);
  const availableMonths=useMemo(()=>Array.from(new Set((data?.workers||[]).flatMap(worker=>monthsForWorker(worker)))).sort(),[data?.workers]);
  const togglePeriodKey=(key:string)=>setSelectedPeriodKeys(current=>{
    const next=new Set(current);
    if(next.has(key))next.delete(key);else next.add(key);
    return next;
  });
  const documentWorkers = useMemo(()=>{
    const workers=data?.workers||[];
    if(!selectedPeriodKeys.size)return [];
    return workers.filter(worker=>{
      const q=String(worker.quincena||'').trim();
      if(q&&selectedPeriodKeys.has('q:'+q))return true;
      return monthsForWorker(worker).some(month=>selectedPeriodKeys.has('m:'+month));
    });
  },[data?.workers,selectedPeriodKeys]);
  const selectedWorkerIds=useMemo(()=>new Set(documentWorkers.map(worker=>Number(worker.id))),[documentWorkers]);
  useEffect(()=>{
    if(workerId!=='' && !documentWorkers.some(worker=>Number(worker.id)===Number(workerId))){
      setWorkerId('');
    }
  },[documentWorkers,workerId]);
  const controlRows=useMemo(()=>rows.filter(row=>selectedWorkerIds.has(Number(row.workerId))),[rows,selectedWorkerIds]);
  const periodLabel = selectedPeriodKeys.size
    ? [...selectedPeriodKeys].map(key=>key.startsWith('q:')?key.slice(2):monthLabel(key.slice(2))).join(' + ')
    : 'Selecciona al menos un periodo';
  const worksiteContext: WorksiteDocumentContext = {
    obra: data?.obra || '',
    municipio: data?.worksite?.municipio || '',
    empresa: data?.worksite?.empresa || '',
    cif: data?.worksite?.cif || '',
    recursoPreventivo: data?.worksite?.recursoPreventivo || data?.foremanName || '',
    fecha: date,
    periodoLabel: periodLabel,
    accionFormativa: trainingAction,
    duracionFormacion: trainingDuration,
    epis: epiSelection,
    maquinariaPorTrabajador: machineryByWorker,
  };
  const prepareOperationalDocument=async(type:'epis'|'formacion'|'autorizacion_uso_maquinaria')=>{
    if(!documentWorkers.length){setError('Selecciona al menos un periodo con trabajadores.');return;}
    if(type==='autorizacion_uso_maquinaria' && documentWorkers.some(worker=>!String(machineryByWorker[String(worker.id)]||'').trim())){
      setError('Indica la maquinaria o equipos autorizados para todos los trabajadores seleccionados.');return;
    }
    setSaving(true);
    setOperationFeedback('');
    try{
      const createdId=String(await createForemanOperationalDocument({
        token,
        documentType:type,
        workDate:date,
        workerIds:documentWorkers.map(worker=>Number(worker.id)).filter(Number.isFinite),
        details:{
          periodoLabel:periodLabel,
          municipio:data?.worksite?.municipio||'',
          empresa:data?.worksite?.empresa||'',
          cif:data?.worksite?.cif||'',
          recursoPreventivo:data?.worksite?.recursoPreventivo||data?.foremanName||'',
          epis:epiSelection,
          accionFormativa:trainingAction,
          duracionFormacion:trainingDuration,
          maquinariaPorTrabajador:machineryByWorker,
        },
      })||'').trim();
      await refresh();
      setError('');
      setOperationFeedback(type==='formacion'
        ? 'Relación de Formación preparada. Debajo tienes los trabajadores para firmar.'
        : 'Documento preparado correctamente para recoger firmas.');
      if(createdId){
        setFocusDocumentId(createdId);
        window.setTimeout(()=>document.getElementById('foreman-signing-'+createdId)?.scrollIntoView({behavior:'smooth',block:'start'}),120);
      }
    }catch(e:any){
      const message=e?.message||'No se pudo preparar el documento para firmas.';
      setError(message);
      setOperationFeedback(message);

    }finally{
      setSaving(false);
    }
  };
  const operationalDocumentsFor=(type:'epis'|'formacion'|'maquinaria')=>{
    const accepted=type==='maquinaria'?['maquinaria','autorizacion_uso_maquinaria']:[type];
    return (data?.mandatoryDocuments||[]).filter(doc=>accepted.includes(String(doc.documentType)));
  };
  const generateAdditionalPdf = async () => {
    if (!selectedWorker) {setError('Selecciona un trabajador.');return;}
    setSaving(true);
    try {
      const { generateAdditionalWorksiteDocument } = await import('../src/lib/worksiteAdditionalDocumentsPdf');
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
      out.doc.save(out.filename);
    } catch (e:any) {
      setError(e?.message||'No se pudo generar el PDF.');
    } finally {
      setSaving(false);
    }
  };
  const mandatoryLabel=(type:string)=>({
    inicio:'Inicio / incorporación',
    control_presencia:'Control de presencia',
    epis:'Entrega de EPIs',
    formacion:'Formación e información',
    maquinaria:'Autorización de maquinaria',
    autorizacion_uso_maquinaria:'Autorización al uso de maquinaria',
  } as Record<string,string>)[type]||type;

  const showPdfPreview=(bytes:Uint8Array,title:string,notice?:string)=>{
    setPdfPreview({bytes,title,notice});
  };

  const closePdfPreview=()=>setPdfPreview(null);

  const completedPdfFileName=(doc:ForemanMandatoryDocument,sourceName?:string)=>{
    const fallback=`${mandatoryLabel(doc.documentType)}-${String(doc.workDate||'').slice(0,10)||'documento'}.pdf`;
    const raw=String(sourceName||doc.details?.sourceFilename||fallback).trim()||fallback;
    const base=/\.pdf$/i.test(raw)?raw:raw+'.pdf';
    return base.replace(/[\\/:*?"<>|]+/g,'-');
  };

  const getCompletedMandatoryPdf=async(doc:ForemanMandatoryDocument)=>{
    const source=await getForemanMandatoryPdf(token,doc.id,'signed');
    if(!source?.base64){
      throw new Error('No se ha encontrado el PDF firmado de este documento.');
    }
    return {
      bytes:base64ToBytes(source.base64),
      filename:completedPdfFileName(doc,source.filename),
    };
  };

  const previewCompletedMandatoryPdf=async(doc:ForemanMandatoryDocument)=>{
    setSaving(true);
    setOperationFeedback('');
    try{
      const file=await getCompletedMandatoryPdf(doc);
      showPdfPreview(file.bytes,`${mandatoryLabel(doc.documentType)} · PDF firmado`);
      setError('');
    }catch(e:any){
      const message=e?.message||'No se pudo abrir el PDF firmado.';
      setError(message);
      await appAlert(message,{title:'No se pudo abrir el PDF firmado',kind:'error'});
    }finally{
      setSaving(false);
    }
  };

  const shareCompletedMandatoryPdf=async(doc:ForemanMandatoryDocument)=>{
    setSaving(true);
    setOperationFeedback('');
    try{
      const fileData=await getCompletedMandatoryPdf(doc);
      const blob=new Blob([fileData.bytes],{type:'application/pdf'});
      const file=new File([blob],fileData.filename,{type:'application/pdf'});
      const nav=navigator as Navigator & {canShare?:(data:ShareData)=>boolean};

      if(typeof navigator.share==='function' && (!nav.canShare || nav.canShare({files:[file]}))){
        await navigator.share({
          title:mandatoryLabel(doc.documentType),
          text:`Documento firmado · ${data?.obra||''}`,
          files:[file],
        });
        setOperationFeedback('PDF compartido correctamente.');
        return;
      }

      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;
      a.download=fileData.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1500);
      setOperationFeedback('Este dispositivo no permite compartir archivos directamente. Se ha descargado el PDF firmado.');
    }catch(e:any){
      if(e?.name==='AbortError')return;
      const message=e?.message||'No se pudo compartir el PDF firmado.';
      setError(message);
      await appAlert(message,{title:'No se pudo compartir el PDF firmado',kind:'error'});
    }finally{
      setSaving(false);
    }
  };

  const assertStoredOriginalIntegrity=async(source:{base64:string;sha256?:string})=>{
    const expected=String(source.sha256||'').trim().toLowerCase();
    if(!expected)return;
    const actual=(await sha256Hex(base64ToBytes(source.base64))).toLowerCase();
    if(actual!==expected){
      throw new Error('El PDF original almacenado no coincide con el archivo importado. Se ha bloqueado la firma para proteger el documento.');
    }
  };

  const buildExactSignedPreview=async(doc:ForemanMandatoryDocument, verify=false)=>{
    const [source,realSignatures]=await Promise.all([
      getForemanMandatoryPdf(token,doc.id,'original'),
      getForemanMandatorySignatures(token,doc.id),
    ]);
    await assertStoredOriginalIntegrity(source);
    const anchors=(Array.isArray(doc.details?.workerAnchors)?doc.details.workerAnchors:[]) as MandatoryWorkerAnchor[];
    const requiredIds=new Set((Array.isArray(doc.details?.documentWorkersV2)?doc.details.documentWorkersV2:[])
      .filter((worker:any)=>worker.detectionStatus==='CONFIRMED')
      .map((worker:any)=>String(worker.legacyWorkerId)));
    const unresolved=anchors.filter(anchor=>requiredIds.has(String(anchor.workerId))&&(!anchor.resolved||anchor.signatureX==null||anchor.signatureY==null||anchor.signatureWidth==null||anchor.signatureHeight==null));
    if(unresolved.length)throw new Error('El supervisor debe resolver las posiciones de firma antes de continuar.');
    const bytes=await buildSignedMandatoryPdf({originalPdfBase64:source.base64,anchors,signatures:realSignatures||{}});
    const fidelity=verify?await verifyMandatoryPdfFidelity(source.base64,bytes,anchors):null;
    return {source,bytes,fidelity,anchors};
  };

  const previewMandatoryPdf=async(doc:ForemanMandatoryDocument,variant:'original'|'signed')=>{
    setSaving(true);
    setOperationFeedback('');
    try{
      if(variant==='original'){
        const source=await getForemanMandatoryPdf(token,doc.id,'original');
        await assertStoredOriginalIntegrity(source);
        showPdfPreview(base64ToBytes(source.base64),`${mandatoryLabel(doc.documentType)} · Original`);
      }else{
        const prepared=await buildExactSignedPreview(doc,false);
        showPdfPreview(prepared.bytes,`${mandatoryLabel(doc.documentType)} · Previsualización firmada`);
      }
      setError('');
    }catch(e:any){
      const message=e?.message||'No se pudo abrir el PDF.';
      setError(message);
      setOperationFeedback(message);
    }finally{
      setSaving(false);
    }
  };

  const periodDisplayLabel=(doc:ForemanMandatoryDocument)=>{
    const explicit=String(doc.details?.periodoLabel||'').trim();
    if(explicit)return explicit;
    const key=String(doc.periodKey||'').trim();
    const match=key.match(/^(\d{4})-(\d{2})-(1Q|2Q)$/i);
    if(match){
      const monthNames=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      const month=monthNames[Math.max(0,Number(match[2])-1)]||match[2];
      return `${match[3].toUpperCase()==='1Q'?'1ª quincena':'2ª quincena'} · ${month} ${match[1]}`;
    }
    const date=String(doc.workDate||'').slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(date)){
      const [year,month,day]=date.split('-');
      const monthNames=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      return `${Number(day)<=15?'1ª quincena':'2ª quincena'} · ${monthNames[Math.max(0,Number(month)-1)]||month} ${year}`;
    }
    return key||'Sin periodo';
  };

  const allAssignedMandatoryDocuments=(data?.mandatoryDocuments||[]).filter(document=>{
    if(!['inicio','control_presencia'].includes(String(document.documentType||'')))return false;
    const lifecycle=String(document.lifecycleStatus||document.details?.lifecycleStatus||'');
    return !lifecycle || ['ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION','SUBMITTED','RECEIVED','REVIEWED'].includes(lifecycle);
  });

  const mandatoryPeriodOptions=useMemo(()=>{
    const byKey=new Map<string,{key:string;label:string;count:number;latest:number}>();
    for(const doc of allAssignedMandatoryDocuments){
      const key=String(doc.periodKey||doc.workDate||'sin-periodo');
      const current=byKey.get(key);
      const latest=Date.parse(String(doc.workDate||''))||0;
      if(current){
        current.count+=1;
        current.latest=Math.max(current.latest,latest);
      }else{
        byKey.set(key,{key,label:periodDisplayLabel(doc),count:1,latest});
      }
    }
    return [...byKey.values()].sort((a,b)=>b.latest-a.latest||a.label.localeCompare(b.label,'es'));
  },[data?.mandatoryDocuments]);

  const assignedMandatoryDocuments=allAssignedMandatoryDocuments.filter(doc=>
    !selectedMandatoryPeriodKeys.size || selectedMandatoryPeriodKeys.has(String(doc.periodKey||doc.workDate||'sin-periodo'))
  );

  const toggleMandatoryPeriod=(key:string)=>setSelectedMandatoryPeriodKeys(current=>{
    const next=new Set(current);
    if(next.has(key))next.delete(key);else next.add(key);
    return next;
  });

  const loadMandatorySignatureImages=useCallback(async(documentId:string)=>{
    try{
      const real=await getForemanMandatorySignatures(token,documentId);
      const images:Record<string,string>={};
      Object.entries(real||{}).forEach(([workerId,raw])=>{
        const value=typeof raw==='string'?raw:raw?.signature;
        if(typeof value==='string'&&value.startsWith('data:image/'))images[String(workerId)]=value;
      });
      setMandatorySignatureImages(current=>({...current,[documentId]:images}));
    }catch(error){
      console.warn('No se pudieron cargar las miniaturas de firmas.',error);
    }
  },[token]);

  const toggleMandatoryDocument=(id:string)=>setExpandedMandatoryDocuments(current=>{
    const next=new Set(current);
    if(next.has(id)){
      next.delete(id);
    }else{
      next.add(id);
      if(!mandatorySignatureImages[id])void loadMandatorySignatureImages(id);
    }
    return next;
  });

  const assignedByWorksiteAndPeriod=useMemo(()=>{
    const byWorksite=new Map<string,Map<string,ForemanMandatoryDocument[]>>();
    for(const doc of assignedMandatoryDocuments){
      const worksite=String(data?.obra||'Obra asignada').trim()||'Obra asignada';
      const period=periodDisplayLabel(doc);
      if(!byWorksite.has(worksite))byWorksite.set(worksite,new Map());
      const periods=byWorksite.get(worksite)!;
      if(!periods.has(period))periods.set(period,[]);
      periods.get(period)!.push(doc);
    }
    return [...byWorksite.entries()].map(([worksite,periodMap])=>({
      worksite,
      periods:[...periodMap.entries()]
        .map(([period,documents])=>({
          period,
          documents:[...documents].sort((a,b)=>String(b.workDate||'').localeCompare(String(a.workDate||''))),
          latestDate:Math.max(...documents.map(doc=>Date.parse(String(doc.workDate||''))||0)),
        }))
        .sort((a,b)=>b.latestDate-a.latestDate),
    }));
  },[assignedMandatoryDocuments,data?.obra]);

  const renderPeriodSelector=()=> <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-3">
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-base font-black text-slate-900">1. Selecciona el periodo o periodos</div>
        <div className="mt-1 text-sm leading-5 text-slate-600">Elige una o varias quincenas o meses. Hasta que no selecciones un periodo no se mostrará ningún trabajador adicional, evitando mezclar personal de otros periodos.</div>
      </div>
      {selectedPeriodKeys.size>0&&<button type="button" onClick={()=>setSelectedPeriodKeys(new Set())} className="shrink-0 min-h-[48px] rounded-xl border bg-white px-4 py-3 text-sm font-black" >Limpiar selección</button>}
    </div>
    {!!availableQuincenas.length&&<div>
      <div className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-500">Quincenas</div>
      <div className="flex flex-wrap gap-2">
        {availableQuincenas.map(period=>{const key='q:'+period;const active=selectedPeriodKeys.has(key);return <button key={key} type="button" onClick={()=>togglePeriodKey(key)} className={`min-h-[50px] rounded-xl border px-4 py-3 text-sm font-black leading-tight ${active?'border-[#00548E] bg-[#00548E] text-white':'bg-white text-slate-800'}`}>{period}</button>;})}
      </div>
    </div>}
    {!!availableMonths.length&&<div>
      <div className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-500">Meses</div>
      <div className="flex flex-wrap gap-2">
        {availableMonths.map(month=>{const key='m:'+month;const active=selectedPeriodKeys.has(key);return <button key={key} type="button" onClick={()=>togglePeriodKey(key)} className={`min-h-[50px] rounded-xl border px-4 py-3 text-sm font-black leading-tight ${active?'border-[#00548E] bg-[#00548E] text-white':'bg-white text-slate-800'}`}>{monthLabel(month)}</button>;})}
      </div>
    </div>}
    <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
      <div className="text-base font-black text-[#00548E]">2. Comprueba los trabajadores</div>
      <div className="mt-1 text-sm font-semibold text-slate-700">{documentWorkers.length} trabajador(es) · {periodLabel}</div>
    </div>
    {!!documentWorkers.length&&<div className="max-h-56 overflow-y-auto rounded-xl border bg-white divide-y">
      {documentWorkers.map(worker=><div key={worker.id} className="px-4 py-3.5">
        <div className="text-sm font-black text-slate-800">{worker.apellidosNombre}</div>
        <div className="text-xs text-slate-500">{worker.dni} · {worker.categoria}{worker.quincena?' · '+worker.quincena:''}</div>
      </div>)}
    </div>}
  </div>;

  const prepareImportedWorkerSignature = async (doc:ForemanMandatoryDocument, worker:any) => {
    const v2Workers=Array.isArray(doc.details?.documentWorkersV2)?doc.details.documentWorkersV2:[];
    const documentWorker=v2Workers.find((item:any)=>Number(item.legacyWorkerId)===Number(worker.id));
    const anchor=(Array.isArray(doc.details?.workerAnchors)?doc.details.workerAnchors:[]).find((item:any)=>Number(item.workerId)===Number(worker.id));
    if(!documentWorker?.id||documentWorker.detectionStatus!=='CONFIRMED'||!anchor?.resolved||anchor.signatureX==null||anchor.signatureY==null||anchor.signatureWidth==null||anchor.signatureHeight==null){
      const message='Esta persona o su posición de firma sigue pendiente de revisión por el supervisor.';
      setError(message); setOperationFeedback(message); await appAlert(message,{title:'Pendiente de revisión',kind:'warning'}); return;
    }
    setMandatorySigning({documentId:doc.id,workerId:Number(worker.id),documentWorkerId:String(documentWorker.id),name:worker.apellidosNombre});
  };

  const removeImportedWorkerFromDocument=async(doc:ForemanMandatoryDocument,worker:any)=>{
    const workerId=Number(worker?.id);
    if(!Number.isFinite(workerId)||saving)return;
    setSaving(true);
    setOperationFeedback(`Quitando a ${worker.apellidosNombre} del documento…`);
    try{
      await removeForemanMandatoryWorker(token,doc.id,workerId);
      await refresh();
      setError('');
      setOperationFeedback(`${worker.apellidosNombre} se ha quitado del documento. Ya no cuenta como firma pendiente.`);
    }catch(e:any){
      const message=e?.message||'No se pudo quitar la persona del documento.';
      setError(message);
      setOperationFeedback(message);
    }finally{
      setSaving(false);
    }
  };

  const revokeWorkerSignature = async (doc:ForemanMandatoryDocument, worker:any) => {
    if(saving)return;
    if(!await appConfirm(`Se eliminará la firma de ${worker.apellidosNombre}. Esta persona tendrá que firmar de nuevo.`,{title:'Revocar firma',confirmLabel:'Revocar firma'}))return;
    const documentWorker=(doc.details?.documentWorkersV2||[]).find((entry:any)=>String(entry.legacyWorkerId)===String(worker.id));
    if(!documentWorker?.id){setError('No se pudo identificar esta firma. El supervisor debe revisar el documento.');return;}
    setSaving(true);
    try {
      await revokeMandatorySignatureV2({token,documentId:doc.id,documentWorkerId:String(documentWorker.id)});
      setMandatorySignatureImages(current=>{const next={...current,[doc.id]:{...current[doc.id]}};delete next[doc.id][String(worker.id)];return next;});
      await refresh();
      setError('');setOperationFeedback(`Firma revocada. ${worker.apellidosNombre} puede volver a firmar.`);
    } catch(e:any){setError(e?.message||'No se pudo revocar la firma.');}
    finally{setSaving(false);}
  };

  const renderSigningDocument=(doc:ForemanMandatoryDocument)=> {
    const isImportedMandatory=['inicio','control_presencia'].includes(String(doc.documentType));
    const assignedWorkers=doc.workers||[];
    const allSignatureIds=new Set(Object.keys(doc.signatures||{}).map(Number));
    const importedIdsForCount=isImportedMandatory && Array.isArray(doc.details?.importedWorkerIds)
      ? new Set(doc.details.importedWorkerIds.map((id:any)=>Number(id)).filter((id:number)=>Number.isFinite(id)))
      : null;
    const signatureIds=isImportedMandatory && importedIdsForCount
      ? new Set([...allSignatureIds].filter(id=>importedIdsForCount.has(id)))
      : allSignatureIds;
    const importedWorkerSnapshots=Array.isArray(doc.details?.importedWorkers)
      ? doc.details.importedWorkers
      : [];
    const workerAnchors=(Array.isArray(doc.details?.workerAnchors)?doc.details.workerAnchors:[]) as MandatoryWorkerAnchor[];
    const anchorWorkerSnapshots=workerAnchors.map(anchor=>({
      id:Number(anchor.workerId),
      apellidosNombre:String(anchor.workerName||'').trim(),
      dni:String(anchor.dni||'').trim(),
      categoria:'',
      obra:data?.worksite?.nombre||data?.obra||'',
    })).filter(worker=>Number.isFinite(worker.id)&&worker.id!==0&&worker.apellidosNombre);
    const importedWorkerMap=new Map<number,any>([
      ...anchorWorkerSnapshots.map((worker:any)=>[Number(worker.id),worker] as [number,any]),
      ...importedWorkerSnapshots.map((worker:any)=>[Number(worker.id),worker] as [number,any]),
    ]);
    const signedWorkers=isImportedMandatory
      ? [...signatureIds]
          .map(id=>importedWorkerMap.get(id) || (data?.workers||[]).find(worker=>Number(worker.id)===id))
          .filter(Boolean) as any[]
      : assignedWorkers.filter(worker=>signatureIds.has(Number(worker.id)));
    const signedCount=signatureIds.size;
    const correction=Boolean(doc.correctionPending);
    const closed=doc.status==='completed'||doc.status==='reviewed';
    const sourceText=String(doc.details?.sourceText||'').trim();
    const workDate=String(doc.workDate||'').slice(0,10);

    const validForDocument=(worker:any)=>{
      if(doc.documentType!=='control_presencia')return true;
      const startDate=String(worker.periodoInicio||'').slice(0,10);
      const endDate=String(worker.periodoFin||'').slice(0,10);
      return (!startDate||startDate<=workDate)&&(!endDate||endDate>=workDate);
    };

    const importedWorkerOrder:number[]=
      isImportedMandatory && Array.isArray(doc.details?.importedWorkerIds)
        ? doc.details.importedWorkerIds.map((id:any)=>Number(id)).filter((id:number)=>Number.isFinite(id))
        : [];
    const importedWorkerIds=new Set<number>(importedWorkerOrder);
    const workerById=new Map<number,any>([
      ...(data?.workers||[]).map(worker=>[Number(worker.id),worker] as [number,any]),
      ...anchorWorkerSnapshots.map((worker:any)=>[Number(worker.id),worker] as [number,any]),
      ...importedWorkerSnapshots.map((worker:any)=>[Number(worker.id),worker] as [number,any]),
    ]);
    const importedAnchorMap=new Map(workerAnchors.map(anchor=>[Number(anchor.workerId),anchor]));
    const importedCandidates=isImportedMandatory
      ? importedWorkerOrder
          .map(id=>{
            const known=workerById.get(id);
            if(known)return known;
            const anchor=workerAnchors.find(candidate=>Number(candidate.workerId)===id);
            return {
              id,
              apellidosNombre:String(anchor?.workerName||'Persona incluida en el documento').trim(),
              dni:String(anchor?.dni||'').trim(),
              categoria:doc.category||'',
              obra:data?.worksite?.nombre||doc.details?.obra||'',
              __documentOnly:true,
            };
          })
          .filter((worker:any)=>!signatureIds.has(Number(worker.id)))
      : [];

    const operationalCandidates=!isImportedMandatory
      ? assignedWorkers.filter(worker=>!signatureIds.has(Number(worker.id)))
      : [];

    const selectedId=mandatoryWorkerChoice[doc.id]||'';
    const selectedCandidate=operationalCandidates.find(worker=>String(worker.id)===selectedId);

    const requiredSignatureTotal=isImportedMandatory
      ? importedWorkerIds.size
      : assignedWorkers.length;
    const pendingRequired=isImportedMandatory
      ? importedWorkerOrder.filter(id=>!signatureIds.has(id)).length
      : operationalCandidates.length;
    const exactOriginalMode=isImportedMandatory&&doc.details?.originalPdfMode==='overlay';
    const unresolvedAnchorCount=isImportedMandatory
      ? importedWorkerOrder.filter(id=>!importedAnchorMap.get(id)?.resolved).length
      : workerAnchors.filter(anchor=>!anchor.resolved).length;
    const canFinalize=requiredSignatureTotal>0&&pendingRequired===0;
    const expanded=expandedMandatoryDocuments.has(doc.id);

    return <div id={'foreman-signing-'+doc.id} key={doc.id} className={`scroll-mt-24 overflow-hidden rounded-2xl bg-white border shadow-sm ${focusDocumentId===doc.id?'ring-4 ring-blue-200 border-[#00548E]':''} ${correction?'border-amber-300':''}`}>
      <button type="button" onClick={()=>toggleMandatoryDocument(doc.id)} className="flex w-full items-start justify-between gap-3 p-4 text-left">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 shrink-0 text-[#00548E]">{expanded?<ChevronDown className="h-5 w-5"/>:<ChevronRight className="h-5 w-5"/>}</span>
          <div className="min-w-0">
            <div className="font-black">{mandatoryLabel(doc.documentType)}</div>
            <div className="mt-1 truncate text-sm font-black text-[#00548E]" title={String(doc.details?.sourceFilename||'')}>{String(doc.details?.sourceFilename||'Documento importado')}</div>
            <div className="mt-1 text-xs text-slate-500">{String(doc.workDate).slice(0,10)} · {periodDisplayLabel(doc)}{doc.category?' · '+doc.category:''}</div>
            {unresolvedAnchorCount>0&&<div className="mt-1 text-[11px] font-bold text-amber-700">{unresolvedAnchorCount} trabajador(es) pendientes de localizar con seguridad en el PDF</div>}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${closed?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-800'}`}>{signedCount}/{requiredSignatureTotal || 0}</span>
      </button>
      {expanded&&<div className="border-t p-4">

      {exactOriginalMode&&<div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50/60 p-3">
        <div className="text-sm font-black text-[#00548E]">PDF original conservado</div>
        <p className="mt-1 text-sm leading-5 text-slate-600">El documento no se reconstruye. Las firmas se añaden como una capa sobre el archivo importado.</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button type="button" disabled={saving} onClick={()=>void previewMandatoryPdf(doc,'original')} className="min-h-[50px] rounded-xl border border-blue-200 bg-white px-3 py-2.5 text-sm font-black text-[#00548E]">Ver documento original</button>
          <button type="button" disabled={saving||signedCount===0} onClick={()=>void previewMandatoryPdf(doc,'signed')} className="min-h-[50px] rounded-xl bg-[#00548E] px-3 py-2.5 text-sm font-black text-white disabled:bg-slate-300">Previsualizar con firmas</button>
        </div>
        {operationFeedback&&<div className="mt-3 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">{operationFeedback}</div>}
        {unresolvedAnchorCount>0&&<div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
          No se colocará ninguna firma de forma aproximada. Corrige el nombre de la persona pendiente y vuelve a localizarla antes de firmar.
        </div>}
      </div>}
      {!exactOriginalMode&&sourceText&&<details className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3" open>
        <summary className="cursor-pointer text-xs font-black text-[#00548E]">Datos del documento importado</summary>
        <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-slate-700">{sourceText}</pre>
      </details>}

      {correction&&<div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900"><b>Devuelto por el supervisor:</b> {doc.correctionReason||'Revisa y corrige el documento.'}</div>}

      {!closed&&isImportedMandatory&&importedWorkerIds.size>0&&<div className="mt-3 rounded-2xl border-2 border-[#00548E]/20 bg-blue-50/50 p-3">
        <div className="text-base font-black text-[#00548E]">Personas listas para firmar</div>
        <p className="mt-1 text-sm leading-5 text-slate-600">Trabajadores revisados y habilitados por el supervisor para este documento.</p>
        {importedCandidates.length>0
          ? <div className="mt-3 space-y-2">{importedCandidates.map(worker=>{
              const editing=nameCorrection?.documentId===doc.id&&Number(nameCorrection.workerId)===Number(worker.id);
              return <div key={worker.id} className="w-full rounded-xl border border-blue-200 bg-white px-4 py-3 shadow-sm">
                {editing
                  ? <div className="space-y-2">
                      <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Nombre que aparecerá en este documento</label>
                      <input
                        autoFocus
                        value={nameCorrection?.value||''}
                        onChange={e=>setNameCorrection(current=>current?{...current,value:e.target.value}:current)}
                        className="min-h-[50px] w-full rounded-xl border border-blue-200 px-3 py-2 text-base font-bold text-slate-900"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" disabled={saving} onClick={()=>setNameCorrection(null)} className="min-h-[46px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-700">Cancelar</button>
                        <button type="button" disabled={saving||String(nameCorrection?.value||'').trim().length<3} onClick={async()=>{
                          if(!nameCorrection)return;
                          setSaving(true);
                          try{
                            await correctForemanMandatoryWorkerName(token,doc.id,Number(worker.id),nameCorrection.value);
                            setNameCorrection(null);
                            await refresh();
                            setError('');
                            setOperationFeedback('Nombre corregido para este documento.');
                          }catch(e:any){
                            const message=e?.message||'No se pudo corregir el nombre.';
                            setError(message);
                            setOperationFeedback(message);
                          }finally{setSaving(false);}
                        }} className="min-h-[46px] rounded-xl bg-[#00548E] px-3 py-2 text-sm font-black text-white disabled:bg-slate-300">Guardar nombre</button>
                      </div>
                    </div>
                  : <>
                      <div className="text-base font-black text-slate-900">{worker.apellidosNombre}</div>
                      <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{worker.dni?worker.dni+' · ':''}{worker.categoria}</div>
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
                        <button type="button" disabled={saving} onClick={()=>void prepareImportedWorkerSignature(doc,worker)} className="min-h-[50px] rounded-xl bg-[#00548E] px-3 py-2 text-sm font-black text-white disabled:opacity-50">Firmar esta persona</button>
                      </div>
                    </>}
              </div>;
            })}</div>
          : <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800">Todos los trabajadores habilitados por el supervisor ya han firmado.</div>}
      </div>}

      {!closed&&isImportedMandatory&&importedWorkerIds.size===0&&<div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        No se han podido leer nombres de personas en este PDF. El supervisor debe revisar los trabajadores y volver a enviar el documento al portal.
      </div>}

      {!closed&&!isImportedMandatory&&operationalCandidates.length>0&&<div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
        <div className="text-base font-black text-[#00548E]">Trabajadores pendientes de firma</div>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Selecciona cada trabajador y recoge su firma. El documento no podrá finalizarse hasta completar todas.</p>
        <select value={selectedId} onChange={e=>setMandatoryWorkerChoice(current=>({...current,[doc.id]:e.target.value}))} className="mt-3 min-h-[56px] w-full rounded-xl border bg-white px-3 py-3 text-base font-semibold">
          <option value="">Seleccionar trabajador…</option>
          {operationalCandidates.map(worker=><option key={worker.id} value={String(worker.id)}>{worker.apellidosNombre} · {worker.dni}</option>)}
        </select>
        <button type="button" disabled={saving||!selectedCandidate} onClick={()=>{
          if(!selectedCandidate)return;
          setMandatorySigning({documentId:doc.id,workerId:Number(selectedCandidate.id),name:selectedCandidate.apellidosNombre});
        }} className="mt-2 min-h-[56px] w-full rounded-xl bg-[#00548E] px-4 py-3 text-base font-black text-white disabled:bg-slate-200 disabled:text-slate-500">Recoger firma del trabajador</button>
      </div>}

      <div className="mt-3 rounded-xl border bg-slate-50 p-3">
        <div className="text-xs font-black uppercase tracking-wide text-slate-500">Trabajadores que ya han firmado</div>
        {!signedWorkers.length&&<div className="mt-2 text-sm font-semibold text-slate-500">Todavía no hay firmas guardadas.</div>}
        {!!signedWorkers.length&&<div className="mt-2 space-y-2">{signedWorkers.map(worker=><div key={worker.id} className="flex min-h-[58px] flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <span><span className="block text-sm font-black text-slate-800">{worker.apellidosNombre}</span><span className="block mt-1 text-xs text-slate-500">{worker.dni} · {worker.categoria}</span></span>
          {(()=>{
            const raw=doc.signatures?.[String(worker.id)];
            const rawValue=typeof raw==='string'?raw:raw?.signature;
            const signature=mandatorySignatureImages[doc.id]?.[String(worker.id)]
              || (typeof rawValue==='string'&&rawValue.startsWith('data:image/')?rawValue:'');
            if(isImportedMandatory&&signature){
              return <div className="ml-auto flex min-w-[112px] max-w-[150px] flex-col items-end">
                <img src={signature} alt={'Firma de '+worker.apellidosNombre} className="h-11 max-w-[145px] object-contain object-right"/>
                <span className="mt-1 text-[10px] font-black text-emerald-700">Firmado ✓</span>
              </div>;
            }
            return correction&&!closed
              ? <button type="button" onClick={()=>setMandatorySigning({documentId:doc.id,workerId:Number(worker.id),name:worker.apellidosNombre})} className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-900">Volver a firmar</button>
              : <span className="ml-auto inline-flex min-h-11 items-center rounded-xl border border-emerald-200 bg-white px-3 text-xs font-black text-emerald-700">Firma guardada ✓</span>;
          })()}
          {!closed&&isImportedMandatory&&<button type="button" disabled={saving} onClick={()=>void revokeWorkerSignature(doc,worker)} className="min-h-[48px] rounded-xl border border-rose-300 bg-white px-3 py-2 text-sm font-black text-rose-800 disabled:opacity-50">Revocar firma y volver a firmar</button>}
        </div>)}</div>}
      </div>
      {!closed&&pendingRequired>0&&<p className="mt-3 text-sm font-bold text-amber-900">Faltan {pendingRequired} firma(s) obligatoria(s) para enviar.</p>}
      {!closed&&isImportedMandatory&&<p className="mt-3 text-sm text-slate-600">Si una firma está mal colocada, pide al supervisor que retire el documento del portal y corrija su posición. No hace falta repetirla si corresponde a la persona correcta.</p>}

      {!closed&&<button id={'foreman-signing-'+doc.id} type="button" disabled={saving||!canFinalize} onClick={async()=>{
        if(pendingRequired>0){setError('Faltan firmas obligatorias. Completa todas antes de enviar.');return;}
        setSaving(true);
        setError('');
        try{
          let finalized:any;
          if(exactOriginalMode){
            setOperationFeedback('1/2 · Generando y validando el PDF firmado…');
            const prepared=await buildExactSignedPreview(doc,true);
            if(!prepared.fidelity?.ok)throw new Error('La comprobación de fidelidad ha detectado una diferencia fuera de las zonas de firma.');
            setOperationFeedback('2/2 · Enviando el mismo PDF al supervisor…');
            finalized=await submitMandatoryDocumentV2({token,documentId:doc.id,pdfBase64:bytesToBase64(prepared.bytes),signedSha256:await sha256Hex(prepared.bytes),fidelity:{...(prepared.fidelity||{}),originalSha256:prepared.source.sha256}});
          }else{
            finalized=await finalizeForemanMandatoryDocument(token,doc.id);
          }
          await refresh();
          setMandatoryWorkerChoice(current=>({...current,[doc.id]:''}));
          setOperationFeedback(finalized?.partial
            ? `Documento enviado al supervisor con ${finalized.signed||signedCount}/${finalized.total||requiredSignatureTotal} firmas.`
            : 'Documento firmado enviado correctamente al supervisor.');
          setTab('completed');
        }catch(e:any){
          const message=e?.message||'No se pudo enviar el documento.';
          setError(message);
          setOperationFeedback(message);
        }finally{setSaving(false);}
      }} className={`mt-4 min-h-[58px] w-full rounded-2xl px-4 py-4 text-base font-black text-white touch-manipulation disabled:bg-slate-200 disabled:text-slate-500 bg-emerald-600`}>
        Finalizar y enviar al supervisor
      </button>}

      {closed&&<div className={`mt-4 rounded-xl border px-3 py-2 text-center text-xs font-black ${doc.details?.submissionMode==='partial'?'border-amber-300 bg-amber-50 text-amber-900':'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{doc.details?.submissionMode==='partial'?`Documento enviado incompleto al supervisor · ${doc.details?.submittedSignedCount||0}/${doc.details?.submittedRequiredCount||requiredSignatureTotal} firmas`:'Documento finalizado y enviado al supervisor'}</div>}
      </div>}
    </div>;
  };

  if(loading&&!data)return <div className="min-h-screen bg-slate-100 flex items-center justify-center"><div className="text-center"><Loader2 className="w-9 h-9 animate-spin mx-auto text-[#00548E]"/><p className="mt-3 font-bold">Abriendo documentación de obra…</p></div></div>;
  if(!data)return <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4"><div className="max-w-md rounded-3xl bg-white border border-amber-200 p-7 text-center shadow-xl"><ShieldCheck className="w-10 h-10 mx-auto text-amber-500"/><h1 className="mt-3 text-xl font-black">Acceso no disponible</h1><p className="mt-2 text-sm text-slate-600">{error||'No se pudo cargar la documentación de la obra.'}</p><div className="mt-4 grid gap-2"><button type="button" onClick={()=>void refresh()} className="min-h-[50px] rounded-xl bg-[#00548E] px-5 py-3 text-sm font-black text-white"><RefreshCw className="mr-2 inline h-4 w-4"/>Reintentar</button><button type="button" onClick={unlinkForemanDevice} className="min-h-[50px] rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-700">Desvincular este dispositivo</button></div></div></div>;

  const completedToday=controlRows.filter(r=>r.entrySignature&&r.exitSignature).length;
  return <div className="min-h-[100dvh] bg-slate-100 text-slate-900 overscroll-none">
    <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm px-4 pb-3" style={{paddingTop:'max(12px, env(safe-area-inset-top))'}}>
      <div className="max-w-4xl mx-auto">
        <div className="text-[11px] sm:text-xs font-black uppercase tracking-[.14em] text-[#00548E]">PFEA Encargados</div>
        <h1 className="mt-0.5 text-lg sm:text-xl font-black leading-tight break-words">{data.obra}</h1>
        <p className="mt-0.5 text-sm text-slate-600">{data.foremanName||'Encargado de obra'}</p>
      </div>
    </header>
    <main className="max-w-4xl mx-auto px-3 sm:px-5 pt-3 sm:pt-5 pb-28 sm:pb-6 space-y-4">
      {!installedStandalone&&<section className="rounded-3xl border-2 border-[#00548E]/20 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#00548E] text-white"><Smartphone className="h-6 w-6"/></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black text-slate-900 dark:text-slate-50">Instalar PFEA Encargados</h2>
            <p className="mt-1 text-sm leading-5 text-slate-600">Instálala en este móvil para abrir directamente el portal desde un icono, como una aplicación.</p>
          </div>
        </div>
        <button type="button" onClick={()=>void installForemanApp()} className="mt-4 min-h-[58px] w-full rounded-2xl bg-[#00548E] px-4 py-4 text-base font-black text-white">
          {isIosDevice()&&!installPromptAvailable?<><Share2 className="mr-2 inline h-5 w-5"/>Cómo instalar en iPhone</>:<><Download className="mr-2 inline h-5 w-5"/>Instalar PFEA Encargados</>}
        </button>
        {installHelpVisible&&<div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-slate-700">
          {isIosDevice()
            ? <><b>iPhone/iPad:</b> abre este portal en Safari, pulsa <b>Compartir</b> y después <b>Añadir a pantalla de inicio</b>. Confirma con <b>Añadir</b>.</>
            : isAndroidDevice()
              ? <><b>Android:</b> abre el portal en Chrome o Edge y pulsa <b>Instalar aplicación</b>. Si no aparece el aviso automático, usa el menú del navegador y elige <b>Instalar aplicación</b> o <b>Añadir a pantalla de inicio</b>.</>
              : <>Usa la opción <b>Instalar aplicación</b> o <b>Añadir a pantalla de inicio</b> de tu navegador.</>}
        </div>}
        <p className="mt-3 text-xs leading-5 text-slate-500">Este dispositivo conservará localmente el acceso del encargado para que el icono instalado abra directamente su obra.</p>
        <button type="button" onClick={unlinkForemanDevice} className="mt-2 min-h-[46px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-700">Desvincular este dispositivo</button>
      </section>}

      {error&&<div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="font-black">No se pudo completar la operación</div>
        <div className="mt-1">{error}</div>
        <button type="button" onClick={()=>void refresh()} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-black"><RefreshCw className="h-4 w-4"/>Reintentar sin salir</button>
      </div>}
      <div
        className="fixed bottom-0 left-0 right-0 z-30 sm:static overflow-x-auto overscroll-x-contain bg-white/95 backdrop-blur border-t sm:border sm:rounded-2xl p-2 shadow-[0_-8px_30px_rgba(15,23,42,0.10)] sm:shadow-none"
        style={{paddingBottom:'max(8px, env(safe-area-inset-bottom))',WebkitOverflowScrolling:'touch'}}
      >
        <div className="flex w-max min-w-full gap-2">
          <button onClick={()=>setTab('mandatory')} style={{flex:'0 0 auto',minWidth:96,whiteSpace:'nowrap',wordBreak:'keep-all'}} className={`min-h-[64px] rounded-xl px-3 py-2 text-xs font-black touch-manipulation ${tab==='mandatory'?'bg-[#00548E] text-white':'text-slate-700'}`}><ClipboardList className="w-5 h-5 mx-auto mb-1"/><span className="block whitespace-nowrap">Control inicios</span></button>
          <button onClick={()=>setTab('prevention')} style={{flex:'0 0 auto',minWidth:112,whiteSpace:'nowrap'}} className={`min-h-[64px] rounded-xl px-3 py-2 text-xs font-black touch-manipulation ${tab==='prevention'?'bg-[#00548E] text-white':'text-slate-700'}`}><ShieldCheck className="w-5 h-5 mx-auto mb-1"/><span className="block whitespace-nowrap">Prevención</span></button>
          <button onClick={()=>setTab('epis')} style={{flex:'0 0 auto',minWidth:82,whiteSpace:'nowrap',wordBreak:'keep-all'}} className={`min-h-[64px] rounded-xl px-3 py-2 text-xs font-black touch-manipulation ${tab==='epis'?'bg-[#00548E] text-white':'text-slate-700'}`}><HardHat className="w-5 h-5 mx-auto mb-1"/><span className="block whitespace-nowrap">EPIs</span></button>
          <button onClick={()=>setTab('formacion')} style={{flex:'0 0 auto',minWidth:104,whiteSpace:'nowrap',wordBreak:'keep-all'}} className={`min-h-[64px] rounded-xl px-3 py-2 text-xs font-black touch-manipulation ${tab==='formacion'?'bg-[#00548E] text-white':'text-slate-700'}`}><GraduationCap className="w-5 h-5 mx-auto mb-1"/><span className="block whitespace-nowrap">Formación</span></button>
          <button onClick={()=>setTab('maquinaria')} style={{flex:'0 0 auto',minWidth:108,whiteSpace:'nowrap',wordBreak:'keep-all'}} className={`min-h-[64px] rounded-xl px-3 py-2 text-xs font-black touch-manipulation ${tab==='maquinaria'?'bg-[#00548E] text-white':'text-slate-700'}`}><Wrench className="w-5 h-5 mx-auto mb-1"/><span className="block whitespace-nowrap">Maquinaria</span></button>
          <button onClick={()=>setTab('control')} style={{flex:'0 0 auto',minWidth:122,whiteSpace:'nowrap',wordBreak:'keep-all'}} className={`min-h-[64px] rounded-xl px-3 py-2 text-xs font-black touch-manipulation ${tab==='control'?'bg-[#00548E] text-white':'text-slate-700'}`}><LogIn className="w-5 h-5 mx-auto mb-1"/><span className="block whitespace-nowrap">Control horario</span></button>
          <button onClick={()=>setTab('documents')} style={{flex:'0 0 auto',minWidth:110,whiteSpace:'nowrap',wordBreak:'keep-all'}} className={`min-h-[64px] rounded-xl px-3 py-2 text-xs font-black touch-manipulation ${tab==='documents'?'bg-[#00548E] text-white':'text-slate-700'}`}><FileSignature className="w-5 h-5 mx-auto mb-1"/><span className="block whitespace-nowrap">Documentos</span></button>
          <button onClick={()=>setTab('completed')} style={{flex:'0 0 auto',minWidth:108,whiteSpace:'nowrap',wordBreak:'keep-all'}} className={`min-h-[64px] rounded-xl px-3 py-2 text-xs font-black touch-manipulation ${tab==='completed'?'bg-[#00548E] text-white':'text-slate-700'}`}><CheckCircle2 className="w-5 h-5 mx-auto mb-1"/><span className="block whitespace-nowrap">Finalizados</span></button>
        </div>
      </div>

      {tab==='prevention' && <PreventionSection token={token} savedObras={[data.obra]} foremanName={data.foremanName} />}
      {tab==='control'&&<section className="space-y-3">
        <div className="rounded-2xl bg-white border p-4 space-y-4">
          <div><h2 className="text-lg font-black">Control horario</h2><p className="text-sm text-slate-600">Selecciona quincenas, meses o ambos. Los trabajadores del periodo aparecen debajo para firmar entrada y salida.</p></div>
          {renderPeriodSelector()}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><div><p className="text-sm font-black text-slate-800">{completedToday}/{controlRows.length} trabajadores con entrada y salida firmadas</p><p className="mt-1 text-sm font-semibold text-slate-500">Horario predeterminado: {data.defaultWorkStartHour}–{data.defaultWorkEndHour}.</p></div><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="min-h-[50px] w-full sm:w-auto rounded-xl border px-3 py-2 text-base font-bold bg-white"/></div>
        </div>
        {data.attendance.find(a=>String(a.workDate).slice(0,10)===date)?.correctionPending&&
          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
            <div className="font-black text-amber-900">Corrección solicitada por el supervisor</div>
            <p className="mt-1 text-sm text-amber-800">{data.attendance.find(a=>String(a.workDate).slice(0,10)===date)?.correctionReason||'Revisa esta jornada antes de volver a finalizarla.'}</p>
          </div>}
        {controlRows.map(row=><div key={row.workerId} className="rounded-2xl bg-white border p-4 shadow-sm">
          <div><div className="font-black">{row.name}</div><div className="text-xs text-slate-500">{row.dni} · {row.category}</div></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div className={`rounded-xl border p-2.5 ${row.entrySignature?'border-emerald-300 bg-emerald-50':'bg-white'}`}>
              <label className="block text-[10px] font-black uppercase text-slate-500">Hora entrada</label>
              <input
                type="time"
                value={row.entryTime || data.defaultWorkStartHour || '08:00'}
                onChange={e=>{
                  const value=e.target.value;
                  setRows(current=>current.map(item=>item.workerId===row.workerId?{...item,entryTime:value,entrySignature:''}:item));
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
                  setRows(current=>current.map(item=>item.workerId===row.workerId?{...item,exitTime:value,exitSignature:''}:item));
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
          <button disabled={saving||!controlRows.length} onClick={()=>void persist(rows,'draft')} className="w-full rounded-2xl border border-slate-300 bg-white py-4 font-black text-slate-800 disabled:opacity-50">{saving?<Loader2 className="w-5 h-5 animate-spin mx-auto"/>:<><Save className="inline w-5 h-5 mr-2"/>Guardar cambios</>}</button>
          <button disabled={saving||!controlRows.length||completedToday!==controlRows.length} onClick={()=>void persist(controlRows,'completed')} className="w-full rounded-2xl bg-emerald-600 text-white py-4 font-black disabled:opacity-50">{saving?<Loader2 className="w-5 h-5 animate-spin mx-auto"/>:<><CheckCircle2 className="inline w-5 h-5 mr-2"/>Finalizar y enviar control horario</>}</button>
        </div>
      </section>}

      {tab==='mandatory'&&<section className="space-y-3">
        <div className="rounded-2xl bg-white border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-black">Control inicios</h2><button type="button" onClick={()=>void refresh()} disabled={refreshingDocuments} className="min-h-[48px] inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-black text-slate-700 disabled:opacity-50"><RefreshCw className="w-4 h-4"/>{refreshingDocuments?'Actualizando…':'Actualizar documentos'}</button></div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Aquí aparecen los documentos importados de Inicio / Incorporación y Control de presencia. Cada PDF conserva su identidad, muestra únicamente las personas reconocidas en ese documento y respeta el periodo seleccionado.</p>
        </div>
        {documentsUpdatedAt&&<p role="status" className="px-1 text-xs text-slate-600 dark:text-slate-300">Última consulta: {documentsUpdatedAt} · {allAssignedMandatoryDocuments.length} documento(s) enviados a esta obra.</p>}
        <div className="rounded-2xl border bg-white p-2">
          <div className="flex items-center gap-2 overflow-x-auto pb-1" style={{WebkitOverflowScrolling:'touch'}}>
            <button type="button" onClick={()=>setSelectedMandatoryPeriodKeys(new Set())} className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-black ${selectedMandatoryPeriodKeys.size===0?'border-[#00548E] bg-[#00548E] text-white':'bg-white text-slate-700'}`}>Todos</button>
            {mandatoryPeriodOptions.map(option=><button key={option.key} type="button" onClick={()=>toggleMandatoryPeriod(option.key)} className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-black whitespace-nowrap ${selectedMandatoryPeriodKeys.has(option.key)?'border-[#00548E] bg-[#00548E] text-white':'bg-slate-50 text-slate-700'}`}>{option.label} · {option.count}</button>)}
          </div>
        </div>
        {assignedByWorksiteAndPeriod.map(group=><div key={group.worksite} className="space-y-3">
          <div className="rounded-2xl border-2 border-[#00548E]/20 bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] font-black uppercase tracking-[.12em] text-[#00548E]">Obra</div>
            <div className="mt-1 text-lg font-black text-slate-900">{group.worksite}</div>
          </div>
          {group.periods.map(periodGroup=><div key={periodGroup.period} className="space-y-2">
            <div className="flex items-center justify-between gap-3 px-1 py-1">
              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Periodo</div>
                <div className="mt-1 text-base font-black text-slate-900">{periodGroup.period}</div>
              </div>
              <div className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-[#00548E]">{periodGroup.documents.length} doc.</div>
            </div>
            {periodGroup.documents.map(doc=>renderSigningDocument(doc))}
          </div>)}
        </div>)}
        {!assignedMandatoryDocuments.length&&<div className="rounded-2xl bg-white border p-8 text-center text-sm text-slate-500">{selectedMandatoryPeriodKeys.size?'No hay documentos en los periodos seleccionados. Pulsa Todos para ver todos los documentos enviados.':'No hay documentos enviados de Inicio ni Control de presencia para esta obra. Pulsa Actualizar documentos y comprueba con el supervisor la obra del envío.'}</div>}
      </section>}

      {tab==='epis'&&<section className="space-y-3">
        <div className="rounded-2xl bg-white border p-4 space-y-4">
          <div><h2 className="text-lg font-black">Entrega de EPIs</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Selecciona quincenas, meses o ambos, revisa los trabajadores y prepara el documento para que firmen uno a uno.</p></div>
          {renderPeriodSelector()}
          <label className="block text-sm font-black">Fecha
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} className="mt-2 min-h-[52px] w-full rounded-xl border px-3 py-3 text-base bg-white"/>
          </label>
          <div>
            <div className="mb-2 text-sm font-black">EPIs entregados</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries({casco:'Casco',chaleco:'Chaleco',orejeras:'Orejeras',gafas:'Gafas',guantes:'Guantes',mascarillas:'Mascarillas',calzado:'Calzado'}).map(([key,label])=><label key={key} className="flex items-center gap-2 rounded-xl border bg-white p-3 text-sm font-bold">
                <input type="checkbox" checked={epiSelection[key]!==false} onChange={e=>setEpiSelection(current=>({...current,[key]:e.target.checked}))}/>
                {label}
              </label>)}
            </div>
          </div>
          <button type="button" disabled={saving||!documentWorkers.length} onClick={()=>void prepareOperationalDocument('epis')} className="min-h-[56px] w-full rounded-2xl bg-[#00548E] px-4 py-3.5 text-base font-black text-white disabled:opacity-50">Preparar relación para firmas ({documentWorkers.length})</button>
        </div>
        {operationalDocumentsFor('epis').map(doc=>renderSigningDocument(doc))}
      </section>}

      {tab==='formacion'&&<section className="space-y-3">
        <div className="rounded-2xl bg-white border p-4 space-y-4">
          <div><h2 className="text-lg font-black">Formación e información</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Selecciona quincenas, meses o ambos. Los trabajadores seleccionados quedarán listos para firmar la misma relación de Formación e información de Documentación de obra.</p></div>
          {renderPeriodSelector()}
          <label className="block text-sm font-black">Fecha
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} className="mt-2 min-h-[52px] w-full rounded-xl border px-3 py-3 text-base bg-white"/>
          </label>
          <div className="grid sm:grid-cols-[1fr_180px] gap-3">
            <label className="block text-sm font-black">Acción formativa / información
              <textarea rows={4} value={trainingAction} onChange={e=>setTrainingAction(e.target.value)} className="mt-2 w-full rounded-xl border px-3 py-3 text-base bg-white"/>
            </label>
            <label className="block text-sm font-black">Duración
              <input value={trainingDuration} onChange={e=>setTrainingDuration(e.target.value)} className="mt-2 min-h-[52px] w-full rounded-xl border px-3 py-3 text-base bg-white"/>
            </label>
          </div>
          <button type="button" disabled={saving||!documentWorkers.length} onClick={()=>void prepareOperationalDocument('formacion')} className="min-h-[56px] w-full rounded-2xl bg-[#00548E] px-4 py-3.5 text-base font-black text-white disabled:opacity-50">Preparar relación para firmas ({documentWorkers.length})</button>
          {operationFeedback&&<div className={`rounded-xl border px-4 py-3 text-sm font-bold ${error?'border-rose-200 bg-rose-50 text-rose-800':'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{operationFeedback}</div>}
        </div>
        {operationalDocumentsFor('formacion').map(doc=>renderSigningDocument(doc))}
      </section>}

      {tab==='maquinaria'&&<section className="space-y-3">
        <div className="rounded-2xl bg-white border p-4 space-y-4">
          <div><h2 className="text-lg font-black">Autorización al uso de maquinaria</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Mantiene el detalle por trabajador: selecciona periodos, indica la maquinaria/equipos y después recoge las firmas.</p></div>
          {renderPeriodSelector()}
          <label className="block text-sm font-black">Fecha
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} className="mt-2 min-h-[52px] w-full rounded-xl border px-3 py-3 text-base bg-white"/>
          </label>
          <label className="block text-sm font-black">Maquinaria o equipos para aplicar a todos
            <textarea rows={3} value={globalMachinery} onChange={e=>setGlobalMachinery(e.target.value)} placeholder="Ej.: Dumper, hormigonera, radial…" className="mt-2 w-full rounded-xl border px-3 py-3 text-base bg-white"/>
          </label>
          <button type="button" onClick={()=>setMachineryByWorker(current=>({...current,...Object.fromEntries(documentWorkers.map(worker=>[String(worker.id),globalMachinery]))}))} className="rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-black text-amber-900">Aplicar a todos los seleccionados</button>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {documentWorkers.map(worker=><div key={worker.id} className="grid sm:grid-cols-[1fr_1.2fr] gap-2 rounded-xl border bg-white p-3">
              <div><div className="text-sm font-black">{worker.apellidosNombre}</div><div className="text-xs text-slate-500">{worker.dni} · {worker.categoria}</div></div>
              <input value={machineryByWorker[String(worker.id)]||''} onChange={e=>setMachineryByWorker(current=>({...current,[String(worker.id)]:e.target.value}))} placeholder="Máquinas separadas por coma" className="min-h-[46px] rounded-xl border px-3 py-2"/>
            </div>)}
          </div>
          <button type="button" disabled={saving||!documentWorkers.length} onClick={()=>void prepareOperationalDocument('autorizacion_uso_maquinaria')} className="min-h-[56px] w-full rounded-2xl bg-[#00548E] px-4 py-3.5 text-base font-black text-white disabled:opacity-50">Preparar autorización para firmas ({documentWorkers.length})</button>
        </div>
        {operationalDocumentsFor('maquinaria').map(doc=>renderSigningDocument(doc))}
      </section>}

      {tab==='documents'&&<section className="rounded-2xl bg-white border p-4 sm:p-5 space-y-4 shadow-sm">
        <div>
          <h2 className="text-lg font-black">Otros documentos</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Aquí quedan únicamente los documentos independientes de Documentación de obra. EPIs, Formación e información, Maquinaria y Control horario tienen ahora su propio botón en la cinta superior.</p>
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
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Son los mismos modelos de “Otros documentos” disponibles en Documentación de obra. Selecciona primero el periodo para trabajar únicamente con el personal correspondiente.</p>
        </div>
        {renderPeriodSelector()}
        <label className="block text-sm font-black">Documento
          <select value={docType} onChange={e=>{setDocType(e.target.value as AdditionalWorksiteDocumentType);setAnswers({});setDocSignatures({});setCorrectionDocumentId('');}} className="mt-2 min-h-[52px] w-full rounded-xl border px-3 py-3 text-base font-semibold bg-white">
            {Object.entries(ADDITIONAL_WORKSITE_DOCUMENTS).map(([key,d])=><option key={key} value={key}>{d.short}</option>)}
          </select>
        </label>
        <label className="block text-sm font-black">Trabajador
          <select value={workerId} onChange={e=>setWorkerId(e.target.value?Number(e.target.value):'')} className="mt-2 min-h-[52px] w-full rounded-xl border px-3 py-3 text-base font-semibold bg-white">
            <option value="">Seleccionar trabajador…</option>
            {documentWorkers.map(w=><option key={w.id} value={w.id}>{w.apellidosNombre} · {w.dni}</option>)}
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
        <button type="button" onClick={()=>void generateAdditionalPdf()} className="min-h-[54px] w-full rounded-2xl border-2 border-[#00548E] bg-white px-4 py-3 text-base font-black text-[#00548E]">
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
              setError('');
              await refresh();setTab('completed');
            }catch(e:any){
              setError(e?.message||'No se pudo enviar el documento al supervisor.');
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
        {data.mandatoryDocuments.filter(d=>d.status==='completed'||d.status==='reviewed').map(d=><div key={'m-'+d.id} className="rounded-2xl bg-white border p-4 shadow-sm">
          <div className="text-base font-black">{mandatoryLabel(d.documentType)}</div>
          <div className="mt-1 truncate text-sm font-bold text-[#00548E]" title={String(d.details?.sourceFilename||'')}>{String(d.details?.sourceFilename||'Documento firmado')}</div>
          <div className="mt-1 text-sm text-slate-500">{String(d.workDate).slice(0,10)}{d.category?' · '+d.category:''}{d.details?.periodoLabel?' · '+String(d.details.periodoLabel):''}</div>
          <span className="mt-3 inline-flex rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-black text-emerald-700">{d.status==='reviewed'?'Revisado por el supervisor':'Enviado al supervisor'}</span>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" disabled={saving} onClick={()=>void previewCompletedMandatoryPdf(d)} className="min-h-[52px] rounded-xl border border-blue-200 bg-white px-3 py-3 text-sm font-black text-[#00548E] disabled:opacity-50"><FileDown className="mr-2 inline h-4 w-4"/>Ver PDF</button>
            <button type="button" disabled={saving} onClick={()=>void shareCompletedMandatoryPdf(d)} className="min-h-[52px] rounded-xl bg-[#00548E] px-3 py-3 text-sm font-black text-white disabled:opacity-50"><Share2 className="mr-2 inline h-4 w-4"/>Compartir</button>
          </div>
        </div>)}
        {data.attendance.filter(day=>day.status==='completed'||day.status==='reviewed').map(day=><div key={'a-'+day.id} className="rounded-2xl bg-white border p-4 shadow-sm"><div className="text-base font-black">Control horario</div><div className="mt-1 text-sm text-slate-500">{String(day.workDate).slice(0,10)}</div><span className="mt-3 inline-flex rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-black text-emerald-700">{day.status==='reviewed'?'Revisado por el supervisor':'Enviado al supervisor'}</span></div>)}
        {data.documents.filter(d=>!d.correctionPending&&d.status!=='draft').map(d=><div key={'d-'+d.id} className="rounded-2xl bg-white border p-4 shadow-sm"><div className="text-base font-black">{ADDITIONAL_WORKSITE_DOCUMENTS[d.documentType as AdditionalWorksiteDocumentType]?.short||d.documentType}</div><div className="mt-1 text-sm text-slate-500">{d.workerSnapshot?.apellidosNombre||'Trabajador'} · {String(d.workDate).slice(0,10)}</div><span className="mt-3 inline-flex rounded-full bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs font-black text-blue-800">Enviado al supervisor</span></div>)}
        {!data.mandatoryDocuments.some(d=>d.status==='completed'||d.status==='reviewed')&&!data.attendance.some(day=>day.status==='completed'||day.status==='reviewed')&&!data.documents.some(d=>!d.correctionPending&&d.status!=='draft')&&<div className="rounded-2xl bg-white border p-8 text-center text-base text-slate-500">Todavía no hay documentos finalizados.</div>}
      </section>}
    </main>
    {pdfPreview&&<PdfCanvasPreview bytes={pdfPreview.bytes} title={pdfPreview.title} notice={pdfPreview.notice} onClose={closePdfPreview}/>} 
    {signing&&<SignaturePad title={`Firma de ${signing.kind==='entry'?'entrada':'salida'}`} onSave={img=>void applySignature(img)} onCancel={()=>setSigning(null)}/>}
    {docSigning&&<SignaturePad title={docSigning==='worker'?'Firma del trabajador':'Firma del encargado'} onSave={img=>{setDocSignatures(s=>({...s,[docSigning]:img}));setDocSigning(null);}} onCancel={()=>setDocSigning(null)}/>}
    {mandatorySigning&&<SignaturePad title={'Firma de '+mandatorySigning.name} onSave={async img=>{
      const current=mandatorySigning;
      setMandatorySigning(null);
      setSaving(true);
      try{
        const currentDoc=(data?.mandatoryDocuments||[]).find(doc=>doc.id===current.documentId);
        if(currentDoc&&['inicio','control_presencia'].includes(String(currentDoc.documentType))){
          if(!current.documentWorkerId)throw new Error('No se ha podido identificar de forma estable a esta persona dentro del documento.');
          await signMandatoryDocumentWorkerV2({token,documentId:current.documentId,documentWorkerId:current.documentWorkerId,signature:img});
        }else{
          await signMandatoryForemanDocument(token,current.documentId,current.workerId,img);
        }
        const [verified,realSignatures]=await Promise.all([
          resolveForemanPortal(token),
          getForemanMandatorySignatures(token,current.documentId),
        ]);
        const verifiedDoc=(verified.mandatoryDocuments||[]).find(doc=>doc.id===current.documentId);
        const storedSignature=realSignatures?.[String(current.workerId)];
        const storedImage=typeof storedSignature==='string'?storedSignature:storedSignature?.signature;
        if(typeof storedImage!=='string'||!storedImage.startsWith('data:image/')){
          throw new Error('La firma no ha quedado guardada correctamente. Vuelve a intentarlo.');
        }
        setMandatorySignatureImages(previous=>({
          ...previous,
          [current.documentId]:{
            ...(previous[current.documentId]||{}),
            [String(current.workerId)]:storedImage,
          },
        }));
        const importedIds=Array.isArray(verifiedDoc?.details?.importedWorkerIds)
          ? verifiedDoc.details.importedWorkerIds.map((id:any)=>String(Number(id))).filter((id:string)=>id!=='NaN'&&id!=='0')
          : [];
        const signatureMap=verifiedDoc?.signatures||{};
        const allImportedSigned=importedIds.length>0 && importedIds.every((id:string)=>Boolean(signatureMap[id]));
        setData(verified);
        setMandatoryWorkerChoice(currentChoices=>({...currentChoices,[current.documentId]:''}));
        setError('');
        setOperationFeedback(allImportedSigned
          ? 'Todas las firmas están completas. Pulsa “Enviar documento firmado al supervisor”.'
          : 'Firma guardada correctamente.');
        if(allImportedSigned){
          window.setTimeout(()=>{
            document.getElementById('foreman-signing-'+current.documentId)?.scrollIntoView({behavior:'smooth',block:'center'});
          },120);
        }
      }catch(e:any){
        const message=e?.message||'No se pudo guardar la firma.';
        setError(message);
        setOperationFeedback(message);
        await appAlert(message,{title:'No se pudo guardar la firma',kind:'error'});
      }finally{
        setSaving(false);
      }
    }} onCancel={()=>setMandatorySigning(null)}/>} 
  </div>;
};


