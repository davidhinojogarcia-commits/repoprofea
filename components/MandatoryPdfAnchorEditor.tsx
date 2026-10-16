import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import ModalPortal from './ModalPortal';
import MandatoryPdfViewport from './MandatoryPdfViewport';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { getSupervisorMandatoryPdf, loadForemanSignatureTemplate } from '../src/services/foremanPortalService';
import { createForemanTemplate, repeatForemanSignature, type ForemanSignatureTemplate } from '../src/lib/foremanSignatureTemplate';
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
  onSave: (anchors: MandatoryWorkerAnchor[], foremanTemplate?:ForemanSignatureTemplate) => Promise<void> | void;
  onRemoveWorker?: (workerId: number) => Promise<void> | void;
};

export const MandatoryPdfAnchorEditor: React.FC<Props> = ({ documentId, title, obra, documentType, anchors, signedWorkerIds = [], onCancel, onSave, onRemoveWorker }) => {
  const [draft,setDraft]=useState<MandatoryWorkerAnchor[]>(()=>anchors.map(anchor=>({...anchor})));
  const [index,setIndex]=useState(0);
  const [previewPage,setPreviewPage]=useState(1);
  const [pdf,setPdf]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [removing,setRemoving]=useState(false);
  const [error,setError]=useState('');
  const [feedback,setFeedback]=useState('');
  const [pages,setPages]=useState<{page:number;width:number;height:number;rotation?:number}[]>([]);
  const [availableWorkers,setAvailableWorkers]=useState<any[]>([]);
  const [modelKey,setModelKey]=useState(String(documentType||'documento')+':modelo-habitual');
  const [foremanTemplate,setForemanTemplate]=useState<ForemanSignatureTemplate|null>(null);
  const [foremanSelected,setForemanSelected]=useState(false);
  const [manualName,setManualName]=useState('');
  const [toolsHidden,setToolsHidden]=useState(false);
  const [pageRequest,setPageRequest]=useState<{page:number;sequence:number;focusSignature?:boolean}>({page:1,sequence:0});
  const saveInFlight=useRef(false);
  const [mobilePanel,setMobilePanel]=useState<'controls'|'pdf'>('controls');
  const employment=['contrato','prorroga'].includes(String(documentType));
  const current=draft[index]||null;
  const signedIds=useMemo(()=>new Set(signedWorkerIds.map(Number)),[signedWorkerIds]);
  const currentIdentityLocked=Boolean(current&&signedIds.has(Number(current.workerId)));

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
    let cancelled=false,loaded:any=null,task:any=null;
    (async()=>{
      try{
        setLoading(true);setError('');
        const source=await getSupervisorMandatoryPdf(documentId,'original');
        if(cancelled)return;
        const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
        if(cancelled)return;
        if(!pdfjs.GlobalWorkerOptions.workerSrc)pdfjs.GlobalWorkerOptions.workerSrc=pdfWorkerUrl;
        task=pdfjs.getDocument({data:base64ToBytes(source.base64),useSystemFonts:true});
        loaded=await task.promise;
        if(cancelled){await task.destroy?.();return;}
        const geometry=await Promise.all(Array.from({length:loaded.numPages},async(_,i)=>{const page=await loaded.getPage(i+1);const box=page.view;return {page:i+1,width:Number(box[2])-Number(box[0]),height:Number(box[3])-Number(box[1]),rotation:Number(page.rotate||0)};}));
        if(!cancelled){setPdf(loaded);setPages(geometry);}
      }catch(e:any){if(!cancelled)setError(e?.message||'No se pudo abrir el PDF original.');}
      finally{if(!cancelled)setLoading(false);}
    })();
    return()=>{cancelled=true;setPdf(null);void (task?.destroy?.()??loaded?.destroy?.());};
  },[documentId]);
  const currentPage=previewPage;
  const pageCount=Number(pdf?.numPages||1);
  useEffect(()=>{
    let active=true;
    void loadForemanSignatureTemplate(documentId,modelKey).then((value:any)=>{
      if(!active)return;
      if(value&&value.templateKey===modelKey){setForemanTemplate(value);setFeedback('Plantilla recuperada. Comprueba su posición en el PDF antes de guardar.');}
      else setForemanTemplate(null);
    }).catch((e:any)=>{if(active)setError(e?.message||'No se pudo recuperar la plantilla de firma del encargado.');});
    return()=>{active=false;};
  },[documentId,modelKey]);
  const foremanBox=useMemo(()=>{
    if(!foremanTemplate?.enabled||!pages.length)return null;
    try{
      const rectangle=repeatForemanSignature(foremanTemplate,pages.map(page=>({width:page.width,height:page.height})))[Math.max(0,previewPage-1)];
      return rectangle||null;
    }catch{return null;}
  },[foremanTemplate,pages,previewPage]);
  const foremanPreviewAnchor=foremanBox?{
    workerId:-999999999,workerName:'ENCARGADO',dni:'',page:previewPage,order:draft.length,
    nameX:null,nameY:null,rowHeight:null,
    signatureX:foremanBox.x,signatureY:foremanBox.y,signatureWidth:foremanBox.width,signatureHeight:foremanBox.height,
    resolved:true,confidence:1,reason:'Firma del encargado en todas las páginas',
  } as MandatoryWorkerAnchor:null;
  useEffect(()=>{if(current){setPreviewPage(current.page);setPageRequest(p=>({page:current.page,sequence:p.sequence+1}));}},[index]);

  const readPageGeometry=async()=>{
    if(!pdf)throw new Error('Espera a que se cargue el PDF original.');
    return Promise.all(Array.from({length:pdf.numPages},async(_,index)=>{
      const page=await pdf.getPage(index+1);const box=page.view;
      return {page:index+1,width:Number(box[2])-Number(box[0]),height:Number(box[3])-Number(box[1])};
    }));
  };
  const suggestPositions=async()=>{
    if(employment){setPageRequest(p=>({page:current?.page||previewPage,sequence:p.sequence+1,focusSignature:true}));setMobilePanel('pdf');setFeedback('Revisa el recuadro sugerido. Activa Mover firma para corregirlo.');return;}
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
  const currentRowIssues=currentIssues.filter(issue=>issue.code==='CLOSER_TO_OTHER_WORKER');
  const currentReviewIssues=blockingMandatorySignatureIssues(currentIssues);
  const conflictIds=new Set(validation.issues.map(issue=>issue.workerId));
  const nextConflict=()=>{const candidates=draft.map((_,i)=>(index+i+1)%draft.length);const next=candidates.find(i=>conflictIds.has(draft[i].workerId));if(next!=null)setIndex(next);};
  const unresolved=useMemo(()=>draft.filter(anchor=>!anchor.resolved).length,[draft]);

  const selectPage=(value:number)=>{
    const page=Math.max(1,Math.min(pageCount,value));
    setPreviewPage(page);setPageRequest(p=>({page,sequence:p.sequence+1}));
  };
  const changeAnchorBox=(target:number,box:{signatureX:number;signatureY:number;signatureWidth:number;signatureHeight:number},page:number)=>{
    if(saving||removing||loading)return;
    setDraft(list=>list.map((anchor,i)=>i===target?{...anchor,...box,page,resolved:Number(anchor.workerId)!==0,
      confidence:Number(anchor.workerId)!==0?1:0,reason:'Posición confirmada manualmente por el supervisor.'}:anchor));
  };
  const detectForemanSignature=async()=>{
    if(!pdf)return;
    setSaving(true);setError('');
    try{
      const page=await pdf.getPage(1);
      const meta=pages.find(p=>p.page===1);
      if(!meta)throw new Error('No se han cargado las dimensiones de la primera hoja.');
      const content=await page.getTextContent();
      const lines=new Map<number,any[]>();
      for(const item of content.items as any[]){
        if(!item?.str||!Array.isArray(item.transform))continue;
        const y=Math.round(Number(item.transform[5])/5)*5;
        lines.set(y,[...(lines.get(y)||[]),item]);
      }
      const patterns=/firma\s+(?:del\s+)?encargad[oa]|el\s+encargad[oa]|fdo\.?\s*encargad[oa]|firma\s+del\s+responsable\s+de\s+obra/i;
      const candidate=[...lines.entries()].sort((a,b)=>a[0]-b[0]).map(([y,items])=>({
        y,items:items.sort((a,b)=>Number(a.transform[4])-Number(b.transform[4])),
      })).find(line=>patterns.test(line.items.map(item=>String(item.str||'')).join(' ')));
      if(!candidate){
        setFeedback('No se ha localizado una referencia inequívoca al encargado. Sitúa el recuadro manualmente; tu corrección quedará guardada para las próximas veces.');
        return;
      }
      const labelItem=candidate.items.find(item=>/encargad|responsable/i.test(String(item.str)))||candidate.items[0];
      const x=Math.min(meta.width-145,Math.max(8,Number(labelItem.transform[4])-10));
      const y=Math.min(meta.height-55,Math.max(6,candidate.y+14));
      setForemanTemplate(createForemanTemplate(modelKey,{x,y,width:Math.min(145,meta.width-x),height:45},meta,foremanTemplate||undefined));
      setPreviewPage(1);setForemanSelected(true);
      setPageRequest(p=>({page:1,sequence:p.sequence+1,focusSignature:true}));
      setMobilePanel('pdf');
      setFeedback('Posición sugerida a partir de la referencia al encargado. Revisa y ajusta el recuadro antes de guardar.');
    }catch(e:any){setError(e?.message||'No se pudo detectar la posición. Configúrala manualmente.');}
    finally{setSaving(false);}
  };
  const setForemanBox=(box:{x:number;y:number;width:number;height:number},pageNumber=previewPage)=>{
    const meta=pages.find(page=>page.page===pageNumber);
    if(!meta)return;
    try{
      setForemanTemplate(createForemanTemplate(modelKey,box,meta,foremanTemplate||undefined));
      setError('');
    }catch(e:any){setError(e?.message||'Posición de firma no válida.');}
  };
  const changeDimension=(field:'signatureX'|'signatureY'|'signatureWidth'|'signatureHeight',value:number)=>{
    if(!current||saving||removing||loading)return;
    const meta=pages.find(p=>p.page===current.page);if(!meta)return;
    const width=Math.min(meta.width,Math.max(8,field==='signatureWidth'?value:Number(current.signatureWidth||90)));
    const height=Math.min(meta.height,Math.max(4,field==='signatureHeight'?value:Number(current.signatureHeight||32)));
    setDraft(list=>list.map((anchor,i)=>i===index?{...anchor,signatureWidth:width,signatureHeight:height,
      signatureX:field==='signatureX'?Math.max(0,Math.min(meta.width-width,value)):anchor.signatureX==null?null:Math.max(0,Math.min(meta.width-width,anchor.signatureX)),
      signatureY:field==='signatureY'?Math.max(0,Math.min(meta.height-height,value)):anchor.signatureY==null?null:Math.max(0,Math.min(meta.height-height,anchor.signatureY))}:anchor));
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
    if(employment && draft.length){setError('El contrato o prórroga corresponde a un único trabajador. Corrige o elimina la identidad existente antes de añadir otra.');return;}
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

  return <ModalPortal label="Ajustar firmas" layout="fullscreen"><div data-mobile-panel={mobilePanel} data-tools-hidden={toolsHidden} className="mandatory-anchor-editor fixed inset-0 flex h-[100dvh] flex-col bg-slate-950/90 p-0 sm:p-3">
    <div className="mandatory-editor-shell mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col overflow-hidden bg-white text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-slate-50 sm:rounded-3xl">
      <div className="mandatory-editor-header flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-wide text-[#00548E] dark:text-blue-200">Ajustar firmas manualmente</div>
          <h2 className="text-lg font-black">{title}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">{employment?'Revisa el nombre del trabajador y encuadra su firma debajo del nombre, en la página correspondiente. Guarda la posición antes de enviar al portal.':'Selecciona un trabajador y toca justo a la derecha de su nombre y apellidos. Esa será la posición exacta de su firma.'}</p>
        </div>
        <button type="button" onClick={()=>{setToolsHidden(!toolsHidden);setMobilePanel(toolsHidden?'controls':'pdf');}} className="min-h-[44px] rounded-xl border px-3 py-2 text-sm font-black">{toolsHidden?'Mostrar ajustes':'Ocultar ajustes'}</button>
        <button type="button" onClick={()=>{const el=document.documentElement;if(el?.requestFullscreen)void el.requestFullscreen().catch(()=>setFeedback('El editor ya ocupa toda la pantalla disponible.'));else setFeedback('El editor ya ocupa toda la pantalla disponible.');}} className="min-h-[44px] rounded-xl border px-3 py-2 text-sm font-black">Pantalla completa</button>
        <button type="button" onClick={onCancel} className="min-h-[44px] rounded-xl border px-4 py-2 text-sm font-black">Cerrar</button>
      </div>

      <nav className="mandatory-editor-mobile-tabs" aria-label="Panel de ajuste de firmas">
        <button type="button" aria-pressed={mobilePanel==='controls'} onClick={()=>{setToolsHidden(false);setMobilePanel('controls');}}>Trabajador y ajustes</button>
        <button type="button" aria-pressed={mobilePanel==='pdf'} onClick={()=>setMobilePanel('pdf')}>PDF y posición de firma</button>
      </nav>
      <div className="mandatory-editor-main">
        <aside className="mandatory-editor-controls border-b p-4">
          <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
            <div className="text-xs font-black uppercase text-slate-500 dark:text-slate-300">{draft.length?`Trabajador ${index+1} de ${draft.length}`:'Trabajador pendiente de identificar'}</div>
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

          <label className="mt-4 block text-sm font-black">Página visible
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={()=>selectPage(currentPage-1)} disabled={currentPage<=1} className="h-11 w-11 rounded-xl border font-black disabled:opacity-30">−</button>
              <div className="flex-1 rounded-xl border px-3 py-2.5 text-center font-black">{currentPage} / {pageCount}</div>
              <button type="button" onClick={()=>selectPage(currentPage+1)} disabled={currentPage>=pageCount} className="h-11 w-11 rounded-xl border font-black disabled:opacity-30">+</button>
            </div>
          </label>

          {employment&&current&&current.signatureX!=null&&current.signatureY!=null&&<button type="button" disabled={saving||loading||removing} onClick={()=>setDraft(list=>list.map((anchor,i)=>i===index?{...anchor,resolved:true,confidence:1,reason:'Posición confirmada manualmente por el supervisor.'}:anchor))} className="mt-3 min-h-[48px] w-full rounded-xl border border-[#00548E] px-3 py-2 text-sm font-black">Confirmar zona de firma y trabajador</button>}
          <div className="mt-4 rounded-xl border-2 border-blue-200 bg-blue-50 p-3 text-slate-900">
            <div className="text-sm font-black">Firma propia del encargado · Todas las páginas</div>
            <p className="mt-1 text-xs">Modelo reutilizable: ajusta una sola vez. El mismo recuadro se repetirá en todas las hojas con dimensiones compatibles.</p>
            <label className="mt-2 block text-xs font-bold">Identificador del modelo
              <input value={modelKey} onChange={e=>setModelKey(e.target.value)} maxLength={120} className="mt-1 min-h-11 w-full rounded-lg border bg-white p-2" />
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm font-bold">
              <input type="checkbox" checked={Boolean(foremanTemplate?.enabled)} onChange={e=>{
                if(e.target.checked){
                  const page=pages.find(p=>p.page===previewPage);
                  if(page)setForemanTemplate(createForemanTemplate(modelKey,{x:page.width*0.65,y:page.height*0.08,width:page.width*0.27,height:page.height*0.07},page,foremanTemplate||undefined));
                }else if(foremanTemplate)setForemanTemplate({...foremanTemplate,enabled:false,required:false});
              }}/>Activar firma del encargado
            </label>
            {foremanTemplate?.enabled&&<>
              <label className="mt-2 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={foremanTemplate.required} onChange={e=>setForemanTemplate(t=>t?{...t,required:e.target.checked}:t)}/>Obligatoria para devolver al supervisor</label>
              <button type="button" disabled={saving||loading} onClick={()=>void detectForemanSignature()} className="mt-2 min-h-11 w-full rounded-lg border border-[#00548E] bg-white p-2 font-black text-[#00548E]">Detectar referencia al encargado en el PDF</button>
              <button type="button" onClick={()=>{setForemanSelected(true);setMobilePanel('pdf');setPageRequest(p=>({page:previewPage,sequence:p.sequence+1,focusSignature:true}));}} className="mt-2 min-h-11 w-full rounded-lg bg-[#00548E] p-2 font-black text-white">Mover y dimensionar firma del encargado en el PDF</button>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(['x','y','width','height'] as const).map(field=><label key={field} className="text-xs font-bold">{field==='x'?'X':field==='y'?'Y':field==='width'?'Ancho':'Alto'}
                  <input type="number" step="0.5" value={foremanBox?.[field]??0} onChange={e=>{
                    if(!foremanBox)return;
                    setForemanBox({...foremanBox,[field]:Number(e.target.value)},previewPage);
                  }} className="mt-1 min-h-11 w-full rounded-lg border bg-white p-2" />
                </label>)}
              </div>
            </>}
          </div>
          {current&&<><div className="mandatory-editor-dimensions mt-4 grid grid-cols-2 gap-2">
            {(['signatureWidth','signatureHeight','signatureX','signatureY'] as const).map((field,i)=><PdfNumericField key={field} label={['Ancho de firma','Alto de firma','Coordenada X','Coordenada Y'][i]} value={current[field]} disabled={saving||removing||loading} onChange={value=>changeDimension(field,value)}/>)}</div>
            <button type="button" className="mt-2 min-h-[44px] w-full rounded-xl border px-3" disabled={saving||removing||loading} onClick={()=>setDraft(list=>list.map((a,i)=>{if(i!==index)return a;const p=pages.find(p=>p.page===a.page);const w=Math.min(90,p?.width||90),h=Math.min(32,p?.height||32);return {...a,signatureWidth:w,signatureHeight:h,signatureX:a.signatureX==null?null:Math.max(0,Math.min((p?.width||595)-w,a.signatureX)),signatureY:a.signatureY==null?null:Math.max(0,Math.min((p?.height||842)-h,a.signatureY))};}))}>Restablecer tamaño</button>
            <p className="mt-1 text-xs">Dimensiones y coordenadas en puntos del PDF, independientes del zoom.</p></>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" disabled={index<=0} onClick={()=>setIndex(i=>Math.max(0,i-1))} className="min-h-[48px] rounded-xl border px-3 py-2 text-sm font-black disabled:opacity-30">Anterior</button>
            <button type="button" disabled={index>=draft.length-1} onClick={()=>setIndex(i=>Math.min(draft.length-1,i+1))} className="min-h-[48px] rounded-xl border px-3 py-2 text-sm font-black disabled:opacity-30">Siguiente</button>
          </div>
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/40">
            <label className="block text-xs font-black uppercase tracking-wide text-[#00548E] dark:text-blue-200">Trabajador omitido por el reconocimiento
              <input value={manualName} onChange={event=>setManualName(event.target.value)} placeholder="Nombre y apellidos exactamente como aparecen en el PDF" className="mt-2 min-h-[48px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-50"/>
            </label>
            <button type="button" onClick={addManualWorker} className="mt-2 min-h-[48px] w-full rounded-xl border border-[#00548E] bg-white px-3 py-2 text-sm font-black text-[#00548E] dark:border-blue-400 dark:bg-slate-800 dark:text-blue-200">Añadir trabajador del PDF</button>
            <div className="mt-2 text-xs font-semibold leading-5 text-slate-600 dark:text-slate-300">Se añadirá solo a este documento. {employment?'Después toca debajo de su nombre, en la zona de firma del PDF.':'Después toca en el PDF, a la derecha de su nombre, para fijar la firma.'}</div>
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
            El recuadro marca la zona de firma. Activa «Mover firma» para colocarlo o dimensionarlo. «Navegar por documento» permite desplazarse sin alterar las firmas. El PDF original se conserva.
          </div>
          {feedback&&<div role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{feedback}</div>}
          {currentOverlapIssues.length>0&&<div role="status" className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-100"><strong>Solapamiento entre firmas · Informativo</strong><p className="mt-2">Puedes guardar los trabajadores añadidos y las posiciones tal como están. Este aviso no bloquea el guardado ni pide confirmación.</p></div>}
          {currentRowIssues.length>0&&<div role="status" className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-100"><strong>Proximidad a otra fila · Informativo</strong><ul className="mt-2 list-disc pl-4">{currentRowIssues.map((issue,i)=><li key={i}>{issue.message}</li>)}</ul><p className="mt-2">El supervisor valida la posición al guardarla y enviar el documento. Este aviso permite guardar, enviar y generar el PDF con las coordenadas elegidas.</p></div>}
          {currentReviewIssues.length>0&&<div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><strong>Avisos de esta firma</strong><ul className="mt-2 list-disc pl-4">{currentReviewIssues.map((issue,i)=><li key={i}>{issue.message}</li>)}</ul><p className="mt-2">Puedes guardar el borrador y continuar la revisión antes de enviarlo al portal.</p></div>}
          {conflictIds.size>0&&<button type="button" onClick={nextConflict} className="mt-2 min-h-[44px] w-full rounded-xl border border-amber-400 px-3 text-sm font-bold">Ir al siguiente trabajador pendiente ({conflictIds.size})</button>}
          {error&&<div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800 dark:border-rose-800 dark:bg-rose-950/70 dark:text-rose-100">{error}</div>}
        </aside>

        <div className="mandatory-editor-preview flex min-h-0 flex-col bg-slate-200 dark:bg-slate-950">
          {loading?<div className="p-10 text-center font-bold">Abriendo PDF original…</div>:pdf?<MandatoryPdfViewport pdf={pdf} pages={pages.map(p=>({...p,rotation:p.rotation||0}))} anchors={foremanPreviewAnchor?[...draft,foremanPreviewAnchor]:draft} activeIndex={foremanSelected&&foremanPreviewAnchor?draft.length:index} disabled={saving||removing} pageRequest={pageRequest} onPageChange={setPreviewPage} onSelect={selected=>{if(selected===draft.length)setForemanSelected(true);else{setIndex(selected);setForemanSelected(false);}}} onChange={(target,box,page)=>{if(target===draft.length){setForemanBox({x:box.signatureX,y:box.signatureY,width:box.signatureWidth,height:box.signatureHeight},page);}else changeAnchorBox(target,box,page);}}/>:<div role="alert">{error||'PDF no disponible'}</div>}
        </div>
      </div>

      <div className="mandatory-editor-footer shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900" style={{paddingBottom:'max(12px, env(safe-area-inset-bottom))'}}> 
        {error&&<div role="alert" className="text-sm font-bold text-rose-700 dark:text-rose-200">{error}</div>}
        <div className={`text-sm font-black ${!draft.length||unresolved||blockingIssues.length?'text-amber-700 dark:text-amber-300':'text-emerald-700 dark:text-emerald-300'}`}>{!draft.length?'Falta identificar el trabajador del documento':unresolved? `${unresolved} posición(es) pendiente(s)` : blockingIssues.length?'Hay posiciones que revisar antes de enviar':validation.ok?'Posiciones comprobadas: sin conflictos':'Avisos informativos: puedes guardar y enviar'}</div>
        <button type="button" disabled={loading||saving} onClick={()=>void suggestPositions()} className="min-h-[52px] rounded-xl border border-blue-300 px-4 py-3 text-sm font-black text-[#00548E] dark:text-blue-200 disabled:opacity-50">{employment?'Revisar zona de firma':'Ajustar automáticamente dentro de cada fila'}</button>
        <button type="button" disabled={loading||saving||removing} onClick={async()=>{
          if(saveInFlight.current)return;saveInFlight.current=true;
          setSaving(true);setError('');
          try{await onSave(draft,foremanTemplate||undefined);}catch(e:any){setError(e?.message||'No se pudieron guardar las posiciones.');}
          finally{saveInFlight.current=false;setSaving(false);}
        }} className="min-h-[52px] rounded-xl bg-[#00548E] px-5 py-3 text-base font-black text-white disabled:bg-slate-300">{saving?'Guardando…':'Guardar trabajadores y posiciones'}</button>
      </div>
    </div>
  </div></ModalPortal>;
};

export default MandatoryPdfAnchorEditor;





const PdfNumericField:React.FC<{label:string;value:number|null;disabled:boolean;onChange:(value:number)=>void}>=({label,value,disabled,onChange})=>{
  const [text,setText]=useState(value==null?'':String(Math.round(value*100)/100));
  const focused=useRef(false);
  useEffect(()=>{if(!focused.current)setText(value==null?'':String(Math.round(value*100)/100));},[value]);
  return <label className="text-sm font-bold">{label}<input aria-label={label} type="text" inputMode="decimal" value={text} disabled={disabled}
    onFocus={()=>{focused.current=true;}} onChange={event=>{const raw=event.target.value;setText(raw);if(raw.trim()&&/^\d+(?:[.,]\d+)?$/.test(raw)){const n=Number(raw.replace(',','.'));if(Number.isFinite(n))onChange(n);}}}
    onBlur={()=>{focused.current=false;setText(value==null?'':String(Math.round(value*100)/100));}}
    className="mt-1 min-h-[44px] w-full rounded-xl border bg-white px-2 text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-50"/></label>;
}
