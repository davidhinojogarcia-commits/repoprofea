import {createHash} from 'node:crypto';
import type {VisitState,VisitRecord} from '../lib/visitMinutes.js';
import {readVisitObject,putVisitObject,visitFileDescriptor} from './visitFileStorage.js';
import {generateVisitMinutesPdf} from '../lib/visitMinutesPdf.js';
type Db=(path:string,body?:any,auth?:string,method?:string)=>Promise<any>;
const q=(params:Record<string,string>)=>new URLSearchParams(params).toString();
const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export const visitTotalLimit=()=>Math.max(1_500_000,Math.min(8_000_000,Number(process.env.VISIT_ATTACHMENTS_TOTAL_BYTES)||8_000_000));
export async function visitAssetRows(db:Db,state:VisitState,owner:string){
  if(state.content.attachments.reduce((n,a)=>n+(a.bytes||Buffer.from(a.base64,'base64').length),0)>visitTotalLimit())throw new Error('Los anexos superan el máximo total configurado.');
  const refs=state.content.attachments.filter(a=>a.fileId);
  if(!refs.length)return [];
  const rows=await db('visit_minutes_assets?'+q({select:'id,owner_id,obra_id,sha256,bytes,mime,storage_path',owner_id:'eq.'+owner,obra_id:'eq.'+state.content.worksiteId,id:'in.('+refs.map(a=>a.fileId).join(',')+')',limit:'8'}));
  for(const a of refs)if(!rows.some((r:any)=>r.id===a.fileId&&r.sha256===a.sha256&&r.bytes===a.bytes&&r.mime===a.mime))throw Object.assign(new Error('Un anexo pertenece a otra obra, usuario o contenido.'),{status:403});
  return rows;
}
export async function hydrateVisitAssets(db:Db,state:VisitState,owner:string){
  const rows=await visitAssetRows(db,state,owner);
  if(!rows.length)return state;
  const result=structuredClone(state);
  // At most two compressed assets decoded in flight, never giant originals.
  for(let n=0;n<result.content.attachments.length;n+=2)await Promise.all(result.content.attachments.slice(n,n+2).map(async a=>{
    if(!a.fileId)return;const row=rows.find((r:any)=>r.id===a.fileId);a.base64=Buffer.from(await readVisitObject(row.storage_path,row.sha256)).toString('base64');
  }));
  return result;
}
export async function cachedVisitDraft(db:Db,r:VisitRecord){
  const source=digest(JSON.stringify({version:r.version,content:r.state.content,participants:r.state.participants}));
  const existing=await db('visit_minutes_draft_files?'+q({select:'storage_path,sha256',record_id:'eq.'+r.id,version:'eq.'+r.version,source_hash:'eq.'+source,limit:'1'}));
  if(existing[0])return existing[0];
  // The draft cache key describes content, not subsequent participation.
  // Normalize event timestamps/responses so concurrent preview/send requests
  // cannot produce different bytes at the same immutable object path.
  const state=await hydrateVisitAssets(db,{...r.state,status:'review',responses:{},signatures:{},issuedAt:undefined,finalizedAt:undefined,finalSha256:undefined,reviewClosure:undefined,identityChecks:undefined},r.owner_id);
  const bytes=await generateVisitMinutesPdf(state,r.number);
  const path=`${r.owner_id}/drafts/${r.id}_v${r.version}_${source}.pdf`;
  const stored=await putVisitObject(path,bytes,'application/pdf');
  try{await db('visit_minutes_draft_files',{record_id:r.id,version:r.version,source_hash:source,owner_id:r.owner_id,storage_path:path,sha256:stored.sha256});}
  catch(e:any){if(e.status!==409)throw e;}
  return {storage_path:path,sha256:stored.sha256};
}
export async function visitDraftDescriptor(db:Db,r:VisitRecord){return visitFileDescriptor(await cachedVisitDraft(db,r),r.number+'_v'+r.version+'_BORRADOR.pdf');}
