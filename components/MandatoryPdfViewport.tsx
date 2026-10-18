import React, {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {MandatoryWorkerAnchor,MandatoryPdfPageMeta} from '../src/lib/mandatoryPdfOverlay';
import {clampPdfBox,pdfBoxToViewport,resizePdfBox,viewportToPdf,type PdfBox,type PdfBounds} from '../src/lib/pdfSignatureCoordinates';

type Props={
  pdf:any; pages:MandatoryPdfPageMeta[]; anchors:MandatoryWorkerAnchor[]; activeIndex:number;
  disabled:boolean; pageRequest:{page:number;sequence:number;focusSignature?:boolean};
  readOnly?:boolean;
  onPageChange:(page:number)=>void; onSelect:(index:number)=>void;
  onChange:(index:number,box:PdfBox,page:number)=>void;
};
type PageProps=Props&{meta:MandatoryPdfPageMeta;scale:number;mode:'navigate'|'edit';scroll:React.RefObject<HTMLDivElement|null>};
const hasBox=(a:MandatoryWorkerAnchor)=>[a.signatureX,a.signatureY,a.signatureWidth,a.signatureHeight].every(v=>v!=null&&Number.isFinite(v));

const PdfPage:React.FC<PageProps>=({pdf,meta,scale,anchors,activeIndex,mode,disabled,onSelect,onChange,scroll})=>{
  const ref=useRef<HTMLDivElement>(null),canvasRef=useRef<HTMLCanvasElement>(null);
  const taskRef=useRef<any>(null),viewportRef=useRef<any>(null);
  const [near,setNear]=useState(typeof IntersectionObserver==='undefined');
  const [viewport,setViewport]=useState<any>(null),[error,setError]=useState('');
  const rotated=Math.abs(meta.rotation%180)===90;
  const width=(rotated?meta.height:meta.width)*scale,height=(rotated?meta.width:meta.height)*scale;
  useEffect(()=>{
    if(typeof IntersectionObserver==='undefined')return;
    const observer=new IntersectionObserver(entries=>setNear(entries[0].isIntersecting),{root:scroll.current,rootMargin:'700px'});
    if(ref.current)observer.observe(ref.current);
    return()=>observer.disconnect();
  },[scroll]);
  useEffect(()=>{
    if(!pdf)return;
    let cancelled=false,task:any;
    if(!near){const previous=taskRef.current;previous?.cancel();void Promise.resolve(previous?.promise).catch(()=>{}).then(()=>{if(!cancelled&&canvasRef.current){canvasRef.current.width=1;canvasRef.current.height=1;}});return()=>{cancelled=true;};}
    (async()=>{
      const previous=taskRef.current;
      previous?.cancel();
      if(previous)await previous.promise.catch(()=>{});
      if(cancelled)return;
      const page=await pdf.getPage(meta.page);
      if(cancelled||!canvasRef.current)return;
      const view=page.getViewport({scale});
      viewportRef.current=view;setViewport(view);
      const canvas=canvasRef.current,ratio=Math.min(2,window.devicePixelRatio||1,Math.sqrt(8_000_000/(view.width*view.height)));
      canvas.width=Math.ceil(view.width*ratio);canvas.height=Math.ceil(view.height*ratio);
      const context=canvas.getContext('2d');
      if(!context)throw Error('No se pudo representar el PDF.');
      task=page.render({canvas,canvasContext:context,viewport:view,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]});
      taskRef.current=task;
      await task.promise;
      if(!cancelled)setError('');
    })().catch(e=>{if(!cancelled&&e?.name!=='RenderingCancelledException')setError(e?.message||'No se pudo representar esta página.');});
    return()=>{cancelled=true;task?.cancel();};
  },[pdf,meta.page,scale,near]);
  useEffect(()=>()=>{taskRef.current?.cancel();},[]);
  const bounds=():PdfBounds=>{
    const v=viewportRef.current?.viewBox||[0,0,meta.width,meta.height];
    return {x:v[0],y:v[1],width:v[2]-v[0],height:v[3]-v[1]};
  };
  const drag=useRef<{id:number;x:number;y:number;box:PdfBox;index:number;corner:string}|null>(null);
  const startBox=(event:React.PointerEvent,index:number,corner='')=>{
    if(disabled||mode!=='edit')return;
    event.preventDefault();event.stopPropagation();
    onSelect(index);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,box:anchors[index] as PdfBox,index,corner};
  };
  const moveBox=(event:React.PointerEvent)=>{
    const d=drag.current,v=viewportRef.current;
    if(!d||!v||event.pointerId!==d.id||disabled)return;
    event.preventDefault();event.stopPropagation();
    const rect=ref.current!.getBoundingClientRect();
    const dx=(event.clientX-d.x)*v.width/rect.width,dy=(event.clientY-d.y)*v.height/rect.height;
    let box:PdfBox;
    if(d.corner)box=resizePdfBox(v,d.box,d.corner,dx,dy,bounds());
    else {
      const a=viewportToPdf(v,0,0),b=viewportToPdf(v,dx,dy);
      box=clampPdfBox({...d.box,signatureX:d.box.signatureX+b[0]-a[0],signatureY:d.box.signatureY+b[1]-a[1]},bounds());
    }
    onChange(d.index,box,meta.page);
  };
  const endBox=(event:React.PointerEvent)=>{if(drag.current?.id===event.pointerId){drag.current=null;event.stopPropagation();}};
  const pan=useRef<{x:number;y:number;left:number;top:number;moved:boolean}|null>(null);
  const ignoreClick=useRef(false);
  const place=(event:React.MouseEvent)=>{
    const a=anchors[activeIndex],v=viewportRef.current;
    if(ignoreClick.current){ignoreClick.current=false;return;}
    if(mode!=='edit'||disabled||!a||!v)return;
    const rect=ref.current!.getBoundingClientRect();
    const [x,y]=viewportToPdf(v,(event.clientX-rect.left)*v.width/rect.width,(event.clientY-rect.top)*v.height/rect.height);
    onChange(activeIndex,clampPdfBox({signatureX:x-Number(a.signatureWidth||90)/2,signatureY:y-Number(a.signatureHeight||32)/2,
      signatureWidth:Number(a.signatureWidth||90),signatureHeight:Number(a.signatureHeight||32)},bounds()),meta.page);
  };
  return <div ref={ref} className="mandatory-pdf-page" data-pdf-page={meta.page} style={{width,height}}>
    <canvas ref={canvasRef} aria-label={'Página '+meta.page} style={{width,height,cursor:mode==='edit'?'crosshair':'grab'}}
      onClick={place}
      onPointerDown={e=>{
        ignoreClick.current=false;
        const s=scroll.current;if(!s)return;
        pan.current={x:e.clientX,y:e.clientY,left:s.scrollLeft,top:s.scrollTop,moved:false};
        if(e.pointerType==='mouse')e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={e=>{const p=pan.current,s=scroll.current;if(!p||!s)return;
        if(Math.hypot(e.clientX-p.x,e.clientY-p.y)>5){p.moved=true;ignoreClick.current=true;}
        if(p.moved&&e.pointerType==='mouse'){s.scrollLeft=p.left-(e.clientX-p.x);s.scrollTop=p.top-(e.clientY-p.y);}
      }}
      onPointerUp={()=>{pan.current=null;}}
      onPointerCancel={()=>{pan.current=null;ignoreClick.current=true;}}
    />
    {error&&<div role="alert" className="mandatory-pdf-page-error">{error}</div>}
    {viewport&&anchors.map((a,index)=>{
      if(a.page!==meta.page||!hasBox(a))return null;
      const r=pdfBoxToViewport(viewport,a as PdfBox),selected=index===activeIndex;
      return <div key={a.documentWorkerId||a.workerId} role="button" tabIndex={0} aria-label={'Firma de '+a.workerName}
        aria-pressed={selected} data-signature-index={index}
        className={'mandatory-pdf-signature-box'+(selected?' is-selected':'')+(a.resolved?'':' needs-review')}
        style={{left:r.x,top:r.y,width:r.width,height:r.height,touchAction:mode==='edit'?'none':'auto'}}
        onClick={e=>{e.stopPropagation();onSelect(index);}}
        onKeyDown={e=>{
          if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(index);return;}
          if(mode!=='edit'||disabled||!selected||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
          e.preventDefault();const step=e.shiftKey?10:1;
          onChange(index,clampPdfBox({...a,signatureX:Number(a.signatureX)+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),
            signatureY:Number(a.signatureY)+(e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0)} as PdfBox,bounds()),meta.page);
        }}
        onPointerDown={e=>startBox(e,index)} onPointerMove={moveBox} onPointerUp={endBox} onPointerCancel={endBox}
      >
        <span className="mandatory-pdf-box-label">{a.workerName}</span>
        {selected&&mode==='edit'&&!disabled&&['nw','ne','sw','se'].map(corner=><button type="button" key={corner}
          className={'mandatory-pdf-resize-handle '+corner} aria-label={'Redimensionar firma '+corner}
          onPointerDown={e=>startBox(e,index,corner)} onPointerMove={moveBox} onPointerUp={endBox} onPointerCancel={endBox}
          onClick={e=>e.stopPropagation()}/>)}
      </div>;
    })}
    <span className="mandatory-pdf-page-number">Página {meta.page}</span>
  </div>;
}

