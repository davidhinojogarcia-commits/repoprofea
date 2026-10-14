import React, { useMemo, useState, type ChangeEvent } from 'react';
import ModalPortal from './ModalPortal';

export default function MandatoryWorksiteReviewModal(props:{
  documentLabel:string;
  filename?:string;
  works:string[];
  proposedWorksite?:string;
  detectedCodes?:string[];
  busy?:boolean;
  onCancel:()=>void;
  onConfirm:(obra:string)=>Promise<void>|void;
}){
  const works=useMemo(()=>[...new Set((props.works||[]).map(x=>String(x||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es')),[props.works]);
  const [selected,setSelected]=useState(works.includes(props.proposedWorksite||'')?props.proposedWorksite!:'');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const inFlight=React.useRef(false);
  const confirm=async()=>{
    if(inFlight.current||!works.includes(selected))return;
    inFlight.current=true;setSaving(true);setError('');
    try{await props.onConfirm(selected);}catch(error:any){setError(error?.message||'No se pudo asignar la obra. Vuelve a intentarlo.');}
    finally{inFlight.current=false;setSaving(false);}
  };
  return <ModalPortal label="Clasificar documento por obra">
    <div className="fixed inset-0 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-xl font-black text-slate-900 dark:text-white">Asignar obra al documento</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{props.proposedWorksite?'Comprueba la obra propuesta por el documento. Puedes confirmarla o elegir otra.':'No se ha identificado una obra única de tu catálogo. Selecciona la obra correcta.'} El documento no llegará al encargado hasta que lo envíes expresamente al portal.</p>
        {!!props.detectedCodes?.length&&<p className="mt-2 text-sm font-bold">Código detectado: {props.detectedCodes.join(', ')}</p>}
        <div className="mt-4 rounded-2xl border bg-slate-50 p-3 text-sm dark:bg-slate-800"><b>{props.documentLabel}</b>{props.filename?<div className="mt-1 break-all text-xs text-slate-500">{props.filename}</div>:null}</div>
        <label htmlFor="mandatory-worksite-selection" className="mt-4 block text-xs font-black uppercase tracking-wide text-slate-500">Asignación a obra</label>
        <select id="mandatory-worksite-selection" disabled={props.busy||saving} value={selected} onChange={(e:ChangeEvent<HTMLSelectElement>)=>setSelected(e.target.value)} className="mt-2 min-h-[52px] w-full rounded-xl border bg-white px-3 text-base font-bold dark:bg-slate-950">
          <option value="">Selecciona una obra…</option>
          {works.map(obra=><option key={obra} value={obra}>{obra}</option>)}
        </select>
        {!works.length&&<p role="alert" className="mt-2 text-sm">No hay obras disponibles en tu catálogo. Crea la obra y vuelve a abrir la asignación.</p>}
        {error&&<p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={props.busy||saving} onClick={props.onCancel} className="min-h-11 rounded-xl border px-4 text-sm font-black">Cancelar</button>
          <button type="button" disabled={props.busy||saving||!selected} onClick={()=>void confirm()} className="min-h-11 rounded-xl bg-[#00548E] px-5 text-sm font-black text-white disabled:opacity-50">{saving?'Asignando…':'Asignar obra'}</button>
        </div>
      </div>
    </div>
  </ModalPortal>;
}
