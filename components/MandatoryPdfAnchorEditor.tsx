import React, { useEffect, useMemo, useRef, useState } from 'react';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { getSupervisorMandatoryPdf } from '../src/services/foremanPortalService';
import { supabase } from '../src/lib/supabase';
import { base64ToBytes, type MandatoryWorkerAnchor } from '../src/lib/mandatoryPdfOverlay';

type Props = {
  documentId: string;
  title: string;
  obra: string;
  anchors: MandatoryWorkerAnchor[];
  signedWorkerIds?: number[];
  onCancel: () => void;
  onSave: (anchors: MandatoryWorkerAnchor[]) => Promise<void> | void;
};

export const MandatoryPdfAnchorEditor: React.FC<Props> = ({ documentId, title, obra, anchors, signedWorkerIds = [], onCancel, onSave }) => {
  const [draft,setDraft]=useState<MandatoryWorkerAnchor[]>(()=>anchors.map(anchor=>({...anchor})));
  const [index,setIndex]=useState(0);
  const [pdf,setPdf]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [availableWorkers,setAvailableWorkers]=useState<any[]>([]);
  const [zoom,setZoom]=useState(1);
  const [fitWidth,setFitWidth]=useState(true);
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const viewportRef=useRef<any>(null);
  const current=draft[index]||null;
  const signedIds=useMemo(()=>new Set(signedWorkerIds.map(Number)),[signedWorkerIds]);
  const currentIdentityLocked=Boolean(current&&current.workerId>0&&signedIds.has(Number(current.workerId)));

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
  },[obra]);

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try{
        setLoading(true);
        const source=await getSupervisorMandatoryPdf(documentId,'original');
        const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
        if(!pdfjs.GlobalWorkerOptions.workerSrc)pdfjs.GlobalWorkerOptions.workerSrc=pdfWorkerUrl;
        const loaded=await pdfjs.getDocument({data:base64ToBytes(source.base64),useSystemFonts:true}).promise;
        if(!cancelled)setPdf(loaded);
      }catch(e:any){
        if(!cancelled)setError(e?.message||'No se pudo abrir el PDF original.');
      }finally{
        if(!cancelled)setLoading(false);
      }
    })();
    return()=>{cancelled=true;};
  },[documentId]);

  const currentPage=Math.max(1,Number(current?.page||1));
  const pageCount=Number(pdf?.numPages||1);

  useEffect(()=>{
    if(!pdf||!current||!canvasRef.current)return;
    let cancelled=false;
    (async()=>{
      const page=await pdf.getPage(Math.min(currentPage,pdf.numPages));
      const base=page.getViewport({scale:1});
      const availableWidth=Math.max(280,Math.min(1100,(window.innerWidth>=1024?window.innerWidth-380:window.innerWidth-24)));
      const baseFit=Math.max(0.35,Math.min(1.8,availableWidth/base.width));
      const scale=fitWidth?baseFit:Math.max(0.35,Math.min(2.5,zoom));
      const viewport=page.getViewport({scale});
      viewportRef.current=viewport;
      const canvas=canvasRef.current!;
      canvas.width=Math.ceil(viewport.width);
      canvas.height=Math.ceil(viewport.height);
      const ctx=canvas.getContext('2d');
      if(!ctx)return;
      await page.render({canvas,canvasContext:ctx,viewport}).promise;
      if(cancelled)return;

      if(current.resolved&&current.signatureX!=null&&current.signatureY!=null){
        const p1=viewportPoint(viewport,Number(current.signatureX),Number(current.signatureY));
        const p2=viewportPoint(
          viewport,
          Number(current.signatureX)+Number(current.signatureWidth||110),
          Number(current.signatureY)+Number(current.signatureHeight||32),
        );
        const left=Math.min(p1[0],p2[0]);
        const top=Math.min(p1[1],p2[1]);
        const width=Math.abs(p2[0]-p1[0]);
        const height=Math.abs(p2[1]-p1[1]);
        ctx.save();
        ctx.strokeStyle='#00548E';
        ctx.lineWidth=3;
        ctx.setLineDash([8,5]);
        ctx.strokeRect(left,top,width,height);
        ctx.fillStyle='rgba(0,84,142,0.10)';
        ctx.fillRect(left,top,width,height);
        ctx.restore();
      }
    })().catch(e=>setError(e?.message||'No se pudo representar la página.'));
    return()=>{cancelled=true;};
  },[pdf,current,currentPage,zoom,fitWidth]);

  const unresolved=useMemo(()=>draft.filter(anchor=>!anchor.resolved||Number(anchor.workerId)<=0).length,[draft]);

  const selectPage=(value:number)=>{
    if(!current)return;
    setDraft(list=>list.map((anchor,i)=>i===index?{...anchor,page:Math.max(1,Math.min(pageCount,value)),resolved:false}:anchor));
  };

  const assignCurrentWorker=(workerId:number)=>{
    if(currentIdentityLocked){
      setError('Este trabajador ya ha firmado y su identidad no puede cambiarse.');
      return;
    }
    const worker=availableWorkers.find(row=>Number(row.id)===Number(workerId));
    if(!worker||!current)return;
    const duplicate=draft.some((anchor,i)=>i!==index&&Number(anchor.workerId)===Number(worker.id));
    if(duplicate){
      setError('Ese trabajador ya está asociado a otra línea del documento.');
      return;
    }
    setError('');
    setDraft(list=>list.map((anchor,i)=>i===index?{
      ...anchor,
      workerId:Number(worker.id),
      workerName:String(worker.apellidos_nombre||''),
      dni:String(worker.dni||''),
      resolved:Boolean(anchor.signatureX!=null&&anchor.signatureY!=null&&anchor.signatureWidth&&anchor.signatureHeight),
      reason:anchor.signatureX!=null&&anchor.signatureY!=null
        ? 'Identidad confirmada por el supervisor.'
        : 'Identidad confirmada; falta indicar la zona de firma.',
    }:anchor));
  };

  const addManualWorker=()=>{
    const used=new Set(draft.map(anchor=>Number(anchor.workerId)));
    const worker=availableWorkers.find(row=>!used.has(Number(row.id)));
    if(!worker){
      setError('No hay más trabajadores disponibles en esta obra para añadir.');
      return;
    }
    const next:MandatoryWorkerAnchor={
      workerId:Number(worker.id),
      workerName:String(worker.apellidos_nombre||''),
      dni:String(worker.dni||''),
      page:1,
      order:draft.length,
      nameX:null,
      nameY:null,
      rowHeight:null,
      signatureX:null,
      signatureY:null,
      signatureWidth:110,
      signatureHeight:32,
      confidence:0,
      resolved:false,
      reason:'Trabajador añadido manualmente: selecciona su página y toca la zona de firma.',
    };
    setDraft(list=>[...list,next]);
    setIndex(draft.length);
    setError('');
  };

  const handleCanvasClick=(event:React.MouseEvent<HTMLCanvasElement>)=>{
    if(!current||!viewportRef.current||!canvasRef.current)return;
    const canvas=canvasRef.current;
    const rect=canvas.getBoundingClientRect();
    const x=(event.clientX-rect.left)*(canvas.width/rect.width);
    const y=(event.clientY-rect.top)*(canvas.height/rect.height);
    const [pdfX,pdfY]=pdfPointFromViewport(viewportRef.current,x,y);
    const boxWidth=Number(current.signatureWidth||110);
    const boxHeight=Number(current.signatureHeight||32);
    const viewBox=viewportRef.current.viewBox||[0,0,595,842];
    const pageWidth=Math.abs(Number(viewBox[2]||595)-Number(viewBox[0]||0));
    const pageHeight=Math.abs(Number(viewBox[3]||842)-Number(viewBox[1]||0));
    const signatureX=Math.max(4,Math.min(pageWidth-boxWidth-4,pdfX-boxWidth/2));
    const signatureY=Math.max(4,Math.min(pageHeight-boxHeight-4,pdfY-boxHeight/2));
    setDraft(list=>list.map((anchor,i)=>i===index?{
      ...anchor,
      page:currentPage,
      signatureX,
      signatureY,
      signatureWidth:boxWidth,
      signatureHeight:boxHeight,
      resolved:Number(current.workerId)>0,
      confidence:Number(current.workerId)>0?1:0,
      reason:'Posición confirmada manualmente por el supervisor.',
    }:anchor));
  };

  return <div className="fixed inset-0 z-[13000] flex h-[100dvh] flex-col bg-slate-950/90 p-0 sm:p-3">
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col overflow-hidden bg-white shadow-2xl sm:rounded-3xl">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-[#00548E]">Ajustar zonas de firma</div>
          <h2 className="text-lg font-black">{title}</h2>
          <p className="text-sm text-slate-600">Toca en el PDF el centro de la zona donde debe aparecer la firma del trabajador seleccionado.</p>
        </div>
        <button type="button" onClick={onCancel} className="min-h-[44px] rounded-xl border px-4 py-2 text-sm font-black">Cerrar</button>
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="max-h-[42dvh] overflow-y-auto border-b p-4 lg:max-h-none lg:border-b-0 lg:border-r">
          <div className="rounded-xl bg-slate-100 p-3">
            <div className="text-xs font-black uppercase text-slate-500">Trabajador {index+1} de {draft.length}</div>
            <div className="mt-1 text-base font-black">{current?.workerName||'Sin identificar'}</div>
            <div className="text-sm text-slate-600">{current?.dni||''}</div>
            <div className={`mt-2 text-sm font-black ${current?.resolved?'text-emerald-700':'text-amber-700'}`}>{current?.resolved?'✓ Identidad y posición confirmadas':'Confirmación pendiente'}</div>
          </div>

          <label className="mt-4 block text-sm font-black">Trabajador asociado a esta línea
            <select
              value={current&&current.workerId>0?String(current.workerId):''}
              onChange={event=>assignCurrentWorker(Number(event.target.value))}
              disabled={currentIdentityLocked}
              className="mt-2 min-h-[48px] w-full rounded-xl border bg-white px-3 py-2.5 text-sm font-semibold disabled:bg-slate-100 disabled:text-slate-500"
            >
              <option value="">Seleccionar trabajador…</option>
              {availableWorkers.map(worker=><option key={worker.id} value={String(worker.id)}>{worker.apellidos_nombre} · {worker.dni||'Sin DNI'}</option>)}
            </select>
          </label>
          {currentIdentityLocked&&<div className="mt-2 text-xs font-bold text-slate-500">La identidad está bloqueada porque esta persona ya ha firmado. Sí puedes ajustar su zona de firma.</div>}

          <label className="mt-4 block text-sm font-black">Página
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={()=>selectPage(currentPage-1)} disabled={currentPage<=1} className="h-11 w-11 rounded-xl border font-black disabled:opacity-30">−</button>
              <div className="flex-1 rounded-xl border px-3 py-2.5 text-center font-black">{currentPage} / {pageCount}</div>
              <button type="button" onClick={()=>selectPage(currentPage+1)} disabled={currentPage>=pageCount} className="h-11 w-11 rounded-xl border font-black disabled:opacity-30">+</button>
            </div>
          </label>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" disabled={index<=0} onClick={()=>setIndex(i=>Math.max(0,i-1))} className="min-h-[48px] rounded-xl border px-3 py-2 text-sm font-black disabled:opacity-30">Anterior</button>
            <button type="button" disabled={index>=draft.length-1} onClick={()=>setIndex(i=>Math.min(draft.length-1,i+1))} className="min-h-[48px] rounded-xl border px-3 py-2 text-sm font-black disabled:opacity-30">Siguiente</button>
          </div>
          <button type="button" onClick={addManualWorker} className="mt-2 min-h-[48px] w-full rounded-xl border border-[#00548E] bg-white px-3 py-2 text-sm font-black text-[#00548E]">Añadir trabajador no detectado</button>

          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm leading-5 text-slate-700">
            El recuadro azul marca la única zona donde se superpondrá la firma. El PDF original no se mueve ni se rediseña.
          </div>
          {error&&<div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</div>}
        </aside>

        <div className="flex min-h-0 flex-col bg-slate-200">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-300 bg-white px-3 py-2">
            <div className="flex items-center gap-2">
              <button type="button" onClick={()=>selectPage(currentPage-1)} disabled={currentPage<=1} className="min-h-[42px] rounded-xl border px-3 py-2 text-sm font-black disabled:opacity-30">← Página anterior</button>
              <div className="min-w-[78px] rounded-xl bg-slate-100 px-3 py-2 text-center text-sm font-black">{currentPage} / {pageCount}</div>
              <button type="button" onClick={()=>selectPage(currentPage+1)} disabled={currentPage>=pageCount} className="min-h-[42px] rounded-xl border px-3 py-2 text-sm font-black disabled:opacity-30">Página siguiente →</button>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={()=>{setFitWidth(false);setZoom(value=>Math.max(.35,Number((value-.15).toFixed(2))))}} className="h-10 min-w-10 rounded-xl border px-3 font-black">−</button>
              <button type="button" onClick={()=>{setFitWidth(true);setZoom(1)}} className={`h-10 rounded-xl border px-3 text-xs font-black ${fitWidth?'border-[#00548E] bg-blue-50 text-[#00548E]':''}`}>Ajustar</button>
              <button type="button" onClick={()=>{setFitWidth(false);setZoom(value=>Math.min(2.5,Number((value+.15).toFixed(2))))}} className="h-10 min-w-10 rounded-xl border px-3 font-black">+</button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2 sm:p-4">
            {loading
              ? <div className="p-10 text-center font-bold">Abriendo PDF original…</div>
              : <div className="mx-auto w-max max-w-none pb-16">
                  <canvas
                    ref={canvasRef}
                    onClick={handleCanvasClick}
                    className="block max-w-none cursor-crosshair bg-white shadow-xl"
                  />
                  <div className="mt-3 rounded-xl bg-white/90 px-3 py-2 text-center text-xs font-bold text-slate-600">
                    Desplázate por la página y toca exactamente donde debe quedar la firma.
                  </div>
                </div>}
          </div>
        </div>
      </div>

      <div className="shrink-0 flex flex-col gap-2 border-t bg-white p-3 sm:p-4 sm:flex-row sm:items-center sm:justify-between" style={{paddingBottom:'max(12px, env(safe-area-inset-bottom))'}}> 
        <div className={`text-sm font-black ${unresolved?'text-amber-700':'text-emerald-700'}`}>{unresolved? `${unresolved} posición(es) pendiente(s)` : 'Todas las posiciones están confirmadas'}</div>
        <button type="button" disabled={saving||unresolved>0} onClick={async()=>{
          setSaving(true);setError('');
          try{await onSave(draft);}catch(e:any){setError(e?.message||'No se pudieron guardar las posiciones.');}
          finally{setSaving(false);}
        }} className="min-h-[52px] rounded-xl bg-[#00548E] px-5 py-3 text-base font-black text-white disabled:bg-slate-300">{saving?'Guardando…':'Guardar posiciones'}</button>
      </div>
    </div>
  </div>;
};

export default MandatoryPdfAnchorEditor;
