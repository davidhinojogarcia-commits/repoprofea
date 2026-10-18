import {createHash} from 'node:crypto';
import {SUPABASE_URL,SERVICE_KEY} from './gmailOAuth.js';
const bucket='visit-minutes-private';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const safePath=(path:string)=>{
  if(!/^[a-f0-9-]{36}\/(?:assets|drafts|final)\/[a-zA-Z0-9_/-]+\.[a-z]+$/.test(path)||path.includes('..'))throw new Error('Referencia documental inválida.');
  return path;
};
const headers=()=>({apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`});
const objectUrl=(path:string)=>`${SUPABASE_URL}/storage/v1/object/${bucket}/${safePath(path)}`;
export async function readVisitObject(path:string,expected:string){
  const response=await fetch(objectUrl(path),{headers:headers(),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('No se pudo recuperar el documento protegido.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(hash(bytes)!==expected)throw Object.assign(new Error('La integridad del documento no coincide. No se modificará ni regenerará.'),{status:409});
  return bytes;
}
export async function putVisitObject(path:string,bytes:Uint8Array,mime:string){
  const response=await fetch(objectUrl(path),{method:'POST',headers:{...headers(),'Content-Type':mime,'x-upsert':'false'},body:bytes as BodyInit,signal:AbortSignal.timeout(25000)});
  if(!response.ok){
    const result=await response.json().catch(()=>null);
    if(response.status===409||result?.statusCode==='409'||result?.error==='Duplicate')await readVisitObject(path,hash(bytes));
    else throw new Error('No se pudo conservar el archivo protegido. Reintenta; no se generará otra copia idéntica.');
  }
  return {path,sha256:hash(bytes),bytes:bytes.byteLength};
}
export async function visitFileDescriptor(file:{base64?:string;storage_path?:string;sha256:string},filename:string){
  if(!file.storage_path){
    if(!file.base64||hash(Buffer.from(file.base64,'base64'))!==file.sha256)throw Object.assign(new Error('El documento firmado no supera la comprobación de integridad.'),{status:409});
    return {base64:file.base64,sha256:file.sha256,filename};
  }
  const response=await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${safePath(file.storage_path)}`,{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300}),signal:AbortSignal.timeout(15000)});
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result?.signedURL)throw new Error('No se pudo abrir el documento protegido.');
  const signedPath=String(result.signedURL);
  const url=new URL(signedPath.startsWith('/storage/v1/')?signedPath:'/storage/v1/'+signedPath.replace(/^\/+/,''),SUPABASE_URL);
  if(url.origin!==new URL(SUPABASE_URL).origin)throw new Error('Dirección documental inválida.');
  return {url:url.href,sha256:file.sha256,filename};
}
export async function storedVisitBytes(file:{base64?:string;storage_path?:string;sha256:string}){
  if(file.storage_path)return readVisitObject(file.storage_path,file.sha256);
  const bytes=Buffer.from(file.base64||'','base64');if(hash(bytes)!==file.sha256)throw Object.assign(new Error('La integridad del PDF no coincide.'),{status:409});return bytes;
}
