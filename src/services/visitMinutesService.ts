import { supabase } from '../lib/supabase';
import type {VisitContent} from '../lib/visitMinutes';
export async function visitRequest<T = any>(body: Record<string, unknown>, options: {
  public?: boolean;
  signal?: AbortSignal;
} = {}): Promise<T> {
  let token = '';
  if (!options.public) {
    const {
      data,
      error
    } = await supabase.auth.getSession();
    if (error) throw error;
    token = data.session?.access_token || '';
    if (!token) throw new Error('Inicia sesión para trabajar con las actas.');
  }
  const response = await fetch('/api/visit-minutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {
        Authorization: `Bearer ${token}`
      } : {})
    },
    body: JSON.stringify({clientVersion:'3.1',...body}),
    signal: options.signal || AbortSignal.timeout(65000),
    cache: 'no-store',
    referrerPolicy: 'no-referrer'
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw Object.assign(new Error(result?.message || 'No se pudo completar la operación. Actualiza antes de reintentar si no se confirmó el guardado.'), {
    status: response.status,
    code: result?.code
  });
  return result;
}
export async function visitFileBytes(file:{base64?:string;url?:string;sha256?:string}){
  let bytes=file.base64?Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0)):null;
  if(!bytes&&file.url){const response=await fetch(file.url,{cache:'no-store',referrerPolicy:'no-referrer'});if(!response.ok)throw new Error('El acceso temporal al PDF ha caducado. Vuelve a abrirlo.');bytes=new Uint8Array(await response.arrayBuffer());}
  if(!bytes)throw new Error('El documento no está disponible.');
  if(file.sha256){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');if(hash!==file.sha256)throw new Error('La integridad del PDF no coincide. Actualiza y vuelve a abrirlo.');}
  return bytes;
}
export async function downloadVisitFile(file: {
  base64?: string;
  url?:string;
  sha256?:string;
  filename: string;
  mime?: string;
}) {
  const bytes = await visitFileBytes(file);
  const url = URL.createObjectURL(new Blob([bytes], {
    type: file.mime || 'application/pdf'
  }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export const readVisitAttachment = (file: Blob): Promise<string> => new Promise((resolve, reject) => {
  if (file.size > 1500000) return reject(new Error('Cada anexo debe ocupar como máximo 1,5 MB.'));
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('No se pudo leer el anexo.'));
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.readAsDataURL(file);
});
export const visitDraftValidationContent=(content:VisitContent):VisitContent=>({...content,attachments:content.attachments.map(a=>a.pendingUpload?{...a,base64:'',fileId:a.id}:a)});
export async function uploadPendingVisitAttachments(content:VisitContent,cache:Map<string,any>):Promise<VisitContent>{
  const attachments=[...content.attachments];
  for(let n=0;n<attachments.length;n+=2)await Promise.all(attachments.slice(n,n+2).map(async(a,index)=>{
    if(!a.pendingUpload)return;
    const key=content.worksiteId+':'+a.sha256;
    let asset=cache.get(key);
    if(!asset){asset=(await visitRequest({action:'store-attachment',worksiteId:content.worksiteId,mime:a.mime,base64:a.base64})).asset;cache.set(key,asset);}
    if(asset.sha256!==a.sha256||asset.bytes!==a.bytes)throw new Error('La confirmación del anexo no coincide. Vuelve a seleccionar el archivo.');
    attachments[n+index]={...a,fileId:asset.id,base64:'',pendingUpload:false};
  }));
  return content.attachments.some(a=>a.pendingUpload)?{...content,attachments}:content;
}
