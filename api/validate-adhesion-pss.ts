import { reportOperationalError } from '../src/lib/operationalLog.js';
import type { IncomingMessage, ServerResponse } from 'http';

const norm=(v:unknown)=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9ñ]+/g,' ').replace(/\s+/g,' ').trim();
const send=(res:ServerResponse,status:number,data:any)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));};
const readBody=async(req:IncomingMessage)=>{const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.isBuffer(c)?c:Buffer.from(c));return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};};

const looksLikeAdhesion=(text:string,name:string)=>{const n=norm(`${name} ${text}`);return n.includes('acta de adhesion')||n.includes('adhesion al plan de seguridad')||(n.includes('plan de seguridad y salud')&&n.includes('adhesion'));};
const hasSignatureNear=(text:string,labels:string[])=>{const n=norm(text);for(const raw of labels){const label=norm(raw);if(!label)continue;let from=0;while(true){const idx=n.indexOf(label,from);if(idx<0)break;const around=n.slice(Math.max(0,idx-140),Math.min(n.length,idx+320));if(/\b(firmad[oa]|firma digital|firma electronica|fdo|rubrica|sello y firma)\b/.test(around))return true;if(/\bfirma\b.{0,120}\b(nombre|dni|representante|empresa|contratista|subcontratista)\b/.test(around))return true;from=idx+label.length;}}return false;};
const hasFilledFields=(text:string)=>{const n=norm(text);const signals=['obra','empresa','cif','representante','fecha'];return signals.filter(s=>n.includes(s)).length>=3&&n.length>160;};

export default async function handler(req:IncomingMessage,res:ServerResponse){
 if(req.method!=='POST')return send(res,405,{error:'Método no permitido.'});
 try{
  const body=await readBody(req);const files=Array.isArray(body.files)?body.files:[];const sub=body.subcontrata||{};const company=norm(sub.nombreEmpresa||''),cif=norm(sub.cif||'');
  const target=files.find((f:any)=>looksLikeAdhesion(String(f.extractedText||''),String(f.name||'')));
  if(!target)return send(res,200,{found:false});
  const text=String(target.extractedText||''),n=norm(text),issues:string[]=[];
  const companyOk=!!company&&(n.includes(company)||(cif&&n.includes(cif)));
  const subcontractRole=/\b(subcontrata|subcontratista|empresa subcontratista)\b/.test(n);
  const contractorOk=/\b(excma )?diputacion provincial de cadiz\b/.test(n);
  const contractorRole=/\b(contrata|contratista|empresa contratista)\b/.test(n);
  const filled=hasFilledFields(text);
  const subcontractSigned=hasSignatureNear(text,['subcontrata','subcontratista','empresa subcontratista',sub.nombreEmpresa||'']);
  const contractorSigned=hasSignatureNear(text,['contrata','contratista','empresa contratista','diputacion provincial de cadiz']);
  if(!companyOk)issues.push('No identifica correctamente a la empresa analizada como subcontrata.');
  if(!subcontractRole)issues.push('No consta claramente la condición de subcontrata/subcontratista.');
  if(!contractorOk)issues.push('No consta Diputación Provincial de Cádiz como contrata.');
  if(!contractorRole)issues.push('No consta claramente la condición de contrata/contratista de Diputación Provincial de Cádiz.');
  if(!filled)issues.push('El acta no parece estar suficientemente cumplimentada.');
  if(!subcontractSigned)issues.push('No se puede verificar la firma de la subcontrata.');
  if(!contractorSigned)issues.push('No se puede verificar la firma de Diputación Provincial de Cádiz como contrata.');
  return send(res,200,{found:true,documento:{docId:'adhesion_pss',estado:issues.length?'incompleto':'entregado',observaciones:issues.length?`INCIDENCIAS: ${issues.join(' ')}`:'Acta de Adhesión validada: empresa subcontratista correcta, Diputación Provincial de Cádiz como contrata y firmas de ambas partes verificadas.',archivoOrigen:String(target.name||''),confianza:issues.length?'alta':'alta',esLegible:true,solicitarReintento:false,validacionPss:{companyOk,subcontractRole,contractorOk,contractorRole,filled,subcontractSigned,contractorSigned,issues}}});
 }catch(e:any){reportOperationalError('[adhesion-pss]', e);return send(res,500,{error:e?.message||'No se pudo validar el Acta de Adhesión.'});}
}
