import React, {useState} from 'react';
import type {VisitContent} from '../src/lib/visitMinutes';
import {prepareVisitAttachment,VISIT_TOTAL_BYTES} from '../src/lib/visitAttachmentProcessing';
import {readVisitAttachment} from '../src/services/visitMinutesService';
import {visitInput} from './VisitContactsPanel';
export function VisitAttachmentsEditor({content,onChange,totalLimit=VISIT_TOTAL_BYTES,onProcessing}:{content:VisitContent;onChange:(content:VisitContent)=>void;totalLimit?:number;onProcessing:(processing:boolean)=>void}){
  const [processing,setProcessing]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const remove=(id:string)=>onChange({...content,attachments:content.attachments.filter(a=>a.id!==id),points:content.points?.map(p=>({...p,attachmentIds:p.attachmentIds.filter(a=>a!==id)})),orders:content.orders?.map(o=>({...o,attachmentIds:o.attachmentIds.filter(a=>a!==id)}))});
  const add=async(file:File)=>{
    setError('');setNotice('');setProcessing(true);onProcessing(true);
    try{
      if(content.attachments.length>=8)throw new Error('Máximo ocho anexos.');
      const prepared=await prepareVisitAttachment(file);
      const total=content.attachments.reduce((n,a)=>n+(a.bytes||Math.floor(a.base64.length*3/4)),0);
      if(total+prepared.bytes>totalLimit)throw new Error(`Los anexos superarían el límite total de ${(totalLimit/1_000_000).toFixed(1)} MB.`);
      const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await prepared.blob.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');
      if(content.attachments.some(a=>a.sha256===sha256)){setNotice('Este archivo ya está incluido.');return;}
      const base64=await readVisitAttachment(prepared.blob);
      onChange({...content,attachments:[...content.attachments,{id:crypto.randomUUID(),name:prepared.name,mime:prepared.mime,base64,caption:'',bytes:prepared.bytes,sha256,pendingUpload:true}]});
      setNotice(`Original: ${(prepared.originalBytes/1_000_000).toFixed(2)} MB · Resultado: ${(prepared.bytes/1_000_000).toFixed(2)} MB${prepared.optimized?' · optimizado en el dispositivo':' · conservado sin modificar'}. Pendiente de confirmar en el servidor.`);
    }catch(e:any){setError(e.message||'No se pudo procesar el archivo. Selecciona otra copia.');}
    finally{setProcessing(false);onProcessing(false);}
  };
  return <section aria-label="Anexos y fotografías" className="space-y-3"><h3 className="font-black">Anexos y fotografías</h3><p className="text-sm">Hasta ocho archivos · 1,5 MB por archivo · {(totalLimit/1_000_000).toFixed(1)} MB en total. Las fotos grandes se comprimen en este dispositivo. Los PDF protegidos no se modifican.</p><label className="block font-bold">Seleccionar archivo<input className={visitInput} disabled={processing} type="file" accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif,application/pdf" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void add(file);}}/></label>{processing&&<p role="status">Procesando archivo en el dispositivo…</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="text-red-700">{error}</p>}
    {content.attachments.map(a=><div className="rounded-xl border p-3 space-y-2" key={a.id}><p className="font-bold break-all">{a.name}</p><p className="text-sm">{((a.bytes||a.base64.length*.75)/1_000_000).toFixed(2)} MB · {a.pendingUpload?'Pendiente de sincronizar':'Archivo confirmado'}</p><label>Descripción de {a.name}<input className={visitInput} value={a.caption} onChange={e=>onChange({...content,attachments:content.attachments.map(item=>item.id===a.id?{...item,caption:e.target.value}:item)})}/></label><button type="button" className="min-h-[44px] rounded-xl border px-3 py-2 font-bold" onClick={()=>remove(a.id)}>Quitar anexo</button></div>)}
  </section>;
}
