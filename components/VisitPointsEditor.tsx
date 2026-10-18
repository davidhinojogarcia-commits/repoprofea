import React from 'react';
import type { VisitContent, VisitPoint } from '../src/lib/visitMinutes';
import { visitInput } from './VisitContactsPanel';
const button='min-h-[44px] rounded-xl border px-3 py-2 font-bold disabled:opacity-50';
export function VisitPointsEditor({content,onChange,onCreateOrder}:{content:VisitContent;onChange:(content:VisitContent)=>void;onCreateOrder:(point:VisitPoint)=>void}){
  const points=content.points||[];
  const update=(id:string,patch:Partial<VisitPoint>)=>onChange({...content,points:points.map(p=>p.id===id?{...p,...patch}:p)});
  const move=(index:number,delta:number)=>{const next=[...points];[next[index],next[index+delta]]=[next[index+delta],next[index]];onChange({...content,points:next});};
  return <section aria-label="Puntos de la visita" className="space-y-3"><h3 className="text-lg font-black">Contenido de la visita</h3><p className="text-sm">Un asunto por punto. Puedes dictar con el micrófono del teclado; no se graba audio.</p>
    {points.map((p,i)=><fieldset key={p.id} className="rounded-xl border p-3 space-y-3"><legend className="font-bold">Punto {i+1}</legend><label className="block">Título (opcional)<input className={visitInput} value={p.title} maxLength={200} onChange={e=>update(p.id,{title:e.target.value})}/></label><label className="block font-bold">Descripción del punto {i+1}<textarea aria-label={'Descripción del punto '+(i+1)} className={visitInput} rows={4} value={p.description} maxLength={20000} onChange={e=>update(p.id,{description:e.target.value})}/></label>
      {!!content.attachments.length&&<details><summary className="min-h-[44px] font-bold">Fotografías o anexos de este punto</summary>{content.attachments.map(a=><label key={a.id} className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={p.attachmentIds.includes(a.id)} onChange={e=>update(p.id,{attachmentIds:e.target.checked?[...p.attachmentIds,a.id]:p.attachmentIds.filter(id=>id!==a.id)})}/>{a.name}</label>)}</details>}
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={i===0} onClick={()=>move(i,-1)} aria-label={'Subir punto '+(i+1)}>Subir</button><button type="button" className={button} disabled={i===points.length-1} onClick={()=>move(i,1)} aria-label={'Bajar punto '+(i+1)}>Bajar</button><button type="button" className={button} onClick={()=>onChange({...content,points:points.filter(x=>x.id!==p.id)})}>Eliminar punto {i+1}</button><button type="button" className={button} disabled={!p.description.trim()} onClick={()=>onCreateOrder(p)}>Crear orden desde este punto</button></div>
    </fieldset>)}
    <button type="button" className={button} disabled={points.length>=100} onClick={()=>onChange({...content,points:[...points,{id:crypto.randomUUID(),title:'',description:'',attachmentIds:[]}]})}>+ Añadir punto</button>
  </section>;
}
