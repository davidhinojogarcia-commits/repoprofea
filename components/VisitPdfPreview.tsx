import React,{useEffect,useState} from 'react';
import ModalPortal from './ModalPortal';
import MandatoryPdfViewport from './MandatoryPdfViewport';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
const noop=()=>undefined;
const request={page:1,sequence:0};
export default function VisitPdfPreview({bytes,title,onClose,embedded=false}:{bytes:Uint8Array;title:string;onClose?:()=>void;embedded?:boolean}){
  const [document,setDocument]=useState<any>(null),[pages,setPages]=useState<any[]>([]),[error,setError]=useState('');
  const [attachments,setAttachments]=useState<any[]>([]);
  useEffect(()=>{
    let cancelled=false,task:any,pdf:any;
    setDocument(null);setPages([]);setError('');setAttachments([]);
    void (async()=>{
      const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
      if(cancelled)return;pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
      task=pdfjs.getDocument({data:bytes.slice(),useSystemFonts:true});pdf=await task.promise;
      if(cancelled){await pdf.destroy();return;}
      const meta=[];for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),v=page.view;meta.push({page:i,width:v[2]-v[0],height:v[3]-v[1],rotation:page.rotate});}
      const originalAttachments=await pdf.getAttachments();
      if(!cancelled){setDocument(pdf);setPages(meta);setAttachments(Object.values(originalAttachments||{}));}
    })().catch(e=>{if(!cancelled)setError(e.message||'No se pudo mostrar el PDF.');});
    return()=>{cancelled=true;void Promise.resolve(task?.destroy?.()).catch(()=>undefined);};
  },[bytes]);
  const downloadOriginal=(attachment:any)=>{
    const url=URL.createObjectURL(new Blob([attachment.content],{type:'application/pdf'}));const link=documentGlobal.createElement('a');link.href=url;link.download=String(attachment.filename||'Anexo-original.pdf').replace(/[\\/]/g,'_');documentGlobal.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
  };
  const documentGlobal=window.document;
  const surface=<><header className="visit-mail-header"><h3 className="font-bold">{title}</h3>{onClose&&<button className="min-h-[44px] rounded-xl border px-4 py-2" onClick={onClose}>Cerrar PDF</button>}{attachments.length>0&&<details><summary className="min-h-[44px] font-bold">Anexos originales protegidos</summary><p className="text-sm">Se conservan como archivos adjuntos sin modificar sus firmas o formularios.</p>{attachments.map((a,i)=><button key={i} className="min-h-[44px] rounded-xl border px-3 py-2" onClick={()=>downloadOriginal(a)}>Descargar {a.filename}</button>)}</details>}</header>{error?<p role="alert">{error}</p>:document?<MandatoryPdfViewport readOnly pdf={document} pages={pages} anchors={[]} activeIndex={-1} disabled pageRequest={request} onPageChange={noop} onSelect={noop} onChange={noop}/>:<p role="status" className="p-4">Cargando PDF…</p>}</>;
  return embedded?<section aria-label="Vista previa del PDF borrador" className="flex min-h-0 flex-col overflow-hidden rounded-xl border" style={{height:'min(65vh,600px)'}}>{surface}</section>:<ModalPortal layout="fullscreen" label={title}><div className="visit-mail-overlay"><section role="dialog" aria-modal="true" aria-label={title} className="visit-mail-dialog">{surface}</section></div></ModalPortal>;
}
