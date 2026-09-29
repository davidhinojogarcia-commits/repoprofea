import React, { useEffect, useMemo, useRef, useState } from 'react';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { getSupervisorMandatoryPdf } from '../src/services/foremanPortalService';
import { base64ToBytes, type MandatoryWorkerAnchor } from '../src/lib/mandatoryPdfOverlay';

type Props = {
  documentId: string;
  title: string;
  anchors: MandatoryWorkerAnchor[];
  onCancel: () => void;
  onSave: (anchors: MandatoryWorkerAnchor[]) => Promise<void> | void;
};

export const MandatoryPdfAnchorEditor: React.FC<Props> = ({ documentId, title, anchors, onCancel, onSave }) => {
  const [draft,setDraft]=useState<MandatoryWorkerAnchor[]>(()=>anchors.map(anchor=>({...anchor})));
  const [index,setIndex]=useState(0);
  const [pdf,setPdf]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const viewportRef=useRef<any>(null);
  const current=draft[index]||null;

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
      const maxWidth=Math.min(900,Math.max(300,window.innerWidth-40));
      const scale=Math.min(1.45,maxWidth/base.width);
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
        const rect=viewport.convertToViewportRectangle([
          Number(current.signatureX),
          Number(current.signatureY),
          Number(current.signatureX)+Number(current.signatureWidth||110),
          Number(current.signatureY)+Number(current.signatureHeight||32),
        ]);
        ctx.save();
        ctx.strokeStyle='#00548E';
        ctx.lineWidth=3;
        ctx.setLineDash([8,5]);
        ctx.strokeRect(
          Math.min(rect[0],rect[2]),
          Math.min(rect[1],rect[3]),
          Math.abs(rect[2]-rect[0]),
          Math.abs(rect[3]-rect[1]),
        );
        ctx.fillStyle='rgba(0,84,142,0.10)';
        ctx.fillRect(
          Math.min(rect[0],rect[2]),
          Math.min(rect[1],rect[3]),
          Math.abs(rect[2]-rect[0]),
          Math.abs(rect[3]-rect[1]),
        );
        ctx.restore();
      }
    })().catch(e=>setError(e?.message||'No se pudo representar la página.'));
    return()=>{cancelled=true;};
  },[pdf,current,currentPage]);

  const unresolved=useMemo(()=>draft.filter(anchor=>!anchor.resolved).length,[draft]);

  const selectPage=(value:number)=>{
    if(!current)return;
    setDraft(list=>list.map((anchor,i)=>i===index?{...anchor,page:Math.max(1,Math.min(pageCount,value)),resolved:false}:anchor));
  };

  const handleCanvasClick=(event:React.MouseEvent<HTMLCanvasElement>)=>{
    if(!current||!viewportRef.current||!canvasRef.current)return;
    const canvas=canvasRef.current;
    const rect=canvas.getBoundingClientRect();
    const x=(event.clientX-rect.left)*(canvas.width/rect.width);
    const y=(event.clientY-rect.top)*(canvas.height/rect.height);
    const [pdfX,pdfY]=viewportRef.current.convertToPdfPoint(x,y);
    const boxWidth=Number(current.signatureWidth||110);
    const boxHeight=Number(current.signatureHeight||32);
    const pageWidth=Number(viewportRef.current.viewBox?.[2]||595);
    const pageHeight=Number(viewportRef.current.viewBox?.[3]||842);
    const signatureX=Math.max(4,Math.min(pageWidth-boxWidth-4,pdfX-boxWidth/2));
    const signatureY=Math.max(4,Math.min(pageHeight-boxHeight-4,pdfY-boxHeight/2));
    setDraft(list=>list.map((anchor,i)=>i===index?{
      ...anchor,
      page:currentPage,
      signatureX,
      signatureY,
      signatureWidth:boxWidth,
      signatureHeight:boxHeight,
      resolved:true,
      confidence:1,
      reason:'Posición confirmada manualmente por el supervisor.',
    }:anchor));
  };

  return <div className="fixed inset-0 z-[13000] flex flex-col bg-slate-950/90 p-2 sm:p-4">
    <div className="mx-auto flex w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-[#00548E]">Ajustar zonas de firma</div>
          <h2 className="text-lg font-black">{title}</h2>
          <p className="text-sm text-slate-600">Toca en el PDF el centro de la zona donde debe aparecer la firma del trabajador seleccionado.</p>
        </div>
        <button type="button" onClick={onCancel} className="min-h-[44px] rounded-xl border px-4 py-2 text-sm font-black">Cerrar</button>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-b p-4 lg:border-b-0 lg:border-r">
          <div className="rounded-xl bg-slate-100 p-3">
            <div className="text-xs font-black uppercase text-slate-500">Trabajador {index+1} de {draft.length}</div>
            <div className="mt-1 text-base font-black">{current?.workerName||'Sin identificar'}</div>
            <div className="text-sm text-slate-600">{current?.dni||''}</div>
            <div className={`mt-2 text-sm font-black ${current?.resolved?'text-emerald-700':'text-amber-700'}`}>{current?.resolved?'✓ Posición confirmada':'Posición pendiente'}</div>
          </div>

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

          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm leading-5 text-slate-700">
            El recuadro azul marca la única zona donde se superpondrá la firma. El PDF original no se mueve ni se rediseña.
          </div>
          {error&&<div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</div>}
        </aside>

        <div className="min-h-0 overflow-auto bg-slate-200 p-2 sm:p-4">
          {loading?<div className="p-10 text-center font-bold">Abriendo PDF original…</div>:<canvas ref={canvasRef} onClick={handleCanvasClick} className="mx-auto cursor-crosshair bg-white shadow-xl" />}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
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