export default function MandatoryPdfViewport(props:Props){
  const {pdf,pages,anchors,activeIndex,onPageChange,pageRequest}=props;
  const scroll=useRef<HTMLDivElement>(null);
  const [mode,setMode]=useState<'navigate'|'edit'>('navigate');
  const [fit,setFit]=useState<'width'|'page'|'custom'>('width'),[zoom,setZoom]=useState(1);
  const [size,setSize]=useState({width:0,height:0}),[page,setPage]=useState(1),[tools,setTools]=useState(()=>typeof window==='undefined'||window.innerHeight>=600);
  const active=anchors[activeIndex];
  useEffect(()=>{
    const s=scroll.current;if(!s)return;
    const measure=()=>{const style=window.getComputedStyle(s);setSize({width:Math.max(1,s.clientWidth-parseFloat(style.paddingLeft||'0')-parseFloat(style.paddingRight||'0')),height:Math.max(1,s.clientHeight-parseFloat(style.paddingTop||'0')-parseFloat(style.paddingBottom||'0'))});};
    measure();const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);
    observer?.observe(s);window.addEventListener('resize',measure);
    return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};
  },[]);
  const maxWidth=Math.max(1,...pages.map(p=>Math.abs(p.rotation%180)===90?p.height:p.width));
  const maxHeight=Math.max(1,...pages.map(p=>Math.abs(p.rotation%180)===90?p.width:p.height));
  const scale=fit==='custom'?zoom:Math.max(.1,fit==='page'?Math.min(size.width/maxWidth,size.height/maxHeight):size.width/maxWidth);
  const keep=useRef<{page:number;nx:number;ny:number;cx:number;cy:number}|null>(null);
  const remember=(cx?:number,cy?:number)=>{
    const s=scroll.current;if(!s)return;
    const area=s.getBoundingClientRect(),x=cx??area.left+s.clientWidth/2,y=cy??area.top+s.clientHeight/2;
    const frames=[...s.querySelectorAll<HTMLElement>('[data-pdf-page]')];
    const frame=frames.find(f=>{const r=f.getBoundingClientRect();return r.bottom>=y&&r.top<=y;})||frames.find(f=>Number(f.dataset.pdfPage)===page);
    if(!frame)return;const r=frame.getBoundingClientRect();
    keep.current={page:Number(frame.dataset.pdfPage),nx:(x-r.left)/r.width,ny:(y-r.top)/r.height,cx:x-area.left,cy:y-area.top};
  };
  const changeZoom=(factor:number,cx?:number,cy?:number)=>{remember(cx,cy);setZoom(Math.max(.2,Math.min(4,scale*factor)));setFit('custom');};
  const fitTo=(value:'width'|'page')=>{remember();setFit(value);};
  useLayoutEffect(()=>{
    const k=keep.current,s=scroll.current;if(!k||!s)return;
    const f=s.querySelector<HTMLElement>('[data-pdf-page="'+k.page+'"]');if(!f)return;
    const r=f.getBoundingClientRect(),area=s.getBoundingClientRect();
    s.scrollLeft+=r.left-area.left+k.nx*r.width-k.cx;s.scrollTop+=r.top-area.top+k.ny*r.height-k.cy;
    keep.current=null;
  },[scale]);
  const goPage=(n:number)=>{
    const s=scroll.current;if(!s)return;
    const safe=Math.max(1,Math.min(pages.length,n)),frame=s.querySelector<HTMLElement>('[data-pdf-page="'+safe+'"]');
    if(frame){const r=frame.getBoundingClientRect(),area=s.getBoundingClientRect();s.scrollTop+=r.top-area.top-16;}
    setPage(safe);onPageChange(safe);
  };
  const focusSequence=useRef(0);
  useEffect(()=>()=>{focusSequence.current++;},[]);
  const revealSignature=async()=>{
    const request=++focusSequence.current;
    if(!active||!pdf||!size.width)return;
    goPage(active.page);
    if(!hasBox(active))return;
    const currentPdf=pdf,page=await pdf.getPage(active.page),s=scroll.current;
    if(!s||currentPdf!==pdf||request!==focusSequence.current)return;
    const frame=s.querySelector<HTMLElement>('[data-pdf-page="'+active.page+'"]');if(!frame)return;
    const r=frame.getBoundingClientRect(),area=s.getBoundingClientRect();
    const box=pdfBoxToViewport(page.getViewport({scale}),active as PdfBox);
    s.scrollTop+=r.top-area.top+box.y+box.height/2-s.clientHeight/2;
    s.scrollLeft+=r.left-area.left+box.x+box.width/2-s.clientWidth/2;
  };
  useEffect(()=>{if(pageRequest.focusSignature)void revealSignature().catch(()=>{});else goPage(pageRequest.page);},[pageRequest.sequence,pdf,size.width>0]);
  useEffect(()=>{if(active)void revealSignature().catch(()=>{});},[active?.workerId,pdf,size.width>0]);
  const pageChange=useRef(onPageChange);pageChange.current=onPageChange;
  useEffect(()=>{
    const s=scroll.current;if(!s)return;
    let pending=0;
    const schedule=typeof requestAnimationFrame==='function'?requestAnimationFrame:(fn:FrameRequestCallback)=>window.setTimeout(()=>fn(performance.now()),16);
    const cancel=typeof cancelAnimationFrame==='function'?cancelAnimationFrame:window.clearTimeout;
    const onScroll=()=>{
      if(pending)return;
      pending=schedule(()=>{pending=0;const top=s.getBoundingClientRect().top+s.clientHeight*.25;
        const frames=[...s.querySelectorAll<HTMLElement>('[data-pdf-page]')];
        const visible=frames.find(f=>f.getBoundingClientRect().bottom>top);
        if(visible){const n=Number(visible.dataset.pdfPage);setPage(n);pageChange.current(n);}
      });
    };
    s.addEventListener('scroll',onScroll,{passive:true});
    return()=>{s.removeEventListener('scroll',onScroll);cancel(pending);};
  },[pages.length]);
  const zoomRef=useRef(changeZoom);zoomRef.current=changeZoom;
  useEffect(()=>{
    const s=scroll.current;if(!s)return;
    const wheel=(e:WheelEvent)=>{if(e.ctrlKey||e.metaKey){e.preventDefault();zoomRef.current(Math.exp(-e.deltaY*.005),e.clientX,e.clientY);}};
    s.addEventListener('wheel',wheel,{passive:false});
    return()=>s.removeEventListener('wheel',wheel);
  },[]);

  return <div className="mandatory-continuous-viewport">
    <div className="mandatory-pdf-tool-toggle"><button type="button" onClick={()=>setTools(v=>!v)}>{tools?'Ocultar herramientas':'Mostrar herramientas'}</button></div>
    {tools&&<div className="mandatory-editor-toolbar mandatory-continuous-toolbar">
      <div className="mandatory-editor-pages">
        <button type="button" onClick={()=>goPage(page-1)} disabled={page<=1}>← Página anterior</button>
        <span aria-live="polite">{page} / {pages.length||1}</span>
        <button type="button" onClick={()=>goPage(page+1)} disabled={page>=pages.length}>Página siguiente →</button>
      </div>
      <div className="mandatory-editor-zoom">
        <button type="button" aria-label="Reducir zoom" onClick={()=>changeZoom(1/1.2)}>−</button>
        <span>{Math.round(scale*100)}%</span>
        <button type="button" aria-label="Ampliar zoom" onClick={()=>changeZoom(1.2)}>+</button>
        <button type="button" aria-pressed={fit==='width'} onClick={()=>fitTo('width')}>Ajustar al ancho</button>
        <button type="button" aria-pressed={fit==='page'} onClick={()=>fitTo('page')}>Ajustar página</button>
      </div>
      {!props.readOnly&&<div className="mandatory-pdf-modes" aria-label="Interacción con el PDF">
        <button type="button" aria-pressed={mode==='navigate'} onClick={()=>setMode('navigate')}>Navegar por documento</button>
        <button type="button" aria-pressed={mode==='edit'} onClick={()=>setMode('edit')}>Mover firma</button>
      </div>}
      <p className="mandatory-pdf-mode-hint">{props.readOnly?'Desliza para recorrer el documento. Puedes ampliar y ajustar las páginas.':mode==='navigate'?'Desliza o arrastra para recorrer todas las páginas. Las firmas permanecen fijas.':'Arrastra el cuadro para moverlo, sus esquinas para dimensionarlo o toca el PDF para colocarlo.'}</p>
    </div>}
    <div ref={scroll} className="mandatory-editor-pdf-scroll mandatory-continuous-scroll" tabIndex={0} aria-label="Documento PDF con desplazamiento continuo">
      <div className="mandatory-pdf-stack">{pages.map(meta=><PdfPage key={meta.page} {...props} meta={meta} scale={scale} mode={mode} scroll={scroll}/>)}</div>
    </div>
  </div>;
}
