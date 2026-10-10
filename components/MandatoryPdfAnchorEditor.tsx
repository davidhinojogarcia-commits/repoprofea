import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import ModalPortal from './ModalPortal';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { getSupervisorMandatoryPdf } from '../src/services/foremanPortalService';
import { blockingMandatorySignatureIssues, suggestSafeMandatorySignaturePositions, validateMandatorySignaturePlacement } from '../src/lib/mandatorySignatureGeometry';
import { supabase } from '../src/lib/supabase';
import { base64ToBytes, type MandatoryWorkerAnchor } from '../src/lib/mandatoryPdfOverlay';

type Props = {
  documentId: string;
  title: string;
  obra: string;
  documentType?: string;
  anchors: MandatoryWorkerAnchor[];
  signedWorkerIds?: number[];
  onCancel: () => void;
  onSave: (anchors: MandatoryWorkerAnchor[]) => Promise<void> | void;
  onRemoveWorker?: (workerId: number) => Promise<void> | void;
};

export const MandatoryPdfAnchorEditor: React.FC<Props> = ({ documentId, title, obra, documentType, anchors, signedWorkerIds = [], onCancel, onSave, onRemoveWorker }) => {
  const [draft,setDraft]=useState<MandatoryWorkerAnchor[]>(()=>anchors.map(anchor=>({...anchor})));
  const [index,setIndex]=useState(0);
  const [pdf,setPdf]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [removing,setRemoving]=useState(false);
  const [error,setError]=useState('');
  const [feedback,setFeedback]=useState('');
  const [pages,setPages]=useState<{page:number;width:number;height:number}[]>([]);
  const [availableWorkers,setAvailableWorkers]=useState<any[]>([]);
  const [manualName,setManualName]=useState('');
  const [zoom,setZoom]=useState(1);
  const [mobilePanel,setMobilePanel]=useState<'controls'|'pdf'>('controls');
  const [fitWidth,setFitWidth]=useState(true);
  const [pdfPanelWidth,setPdfPanelWidth]=useState(0);
  const pdfPanelRef=useRef<HTMLDivElement>(null);
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const viewportRef=useRef<any>(null);
  const renderTaskRef=useRef<any>(null);
  const current=draft[index]||null;
  const signedIds=useMemo(()=>new Set(signedWorkerIds.map(Number)),[signedWorkerIds]);
  const currentIdentityLocked=Boolean(current&&signedIds.has(Number(current.workerId)));

  const viewportPoint=(viewport:any,pdfX:number,pdfY:number)=>{
    const t=Array.isArray(viewport?.transform)?viewport.transform:[1,0,0,1,0,0];
    return [
      t[0]*pdfX+t[2]*pdfY+t[4],
      t[1]*pdfX+t[3]*pdfY+t[5],
    ] as [number,number];
  };

  const pdfPointFromViewport=(viewport:any,viewX:number,viewY:number)=>{
    const t=Array.isArray(viewport?.transform)?viewport.transform:[1,0,0,1,0,0];
    const det=t[0]*t[3]-t[1]*t[2];
    if(!det)return [viewX,viewY] as [number,number];
    const dx=viewX-t[4],dy=viewY-t[5];
    return [
      ( t[3]*dx-t[2]*dy)/det,
      (-t[1]*dx+t[0]*dy)/det,
    ] as [number,number];
  };

  useEffect(()=>{
    let cancelled=false;
    if(documentType==='control_presencia'){
      setAvailableWorkers([]);
      return()=>{cancelled=true;};
    }
    (async()=>{
      try{
        const rows=await supabase.query('trabajadores',{
          query:`obra=eq.${encodeURIComponent(obra)}&select=id,apellidos_nombre,dni,categoria&order=apellidos_nombre.asc&limit=2000`,
        });
        if(!cancelled)setAvailableWorkers(Array.isArray(rows)?rows:[]);
      }catch(e:any){
        if(!cancelled)setError(e?.message||'No se pudo cargar la relación de trabajadores de la obra.');
      }
    })();
    return()=>{cancelled=true;};
  },[obra,documentType]);

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try{
        setLoading(true);
        const source=await getSupervisorMandatoryPdf(documentId,'original');
        const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
        if(!pdfjs.GlobalWorkerOptions.workerSrc)pdfjs.GlobalWorkerOptions.workerSrc=pdfWorkerUrl;
        const loaded=await pdfjs.getDocument({data:base64ToBytes(source.base64),useSystemFonts:true}).promise;
        const geometry=await Promise.all(Array.from({length:loaded.numPages},async(_,i)=>{const page=await loaded.getPage(i+1);const box=page.view;return {page:i+1,width:Number(box[2])-Number(box[0]),height:Number(box[3])-Number(box[1])};}));
        if(!cancelled){setPdf(loaded);setPages(geometry);}
      }catch(e:any){
        if(!cancelled)setError(e?.message||'No se pudo abrir el PDF original.');
      }finally{
        if(!cancelled)setLoading(false);
      }
    })();
    return()=>{cancelled=true;};
  },[documentId]);

  useEffect(()=>{
    const panel=pdfPanelRef.current;
    if(!panel)return;
    const measure=()=>{
      const style=window.getComputedStyle(panel);
      const width=panel.clientWidth-parseFloat(style.paddingLeft||'0')-parseFloat(style.paddingRight||'0');
      setPdfPanelWidth(Math.max(0,Math.floor(width)));
    };
    measure();
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(measure):null;
    observer?.observe(panel);
    window.addEventListener('resize',measure);
    return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};
  },[]);

  const currentPage=Math.max(1,Number(current?.page||1));
  const pageCount=Number(pdf?.numPages||1);

  useEffect(()=>{
    if(!pdf||!current||!canvasRef.current)return;
    let cancelled=false;
    let renderTask:any=null;
    (async()=>{
      // PDF.js owns the canvas until the previous render has finished cancelling.
      const previous=renderTaskRef.current;
      if(previous)await previous.promise.catch(()=>{});
      if(cancelled)return;
      const page=await pdf.getPage(Math.min(currentPage,pdf.numPages));
      if(cancelled||!canvasRef.current)return;
      const base=page.getViewport({scale:1});
      const availableWidth=pdfPanelWidth||Math.max(1,window.innerWidth-32);
      const baseFit=Math.max(0.1,Math.min(1.8,availableWidth/base.width));
      const scale=fitWidth?baseFit:Math.max(0.35,Math.min(2.5,zoom));
      const viewport=page.getViewport({scale});
      viewportRef.current=viewport;
      const canvas=canvasRef.current!;
      canvas.width=Math.ceil(viewport.width);
      canvas.height=Math.ceil(viewport.height);
      const ctx=canvas.getContext('2d');
      if(!ctx)return;
      renderTask=page.render({canvas,canvasContext:ctx,viewport});
      renderTaskRef.current=renderTask;
      try{await renderTask.promise;}finally{if(renderTaskRef.current===renderTask)renderTaskRef.current=null;}
      if(cancelled)return;

      for(const anchor of draft.filter(anchor=>anchor.page===currentPage&&anchor.resolved&&anchor.signatureX!=null&&anchor.signatureY!=null)){
        const selected=anchor===current;
        const p1=viewportPoint(viewport,Number(anchor.signatureX),Number(anchor.signatureY));
        const p2=viewportPoint(
          viewport,
          Number(anchor.signatureX)+Number(anchor.signatureWidth||110),
          Number(anchor.signatureY)+Number(anchor.signatureHeight||32),
        );
        const left=Math.min(p1[0],p2[0]);
        const top=Math.min(p1[1],p2[1]);
        const width=Math.abs(p2[0]-p1[0]);
        const height=Math.abs(p2[1]-p1[1]);
        ctx.save();
        ctx.strokeStyle=selected?'#00548E':'#64748b';
        ctx.lineWidth=selected?3:1;
        ctx.setLineDash([8,5]);
        ctx.strokeRect(left,top,width,height);
        ctx.fillStyle='rgba(0,84,142,0.10)';
        ctx.fillRect(left,top,width,height);
        ctx.restore();
      }
    })().catch(e=>{if(!cancelled&&e?.name!=='RenderingCancelledException')setError(e?.message||'No se pudo representar la página.');});
    return()=>{cancelled=true;renderTask?.cancel();};
  },[pdf,current,draft,currentPage,zoom,fitWidth,pdfPanelWidth]);

  const readPageGeometry=async()=>{
    if(!pdf)throw new Error('Espera a que se cargue el PDF original.');
    return Promise.all(Array.from({length:pdf.numPages},async(_,index)=>{
      const page=await pdf.getPage(index+1);const box=page.view;
      return {page:index+1,width:Number(box[2])-Number(box[0]),height:Number(box[3])-Number(box[1])};
    }));
  };
  const suggestPositions=async()=>{
    setSaving(true);setError('');
    try {
      const pages=await readPageGeometry();
      const suggested=suggestSafeMandatorySignaturePositions(draft,pages,true);
      setDraft(suggested);
      const validation=validateMandatorySignaturePlacement(suggested,pages);
      setFeedback(validation.ok?'Posiciones ajustadas. Revisa el resultado antes de enviarlo.':'Se han ajustado las filas que permiten una corrección segura. Revisa los avisos de cada trabajador.');
    } catch(e:any){setError(e?.message||'No se pudieron ajustar las posiciones.');}
    finally{setSaving(false);}
  };

  const validation=useMemo(()=>pages.length?validateMandatorySignaturePlacement(draft,pages):{ok:false,issues:[]},[draft,pages]);
  const blockingIssues=blockingMandatorySignatureIssues(validation.issues);
  const currentIssues=validation.issues.filter(issue=>issue.workerId===current?.workerId);
  const currentOverlapIssues=currentIssues.filter(issue=>issue.code==='OVERLAP_SIGNATURE');
  const currentReviewIssues=currentIssues.filter(issue=>issue.code!=='OVERLAP_SIGNATURE');
  const conflictIds=new Set(validation.issues.map(issue=>issue.workerId));
  const nextConflict=()=>{const candidates=draft.map((_,i)=>(index+i+1)%draft.length);const next=candidates.find(i=>conflictIds.has(draft[i].workerId));if(next!=null)setIndex(next);};
  const unresolved=useMemo(()=>draft.filter(anchor=>!anchor.resolved).length,[draft]);

  const selectPage=(value:number)=>{
    if(!current||saving||removing||loading)return;
    if(currentIdentityLocked){setError('Revoca la firma antes de cambiar la página del trabajador.');return;}
    setDraft(list=>list.map((anchor,i)=>i===index?{...anchor,page:Math.max(1,Math.min(pageCount,value)),resolved:false}:anchor));
  };

  const assignCurrentWorker=(workerId:number)=>{
    if(saving||removing||loading)return;
    if(currentIdentityLocked){
      setError('Este trabajador ya ha firmado y su identidad no puede cambiarse.');
      return;
    }
    const worker=availableWorkers.find(row=>Number(row.id)===Number(workerId));
    if(!worker||!current)return;
    const duplicate=draft.some((anchor,i)=>i!==index&&String(anchor.workerName).trim().toLocaleLowerCase('es')===String(worker.apellidos_nombre).trim().toLocaleLowerCase('es'));
    if(duplicate){
      setError('Ese trabajador ya está asociado a otra línea del documento.');
      return;
    }
    setError('');
    setDraft(list=>list.map((anchor,i)=>i===index?{
      ...anchor,
      workerName:String(worker.apellidos_nombre||''),
      dni:String(worker.dni||''),
      resolved:Boolean(anchor.signatureX!=null&&anchor.signatureY!=null&&anchor.signatureWidth&&anchor.signatureHeight),
      reason:anchor.signatureX!=null&&anchor.signatureY!=null
        ? 'Identidad confirmada por el supervisor.'
        : 'Identidad confirmada; falta indicar la zona de firma.',
    }:anchor));
  };

  const addManualWorker=()=>{
    if(saving||removing||loading)return;
    const name=manualName.replace(/\s+/g,' ').trim();
    if(name.length<3){
      setError('Escribe el nombre y apellidos tal como aparecen en el PDF.');
      return;
    }
    const normalized=name.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const duplicate=draft.some(anchor=>String(anchor.workerName||'').trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'')===normalized);
    if(duplicate){
      setError('Ese trabajador ya figura en este documento.');
      return;
    }
    const used=new Set(draft.map(anchor=>Number(anchor.workerId)));
    let temporaryId=-(Date.now()+draft.length+1);
    while(used.has(temporaryId))temporaryId-=1;
    const next:MandatoryWorkerAnchor={
      workerId:temporaryId,
      documentWorkerId:crypto.randomUUID(),
      draftNew:true,
      workerName:name,
      dni:'',
      page:currentPage,
      order:draft.length,
      nameX:null,
      nameY:null,
      rowHeight:null,
      signatureX:null,
      signatureY:null,
      signatureWidth:90,
      signatureHeight:12,
      confidence:0,
      resolved:false,
      reason:'Trabajador recuperado manualmente del PDF: toca su zona de firma.',
    };
    setDraft(list=>[...list,next]);
    setIndex(draft.length);
    setManualName('');
    setError('');
  };

  const removeCurrentWorker=async()=>{
    if(!current||!onRemoveWorker||removing||saving||loading)return;
    setRemoving(true);
    setError('');setFeedback('');
    try{
      const workerId=Number(current.workerId);
      if(!current.draftNew)await onRemoveWorker(workerId);
      const nextDraft=draft.filter((_,i)=>i!==index).map((anchor,i)=>({...anchor,order:i}));
      setDraft(nextDraft);
      setIndex(nextDraft.length?Math.min(index,nextDraft.length-1):0);
      setFeedback(nextDraft.length
        ? `${current.workerName||'Trabajador'} eliminado del documento. Ya no cuenta como firma pendiente.`
        : 'El documento se ha quedado sin trabajadores válidos.');
    }catch(e:any){
      setError(e?.message||'No se pudo eliminar el trabajador del documento.');
    }finally{
      setRemoving(false);
    }
  };

  const handleCanvasClick=(event:React.MouseEvent<HTMLCanvasElement>)=>{
    if(!current||!viewportRef.current||!canvasRef.current||saving||removing||loading)return;
    const canvas=canvasRef.current;
    const rect=canvas.getBoundingClientRect();
    const x=(event.clientX-rect.left)*(canvas.width/rect.width);
    const y=(event.clientY-rect.top)*(canvas.height/rect.height);
    const [pdfX,pdfY]=pdfPointFromViewport(viewportRef.current,x,y);
    const viewBox=viewportRef.current.viewBox||[0,0,595,842];
    const pageWidth=Math.abs(Number(viewBox[2]||595)-Number(viewBox[0]||0));
    const pageHeight=Math.abs(Number(viewBox[3]||842)-Number(viewBox[1]||0));
    const boxWidth=Math.min(pageWidth-8,Number(current.signatureWidth||90));
    const boxHeight=Math.min(pageHeight-8,Number(current.signatureHeight||12));
    const signatureX=Math.max(4,Math.min(pageWidth-boxWidth-4,pdfX-boxWidth/2));
    const signatureY=Math.max(4,Math.min(pageHeight-boxHeight-4,pdfY-boxHeight/2));
    setDraft(list=>list.map((anchor,i)=>i===index?{
      ...anchor,
      page:currentPage,
      signatureX,
      signatureY,
      signatureWidth:boxWidth,
      signatureHeight:boxHeight,
      resolved:Number(current.workerId)!==0,
      confidence:Number(current.workerId)!==0?1:0,
      reason:'Posición confirmada manualmente por el supervisor.',
    }:anchor));
  };

  return <ModalPortal label="Ajustar firmas"><div data-mobile-panel={mobilePanel} className="mandatory-anchor-editor fixed inset-0 flex h-[100dvh] flex-col bg-slate-950/90 p-0 sm:p-3">
    <div className="mandatory-editor-shell mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col overflow-hidden bg-white text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-slate-50 sm:rounded-3xl">
      <div className="mandatory-editor-header flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-wide text-[#00548E] dark:text-blue-200">Ajustar firmas manualmente</div>
          <h2 className="text-lg font-black">{title}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">Selecciona un trabajador y toca justo a la derecha de su nombre y apellidos. Esa será la posición exacta de su firma.</p>
        </div>
        <button type="button" onClick={onCancel} className="min-h-[44px] rounded-xl border px-4 py-2 text-sm font-black">Cerrar</button>
      </div>

      <nav className="mandatory-editor-mobile-tabs" aria-label="Panel de ajuste de firmas">
        <button type="button" aria-pressed={mobilePanel==='controls'} onClick={()=>setMobilePanel('controls')}>Trabajador y ajustes</button>
        <button type="button" aria-pressed={mobilePanel==='pdf'} onClick={()=>setMobilePanel('pdf')}>PDF y posición de firma</button>
      </nav>
      <div className="mandatory-editor-main">
        <aside className="mandatory-editor-controls border-b p-4">
          <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
            <div className="text-xs font-black uppercase text-slate-500 dark:text-slate-300">Trabajador {index+1} de {draft.length}</div>
            <div className="mt-1 text-base font-black">{current?.workerName||'Sin identificar'}</div>
            <div className="text-sm text-slate-600 dark:text-slate-300">{current?.dni||''}</div>
            <div className={`mt-2 text-sm font-black ${current?.resolved?'text-emerald-700 dark:text-emerald-300':'text-amber-700 dark:text-amber-300'}`}>{current?.resolved?'✓ Identidad y posición confirmadas':'Confirmación pendiente'}</div>
          </div>

          {documentType!=='control_presencia'&&<label className="mt-4 block text-sm font-black">Trabajador asociado a esta línea
            <select
              value={String(availableWorkers.find(worker=>String(worker.apellidos_nombre).trim().toLocaleLowerCase('es')===String(current?.workerName).trim().toLocaleLowerCase('es'))?.id||'')}
              onChange={event=>assignCurrentWorker(Number(event.target.value))}
              disabled={currentIdentityLocked}
              className="mt-2 min-h-[48px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-50 disabled:bg-slate-100 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
            >
              <option value="">Seleccionar trabajador…</option>
              {availableWorkers.map(worker=><option key={worker.id} value={String(worker.id)}>{worker.apellidos_nombre} · {worker.dni||'Sin DNI'}</option>)}
            </select>
          </label>}
          {currentIdentityLocked&&<div className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-300">La identidad está bloqueada porque esta persona ya ha firmado. Sí puedes ajustar su zona de firma.</div>}

          <label className="mt-4 block text-sm font-black">Página
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={()=>selectPage(currentPage-1)} disabled={currentPage<=1} className="h-11 w-11 rounded-xl border font-black disabled:opacity-30">−</button>
              <div className="flex-1 rounded-xl border px-3 py-2.5 text-center font-black">{currentPage} / {pageCount}</div>
              <button type="button" onClick={()=>selectPage(currentPage+1)} disabled={currentPage>=pageCount} className="h-11 w-11 rounded-xl border font-black disabled:opacity-30">+</button>
            </div>
          </label>

          {current&&<div className="mandatory-editor-dimensions mt-4 grid grid-cols-2 gap-2">{(['signatureWidth','signatureHeight'] as const).map((field,i)=><label key={field} className="text-sm font-bold">{i===0?'Ancho de firma':'Alto de firma'}<input type="number" min={i===0?28:8} max={i===0?160:40} value={current[field]|| (i===0?90:12)} onChange={event=>{const value=Number(event.target.value);if(!Number.isFinite(value)||value<(i===0?28:8)||value>(i===0?160:40))return;setDraft(list=>list.map((anchor,n)=>n===index?{...anchor,[field]:value}:anchor));}} className="mt-1 min-h-[44px] w-full rounded-xl border bg-white px-2 text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-50"/></label>)}</div>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" disabled={index<=0} onClick={()=>setIndex(i=>Math.max(0,i-1))} className="min-h-[48px] rounded-xl border px-3 py-2 text-sm font-black disabled:opacity-30">Anterior</button>
            <button type="button" disabled={index>=draft.length-1} onClick={()=>setIndex(i=>Math.min(draft.length-1,i+1))} className="min-h-[48px] rounded-xl border px-3 py-2 text-sm font-black disabled:opacity-30">Siguiente</button>
          </div>
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/40">
            <label className="block text-xs font-black uppercase tracking-wide text-[#00548E] dark:text-blue-200">Trabajador omitido por el reconocimiento
              <input value={manualName} onChange={event=>setManualName(event.target.value)} placeholder="Nombre y apellidos exactamente como aparecen en el PDF" className="mt-2 min-h-[48px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-50"/>
            </label>
            <button type="button" onClick={addManualWorker} className="mt-2 min-h-[48px] w-full rounded-xl border border-[#00548E] bg-white px-3 py-2 text-sm font-black text-[#00548E] dark:border-blue-400 dark:bg-slate-800 dark:text-blue-200">Añadir trabajador del PDF</button>
            <div className="mt-2 text-xs font-semibold leading-5 text-slate-600 dark:text-slate-300">Se añadirá solo a este documento. Después toca en el PDF, a la derecha de su nombre, para fijar la firma.</div>
          </div>
          <button
            type="button"
            disabled={!current||!onRemoveWorker||removing}
            onClick={()=>void removeCurrentWorker()}
            className="mt-2 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-black text-rose-700 dark:border-rose-700 dark:bg-rose-950/70 dark:text-rose-100 disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4 shrink-0"/>{removing?'Eliminando…':'Eliminar trabajador del documento'}
          </button>

          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm leading-5 text-slate-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-100">
            El recuadro azul marca dónde se colocará la firma. Colócalo en la misma línea del trabajador, inmediatamente a la derecha de su nombre. El PDF original no se mueve ni se rediseña.
          </div>
          {feedback&&<div role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{feedback}</div>}
          {currentOverlapIssues.length>0&&<div role="status" className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-100"><strong>Solapamiento entre firmas · Informativo</strong><p className="mt-2">Puedes guardar los trabajadores añadidos y las posiciones tal como están. Este aviso no bloquea el guardado ni pide confirmación.</p></div>}
          {currentReviewIssues.length>0&&<div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><strong>Avisos de esta firma</strong><ul className="mt-2 list-disc pl-4">{currentReviewIssues.map((issue,i)=><li key={i}>{issue.message}</li>)}</ul><p className="mt-2">Puedes guardar el borrador y continuar la revisión antes de enviarlo al portal.</p></div>}
          {conflictIds.size>0&&<button type="button" onClick={nextConflict} className="mt-2 min-h-[44px] w-full rounded-xl border border-amber-400 px-3 text-sm font-bold">Ir al siguiente trabajador pendiente ({conflictIds.size})</button>}
          {error&&<div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800 dark:border-rose-800 dark:bg-rose-950/70 dark:text-rose-100">{error}</div>}
        </aside>

        <div className="mandatory-editor-preview flex min-h-0 flex-col bg-slate-200 dark:bg-slate-950">
          <div className="mandatory-editor-toolbar flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <div className="mandatory-editor-pages">
              <button type="button" onClick={()=>selectPage(currentPage-1)} disabled={currentPage<=1} className="min-h-[42px] rounded-xl border px-3 py-2 text-sm font-black disabled:opacity-30">← Página anterior</button>
              <div className="min-w-[78px] rounded-xl bg-slate-100 px-3 py-2 text-center text-sm font-black dark:bg-slate-800 dark:text-slate-50">{currentPage} / {pageCount}</div>
              <button type="button" onClick={()=>selectPage(currentPage+1)} disabled={currentPage>=pageCount} className="min-h-[42px] rounded-xl border px-3 py-2 text-sm font-black disabled:opacity-30">Página siguiente →</button>
            </div>
            <div className="mandatory-editor-zoom flex items-center gap-2">
              <button type="button" onClick={()=>{setFitWidth(false);setZoom(value=>Math.max(.35,Number((value-.15).toFixed(2))))}} className="h-10 min-w-10 rounded-xl border px-3 font-black">−</button>
              <button type="button" onClick={()=>{setFitWidth(true);setZoom(1)}} className={`h-10 rounded-xl border px-3 text-xs font-black ${fitWidth?'border-[#00548E] bg-blue-50 text-[#00548E]':''}`}>Ajustar</button>
              <button type="button" onClick={()=>{setFitWidth(false);setZoom(value=>Math.min(2.5,Number((value+.15).toFixed(2))))}} className="h-10 min-w-10 rounded-xl border px-3 font-black">+</button>
            </div>
          </div>
          <div ref={pdfPanelRef} className="mandatory-editor-pdf-scroll min-h-0 flex-1 overflow-auto p-2 sm:p-4">
            {loading
              ? <div className="p-10 text-center font-bold">Abriendo PDF original…</div>
              : <div className="mandatory-editor-canvas mx-auto w-max max-w-none pb-4">
                  <canvas
                    ref={canvasRef}
                    onClick={handleCanvasClick}
                    className="block max-w-none cursor-crosshair bg-white shadow-xl"
                  />
                  <div className="mandatory-editor-pdf-hint mt-3 rounded-xl bg-white/90 px-3 py-2 text-center text-xs font-bold text-slate-600">
                    Desplázate por la página y toca exactamente donde debe quedar la firma.
                  </div>
                </div>}
          </div>
        </div>
      </div>

      <div className="mandatory-editor-footer shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900" style={{paddingBottom:'max(12px, env(safe-area-inset-bottom))'}}> 
        <div className={`text-sm font-black ${unresolved||blockingIssues.length?'text-amber-700 dark:text-amber-300':'text-emerald-700 dark:text-emerald-300'}`}>{unresolved? `${unresolved} posición(es) pendiente(s)` : blockingIssues.length?'Hay posiciones que revisar antes de enviar':validation.ok?'Posiciones comprobadas: sin conflictos':'Solapamiento informativo: puedes guardar'}</div>
        <button type="button" disabled={loading||saving} onClick={()=>void suggestPositions()} className="min-h-[52px] rounded-xl border border-blue-300 px-4 py-3 text-sm font-black text-[#00548E] dark:text-blue-200 disabled:opacity-50">Ajustar automáticamente dentro de cada fila</button>
        <button type="button" disabled={loading||saving||removing} onClick={async()=>{
          setSaving(true);setError('');
          try{await onSave(draft);}catch(e:any){setError(e?.message||'No se pudieron guardar las posiciones.');}
          finally{setSaving(false);}
        }} className="min-h-[52px] rounded-xl bg-[#00548E] px-5 py-3 text-base font-black text-white disabled:bg-slate-300">{saving?'Guardando…':'Guardar trabajadores y posiciones'}</button>
      </div>
    </div>
  </div></ModalPortal>;
};

export default MandatoryPdfAnchorEditor;


